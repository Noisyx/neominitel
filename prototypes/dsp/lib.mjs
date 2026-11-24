// NeoMinitel numerical prototypes: shared library.
// Plain Node (>= 18), zero dependencies. Simulation only: nothing here is a hardware measurement.
//
// Contents:
//   - V23: the single intentional copy of the V.23 constants (exception U3, checked by a guard
//     test against src/modem/v23.ts once that file exists).
//   - Seeded RNG: xoshiro128** seeded by splitmix32 from a 32-bit FNV-1a hash of a stream key.
//   - Gaussian generator (Box-Muller on 53-bit uniforms).
//   - Windowed-sinc low-pass design (Hamming, Blackman, Kaiser), DTFT, radix-2 FFT, B_n.
//   - wilsonInterval(errors, bits, z): the single Wilson implementation used by E3b and E3c
//     (copy of the src/modem/prbs.ts contract, decision P1/P3).
//   - normalQuantile, marcumQ1, besselI0, berNoncoherentCorrelated.
//   - Result writers (CSV + meta.json) and self-checks.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const RESULTS = join(HERE, 'results');

// ---------------------------------------------------------------------------------------------
// V.23 constants: single intentional copy of src/modem/v23.ts (design.md, "Constants").
// ---------------------------------------------------------------------------------------------
export const V23 = Object.freeze({
  forward: Object.freeze({ id: 'forward', baud: 1200, markHz: 1300, spaceHz: 2100, mixHz: 1800, lowpassHz: 1100, thresholdHz: 1700 }),
  backward: Object.freeze({ id: 'backward', baud: 75, markHz: 390, spaceHz: 450, mixHz: 420, lowpassHz: 120, thresholdHz: 420 }),
  frame: Object.freeze({ dataBits: 7, parity: 'even', stopBits: 1, bitsPerFrame: 10 }),
});

/** The eight sampling rates of property M1. */
export const SAMPLE_RATES = Object.freeze([8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000]);

/** Decimation factor of the forward discriminator (design.md: D = max(1, floor(fs / 16000))). */
export function forwardDecimation(fs) {
  return Math.max(1, Math.floor(fs / 16000));
}

// ---------------------------------------------------------------------------------------------
// Seeded random numbers
// ---------------------------------------------------------------------------------------------

/** 32-bit FNV-1a hash of a string (UTF-16 code units, each split into two bytes). */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h ^= c & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= c >>> 8;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 step generator, used only to expand a 32-bit seed into the xoshiro128** state. */
function splitmix32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

