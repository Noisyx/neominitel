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
import { envelope, raisedCosine, renderFsk, renderTone, type FskTimeline } from '../../src/modem/oscillator';
import {
  MODULATE_DEFAULTS,
  buildLineBits,
  effectiveRampSamples,
  lineBitCount,
  minRampSamples,
  modulate,
} from '../../src/modem/modulator';
import type { ModulateOptions } from '../../src/modem';
import { STANDARD_SAMPLE_RATES, arbStandardSampleRate, isSlowTestsEnabled } from '../helpers';

const NUM_RUNS = isSlowTestsEnabled() ? 2000 : 200;
const SIGNAL_RUNS = isSlowTestsEnabled() ? 300 : 30;
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

// ---------------------------------------------------------------------------------------------
// Task 3.1: oscillator (I1)
// ---------------------------------------------------------------------------------------------

/**
 * Independent reference phase in cycles, built by summing the cycles of each whole bit
 * (a different method from the closed form used in oscillator.ts).
 */
function referenceCycles(tl: FskTimeline, t: number): number {
  const { baud, markHz, spaceHz, leadS, bits } = tl;
  if (t < leadS) return markHz * t;
  let c = markHz * leadS;
  const k = Math.min(bits.length, Math.floor((t - leadS) * baud));
  for (let j = 0; j < k; j++) c += (bits[j] === 0 ? spaceHz : markHz) / baud;
  const tk = leadS + k / baud;
  const f = k < bits.length && bits[k] === 0 ? spaceHz : markHz;
  return c + f * (t - tk);
}

/**
 * Residual energy of the least-squares fit x[n] ~ a cos(2 pi f n / fs) + b sin(2 pi f n / fs)
 * over [from, to). Inside one bit the signal is a pure tone, so the right frequency fits exactly.
 */
function toneFitResidual(x: Float32Array, fs: number, f: number, from: number, to: number): number {
  let cc = 0, ss = 0, cs = 0, xc = 0, xs = 0;
  for (let n = from; n < to; n++) {
    const c = Math.cos((2 * Math.PI * f * n) / fs);
    const s = Math.sin((2 * Math.PI * f * n) / fs);
    cc += c * c; ss += s * s; cs += c * s; xc += x[n] * c; xs += x[n] * s;
  }
  const det = cc * ss - cs * cs;
  const a = (xc * ss - xs * cs) / det;
  const b = (xs * cc - xc * cs) / det;
  let r = 0;
  for (let n = from; n < to; n++) {
    const e = x[n] - a * Math.cos((2 * Math.PI * f * n) / fs) - b * Math.sin((2 * Math.PI * f * n) / fs);
    r += e * e;
  }
  return r;
}

/** |sum x[n] e^{-j 2 pi f n / fs}| over [from, to). */
function toneMagnitude(x: Float32Array, fs: number, f: number, from: number, to: number): number {
  let re = 0;
  let im = 0;
  for (let n = from; n < to; n++) {
    const a = (2 * Math.PI * f * n) / fs;
    re += x[n] * Math.cos(a);
    im -= x[n] * Math.sin(a);
  }
  return Math.hypot(re, im);
}

function maxStep(x: Float32Array): number {
  let m = 0;
  for (let n = 0; n + 1 < x.length; n++) m = Math.max(m, Math.abs(x[n + 1] - x[n]));
  return m;
}

const arbBits = (min: number, max: number) =>
  fc.array(fc.integer({ min: 0, max: 1 }), { minLength: min, maxLength: max }).map((a) => Uint8Array.from(a));

function timelineFor(channel: 'forward' | 'backward', fs: number, leadS: number, bits: Uint8Array): FskTimeline {
  const c = CHANNELS[channel];
  return { sampleRate: fs, baud: c.baud, markHz: c.markHz, spaceHz: c.spaceHz, leadS, bits };
}

function lengthFor(tl: FskTimeline, tailS: number): number {
  return Math.round(tl.sampleRate * (tl.leadS + tl.bits.length / tl.baud + tailS));
}

