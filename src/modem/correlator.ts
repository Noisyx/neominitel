// Second receiver: non-coherent quadrature correlators per bit (task 15, design.md "Correlator
// demodulator"). A complete demodulator with its own frame timing, shown next to the
// discriminator in 3615 MATHS (curve 4 against curves 2 and 3, docs/math.md section 8).
import { mixerPhaseCycles } from './discriminator';
import { lineBitsToByte, START_BIT_INDEX, STOP_BIT_INDEX } from './frame';
import { isValidSampleRate } from './modulator';
import type { ModemError, Result } from './types';
import { CHANNELS, FRAME, type ChannelId } from './v23';

export interface CorrelatorOptions {
  sampleRate: number;
  /** Default 'forward'. */
  channel?: ChannelId;
}

/** One decided frame of the correlator receiver. */
export interface CorrelatorChar {
  value: number;
  parityOk: boolean;
  framingOk: boolean;
  /** Estimated start edge, nearest input-sample index since reset. */
  atSample: number;
  /** min over the 10 bits of |E_mark - E_space| / (E_mark + E_space), in [0, 1]. */
  minConfidence: number;
}

export interface CorrelatorDemodulator {
  readonly sampleRate: number;
  readonly channel: ChannelId;
  /** Correlation length in input samples: round(fs / baud). */
  readonly windowSamples: number;
  push(chunk: Float32Array): CorrelatorChar[];
  /** Decides the frames whose stop bit is read inside the input, then clears the receiver state. */
  flush(): CorrelatorChar[];
  reset(): void;
}

const TWO_PI = 2 * Math.PI;

/**
 * Creates the correlator receiver.
 *
 * Statistic: per input sample n (global index since reset), for each tone f in {mark, space},
 * z_f(n) = sum over the last N samples of x[m] e^(-j 2 pi f m / fs), N = round(fs / baud), with the
 * closed-form phase `mixerPhaseCycles` (no accumulated rounding); d(n) = |z_mark|^2 - |z_space|^2,
 * dated at the window centre c = n - (N - 1) / 2. This is the non-coherent (envelope) detector of
 * each tone, matched to a rectangular bit.
 *
 * Framing: a start edge is a crossing of d from > 0 (mark) to <= 0, dated by linear interpolation
 * between two centres (t_e). Before the first frame since reset or flush (acquisition), the edge
 * also needs round(T / 2) consecutive centres with d > 0 before it, T = fs / baud. Bit k is the
 * sign of d at the centre nearest t_e + (k + 1/2) T: mark when d > 0. A start bit read as mark is
 * a false start (hunt again). After the stop bit, the hunt resumes at once.
 *
 * No carrier detection and no threshold: the input is assumed to carry the channel's carrier
 * (test-bench use). Deterministic and independent of chunk boundaries; `push` never throws.
 * Errors: `bad-sample-rate`, `bad-option` "channel".
 */