function rotl(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** xoshiro128** (period 2^128 - 1). */
export class Xoshiro128ss {
  constructor(seed32) {
    const sm = splitmix32(seed32);
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    this.spare = NaN;
  }
  /** Next uint32. */
  nextU32() {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }
  /** Uniform double in [0, 1) with 53 random bits. */
  uniform() {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }
  /** Standard normal N(0, 1) (Box-Muller, polar-free form, pairs cached). */
  normal() {
    if (!Number.isNaN(this.spare)) {
      const v = this.spare;
      this.spare = NaN;
      return v;
    }
    let u1 = this.uniform();
    while (u1 === 0) u1 = this.uniform();
    const u2 = this.uniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    const t = 2 * Math.PI * u2;
    this.spare = r * Math.sin(t);
    return r * Math.cos(t);
  }
}

/**
 * Registry of named streams. Each key gives an independent xoshiro128** stream; the derived
 * 32-bit seeds are recorded so that they can be written to meta.json and checked for uniqueness.
 * Stream independence rests on distinct keys and a large-state generator (no quantified claim).
 */
export class StreamRegistry {
  constructor(template) {
    this.template = template;
    this.seeds = new Map();
  }
  stream(key) {
    if (this.seeds.has(key)) throw new Error(`stream key reused: ${key}`);
    const seed = fnv1a32(key);
    this.seeds.set(key, seed);
    return new Xoshiro128ss(seed);
  }
  /** Throws if two keys produced the same 32-bit seed. */
  assertUniqueSeeds() {
    const seen = new Map();
    for (const [key, seed] of this.seeds) {
      if (seen.has(seed)) throw new Error(`seed collision 0x${seed.toString(16)}: "${seen.get(seed)}" and "${key}"`);
      seen.set(seed, key);
    }
    return this.seeds.size;
  }
  toJSON() {
    return {
      algorithm: 'xoshiro128** seeded by splitmix32(fnv1a32(streamKey)); normals by Box-Muller on 53-bit uniforms',
      keyTemplate: this.template,
      streams: this.seeds.size,
      uniqueSeeds: true,
      derivedSeeds: Object.fromEntries([...this.seeds].map(([k, s]) => [k, `0x${s.toString(16).padStart(8, '0')}`])),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

/** Kaiser stopband attenuation (dB) implied by beta (inverse of beta = 0.1102 (A - 8.7)). */
export function kaiserAttenuationDb(beta) {
  return beta / 0.1102 + 8.7;
}

/**
 * Number of taps (odd) for a window and a transition width.
 * Hamming 3.3 fs / df, Blackman 5.5 fs / df, Kaiser (A - 7.95) / (14.36 df / fs) + 1.
 */
export function tapCount(window, fs, transitionHz) {
  let n;
  if (window === 'hamming') n = Math.ceil((3.3 * fs) / transitionHz);
  else if (window === 'blackman') n = Math.ceil((5.5 * fs) / transitionHz);
  else if (window.startsWith('kaiser')) {
    const beta = Number(window.slice(6));
    n = Math.ceil((kaiserAttenuationDb(beta) - 7.95) / ((14.36 * transitionHz) / fs)) + 1;
  } else throw new Error(`unknown window ${window}`);
  return n % 2 === 1 ? n : n + 1;
}

/** Zeroth-order modified Bessel function of the first kind (power series; fine for |x| < 700). */
export function besselI0(x) {
  const y = (x * x) / 4;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 1000; k++) {
    term *= y / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

function windowValue(window, k, n) {
  const m = n - 1;
  if (window === 'hamming') return 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / m);
  if (window === 'blackman') return 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / m) + 0.08 * Math.cos((4 * Math.PI * k) / m);
  if (window.startsWith('kaiser')) {
    const beta = Number(window.slice(6));
    const r = (2 * k) / m - 1;
    return besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
  }
  throw new Error(`unknown window ${window}`);
}

/**
 * Windowed-sinc low-pass with its -6 dB point at cutoffHz, normalized to DC gain 1 (sum h = 1).
 * Returns Float64Array of odd length; group delay (n - 1) / 2 samples.
 */
export function designLowpass({ fs, cutoffHz, transitionHz, window }) {
  const n = tapCount(window, fs, transitionHz);
  const h = new Float64Array(n);
  const mid = (n - 1) / 2;
  const fc = cutoffHz / fs;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const x = k - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    h[k] = sinc * windowValue(window, k, n);
    sum += h[k];
  }
  for (let k = 0; k < n; k++) h[k] /= sum;
  return h;
}

/** Exact DTFT of real taps at frequency fHz: returns { re, im, mag }. */
export function dtft(h, fs, fHz) {
  const w = (2 * Math.PI * fHz) / fs;
  let re = 0;
  let im = 0;
  for (let k = 0; k < h.length; k++) {
    re += h[k] * Math.cos(w * k);
    im -= h[k] * Math.sin(w * k);
  }
  return { re, im, mag: Math.hypot(re, im) };
}

export function toDb(mag) {
  return 20 * Math.log10(Math.max(mag, 1e-300));
}

/** Two-sided equivalent noise bandwidth of a complex low-pass: B_n = fs * sum(h^2) / (sum h)^2 (D4). */
export function noiseBandwidthHz(h, fs) {
  let s = 0;
  let s2 = 0;
  for (let k = 0; k < h.length; k++) {
    s += h[k];
    s2 += h[k] * h[k];
  }
  return (fs * s2) / (s * s);
}

export function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** In-place iterative radix-2 FFT on (re, im) Float64Arrays of power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Magnitude response of real taps on a uniform grid via a zero-padded FFT.
 * Returns { freqHz: Float64Array (0 .. fs/2), mag: Float64Array, stepHz }.
 */
export function magnitudeGrid(h, fs, maxStepHz = 2) {
  const nfft = nextPow2(Math.max(4 * h.length, Math.ceil(fs / maxStepHz)));
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  re.set(h);
  fft(re, im);
  const half = nfft / 2;
  const freqHz = new Float64Array(half + 1);
  const mag = new Float64Array(half + 1);
  for (let i = 0; i <= half; i++) {
    freqHz[i] = (i * fs) / nfft;
    mag[i] = Math.hypot(re[i], im[i]);
  }
  return { freqHz, mag, stepHz: fs / nfft };
}

// ---------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------

/**
 * Wilson score interval. Single implementation for every confidence level (P1, P3):
 * bits = 0 gives [0, 1]; invalid arguments (non-integer counts, errors outside [0, bits], z <= 0)
 * give NaN bounds and never throw.
 */
export function wilsonInterval(errors, bits, z) {
  const bad = { lo: NaN, hi: NaN };
  if (!Number.isInteger(errors) || !Number.isInteger(bits) || !(z > 0) || !Number.isFinite(z)) return bad;
  if (bits < 0 || errors < 0 || errors > bits) return bad;
  if (bits === 0) return { lo: 0, hi: 1 };
  const n = bits;
  const p = errors / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, (centre - half) / denom), hi: Math.min(1, (centre + half) / denom) };
}

