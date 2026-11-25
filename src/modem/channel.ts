// Line simulator (requirement 11, design.md "Line simulator API", task 9). Pure: no DOM, no Web Audio.
//
// Chain, in this order: clock resampling, SSB frequency offset, mains hum, noise bursts, AWGN.
// The streaming channel has a constant latency of LAT = W + M output samples (W: resampler
// half-width, M: Hilbert group delay), so `process` returns exactly one sample per input sample
// when clockPpm = 0. Hum, bursts and AWGN are indexed by the aligned sample a = n - LAT (they start
// with the first input sample); `applyChannel` drops the LAT leading samples, so its output is
// aligned with its input.
import { CHANNELS, LINE_SIMULATOR, SAMPLE_RATE_MAX_HZ, SAMPLE_RATE_MIN_HZ, SNR_REFERENCE_BAND_HZ, type ChannelId } from './v23';
import type { ModemError, Result } from './types';
import { hammingTapCount } from './filters';

export interface HumParams {
  levelDb: number; // total hum power relative to the signal power P = A^2 / 2
  fundamentalHz?: number; // default 50
  harmonics?: number; // default 5: orders 1..harmonics, amplitude proportional to 1/k
}

export interface BurstParams {
  ratePerS: number; // Poisson arrival rate
  durationMs: [number, number]; // uniform duration range
  levelDb: number; // burst noise power in the 3 kHz reference band relative to P
}

export type NoiseParams = { kind: 'ebN0'; db: number } | { kind: 'snr3k'; db: number };

export interface ChannelParams {
  sampleRate: number;
  seed: number; // uint32
  channel?: ChannelId; // bit rate used by Eb/N0, default 'forward'
  signalAmplitude?: number; // reference peak amplitude of the received tone, default 0.5
  noise?: NoiseParams; // absent = no noise
  offsetHz?: number;
  clockPpm?: number; // > 0: transmitter clock fast, signal shortened by 1 / (1 + ppm 1e-6)
  hum?: HumParams;
  bursts?: BurstParams;
}

export type ChannelUpdate = Partial<Omit<ChannelParams, 'sampleRate' | 'seed'>>;

export interface LineChannel {
  process(chunk: Float32Array): Float32Array; // new array; length differs when clockPpm != 0
  flush(): Float32Array;
  setParams(p: ChannelUpdate): void; // from the next sample
  reset(): void;
}

export const DEFAULT_HUM: HumParams = Object.freeze({ levelDb: -20, fundamentalHz: 50, harmonics: 5 });
export const DEFAULT_BURSTS: BurstParams = Object.freeze({
  ratePerS: 0.5,
  durationMs: Object.freeze([5, 25]) as [number, number],
  levelDb: 0,
});

const DEFAULT_AMPLITUDE = 0.5;
const UPDATE_KEYS = ['channel', 'signalAmplitude', 'noise', 'offsetHz', 'clockPpm', 'hum', 'bursts'] as const;

// ---------------------------------------------------------------------------------------------
// Seeded RNG: Mulberry32 + Box-Muller, the same generator as tests/helpers/rng.ts, so a noise-only
// channel reproduces the A7 test helper `awgn` for the same seed.

