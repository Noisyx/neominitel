import type { ChannelId, ChannelSpec } from './v23';

export type { ChannelId, ChannelSpec };

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
  threshold?: 'fixed' | 'adaptive'; // see "Threshold mode" in design.md ('fixed' required until task 8)
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
  nonFiniteCount: number;
  freqHz: Float32Array;
  decimation: number;
  bitWindows: [number, number][];
  thresholdHz: number;
  markHz: number;
  spaceHz: number;
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

// The line simulator types (ChannelParams, LineChannel, HumParams, BurstParams) and the PN9/BER
// types (BerSnapshot, BerCounter) are defined with their implementations in channel.ts (task 9)
// and prbs.ts (task 10), as specified in design.md. They are not declared here before they exist.
