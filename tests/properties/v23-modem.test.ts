// v23-modem tests (Role B). Correctness properties M1..M13 of .kiro/specs/v23-modem/design.md
// are added here, one test named after each property, as their tasks land.
// Fast mode by default; slow mode (`npm run test:slow`, NEOMINITEL_SLOW=1) runs more cases.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ANSWER_TONE_HZ, CHANNELS, FRAME } from '../../src/modem';
import {
  FIRST_DATA_BIT_INDEX,
  MAX_FRAME_VALUE,
  PARITY_BIT_INDEX,
  START_BIT_INDEX,
  STOP_BIT_INDEX,
  byteToLineBits,
  evenParityBit,
  lineBitsToByte,
} from '../../src/modem/frame';
import { isSlowTestsEnabled } from '../helpers';

const NUM_RUNS = isSlowTestsEnabled() ? 2000 : 200;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('v23-modem task 2.1: channel and frame constants', () => {
  it('CHANNELS and FRAME match the design table (requirements 1.1 to 1.3)', () => {
    // Expected values copied from the design.md "Constants" table on purpose (spec check).
    expect(CHANNELS.forward).toEqual({
      id: 'forward', baud: 1200, markHz: 1300, spaceHz: 2100, mixHz: 1800, lowpassHz: 1100, thresholdHz: 1700,
    });
    expect(CHANNELS.backward).toEqual({
      id: 'backward', baud: 75, markHz: 390, spaceHz: 450, mixHz: 420, lowpassHz: 120, thresholdHz: 420,
    });
    expect(FRAME).toEqual({ dataBits: 7, parity: 'even', stopBits: 1, bitsPerFrame: 10 });
    expect(1 + FRAME.dataBits + 1 + FRAME.stopBits).toBe(FRAME.bitsPerFrame);
    // Characters per second: 120 forward, 7.5 backward.
    expect(CHANNELS.forward.baud / FRAME.bitsPerFrame).toBe(120);
    expect(CHANNELS.backward.baud / FRAME.bitsPerFrame).toBe(7.5);
  });

  it('guard: the single V.23 copy in prototypes/dsp/lib.mjs equals v23.ts (exception U3)', async () => {
    // Non-literal specifier: the prototypes are plain .mjs without type declarations.
    const libUrl = pathToFileURL(join(ROOT, 'prototypes', 'dsp', 'lib.mjs')).href;
    const lib = (await import(/* @vite-ignore */ libUrl)) as {
      V23: { forward: unknown; backward: unknown; frame: unknown };
    };
    expect({ ...(lib.V23.forward as object) }).toEqual(CHANNELS.forward);
    expect({ ...(lib.V23.backward as object) }).toEqual(CHANNELS.backward);
    expect({ ...(lib.V23.frame as object) }).toEqual(FRAME);
  });

  it('guard: no V.23 constant is written as a literal in src/ or scripts/ outside src/modem/v23.ts', () => {
    // Scope: production code (src/, scripts/). Documented exceptions: src/modem/v23.ts (the single
    // source), prototypes/dsp/lib.mjs (exception U3, checked above) and tests/ (expected values).
    // The searched values come from v23.ts itself. Values below 300 (75 bit/s, 120 Hz) are left
    // out: they are too common to search for without false positives.
    const values = new Set<number>([ANSWER_TONE_HZ]);
    for (const spec of Object.values(CHANNELS)) {
      for (const v of [spec.baud, spec.markHz, spec.spaceHz, spec.mixHz, spec.lowpassHz, spec.thresholdHz]) {
        if (v >= 300) values.add(v);
      }
    }
    const pattern = new RegExp(`(^|[^0-9.A-Za-z_])(${[...values].join('|')})(?![0-9.])`);
    const allowed = new Set([join('src', 'modem', 'v23.ts')]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return; // scripts/ may not exist yet
      }
      for (const name of entries) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) {
          const rel = relative(ROOT, p);
          if (allowed.has(rel)) continue;
          const code = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          code.split(/\r?\n/).forEach((line, i) => {
            if (pattern.test(line)) offenders.push(`${rel.split(sep).join('/')}:${i + 1}: ${line.trim()}`);
          });
        }
      }
    };
    walk(join(ROOT, 'src'));
    walk(join(ROOT, 'scripts'));
    expect(offenders).toEqual([]);
  });
});

