// PN9 test sequence, self-synchronising BER counter and Wilson interval (requirement 10.1 to 10.3,
// design.md "PN9 and BER API" and "PN9 and BER"). Pure: no DOM, no Web Audio.
import { FRAME } from './v23';

/** Period of the PN9 sequence (x^9 + x^5 + 1): 2^9 - 1 bits. */
export const PN9_PERIOD = 511;
/** Initial LFSR state: the first 9 bits of the sequence are ones. */
export const PN9_SEED = 0x1ff;
/** Bits loaded into the receiver's LFSR before counting starts (not counted). */
export const PN9_SYNC_BITS = 9;
/** Resynchronisation: more than RESYNC_ERRORS errors among the last RESYNC_WINDOW compared bits. */
export const BER_RESYNC_WINDOW = 100;
export const BER_RESYNC_ERRORS = 20;

const DATA_BITS = FRAME.dataBits;

/**
 * One period of the sequence a[n], a[n + 9] = a[n + 5] XOR a[n], with a[0..8] the bits of
 * PN9_SEED (all ones). x^9 + x^5 + 1 is primitive, so the period is 511.
 */
const PN9_BITS: Uint8Array = (() => {
  const a = new Uint8Array(PN9_PERIOD);
  for (let i = 0; i < 9; i++) a[i] = (PN9_SEED >> i) & 1;
  for (let n = 9; n < PN9_PERIOD; n++) a[n] = a[n - 4] ^ a[n - 9];
  return a;
})();

/** Bit n of the PN9 sequence (n >= 0). */
export function pn9Bit(n: number): number {
  return PN9_BITS[n % PN9_PERIOD];
}

/**
 * `frames` 7-bit bytes carrying the PN9 sequence, least significant bit first: bit i of byte f is
 * sequence bit 7 (startFrame + f) + i. The period is 73 frames. Throws a RangeError when `frames`
 * or `startFrame` is not a non-negative safe integer (a programming error, not a signal error).
 */
export function pn9Frames(frames: number, o?: { startFrame?: number }): Uint8Array {
  const start = o?.startFrame ?? 0;
  if (!Number.isSafeInteger(frames) || frames < 0) throw new RangeError('pn9Frames: frames must be a non-negative integer');
  if (!Number.isSafeInteger(start) || start < 0) throw new RangeError('pn9Frames: startFrame must be a non-negative integer');
  const out = new Uint8Array(frames);
  let n = ((start % PN9_PERIOD) * DATA_BITS) % PN9_PERIOD;
  for (let f = 0; f < frames; f++) {
    let v = 0;
    for (let i = 0; i < DATA_BITS; i++) {
      v |= PN9_BITS[n] << i;
      n = n + 1 === PN9_PERIOD ? 0 : n + 1;
    }
    out[f] = v;
  }
  return out;
}

/**
 * Wilson score interval for `errors` successes among `bits` trials, at z standard deviations:
 * (p + z^2/2n +- z sqrt(p(1 - p)/n + z^2/4n^2)) / (1 + z^2/n). [0, 1] when bits = 0. Invalid
 * arguments (non-integer counts, errors outside [0, bits], z not > 0) give NaN bounds; never throws.
 */
export function wilsonInterval(errors: number, bits: number, z: number): { lo: number; hi: number } {
  if (
    !Number.isSafeInteger(errors) ||
    !Number.isSafeInteger(bits) ||
    errors < 0 ||
    errors > bits ||
    typeof z !== 'number' ||
    !(z > 0) ||
    !Number.isFinite(z)
  ) {
    return { lo: NaN, hi: NaN };
  }
  if (bits === 0) return { lo: 0, hi: 1 };
  const n = bits;
  const p = errors / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const den = 1 + z2 / n;
  return {
    lo: errors === 0 ? 0 : Math.max(0, (centre - half) / den),
    hi: errors === bits ? 1 : Math.min(1, (centre + half) / den),
  };
}

/** 95 % Wilson interval: wilsonInterval(errors, bits, 1.96). */
export function wilson95(errors: number, bits: number): { lo: number; hi: number } {
  return wilsonInterval(errors, bits, 1.96);
}

