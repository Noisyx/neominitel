// V.23 modulator: bytes -> audio (requirements 2.1 to 2.7, design.md "Modulator").
import { MAX_FRAME_VALUE, byteToLineBits } from './frame';
import { renderFsk, renderTone } from './oscillator';
import type { ConnectionSequenceOptions, ModemError, ModulateOptions, Result } from './types';
import { ANSWER_TONE_HZ, CHANNELS, FRAME, SAMPLE_RATE_MAX_HZ, SAMPLE_RATE_MIN_HZ, type ChannelId } from './v23';

/** Defaults of ModulateOptions (design.md "Interfaces"). */
export const MODULATE_DEFAULTS = {
  channel: 'forward',
  amplitude: 0.5,
  leadIdleMs: 100,
  tailIdleMs: 50,
  interFrameIdleBits: 0,
  rampMs: 5,
} as const;

/** Tolerance used when converting a time to a sample index (protects ceil() from 1e-12 noise). */
const SAMPLE_EPS = 1e-9;

/**
 * Shortest raised-cosine ramp, in samples, that keeps the M3 step bound A * 2 pi f_max / fs.
 *
 * With w = (1 - cos(pi m / R)) / 2, w'^2 = (pi / R)^2 w (1 - w), so for x = A w sin(phi):
 *   |x'|^2 <= A^2 ((pi / R)^2 w (1 - w) + w^2 phi_max^2),   phi_max = 2 pi f_max / fs.
 * When (pi / R)^2 <= 2 phi_max^2 this is increasing in w and at most A^2 phi_max^2 (at w = 1),
 * whatever the tone (mark or space) under the ramp; the mean value theorem then gives
 * |x[n+1] - x[n]| <= A phi_max. That condition is R >= fs / (2 sqrt(2) f_max).
 */
export function minRampSamples(sampleRate: number, fMaxHz: number): number {
  return Math.ceil(sampleRate / (2 * Math.SQRT2 * fMaxHz) - SAMPLE_EPS);
}

/**
 * Effective ramp length in samples on one side: min(rampMs, idleMs), clamped to the idle samples,
 * and omitted (0) when shorter than minRampSamples (a shorter ramp would break M3).
 */
export function effectiveRampSamples(
  sampleRate: number,
  rampMs: number,
  idleMs: number,
  idleSamples: number,
  fMaxHz: number,
): number {
  const r = Math.min(Math.round((sampleRate * Math.min(rampMs, idleMs)) / 1000), idleSamples);
  return r >= minRampSamples(sampleRate, fMaxHz) ? r : 0;
}

export function isValidSampleRate(sampleRate: unknown): sampleRate is number {
  return (
    typeof sampleRate === 'number' &&
    Number.isFinite(sampleRate) &&
    sampleRate >= SAMPLE_RATE_MIN_HZ &&
    sampleRate <= SAMPLE_RATE_MAX_HZ
  );
}

/** Number of line bits for n frames separated by `interFrameIdleBits` idle (mark) bits. */
export function lineBitCount(nFrames: number, interFrameIdleBits: number): number {
  return nFrames === 0 ? 0 : nFrames * FRAME.bitsPerFrame + (nFrames - 1) * interFrameIdleBits;
}

/**
 * Line bits of a transmission: one 7E1 frame per byte, `interFrameIdleBits` mark bits between
 * frames, then the listed `bitErrors` inverted (each index at most once).
 * Preconditions (checked by modulate): bytes <= 127, idle bits a non-negative integer, error
 * indices integers in [0, lineBitCount).
 */
export function buildLineBits(
  bytes: Uint8Array,
  interFrameIdleBits: number,
  bitErrors: readonly number[] = [],
): Uint8Array {
  const bits = new Uint8Array(lineBitCount(bytes.length, interFrameIdleBits));
  let pos = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0) {
      bits.fill(1, pos, pos + interFrameIdleBits);
      pos += interFrameIdleBits;
    }
    byteToLineBits(bytes[i], bits, pos);
    pos += FRAME.bitsPerFrame;
  }
  for (const k of new Set(bitErrors)) bits[k] ^= 1;
  return bits;
}

