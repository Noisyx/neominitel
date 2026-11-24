export * from './types';
export * from './v23';

import { CHANNELS, FRAME, SAMPLE_RATE_MAX_HZ, SAMPLE_RATE_MIN_HZ, type ChannelId } from './v23';
import type {
  BerSnapshot,
  BurstParams,
  ChannelParams,
  ConnectionSequenceOptions,
  DemodEvent,
  DemodOptions,
  HumParams,
  LineChannel,
  ModemError,
  ModulateOptions,
  Result,
  StreamingDemodulator,
} from './types';

interface ScheduledFrame {
  value: number;
  parityOk: boolean;
  framingOk: boolean;
  atSample: number;
}

interface FakeTransmissionRecord {
  sampleRate: number;
  channel: ChannelId;
  totalSamples: number;
  leadSamples: number;
  tailStartSample: number;
  frames: ScheduledFrame[];
  signatureSampleIndex: number;
  signatureSampleValue: number;
}

const recentTransmissions: FakeTransmissionRecord[] = [];
const MAX_RECENT_TRANSMISSIONS = 32;

function computeEvenParityBit(byte7: number): 0 | 1 {
  let ones = 0;
  for (let i = 0; i < 7; i++) {
    ones += (byte7 >> i) & 1;
  }
  return (ones % 2 === 0 ? 0 : 1) as 0 | 1;
}

function byteToFrameBits(byte7: number): number[] {
  const bits: number[] = [0]; // start bit (space = 0)
  for (let i = 0; i < 7; i++) {
    bits.push((byte7 >> i) & 1);
  }
  bits.push(computeEvenParityBit(byte7));
  bits.push(1); // stop bit (mark = 1)
  return bits;
}

function decodeFrameBits(bits: number[]): { value: number; parityOk: boolean; framingOk: boolean } {
  let value = 0;
  let weight = 0;
  for (let i = 0; i < 7; i++) {
    const bit = bits[1 + i] & 1;
    value |= bit << i;
    weight += bit;
  }
  const parityBit = bits[8] & 1;
  weight += parityBit;
  const parityOk = weight % 2 === 0;
  const framingOk = (bits[9] & 1) === 1;
  return { value, parityOk, framingOk };
}

/**
 * J1 scaffold modulator: validates inputs, synthesizes phase-continuous V.23 FSK audio
 * with exact cumulative timeline, and registers the frame schedule for the J1 fake demodulator.
 * Role B replaces this with the full `src/modem/modulator.ts` in Task 3.
 */
