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
