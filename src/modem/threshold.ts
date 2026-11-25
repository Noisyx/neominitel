// Bit decision threshold and soft value (requirements 7.1 to 7.4, design.md "Threshold").
// Fixed threshold (task 6) and decision-directed adaptive threshold (task 8).
import type { ChannelSpec } from './v23';

/** Fixed threshold of a channel: the midpoint of the nominal tones (1700 Hz forward). */
export function fixedThresholdHz(spec: ChannelSpec): number {
  return spec.thresholdHz;
}

/**
 * Soft value s = (f - theta) / ((spaceHz - markHz) / 2), in double precision.
 * s < 0 is mark (1), s > 0 is space (0); |s| is the confidence. With theta at the midpoint,
 * the nominal mark tone gives s = -1 and the nominal space tone s = +1.
 */
export function softValue(fHz: number, thresholdHz: number, spec: ChannelSpec): number {
  return (fHz - thresholdHz) / ((spec.spaceHz - spec.markHz) / 2);
}

/** Smoothing factor of the decision-directed update (design.md "Threshold"). */
export const ADAPTIVE_ALPHA = 0.05;
/** Duration of idle carrier averaged to initialise the mark estimate (design.md "Threshold"). */
export const ADAPTIVE_INIT_MS = 20;

export type ThresholdMode = 'fixed' | 'adaptive';

/** Threshold in use and the tone estimates behind it, as reported in `diag`. */
export interface ThresholdState {
  thresholdHz: number;
  markHz: number;
  spaceHz: number;
}

/**
 * Threshold source shared by the UART and the demodulator.
 *
 * `fixed`: theta = thresholdHz, mark and space are the nominal tones; nothing is learnt.
 * `adaptive` (decision-directed two-means): mu_mark is initialised by `initMark` from the mean
 * frequency of the first 20 ms of idle carrier, mu_space = mu_mark + (spaceHz - markHz); after
 * each decided bit, `observeBit` updates the matching estimate, mu <- (1 - alpha) mu + alpha f.
 * theta = (mu_mark + mu_space) / 2 and the estimated offset is mu_mark - markHz. Until `initMark`
 * is called, the nominal values are used. Decision-directed updates happen only in adaptive mode,
 * so the fixed path is unchanged and a later switch to adaptive starts from the idle estimate.
 */
export interface ThresholdSource {
  mode: ThresholdMode;
  readonly initialised: boolean;
  /** Threshold used for decisions now. */
  thresholdHz(): number;
  /** Values reported in diag: the nominal ones in fixed mode, the estimates in adaptive mode. */
  state(): ThresholdState;
  initMark(meanHz: number): void;
  /** One decided line bit: 1 = mark, 0 = space, with the mean frequency over its window. */
  observeBit(bit: number, meanHz: number): void;
  /** Forgets the estimates (new transmission: carrier drop or reset). The mode is kept. */
  clear(): void;
}

export function createThresholdSource(spec: ChannelSpec, mode: ThresholdMode): ThresholdSource {
  const gap = spec.spaceHz - spec.markHz;
  let muMark = spec.markHz;
  let muSpace = spec.spaceHz;
  let initialised = false;
  const source: ThresholdSource = {
    mode,
    get initialised() {
      return initialised;
    },
    thresholdHz(): number {
      return source.mode === 'adaptive' && initialised ? (muMark + muSpace) / 2 : spec.thresholdHz;
    },
    state(): ThresholdState {
      if (source.mode === 'fixed' || !initialised) {
        return { thresholdHz: spec.thresholdHz, markHz: spec.markHz, spaceHz: spec.spaceHz };
      }
      return { thresholdHz: (muMark + muSpace) / 2, markHz: muMark, spaceHz: muSpace };
    },
    initMark(meanHz: number): void {
      if (!Number.isFinite(meanHz)) return;
      muMark = meanHz;
      muSpace = meanHz + gap;
      initialised = true;
    },
    observeBit(bit: number, meanHz: number): void {
      if (source.mode !== 'adaptive' || !initialised || !Number.isFinite(meanHz)) return;
      if (bit === 1) muMark = (1 - ADAPTIVE_ALPHA) * muMark + ADAPTIVE_ALPHA * meanHz;
      else muSpace = (1 - ADAPTIVE_ALPHA) * muSpace + ADAPTIVE_ALPHA * meanHz;
    },
    clear(): void {
      muMark = spec.markHz;
      muSpace = spec.spaceHz;
      initialised = false;
    },
  };
  return source;
}