function badOption(option: string, reason: string): Result<never, ModemError> {
  return { ok: false, error: { kind: 'bad-option', option, reason } };
}

function isNonNegativeFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Modulates 7-bit bytes into mono V.23 audio.
 *
 * Validation order: sample rate (`bad-sample-rate`), then options (`bad-option`), then the first
 * byte above 127 (`byte-out-of-range` with its index). Never throws.
 *
 * Timeline (requirement 2.5): with t0 = leadIdleMs / 1000 and baud from the channel, line bit k
 * covers [t0 + k / baud, t0 + (k + 1) / baud). The output holds
 * round(fs * (t0 + nBits / baud + tailIdleMs / 1000)) samples, sample n being time n / fs.
 */
export function modulate(bytes: Uint8Array, o: ModulateOptions): Result<Float32Array, ModemError> {
  const sampleRate = o?.sampleRate;
  if (!isValidSampleRate(sampleRate)) {
    return { ok: false, error: { kind: 'bad-sample-rate', sampleRate: sampleRate as number } };
  }

  const channel: ChannelId = o.channel ?? MODULATE_DEFAULTS.channel;
  if (!Object.prototype.hasOwnProperty.call(CHANNELS, channel)) {
    return badOption('channel', `unknown channel "${String(channel)}"`);
  }
  const spec = CHANNELS[channel];

  const amplitude = o.amplitude ?? MODULATE_DEFAULTS.amplitude;
  if (typeof amplitude !== 'number' || !Number.isFinite(amplitude) || amplitude <= 0 || amplitude > 1) {
    return badOption('amplitude', 'must be a finite number in (0, 1]');
  }
  const leadIdleMs = o.leadIdleMs ?? MODULATE_DEFAULTS.leadIdleMs;
  if (!isNonNegativeFinite(leadIdleMs)) return badOption('leadIdleMs', 'must be a finite number >= 0');
  const tailIdleMs = o.tailIdleMs ?? MODULATE_DEFAULTS.tailIdleMs;
  if (!isNonNegativeFinite(tailIdleMs)) return badOption('tailIdleMs', 'must be a finite number >= 0');
  const rampMs = o.rampMs ?? MODULATE_DEFAULTS.rampMs;
  if (!isNonNegativeFinite(rampMs)) return badOption('rampMs', 'must be a finite number >= 0');
  const interFrameIdleBits = o.interFrameIdleBits ?? MODULATE_DEFAULTS.interFrameIdleBits;
  if (!Number.isSafeInteger(interFrameIdleBits) || interFrameIdleBits < 0) {
    return badOption('interFrameIdleBits', 'must be an integer >= 0');
  }

  const nBits = lineBitCount(bytes.length, interFrameIdleBits);
  const bitErrors = o.bitErrors ?? [];
  if (!Array.isArray(bitErrors)) return badOption('bitErrors', 'must be an array of line bit indices');
  for (const k of bitErrors) {
    if (!Number.isSafeInteger(k) || k < 0 || k >= nBits) {
      return badOption('bitErrors', `index ${String(k)} is not an integer in [0, ${nBits})`);
    }
  }

  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > MAX_FRAME_VALUE) {
      return { ok: false, error: { kind: 'byte-out-of-range', index: i, value: bytes[i] } };
    }
  }

  const leadS = leadIdleMs / 1000;
  const tailS = tailIdleMs / 1000;
  const endOfBitsS = leadS + nBits / spec.baud;
  const length = Math.round(sampleRate * (endOfBitsS + tailS));

  // Samples with t < t0 are leading idle; samples with t >= end of the last bit are trailing idle.
  const leadSamples = Math.min(length, Math.max(0, Math.ceil(sampleRate * leadS - SAMPLE_EPS)));
  const tailSamples = Math.max(0, length - Math.ceil(sampleRate * endOfBitsS - SAMPLE_EPS));
  const fMaxHz = Math.max(spec.markHz, spec.spaceHz);
  const rampIn = effectiveRampSamples(sampleRate, rampMs, leadIdleMs, leadSamples, fMaxHz);
  const rampOut = effectiveRampSamples(sampleRate, rampMs, tailIdleMs, tailSamples, fMaxHz);

  const out = new Float32Array(length);
  renderFsk(
    out,
    {
      sampleRate,
      baud: spec.baud,
      markHz: spec.markHz,
      spaceHz: spec.spaceHz,
      leadS,
      bits: buildLineBits(bytes, interFrameIdleBits, bitErrors),
    },
    amplitude,
    rampIn,
    rampOut,
  );
  return { ok: true, value: out };
}

