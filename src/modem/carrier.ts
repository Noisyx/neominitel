// Carrier detect and answer-tone detect (requirements 3.3 and 8.3, design.md "Carrier and answer
// tone", decisions T7-1 and T7-3). Internal to src/modem.
import { ANSWER_TONE, ANSWER_TONE_HZ, CARRIER } from './v23';

/**
 * Carrier level in dBFS of a mean |z|^2, under the D6 reference (docs/math.md): 0 dBFS is a
 * full-scale real sine (peak 1, power 1/2), and a carrier gives mean |z|^2 = P/2 after the
 * gain-1 mixer, so the level is 10 log10(4 * mean |z|^2). A = 0.5 gives -6.02 dBFS.
 * A non-positive power (silence) is -Infinity.
 */
export function carrierLevelDbfs(meanPower: number): number {
  return meanPower <= 0 ? -Infinity : 10 * Math.log10(4 * meanPower);
}

export interface DetectorEstimate {
  /** Compensated time of the estimate, input samples since reset. */
  t: number;
  re: number;
  im: number;
}

export interface DetectorEvents {
  carrier: { on: boolean; atSample: number }[];
  connect: { atSample: number }[];
}

/**
 * Carrier and answer-tone detector.
 *
 * Carrier: mean |z|^2 of the settled discriminator estimates whose compensated time falls in
 * [k W, (k + 1) W), W = 10 ms. On when the level stays at or above `carrierOnDbfs` for 20 ms
 * (2 windows), off when it stays below `carrierOnDbfs - 3 dB` for 50 ms (5 windows). A window
 * with no estimate keeps the previous level. The decision is dated at the end of the window.
 *
 * Answer tone (decision T7-3): Goertzel at 2100 Hz over each 20 ms block of the raw input,
 * blocks aligned on absolute sample index. A block is a tone when its 2100 Hz power is at least
 * half the block's mean square and the block level (mean square / 2, the power a carrier of that
 * amplitude would show after the mixer) is at least `carrierOnDbfs`. `connect` is emitted once,
 * dated at the end of the 500th millisecond, and re-armed after one block that is not a tone.
 *
 * Time boundaries (M5): carrier windows are closed by estimate time, never by input index. The
 * discriminator delivers the estimate dated t only once input t + (L - 1)/2 + D/2 has been pushed,
 * so window k = [k W, (k + 1) W) is closed when an estimate dated (k + 1) W or later arrives: all
 * the estimates of that window are then present, whatever the chunk boundaries. Estimates arrive
 * in time order and every one is counted in its window. `closeUpTo` (flush) closes the windows
 * that end at or before the end of the real input, since no later estimate will come. The
 * answer-tone blocks run on the raw input and are aligned on the absolute input index.
 */
