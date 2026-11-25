// Frequency discriminator: complex mix, low-pass + decimation, phase-difference frequency
// (requirements 5.1 to 5.4, design.md "Discriminator"). Internal to src/modem (decision T5-6).
import { ComplexDecimatingFir, designLowpass, noiseBandwidthHz } from './filters';
import { isValidSampleRate } from './modulator';
import type { ModemError, Result } from './types';
import { CHANNELS, DISCRIMINATOR, type ChannelId } from './v23';

/**
 * Mixer phase of input sample n, in cycles in [0, 1): frac(mixHz * n / fs).
 *
 * Closed form from the global sample index, so the phase never accumulates rounding and does not
 * depend on chunk boundaries. mixHz * n is an exact integer product for n < 2^53 / mixHz (for
 * integer mixHz), so the only rounding is the division: the error is at most about
 * (mixHz * n / fs) * 2^-53 cycles, i.e. 2e-8 cycles after 24 h at any rate.
 */
export function mixerPhaseCycles(n: number, mixHz: number, sampleRate: number): number {
  const c = (mixHz * n) / sampleRate;
  return c - Math.floor(c);
}

/** Frequency estimates produced by one `push`. */
export interface DiscriminatorOutput {
  /** Number of estimates in this block. */
  count: number;
  /**
   * Time of estimate 0 in input samples since reset, compensated: n - (L - 1) / 2 - D / 2, where
   * n is the input index at which it was computed. Estimate m is at firstTimeSamples + m * D.
   * NaN when count is 0.
   */
  firstTimeSamples: number;
  /** Instantaneous frequency, Hz. */
  freqHz: Float32Array;
  /** Filtered complex baseband z at the later of the two samples of each estimate (time + D / 2). */
  re: Float32Array;
  im: Float32Array;
}

export interface Discriminator {
  readonly sampleRate: number;
  readonly channel: ChannelId;
  readonly taps: Float64Array;
  readonly decimation: number;
  /** (L - 1) / 2 input samples. */
  readonly groupDelaySamples: number;
  readonly noiseBandwidthHz: number;
  /**
   * Estimates whose compensated time is >= this value use only real input (no zero history).
   * Equals (L - 1 + D) - (L - 1) / 2 - D / 2.
   */
  readonly settledTimeSamples: number;
  /** NaN or infinite input samples replaced by 0 since the last reset (decision T5-5). */
  readonly nonFiniteCount: number;
  push(chunk: Float32Array): DiscriminatorOutput;
  reset(): void;
}

/**
 * Creates the discriminator of a channel (default 'forward').
 *
 * Chain per input sample n (global index since reset): replace a non-finite sample by 0; mix,
 * z = x e^(-j 2 pi mixerPhaseCycles(n)); low-pass (Hamming, -6 dB at lowpassHz) keeping every
 * D-th output; then f[m] = mixHz + arg(z[m] conj z[m-1]) * (fs / D) / (2 pi), from the second
 * kept output on. Everything is computed in double precision; only the returned arrays are
 * Float32. `push` never throws.
 *
 * Errors: `bad-sample-rate` (not finite or outside 8 000..96 000 Hz; non-integer rates accepted),
 * `bad-option` "channel".
 */
export function createDiscriminator(
  sampleRate: number,
  channel: ChannelId = 'forward',
): Result<Discriminator, ModemError> {
  if (!isValidSampleRate(sampleRate)) {
    return { ok: false, error: { kind: 'bad-sample-rate', sampleRate } };
  }
  if (!Object.prototype.hasOwnProperty.call(CHANNELS, channel)) {
    return { ok: false, error: { kind: 'bad-option', option: 'channel', reason: `unknown channel "${String(channel)}"` } };
  }
  const spec = CHANNELS[channel];
  const params = DISCRIMINATOR[channel];
  const taps = designLowpass(sampleRate, spec.lowpassHz, params.transitionHz);
  const decimation = Math.max(1, Math.floor(sampleRate / params.decimatedRateHz));
  const fir = new ComplexDecimatingFir(taps, decimation);
  const groupDelay = (taps.length - 1) / 2;
  const timeOffset = groupDelay + decimation / 2;
  const mixHz = spec.mixHz;
  const hzPerRadian = sampleRate / decimation / (2 * Math.PI);
  const TWO_PI = 2 * Math.PI;

  let n = 0; // global input index since reset
  let hasPrev = false;
  let prevRe = 0;
  let prevIm = 0;
  let nonFinite = 0;
  let pending = 0; // inputs written since the last kept output, to size the output arrays

  const d: Discriminator = {
    sampleRate,
    channel,
    taps,
    decimation,
    groupDelaySamples: groupDelay,
    noiseBandwidthHz: noiseBandwidthHz(taps, sampleRate),
    settledTimeSamples: taps.length - 1 + decimation - timeOffset,
    get nonFiniteCount() {
      return nonFinite;
    },
    push(chunk: Float32Array): DiscriminatorOutput {
      const len = chunk.length;
      const maxOut = Math.floor((pending + len) / decimation);
      const freqHz = new Float32Array(maxOut);
      const re = new Float32Array(maxOut);
      const im = new Float32Array(maxOut);
      let count = 0;
      let firstTime = NaN;
      for (let i = 0; i < len; i++, n++) {
        let x = chunk[i];
        if (!Number.isFinite(x)) {
          x = 0;
          nonFinite++;
        }
        const theta = TWO_PI * mixerPhaseCycles(n, mixHz, sampleRate);
        if (!fir.write(x * Math.cos(theta), -x * Math.sin(theta))) continue;
        const yr = fir.outRe;
        const yi = fir.outIm;
        if (hasPrev) {
          // z[m] conj(z[m-1])
          const qr = yr * prevRe + yi * prevIm;
          const qi = yi * prevRe - yr * prevIm;
          if (count === 0) firstTime = n - timeOffset;
          freqHz[count] = mixHz + Math.atan2(qi, qr) * hzPerRadian;
          re[count] = yr;
          im[count] = yi;
          count++;
        }
        hasPrev = true;
        prevRe = yr;
        prevIm = yi;
      }
      pending = (pending + len) % decimation;
      return {
        count,
        firstTimeSamples: firstTime,
        freqHz: count === maxOut ? freqHz : freqHz.subarray(0, count),
        re: count === maxOut ? re : re.subarray(0, count),
        im: count === maxOut ? im : im.subarray(0, count),
      };
    },
    reset(): void {
      fir.reset();
      n = 0;
      hasPrev = false;
      prevRe = 0;
      prevIm = 0;
      nonFinite = 0;
      pending = 0;
    },
  };
  return { ok: true, value: d };
}