/**
 * Default durations of the connection sequence. PROVISIONAL (decisions U5 and T3-3): they match
 * Role A's fake modem and are not normative V.25 values; task 12 checks them against a reference
 * recording and records the result in docs/calibration.md.
 */
export const CONNECTION_DEFAULTS = {
  answerToneMs: 700,
  silenceMs: 150,
  carrierMs: 300,
} as const;

/** Peak amplitude of both tones of the connection sequence (same default as modulate()). */
const CONNECTION_AMPLITUDE = MODULATE_DEFAULTS.amplitude;

/**
 * Connection sequence (requirement 3.1): a 2100 Hz answer tone, a silence, then the forward mark
 * carrier. Each tone starts at phase 0 and has raised-cosine ramps of MODULATE_DEFAULTS.rampMs at
 * both ends (clamped to half the tone, and omitted below minRampSamples for that tone).
 *
 * Segment boundaries come from cumulative exact durations:
 *   s1 = round(fs a), s2 = round(fs (a + b)), N = round(fs (a + b + c)),
 * so each segment is within 1 sample of its exact length and the total is exactly round(fs total).
 *
 * Limit: a tone shorter than 2 * minRampSamples cannot hold a safe ramp, so it has none and may end
 * abruptly (a click). Tones of 1 ms or more always keep their ramps. The spec does not require M3
 * for the connection sequence.
 *
 * The contract returns a Float32Array, not a Result (decision T3-2): any invalid input (sample rate
 * outside 8000..96000 Hz or not finite, a duration that is negative or not finite) returns an
 * empty Float32Array. Never throws. Zero durations are valid and give empty segments.
 */
export function connectionSequence(o: ConnectionSequenceOptions): Float32Array {
  const sampleRate = o?.sampleRate;
  if (!isValidSampleRate(sampleRate)) return new Float32Array(0);
  const answerToneMs = o.answerToneMs ?? CONNECTION_DEFAULTS.answerToneMs;
  const silenceMs = o.silenceMs ?? CONNECTION_DEFAULTS.silenceMs;
  const carrierMs = o.carrierMs ?? CONNECTION_DEFAULTS.carrierMs;
  if (!isNonNegativeFinite(answerToneMs) || !isNonNegativeFinite(silenceMs) || !isNonNegativeFinite(carrierMs)) {
    return new Float32Array(0);
  }

  const s1 = Math.round((sampleRate * answerToneMs) / 1000);
  const s2 = Math.round((sampleRate * (answerToneMs + silenceMs)) / 1000);
  const length = Math.round((sampleRate * (answerToneMs + silenceMs + carrierMs)) / 1000);
  const out = new Float32Array(length); // the silence stays at 0

  const markHz = CHANNELS.forward.markHz;
  renderTone(out, 0, s1, sampleRate, ANSWER_TONE_HZ, CONNECTION_AMPLITUDE, toneRampSamples(sampleRate, s1, ANSWER_TONE_HZ));
  renderTone(out, s2, length - s2, sampleRate, markHz, CONNECTION_AMPLITUDE, toneRampSamples(sampleRate, length - s2, markHz));
  return out;
}

/** Ramp of a tone burst of `length` samples: rampMs, at most half the burst, 0 below R_min. */
export function toneRampSamples(sampleRate: number, length: number, freqHz: number): number {
  const r = Math.min(Math.round((sampleRate * MODULATE_DEFAULTS.rampMs) / 1000), Math.floor(length / 2));
  return r >= minRampSamples(sampleRate, freqHz) ? r : 0;
}