class Rng {
  private state: number;
  private spare = 0;
  private hasSpare = false;
  constructor(seed: number) {
    this.state = seed | 0;
  }
  float(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  gaussian(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u1 = 0;
    while (u1 <= 1e-12) u1 = this.float();
    const u2 = this.float();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const angle = 2.0 * Math.PI * u2;
    this.spare = mag * Math.sin(angle);
    this.hasSpare = true;
    return mag * Math.cos(angle);
  }
}

/** Seed of the burst generator, independent of the AWGN stream. */
const BURST_SEED_XOR = 0x5bd1e995;

// ---------------------------------------------------------------------------------------------
// Parameter validation

interface Resolved {
  channel: ChannelId;
  signalAmplitude: number;
  noise: NoiseParams | undefined;
  offsetHz: number;
  clockPpm: number;
  hum: Required<HumParams> | undefined;
  bursts: BurstParams | undefined;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const bad = (option: string, reason: string): { ok: false; error: ModemError } => ({
  ok: false,
  error: { kind: 'bad-option', option, reason },
});

/**
 * Applies the keys present in `p` on top of `base`. A key present with the value `undefined`
 * restores its default (no noise, no hum, no bursts, 0 Hz, 0 ppm, 'forward', 0.5); an absent key
 * keeps the current value.
 */
function resolveParams(base: Resolved, p: ChannelUpdate, fs: number): Result<Resolved, ModemError> {
  const r: Resolved = { ...base };
  if (has(p, 'channel')) {
    const v = p.channel;
    if (v === undefined) r.channel = 'forward';
    else if (v === 'forward' || v === 'backward') r.channel = v;
    else return bad('channel', "must be 'forward' or 'backward'");
  }
  if (has(p, 'signalAmplitude')) {
    const v = p.signalAmplitude;
    if (v === undefined) r.signalAmplitude = DEFAULT_AMPLITUDE;
    else if (isFiniteNumber(v) && v > 0) r.signalAmplitude = v;
    else return bad('signalAmplitude', 'must be a finite number > 0');
  }
  if (has(p, 'noise')) {
    const v = p.noise as unknown;
    if (v === undefined) r.noise = undefined;
    else if (typeof v !== 'object' || v === null) return bad('noise', 'must be { kind, db }');
    else {
      const { kind, db } = v as { kind?: unknown; db?: unknown };
      if (kind !== 'ebN0' && kind !== 'snr3k') return bad('noise', "kind must be 'ebN0' or 'snr3k'");
      if (!isFiniteNumber(db)) return bad('noise', 'db must be finite');
      r.noise = { kind, db };
    }
  }
  if (has(p, 'offsetHz')) {
    const v = p.offsetHz;
    if (v === undefined) r.offsetHz = 0;
    else if (isFiniteNumber(v) && Math.abs(v) < fs / 2) r.offsetHz = v;
    else return bad('offsetHz', 'must be finite with |offsetHz| < sampleRate / 2');
  }
  if (has(p, 'clockPpm')) {
    const v = p.clockPpm;
    if (v === undefined) r.clockPpm = 0;
    else if (isFiniteNumber(v) && Math.abs(v) <= LINE_SIMULATOR.maxClockPpm) r.clockPpm = v;
    else return bad('clockPpm', `must be finite with |clockPpm| <= ${LINE_SIMULATOR.maxClockPpm}`);
  }
  if (has(p, 'hum')) {
    const v = p.hum as unknown;
    if (v === undefined) r.hum = undefined;
    else if (typeof v !== 'object' || v === null) return bad('hum', 'must be { levelDb, fundamentalHz?, harmonics? }');
    else {
      const h = v as { levelDb?: unknown; fundamentalHz?: unknown; harmonics?: unknown };
      const f0 = h.fundamentalHz ?? 50;
      const nh = h.harmonics ?? 5;
      if (!isFiniteNumber(h.levelDb)) return bad('hum', 'levelDb must be finite');
      if (!isFiniteNumber(f0) || f0 <= 0 || f0 >= fs / 2) return bad('hum', 'fundamentalHz must be in (0, sampleRate / 2)');
      if (!Number.isInteger(nh) || (nh as number) < 1 || (nh as number) > LINE_SIMULATOR.maxHarmonics)
        return bad('hum', `harmonics must be an integer in 1..${LINE_SIMULATOR.maxHarmonics}`);
      r.hum = { levelDb: h.levelDb, fundamentalHz: f0, harmonics: nh as number };
    }
  }
  if (has(p, 'bursts')) {
    const v = p.bursts as unknown;
    if (v === undefined) r.bursts = undefined;
    else if (typeof v !== 'object' || v === null) return bad('bursts', 'must be { ratePerS, durationMs, levelDb }');
    else {
      const b = v as { ratePerS?: unknown; durationMs?: unknown; levelDb?: unknown };
      if (!isFiniteNumber(b.ratePerS) || b.ratePerS < 0) return bad('bursts', 'ratePerS must be finite and >= 0');
      if (!isFiniteNumber(b.levelDb)) return bad('bursts', 'levelDb must be finite');
      const d = b.durationMs;
      if (!Array.isArray(d) || d.length !== 2 || !isFiniteNumber(d[0]) || !isFiniteNumber(d[1]))
        return bad('bursts', 'durationMs must be [min, max]');
      if (!(d[0] > 0 && d[0] <= d[1] && d[1] <= LINE_SIMULATOR.maxBurstMs))
        return bad('bursts', `durationMs must satisfy 0 < min <= max <= ${LINE_SIMULATOR.maxBurstMs}`);
      r.bursts = { ratePerS: b.ratePerS, durationMs: [d[0], d[1]], levelDb: b.levelDb };
    }
  }
  return { ok: true, value: r };
}

const sameBursts = (a: BurstParams | undefined, b: BurstParams | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.ratePerS === b.ratePerS &&
    a.levelDb === b.levelDb &&
    a.durationMs[0] === b.durationMs[0] &&
    a.durationMs[1] === b.durationMs[1]);

// ---------------------------------------------------------------------------------------------
// Hilbert FIR (type III, odd length L = 2M + 1): g[j] = 2 / (pi j) w[M + j] for odd j, 0 for even j.

function hilbertHalfTaps(fs: number): Float64Array {
  const n = hammingTapCount(fs, LINE_SIMULATOR.hilbertTransitionHz);
  const m = (n - 1) / 2;
  const g = new Float64Array(m + 1);
  for (let j = 1; j <= m; j += 2) {
    g[j] = (2 / (Math.PI * j)) * (0.54 - 0.46 * Math.cos((2 * Math.PI * (m + j)) / (n - 1)));
  }
  return g;
}

/** Streaming latency of a channel at this sample rate, in output samples (W + M). */
export function channelLatencySamples(sampleRate: number): number {
  return LINE_SIMULATOR.resamplerHalfWidth + (hammingTapCount(sampleRate, LINE_SIMULATOR.hilbertTransitionHz) - 1) / 2;
}

// ---------------------------------------------------------------------------------------------

class Channel implements LineChannel {
  private readonly fs: number;
  private readonly seed: number;
  private prm: Resolved;