export function modulate(
  bytes: Uint8Array,
  o: ModulateOptions,
): Result<Float32Array, ModemError> {
  const { sampleRate } = o;
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < SAMPLE_RATE_MIN_HZ ||
    sampleRate > SAMPLE_RATE_MAX_HZ
  ) {
    return { ok: false, error: { kind: 'bad-sample-rate', sampleRate } };
  }

  const channelId: ChannelId = o.channel ?? 'forward';
  const spec = CHANNELS[channelId];
  if (!spec) {
    return {
      ok: false,
      error: { kind: 'bad-option', option: 'channel', reason: 'Unknown channel' },
    };
  }

  const amplitude = o.amplitude ?? 0.5;
  if (!Number.isFinite(amplitude) || amplitude <= 0 || amplitude > 1.0) {
    return {
      ok: false,
      error: {
        kind: 'bad-option',
        option: 'amplitude',
        reason: 'Amplitude must be in (0, 1]',
      },
    };
  }

  const leadIdleMs = o.leadIdleMs ?? 100;
  const tailIdleMs = o.tailIdleMs ?? 50;
  const interFrameIdleBits = o.interFrameIdleBits ?? 0;
  const rampMs = o.rampMs ?? 5;

  if (
    !Number.isFinite(leadIdleMs) ||
    leadIdleMs < 0 ||
    !Number.isFinite(tailIdleMs) ||
    tailIdleMs < 0 ||
    !Number.isFinite(interFrameIdleBits) ||
    interFrameIdleBits < 0 ||
    !Number.isInteger(interFrameIdleBits) ||
    !Number.isFinite(rampMs) ||
    rampMs < 0
  ) {
    return {
      ok: false,
      error: {
        kind: 'bad-option',
        option: 'timing',
        reason: 'Idle durations and rampMs must be non-negative (interFrameIdleBits integer)',
      },
    };
  }

  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 127) {
      return {
        ok: false,
        error: { kind: 'byte-out-of-range', index: i, value: bytes[i] },
      };
    }
  }

  const errorBitSet = new Set<number>(o.bitErrors ?? []);
  const lineBits: number[] = [];
  const frameEndBitIndices: number[] = [];
  const scheduledFramesRaw: { value: number; parityOk: boolean; framingOk: boolean }[] = [];

  for (let frameIdx = 0; frameIdx < bytes.length; frameIdx++) {
    if (frameIdx > 0 && interFrameIdleBits > 0) {
      for (let b = 0; b < interFrameIdleBits; b++) {
        const lineBitIndex = lineBits.length;
        const bit = errorBitSet.has(lineBitIndex) ? 0 : 1;
        lineBits.push(bit);
      }
    }
    const fBits = byteToFrameBits(bytes[frameIdx]);
    for (let j = 0; j < FRAME.bitsPerFrame; j++) {
      const lineBitIndex = lineBits.length;
      if (errorBitSet.has(lineBitIndex)) {
        fBits[j] ^= 1;
      }
      lineBits.push(fBits[j]);
    }
    frameEndBitIndices.push(lineBits.length);
    scheduledFramesRaw.push(decodeFrameBits(fBits));
  }

  const leadSec = leadIdleMs / 1000;
  const tailSec = tailIdleMs / 1000;
  const dataSec = lineBits.length / spec.baud;
  const totalSec = leadSec + dataSec + tailSec;
  const totalSamples = Math.round(sampleRate * totalSec);
  const out = new Float32Array(totalSamples);

  const leadRampMs = Math.min(rampMs, leadIdleMs);
  const tailRampMs = Math.min(rampMs, tailIdleMs);
  const leadRampSamples = Math.min(
    totalSamples,
    Math.round((leadRampMs / 1000) * sampleRate),
  );
  const tailRampSamples = Math.min(
    totalSamples,
    Math.round((tailRampMs / 1000) * sampleRate),
  );

  let phase = 0;
  const twoPiOverFs = (2 * Math.PI) / sampleRate;

  for (let n = 0; n < totalSamples; n++) {
    const t = n / sampleRate;
    let bit = 1; // idle mark
    if (t >= leadSec && t < leadSec + dataSec) {
      const bitIndex = Math.min(
        lineBits.length - 1,
        Math.floor((t - leadSec) * spec.baud),
      );
      bit = lineBits[bitIndex];
    }
    const freqHz = bit === 1 ? spec.markHz : spec.spaceHz;
    phase += twoPiOverFs * freqHz;
    if (phase > 2 * Math.PI) {
      phase -= 2 * Math.PI;
    }

    let env = 1.0;
    if (leadRampSamples > 0 && n < leadRampSamples) {
      env = 0.5 * (1 - Math.cos((Math.PI * n) / leadRampSamples));
    } else if (tailRampSamples > 0 && n >= totalSamples - tailRampSamples) {
      const k = totalSamples - 1 - n;
      env = 0.5 * (1 - Math.cos((Math.PI * k) / tailRampSamples));
    }
    out[n] = amplitude * env * Math.sin(phase);
  }

  const leadSamples = Math.round(leadSec * sampleRate);
  const tailStartSample = Math.round((leadSec + dataSec) * sampleRate);
  const frames: ScheduledFrame[] = scheduledFramesRaw.map((f, idx) => ({
    ...f,
    atSample: Math.min(
      totalSamples,
      Math.max(1, Math.round((leadSec + frameEndBitIndices[idx] / spec.baud) * sampleRate)),
    ),
  }));

  const signatureSampleIndex = Math.min(
    Math.max(0, leadSamples + 1),
    Math.max(0, totalSamples - 1),
  );

  recentTransmissions.push({
    sampleRate,
    channel: channelId,
    totalSamples,
    leadSamples,
    tailStartSample,
    frames,
    signatureSampleIndex,
    signatureSampleValue: totalSamples > 0 ? out[signatureSampleIndex] : 0,
  });
  if (recentTransmissions.length > MAX_RECENT_TRANSMISSIONS) {
    recentTransmissions.shift();
  }

  return { ok: true, value: out };
}

