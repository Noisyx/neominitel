// Signal quality (requirement 9, design.md "Quality (M2M4 estimator)"). Pure helpers used by the
// demodulator; conventions of docs/math.md section 2 (A7): gamma_band = P / (N0 B_n),
// gamma_3k = gamma_band B_n / 3000, Eb/N0 = gamma_band B_n / R.
import { SNR_REFERENCE_BAND_HZ } from './v23';

export interface M2M4Estimate {
  /** Signal power S, 0 when the moments give no signal. */
  signal: number;
  /** Noise power N = M2 - S. */
  noise: number;
  /** S / N, linear: 0 when S = 0 (noise only), +Infinity when N <= 0. */
  snr: number;
}

/**
 * M2M4 estimator with the signal's envelope kurtosis k_s = E|s|^4 / (E|s|^2)^2, for a signal plus
 * proper complex Gaussian noise (E|n|^4 = 2 N^2): M2 = S + N and M4 = k_s S^2 + 4 S N + 2 N^2, so
 * S^2 = (2 M2^2 - M4) / (2 - k_s) and N = M2 - S. k_s = 1 (constant envelope) is the plain
 * estimator S = sqrt(2 M2^2 - M4). Requires 1 <= k_s < 2.
 */
export function m2m4(m2: number, m4: number, kurtosis = 1): M2M4Estimate {
  const s2 = (2 * m2 * m2 - m4) / (2 - kurtosis);
  if (!(s2 > 0) || !(m2 > 0)) return { signal: 0, noise: Math.max(0, m2), snr: 0 };
  const signal = Math.sqrt(s2);
  const noise = m2 - signal;
  return { signal, noise, snr: noise > 0 ? signal / noise : Infinity };
}

/** 10 log10(x): -Infinity for 0, +Infinity for +Infinity. */
export function toDb(x: number): number {
  return 10 * Math.log10(x);
}

export interface SnrReport {
  snrBandDb: number;
  snr3kDb: number;
  ebN0Db: number;
}

/**
 * gamma_band (linear) converted with the two-sided noise bandwidth B_n of the low-pass and the
 * bit rate: gamma_3k = gamma_band B_n / 3000, Eb/N0 = gamma_band B_n / baud (R5).
 */
export function snrReport(snrBand: number, noiseBandwidthHz: number, baud: number): SnrReport {
  const band = toDb(snrBand);
  return {
    snrBandDb: band,
    snr3kDb: band + toDb(noiseBandwidthHz / SNR_REFERENCE_BAND_HZ),
    ebN0Db: band + toDb(noiseBandwidthHz / baud),
  };
}

/**
 * Fraction of parity errors among the last `window` frames decided strictly before `before`;
 * 0 when there is none. `frames` are in decision order.
 */
export function parityErrorRate(frames: readonly { t: number; parityOk: boolean }[], before: number, window: number): number {
  let n = 0;
  let bad = 0;
  for (let i = frames.length - 1; i >= 0 && n < window; i--) {
    if (frames[i].t >= before) continue;
    n++;
    if (!frames[i].parityOk) bad++;
  }
  return n > 0 ? bad / n : 0;
}
