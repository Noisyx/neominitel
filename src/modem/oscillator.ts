// Phase-continuous FSK synthesis (design.md "Modulator", requirements 2.2, 2.5, 2.6).
//
// Closed-form phase. For a piecewise-constant frequency (mark f_m, space f_s = f_m + df), the
// exact phase in cycles at time t is
//     c(t) = f_m * t + df * S(t),
// where S(t) is the time spent at space before t:
//     S(t) = (number of space bits before bit k) / baud + [b_k = space] * (t - t_k),
// for t in bit k, with t_k = t0 + k / baud computed directly (never by repeated addition).
// The sample is x[n] = A * w(n) * sin(2 pi * frac(c(n / fs))).
//
// c(t) is continuous in t, so the phase is exactly continuous at every bit boundary, including
// boundaries that fall between two samples, and no rounding error accumulates (the space-bit count
// is an integer). Assigning a sample that falls exactly on a boundary to either bit gives the same
// value. x[0] = 0 because c(0) = 0.
//
// Internal to the modem core: not exported by index.ts. No validation, no allocation: callers
// (modulator.ts) validate inputs and pass the output buffer.

const TWO_PI = 2 * Math.PI;

/** Bit timeline of one transmission. The line is at mark before t0 and after the last bit. */
export interface FskTimeline {
  sampleRate: number;
  baud: number;
  markHz: number;
  spaceHz: number;
  /** t0: duration of the leading mark idle, in seconds. Bit k starts at t0 + k / baud. */
  leadS: number;
  /** Line bits, 1 = mark, 0 = space (any non-zero value is mark). Inter-frame idle included. */
  bits: Uint8Array;
}

/**
 * Raised-cosine ramp-up of length `rampSamples`, evaluated `m` samples after the ramp start:
 * 0.5 * (1 - cos(pi * m / R)) for 0 <= m < R, and 1 for m >= R. With R <= 0 there is no ramp (1).
 * So w(0) = 0 and w(R) = 1, and w(m) + w(R - m) = 1.
 */
export function raisedCosine(m: number, rampSamples: number): number {
  if (rampSamples <= 0 || m >= rampSamples) return 1;
  if (m <= 0) return 0;
  return 0.5 * (1 - Math.cos((Math.PI * m) / rampSamples));
}

/**
 * Envelope of a burst of `length` samples with a ramp-up of `rampIn` samples at the start and a
 * ramp-down of `rampOut` samples ending on the last sample (so the last sample is 0 when
 * rampOut >= 1). When the two ramps overlap, the smaller value is used.
 */
export function envelope(n: number, length: number, rampIn: number, rampOut: number): number {
  const up = raisedCosine(n, rampIn);
  const down = raisedCosine(length - 1 - n, rampOut);
  return up < down ? up : down;
}

/**
 * Fills the whole `out` buffer with the FSK signal of `timeline`, peak amplitude `amplitude`,
 * ramp-up of `rampInSamples` at the start of the buffer and ramp-down of `rampOutSamples` ending
 * on its last sample. Preconditions (checked by the caller): finite positive sampleRate and baud,
 * leadS >= 0, 0 <= amplitude <= 1, ramps >= 0.
 */
export function renderFsk(
  out: Float32Array,
  timeline: FskTimeline,
  amplitude: number,
  rampInSamples: number,
  rampOutSamples: number,
): void {
  const { sampleRate, baud, markHz, spaceHz, leadS, bits } = timeline;
  const deltaHz = spaceHz - markHz;
  const nBits = bits.length;
  const length = out.length;

  let bitIndex = 0; // bits [0, bitIndex) are fully in the past
  let spaceBits = 0; // number of space bits among bits [0, bitIndex)

  for (let n = 0; n < length; n++) {
    const t = n / sampleRate;
    let k = Math.floor((t - leadS) * baud);
    if (k < 0) k = 0;
    if (k > nBits) k = nBits;
    while (bitIndex < k) {
      if (bits[bitIndex] === 0) spaceBits++;
      bitIndex++;
    }
    let spaceTime = spaceBits / baud;
    if (t >= leadS && bitIndex < nBits && bits[bitIndex] === 0) {
      spaceTime += t - (leadS + bitIndex / baud);
    }
    const cycles = markHz * t + deltaHz * spaceTime;
    const phase = TWO_PI * (cycles - Math.floor(cycles));
    out[n] = amplitude * envelope(n, length, rampInSamples, rampOutSamples) * Math.sin(phase);
  }
}

/**
 * Writes a pure tone of `length` samples into out[offset .. offset + length), starting at phase 0,
 * with raised-cosine ramps of `rampSamples` at both ends (clamped to half the length).
 * Samples outside that range are left untouched.
 */
export function renderTone(
  out: Float32Array,
  offset: number,
  length: number,
  sampleRate: number,
  freqHz: number,
  amplitude: number,
  rampSamples: number,
): void {
  const ramp = Math.min(rampSamples, Math.floor(length / 2));
  for (let i = 0; i < length; i++) {
    const cycles = (freqHz * i) / sampleRate;
    const phase = TWO_PI * (cycles - Math.floor(cycles));
    out[offset + i] = amplitude * envelope(i, length, ramp, ramp) * Math.sin(phase);
  }
}