  // Derived levels.
  private sigma = 0;
  private burstSigma = 0;
  private humAmp: Float64Array = new Float64Array(0);
  private step = 1;
  private cutoff = 1;

  // Resampler: output m reads input position p(m) = pBase + (m - mBase) * step.
  private readonly w = LINE_SIMULATOR.resamplerHalfWidth;
  private inBuf = new Float64Array(0);
  private inStart = 0; // absolute index of inBuf[0]
  private inCount = 0; // input samples received
  private mNext = 0;
  private mBase = 0;
  private pBase = 0;

  // Hilbert stage.
  private readonly g: Float64Array;
  private readonly hm: number; // M
  private readonly hl: number; // L
  private readonly ring: Float64Array;
  private ringPos = 0;
  private nOut = 0; // Hilbert outputs so far (= channel outputs)
  private cycBase = 0; // offset phase in cycles at nBase, in [0, 1)
  private nBase = 0;

  // Impairments, indexed by the aligned sample a = nOut - latency.
  private readonly latency: number;
  private humCycBase = 0;
  private humABase = 0;
  private awgnRng: Rng;
  private burstRng: Rng;
  private burstLeft = 0;
  private nextBurstA = Infinity;
  private burstNeedsSchedule = true;

  constructor(fs: number, seed: number, prm: Resolved) {
    this.fs = fs;
    this.seed = seed;
    this.prm = prm;
    this.g = hilbertHalfTaps(fs);
    this.hm = this.g.length - 1;
    this.hl = 2 * this.hm + 1;
    this.ring = new Float64Array(2 * this.hl);
    this.latency = this.w + this.hm;
    this.awgnRng = new Rng(seed);
    this.burstRng = new Rng(seed ^ BURST_SEED_XOR);
    this.mBase = this.w;
    this.derive();
  }

