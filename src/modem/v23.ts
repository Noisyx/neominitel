export type ChannelId = 'forward' | 'backward';

export interface ChannelSpec {
  id: ChannelId;
  baud: number;
  markHz: number;
  spaceHz: number;
  mixHz: number;
  lowpassHz: number;
  thresholdHz: number;
}

export const CHANNELS: Record<ChannelId, ChannelSpec> = {
  forward: {
    id: 'forward',
    baud: 1200,
    markHz: 1300,
    spaceHz: 2100,
    mixHz: 1800,
    lowpassHz: 1100,
    thresholdHz: 1700,
  },
  backward: {
    id: 'backward',
    baud: 75,
    markHz: 390,
    spaceHz: 450,
    mixHz: 420,
    lowpassHz: 120,
    thresholdHz: 420,
  },
} as const;

export const FRAME = {
  dataBits: 7,
  parity: 'even',
  stopBits: 1,
  bitsPerFrame: 10,
} as const;

export const SAMPLE_RATE_MIN_HZ = 8000;
export const SAMPLE_RATE_MAX_HZ = 96000;

/** Answer tone of the connection sequence (requirement 3.1). */
export const ANSWER_TONE_HZ = 2100;

/** DSP design parameters of a channel's discriminator (design.md "Discriminator"). */
export interface DiscriminatorParams {
  /** Transition width of the Hamming low-pass, centred on `lowpassHz` (the -6 dB point). */
  transitionHz: number;
  /** Target decimated rate: D = max(1, floor(fs / decimatedRateHz)). */
  decimatedRateHz: number;
}

/**
 * Discriminator parameters per channel (decision T5-3). Kept out of ChannelSpec, which is part of
 * the shared contract; these are DSP choices of the receiver, not V.23 line constants.
 */
export const DISCRIMINATOR: Record<ChannelId, DiscriminatorParams> = {
  forward: { transitionHz: 400, decimatedRateHz: 16000 },
  backward: { transitionHz: 60, decimatedRateHz: 2000 },
} as const;

/**
 * Carrier and answer-tone detection (design.md "Carrier and answer tone", decisions T7-1 and T7-3).
 * DSP choices of the receiver, outside ChannelSpec (same reason as DISCRIMINATOR).
 */
export const CARRIER = {
  /** Default of DemodOptions.carrierOnDbfs: carrier on above this level, off 3 dB below. */
  onDbfs: -45,
  hysteresisDb: 3,
  /** Power is averaged over this window. */
  windowMs: 10,
  /** The level must stay above the on threshold this long before `carrier` on. */
  onHoldMs: 20,
  /** The level must stay below the off threshold this long before `carrier` off. */
  offHoldMs: 50,
} as const;

/** One-sided reference band of γ_3k, the default SNR (docs/math.md D5). */
export const SNR_REFERENCE_BAND_HZ = 3000;

/**
 * Line simulator design choices (design.md "Line simulator API", task 9). DSP choices of the test
 * channel, outside ChannelSpec (same reason as DISCRIMINATOR).
 */
export const LINE_SIMULATOR = {
  /** Transition width of the Hamming-windowed Hilbert FIR (SSB frequency offset). */
  hilbertTransitionHz: 300,
  /** Half-width, in input samples, of the windowed-sinc kernel of the clock resampler. */
  resamplerHalfWidth: 16,
  /** Largest accepted |clockPpm| (10 %). */
  maxClockPpm: 100_000,
  /** Largest accepted number of hum harmonics. */
  maxHarmonics: 20,
  /** Largest accepted burst duration. */
  maxBurstMs: 10_000,
} as const;

export const ANSWER_TONE = {
  /** Goertzel block length. `connect` needs durationMs / blockMs consecutive tone blocks. */
  blockMs: 20,
  /** A block is a tone when its 2100 Hz power is at least this fraction of the block power. */
  powerFraction: 0.5,
  /** Continuous tone required before `connect` (requirement 3.3). */
  durationMs: 500,
} as const;
