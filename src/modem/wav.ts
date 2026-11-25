// WAV input/output (requirement 4, design.md "WAV API").
// Pure: no DOM, no Node API. Reads and writes little-endian RIFF/WAVE in memory.
import type { ModemError, Result } from './types';
import { SAMPLE_RATE_MAX_HZ, SAMPLE_RATE_MIN_HZ } from './v23';

/**
 * Stable reasons of `{ kind: 'wav', reason }` errors returned by readWav. The app maps each code
 * to a French message (neominitel-app requirement 100.4); never rename a code.
 */
export const WAV_ERROR_REASONS = [
  'too-short', // fewer than 12 bytes: no RIFF/WAVE header
  'not-riff', // the file does not start with "RIFF"
  'not-wave', // the RIFF form type is not "WAVE"
  'missing-fmt', // no complete "fmt " chunk
  'bad-fmt', // "fmt " chunk inconsistent: size, channels, sample rate, blockAlign, valid bits
  'unsupported-encoding', // codec or bit depth outside 8/16/24-bit PCM and 32-bit float; RIFX, RF64
  'missing-data', // no "data" chunk
  'data-truncated', // the data chunk runs past the end of the file, or ends inside a frame
  'too-large', // the decoded samples cannot be allocated
] as const;

export type WavErrorReason = (typeof WAV_ERROR_REASONS)[number];

/** Decoded WAV: mono samples (multi-channel input averaged) and the header sample rate. */
export interface WavAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** Size of the header written by writeWav: RIFF (12) + "fmt " (8 + 16) + "data" (8). */
export const WAV_HEADER_BYTES = 44;

/**
 * Largest sample count writeWav accepts: the RIFF size field (uint32) holds 36 + 2 * n, so
 * n <= floor((2^32 - 1 - 36) / 2).
 */
export const WAV_MAX_SAMPLES = Math.floor((0xffffffff - (WAV_HEADER_BYTES - 8)) / 2);

const PCM_SCALE_16 = 32768;
const FORMAT_PCM = 0x0001;
const FORMAT_IEEE_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;
/** Bytes 2..15 of KSDATAFORMAT_SUBTYPE_xxx GUIDs ({0000xxxx-0000-0010-8000-00AA00389B71}). */
const GUID_BASE_TAIL = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

function wavError(reason: WavErrorReason): Result<never, ModemError> {
  return { ok: false, error: { kind: 'wav', reason } };
}

function badOption(option: string, reason: string): Result<never, ModemError> {
  return { ok: false, error: { kind: 'bad-option', option, reason } };
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function writeFourCC(view: DataView, offset: number, id: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, id.charCodeAt(i));
}

/** 16-bit code of a sample: clamp(round(x * 32768), -32768, 32767), Math.round semantics. */
function quantize16(x: number): number {
  const s = Math.round(x * PCM_SCALE_16);
  return s > 32767 ? 32767 : s < -32768 ? -32768 : s;
}

/**
 * Writes mono 16-bit PCM WAV bytes (requirement 4.1).
 *
 * Output: a 44-byte header (RIFF, "fmt " PCM mono 16-bit, "data") followed by the samples, with
 * no other chunk and no timestamp, so the same input always gives the same bytes. Sample x is
 * stored as clamp(round(x * 32768), -32768, 32767); readWav returns that code / 32768.
 *
 * Errors (never throws): `bad-sample-rate` unless sampleRate is an integer in 8 000..96 000 Hz;
 * `bad-option` "samples" when samples is not a Float32Array, holds a NaN or infinite value
 * (index in the reason), exceeds WAV_MAX_SAMPLES, or cannot be allocated.
 */
export function writeWav(samples: Float32Array, sampleRate: number): Result<Uint8Array, ModemError> {
  if (
    typeof sampleRate !== 'number' ||
    !Number.isInteger(sampleRate) ||
    sampleRate < SAMPLE_RATE_MIN_HZ ||
    sampleRate > SAMPLE_RATE_MAX_HZ
  ) {
    return { ok: false, error: { kind: 'bad-sample-rate', sampleRate } };
  }
  if (!(samples instanceof Float32Array)) return badOption('samples', 'must be a Float32Array');
  const n = samples.length;
  if (n > WAV_MAX_SAMPLES) {
    return badOption('samples', `too many samples for a RIFF file (max ${WAV_MAX_SAMPLES})`);
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(samples[i])) return badOption('samples', `non-finite sample at index ${i}`);
  }

  const dataBytes = 2 * n;
  let out: Uint8Array;
  try {
    out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  } catch {
    return badOption('samples', 'output buffer cannot be allocated');
  }
  const view = new DataView(out.buffer);
  writeFourCC(view, 0, 'RIFF');
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeFourCC(view, 8, 'WAVE');
  writeFourCC(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, 1, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeFourCC(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0, p = WAV_HEADER_BYTES; i < n; i++, p += 2) view.setInt16(p, quantize16(samples[i]), true);
  return { ok: true, value: out };
}

interface FmtInfo {
  encoding: 'pcm' | 'float';
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
}