  private derive(): void {
    const { signalAmplitude: a, noise, hum, bursts, clockPpm } = this.prm;
    const pSignal = (a * a) / 2;
    if (noise) {
      // A7 (docs/math.md 2.4): N0 = P / (R Eb/N0) or P / (3000 γ_3k), sigma^2 = N0 fs / 2.
      // Same expression order as tests/helpers/awgn-resample.ts.
      const lin = Math.pow(10, noise.db / 10);
      const n0 = noise.kind === 'ebN0' ? pSignal / (CHANNELS[this.prm.channel].baud * lin) : pSignal / (SNR_REFERENCE_BAND_HZ * lin);
      this.sigma = Math.sqrt((n0 * this.fs) / 2);
    } else this.sigma = 0;
    if (bursts) {
      const n0 = (pSignal * Math.pow(10, bursts.levelDb / 10)) / SNR_REFERENCE_BAND_HZ;
      this.burstSigma = Math.sqrt((n0 * this.fs) / 2);
    } else this.burstSigma = 0;
    if (hum) {
      // Orders k = 1..harmonics below Nyquist, amplitude c / k, total power P 10^(levelDb / 10).
      let kMax = 0;
      while (kMax < hum.harmonics && (kMax + 1) * hum.fundamentalHz < this.fs / 2) kMax++;
      const amp = new Float64Array(kMax + 1);
      let s = 0;
      for (let k = 1; k <= kMax; k++) s += 1 / (k * k);
      const c = Math.sqrt((2 * pSignal * Math.pow(10, hum.levelDb / 10)) / s);
      for (let k = 1; k <= kMax; k++) amp[k] = c / k;
      this.humAmp = amp;
    } else this.humAmp = new Float64Array(0);
    this.step = 1 + clockPpm * 1e-6;
    this.cutoff = Math.min(1, 1 / this.step);
  }

  // --- resampler ---

  private pAt(m: number): number {
    return this.pBase + (m - this.mBase) * this.step;
  }

  private inputAt(k: number): number {
    return k < 0 || k >= this.inCount ? 0 : this.inBuf[k - this.inStart];
  }

  private resampleAt(p: number): number {
    const k0 = Math.floor(p);
    const frac = p - k0;
    const c = this.cutoff;
    if (frac === 0 && c === 1) return this.inputAt(k0);
    const w = this.w;
    let acc = 0;
    let wsum = 0;
    for (let k = k0 - w + 1; k <= k0 + w; k++) {
      const d = p - k;
      const x = Math.PI * c * d;
      const sinc = x === 0 ? 1 : Math.sin(x) / x;
      const h = c * sinc * (0.54 + 0.46 * Math.cos((Math.PI * d) / w));
      acc += this.inputAt(k) * h;
      wsum += h;
    }
    return wsum !== 0 ? acc / wsum : 0;
  }

  /** Number of resampler outputs available now (flushing: every position up to the last input). */
  private available(flushing: boolean): number {
    const last = this.inCount - 1;
    let m = this.mNext;
    if (flushing) {
      if (this.inCount === 0) return 0;
      while (this.pAt(m) <= last) m++;
    } else {
      while (Math.floor(this.pAt(m)) + this.w <= last) m++;
    }
    return m - this.mNext;
  }

  private append(chunk: Float32Array): void {
    const keepFrom = Math.max(this.inStart, Math.min(this.inCount, Math.floor(this.pAt(this.mNext)) - this.w + 1));
    const keep = this.inCount - keepFrom;
    const buf = new Float64Array(keep + chunk.length);
    buf.set(this.inBuf.subarray(keepFrom - this.inStart, this.inCount - this.inStart), 0);
    for (let i = 0; i < chunk.length; i++) buf[keep + i] = chunk[i];
    this.inBuf = buf;
    this.inStart = keepFrom;
    this.inCount += chunk.length;
  }