export interface BerSnapshot {
  bits: number; // compared data bits (sync bits excluded)
  errors: number;
  ber: number; // errors / bits, 0 when bits = 0
  lo: number; // 95 % Wilson interval
  hi: number;
  synced: boolean;
  resyncs: number;
}

/**
 * Self-synchronising PN9 BER counter (requirement 10.2). Unsynchronised, it loads the next 9
 * received data bits (from frames with a valid stop bit) into its own LFSR; it then runs that
 * LFSR freely, predicts every next bit and counts mismatches, so one line error counts once. A
 * frame with a framing error counts its 7 data bits as errors. When more than 20 of the last 100
 * compared bits are wrong, it drops synchronisation and loads again (`resyncs` + 1). Totals are
 * cumulative until `reset`.
 */
export class BerCounter {
  private bits = 0;
  private errors = 0;
  private resyncs = 0;
  private synced = false;
  private load = 0; // sync bits loaded so far
  private readonly reg = new Uint8Array(PN9_SYNC_BITS); // last 9 sequence bits, reg[k] = a[n - 9 + k]
  private regPos = 0; // ring start (oldest)
  private readonly window = new Uint8Array(BER_RESYNC_WINDOW);
  private windowPos = 0;
  private windowFill = 0;
  private windowErrors = 0;

  pushFrame(value: number, framingOk: boolean): void {
    const valid = Number.isInteger(value) && value >= 0 && value <= 127;
    if (!framingOk || !valid) {
      if (this.synced) {
        // Unreliable frame: the LFSR advances over its 7 bits, all counted as errors (stops if
        // the errors drop the lock).
        for (let i = 0; i < DATA_BITS && this.synced; i++) {
          this.predict();
          this.record(1);
        }
      }
      this.load = 0; // the 9 sync bits must be consecutive and reliable
      return;
    }
    for (let i = 0; i < DATA_BITS; i++) {
      const bit = (value >> i) & 1;
      if (this.synced) {
        this.record((this.predict() ^ bit) & 1);
      } else {
        // Loading (also the rest of a frame in which a resync dropped the lock).
        this.shiftIn(bit);
        if (++this.load === PN9_SYNC_BITS) this.synced = true;
      }
    }
  }

  snapshot(): BerSnapshot {
    const { lo, hi } = wilson95(this.errors, this.bits);
    return {
      bits: this.bits,
      errors: this.errors,
      ber: this.bits > 0 ? this.errors / this.bits : 0,
      lo,
      hi,
      synced: this.synced,
      resyncs: this.resyncs,
    };
  }

  reset(): void {
    this.bits = 0;
    this.errors = 0;
    this.resyncs = 0;
    this.dropSync();
  }

  /** Next bit predicted by the free-running LFSR, a[n] = a[n - 4] XOR a[n - 9]; shifts it in. */
  private predict(): number {
    const r = this.reg;
    const p = this.regPos;
    const bit = r[(p + 5) % PN9_SYNC_BITS] ^ r[p];
    this.shiftIn(bit);
    return bit;
  }

  private shiftIn(bit: number): void {
    this.reg[this.regPos] = bit;
    this.regPos = (this.regPos + 1) % PN9_SYNC_BITS;
  }

  /** Counts one compared bit (err = 1 when wrong) and updates the resync window. */
  private record(err: number): void {
    this.bits++;
    this.errors += err;
    if (this.windowFill === BER_RESYNC_WINDOW) this.windowErrors -= this.window[this.windowPos];
    else this.windowFill++;
    this.window[this.windowPos] = err;
    this.windowErrors += err;
    this.windowPos = (this.windowPos + 1) % BER_RESYNC_WINDOW;
    if (this.windowErrors > BER_RESYNC_ERRORS) {
      this.resyncs++;
      this.dropSync();
    }
  }

  private dropSync(): void {
    this.synced = false;
    this.load = 0;
    this.reg.fill(0);
    this.regPos = 0;
    this.window.fill(0);
    this.windowPos = 0;
    this.windowFill = 0;
    this.windowErrors = 0;
  }
}