export function connectionSequence(o: ConnectionSequenceOptions): Float32Array {
  const { sampleRate } = o;
  const answerToneMs = o.answerToneMs ?? 700;
  const silenceMs = o.silenceMs ?? 150;
  const carrierMs = o.carrierMs ?? 300;

  const answerSamples = Math.round((answerToneMs / 1000) * sampleRate);
  const silenceSamples = Math.round((silenceMs / 1000) * sampleRate);
  const carrierSamples = Math.round((carrierMs / 1000) * sampleRate);
  const totalSamples = answerSamples + silenceSamples + carrierSamples;

  const out = new Float32Array(totalSamples);
  const twoPiOverFs = (2 * Math.PI) / sampleRate;
  let phase = 0;

  for (let n = 0; n < totalSamples; n++) {
    if (n < answerSamples) {
      phase += twoPiOverFs * 2100;
      out[n] = 0.5 * Math.sin(phase);
    } else if (n < answerSamples + silenceSamples) {
      out[n] = 0;
    } else {
      phase += twoPiOverFs * CHANNELS.forward.markHz;
      out[n] = 0.5 * Math.sin(phase);
    }
  }
  return out;
}

/**
 * J1 fake streaming demodulator: implements the `createDemodulator` factory and
 * `StreamingDemodulator` interface per the amended `v23-modem/design.md` contract.
 * Until Task 8 lands, only `threshold: 'fixed'` is accepted; `setThresholdMode('adaptive')`
 * is a documented no-op that leaves the mode at `'fixed'`.
 * Role B replaces this with the real DSP demodulator in Tasks 5-8.
 */
