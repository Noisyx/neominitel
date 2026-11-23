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

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface ModulateOptions {
  sampleRate: number;
  channel?: ChannelId; // default 'forward'
  amplitude?: number; // default 0.5, max 1
  leadIdleMs?: number; // default 100
  tailIdleMs?: number; // default 50
  interFrameIdleBits?: number; // default 0
  rampMs?: number; // default 5
  bitErrors?: number[]; // TEST ONLY: indices of line bits to invert
}

export interface ConnectionSequenceOptions {
  sampleRate: number;
  answerToneMs?: number;
  silenceMs?: number;
  carrierMs?: number;
}

export interface DemodOptions {
  sampleRate: number;
  channel?: ChannelId;
  threshold?: 'fixed' | 'adaptive'; // default 'adaptive' ('fixed' until task 8)
  carrierOnDbfs?: number; // default -45, hysteresis 3 dB
}

export type QualityEvent = {
  type: 'quality';
  atSample: number;
  snrBandDb: number;
  snr3kDb: number;
  ebN0Db: number;
  parityErrorRate: number;
  offsetHz: number;
};

export type DiagEvent = {
  type: 'diag';
  atSample: number;
  freqHz: Float32Array;
  decimation: number;
  bitWindows: [number, number][];
  thresholdHz: number;
  markHz: number;
  spaceHz: number;
  nonFiniteCount: number;
};

export type DemodEvent =
  | { type: 'carrier'; on: boolean; atSample: number }
  | { type: 'connect'; atSample: number }
  | {
      type: 'char';
      value: number;
      parityOk: boolean;
      framingOk: boolean;
      atSample: number;
      minConfidence: number;
    }
  | QualityEvent
  | DiagEvent;

export interface StreamingDemodulator {
  push(chunk: Float32Array): DemodEvent[];
  flush(): DemodEvent[];
  reset(): void;
  setThresholdMode(m: 'fixed' | 'adaptive'): void;
}

export type ModemError =
  | { kind: 'byte-out-of-range'; index: number; value: number }
  | { kind: 'bad-sample-rate'; sampleRate: number }
  | { kind: 'bad-option'; option: string; reason: string }
  | { kind: 'wav'; reason: string };

export interface ChannelOptions {
  sampleRate: number;
  channel?: ChannelId;
  ebN0Db?: number | null;
  snr3kDb?: number | null;
  offsetHz?: number;
  clockPpm?: number;
  humAmplitude?: number;
  bursts?: { rateHz: number; durationMs: number; gainDb: number } | boolean;
  seed?: number;
}

export interface ChannelSimulator {
  process(chunk: Float32Array): Float32Array;
  setOptions(o: Partial<ChannelOptions>): void;
  reset(): void;
}

export interface BerSnapshot {
  bits: number;
  errors: number;
  ber: number;
  lo: number;
  hi: number;
  synced: boolean;
}

export interface BerCounter {
  pushBit(bit: 0 | 1, valid?: boolean): BerSnapshot;
  pushFrame(value: number, framingOk?: boolean): BerSnapshot;
  snapshot(): BerSnapshot;
  reset(): void;
}

export interface TheoryCurvePoint {
  ebN0Db: number;
  orthogonalBer: number;
  correlatedBer: number;
}
