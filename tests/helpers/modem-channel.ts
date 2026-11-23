import { createRng } from './rng';

export type AwgnOptions =
  | {
      sampleRate: number;
      ebN0Db: number;
      baud?: number; // default 1200 (forward channel line bit rate)
      signalPower?: number; // optional override; if omitted, measured mean square of signal
      seed?: number;
    }
  | {
      sampleRate: number;
      snrDb: number;
      bandwidthHz?: number; // reference noise bandwidth (default 3000 Hz for γ_3k, or B_n for γ_band)
      signalPower?: number;
      seed?: number;
    };

/**
 * Computes the mean square power P_s = (1/N) * sum(x[n]^2) of a real signal.
 */
export function measureSignalPower(signal: Float32Array): number {
  if (signal.length === 0) {
    return 0;
  }
  let sumSq = 0;
  for (let i = 0; i < signal.length; i++) {
    const s = signal[i];
    sumSq += s * s;
  }
  return sumSq / signal.length;
}

/**
 * Adds white Gaussian noise following the shared A7 convention:
 * - One-sided noise PSD: N0 = P_s / (baud * (Eb/N0)) or N0 = P_s / (B_Hz * SNR)
 * - Real sample variance over Nyquist band [0, fs/2]: sigma^2 = N0 * fs / 2
 */
export function awgn(signal: Float32Array, options: AwgnOptions): Float32Array {
  const { sampleRate } = options;
  const seed = options.seed ?? 12345;
  const rng = createRng(seed);
  const pSignal = options.signalPower ?? measureSignalPower(signal);

  let n0: number;
  if ('ebN0Db' in options) {
    const baud = options.baud ?? 1200;
    const ebN0Linear = Math.pow(10, options.ebN0Db / 10);
    n0 = pSignal / (baud * ebN0Linear);
  } else {
    const bandwidthHz = options.bandwidthHz ?? 3000;
    const snrLinear = Math.pow(10, options.snrDb / 10);
    n0 = pSignal / (bandwidthHz * snrLinear);
  }

  const sigma = Math.sqrt((n0 * sampleRate) / 2);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = signal[i] + sigma * rng.nextGaussian();
  }
  return out;
}

export interface ResampleOptions {
  /**
   * Ratio `outputSampleRate / inputSampleRate` (or `1 + clockOffset` for clock drift).
   * For a transmitter clock offset of +epsilon, each bit is slightly shorter,
   * which corresponds to `ratio = 1 / (1 + epsilon)`.
   */
  ratio: number;
  /** Half-width of the Hamming-windowed sinc kernel in input zero-crossings (default 24). */
  halfWidth?: number;
}

function sinc(x: number): number {
  if (Math.abs(x) < 1e-12) {
    return 1.0;
  }
  const pix = Math.PI * x;
  return Math.sin(pix) / pix;
}

/**
 * Windowed-sinc fractional resampler (Hamming window).
 * Given `ratio = fs_out / fs_in`, output sample `m` is interpolated at input index `t = m / ratio`.
 */
export function resample(
  signal: Float32Array,
  options: ResampleOptions | number,
): Float32Array {
  const ratio = typeof options === 'number' ? options : options.ratio;
  const halfWidth = typeof options === 'number' ? 24 : (options.halfWidth ?? 24);

  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(`Invalid resample ratio: ${ratio}`);
  }
  if (signal.length === 0) {
    return new Float32Array(0);
  }

  const outLength = Math.max(1, Math.round(signal.length * ratio));
  const out = new Float32Array(outLength);
  const cutoff = Math.min(1.0, ratio);
  const support = halfWidth / cutoff;

  for (let m = 0; m < outLength; m++) {
    const t = m / ratio;
    const kMin = Math.max(0, Math.ceil(t - support));
    const kMax = Math.min(signal.length - 1, Math.floor(t + support));

    let acc = 0;
    let weightSum = 0;
    for (let k = kMin; k <= kMax; k++) {
      const delta = t - k;
      const u = delta / support;
      if (Math.abs(u) <= 1) {
        const window = 0.54 + 0.46 * Math.cos(Math.PI * u);
        const h = cutoff * sinc(cutoff * delta) * window;
        acc += signal[k] * h;
        weightSum += h;
      }
    }
    out[m] = weightSum !== 0 ? acc / weightSum : 0;
  }

  return out;
}
