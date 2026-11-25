// Low-pass design and streaming decimating FIR (requirement 5.1, design.md "Discriminator").
// Pure and allocation-free per sample. All arithmetic in double precision.

/**
 * Number of taps of the Hamming windowed-sinc low-pass: ceil(3.3 * fs / transitionHz), made odd so
 * that the group delay (L - 1) / 2 is a whole number of samples. Same expression as
 * prototypes/dsp/lib.mjs tapCount('hamming', ...) used by experiment E1 (397 taps at 48 kHz).
 */
export function hammingTapCount(sampleRate: number, transitionHz: number): number {
  const n = Math.ceil((3.3 * sampleRate) / transitionHz);
  return n % 2 === 1 ? n : n + 1;
}

/**
 * Hamming windowed-sinc low-pass whose -6 dB point is `cutoffHz` (reading c1, decision U2):
 *   h[k] = 2 fc sinc(2 fc (k - M)) w[k],  fc = cutoffHz / fs,  M = (L - 1) / 2,
 *   w[k] = 0.54 - 0.46 cos(2 pi k / (L - 1)),
 * then normalised to DC gain 1 (sum h = 1). Symmetric, odd length, linear phase.
 */
export function designLowpass(sampleRate: number, cutoffHz: number, transitionHz: number): Float64Array {
  const n = hammingTapCount(sampleRate, transitionHz);
  const h = new Float64Array(n);
  const mid = (n - 1) / 2;
  const fc = cutoffHz / sampleRate;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const x = k - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    h[k] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (n - 1)));
    sum += h[k];
  }
  for (let k = 0; k < n; k++) h[k] /= sum;
  return h;
}

/** |H(f)| of real taps at fHz (exact DTFT). Even in f, since the taps are real. */
export function lowpassMagnitude(taps: Float64Array, sampleRate: number, fHz: number): number {
  const w = (2 * Math.PI * fHz) / sampleRate;
  let re = 0;
  let im = 0;
  for (let k = 0; k < taps.length; k++) {
    re += taps[k] * Math.cos(w * k);
    im -= taps[k] * Math.sin(w * k);
  }
  return Math.hypot(re, im);
}

/** Two-sided equivalent noise bandwidth of the complex low-pass: B_n = fs sum(h^2) / (sum h)^2. */
export function noiseBandwidthHz(taps: Float64Array, sampleRate: number): number {
  let s = 0;
  let s2 = 0;
  for (let k = 0; k < taps.length; k++) {
    s += taps[k];
    s2 += taps[k] * taps[k];
  }
  return (sampleRate * s2) / (s * s);
}

/**
 * Streaming FIR on a complex signal, computing only every D-th output (polyphase decimation:
 * the cost is L multiply-adds per kept output instead of per input).
 *
 * Input sample j (0-based since construction or reset) is written with `write`. When j + 1 is a
 * multiple of D, `write` returns true and `outRe` / `outIm` hold
 *   y[j] = sum_k h[k] x[j - k],   with x[i] = 0 for i < 0.
 * The history lives in a doubled ring buffer, so the dot product reads contiguous memory. The
 * output depends only on the input sequence, never on how the caller groups the writes.
 */
export class ComplexDecimatingFir {
  readonly taps: Float64Array;
  readonly decimation: number;
  outRe = 0;
  outIm = 0;
  private readonly bufRe: Float64Array;
  private readonly bufIm: Float64Array;
  private pos = 0;
  private phase = 0;

  constructor(taps: Float64Array, decimation: number) {
    if (taps.length === 0 || !Number.isInteger(decimation) || decimation < 1) {
      throw new RangeError('ComplexDecimatingFir: need at least one tap and an integer decimation >= 1');
    }
    this.taps = taps;
    this.decimation = decimation;
    this.bufRe = new Float64Array(2 * taps.length);
    this.bufIm = new Float64Array(2 * taps.length);
  }

  write(re: number, im: number): boolean {
    const h = this.taps;
    const n = h.length;
    const pos = this.pos;
    this.bufRe[pos] = re;
    this.bufRe[pos + n] = re;
    this.bufIm[pos] = im;
    this.bufIm[pos + n] = im;
    this.pos = pos + 1 === n ? 0 : pos + 1;
    if (++this.phase < this.decimation) return false;
    this.phase = 0;
    // Newest sample at index pos + n, oldest at pos + 1: y = sum_k h[k] buf[pos + n - k].
    const bRe = this.bufRe;
    const bIm = this.bufIm;
    const base = pos + n;
    let yr = 0;
    let yi = 0;
    for (let k = 0; k < n; k++) {
      yr += h[k] * bRe[base - k];
      yi += h[k] * bIm[base - k];
    }
    this.outRe = yr;
    this.outIm = yi;
    return true;
  }

  reset(): void {
    this.bufRe.fill(0);
    this.bufIm.fill(0);
    this.pos = 0;
    this.phase = 0;
    this.outRe = 0;
    this.outIm = 0;
  }
}
