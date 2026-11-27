// Backward-channel keyboard (neominitel-app task 17, requirement 12). The terminal device sends its
// typed characters and function keys (SEP + code) at 75 baud; the server device listens with this
// receiver while it transmits its pages on the forward channel (the backward demodulator rejects the
// forward band by more than 50 dB, v23-modem requirement 12.2).
import { createDemodulator, type ModemError, type StreamingDemodulator } from '../modem';
import { C0, createKeyDecoder, type FunctionKey } from '../videotex';

/** What the server receives from the terminal on the backward channel. */
export type BackwardInput = { kind: 'key'; key: FunctionKey; atSample: number } | { kind: 'char'; char: string; atSample: number };

export interface BackwardKeyListener {
  push(chunk: Float32Array): BackwardInput[];
  reset(): void;
}

/** Printable characters sent as themselves (G0 0x20..0x7E); everything else is ignored. */
function isPrintable(v: number): boolean {
  return v >= 0x20 && v <= 0x7e;
}

/**
 * Creates the server-side receiver: a backward demodulator (adaptive threshold) followed by the
 * Videotex key decoder. A frame with a parity or framing error is dropped and cancels a pending
 * SEP. A SEP is never reported; the byte after it is a function key; other printable bytes are
 * typed characters.
 */
export function createBackwardKeyListener(sampleRate: number): { ok: true; value: BackwardKeyListener } | { ok: false; error: ModemError } {
  const d = createDemodulator({ sampleRate, channel: 'backward', threshold: 'adaptive' });
  if (!d.ok) return d;
  const demod: StreamingDemodulator = d.value;
  const keys = createKeyDecoder();
  let afterSep = false;

  function handle(events: ReturnType<StreamingDemodulator['push']>, out: BackwardInput[]): void {
    for (const e of events) {
      if (e.type !== 'char') continue;
      const error = !e.parityOk || !e.framingOk;
      const value = e.value & 0x7f;
      const key = keys.push({ value, error });
      if (error) {
        afterSep = false;
        continue;
      }
      if (key) {
        out.push({ kind: 'key', key, atSample: e.atSample });
        afterSep = false;
        continue;
      }
      if (value === C0.SEP) {
        afterSep = true;
        continue;
      }
      if (afterSep) {
        afterSep = false; // SEP + unknown code: dropped
        continue;
      }
      if (isPrintable(value)) out.push({ kind: 'char', char: String.fromCharCode(value), atSample: e.atSample });
    }
  }

  return {
    ok: true,
    value: {
      push(chunk: Float32Array): BackwardInput[] {
        const out: BackwardInput[] = [];
        handle(demod.push(chunk), out);
        return out;
      },
      reset(): void {
        demod.reset();
        keys.reset();
        afterSep = false;
      },
    },
  };
}

/**
 * Bytes the terminal sends for what the user did: a function key is SEP + its code; a typed
 * character is its 7-bit G0 byte (characters outside 0x20..0x7E are not sent).
 */
export function backwardBytesForChar(char: string): Uint8Array {
  const v = char.length === 1 ? char.charCodeAt(0) : -1;
  return isPrintable(v) ? Uint8Array.of(v) : new Uint8Array(0);
}