export function createDetector(sampleRate: number, decimation: number, carrierOnDbfs: number): {
  /**
   * `input` is the raw input starting at absolute index `inputStartIndex` (Goertzel; may be
   * empty). `estimates` are settled estimates in time order. When `closeUpTo` is given, the
   * windows ending at or before it are closed after the estimates are counted.
   */
  push(
    input: Float32Array,
    inputStartIndex: number,
    estimates: readonly DetectorEstimate[],
    closeUpTo?: number,
  ): DetectorEvents;
  /** Declares the carrier off at `atSample` if it is on (used by flush, decision T7-4). */
  forceOff(atSample: number): { on: boolean; atSample: number } | null;
  /**
   * Clears the detectors. `origin` (default 0) is the absolute input index the next samples start
   * at: after flush, time continues, so the windows and blocks stay on the absolute grid (the
   * answer-tone block containing `origin` restarts empty and is evaluated on its remaining part).
   */
  reset(origin?: number): void;
  readonly carrierOn: boolean;
} {
  const windowSamples = Math.max(decimation, Math.round((sampleRate * CARRIER.windowMs) / 1000));
  const onHold = Math.max(1, Math.round(CARRIER.onHoldMs / CARRIER.windowMs));
  const offHold = Math.max(1, Math.round(CARRIER.offHoldMs / CARRIER.windowMs));
  const offLevel = carrierOnDbfs - CARRIER.hysteresisDb;

  const blockSamples = Math.max(1, Math.round((sampleRate * ANSWER_TONE.blockMs) / 1000));
  const toneBlocksNeeded = Math.round(ANSWER_TONE.durationMs / ANSWER_TONE.blockMs);
  const omega = (2 * Math.PI * ANSWER_TONE_HZ) / sampleRate;
  const goertzelCoeff = 2 * Math.cos(omega);
  const goertzelSin = Math.sin(omega);

  let carrierOn = false;
  let aboveRun = 0;
  let belowRun = 0;
  let nextWindow = 0; // index of the next 10 ms window to close
  let winSum = 0;
  let winCount = 0;
  let lastLevel = -Infinity;

  let blockSumSq = 0;
  let g1 = 0;
  let g2 = 0;
  let blockFilled = 0;
  let toneRun = 0;
  let connectArmed = true;

  function closeWindow(events: DetectorEvents): void {
    const level = winCount > 0 ? carrierLevelDbfs(winSum / winCount) : lastLevel;
    lastLevel = level;
    const at = (nextWindow + 1) * windowSamples;
    if (!carrierOn) {
      aboveRun = level >= carrierOnDbfs ? aboveRun + 1 : 0;
      if (aboveRun >= onHold) {
        carrierOn = true;
        belowRun = 0;
        events.carrier.push({ on: true, atSample: at });
      }
    } else {
      belowRun = level < offLevel ? belowRun + 1 : 0;
      if (belowRun >= offHold) {
        carrierOn = false;
        aboveRun = 0;
        events.carrier.push({ on: false, atSample: at });
      }
    }
    winSum = 0;
    winCount = 0;
    nextWindow++;
  }

  function closeBlock(blockIndex: number, events: DetectorEvents): void {
    const real = g1 - goertzelCoeff * g2;
    const imag = g2 * goertzelSin;
    const tonePower = (real * real + imag * imag) / (blockFilled * blockFilled);
    const meanSquare = blockSumSq / blockFilled;
    const isTone =
      meanSquare > 0 &&
      tonePower >= ANSWER_TONE.powerFraction * meanSquare &&
      carrierLevelDbfs(meanSquare / 2) >= carrierOnDbfs;
    if (isTone) {
      toneRun++;
      if (connectArmed && toneRun >= toneBlocksNeeded) {
        events.connect.push({ atSample: (blockIndex + 1) * blockSamples });
        connectArmed = false;
      }
    } else {
      toneRun = 0;
      connectArmed = true;
    }
    g1 = 0;
    g2 = 0;
    blockSumSq = 0;
    blockFilled = 0;
  }

  return {
    get carrierOn() {
      return carrierOn;
    },
    push(
      input: Float32Array,
      inputStartIndex: number,
      estimates: readonly DetectorEstimate[],
      closeUpTo?: number,
    ): DetectorEvents {
      const events: DetectorEvents = { carrier: [], connect: [] };
      // Carrier windows, driven by estimate time only.
      for (const est of estimates) {
        // An estimate at or past the end of the open window proves that window is complete.
        while (est.t >= (nextWindow + 1) * windowSamples) closeWindow(events);
        winSum += est.re * est.re + est.im * est.im;
        winCount++;
      }
      if (closeUpTo !== undefined) {
        while ((nextWindow + 1) * windowSamples <= closeUpTo) closeWindow(events);
      }
      // Answer-tone blocks, driven by the absolute input index.
      for (let i = 0; i < input.length; i++) {
        const n = inputStartIndex + i;
        const x = Number.isFinite(input[i]) ? input[i] : 0;
        const g0 = x + goertzelCoeff * g1 - g2;
        g2 = g1;
        g1 = g0;
        blockSumSq += x * x;
        blockFilled++;
        if ((n + 1) % blockSamples === 0) closeBlock((n + 1) / blockSamples - 1, events);
      }
      return events;
    },
    forceOff(atSample: number): { on: boolean; atSample: number } | null {
      if (!carrierOn) return null;
      carrierOn = false;
      aboveRun = 0;
      belowRun = 0;
      return { on: false, atSample };
    },
    reset(origin = 0): void {
      carrierOn = false;
      aboveRun = 0;
      belowRun = 0;
      // Windows stay on the absolute grid: after flush, time continues from `origin`.
      nextWindow = Math.floor(origin / windowSamples);
      winSum = 0;
      winCount = 0;
      lastLevel = -Infinity;
      blockSumSq = 0;
      g1 = 0;
      g2 = 0;
      blockFilled = 0;
      toneRun = 0;
      connectArmed = true;
    },
  };
}