/** Standard normal quantile (Acklam's rational approximation refined by one Halley step). */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q;
  let x;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Complementary error function (Numerical Recipes erfcc, relative error < 1.2e-7, then refined). */
export function erfc(x) {
  // Continued-fraction / series hybrid with ~1e-15 accuracy.
  const ax = Math.abs(x);
  let r;
  if (ax < 2.5) {
    // erf series
    let sum = ax;
    let term = ax;
    const x2 = ax * ax;
    for (let n = 1; n < 200; n++) {
      term *= -x2 / n;
      const t = term / (2 * n + 1);
      sum += t;
      if (Math.abs(t) < 1e-17 * Math.abs(sum)) break;
    }
    r = 1 - (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    // Lentz continued fraction for erfc
    let f = ax;
    let C = ax;
    let D = 0;
    for (let n = 1; n < 500; n++) {
      const an = n / 2;
      D = ax + an * D;
      D = D === 0 ? 1e-300 : 1 / D;
      C = ax + an / C;
      if (C === 0) C = 1e-300;
      const delta = C * D;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-16) break;
    }
    r = Math.exp(-ax * ax) / (f * Math.sqrt(Math.PI));
  }
  return x >= 0 ? r : 2 - r;
}

/** Gaussian tail Qg(x) = 0.5 erfc(x / sqrt 2). Not the Marcum function. */
export function gaussianTailQg(x) {
  return 0.5 * erfc(x / Math.SQRT2);
}

/**
 * Marcum Q function of order 1, Q1(a, b) = integral_b^inf x exp(-(x^2 + a^2) / 2) I0(a x) dx,
 * evaluated as a Poisson mixture of Gamma tails (all terms positive):
 *   Q1(a, b) = sum_k Pois(k; a^2/2) * exp(-b^2/2) * sum_{m=0..k} (b^2/2)^m / m!
 */
export function marcumQ1(a, b) {
  if (!(a >= 0) || !(b >= 0)) return NaN;
  const lam = (a * a) / 2;
  const x = (b * b) / 2;
  const kMax = Math.ceil(lam + 40 * Math.sqrt(lam) + 60);
  let pois = Math.exp(-lam); // Pois(0)
  let gamTerm = Math.exp(-x); // x^0/0! e^-x
  let gamTail = gamTerm; // P(Gamma(1) > x) = sum_{m<=0}
  let sum = pois * gamTail;
  for (let k = 1; k <= kMax; k++) {
    pois *= lam / k;
    gamTerm *= x / k;
    gamTail += gamTerm;
    sum += pois * Math.min(1, gamTail);
  }
  return Math.min(1, sum);
}

/** Reference: Marcum Q1 by direct numerical integration (Simpson), for cross-checks only. */
export function marcumQ1Integral(a, b, steps = 200000) {
  const hiLimit = Math.max(a, b) + 40;
  const h = (hiLimit - b) / steps;
  // integrand with exp(-(x-a)^2/2) scaling handled directly; values here are moderate.
  const f = (x) => x * Math.exp(-(x * x + a * a) / 2) * besselI0(a * x);
  let s = f(b) + f(hiLimit);
  for (let i = 1; i < steps; i++) s += f(b + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/**
 * Reference BER of non-coherent binary signals with correlation rho (envelope detection):
 * P_b = marcumQ1(a, b) - 0.5 exp(-(a^2 + b^2)/2) I0(a b),
 * a, b = sqrt((Eb/N0)/2 * (1 -/+ sqrt(1 - |rho|^2))).
 */
export function berNoncoherentCorrelated(ebN0Lin, rhoAbs) {
  const s = Math.sqrt(1 - rhoAbs * rhoAbs);
  const a = Math.sqrt((ebN0Lin / 2) * (1 - s));
  const b = Math.sqrt((ebN0Lin / 2) * (1 + s));
  return marcumQ1(a, b) - 0.5 * Math.exp(-(a * a + b * b) / 2) * besselI0(a * b);
}

/** |rho| of the forward channel: |sin(pi h) / (pi h)|, h = (space - mark) / baud. */
export function forwardRhoAbs() {
  const h = (V23.forward.spaceHz - V23.forward.markHz) / V23.forward.baud;
  return Math.abs(Math.sin(Math.PI * h) / (Math.PI * h));
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export function gitCommit() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: HERE, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    // Only the experiment sources count; generated results/ files do not make the tree dirty.
    const dirty = execSync('git status --porcelain -- . ":(exclude)results"', { cwd: HERE, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return dirty ? `${sha}+uncommitted` : sha;
  } catch {
    return 'unknown';
  }
}

/** Write results/<id>.csv from an array of flat objects (same keys). */
export function writeCsv(id, rows) {
  mkdirSync(RESULTS, { recursive: true });
  if (rows.length === 0) {
    writeFileSync(join(RESULTS, `${id}.csv`), '');
    return;
  }
  const keys = Object.keys(rows[0]);
  const esc = (v) => {
    const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toPrecision(10)) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))];
  writeFileSync(join(RESULTS, `${id}.csv`), lines.join('\n') + '\n');
}

