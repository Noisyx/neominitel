export * from './types';
export * from './v23';

import { CHANNELS, FRAME, SAMPLE_RATE_MAX_HZ, SAMPLE_RATE_MIN_HZ } from './v23';
import type {
  BerCounter,
  BerSnapshot,
  ChannelId,
  ChannelOptions,
  ChannelSimulator,
  ConnectionSequenceOptions,
  DemodEvent,
  DemodOptions,
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

  const rampSamples = Math.min(
    Math.floor(totalSamples / 2),
    Math.round((rampMs / 1000) * sampleRate),
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
    if (rampSamples > 0) {
      if (n < rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * n) / rampSamples));
      } else if (n >= totalSamples - rampSamples) {
        const k = totalSamples - 1 - n;
        env = 0.5 * (1 - Math.cos((Math.PI * k) / rampSamples));
      }
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
 * J1 fake streaming demodulator: implements the full `StreamingDemodulator` interface
 * with chunk invariance (M5) and scheduled events (`carrier`, `char`, `quality`, `diag`).
 * Role B replaces this with the real DSP demodulator in Tasks 5-8.
 */
export function createDemodulator(o: DemodOptions): StreamingDemodulator {
  const channelId: ChannelId = o.channel ?? 'forward';
  const spec = CHANNELS[channelId];
  const sampleRate = o.sampleRate;
  let thresholdMode: 'fixed' | 'adaptive' = o.threshold ?? 'fixed';

  let cursor = 0;
  let nonFiniteCount = 0;
  let activeRecord: FakeTransmissionRecord | null = null;
  let nextFrameIndex = 0;
  let carrierOnEmitted = false;
  let carrierOffEmitted = false;
  let nextDiagSample = Math.max(1, Math.round(0.05 * sampleRate));
  let nextQualitySample = Math.max(1, Math.round(0.1 * sampleRate));

  const diagIntervalSamples = Math.max(1, Math.round(0.05 * sampleRate));
  const qualityIntervalSamples = Math.max(1, Math.round(0.1 * sampleRate));
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

  return {
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
            freqHz: new Float32Array([spec.markHz]),
            decimation,
            bitWindows: [],
            thresholdHz: spec.thresholdHz,
            markHz: spec.markHz,
            spaceHz: spec.spaceHz,
            nonFiniteCount,
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

    setThresholdMode(m: 'fixed' | 'adaptive'): void {
      thresholdMode = m;
      void thresholdMode;
    },
  };
}

export function createChannelSimulator(o: ChannelOptions): ChannelSimulator {
  let opts: ChannelOptions = { ...o };
  return {
    process(chunk: Float32Array): Float32Array {
      void opts;
      return chunk.slice();
    },
    setOptions(next: Partial<ChannelOptions>): void {
      opts = { ...opts, ...next };
    },
    reset(): void {
      // no-op in J1 scaffold stub
    },
  };
}

export function applyChannel(samples: Float32Array, o: ChannelOptions): Float32Array {
  return createChannelSimulator(o).process(samples);
}

export function generatePn9Bytes(frameCount: number, seed = 0x1ff): Uint8Array {
  let lfsr = seed & 0x1ff;
  if (lfsr === 0) {
    lfsr = 0x1ff;
  }
  const out = new Uint8Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
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

export function createBerCounter(): BerCounter {
  let bits = 0;
  let errors = 0;
  function makeSnapshot(): BerSnapshot {
    const ber = bits > 0 ? errors / bits : 0;
    return { bits, errors, ber, lo: ber, hi: ber, synced: bits >= 9 };
  }
  return {
    pushBit(_bit: 0 | 1, valid = true): BerSnapshot {
      bits++;
      if (!valid) {
        errors++;
      }
      return makeSnapshot();
    },
    pushFrame(_value: number, framingOk = true): BerSnapshot {
      bits += 7;
      if (!framingOk) {
        errors += 7;
      }
      return makeSnapshot();
    },
    snapshot(): BerSnapshot {
      return makeSnapshot();
    },
    reset(): void {
      bits = 0;
      errors = 0;
    },
  };
}

export function berOrthogonalBfsk(ebN0Db: number): number {
  const ebN0Lin = Math.pow(10, ebN0Db / 10);
  return 0.5 * Math.exp(-0.5 * ebN0Lin);
}

export function berCorrelatedBfsk(ebN0Db: number, _modulationIndex = 2 / 3): number {
  return berOrthogonalBfsk(ebN0Db);
}
