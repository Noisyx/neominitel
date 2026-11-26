import { CHANNELS, type DiagEvent } from '../../modem';
import { FFT_SIZE, SPECTRUM_BINS } from '../../workers/fft512';

export const WATERFALL_MAX_HZ = 3000;
export const WATERFALL_HISTORY_ROWS = 72;
export const FREQ_RING_CAPACITY = 16384;
export const MAX_STORED_BIT_WINDOWS = 120;

export interface EyeTrace {
  /** Normalized horizontal coordinate in `[0, 2]` (2-bit span centered on `[0.5, 1.5]`). */
  xNorm: Float32Array;
  /** Instantaneous frequency in Hz along the 2-bit span. */
  freqHz: Float32Array;
}

export interface HudSignalBuffer {
  version: number;
  sampleRate: number;
  decimation: number;
  thresholdHz: number;
  markHz: number;
  spaceHz: number;
  nonFiniteCount: number;
  peakWaterfallHz: number;
  peakWaterfallDb: number;
  waterfallRows: Float32Array[];
  /** Monotonic buffer of recent `(tSample, freqHz)` points from `DiagEvent`. */
  samplesT: Float64Array;
  samplesF: Float32Array;
  sampleCount: number;
  bitWindows: [number, number][];
}

export function createHudSignalBuffer(): HudSignalBuffer {
  return {
    version: 0,
    sampleRate: 48000,
    decimation: 3,
    thresholdHz: CHANNELS.forward.thresholdHz,
    markHz: CHANNELS.forward.markHz,
    spaceHz: CHANNELS.forward.spaceHz,
    nonFiniteCount: 0,
    peakWaterfallHz: 0,
    peakWaterfallDb: -120,
    waterfallRows: [],
    samplesT: new Float64Array(FREQ_RING_CAPACITY),
    samplesF: new Float32Array(FREQ_RING_CAPACITY),
    sampleCount: 0,
    bitWindows: [],
  };
}

export function resetHudSignalBuffer(buf: HudSignalBuffer): void {
  buf.version++;
  buf.thresholdHz = CHANNELS.forward.thresholdHz;
  buf.markHz = CHANNELS.forward.markHz;
  buf.spaceHz = CHANNELS.forward.spaceHz;
  buf.nonFiniteCount = 0;
  buf.peakWaterfallHz = 0;
  buf.peakWaterfallDb = -120;
  buf.waterfallRows.length = 0;
  buf.sampleCount = 0;
  buf.bitWindows.length = 0;
}

/**
 * Maps a frequency `hz` in `[0, WATERFALL_MAX_HZ]` to its fractional bin index in `spectrumDb`.
 */
export function hzToSpectrumBin(hz: number, sampleRate: number): number {
  if (sampleRate <= 0) return 0;
  const bin = (hz * FFT_SIZE) / sampleRate;
  return Math.max(0, Math.min(SPECTRUM_BINS - 1, bin));
}

/**
 * Pushes a 50 ms `DiagEvent` + 512-pt FFT `spectrumDb` into the mutable `HudSignalBuffer`
 * (kept outside React state so 20 Hz updates never trigger component re-renders).
 */