/** Parses a complete "fmt " chunk body at `body` (size bytes, in bounds). */
function parseFmt(view: DataView, body: number, size: number): Result<FmtInfo, ModemError> {
  if (size < 16) return wavError('bad-fmt');
  let tag = view.getUint16(body, true);
  const channels = view.getUint16(body + 2, true);
  const sampleRate = view.getUint32(body + 4, true);
  const blockAlign = view.getUint16(body + 12, true);
  const bitsPerSample = view.getUint16(body + 14, true);
  if (channels === 0 || sampleRate === 0) return wavError('bad-fmt');

  if (tag === FORMAT_EXTENSIBLE) {
    // cbSize (>= 22), valid bits, channel mask, then the 16-byte sub-format GUID.
    if (size < 40 || view.getUint16(body + 16, true) < 22) return wavError('bad-fmt');
    const validBits = view.getUint16(body + 18, true);
    if (validBits > bitsPerSample) return wavError('bad-fmt');
    for (let i = 0; i < GUID_BASE_TAIL.length; i++) {
      if (view.getUint8(body + 26 + i) !== GUID_BASE_TAIL[i]) return wavError('unsupported-encoding');
    }
    tag = view.getUint16(body + 24, true);
  }

  let encoding: FmtInfo['encoding'];
  if (tag === FORMAT_PCM && (bitsPerSample === 8 || bitsPerSample === 16 || bitsPerSample === 24)) {
    encoding = 'pcm';
  } else if (tag === FORMAT_IEEE_FLOAT && bitsPerSample === 32) {
    encoding = 'float';
  } else {
    return wavError('unsupported-encoding'); // includes 32-bit integer PCM (decision W6)
  }
  if (blockAlign !== channels * (bitsPerSample / 8)) return wavError('bad-fmt');
  return { ok: true, value: { encoding, channels, sampleRate, bitsPerSample, blockAlign } };
}

function toView(data: unknown): DataView | null {
  if (ArrayBuffer.isView(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new DataView(data as ArrayBuffer);
  return null;
}

/**
 * Reads a WAV file into mono samples (requirements 4.2 and 4.3).
 *
 * Accepts 8-bit (unsigned), 16- and 24-bit PCM and 32-bit IEEE float, also inside
 * WAVE_FORMAT_EXTENSIBLE. Integer codes are scaled by 2^(bits - 1) (8-bit: (u - 128) / 128);
 * float values, NaN included, are kept. Several channels are averaged into one.
 * Chunks other than "fmt " and "data" are skipped, with their odd-size pad byte; the RIFF size
 * field is not trusted. A chunk header whose body runs past the end of the file ends the walk
 * (except "data", which gives `data-truncated`). The first "fmt " and "data" chunks are used.
 *
 * Errors (never throws): `{ kind: 'wav', reason }` with a WavErrorReason, or `bad-option` "data"
 * when data is neither an ArrayBuffer nor a typed-array view.
 */
export function readWav(data: ArrayBuffer | Uint8Array): Result<WavAudio, ModemError> {
  const view = toView(data);
  if (view === null) return badOption('data', 'must be an ArrayBuffer or a Uint8Array');
  const len = view.byteLength;
  if (len < 12) return wavError('too-short');
  const riff = fourCC(view, 0);
  if (riff === 'RIFX' || riff === 'RF64') return wavError('unsupported-encoding');
  if (riff !== 'RIFF') return wavError('not-riff');
  if (fourCC(view, 8) !== 'WAVE') return wavError('not-wave');

  let fmt: FmtInfo | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  // Each step advances by at least 8 bytes, so the walk ends.
  for (let pos = 12; pos + 8 <= len; ) {
    const id = fourCC(view, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    const fits = size <= len - body;
    if (id === 'data' && dataOffset < 0) {
      if (!fits) return wavError('data-truncated');
      dataOffset = body;
      dataSize = size;
    } else if (id === 'fmt ' && fmt === null) {
      if (!fits) break;
      const parsed = parseFmt(view, body, size);
      if (!parsed.ok) return parsed;
      fmt = parsed.value;
    } else if (!fits) {
      break;
    }
    pos = body + size + (size & 1);
  }
  if (fmt === null) return wavError('missing-fmt');
  if (dataOffset < 0) return wavError('missing-data');
  if (dataSize % fmt.blockAlign !== 0) return wavError('data-truncated');

  const frames = dataSize / fmt.blockAlign;
  let samples: Float32Array;
  try {
    samples = new Float32Array(frames);
  } catch {
    return wavError('too-large');
  }
  decodeFrames(view, dataOffset, frames, fmt, samples);
  return { ok: true, value: { samples, sampleRate: fmt.sampleRate } };
}

/** Decodes `frames` frames from `offset` (all in bounds, checked by readWav) into `out`. */
function decodeFrames(view: DataView, offset: number, frames: number, fmt: FmtInfo, out: Float32Array): void {
  const { channels, blockAlign, bitsPerSample, encoding } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  for (let f = 0, p = offset; f < frames; f++, p += blockAlign) {
    let sum = 0;
    for (let c = 0, q = p; c < channels; c++, q += bytesPerSample) {
      if (encoding === 'float') {
        sum += view.getFloat32(q, true);
      } else if (bitsPerSample === 16) {
        sum += view.getInt16(q, true) / 32768;
      } else if (bitsPerSample === 24) {
        const v = view.getUint8(q) | (view.getUint8(q + 1) << 8) | (view.getInt8(q + 2) << 16);
        sum += v / 8388608;
      } else {
        sum += (view.getUint8(q) - 128) / 128;
      }
    }
    out[f] = channels === 1 ? sum : sum / channels;
  }
}
