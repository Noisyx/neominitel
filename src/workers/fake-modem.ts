/**
 * Role A fake modem (J1 scaffold), moved here from `src/modem/index.ts` so that the modem core
 * (`src/modem/`, Role B) only holds the real implementation. Same logic as the original.
 *
 * - `fakeModulate` synthesizes phase-continuous V.23 FSK audio and records the frame schedule.
 * - `createFakeDemodulator` does NOT decode audio: it replays the frame schedule recorded by the
 *   most recent `fakeModulate` call with the same sample rate and channel.
 *
 * The signatures follow the shared contract (`v23-modem/design.md`, "Interfaces"), so the app
 * switches to the real modem by changing one import, from `./fake-modem` to `../modem`.
 * Until task 8 lands, only `threshold: 'fixed'` is accepted (design.md, "Threshold mode").
 */
import {
  ANSWER_TONE_HZ,
  CHANNELS,
  FRAME,
  SAMPLE_RATE_MAX_HZ,
  SAMPLE_RATE_MIN_HZ,
  type ChannelId,
  type ConnectionSequenceOptions,
  type DemodEvent,
  type DemodOptions,
  type ModemError,
  type ModulateOptions,
  type Result,
  type StreamingDemodulator,
} from '../modem';

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
  for (let i = 0; i < FRAME.dataBits; i++) {
    ones += (byte7 >> i) & 1;
  }
  return (ones % 2 === 0 ? 0 : 1) as 0 | 1;
}

function byteToFrameBits(byte7: number): number[] {
  const bits: number[] = [0]; // start bit (space = 0)
  for (let i = 0; i < FRAME.dataBits; i++) {
    bits.push((byte7 >> i) & 1);
  }
  bits.push(computeEvenParityBit(byte7));
  bits.push(1); // stop bit (mark = 1)
  return bits;
}

function decodeFrameBits(bits: number[]): { value: number; parityOk: boolean; framingOk: boolean } {
  let value = 0;
  let weight = 0;
  for (let i = 0; i < FRAME.dataBits; i++) {
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

function badSampleRate(sampleRate: number): boolean {
  return !Number.isFinite(sampleRate) || sampleRate < SAMPLE_RATE_MIN_HZ || sampleRate > SAMPLE_RATE_MAX_HZ;
}

/**
 * Fake modulator: validates inputs, synthesizes phase-continuous V.23 FSK audio with an exact
 * cumulative timeline, and registers the frame schedule for `createFakeDemodulator`.
 */
export function fakeModulate(
  bytes: Uint8Array,
  o: ModulateOptions,
): Result<Float32Array, ModemError> {
  const { sampleRate } = o;
  if (badSampleRate(sampleRate)) {
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
  const leadRampSamples = Math.min(totalSamples, Math.round((leadRampMs / 1000) * sampleRate));
  const tailRampSamples = Math.min(totalSamples, Math.round((tailRampMs / 1000) * sampleRate));

  let phase = 0;
  const twoPiOverFs = (2 * Math.PI) / sampleRate;

  for (let n = 0; n < totalSamples; n++) {
    const t = n / sampleRate;
    let bit = 1; // idle mark
    if (t >= leadSec && t < leadSec + dataSec) {
      const bitIndex = Math.min(lineBits.length - 1, Math.floor((t - leadSec) * spec.baud));
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

  const signatureSampleIndex = Math.min(Math.max(0, leadSamples + 1), Math.max(0, totalSamples - 1));

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

/** Fake connection sequence: answer tone, silence, forward mark carrier (provisional durations). */
export function fakeConnectionSequence(o: ConnectionSequenceOptions): Float32Array {
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
      phase += twoPiOverFs * ANSWER_TONE_HZ;
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
 * Fake streaming demodulator with the contract factory signature.
 * Before task 8, only `threshold: 'fixed'` is accepted: an omitted threshold returns
 * `bad-option` (no silent fallback), and `setThresholdMode('adaptive')` is a documented no-op.
 */
export function createFakeDemodulator(
  o: DemodOptions,
): Result<StreamingDemodulator, ModemError> {
  const { sampleRate } = o;
  if (badSampleRate(sampleRate)) {
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
      // Documented no-op before task 8: the mode stays 'fixed'.
    },
  };

  return { ok: true, value: demodulator };
}