export function pushDiagToHudBuffer(
  buf: HudSignalBuffer,
  diag: DiagEvent,
  spectrumDb: Float32Array,
  sampleRate: number,
): void {
  buf.version++;
  buf.sampleRate = sampleRate > 0 ? sampleRate : buf.sampleRate;
  buf.decimation = Math.max(1, diag.decimation);
  buf.thresholdHz = diag.thresholdHz;
  buf.markHz = diag.markHz;
  buf.spaceHz = diag.spaceHz;
  buf.nonFiniteCount = diag.nonFiniteCount;

  // Store waterfall row & locate peak within 0..3000 Hz
  const maxBin = Math.min(
    spectrumDb.length - 1,
    Math.ceil(hzToSpectrumBin(WATERFALL_MAX_HZ, buf.sampleRate)),
  );
  let bestDb = -120;
  let bestBin = 0;
  for (let b = 1; b <= maxBin; b++) {
    if (spectrumDb[b] > bestDb) {
      bestDb = spectrumDb[b];
      bestBin = b;
    }
  }
  buf.peakWaterfallDb = bestDb;
  buf.peakWaterfallHz = Math.round((bestBin * buf.sampleRate) / FFT_SIZE);

  buf.waterfallRows.push(spectrumDb.slice());
  if (buf.waterfallRows.length > WATERFALL_HISTORY_ROWS) {
    buf.waterfallRows.shift();
  }

  // Append instantaneous frequency samples dated backwards from diag.atSample
  const n = diag.freqHz.length;
  if (n > 0) {
    // Detect demodulator reset (when diag.atSample jumps backwards)
    if (
      buf.sampleCount > 0 &&
      diag.atSample < buf.samplesT[buf.sampleCount - 1] - buf.sampleRate * 0.05
    ) {
      buf.sampleCount = 0;
      buf.bitWindows.length = 0;
    }

    const firstSampleT = diag.atSample - n * buf.decimation;
    if (n >= FREQ_RING_CAPACITY) {
      const startOffset = n - FREQ_RING_CAPACITY;
      for (let i = 0; i < FREQ_RING_CAPACITY; i++) {
        buf.samplesT[i] = firstSampleT + (startOffset + i) * buf.decimation;
        buf.samplesF[i] = diag.freqHz[startOffset + i];
      }
      buf.sampleCount = FREQ_RING_CAPACITY;
    } else {
      const overflow = buf.sampleCount + n - FREQ_RING_CAPACITY;
      if (overflow > 0) {
        buf.samplesT.copyWithin(0, overflow, buf.sampleCount);
        buf.samplesF.copyWithin(0, overflow, buf.sampleCount);
        buf.sampleCount -= overflow;
      }
      for (let i = 0; i < n; i++) {
        buf.samplesT[buf.sampleCount + i] = firstSampleT + i * buf.decimation;
        buf.samplesF[buf.sampleCount + i] = diag.freqHz[i];
      }
      buf.sampleCount += n;
    }
  }

  // Append decided bit windows and prune those older than our sample buffer
  if (diag.bitWindows.length > 0) {
    for (const w of diag.bitWindows) {
      buf.bitWindows.push([w[0], w[1]]);
    }
    if (buf.bitWindows.length > MAX_STORED_BIT_WINDOWS) {
      buf.bitWindows.splice(0, buf.bitWindows.length - MAX_STORED_BIT_WINDOWS);
    }
  }

  if (buf.sampleCount > 0 && buf.bitWindows.length > 0) {
    const oldestT = buf.samplesT[0];
    let drop = 0;
    while (drop < buf.bitWindows.length && buf.bitWindows[drop][1] < oldestT) {
      drop++;
    }
    if (drop > 0) {
      buf.bitWindows.splice(0, drop);
    }
  }
}

/**
 * Extracts 2-bit eye diagram traces (`[wStart - 0.5*T, wEnd + 0.5*T]` mapped to `[0, 2]`,
 * with the decided bit occupying `[0.5, 1.5]` and its central sampling window at `[0.75, 1.25]`).
 */
export function extractEyeTraces(
  buf: HudSignalBuffer,
  maxTraces = 24,
): EyeTrace[] {
  if (buf.sampleCount < 4 || buf.bitWindows.length === 0) {
    return [];
  }

  const traces: EyeTrace[] = [];
  const startIdx = Math.max(0, buf.bitWindows.length - maxTraces);

  for (let wIdx = startIdx; wIdx < buf.bitWindows.length; wIdx++) {
    const [w0, w1] = buf.bitWindows[wIdx];
    const bitPeriod = w1 - w0;
    if (bitPeriod <= 0) continue;

    const spanStart = w0 - 0.5 * bitPeriod;
    const spanEnd = w1 + 0.5 * bitPeriod;

    const xs: number[] = [];
    const ys: number[] = [];

    for (let i = 0; i < buf.sampleCount; i++) {
      const t = buf.samplesT[i];
      if (t < spanStart) continue;
      if (t > spanEnd) break;
      xs.push(((t - spanStart) / bitPeriod)); // in [0, 2]
      ys.push(buf.samplesF[i]);
    }

    if (xs.length >= 2) {
      traces.push({
        xNorm: Float32Array.from(xs),
        freqHz: Float32Array.from(ys),
      });
    }
  }

  return traces;
}

/**
 * Maps a spectrum level in dBFS (`[-95, -5]`) to a dark-room amber/phosphor RGB triple.
 */
export function spectrumDbToRgb(db: number): readonly [number, number, number] {
  const norm = Math.max(0, Math.min(1, (db + 90) / 84));
  if (norm < 0.35) {
    const k = norm / 0.35;
    return [
      Math.round(10 + 22 * k),
      Math.round(14 + 44 * k),
      Math.round(18 + 56 * k),
    ];
  }
  if (norm < 0.72) {
    const k = (norm - 0.35) / 0.37;
    return [
      Math.round(32 + 150 * k),
      Math.round(58 + 118 * k),
      Math.round(74 - 24 * k),
    ];
  }
  const k = (norm - 0.72) / 0.28;
  return [
    Math.round(182 + 68 * k),
    Math.round(176 + 68 * k),
    Math.round(50 + 130 * k),
  ];
}