export function createDemodulator(
  o: DemodOptions,
): Result<StreamingDemodulator, ModemError> {
  const { sampleRate } = o;
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < SAMPLE_RATE_MIN_HZ ||
    sampleRate > SAMPLE_RATE_MAX_HZ
  ) {
    return { ok: false, error: { kind: 'bad-sample-rate', sampleRate } };
  }

  const channelId: ChannelId = o.channel ?? 'forward';
  const spec = CHANNELS[channelId];
  if (!spec) {
    return {
      ok: false,
      error: { kind: 'bad-option', option: 'channel', reason: 'Unknown channel' },
    };
  }

  if (o.threshold !== 'fixed') {
    return {
      ok: false,
      error: {
        kind: 'bad-option',
        option: 'threshold',
        reason: "Before task 8 lands, only threshold: 'fixed' is accepted",
      },
    };
  }

  if (o.carrierOnDbfs !== undefined && !Number.isFinite(o.carrierOnDbfs)) {
    return {
      ok: false,
      error: {
        kind: 'bad-option',
        option: 'carrierOnDbfs',
        reason: 'carrierOnDbfs must be finite',
      },
    };
  }

  let thresholdMode: 'fixed' | 'adaptive' = 'fixed';

  let cursor = 0;
  let nonFiniteCount = 0;
  let activeRecord: FakeTransmissionRecord | null = null;
  let nextFrameIndex = 0;
  let carrierOnEmitted = false;
  let carrierOffEmitted = false;

  const diagIntervalSamples = Math.max(1, Math.round(0.05 * sampleRate));
  const qualityIntervalSamples = Math.max(1, Math.round(0.1 * sampleRate));
  let nextDiagSample = diagIntervalSamples;
  let nextQualitySample = qualityIntervalSamples;
  const decimation =
    channelId === 'forward'
      ? Math.max(1, Math.floor(sampleRate / 16000))
      : Math.max(1, Math.floor(sampleRate / 2000));

  function ensureActiveRecord(): void {
    if (activeRecord !== null) {
      return;
    }
    for (let i = recentTransmissions.length - 1; i >= 0; i--) {
      const candidate = recentTransmissions[i];
      if (candidate.sampleRate === sampleRate && candidate.channel === channelId) {
        activeRecord = candidate;
        break;
      }
    }
  }

  const demodulator: StreamingDemodulator = {
    push(chunk: Float32Array): DemodEvent[] {
      if (chunk.length === 0) {
        return [];
      }
      ensureActiveRecord();

      for (let i = 0; i < chunk.length; i++) {
        if (!Number.isFinite(chunk[i])) {
          nonFiniteCount++;
        }
      }

      const prevCursor = cursor;
      const newCursor = cursor + chunk.length;
      cursor = newCursor;

      const timedEvents: DemodEvent[] = [];

      const carrierOnSample =
        activeRecord && activeRecord.totalSamples > 0
          ? Math.max(1, Math.min(activeRecord.totalSamples, Math.round(0.02 * sampleRate)))
          : Infinity;
      const carrierOffSample =
        activeRecord && activeRecord.totalSamples > 0 ? activeRecord.totalSamples : -1;

      if (activeRecord && activeRecord.totalSamples > 0) {
        if (!carrierOnEmitted && prevCursor < carrierOnSample && carrierOnSample <= newCursor) {
          carrierOnEmitted = true;
          timedEvents.push({ type: 'carrier', on: true, atSample: carrierOnSample });
        }

        while (
          nextFrameIndex < activeRecord.frames.length &&
          activeRecord.frames[nextFrameIndex].atSample <= newCursor
        ) {
          const frame = activeRecord.frames[nextFrameIndex];
          if (frame.atSample > prevCursor) {
            timedEvents.push({
              type: 'char',
              value: frame.value,
              parityOk: frame.parityOk,
              framingOk: frame.framingOk,
              atSample: frame.atSample,
              minConfidence: 1.0,
            });
          }
          nextFrameIndex++;
        }

        if (!carrierOffEmitted && prevCursor < carrierOffSample && carrierOffSample <= newCursor) {
          carrierOffEmitted = true;
          timedEvents.push({ type: 'carrier', on: false, atSample: carrierOffSample });
        }
      }

      while (nextQualitySample <= newCursor) {
        if (
          nextQualitySample > prevCursor &&
          nextQualitySample >= carrierOnSample &&
          nextQualitySample < carrierOffSample
        ) {
          timedEvents.push({
            type: 'quality',
            atSample: nextQualitySample,
            snrBandDb: 30,
            snr3kDb: 30,
            ebN0Db: 33,
            parityErrorRate: 0,
            offsetHz: 0,
          });
        }
        nextQualitySample += qualityIntervalSamples;
      }

      while (nextDiagSample <= newCursor) {
        if (nextDiagSample > prevCursor) {
          timedEvents.push({
            type: 'diag',
            atSample: nextDiagSample,
            nonFiniteCount,
            freqHz: new Float32Array([spec.markHz]),
            decimation,
            bitWindows: [],
            thresholdHz: spec.thresholdHz,
            markHz: spec.markHz,
            spaceHz: spec.spaceHz,
          });
        }
        nextDiagSample += diagIntervalSamples;
      }

      timedEvents.sort((a, b) => a.atSample - b.atSample);
      return timedEvents;
    },

    flush(): DemodEvent[] {
      return [];
    },

    reset(): void {
      cursor = 0;
      nonFiniteCount = 0;
      activeRecord = null;
      nextFrameIndex = 0;
      carrierOnEmitted = false;
      carrierOffEmitted = false;
      nextDiagSample = diagIntervalSamples;
      nextQualitySample = qualityIntervalSamples;
    },

    setThresholdMode(_m: 'fixed' | 'adaptive'): void {
      // Documented no-op before Task 8: mode remains 'fixed'
      thresholdMode = 'fixed';
      void thresholdMode;
    },
  };

  return { ok: true, value: demodulator };
}

export const DEFAULT_HUM: HumParams = {
  levelDb: -20,
  fundamentalHz: 50,
  harmonics: 5,
};

export const DEFAULT_BURSTS: BurstParams = {
  ratePerS: 0.5,
  durationMs: [5, 25],
  levelDb: -6,
};

