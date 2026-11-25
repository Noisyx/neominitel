// 7E1 framing of the V.23 link (requirement 1.3, design.md "Constants").
// A frame is FRAME.bitsPerFrame line bits: [0, d0, d1, d2, d3, d4, d5, d6, p, 1]
// (start bit, FRAME.dataBits data bits least significant first, even parity bit, stop bit).
// p is chosen so that d0..d6 + p has even weight. Bit values: 1 = mark, 0 = space.
//
// Internal to the modem core: not exported by index.ts (not part of the shared contract).
import { FRAME } from './v23';

/** Line bit values. Mark (1) is the idle state of the line. */
const MARK = 1;
const SPACE = 0;

/** Index of each field inside a frame. */
export const START_BIT_INDEX = 0;
export const FIRST_DATA_BIT_INDEX = 1;
export const PARITY_BIT_INDEX = FIRST_DATA_BIT_INDEX + FRAME.dataBits; // 8
export const STOP_BIT_INDEX = PARITY_BIT_INDEX + 1; // 9

/** Largest value carried by one frame (2^dataBits - 1 = 127). */
export const MAX_FRAME_VALUE = (1 << FRAME.dataBits) - 1;

export interface DecodedFrame {
  /** The FRAME.dataBits data bits, least significant first (0..MAX_FRAME_VALUE). */
  value: number;
  /** True when the data bits and the parity bit have even weight. */
  parityOk: boolean;
  /** True when the stop bit is mark. */
  framingOk: boolean;
}

/** Even-parity bit of a value: 1 when its data bits have odd weight, so the total is even. */
export function evenParityBit(value: number): 0 | 1 {
  let weight = 0;
  for (let i = 0; i < FRAME.dataBits; i++) weight += (value >> i) & 1;
  return (weight & 1) as 0 | 1;
}

/**
 * Writes the FRAME.bitsPerFrame line bits of `value` into `out` at `offset`, then returns `out`.
 * Without `out`, allocates a new Uint8Array. Passing `out` avoids allocation in the modulator.
 *
 * Precondition: `value` is an integer in [0, MAX_FRAME_VALUE] and `out` has room for one frame.
 * Callers validate inputs first (modulate() returns a typed `byte-out-of-range` error), so a
 * violation here is a programming error and throws a RangeError. This function is internal to
 * the core and is not exposed by the public API.
 */
export function byteToLineBits(
  value: number,
  out: Uint8Array = new Uint8Array(FRAME.bitsPerFrame),
  offset = 0,
): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > MAX_FRAME_VALUE) {
    throw new RangeError(`frame value must be an integer in [0, ${MAX_FRAME_VALUE}], got ${value}`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset + FRAME.bitsPerFrame > out.length) {
    throw new RangeError(`no room for a ${FRAME.bitsPerFrame}-bit frame at offset ${offset}`);
  }
  out[offset + START_BIT_INDEX] = SPACE;
  for (let i = 0; i < FRAME.dataBits; i++) {
    out[offset + FIRST_DATA_BIT_INDEX + i] = (value >> i) & 1;
  }
  out[offset + PARITY_BIT_INDEX] = evenParityBit(value);
  out[offset + STOP_BIT_INDEX] = MARK;
  return out;
}

/**
 * Decodes the frame that starts at `offset` in `bits`. Any non-zero element counts as mark (1).
 *
 * The start bit is not checked here: the UART only starts a frame on a mark-to-space edge and
 * rejects false starts itself (design.md, UART). Parity covers line bits 1 to 8 (data + parity);
 * framing is the stop bit (line bit 9).
 *
 * Precondition: `bits` holds at least `offset + FRAME.bitsPerFrame` elements (RangeError otherwise).
 */
export function lineBitsToByte(bits: ArrayLike<number>, offset = 0): DecodedFrame {
  if (!Number.isInteger(offset) || offset < 0 || offset + FRAME.bitsPerFrame > bits.length) {
    throw new RangeError(`need ${FRAME.bitsPerFrame} line bits at offset ${offset}, got ${bits.length}`);
  }
  let value = 0;
  let weight = 0;
  for (let i = 0; i < FRAME.dataBits; i++) {
    const bit = bits[offset + FIRST_DATA_BIT_INDEX + i] !== 0 ? 1 : 0;
    value |= bit << i;
    weight += bit;
  }
  weight += bits[offset + PARITY_BIT_INDEX] !== 0 ? 1 : 0;
  return {
    value,
    parityOk: (weight & 1) === 0,
    framingOk: bits[offset + STOP_BIT_INDEX] !== 0,
  };
}