export function createCorrelatorDemodulator(o: CorrelatorOptions): Result<CorrelatorDemodulator, ModemError> {
  const sampleRate = o?.sampleRate;
  if (!isValidSampleRate(sampleRate)) return { ok: false, error: { kind: 'bad-sample-rate', sampleRate } };
  const channel = o.channel ?? 'forward';
  if (!Object.prototype.hasOwnProperty.call(CHANNELS, channel)) {
    return { ok: false, error: { kind: 'bad-option', option: 'channel', reason: `unknown channel "${String(channel)}"` } };
  }
  const spec = CHANNELS[channel];
  const bitSamples = sampleRate / spec.baud;
  const N = Math.max(1, Math.round(bitSamples));
  const half = (N - 1) / 2; // centre offset: c = n - half

  // Products of the last N samples with each tone, as rings, and their running sums.
  const mRe = new Float64Array(N);
  const mIm = new Float64Array(N);
  const sRe = new Float64Array(N);
  const sIm = new Float64Array(N);
  let sumMRe = 0;
  let sumMIm = 0;
  let sumSRe = 0;
  let sumSIm = 0;
  let ring = 0;
  let filled = 0;

  let n = 0; // global input index since reset
  let prevD = 0;
  let hasPrev = false;
  // Consecutive centres with d > 0. Until the first frame since reset or flush (acquisition), a
  // start edge needs at least half a bit of mark before it: this rejects the sign chatter of noise
  // on the opening ramp, before the carrier is established. Once a frame has been decided, every
  // edge is accepted at once (measured: gating later edges too loses frames after each noise dip
  // in a stop bit, and the counted BER at 10 dB nearly doubles).
  let markRun = 0;
  const minMarkRun = Math.max(1, Math.round(bitSamples / 2));
  let acquired = false;
  let inFrame = false;
  let edgeT = 0; // start edge, centre time
  let nextBit = 0;
  let nextBitAt = 0; // input index at which bit nextBit is read
  let minConf = 1;
  const bits = new Uint8Array(FRAME.bitsPerFrame);

  function clearState(): void {
    mRe.fill(0);
    mIm.fill(0);
    sRe.fill(0);
    sIm.fill(0);
    sumMRe = sumMIm = sumSRe = sumSIm = 0;
    ring = 0;
    filled = 0;
    prevD = 0;
    hasPrev = false;
    markRun = 0;
    acquired = false;
    inFrame = false;
  }

  function bitIndexAt(k: number): number {
    return Math.round(edgeT + (k + 0.5) * bitSamples + half);
  }

  /** Processes one input sample. `limit`: drop frames whose stop bit is read at or after it. */
  function step(xIn: number, out: CorrelatorChar[], limit: number): void {
    const x = Number.isFinite(xIn) ? xIn : 0;
    const pm = TWO_PI * mixerPhaseCycles(n, spec.markHz, sampleRate);
    const ps = TWO_PI * mixerPhaseCycles(n, spec.spaceHz, sampleRate);
    const a = x * Math.cos(pm);
    const b = -x * Math.sin(pm);
    const c = x * Math.cos(ps);
    const e = -x * Math.sin(ps);
    sumMRe += a - mRe[ring];
    sumMIm += b - mIm[ring];
    sumSRe += c - sRe[ring];
    sumSIm += e - sIm[ring];
    mRe[ring] = a;
    mIm[ring] = b;
    sRe[ring] = c;
    sIm[ring] = e;
    ring++;
    if (ring === N) {
      // Exact re-summation once per window: the running sums never drift.
      ring = 0;
      sumMRe = sumMIm = sumSRe = sumSIm = 0;
      for (let i = 0; i < N; i++) {
        sumMRe += mRe[i];
        sumMIm += mIm[i];
        sumSRe += sRe[i];
        sumSIm += sIm[i];
      }
    }
    if (filled < N) filled++;
    const now = n;
    n++;
    if (filled < N) return;

    const em = sumMRe * sumMRe + sumMIm * sumMIm;
    const es = sumSRe * sumSRe + sumSIm * sumSIm;
    const d = em - es;
    const centre = now - half;
    if (!inFrame && hasPrev && prevD > 0 && d <= 0 && (acquired || markRun >= minMarkRun)) {
      edgeT = centre - 1 + prevD / (prevD - d);
      inFrame = true;
      nextBit = 0;
      nextBitAt = bitIndexAt(0);
      minConf = 1;
    }
    // A bit is read at the step whose index is its target (targets are always ahead of the edge).
    while (inFrame && now >= nextBitAt) {
      const bit = d > 0 ? 1 : 0;
      const conf = em + es > 0 ? Math.abs(d) / (em + es) : 0;
      if (conf < minConf) minConf = conf;
      bits[nextBit] = bit;
      if (nextBit === START_BIT_INDEX && bit === 1) {
        inFrame = false; // false start
        break;
      }
      if (nextBit === STOP_BIT_INDEX) {
        inFrame = false;
        acquired = true;
        if (now < limit) {
          const f = lineBitsToByte(bits);
          out.push({ value: f.value, parityOk: f.parityOk, framingOk: f.framingOk, atSample: Math.max(0, Math.round(edgeT)), minConfidence: minConf });
        }
        break;
      }
      nextBit++;
      nextBitAt = bitIndexAt(nextBit);
    }
    markRun = d > 0 ? markRun + 1 : 0;
    prevD = d;
    hasPrev = true;
  }

  const demod: CorrelatorDemodulator = {
    sampleRate,
    channel,
    windowSamples: N,
    push(chunk: Float32Array): CorrelatorChar[] {
      const out: CorrelatorChar[] = [];
      try {
        for (let i = 0; i < chunk.length; i++) step(chunk[i], out, Infinity);
      } catch {
        // never throws
      }
      return out;
    },
    flush(): CorrelatorChar[] {
      const out: CorrelatorChar[] = [];
      try {
        // Zeros complete the windows of the last real samples; a frame counts only if its stop
        // bit is read at a window centre inside the real input (index < end + half).
        const end = n;
        const pad = Math.ceil(half) + 1;
        for (let i = 0; i < pad; i++) step(0, out, end + half);
        n = end; // time continues from the last real sample
        clearState();
      } catch {
        // never throws
      }
      return out;
    },
    reset(): void {
      n = 0;
      clearState();
    },
  };
  return { ok: true, value: demod };
}
