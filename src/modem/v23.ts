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