  // --- Hilbert stage: SSB shift by offsetHz ---

  private shift(x: number): number {
    const n = this.hl;
    const pos = this.ringPos;
    this.ring[pos] = x;
    this.ring[pos + n] = x;
    this.ringPos = pos + 1 === n ? 0 : pos + 1;
    const base = pos + n; // ring[base - i] = input i samples ago
    const m = this.hm;
    const xd = this.ring[base - m];
    const nOut = this.nOut;
    const offset = this.prm.offsetHz;
    if (offset === 0 && this.cycBase === 0) return xd;
    let hx = 0;
    const g = this.g;
    for (let j = 1; j <= m; j += 2) hx += g[j] * (this.ring[base - m - j] - this.ring[base - m + j]);
    const cyc = this.cycBase + (offset * (nOut - this.nBase)) / this.fs;
    const phi = 2 * Math.PI * (cyc - Math.floor(cyc));
    return xd * Math.cos(phi) - hx * Math.sin(phi);
  }

  // --- impairments ---

  private impair(z: number): number {
    const a = this.nOut - this.latency;
    if (a < 0) return z;
    let y = z;
    const amp = this.humAmp;
    if (amp.length > 1 && this.prm.hum) {
      const cyc = this.humCycBase + (this.prm.hum.fundamentalHz * (a - this.humABase)) / this.fs;
      const s = 2 * Math.PI * (cyc - Math.floor(cyc));
      // sin(k s) by the Chebyshev recurrence sin(k s) = 2 cos(s) sin((k - 1) s) - sin((k - 2) s).
      const c2 = 2 * Math.cos(s);
      let s1 = Math.sin(s);
      let s0 = 0;
      y += amp[1] * s1;
      for (let k = 2; k < amp.length; k++) {
        const sk = c2 * s1 - s0;
        y += amp[k] * sk;
        s0 = s1;
        s1 = sk;
      }
    }
    const b = this.prm.bursts;
    if (b) {
      if (this.burstNeedsSchedule) {
        this.burstNeedsSchedule = false;
        this.burstLeft = 0;
        this.nextBurstA = a + this.burstGap(b);
      }
      if (this.burstLeft === 0 && a >= this.nextBurstA) {
        const ms = b.durationMs[0] + (b.durationMs[1] - b.durationMs[0]) * this.burstRng.float();
        this.burstLeft = Math.max(1, Math.round((ms * this.fs) / 1000));
      }
      if (this.burstLeft > 0) {
        y += this.burstSigma * this.burstRng.gaussian();
        if (--this.burstLeft === 0) this.nextBurstA = a + 1 + this.burstGap(b);
      }
    }
    if (this.sigma > 0) y += this.sigma * this.awgnRng.gaussian();
    return y;
  }

  /** Exponential inter-arrival time in samples (Poisson process of rate ratePerS). */
  private burstGap(b: BurstParams): number {
    if (b.ratePerS === 0) return Infinity;
    return Math.floor((-Math.log(1 - this.burstRng.float()) * this.fs) / b.ratePerS);
  }

  private run(count: number, out: Float32Array, at: number, zerosOnly: boolean): void {
    for (let i = 0; i < count; i++) {
      let x = 0;
      if (!zerosOnly) {
        x = this.resampleAt(this.pAt(this.mNext));
        this.mNext++;
      }
      const z = this.shift(x);
      out[at + i] = this.impair(z);
      this.nOut++;
    }
  }

  process(chunk: Float32Array): Float32Array {
    if (chunk.length === 0) return new Float32Array(0);
    this.append(chunk);
    const n = this.available(false);
    const out = new Float32Array(n);
    this.run(n, out, 0, false);
    return out;
  }

  flush(): Float32Array {
    if (this.inCount === 0) {
      this.reset();
      return new Float32Array(0);
    }
    const n = this.available(true);
    const out = new Float32Array(n + this.hm);
    this.run(n, out, 0, false);
    this.run(this.hm, out, n, true);
    this.reset();
    return out;
  }