/** Write results/<id>.meta.json. Always kind "simulation". */
export function writeMeta(id, meta) {
  mkdirSync(RESULTS, { recursive: true });
  const full = {
    id,
    kind: 'simulation',
    note: 'Simulation result. Never to be reported as a hardware measurement.',
    node: process.version,
    commit: gitCommit(),
    date: new Date().toISOString(),
    ...meta,
  };
  writeFileSync(join(RESULTS, `${id}.meta.json`), JSON.stringify(full, null, 2) + '\n');
}

// ---------------------------------------------------------------------------------------------
// Self-checks (run: node prototypes/dsp/lib.mjs)
// ---------------------------------------------------------------------------------------------

export function selfChecks() {
  const out = [];
  const check = (name, ok, detail) => out.push({ name, ok, detail });

  for (const window of ['hamming', 'blackman', 'kaiser6', 'kaiser8']) {
    const h = designLowpass({ fs: 48000, cutoffHz: 1100, transitionHz: 400, window });
    const dc = h.reduce((s, v) => s + v, 0);
    check(`FIR DC gain 1 (${window})`, Math.abs(dc - 1) < 1e-12, `sum h = ${dc}`);
  }
  let worst = 0;
  for (const b of [0, 0.3, 1, 2.5, 4, 7]) worst = Math.max(worst, Math.abs(marcumQ1(0, b) - Math.exp((-b * b) / 2)));
  check('marcumQ1 special values: Q1(0,b) = exp(-b^2/2)', worst < 1e-14, `max abs error ${worst.toExponential(2)}`);
  worst = 0;
  for (const a of [0, 0.5, 1, 3, 6]) worst = Math.max(worst, Math.abs(marcumQ1(a, 0) - 1));
  check('marcumQ1 special values: Q1(a,0) = 1', worst < 1e-14, `max abs error ${worst.toExponential(2)}`);
  worst = 0;
  for (const db of [0, 4, 8, 12]) {
    const g = 10 ** (db / 10);
    worst = Math.max(worst, Math.abs(berNoncoherentCorrelated(g, 0) - 0.5 * Math.exp(-g / 2)));
  }
  check('ber formula reduces to 0.5*exp(-Eb/(2*N0)) at rho=0', worst < 1e-12, `max abs error ${worst.toExponential(2)}`);
  const w = [wilsonInterval(0, 0, 1.96), wilsonInterval(1.5, 10, 1.96), wilsonInterval(11, 10, 1.96), wilsonInterval(1, 10, 0)];
  check(
    'wilsonInterval edge cases (bits=0 -> [0,1]; invalid -> NaN)',
    w[0].lo === 0 && w[0].hi === 1 && w.slice(1).every((x) => Number.isNaN(x.lo) && Number.isNaN(x.hi)),
    JSON.stringify(w),
  );
  const q = normalQuantile(0.975);
  check('normalQuantile(0.975) = 1.959963985', Math.abs(q - 1.959963984540054) < 1e-9, `${q}`);
  const reg = new StreamRegistry('selfcheck|i=<i>');
  for (let i = 0; i < 1000; i++) reg.stream(`selfcheck|i=${i}`);
  let unique = true;
  try {
    reg.assertUniqueSeeds();
  } catch {
    unique = false;
  }
  check('1000 derived stream seeds are unique', unique, '');
  const g = new Xoshiro128ss(12345);
  let m = 0;
  let v = 0;
  const n = 200000;
  for (let i = 0; i < n; i++) {
    const x = g.normal();
    m += x;
    v += x * x;
  }
  m /= n;
  v = v / n - m * m;
  check('normal() mean ~ 0 and variance ~ 1 (2e5 draws, 5 SE)', Math.abs(m) < 5 / Math.sqrt(n) && Math.abs(v - 1) < 5 * Math.sqrt(2 / n), `mean ${m.toFixed(5)} var ${v.toFixed(5)}`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = selfChecks();
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
  const failed = res.filter((r) => !r.ok).length;
  console.log(`${res.length - failed}/${res.length} self-checks passed`);
  process.exit(failed ? 1 : 0);
}
