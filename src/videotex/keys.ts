import {
  C0,
  FUNCTION_KEY_BY_CODE,
  FUNCTION_KEYS,
  type FunctionKeyName,
} from './codes';
import type { RxByte } from './decoder';

export type FunctionKey = FunctionKeyName;

export const ALL_FUNCTION_KEYS: readonly FunctionKey[] = Object.keys(
  FUNCTION_KEYS,
) as FunctionKey[];

/**
 * Encodes one of the nine Minitel function keys as `SEP (0x13)` followed by its STUM1B key byte (`0x41..0x49`).
 */
export function encodeKey(key: FunctionKey): Uint8Array {
  const code = FUNCTION_KEYS[key];
  return Uint8Array.of(C0.SEP, code);
}

/**
 * Decodes a 2-byte `SEP + code` sequence back into its `FunctionKey` name, or `null` if invalid.
 */
export function decodeKey(bytes: Uint8Array | readonly number[]): FunctionKey | null {
  if (bytes.length !== 2) {
    return null;
  }
  if ((bytes[0] & 0x7f) !== C0.SEP) {
    return null;
  }
  return FUNCTION_KEY_BY_CODE.get(bytes[1] & 0x7f) ?? null;
}

/**
 * Streaming decoder for backward-channel Minitel function key sequences (`SEP + code`),
 * ignoring error-flagged bytes.
 */
export function createKeyDecoder(): {
  push(b: RxByte): FunctionKey | null;
  reset(): void;
} {
  let awaitingKeyByte = false;

  return {
    push(b: RxByte): FunctionKey | null {
      if (b.error) {
        awaitingKeyByte = false;
        return null;
      }
      const val = b.value & 0x7f;
      if (awaitingKeyByte) {
        awaitingKeyByte = false;
        return FUNCTION_KEY_BY_CODE.get(val) ?? null;
      }
      if (val === C0.SEP) {
        awaitingKeyByte = true;
      }
      return null;
    },
    reset(): void {
      awaitingKeyByte = false;
    },
  };
}