  setParams(p: ChannelUpdate): void {
    if (typeof p !== 'object' || p === null) return;
    const r = resolveParams(this.prm, p, this.fs);
    if (!r.ok) return; // invalid update: ignored as a whole
    const next = r.value;
    const prev = this.prm;
    // Re-anchor the continuous phases and positions at the next sample.
    if (next.clockPpm !== prev.clockPpm) {
      this.pBase = this.pAt(this.mNext);
      this.mBase = this.mNext;
    }
    if (next.offsetHz !== prev.offsetHz) {
      const cyc = this.cycBase + (prev.offsetHz * (this.nOut - this.nBase)) / this.fs;
      this.cycBase = cyc - Math.floor(cyc);
      this.nBase = this.nOut;
    }
    const prevF0 = prev.hum?.fundamentalHz ?? 0;
    const nextF0 = next.hum?.fundamentalHz ?? 0;
    if (prevF0 !== nextF0) {
      const a = Math.max(0, this.nOut - this.latency);
      const cyc = this.humCycBase + (prevF0 * (a - this.humABase)) / this.fs;
      this.humCycBase = cyc - Math.floor(cyc);
      this.humABase = a;
    }
    if (!sameBursts(prev.bursts, next.bursts)) this.burstNeedsSchedule = true;
    this.prm = next;
    this.derive();
  }

  reset(): void {
    this.inBuf = new Float64Array(0);
    this.inStart = 0;
    this.inCount = 0;
    this.mNext = 0;
    this.mBase = this.w;
    this.pBase = 0;
    this.ring.fill(0);
    this.ringPos = 0;
    this.nOut = 0;
    this.cycBase = 0;
    this.nBase = 0;
    this.humCycBase = 0;
    this.humABase = 0;
    this.awgnRng = new Rng(this.seed);
    this.burstRng = new Rng(this.seed ^ BURST_SEED_XOR);
    this.burstLeft = 0;
    this.nextBurstA = Infinity;
    this.burstNeedsSchedule = true;
  }
}

const BASE: Resolved = {
  channel: 'forward',
  signalAmplitude: DEFAULT_AMPLITUDE,
  noise: undefined,
  offsetHz: 0,
  clockPpm: 0,
  hum: undefined,
  bursts: undefined,
};

export function createChannel(p: ChannelParams): Result<LineChannel, ModemError> {
  if (typeof p !== 'object' || p === null) return bad('params', 'must be an object');
  const fs = p.sampleRate;
  if (!isFiniteNumber(fs) || fs < SAMPLE_RATE_MIN_HZ || fs > SAMPLE_RATE_MAX_HZ) {
    return { ok: false, error: { kind: 'bad-sample-rate', sampleRate: fs } };
  }
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff) return bad('seed', 'must be a uint32');
  const update: ChannelUpdate = {};
  for (const k of UPDATE_KEYS) if (has(p, k)) (update as Record<string, unknown>)[k] = p[k];
  const r = resolveParams(BASE, update, fs);
  if (!r.ok) return r;
  return { ok: true, value: new Channel(fs, p.seed, r.value) };
}

/** One-shot channel: the streaming output with its latency removed, aligned with x. */
export function applyChannel(x: Float32Array, p: ChannelParams): Result<Float32Array, ModemError> {
  if (!(x instanceof Float32Array)) return bad('x', 'must be a Float32Array');
  const c = createChannel(p);
  if (!c.ok) return c;
  if (x.length === 0) return { ok: true, value: new Float32Array(0) };
  const a = c.value.process(x);
  const b = c.value.flush();
  const lat = channelLatencySamples(p.sampleRate);
  const out = new Float32Array(a.length + b.length - lat);
  out.set(a.subarray(Math.min(lat, a.length)), 0);
  out.set(b.subarray(Math.max(0, lat - a.length)), Math.max(0, a.length - lat));
  return { ok: true, value: out };
}