export function createChannel(p: ChannelParams): Result<LineChannel, ModemError> {
  if (
    !Number.isFinite(p.sampleRate) ||
    p.sampleRate < SAMPLE_RATE_MIN_HZ ||
    p.sampleRate > SAMPLE_RATE_MAX_HZ
  ) {
    return { ok: false, error: { kind: 'bad-sample-rate', sampleRate: p.sampleRate } };
  }
  let params: ChannelParams = { ...p };
  return {
    ok: true,
    value: {
      process(chunk: Float32Array): Float32Array {
        void params;
        return chunk.slice();
      },
      flush(): Float32Array {
        return new Float32Array(0);
      },
      setParams(next: Partial<Omit<ChannelParams, 'sampleRate' | 'seed'>>): void {
        params = { ...params, ...next };
      },
      reset(): void {
        // no-op in J1 scaffold stub
      },
    },
  };
}

export function applyChannel(
  x: Float32Array,
  p: ChannelParams,
): Result<Float32Array, ModemError> {
  const ch = createChannel(p);
  if (!ch.ok) {
    return ch;
  }
  const a = ch.value.process(x);
  const b = ch.value.flush();
  if (b.length === 0) {
    return { ok: true, value: a };
  }
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return { ok: true, value: out };
}

export function pn9Frames(frames: number, o?: { startFrame?: number }): Uint8Array {
  const startFrame = o?.startFrame ?? 0;
  let lfsr = 0x1ff;
  const skipBits = Math.max(0, startFrame) * 7;
  for (let s = 0; s < skipBits; s++) {
    const feedback = ((lfsr >> 0) ^ (lfsr >> 4)) & 1;
    lfsr = ((lfsr >> 1) | (feedback << 8)) & 0x1ff;
  }
  const out = new Uint8Array(Math.max(0, frames));
  for (let i = 0; i < out.length; i++) {
    let byte = 0;
    for (let b = 0; b < 7; b++) {
      const bit = lfsr & 1;
      byte |= bit << b;
      const feedback = ((lfsr >> 0) ^ (lfsr >> 4)) & 1;
      lfsr = ((lfsr >> 1) | (feedback << 8)) & 0x1ff;
    }
    out[i] = byte;
  }
  return out;
}

export function wilsonInterval(
  errors: number,
  bits: number,
  z: number,
): { lo: number; hi: number } {
  if (
    !Number.isInteger(errors) ||
    !Number.isInteger(bits) ||
    bits < 0 ||
    errors < 0 ||
    errors > bits ||
    !Number.isFinite(z) ||
    z <= 0
  ) {
    return { lo: NaN, hi: NaN };
  }
  if (bits === 0) {
    return { lo: 0, hi: 1 };
  }
  const p = errors / bits;
  const z2 = z * z;
  const denom = 1 + z2 / bits;
  const center = (p + z2 / (2 * bits)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p)) / bits + z2 / (4 * bits * bits))) / denom;
  return {
    lo: Math.max(0, center - half),
    hi: Math.min(1, center + half),
  };
}

export function wilson95(errors: number, bits: number): { lo: number; hi: number } {
  return wilsonInterval(errors, bits, 1.96);
}

export class BerCounter {
  private bits = 0;
  private errors = 0;
  private resyncs = 0;

  pushFrame(_value: number, framingOk: boolean): void {
    this.bits += 7;
    if (!framingOk) {
      this.errors += 7;
    }
  }

  snapshot(): BerSnapshot {
    const ber = this.bits > 0 ? this.errors / this.bits : 0;
    const { lo, hi } = wilson95(this.errors, this.bits);
    return {
      bits: this.bits,
      errors: this.errors,
      ber,
      lo,
      hi,
      synced: this.bits >= 9,
      resyncs: this.resyncs,
    };
  }

  reset(): void {
    this.bits = 0;
    this.errors = 0;
    this.resyncs = 0;
  }
}

export const FORWARD_RHO = (() => {
  const h = (CHANNELS.forward.spaceHz - CHANNELS.forward.markHz) / CHANNELS.forward.baud;
  return Math.abs(Math.sin(Math.PI * h) / (Math.PI * h));
})();

export function berOrthogonalNoncoherent(ebN0Db: number): number {
  const ebN0Lin = Math.pow(10, ebN0Db / 10);
  return 0.5 * Math.exp(-0.5 * ebN0Lin);
}

export function berNoncoherentCorrelated(ebN0Db: number, _rho = FORWARD_RHO): number {
  return berOrthogonalNoncoherent(ebN0Db);
}