describe('v23-modem task 2.2 and 2.3: 7E1 framing', () => {
  it('frame layout indices follow [start, d0..d6, parity, stop]', () => {
    expect([START_BIT_INDEX, FIRST_DATA_BIT_INDEX, PARITY_BIT_INDEX, STOP_BIT_INDEX]).toEqual([0, 1, 8, 9]);
    expect(MAX_FRAME_VALUE).toBe(127);
  });

  it('parity of 0x00: all data bits 0, parity bit 0', () => {
    expect(evenParityBit(0x00)).toBe(0);
    expect([...byteToLineBits(0x00)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('parity of 0x7F: seven ones, parity bit 1', () => {
    expect(evenParityBit(0x7f)).toBe(1);
    expect([...byteToLineBits(0x7f)]).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("parity of 'A' (0x41): bits d0 and d6 set, parity bit 0, least significant bit first", () => {
    const a = 'A'.charCodeAt(0);
    expect(a).toBe(0x41);
    expect(evenParityBit(a)).toBe(0);
    expect([...byteToLineBits(a)]).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);
  });

  it('round trip over all 128 values: value restored, parityOk and framingOk, even weight', () => {
    for (let v = 0; v <= MAX_FRAME_VALUE; v++) {
      const bits = byteToLineBits(v);
      expect(bits.length).toBe(FRAME.bitsPerFrame);
      expect(bits[START_BIT_INDEX]).toBe(0);
      expect(bits[STOP_BIT_INDEX]).toBe(1);
      let weight = 0;
      for (let i = FIRST_DATA_BIT_INDEX; i <= PARITY_BIT_INDEX; i++) weight += bits[i];
      expect(weight % 2).toBe(0);
      expect(lineBitsToByte(bits)).toEqual({ value: v, parityOk: true, framingOk: true });
    }
  });

  it('a single inverted data or parity bit (line bits 1 to 8) gives parityOk = false', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_FRAME_VALUE }),
        fc.integer({ min: FIRST_DATA_BIT_INDEX, max: PARITY_BIT_INDEX }),
        (v, k) => {
          const bits = byteToLineBits(v);
          bits[k] ^= 1;
          const d = lineBitsToByte(bits);
          expect(d.parityOk).toBe(false);
          expect(d.framingOk).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('an inverted stop bit gives framingOk = false and leaves value and parity intact', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_FRAME_VALUE }), (v) => {
        const bits = byteToLineBits(v);
        bits[STOP_BIT_INDEX] = 0;
        expect(lineBitsToByte(bits)).toEqual({ value: v, parityOk: true, framingOk: false });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the start bit is not checked by the decoder (the UART rejects false starts)', () => {
    const bits = byteToLineBits(0x55);
    bits[START_BIT_INDEX] = 1;
    expect(lineBitsToByte(bits)).toEqual({ value: 0x55, parityOk: true, framingOk: true });
  });

  it('two inverted data bits are not detected by parity (one parity bit detects odd errors only)', () => {
    const bits = byteToLineBits(0x41);
    bits[FIRST_DATA_BIT_INDEX] ^= 1;
    bits[FIRST_DATA_BIT_INDEX + 1] ^= 1;
    const d = lineBitsToByte(bits);
    expect(d.parityOk).toBe(true);
    expect(d.value).not.toBe(0x41);
  });

  it('writes into a caller buffer at an offset and decodes from that offset', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: MAX_FRAME_VALUE }), { minLength: 1, maxLength: 20 }),
        (values) => {
          const buf = new Uint8Array(values.length * FRAME.bitsPerFrame);
          values.forEach((v, i) => byteToLineBits(v, buf, i * FRAME.bitsPerFrame));
          const decoded = values.map((_, i) => lineBitsToByte(buf, i * FRAME.bitsPerFrame).value);
          expect(decoded).toEqual(values);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects out-of-range values and short buffers with a RangeError (internal precondition)', () => {
    for (const bad of [-1, MAX_FRAME_VALUE + 1, 1.5, Number.NaN]) {
      expect(() => byteToLineBits(bad)).toThrow(RangeError);
    }
    expect(() => byteToLineBits(0, new Uint8Array(FRAME.bitsPerFrame - 1))).toThrow(RangeError);
    expect(() => lineBitsToByte(new Uint8Array(FRAME.bitsPerFrame - 1))).toThrow(RangeError);
    expect(() => lineBitsToByte(new Uint8Array(FRAME.bitsPerFrame), 1)).toThrow(RangeError);
  });
});