describe('v23-modem task 3.1: phase-continuous oscillator', () => {
  it('raisedCosine: w(0) = 0, w(R) = 1, monotone, w(m) + w(R - m) = 1, no ramp when R = 0', () => {
    expect(raisedCosine(0, 0)).toBe(1);
    expect(raisedCosine(5, 0)).toBe(1);
    const R = 4;
    const expected = [0, 0.5 * (1 - Math.cos(Math.PI / 4)), 0.5, 0.5 * (1 - Math.cos((3 * Math.PI) / 4)), 1, 1];
    [0, 1, 2, 3, 4, 5].forEach((m, i) => expect(raisedCosine(m, R)).toBeCloseTo(expected[i], 14));
    expect(raisedCosine(0, R)).toBe(0);
    expect(raisedCosine(R, R)).toBe(1);
    for (const r of [1, 7, 40, 480]) {
      let prev = -1;
      for (let m = 0; m <= r; m++) {
        const w = raisedCosine(m, r);
        expect(w).toBeGreaterThanOrEqual(prev);
        expect(w + raisedCosine(r - m, r)).toBeCloseTo(1, 12);
        prev = w;
      }
    }
  });

  it('envelope: first sample 0, last sample 0, full amplitude between, min() when ramps overlap', () => {
    const N = 100;
    expect(envelope(0, N, 10, 10)).toBe(0);
    expect(envelope(N - 1, N, 10, 10)).toBe(0);
    expect(envelope(10, N, 10, 10)).toBe(1);
    expect(envelope(N - 1 - 10, N, 10, 10)).toBe(1);
    expect(envelope(N - 1, N, 10, 0)).toBe(1);
    expect(envelope(0, N, 0, 10)).toBe(1);
    // Overlap: N = 10 with two 8-sample ramps.
    for (let n = 0; n < 10; n++) {
      expect(envelope(n, 10, 8, 8)).toBe(Math.min(raisedCosine(n, 8), raisedCosine(9 - n, 8)));
    }
  });

  it('renderFsk matches an independent per-bit phase reference within float32 precision (8 rates, both channels)', () => {
    fc.assert(
      fc.property(
        arbStandardSampleRate(),
        fc.constantFrom<'forward' | 'backward'>('forward', 'backward'),
        fc.double({ min: 0, max: 0.2, noNaN: true }),
        arbBits(0, 40),
        (fs, channel, leadS, bits) => {
          const tl = timelineFor(channel, fs, leadS, bits);
          const out = new Float32Array(lengthFor(tl, 0.02));
          renderFsk(out, tl, 0.5, 0, 0);
          let worst = 0;
          for (let n = 0; n < out.length; n++) {
            const c = referenceCycles(tl, n / fs);
            const ref = 0.5 * Math.sin(2 * Math.PI * (c - Math.floor(c)));
            worst = Math.max(worst, Math.abs(out[n] - ref));
          }
          expect(worst).toBeLessThanOrEqual(2e-6);
          if (out.length > 0) expect(out[0]).toBe(0);
        },
      ),
      { numRuns: SIGNAL_RUNS },
    );
  });

  it('renderFsk stays on the reference phase over a long transmission (no accumulated drift)', () => {
    const fs = isSlowTestsEnabled() ? 48000 : 8000;
    const seconds = isSlowTestsEnabled() ? 60 : 10;
    const nBits = Math.floor(seconds * CHANNELS.forward.baud);
    const bits = new Uint8Array(nBits);
    let s = 12345;
    for (let i = 0; i < nBits; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      bits[i] = (s >>> 16) & 1;
    }
    const tl = timelineFor('forward', fs, 0.1, bits);
    const out = new Float32Array(lengthFor(tl, 0.05));
    renderFsk(out, tl, 0.5, 0, 0);
    // Check the last second against the reference (the reference sums bit cycles incrementally).
    const tlEnd = tl.leadS + nBits / tl.baud;
    let c = tl.markHz * tl.leadS;
    let k = 0;
    let worst = 0;
    for (let n = Math.max(0, out.length - fs); n < out.length; n++) {
      const t = n / fs;
      const kk = Math.min(nBits, Math.floor((t - tl.leadS) * tl.baud));
      while (k < kk) { c += (bits[k] === 0 ? tl.spaceHz : tl.markHz) / tl.baud; k++; }
      const tk = tl.leadS + k / tl.baud;
      const f = t < tlEnd && bits[k] === 0 ? tl.spaceHz : tl.markHz;
      const cyc = c + f * (t - tk);
      const ref = 0.5 * Math.sin(2 * Math.PI * (cyc - Math.floor(cyc)));
      worst = Math.max(worst, Math.abs(out[n] - ref));
    }
    expect(worst).toBeLessThanOrEqual(5e-6);
  });

  it('every line bit is carried by its own tone (least-squares tone fit inside each bit, 8 rates, both channels)', () => {
    for (const channel of ['forward', 'backward'] as const) {
      for (const fs of STANDARD_SAMPLE_RATES) {
        const bits = Uint8Array.from([0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0]);
        const tl = timelineFor(channel, fs, 0.01, bits);
        const out = new Float32Array(lengthFor(tl, 0.01));
        renderFsk(out, tl, 0.5, 0, 0);
        for (let k = 0; k < bits.length; k++) {
          // Strictly inside bit k (5 % margin on each side): the signal is a pure tone there.
          const from = Math.ceil(fs * (tl.leadS + (k + 0.05) / tl.baud));
          const to = Math.floor(fs * (tl.leadS + (k + 0.95) / tl.baud)) + 1;
          const own = toneFitResidual(out, fs, bits[k] ? tl.markHz : tl.spaceHz, from, to);
          const other = toneFitResidual(out, fs, bits[k] ? tl.spaceHz : tl.markHz, from, to);
          expect(own).toBeLessThan(1e-10); // float32 rounding only
          expect(other).toBeGreaterThan(1e3 * own + 1e-9);
        }
      }
    }
  });

  it('renderFsk step bound |x[n+1] - x[n]| <= A 2 pi f_max / fs + 1e-6, with and without ramps of 1 to 10 ms', () => {
    fc.assert(
      fc.property(
        arbStandardSampleRate(),
        fc.constantFrom<'forward' | 'backward'>('forward', 'backward'),
        fc.oneof(fc.constant(5), fc.double({ min: 1, max: 10, noNaN: true }), fc.constant(0)),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        arbBits(0, 30),
        (fs, channel, rampMs, amplitude, bits) => {
          const tl = timelineFor(channel, fs, rampMs / 1000, bits);
          const out = new Float32Array(lengthFor(tl, rampMs / 1000));
          const ramp = Math.round((fs * rampMs) / 1000);
          renderFsk(out, tl, amplitude, ramp, ramp);
          const fMax = Math.max(tl.markHz, tl.spaceHz);
          expect(maxStep(out)).toBeLessThanOrEqual((amplitude * 2 * Math.PI * fMax) / fs + 1e-6);
        },
      ),
      { numRuns: SIGNAL_RUNS },
    );
  });

  it('renderFsk is deterministic, writes the whole buffer and respects the peak amplitude', () => {
    const tl = timelineFor('forward', 44100, 0.1, Uint8Array.from([0, 1, 0, 0, 1, 1, 0, 1, 0, 1]));
    const a = new Float32Array(lengthFor(tl, 0.05)).fill(Number.NaN);
    const b = new Float32Array(a.length);
    renderFsk(a, tl, 0.7, 220, 220);
    renderFsk(b, tl, 0.7, 220, 220);
    expect(a).toEqual(b);
    expect(a.every((v) => Number.isFinite(v) && Math.abs(v) <= 0.7 + 1e-7)).toBe(true);
    expect(Math.abs(a[0])).toBe(0);
    expect(Math.abs(a[a.length - 1])).toBe(0); // envelope 0 (the sign of a zero is irrelevant)
  });

  it('renderTone: correct frequency, ramps at both ends, samples outside the range untouched', () => {
    const fs = 48000;
    const len = 4800;
    const out = new Float32Array(len + 20).fill(9);
    renderTone(out, 10, len, fs, ANSWER_TONE_HZ, 0.5, 240);
    expect(out[9]).toBe(9);
    expect(out[10 + len]).toBe(9);
    expect(Math.abs(out[10])).toBe(0);
    expect(Math.abs(out[10 + len - 1])).toBe(0);
    const seg = out.subarray(10, 10 + len);
    const on = toneMagnitude(seg, fs, ANSWER_TONE_HZ, 0, len);
    const off = toneMagnitude(seg, fs, CHANNELS.forward.markHz, 0, len);
    expect(on).toBeGreaterThan(50 * off);
    expect(maxStep(seg)).toBeLessThanOrEqual((0.5 * 2 * Math.PI * ANSWER_TONE_HZ) / fs + 1e-6);
    // Ramp clamped to half the length for very short tones; zero length writes nothing.
    const short = new Float32Array(6).fill(9);
    renderTone(short, 0, 6, fs, ANSWER_TONE_HZ, 0.5, 240);
    expect(Math.abs(short[0])).toBe(0);
    expect(Math.abs(short[5])).toBe(0);
    const none = new Float32Array(3).fill(9);
    renderTone(none, 1, 0, fs, ANSWER_TONE_HZ, 0.5, 240);
    expect([...none]).toEqual([9, 9, 9]);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 3.2 / 3.4: modulate() (I2)
// ---------------------------------------------------------------------------------------------

/**
 * Idle duration in ms: 0, sub-millisecond (0 < d < 1), or 1 to 200 ms. The contract accepts any
 * finite non-negative duration, so sub-millisecond idles are part of the domain.
 */
const arbIdleMs = () =>
  fc.oneof(
    fc.constant(0),
    fc.constantFrom(0.1, 0.25, 0.5, 0.9),
    fc.double({ min: 0.01, max: 0.999, noNaN: true }),
    fc.double({ min: 1, max: 200, noNaN: true }),
  );
const SUB_MS_IDLES = [0.1, 0.25, 0.5, 0.9];
const arbRampMs = () => fc.oneof(fc.constant(MODULATE_DEFAULTS.rampMs), fc.double({ min: 1, max: 10, noNaN: true }));
const arbChannel = () => fc.constantFrom<'forward' | 'backward'>('forward', 'backward');
const arbBytes = (max: number) =>
  fc.array(fc.integer({ min: 0, max: MAX_FRAME_VALUE }), { minLength: 0, maxLength: max }).map((a) => Uint8Array.from(a));

function mustModulate(bytes: Uint8Array, o: ModulateOptions): Float32Array {
  const r = modulate(bytes, o);
  if (!r.ok) throw new Error(`modulate failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('v23-modem task 3.2: modulate() validation (typed errors, never throws)', () => {
  const bytes = Uint8Array.from([0x41, 0x42]);

  it('rejects sample rates outside 8000..96000 Hz with bad-sample-rate', () => {
    for (const sampleRate of [7999, 96001, 0, -48000, Number.NaN, Infinity]) {
      expect(modulate(bytes, { sampleRate })).toEqual({ ok: false, error: { kind: 'bad-sample-rate', sampleRate } });
    }
    for (const sampleRate of [8000, 44100.5, 96000]) expect(modulate(bytes, { sampleRate }).ok).toBe(true);
  });

  it('reports the first byte above 127 with its index and value', () => {
    expect(modulate(Uint8Array.from([1, 2, 200, 128]), { sampleRate: 8000 })).toEqual({
      ok: false, error: { kind: 'byte-out-of-range', index: 2, value: 200 },
    });
    expect(modulate(Uint8Array.from([128]), { sampleRate: 8000 })).toEqual({
      ok: false, error: { kind: 'byte-out-of-range', index: 0, value: 128 },
    });
  });

  it('checks the sample rate first, then options, then bytes', () => {
    const badBytes = Uint8Array.from([255]);
    expect(modulate(badBytes, { sampleRate: 1, amplitude: 2 })).toMatchObject({ error: { kind: 'bad-sample-rate' } });
    expect(modulate(badBytes, { sampleRate: 8000, amplitude: 2 })).toMatchObject({ error: { kind: 'bad-option', option: 'amplitude' } });
  });

  it('rejects invalid options with bad-option naming the option', () => {
    const cases: [Partial<ModulateOptions>, string][] = [
      [{ amplitude: 0 }, 'amplitude'],
      [{ amplitude: 1.0001 }, 'amplitude'],
      [{ amplitude: Number.NaN }, 'amplitude'],
      [{ leadIdleMs: -1 }, 'leadIdleMs'],
      [{ tailIdleMs: Infinity }, 'tailIdleMs'],
      [{ rampMs: -0.5 }, 'rampMs'],
      [{ interFrameIdleBits: 1.5 }, 'interFrameIdleBits'],
      [{ interFrameIdleBits: -1 }, 'interFrameIdleBits'],
      [{ bitErrors: [20] }, 'bitErrors'], // 2 frames = 20 line bits: valid indices are 0..19
      [{ bitErrors: [-1] }, 'bitErrors'],
      [{ bitErrors: [0.5] }, 'bitErrors'],
      [{ channel: 'sideways' as never }, 'channel'],
    ];
    for (const [opts, option] of cases) {
      const r = modulate(bytes, { sampleRate: 8000, ...opts });
      expect(r).toMatchObject({ ok: false, error: { kind: 'bad-option', option } });
    }
    expect(modulate(bytes, { sampleRate: 8000, amplitude: 1 }).ok).toBe(true);
    expect(modulate(bytes, { sampleRate: 8000, bitErrors: [19] }).ok).toBe(true);
  });

  it('accepts empty input: n = 0 gives only the idle carrier, and n = 0 with no idle gives an empty array', () => {
    const fs = 8000;
    expect(mustModulate(new Uint8Array(0), { sampleRate: fs }).length).toBe(Math.round(fs * (0.1 + 0.05)));
    expect(mustModulate(new Uint8Array(0), { sampleRate: fs, leadIdleMs: 0, tailIdleMs: 0 }).length).toBe(0);
    // Every index is out of range when there is no line bit.
    expect(modulate(new Uint8Array(0), { sampleRate: fs, bitErrors: [0] })).toMatchObject({ error: { option: 'bitErrors' } });
  });
});

describe('v23-modem task 3.4: modulator properties', () => {
  it('M2 exact length: output length = round(fs (lead + 10 n / baud + idle bits / baud + tail)) +/- 1', () => {
    fc.assert(
      fc.property(
        arbStandardSampleRate(), arbChannel(), arbBytes(60), arbIdleMs(), arbIdleMs(), fc.integer({ min: 0, max: 5 }),
        (fs, channel, bytes, lead, tail, idleBits) => {
          const out = mustModulate(bytes, { sampleRate: fs, channel, leadIdleMs: lead, tailIdleMs: tail, interFrameIdleBits: idleBits });
          const n = bytes.length;
          const baud = CHANNELS[channel].baud;
          const exact = fs * (lead / 1000 + (FRAME.bitsPerFrame * n) / baud + (idleBits * Math.max(0, n - 1)) / baud + tail / 1000);
          expect(Math.abs(out.length - Math.round(exact))).toBeLessThanOrEqual(1);
          expect(lineBitCount(n, idleBits)).toBe(n === 0 ? 0 : FRAME.bitsPerFrame * n + idleBits * (n - 1));
        },
      ),
      { numRuns: SIGNAL_RUNS },
    );
  });

  it('M3 phase continuity: |x[n+1] - x[n]| <= A 2 pi f_max / fs + 1e-6 on the final Float32Array, ramps included', () => {
    let worstRatio = 0;
    let worstExcess = -Infinity;
    let worstCase = '';
    fc.assert(
      fc.property(
        arbStandardSampleRate(), arbChannel(), arbBytes(12), arbIdleMs(), arbIdleMs(), arbRampMs(),
        fc.double({ min: 0.01, max: 1, noNaN: true }), fc.integer({ min: 0, max: 3 }),
        (fs, channel, bytes, lead, tail, rampMs, amplitude, idleBits) => {
          const out = mustModulate(bytes, {
            sampleRate: fs, channel, leadIdleMs: lead, tailIdleMs: tail, rampMs, amplitude, interFrameIdleBits: idleBits,
          });
          const fMax = Math.max(CHANNELS[channel].markHz, CHANNELS[channel].spaceHz);
          const bound = (amplitude * 2 * Math.PI * fMax) / fs;
          const step = maxStep(out);
          if (step / bound > worstRatio) {
            worstRatio = step / bound;
            worstCase = `fs=${fs} ${channel} rampMs=${rampMs.toFixed(3)} A=${amplitude.toFixed(3)}`;
          }
          worstExcess = Math.max(worstExcess, step - bound);
          expect(step).toBeLessThanOrEqual(bound + 1e-6);
        },
      ),
      { numRuns: SIGNAL_RUNS },
    );
    // Margin report: worst observed step as a fraction of the bound (must stay <= 1).
    console.log(
      `M3 worst step / bound = ${worstRatio.toFixed(8)} (${worstCase}); worst (step - bound) = ${worstExcess.toExponential(3)}`,
    );
  });

  it('M4 parity: every generated frame has even weight over data + parity, and inverting a line bit 1..8 gives parityOk = false', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: MAX_FRAME_VALUE }), { minLength: 1, maxLength: 30 }).map((a) => Uint8Array.from(a)),
        fc.integer({ min: 0, max: 3 }),
        fc.nat(),
        fc.integer({ min: FIRST_DATA_BIT_INDEX, max: PARITY_BIT_INDEX }),
        (bytes, idleBits, framePick, bitInFrame) => {
          const stride = FRAME.bitsPerFrame + idleBits;
          const clean = buildLineBits(bytes, idleBits);
          for (let i = 0; i < bytes.length; i++) {
            let weight = 0;
            for (let j = FIRST_DATA_BIT_INDEX; j <= PARITY_BIT_INDEX; j++) weight += clean[i * stride + j];
            expect(weight % 2).toBe(0);
            expect(lineBitsToByte(clean, i * stride)).toEqual({ value: bytes[i], parityOk: true, framingOk: true });
          }
          const f = framePick % bytes.length;
          const damaged = buildLineBits(bytes, idleBits, [f * stride + bitInFrame]);
          for (let i = 0; i < bytes.length; i++) {
            const d = lineBitsToByte(damaged, i * stride);
            expect(d.parityOk).toBe(i !== f);
            expect(d.framingOk).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('the audio carries exactly the line bits, bitErrors included (least-squares tone fit per bit)', () => {
    fc.assert(
      fc.property(
        arbStandardSampleRate(), arbChannel(),
        fc.array(fc.integer({ min: 0, max: MAX_FRAME_VALUE }), { minLength: 1, maxLength: 4 }).map((a) => Uint8Array.from(a)),
        fc.integer({ min: 0, max: 2 }), fc.nat(),
        (fs, channel, bytes, idleBits, pick) => {
          const nBits = lineBitCount(bytes.length, idleBits);
          const bitErrors = [pick % nBits];
          const spec = CHANNELS[channel];
          const out = mustModulate(bytes, { sampleRate: fs, channel, interFrameIdleBits: idleBits, bitErrors, leadIdleMs: 20, tailIdleMs: 20 });
          const bits = buildLineBits(bytes, idleBits, bitErrors);
          const t0 = 0.02;
          for (let k = 0; k < nBits; k++) {
            const from = Math.ceil(fs * (t0 + (k + 0.05) / spec.baud));
            const to = Math.floor(fs * (t0 + (k + 0.95) / spec.baud)) + 1;
            const own = toneFitResidual(out, fs, bits[k] ? spec.markHz : spec.spaceHz, from, to);
            const other = toneFitResidual(out, fs, bits[k] ? spec.spaceHz : spec.markHz, from, to);
            expect(own).toBeLessThan(1e-10);
            expect(other).toBeGreaterThan(1e3 * own + 1e-9);
          }
        },
      ),
      { numRuns: SIGNAL_RUNS },
    );
  });

  it('ramps never touch a frame sample, follow the raised cosine, and are limited to the available idle', () => {
    fc.assert(
      fc.property(
        arbStandardSampleRate(), arbChannel(), arbBytes(6), arbIdleMs(), arbIdleMs(), arbRampMs(),
        (fs, channel, bytes, lead, tail, rampMs) => {
          const spec = CHANNELS[channel];
          const out = mustModulate(bytes, { sampleRate: fs, channel, leadIdleMs: lead, tailIdleMs: tail, rampMs });
          const ref = new Float32Array(out.length);
          renderFsk(ref, timelineFor(channel, fs, lead / 1000, buildLineBits(bytes, 0)), MODULATE_DEFAULTS.amplitude, 0, 0);
          const t0 = lead / 1000;
          const tEnd = t0 + lineBitCount(bytes.length, 0) / spec.baud;
          const firstData = Math.ceil(fs * t0 - 1e-9);
          const firstTail = Math.ceil(fs * tEnd - 1e-9);
          for (let n = firstData; n < Math.min(firstTail, out.length); n++) expect(out[n]).toBe(ref[n]);
          const fMax = Math.max(spec.markHz, spec.spaceHz);
          const leadSamples = Math.min(out.length, firstData);
          const tailSamples = Math.max(0, out.length - firstTail);
          const rIn = effectiveRampSamples(fs, rampMs, lead, leadSamples, fMax);
          const rOut = effectiveRampSamples(fs, rampMs, tail, tailSamples, fMax);
          for (let n = 0; n < Math.min(rIn, out.length); n++) {
            const w = envelope(n, out.length, rIn, rOut);
            expect(Math.abs(out[n] - w * ref[n])).toBeLessThanOrEqual(1e-6);
          }
          if (out.length > 0) {
            expect(Math.abs(out[0])).toBe(0);
            const last = out.length - 1;
            if (rOut > 0) expect(Math.abs(out[last])).toBe(0);
            // No ramp-down: the last sample keeps the envelope of the other side (ramp-up if the
            // signal is only idle), i.e. the un-ramped value unless a ramp-up reaches it.
            else expect(Math.abs(out[last] - envelope(last, out.length, rIn, 0) * ref[last])).toBeLessThanOrEqual(1e-6);
          }
        },
      ),
      { numRuns: SIGNAL_RUNS },
    );
  });

  it('minRampSamples = ceil(fs / (2 sqrt 2 f_max)) and is at most 0.88 ms at every supported rate', () => {
    expect(minRampSamples(8000, 2100)).toBe(2);
    expect(minRampSamples(48000, 2100)).toBe(9);
    expect(minRampSamples(96000, 2100)).toBe(17);
    expect(minRampSamples(8000, 450)).toBe(7);
    expect(minRampSamples(48000, 450)).toBe(38);
    expect(minRampSamples(96000, 450)).toBe(76);
    for (const fs of STANDARD_SAMPLE_RATES) {
      for (const spec of Object.values(CHANNELS)) {
        const r = minRampSamples(fs, Math.max(spec.markHz, spec.spaceHz));
        expect(r / fs).toBeLessThanOrEqual(0.00088);
        // 1 ms (the T3-4 domain) always keeps its ramp.
        expect(Math.round(fs * 0.001)).toBeGreaterThanOrEqual(r);
      }
    }
  });

  it('sub-millisecond idles (0.1, 0.25, 0.5, 0.9 ms): idle sample counts, no ramp/frame overlap, end samples, M3', () => {
    let worst = { ratio: 0, excess: -Infinity, at: '' };
    const failures: string[] = [];
    for (const fs of STANDARD_SAMPLE_RATES) {
      for (const channel of ['forward', 'backward'] as const) {
        const spec = CHANNELS[channel];
        for (const lead of [0, ...SUB_MS_IDLES]) {
          for (const tail of [0, ...SUB_MS_IDLES]) {
            const bytes = Uint8Array.from([0x41, 0x7f]);
            const out = mustModulate(bytes, { sampleRate: fs, channel, leadIdleMs: lead, tailIdleMs: tail });
            const nBits = lineBitCount(bytes.length, 0);
            const t0 = lead / 1000;
            const tEnd = t0 + nBits / spec.baud;
            // Idle sample counts: samples with t < t0, and samples with t >= end of the last bit.
            const leadSamples = Math.ceil(fs * t0 - 1e-9);
            const firstTail = Math.ceil(fs * tEnd - 1e-9);
            expect(out.length).toBe(Math.round(fs * (tEnd + tail / 1000)));
            expect(leadSamples).toBe(Math.ceil(fs * t0 - 1e-9));
            // No overlap: every frame sample equals the un-ramped signal.
            const ref = new Float32Array(out.length);
            renderFsk(ref, timelineFor(channel, fs, t0, buildLineBits(bytes, 0)), MODULATE_DEFAULTS.amplitude, 0, 0);
            for (let n = leadSamples; n < Math.min(firstTail, out.length); n++) {
              if (out[n] !== ref[n]) failures.push(`overlap fs=${fs} ${channel} lead=${lead} tail=${tail} n=${n}`);
            }
            // Effective ramps: 0, or between R_min and the idle sample count; exact envelope.
            const fMaxHz = Math.max(spec.markHz, spec.spaceHz);
            const rMin = minRampSamples(fs, fMaxHz);
            const tailSamples = Math.max(0, out.length - firstTail);
            const rIn = effectiveRampSamples(fs, MODULATE_DEFAULTS.rampMs, lead, leadSamples, fMaxHz);
            const rOut = effectiveRampSamples(fs, MODULATE_DEFAULTS.rampMs, tail, tailSamples, fMaxHz);
            expect(rIn === 0 || (rIn >= rMin && rIn <= leadSamples)).toBe(true);
            expect(rOut === 0 || (rOut >= rMin && rOut <= tailSamples)).toBe(true);
            for (let n = 0; n < out.length; n++) {
              const expected = envelope(n, out.length, rIn, rOut) * ref[n];
              if (Math.abs(out[n] - expected) > 1e-6) failures.push(`envelope fs=${fs} ${channel} lead=${lead} tail=${tail} n=${n}`);
            }
            // First sample: the phase starts at 0, so x[0] = 0 with or without a ramp.
            expect(Math.abs(out[0])).toBe(0);
            // Last sample: 0 when a ramp-down is applied, otherwise the un-ramped value.
            const last = out.length - 1;
            if (rOut > 0) expect(Math.abs(out[last])).toBe(0);
            else expect(Math.abs(out[last] - envelope(last, out.length, rIn, 0) * ref[last])).toBeLessThanOrEqual(1e-6);
            // M3 on the final Float32Array.
            const fMax = Math.max(spec.markHz, spec.spaceHz);
            const bound = (MODULATE_DEFAULTS.amplitude * 2 * Math.PI * fMax) / fs;
            const step = maxStep(out);
            if (step / bound > worst.ratio) worst = { ...worst, ratio: step / bound, at: `fs=${fs} ${channel} lead=${lead} tail=${tail}` };
            worst.excess = Math.max(worst.excess, step - bound);
            if (step > bound + 1e-6) failures.push(`M3 fs=${fs} ${channel} lead=${lead} tail=${tail} step/bound=${(step / bound).toFixed(6)}`);
          }
        }
      }
    }
    console.log(`sub-ms worst step / bound = ${worst.ratio.toFixed(8)} (${worst.at}); worst (step - bound) = ${worst.excess.toExponential(3)}; failures=${failures.length}`);
    if (failures.length) console.log(failures.slice(0, 12).join('\n'));
    expect(failures).toEqual([]);
  });

  it('a 2 ms lead with the default 5 ms ramp gives a 2 ms ramp that ends before the first start bit', () => {
    const fs = 48000;
    const out = mustModulate(Uint8Array.from([0x00]), { sampleRate: fs, leadIdleMs: 2 });
    const ref = new Float32Array(out.length);
    renderFsk(ref, timelineFor('forward', fs, 0.002, buildLineBits(Uint8Array.from([0x00]), 0)), 0.5, 0, 0);
    const R = Math.round(fs * 0.002); // 96 samples = the whole lead
    expect(out[R]).toBe(ref[R]);
    expect(Math.abs(out[R - 1])).toBeLessThan(Math.abs(ref[R - 1]) + 1e-9);
    expect(Math.abs(out[R - 1] - raisedCosine(R - 1, R) * ref[R - 1])).toBeLessThanOrEqual(1e-6);
  });

  it('is deterministic and keeps the peak at or below the amplitude (default 0.5)', () => {
    const bytes = Uint8Array.from([...'3615 MATHS'].map((c) => c.charCodeAt(0)));
    const a = mustModulate(bytes, { sampleRate: 44100 });
    const b = mustModulate(bytes, { sampleRate: 44100 });
    expect(a).toEqual(b);
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(MODULATE_DEFAULTS.amplitude + 1e-7);
    expect(peak).toBeGreaterThan(0.49);
  });
});
