// v23-modem tests (Role B). Correctness properties M1..M13 of .kiro/specs/v23-modem/design.md
// are added here, one test named after each property, as their tasks land.
// Fast mode by default; slow mode (`npm run test:slow`, NEOMINITEL_SLOW=1) runs more cases.
import { createHash } from 'node:crypto';
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
  CONNECTION_DEFAULTS,
  MODULATE_DEFAULTS,
  buildLineBits,
  connectionSequence,
  effectiveRampSamples,
  toneRampSamples,
  lineBitCount,
  minRampSamples,
  modulate,
} from '../../src/modem/modulator';
import {
  WAV_ERROR_REASONS,
  WAV_HEADER_BYTES,
  WAV_MAX_SAMPLES,
  readWav,
  writeWav,
  type WavErrorReason,
} from '../../src/modem/wav';
import { readWav as readWavPublic, writeWav as writeWavPublic, type DemodEvent, type ModulateOptions } from '../../src/modem';
import {
  DEFAULT_BURSTS,
  DEFAULT_HUM,
  applyChannel,
  channelLatencySamples,
  createChannel,
  type ChannelParams,
  type LineChannel,
  BerCounter,
  pn9Frames,
  wilson95,
  wilsonInterval,
} from '../../src/modem';
import { m2m4, snrReport } from '../../src/modem/quality';
import { CARRIER, DISCRIMINATOR } from '../../src/modem/v23';
import {
  ComplexDecimatingFir,
  designLowpass,
  hammingTapCount,
  lowpassMagnitude,
  noiseBandwidthHz,
} from '../../src/modem/filters';
import { createDiscriminator, mixerPhaseCycles, type Discriminator } from '../../src/modem/discriminator';
import { carrierLevelDbfs, createDetector } from '../../src/modem/carrier';
import { createDemodulator } from '../../src/modem/demodulator';
import { fixedThresholdHz, softValue } from '../../src/modem/threshold';
import { createUart, type Uart, type UartChar } from '../../src/modem/uart';
import {
  STANDARD_SAMPLE_RATES,
  arbBytes7,
  arbStandardSampleRate,
  awgn,
  createRng,
  isSlowTestsEnabled,
  resample,
} from '../helpers';

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

// ---------------------------------------------------------------------------------------------
// Task 3.3: connectionSequence() (I3)
// ---------------------------------------------------------------------------------------------

/** Expected segment boundaries from cumulative exact durations. */
function connectionBounds(fs: number, a: number, b: number, c: number): [number, number, number] {
  return [Math.round((fs * a) / 1000), Math.round((fs * (a + b)) / 1000), Math.round((fs * (a + b + c)) / 1000)];
}

/** Independent reference of one tone burst: A * envelope * sin(2 pi f i / fs), phase 0 at i = 0. */
function referenceTone(fs: number, f: number, len: number, ramp: number): Float64Array {
  const r = new Float64Array(len);
  for (let i = 0; i < len; i++) r[i] = 0.5 * envelope(i, len, ramp, ramp) * Math.sin((2 * Math.PI * f * i) / fs);
  return r;
}

describe('v23-modem task 3.3: connection sequence', () => {
  it('defaults are the provisional 700 / 150 / 300 ms (T3-3, not normative V.25 values)', () => {
    expect(CONNECTION_DEFAULTS).toEqual({ answerToneMs: 700, silenceMs: 150, carrierMs: 300 });
  });

  it('default sequence at the 8 rates: segment boundaries, exact total length, tone content, silence of exact zeros', () => {
    for (const fs of STANDARD_SAMPLE_RATES) {
      const out = connectionSequence({ sampleRate: fs });
      const [s1, s2, n] = connectionBounds(fs, 700, 150, 300);
      expect(out).toBeInstanceOf(Float32Array);
      // Total = round(fs * 1150 / 1000); e.g. 22050 Hz gives exactly 25357.5 -> 25358 (do not use
      // fs * 1.15, which is 25357.4999... in floating point).
      expect(out.length).toBe(n);
      for (let i = s1; i < s2; i++) expect(out[i]).toBe(0);
      const answer = out.subarray(0, s1);
      const carrier = out.subarray(s2, n);
      const rA = toneRampSamples(fs, s1, ANSWER_TONE_HZ);
      const rC = toneRampSamples(fs, n - s2, CHANNELS.forward.markHz);
      expect(rA).toBe(Math.round(fs * 0.005));
      expect(rC).toBe(Math.round(fs * 0.005));
      // Interior (outside the ramps) is a pure tone at the right frequency, not at the other one.
      const ownA = toneFitResidual(answer, fs, ANSWER_TONE_HZ, rA, s1 - rA);
      const otherA = toneFitResidual(answer, fs, CHANNELS.forward.markHz, rA, s1 - rA);
      expect(ownA).toBeLessThan(1e-9);
      expect(otherA).toBeGreaterThan(1e3 * ownA + 1e-6);
      const ownC = toneFitResidual(carrier, fs, CHANNELS.forward.markHz, rC, carrier.length - rC);
      const otherC = toneFitResidual(carrier, fs, ANSWER_TONE_HZ, rC, carrier.length - rC);
      expect(ownC).toBeLessThan(1e-9);
      expect(otherC).toBeGreaterThan(1e3 * ownC + 1e-6);
    }
  });

  it('matches an independent reference sample by sample (ramps, phase 0 per tone), any durations', () => {
    fc.assert(
      fc.property(
        arbStandardSampleRate(),
        fc.double({ min: 0, max: 1500, noNaN: true }),
        fc.double({ min: 0, max: 300, noNaN: true }),
        fc.double({ min: 0, max: 600, noNaN: true }),
        (fs, a, b, c) => {
          const out = connectionSequence({ sampleRate: fs, answerToneMs: a, silenceMs: b, carrierMs: c });
          const [s1, s2, n] = connectionBounds(fs, a, b, c);
          expect(out.length).toBe(n);
          // Each segment is within 1 sample of its exact length.
          expect(Math.abs(s1 - (fs * a) / 1000)).toBeLessThanOrEqual(1);
          expect(Math.abs(s2 - s1 - (fs * b) / 1000)).toBeLessThanOrEqual(1);
          expect(Math.abs(n - s2 - (fs * c) / 1000)).toBeLessThanOrEqual(1);
          const refA = referenceTone(fs, ANSWER_TONE_HZ, s1, toneRampSamples(fs, s1, ANSWER_TONE_HZ));
          const refC = referenceTone(fs, CHANNELS.forward.markHz, n - s2, toneRampSamples(fs, n - s2, CHANNELS.forward.markHz));
          let worst = 0;
          for (let i = 0; i < s1; i++) worst = Math.max(worst, Math.abs(out[i] - refA[i]));
          for (let i = s1; i < s2; i++) worst = Math.max(worst, Math.abs(out[i]));
          for (let i = s2; i < n; i++) worst = Math.max(worst, Math.abs(out[i] - refC[i - s2]));
          expect(worst).toBeLessThanOrEqual(1e-6);
        },
      ),
      { numRuns: SIGNAL_RUNS },
    );
  });

  it('documented limit: a tone shorter than 2 R_min samples has no ramp and may end abruptly', () => {
    // 0.1 ms answer tone at 96 kHz = 10 samples < 2 * R_min (17): no ramp, abrupt end before the
    // silence. The spec does not require M3 for the connection sequence; this test pins the behaviour.
    const fs = 96000;
    const out = connectionSequence({ sampleRate: fs, answerToneMs: 0.1, silenceMs: 10, carrierMs: 10 });
    const s1 = Math.round(fs * 0.0001);
    expect(toneRampSamples(fs, s1, ANSWER_TONE_HZ)).toBe(0);
    expect(minRampSamples(fs, ANSWER_TONE_HZ)).toBeGreaterThan(Math.floor(s1 / 2));
    const bound = (0.5 * 2 * Math.PI * ANSWER_TONE_HZ) / fs;
    expect(maxStep(out)).toBeGreaterThan(bound);
  });

  it('step bound |x[n+1] - x[n]| <= A 2 pi 2100 / fs + 1e-6 over the whole sequence, silences included (tones of 0 or >= 1 ms)', () => {
    let worstRatio = 0;
    // Tone durations of 0 or at least 1 ms: 1 ms holds 2 R_min samples at every rate (see the
    // documented limit above for shorter tones). The silence may be any duration.
    const arbToneMs = (dflt: number, max: number) =>
      fc.oneof(fc.constant(dflt), fc.constant(0), fc.double({ min: 1, max: 50, noNaN: true }), fc.double({ min: 1, max, noNaN: true }));
    fc.assert(
      fc.property(
        arbStandardSampleRate(),
        arbToneMs(700, 1500),
        fc.oneof(fc.constant(150), fc.constant(0), fc.double({ min: 0, max: 300, noNaN: true })),
        arbToneMs(300, 600),
        (fs, a, b, c) => {
          const out = connectionSequence({ sampleRate: fs, answerToneMs: a, silenceMs: b, carrierMs: c });
          const bound = (0.5 * 2 * Math.PI * ANSWER_TONE_HZ) / fs;
          const step = maxStep(out);
          worstRatio = Math.max(worstRatio, step / bound);
          expect(step).toBeLessThanOrEqual(bound + 1e-6);
        },
      ),
      { numRuns: SIGNAL_RUNS },
    );
    console.log(`connectionSequence worst step / bound = ${worstRatio.toFixed(8)}`);
  });

  it('each tone starts and ends at 0 with the default ramp; peak <= 0.5; deterministic', () => {
    const fs = 48000;
    const a = connectionSequence({ sampleRate: fs });
    const b = connectionSequence({ sampleRate: fs });
    expect(a).toEqual(b);
    const [s1, s2, n] = connectionBounds(fs, 700, 150, 300);
    for (const i of [0, s1 - 1, s2, n - 1]) expect(Math.abs(a[i])).toBe(0);
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.5 + 1e-7);
    expect(peak).toBeGreaterThan(0.49);
  });

  it('zero durations give empty segments; all zero gives an empty array', () => {
    const fs = 16000;
    expect(connectionSequence({ sampleRate: fs, answerToneMs: 0, silenceMs: 0, carrierMs: 0 }).length).toBe(0);
    const noAnswer = connectionSequence({ sampleRate: fs, answerToneMs: 0 });
    expect(noAnswer.length).toBe(Math.round(fs * 0.45));
    for (let i = 0; i < Math.round(fs * 0.15); i++) expect(noAnswer[i]).toBe(0);
    const noSilence = connectionSequence({ sampleRate: fs, silenceMs: 0 });
    expect(noSilence.length).toBe(Math.round(fs * 1.0));
    const answerOnly = connectionSequence({ sampleRate: fs, silenceMs: 0, carrierMs: 0 });
    expect(answerOnly.length).toBe(Math.round(fs * 0.7));
  });

  it('invalid input returns an empty Float32Array and never throws (decision T3-2)', () => {
    const invalid: ConnectionSequenceOptionsLike[] = [
      { sampleRate: 7999 },
      { sampleRate: 96001 },
      { sampleRate: Number.NaN },
      { sampleRate: Infinity },
      { sampleRate: 48000, answerToneMs: -1 },
      { sampleRate: 48000, silenceMs: Number.NaN },
      { sampleRate: 48000, carrierMs: Infinity },
      { sampleRate: 48000, answerToneMs: -0.001, silenceMs: 0, carrierMs: 0 },
    ];
    for (const o of invalid) {
      const out = connectionSequence(o);
      expect(out).toBeInstanceOf(Float32Array);
      expect(out.length).toBe(0);
    }
    expect(connectionSequence(undefined as never)).toEqual(new Float32Array(0));
    expect(connectionSequence({} as never)).toEqual(new Float32Array(0));
  });
});

type ConnectionSequenceOptionsLike = Parameters<typeof connectionSequence>[0];

// ---------------------------------------------------------------------------------------------
// Task 4: WAV input/output. Test files are built byte by byte below, independently of writeWav.

const GUID_TAIL = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

function le16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}
function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}
function concatBytes(parts: ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
/** One RIFF chunk; the pad byte after an odd body is added unless `pad` is false. */
function chunk(id: string, body: ArrayLike<number>, o: { size?: number; pad?: boolean } = {}): Uint8Array {
  const pad = (o.pad ?? true) && body.length % 2 === 1 ? [0] : [];
  return concatBytes([ascii(id), le32(o.size ?? body.length), body, pad]);
}
function riffFile(chunks: Uint8Array[], o: { riffId?: string; form?: string } = {}): Uint8Array {
  const body = concatBytes(chunks);
  return concatBytes([ascii(o.riffId ?? 'RIFF'), le32(4 + body.length), ascii(o.form ?? 'WAVE'), body]);
}
function fmtBody(tag: number, channels: number, rate: number, bits: number, blockAlign = (channels * bits) / 8): number[] {
  return [...le16(tag), ...le16(channels), ...le32(rate), ...le32(rate * blockAlign), ...le16(blockAlign), ...le16(bits)];
}
function extFmtBody(
  subTag: number,
  channels: number,
  rate: number,
  bits: number,
  o: { validBits?: number; cbSize?: number; guidTail?: number[] } = {},
): number[] {
  return [
    ...fmtBody(0xfffe, channels, rate, bits),
    ...le16(o.cbSize ?? 22),
    ...le16(o.validBits ?? bits),
    ...le32(0),
    ...le16(subTag),
    ...(o.guidTail ?? GUID_TAIL),
  ];
}
function wavOf(fmt: number[], data: ArrayLike<number>): Uint8Array {
  return riffFile([chunk('fmt ', fmt), chunk('data', data)]);
}
type SampleFormat = 'pcm8' | 'pcm16' | 'pcm24' | 'float32';
const FORMAT_BITS: Record<SampleFormat, number> = { pcm8: 8, pcm16: 16, pcm24: 24, float32: 32 };
/** Encodes interleaved values: signed integer codes for PCM, float32 values for 'float32'. */
function encodeSamples(format: SampleFormat, values: number[]): Uint8Array {
  const bytes = FORMAT_BITS[format] / 8;
  const out = new Uint8Array(values.length * bytes);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => {
    const p = i * bytes;
    if (format === 'pcm8') view.setUint8(p, v + 128);
    else if (format === 'pcm16') view.setInt16(p, v, true);
    else if (format === 'pcm24') {
      view.setUint8(p, v & 0xff);
      view.setUint8(p + 1, (v >> 8) & 0xff);
      view.setUint8(p + 2, (v >> 16) & 0xff);
    } else view.setFloat32(p, v, true);
  });
  return out;
}
function fmtFor(format: SampleFormat, channels: number, rate: number): number[] {
  return fmtBody(format === 'float32' ? 3 : 1, channels, rate, FORMAT_BITS[format]);
}
/** Value read back from one encoded sample (the reference scaling of requirement 4.2). */
function nominalValue(format: SampleFormat, v: number): number {
  if (format === 'float32') return Math.fround(v);
  return v / 2 ** (FORMAT_BITS[format] - 1);
}
function wavErr(reason: WavErrorReason) {
  return { ok: false, error: { kind: 'wav', reason } };
}
/** clamp(round(x * 32768), -32768, 32767) / 32768, with -0 normalised to 0. */
function quantized16(x: number): number {
  return (Math.min(32767, Math.max(-32768, Math.round(x * 32768))) + 0) / 32768;
}
function expectSamples(r: ReturnType<typeof readWav>, expected: number[], sampleRate?: number): void {
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.value.samples).toBeInstanceOf(Float32Array);
  expect(Array.from(r.value.samples)).toEqual(expected.map((v) => Math.fround(v)));
  if (sampleRate !== undefined) expect(r.value.sampleRate).toBe(sampleRate);
}

describe('v23-modem task 4.1: writeWav', () => {
  it('writes the deterministic 44-byte RIFF header and clamped 16-bit codes (requirement 4.1)', () => {
    const r = writeWav(new Float32Array([0, 0.5, -1, 1]), 48000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(WAV_HEADER_BYTES).toBe(44);
    // Golden bytes, written out by hand from the RIFF/WAVE layout.
    expect(Array.from(r.value)).toEqual([
      ...ascii('RIFF'), 0x2c, 0, 0, 0, ...ascii('WAVE'),
      ...ascii('fmt '), 16, 0, 0, 0, 1, 0, 1, 0, 0x80, 0xbb, 0, 0, 0x00, 0x77, 0x01, 0, 2, 0, 16, 0,
      ...ascii('data'), 8, 0, 0, 0,
      0x00, 0x00, 0x00, 0x40, 0x00, 0x80, 0xff, 0x7f,
    ]);
    const again = writeWav(new Float32Array([0, 0.5, -1, 1]), 48000);
    expect(again).toEqual(r);
  });

  it('an empty signal gives a valid 44-byte file that reads back empty', () => {
    const r = writeWav(new Float32Array(0), 8000);
    expect(r.ok && r.value.length).toBe(44);
    if (!r.ok) return;
    expectSamples(readWav(r.value), [], 8000);
  });

  it('rejects a sample rate that is not an integer in 8 000..96 000 Hz', () => {
    for (const fs of [7999, 96001, 44100.5, 0, -48000, Number.NaN, Infinity]) {
      expect(writeWav(new Float32Array(4), fs)).toEqual({
        ok: false,
        error: { kind: 'bad-sample-rate', sampleRate: fs },
      });
    }
    for (const fs of [8000, 11025, 22050, 44100, 48000, 96000]) expect(writeWav(new Float32Array(4), fs).ok).toBe(true);
  });

  it('rejects non-finite samples with their index (decision W2), and non-Float32Array input', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const x = new Float32Array([0, 0.1, bad, 0]);
      const r = writeWav(x, 48000);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toMatchObject({ kind: 'bad-option', option: 'samples' });
      expect(r.error.kind === 'bad-option' && r.error.reason).toContain('index 2');
    }
    for (const notF32 of [[0, 1], new Float64Array(2), new Int16Array(2), null, undefined]) {
      expect(writeWav(notF32 as never, 48000)).toMatchObject({ ok: false, error: { kind: 'bad-option', option: 'samples' } });
    }
  });

  it('detects RIFF size overflow: WAV_MAX_SAMPLES is the largest count whose sizes fit in uint32', () => {
    expect(WAV_MAX_SAMPLES).toBe(2147483629);
    expect(36 + 2 * WAV_MAX_SAMPLES).toBeLessThanOrEqual(0xffffffff);
    expect(36 + 2 * (WAV_MAX_SAMPLES + 1)).toBeGreaterThan(0xffffffff);
    // A Float32Array whose length reports one sample too many (no 8 GB allocation needed).
    const huge = Object.defineProperty(new Float32Array(0), 'length', { value: WAV_MAX_SAMPLES + 1 });
    const r = writeWav(huge, 48000);
    expect(r).toMatchObject({ ok: false, error: { kind: 'bad-option', option: 'samples' } });
    expect(!r.ok && r.error.kind === 'bad-option' && r.error.reason).toContain('RIFF');
  });
});

describe('v23-modem task 4.2: WAV properties and readWav', () => {
  it('M9 WAV: readWav(writeWav(x)) equals x quantized to 16 bits', () => {
    const arbSample = fc.oneof(
      fc.float({ min: -1.5, max: 1.5, noNaN: true }),
      fc.float({ noNaN: true, noDefaultInfinity: true }),
      fc.constantFrom(0, -0, 1, -1, 0.5 / 32768, -0.5 / 32768, 1.5 / 32768, 32767.5 / 32768, -32768.5 / 32768),
    );
    fc.assert(
      fc.property(fc.array(arbSample, { maxLength: 300 }), fc.integer({ min: 8000, max: 96000 }), (values, fs) => {
        const x = Float32Array.from(values);
        const w = writeWav(x, fs);
        expect(w.ok).toBe(true);
        if (!w.ok) return;
        expect(w.value.length).toBe(44 + 2 * x.length);
        const r = readWav(w.value);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.sampleRate).toBe(fs);
        expect(Array.from(r.value.samples)).toEqual(Array.from(x, quantized16));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('decodes 8/16/24-bit PCM and 32-bit float exactly, multi-channel averaged (requirement 4.2)', () => {
    const arbCase = fc
      .record({
        format: fc.constantFrom<SampleFormat>('pcm8', 'pcm16', 'pcm24', 'float32'),
        channels: fc.integer({ min: 1, max: 8 }),
        frames: fc.integer({ min: 0, max: 40 }),
        rate: fc.oneof(fc.integer({ min: 1, max: 0x7fffffff }), fc.constantFrom(1, 8000, 192000, 0xffffffff)),
      })
      .chain((c) => {
        const bits = FORMAT_BITS[c.format];
        const v =
          c.format === 'float32'
            ? fc.float({ noNaN: true, noDefaultInfinity: true, min: -4, max: 4 })
            : fc.integer({ min: -(2 ** (bits - 1)), max: 2 ** (bits - 1) - 1 });
        return fc.record({ c: fc.constant(c), values: fc.array(v, { minLength: c.channels * c.frames, maxLength: c.channels * c.frames }) });
      });
    fc.assert(
      fc.property(arbCase, ({ c, values }) => {
        const r = readWav(wavOf(fmtFor(c.format, c.channels, c.rate), encodeSamples(c.format, values)));
        const expected: number[] = [];
        for (let f = 0; f < c.frames; f++) {
          let sum = 0;
          for (let ch = 0; ch < c.channels; ch++) sum += nominalValue(c.format, values[f * c.channels + ch]);
          expected.push(sum / c.channels);
        }
        expectSamples(r, expected, c.rate);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('known values: 8-bit unsigned, 24-bit sign extension, stereo mean, float NaN preserved', () => {
    expectSamples(readWav(wavOf(fmtBody(1, 1, 8000, 8), [0, 128, 255, 64])), [-1, 0, 127 / 128, -0.5], 8000);
    expectSamples(
      readWav(wavOf(fmtBody(1, 1, 44100, 24), encodeSamples('pcm24', [0x7fffff, -0x800000, 1, -1]))),
      [0x7fffff / 8388608, -1, 1 / 8388608, -1 / 8388608],
    );
    expectSamples(readWav(wavOf(fmtBody(1, 2, 48000, 16), encodeSamples('pcm16', [16384, -16384, 32767, 32767]))), [0, 32767 / 32768]);
    const f = readWav(wavOf(fmtBody(3, 1, 48000, 32), encodeSamples('float32', [0.25, Number.NaN, 2, -3])));
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.value.samples[0]).toBe(0.25);
    expect(Number.isNaN(f.value.samples[1])).toBe(true);
    expect(Array.from(f.value.samples.subarray(2))).toEqual([2, -3]);
    const st = readWav(wavOf(fmtBody(3, 2, 48000, 32), encodeSamples('float32', [0.25, 0.75, Number.NaN, 1])));
    expect(st.ok && st.value.samples[0]).toBe(0.5);
    expect(st.ok && Number.isNaN(st.value.samples[1])).toBe(true);
  });

  it('WAVE_FORMAT_EXTENSIBLE with PCM or float sub-format; other sub-formats are refused', () => {
    expectSamples(
      readWav(wavOf(extFmtBody(1, 2, 48000, 24, { validBits: 20 }), encodeSamples('pcm24', [0x100000, 0x300000]))),
      [0x200000 / 8388608],
      48000,
    );
    expectSamples(readWav(wavOf(extFmtBody(3, 1, 22050, 32), encodeSamples('float32', [0.125]))), [0.125], 22050);
    expectSamples(readWav(wavOf(extFmtBody(1, 1, 8000, 16, { validBits: 0 }), encodeSamples('pcm16', [-32768]))), [-1]);
    const otherGuid = [...GUID_TAIL];
    otherGuid[13] ^= 1;
    expect(readWav(wavOf(extFmtBody(1, 1, 8000, 16, { guidTail: otherGuid }), [0, 0]))).toEqual(wavErr('unsupported-encoding'));
    expect(readWav(wavOf(extFmtBody(1, 1, 8000, 32), [0, 0, 0, 0]))).toEqual(wavErr('unsupported-encoding'));
    expect(readWav(wavOf(extFmtBody(2, 1, 8000, 16), [0, 0]))).toEqual(wavErr('unsupported-encoding'));
    expect(readWav(wavOf(extFmtBody(1, 1, 8000, 16, { cbSize: 21 }), [0, 0]))).toEqual(wavErr('bad-fmt'));
    expect(readWav(wavOf(extFmtBody(1, 1, 8000, 16, { validBits: 17 }), [0, 0]))).toEqual(wavErr('bad-fmt'));
    expect(readWav(wavOf(extFmtBody(1, 1, 8000, 16).slice(0, 38), [0, 0]))).toEqual(wavErr('bad-fmt'));
  });

  it('skips unknown chunks with odd padding, accepts fmt after data, ignores the RIFF size and trailing junk', () => {
    const data = encodeSamples('pcm16', [100, -200, 300]);
    const expected = [100 / 32768, -200 / 32768, 300 / 32768];
    const fmt = fmtBody(1, 1, 16000, 16);
    const file = riffFile([chunk('LIST', [1, 2, 3]), chunk('fmt ', fmt), chunk('fact', [9]), chunk('data', data), chunk('id3 ', [7, 7, 7, 7, 7])]);
    expectSamples(readWav(file), expected, 16000);
    expectSamples(readWav(riffFile([chunk('data', data), chunk('JUNK', [0]), chunk('fmt ', fmt)])), expected);
    const wrongRiffSize = file.slice();
    wrongRiffSize.set(le32(0), 4);
    expectSamples(readWav(wrongRiffSize), expected);
    // A trailing chunk that runs past the end, and fewer than 8 trailing bytes, are ignored.
    expectSamples(readWav(concatBytes([wavOf(fmt, data), chunk('JUNK', [1, 2], { size: 1000 })])), expected);
    expectSamples(readWav(concatBytes([wavOf(fmt, data), [1, 2, 3]])), expected);
    // Odd-size 8-bit data at the very end of the file, without its pad byte.
    const odd = riffFile([chunk('fmt ', fmtBody(1, 1, 8000, 8)), chunk('data', [128, 0, 255], { pad: false })]);
    expectSamples(readWav(odd), [0, -1, 127 / 128]);
    // The first fmt and data chunks are used.
    const twice = riffFile([
      chunk('fmt ', fmt),
      chunk('data', data),
      chunk('fmt ', fmtBody(1, 2, 8000, 16)),
      chunk('data', [1, 2]),
    ]);
    expectSamples(readWav(twice), expected, 16000);
  });

  it('accepts ArrayBuffer, Uint8Array views with an offset and Node Buffers', () => {
    const file = wavOf(fmtBody(1, 1, 8000, 16), encodeSamples('pcm16', [1234]));
    const expected = [1234 / 32768];
    const ab = new ArrayBuffer(file.length);
    new Uint8Array(ab).set(file);
    expectSamples(readWav(ab), expected);
    const big = new Uint8Array(file.length + 7);
    big.set(file, 3);
    expectSamples(readWav(big.subarray(3, 3 + file.length)), expected);
    expectSamples(readWav(Buffer.from(file)), expected);
  });

  it('typed errors name the problem (requirement 4.3)', () => {
    const fmt16 = fmtBody(1, 1, 8000, 16);
    const valid = wavOf(fmt16, [0, 0]);
    const cases: [Uint8Array, WavErrorReason][] = [
      [new Uint8Array(0), 'too-short'],
      [valid.slice(0, 11), 'too-short'],
      [riffFile([chunk('fmt ', fmt16), chunk('data', [0, 0])], { riffId: 'JUNK' }), 'not-riff'],
      [riffFile([chunk('fmt ', fmt16), chunk('data', [0, 0])], { riffId: 'RIFX' }), 'unsupported-encoding'],
      [riffFile([chunk('fmt ', fmt16), chunk('data', [0, 0])], { riffId: 'RF64' }), 'unsupported-encoding'],
      [riffFile([chunk('fmt ', fmt16), chunk('data', [0, 0])], { form: 'AVI ' }), 'not-wave'],
      [riffFile([]), 'missing-fmt'],
      [riffFile([chunk('data', [0, 0])]), 'missing-fmt'],
      [riffFile([chunk('fmt ', fmt16, { size: 100 })]), 'missing-fmt'],
      [riffFile([chunk('fmt ', fmt16)]), 'missing-data'],
      [riffFile([chunk('fmt ', fmt16), chunk('LIST', [1, 2])]), 'missing-data'],
      [wavOf(fmt16.slice(0, 14), [0, 0]), 'bad-fmt'],
      [wavOf(fmtBody(1, 0, 8000, 16, 2), [0, 0]), 'bad-fmt'],
      [wavOf(fmtBody(1, 1, 0, 16), [0, 0]), 'bad-fmt'],
      [wavOf(fmtBody(1, 2, 8000, 16, 2), [0, 0]), 'bad-fmt'],
      [wavOf(fmtBody(1, 1, 8000, 16, 3), [0, 0, 0]), 'bad-fmt'],
      [wavOf(fmtBody(1, 1, 8000, 32), [0, 0, 0, 0]), 'unsupported-encoding'], // decision W6
      [wavOf(fmtBody(1, 1, 8000, 12, 2), [0, 0]), 'unsupported-encoding'],
      [wavOf(fmtBody(2, 1, 8000, 4, 1), [0]), 'unsupported-encoding'], // MS ADPCM
      [wavOf(fmtBody(6, 1, 8000, 8), [0]), 'unsupported-encoding'], // A-law
      [wavOf(fmtBody(7, 1, 8000, 8), [0]), 'unsupported-encoding'], // mu-law
      [wavOf(fmtBody(3, 1, 8000, 64), new Array(8).fill(0)), 'unsupported-encoding'],
      [wavOf(fmtBody(3, 1, 8000, 16), [0, 0]), 'unsupported-encoding'],
      [riffFile([chunk('fmt ', fmt16), chunk('data', [0, 0], { size: 4 })]), 'data-truncated'],
      [riffFile([chunk('fmt ', fmt16), chunk('data', [0, 0], { size: 0xffffffff })]), 'data-truncated'],
      [riffFile([chunk('fmt ', fmt16), chunk('data', [0, 0, 0])]), 'data-truncated'],
      [riffFile([chunk('fmt ', fmtBody(1, 2, 8000, 24)), chunk('data', new Array(9).fill(0))]), 'data-truncated'],
    ];
    const seen = new Set<string>();
    for (const [file, reason] of cases) {
      expect(readWav(file), reason).toEqual(wavErr(reason));
      seen.add(reason);
    }
    // Every stable code is exercised here except 'too-large' (needs a multi-GB file).
    expect(WAV_ERROR_REASONS).toEqual([
      'too-short', 'not-riff', 'not-wave', 'missing-fmt', 'bad-fmt',
      'unsupported-encoding', 'missing-data', 'data-truncated', 'too-large',
    ]);
    expect([...seen].sort()).toEqual(WAV_ERROR_REASONS.filter((r) => r !== 'too-large').sort());
    for (const notBytes of [null, undefined, 'RIFF', 42, [82, 73, 70, 70], {}]) {
      expect(readWav(notBytes as never)).toMatchObject({ ok: false, error: { kind: 'bad-option', option: 'data' } });
    }
  });

  it('robustness: arbitrary, truncated or corrupted bytes never throw and give a typed result', () => {
    const reasons: readonly string[] = WAV_ERROR_REASONS;
    const check = (bytes: Uint8Array): ReturnType<typeof readWav> => {
      let r: ReturnType<typeof readWav> | undefined;
      expect(() => {
        r = readWav(bytes);
      }).not.toThrow();
      if (r === undefined) throw new Error('unreachable');
      if (r.ok) expect(r.value.samples).toBeInstanceOf(Float32Array);
      else expect(r.error.kind === 'wav' && reasons.includes(r.error.reason)).toBe(true);
      return r;
    };
    const header = riffFile([]);
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), fc.boolean(), (tail, withHeader) => {
        check(withHeader ? concatBytes([header, tail]) : tail);
      }),
      { numRuns: NUM_RUNS },
    );
    // Every truncation of a valid file with an extra chunk: only the full file decodes.
    const full = riffFile([
      chunk('fmt ', fmtBody(1, 2, 8000, 16)),
      chunk('LIST', [1, 2, 3]),
      chunk('data', encodeSamples('pcm16', [1, 2, 3, 4, 5, 6])),
    ]);
    for (let n = 0; n <= full.length; n++) {
      const r = check(full.subarray(0, n));
      expect(r.ok, `length ${n}`).toBe(n === full.length);
      // Once the data chunk header (last 20 bytes: 8 header + 12 body) is complete, the body is short.
      if (n >= full.length - 12 && n < full.length) expect(r).toEqual(wavErr('data-truncated'));
    }
    // Random byte overwrites of a valid extensible file.
    const ext = wavOf(extFmtBody(3, 2, 48000, 32), encodeSamples('float32', [0.1, 0.2, 0.3, 0.4]));
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(ext.length - 1), fc.integer({ min: 0, max: 255 })), { maxLength: 8 }), (edits) => {
        const b = ext.slice();
        for (const [i, v] of edits) b[i] = v;
        check(b);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('round trip through the public barrel: modulate -> writeWav -> readWav', () => {
    const bytes = Uint8Array.from(ascii('3615'));
    const m = modulate(bytes, { sampleRate: 44100 });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const w = writeWavPublic(m.value, 44100);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const r = readWavPublic(w.value);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sampleRate).toBe(44100);
    expect(r.value.samples.length).toBe(m.value.length);
    let maxErr = 0;
    for (let i = 0; i < m.value.length; i++) maxErr = Math.max(maxErr, Math.abs(r.value.samples[i] - m.value[i]));
    expect(maxErr).toBeLessThanOrEqual(0.5 / 32768);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 5: discriminator. Test signals are synthesised here in double precision with closed-form
// phases, independently of the modulator. Task 5 tests the forward channel only (decision T5-4).

const DISC_RUNS = isSlowTestsEnabled() ? 100 : 15;
const FWD = CHANNELS.forward;
const NON_INTEGER_RATES = [8000.5, 11025.25, 22050.75, 44100.3, 47999.9, 95999.5] as const;
const ALL_TEST_RATES: readonly number[] = [...STANDARD_SAMPLE_RATES, ...NON_INTEGER_RATES];
const arbDiscRate = fc.oneof(
  arbStandardSampleRate(),
  fc.constantFrom(...NON_INTEGER_RATES),
  fc.double({ min: 8000, max: 96000, noNaN: true }),
);

function makeDisc(fs: number): Discriminator {
  const r = createDiscriminator(fs);
  if (!r.ok) throw new Error(`createDiscriminator(${fs}): ${JSON.stringify(r.error)}`);
  return r.value;
}

/** x[i] = amp sin(2 pi frac(cycles(i))), with the phase in cycles given in closed form. */
function synth(n: number, amp: number, cycles: (i: number) => number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = cycles(i);
    x[i] = amp * Math.sin(2 * Math.PI * (c - Math.floor(c)));
  }
  return x;
}

function toneCycles(fs: number, fHz: number, phase0: number): (i: number) => number {
  return (i) => (fHz * i) / fs + phase0;
}

interface Estimates {
  t: number[];
  f: number[];
  re: number[];
  im: number[];
  /** false if a block's arrays, count or time grid were inconsistent. */
  consistent: boolean;
}

/**
 * Pushes x in chunks of the given lengths (the remainder in a last chunk) and concatenates the
 * estimates. Checks that every block's arrays have `count` entries, that an empty block has a NaN
 * time, and that each block's first time continues the previous block's grid (+ D).
 */
function runDisc(d: Discriminator, x: Float32Array, chunkLens: readonly number[] = []): Estimates {
  const est: Estimates = { t: [], f: [], re: [], im: [], consistent: true };
  const pushOne = (c: Float32Array): void => {
    const out = d.push(c);
    if (out.freqHz.length !== out.count || out.re.length !== out.count || out.im.length !== out.count) {
      est.consistent = false;
    }
    if (out.count === 0) {
      if (!Number.isNaN(out.firstTimeSamples)) est.consistent = false;
      return;
    }
    if (est.t.length > 0 && out.firstTimeSamples !== est.t[est.t.length - 1] + d.decimation) est.consistent = false;
    for (let m = 0; m < out.count; m++) {
      est.t.push(out.firstTimeSamples + m * d.decimation);
      est.f.push(out.freqHz[m]);
      est.re.push(out.re[m]);
      est.im.push(out.im[m]);
    }
  };
  let pos = 0;
  for (const len of chunkLens) {
    if (pos >= x.length) break;
    const end = Math.min(x.length, pos + len);
    pushOne(x.subarray(pos, end));
    pos = end;
  }
  pushOne(x.subarray(pos));
  return est;
}

/** RMS of f - fHz over the settled estimates. */
function settledRmsHz(d: Discriminator, est: Estimates, fHz: number): number {
  let se = 0;
  let n = 0;
  for (let m = 0; m < est.t.length; m++) {
    if (est.t[m] < d.settledTimeSamples) continue;
    se += (est.f[m] - fHz) ** 2;
    n++;
  }
  return Math.sqrt(se / n);
}

/** Mean |z|^2 over the settled estimates. */
function settledPower(d: Discriminator, est: Estimates): number {
  let s = 0;
  let n = 0;
  for (let m = 0; m < est.t.length; m++) {
    if (est.t[m] < d.settledTimeSamples) continue;
    s += est.re[m] ** 2 + est.im[m] ** 2;
    n++;
  }
  return s / n;
}

/** Exact frac(mixHz * n / fs) with BigInt: fs is a binary fraction num / 2^k (any finite double). */
function exactMixerPhase(n: number, mixHz: number, fs: number): number {
  let v = fs;
  let den = 1n;
  while (!Number.isInteger(v)) {
    v *= 2;
    den *= 2n;
  }
  const num = BigInt(v);
  const r = (BigInt(mixHz) * BigInt(n) * den) % num;
  return Number(r) / Number(num);
}

function circularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

describe('v23-modem task 5.1: low-pass design and streaming decimating FIR', () => {
  it('DISCRIMINATOR parameters, decimation factors and tap counts match the design and E1/E7 (T5-3)', () => {
    // Expected values copied from design.md "Discriminator" on purpose (spec check).
    expect(DISCRIMINATOR).toEqual({
      forward: { transitionHz: 400, decimatedRateHz: 16000 },
      backward: { transitionHz: 60, decimatedRateHz: 2000 },
    });
    expect(STANDARD_SAMPLE_RATES.map((fs) => makeDisc(fs).decimation)).toEqual([1, 1, 1, 1, 2, 2, 3, 6]);
    // Tap counts reported by E1 (48 kHz) and E7 (8, 44.1, 96 kHz).
    expect([8000, 44100, 48000, 96000].map((fs) => hammingTapCount(fs, 400))).toEqual([67, 365, 397, 793]);
    for (const fs of ALL_TEST_RATES) {
      const d = makeDisc(fs);
      expect(d.taps.length % 2).toBe(1);
      expect(d.groupDelaySamples).toBe((d.taps.length - 1) / 2);
    }
  });

  it('guard: hammingTapCount and designLowpass equal the E1 prototype (prototypes/dsp/lib.mjs), B_n = 2099.0 Hz at 48 kHz', async () => {
    const libUrl = pathToFileURL(join(ROOT, 'prototypes', 'dsp', 'lib.mjs')).href;
    const lib = (await import(/* @vite-ignore */ libUrl)) as {
      tapCount: (w: string, fs: number, df: number) => number;
      designLowpass: (o: { fs: number; cutoffHz: number; transitionHz: number; window: string }) => Float64Array;
    };
    for (const fs of ALL_TEST_RATES) {
      expect(hammingTapCount(fs, 400), `fs=${fs}`).toBe(lib.tapCount('hamming', fs, 400));
      const ours = designLowpass(fs, FWD.lowpassHz, 400);
      const ref = lib.designLowpass({ fs, cutoffHz: FWD.lowpassHz, transitionHz: 400, window: 'hamming' });
      expect(Array.from(ours), `fs=${fs}`).toEqual(Array.from(ref));
    }
    // e1-summary.json, c1/hamming: noiseBandwidthHz48k = 2099.008279326559.
    expect(noiseBandwidthHz(designLowpass(48000, FWD.lowpassHz, 400), 48000)).toBeCloseTo(2099.008279326559, 6);
  });

  it('filter c1 (decision U2): symmetric, DC gain 1, -6 dB at lowpassHz, ripple <= 0.5 dB on |f| <= 950 Hz, >= 46 dB for |f| >= 1380 Hz', () => {
    let worstRipple = 0;
    let worstStop = Infinity;
    let worstCutoffDev = 0;
    for (const fs of ALL_TEST_RATES) {
      const h = designLowpass(fs, FWD.lowpassHz, 400);
      const L = h.length;
      let sum = 0;
      let asym = 0;
      for (let k = 0; k < L; k++) {
        sum += h[k];
        asym = Math.max(asym, Math.abs(h[k] - h[L - 1 - k]));
      }
      expect(Math.abs(sum - 1), `fs=${fs}`).toBeLessThan(1e-12);
      expect(asym, `fs=${fs}`).toBeLessThan(1e-15);
      // The -6 dB point is lowpassHz (reading c1): |H(fc)| = 1/2 within 0.1 dB.
      const cutoffDb = 20 * Math.log10(lowpassMagnitude(h, fs, FWD.lowpassHz));
      worstCutoffDev = Math.max(worstCutoffDev, Math.abs(cutoffDb - 20 * Math.log10(0.5)));
      for (let f = 0; f <= 950; f += 5) {
        worstRipple = Math.max(worstRipple, Math.abs(20 * Math.log10(lowpassMagnitude(h, fs, f))));
      }
      for (let f = 1380; f <= fs / 2; f += 4) {
        worstStop = Math.min(worstStop, -20 * Math.log10(lowpassMagnitude(h, fs, f)));
      }
    }
    console.log(
      `filter c1: worst ripple ${worstRipple.toFixed(3)} dB, worst stopband ${worstStop.toFixed(2)} dB, ` +
        `worst |H(1100 Hz)| deviation from -6.02 dB ${worstCutoffDev.toFixed(4)} dB`,
    );
    expect(worstCutoffDev).toBeLessThanOrEqual(0.1);
    expect(worstRipple).toBeLessThanOrEqual(0.5);
    expect(worstStop).toBeGreaterThanOrEqual(46);
  });

  it('filter response rejects the backward tones 390/420/450 Hz and 50 Hz mains by >= 40 dB (requirement 5.1, T5-2)', () => {
    const bw = CHANNELS.backward;
    let worst = Infinity;
    for (const fs of ALL_TEST_RATES) {
      const h = designLowpass(fs, FWD.lowpassHz, 400);
      for (const f of [bw.markHz, bw.mixHz, bw.spaceHz, 50]) {
        // A real tone at f gives two products after the mixer: f - mixHz and -(f + mixHz).
        for (const g of [FWD.mixHz - f, FWD.mixHz + f]) {
          worst = Math.min(worst, -20 * Math.log10(lowpassMagnitude(h, fs, g)));
        }
      }
    }
    console.log(`filter rejection of 390/420/450/50 Hz: worst ${worst.toFixed(2)} dB`);
    expect(worst).toBeGreaterThanOrEqual(40);
  });

  it('ComplexDecimatingFir equals a direct convolution, keeps every D-th output, and resets', () => {
    expect(() => new ComplexDecimatingFir(new Float64Array(0), 1)).toThrow(RangeError);
    expect(() => new ComplexDecimatingFir(new Float64Array(3), 0)).toThrow(RangeError);
    expect(() => new ComplexDecimatingFir(new Float64Array(3), 1.5)).toThrow(RangeError);
    const arbVal = fc.double({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        fc.array(arbVal, { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 7 }),
        fc.array(fc.tuple(arbVal, arbVal), { maxLength: 200 }),
        (tapsArr, D, input) => {
          const h = Float64Array.from(tapsArr);
          const fir = new ComplexDecimatingFir(h, D);
          const run = (): [number, number, number][] => {
            const outs: [number, number, number][] = [];
            input.forEach(([re, im], j) => {
              const ready = fir.write(re, im);
              expect(ready).toBe((j + 1) % D === 0);
              if (ready) outs.push([j, fir.outRe, fir.outIm]);
            });
            return outs;
          };
          const outs = run();
          for (const [j, yr, yi] of outs) {
            let rr = 0;
            let ri = 0;
            for (let k = 0; k < h.length && j - k >= 0; k++) {
              rr += h[k] * input[j - k][0];
              ri += h[k] * input[j - k][1];
            }
            expect(Math.abs(yr - rr)).toBeLessThanOrEqual(1e-12);
            expect(Math.abs(yi - ri)).toBeLessThanOrEqual(1e-12);
          }
          fir.reset();
          expect(run()).toEqual(outs);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('v23-modem task 5.2 and 5.3: discriminator', () => {
  it('createDiscriminator: typed errors, non-integer rates accepted, parameterised by channel (T5-4)', () => {
    for (const fs of [7999, 96001, Number.NaN, Infinity, -48000]) {
      expect(createDiscriminator(fs)).toEqual({ ok: false, error: { kind: 'bad-sample-rate', sampleRate: fs } });
    }
    expect(createDiscriminator(48000, 'sideways' as never)).toMatchObject({
      ok: false,
      error: { kind: 'bad-option', option: 'channel' },
    });
    for (const fs of [8000, 44100.3, 96000]) expect(createDiscriminator(fs).ok).toBe(true);
    // Backward: construction only; its behaviour is verified with task 14.
    const b = createDiscriminator(48000, 'backward');
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.value.channel).toBe('backward');
    expect(b.value.decimation).toBe(24);
    expect(b.value.taps.length).toBe(hammingTapCount(48000, DISCRIMINATOR.backward.transitionHz));
  });

  it('timing: the estimate computed at input n is dated n - (L - 1)/2 - D/2; one estimate per D inputs from the second kept output', () => {
    for (const fs of ALL_TEST_RATES) {
      const d = makeDisc(fs);
      const L = d.taps.length;
      const D = d.decimation;
      const N = L + 10 * D + 3;
      const out = d.push(new Float32Array(N));
      expect(out.count, `fs=${fs}`).toBe(Math.floor(N / D) - 1);
      expect(out.firstTimeSamples, `fs=${fs}`).toBe(2 * D - 1 - (L - 1) / 2 - D / 2);
      expect(d.settledTimeSamples).toBe(L - 1 + D - (L - 1) / 2 - D / 2);
    }
  });

  it('requirement 5.2: RMS frequency error <= 15 Hz on clean tones 1000..2500 Hz, integer and non-integer rates', () => {
    let worstSweep = 0;
    for (const fs of ALL_TEST_RATES) {
      for (let f = 1000; f <= 2500; f += 100) {
        const d = makeDisc(fs);
        const x = synth(d.taps.length + 4 * d.decimation + Math.round(0.05 * fs), 0.5, toneCycles(fs, f, 0.3));
        worstSweep = Math.max(worstSweep, settledRmsHz(d, runDisc(d, x), f));
      }
    }
    let worstProp = 0;
    fc.assert(
      fc.property(
        arbDiscRate,
        fc.double({ min: 1000, max: 2500, noNaN: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        (fs, f, amp, phase0) => {
          const d = makeDisc(fs);
          const x = synth(d.taps.length + 4 * d.decimation + Math.round(0.03 * fs), amp, toneCycles(fs, f, phase0));
          const rms = settledRmsHz(d, runDisc(d, x), f);
          worstProp = Math.max(worstProp, rms);
          expect(rms).toBeLessThanOrEqual(15);
        },
      ),
      { numRuns: DISC_RUNS },
    );
    console.log(`discriminator RMS error: sweep worst ${worstSweep.toFixed(3)} Hz, property worst ${worstProp.toFixed(3)} Hz`);
    expect(worstSweep).toBeLessThanOrEqual(15);
  });

  it('requirement 5.1: tones at 390, 420, 450 and 50 Hz come out >= 40 dB below a 1300 Hz tone of the same amplitude', () => {
    const bw = CHANNELS.backward;
    let worst = Infinity;
    for (const fs of ALL_TEST_RATES) {
      const n = hammingTapCount(fs, 400) + 6 * 8 + Math.round(0.1 * fs);
      const power = (f: number): number => {
        const d = makeDisc(fs);
        return settledPower(d, runDisc(d, synth(n, 0.5, toneCycles(fs, f, 0.1))));
      };
      const ref = power(FWD.markHz);
      for (const f of [bw.markHz, bw.mixHz, bw.spaceHz, 50]) worst = Math.min(worst, 10 * Math.log10(ref / power(f)));
    }
    console.log(`discriminator rejection of 390/420/450/50 Hz vs 1300 Hz: worst ${worst.toFixed(2)} dB`);
    expect(worst).toBeGreaterThanOrEqual(40);
  });

  it('requirement 5.3: a phase-continuous step 1300 <-> 2100 Hz is located within 1 input sample (D/2 dating)', () => {
    const stepError = (fs: number, up: boolean, tauFrac: number, extra: number): number => {
      const d = makeDisc(fs);
      const L = d.taps.length;
      const D = d.decimation;
      const [f1, f2] = up ? [FWD.markHz, FWD.spaceHz] : [FWD.spaceHz, FWD.markHz];
      const tau = L + 2 * D + extra + tauFrac; // true step time, in input samples
      const cycles = (i: number): number => (i < tau ? f1 * i : f1 * tau + f2 * (i - tau)) / fs + 0.17;
      const est = runDisc(d, synth(Math.ceil(tau) + L + 4 * D + 50, 0.5, cycles));
      const thr = FWD.thresholdHz;
      for (let m = 1; m < est.t.length; m++) {
        if (est.t[m - 1] < d.settledTimeSamples) continue;
        const a = est.f[m - 1] - thr;
        const b = est.f[m] - thr;
        if ((up && a < 0 && b >= 0) || (!up && a > 0 && b <= 0)) {
          const cross = est.t[m - 1] + (a / (a - b)) * (est.t[m] - est.t[m - 1]);
          return cross - tau;
        }
      }
      return Infinity;
    };
    const perRate: string[] = [];
    let worst = 0;
    for (const fs of ALL_TEST_RATES) {
      let w = 0;
      for (const up of [true, false]) {
        for (const frac of [0, 0.25, 0.5, 0.75]) {
          for (const extra of [0, 1, 2]) w = Math.max(w, Math.abs(stepError(fs, up, frac, extra)));
        }
      }
      perRate.push(`${fs}: ${w.toFixed(3)}`);
      worst = Math.max(worst, w);
    }
    fc.assert(
      fc.property(
        arbDiscRate,
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        fc.integer({ min: 0, max: 200 }),
        (fs, up, frac, extra) => {
          const e = Math.abs(stepError(fs, up, frac, extra));
          worst = Math.max(worst, e);
          expect(e).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: DISC_RUNS },
    );
    console.log(`step alignment |error| (input samples) per rate: ${perRate.join(', ')}; overall worst ${worst.toFixed(3)}`);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('chunk invariance: any partition gives bit-identical estimates on one continuous m * D time grid', () => {
    fc.assert(
      fc.property(
        arbDiscRate,
        arbBytes7(0, 6),
        fc.array(fc.integer({ min: 0, max: 300 }), { maxLength: 40 }),
        (fs, bytes, lens) => {
          const m = modulate(bytes, { sampleRate: fs, leadIdleMs: 20, tailIdleMs: 10 });
          expect(m.ok).toBe(true);
          if (!m.ok) return;
          const whole = runDisc(makeDisc(fs), m.value);
          const parts = runDisc(makeDisc(fs), m.value, lens);
          expect(whole.consistent).toBe(true);
          expect(parts.consistent).toBe(true);
          expect(parts.t).toEqual(whole.t);
          expect(parts.f).toEqual(whole.f);
          expect(parts.re).toEqual(whole.re);
          expect(parts.im).toEqual(whole.im);
        },
      ),
      { numRuns: DISC_RUNS },
    );
  });

  it('mixer phase: error <= 1e-7 cycle up to 24 h and <= 1e-6 up to 30 days at every rate, continuous from sample to sample (long-duration drift)', () => {
    // Bound: the only rounding is (mixHz * n) / fs, so the error is <= ulp(mixHz * t) / 2 cycles,
    // independent of fs: 1.5e-8 at 24 h, 2.4e-7 at 30 days.
    let worst24h = 0;
    let worst30d = 0;
    let worstStep24h = 0;
    let worstStep = 0;
    for (const fs of ALL_TEST_RATES) {
      const day = Math.floor(86400 * fs);
      const ns = [0, 1, 2, 3, 1000, 123456789, day - 1, day, 7 * day, 30 * day];
      for (let k = 0; k < 20; k++) ns.push(Math.floor(((k + 1) / 20) * 30 * day));
      const step = (FWD.mixHz / fs) % 1;
      for (const n of ns) {
        const err = circularDiff(mixerPhaseCycles(n, FWD.mixHz, fs), exactMixerPhase(n, FWD.mixHz, fs));
        if (n <= day) worst24h = Math.max(worst24h, err);
        worst30d = Math.max(worst30d, err);
        // Continuity: consecutive phases differ by mixHz / fs cycles (mod 1).
        const inc = mixerPhaseCycles(n + 1, FWD.mixHz, fs) - mixerPhaseCycles(n, FWD.mixHz, fs);
        const stepErr = circularDiff(inc, step);
        if (n <= day) worstStep24h = Math.max(worstStep24h, stepErr);
        worstStep = Math.max(worstStep, stepErr);
      }
    }
    console.log(
      `mixer phase error vs exact BigInt: worst ${worst24h.toExponential(2)} cycles up to 24 h, ` +
        `${worst30d.toExponential(2)} up to 30 days; worst sample-to-sample step error ` +
        `${worstStep24h.toExponential(2)} (24 h), ${worstStep.toExponential(2)} (30 days) cycles`,
    );
    expect(worst24h).toBeLessThanOrEqual(1e-7);
    expect(worstStep24h).toBeLessThanOrEqual(1e-7);
    expect(worst30d).toBeLessThanOrEqual(1e-6);
    expect(worstStep).toBeLessThanOrEqual(1e-6);
  });

  it('long run: no frequency drift on a mark tone streamed in chunks at 48 kHz (10 s fast, 120 s slow)', () => {
    const fs = 48000;
    const seconds = isSlowTestsEnabled() ? 120 : 10;
    const d = makeDisc(fs);
    const chunkLen = 4799;
    const chunk = new Float32Array(chunkLen);
    // Exact integer phase: (markHz * i) mod fs, so the reference itself cannot drift.
    let i = 0;
    let sumFirst = 0;
    let nFirst = 0;
    let sumLast = 0;
    let nLast = 0;
    let se = 0;
    let nAll = 0;
    const total = seconds * fs;
    while (i < total) {
      const len = Math.min(chunkLen, total - i);
      for (let k = 0; k < len; k++) chunk[k] = 0.5 * Math.sin((2 * Math.PI * ((FWD.markHz * (i + k)) % fs)) / fs);
      const out = d.push(chunk.subarray(0, len));
      for (let m = 0; m < out.count; m++) {
        const t = out.firstTimeSamples + m * d.decimation;
        if (t < d.settledTimeSamples) continue;
        const f = out.freqHz[m];
        se += (f - FWD.markHz) ** 2;
        nAll++;
        if (t < 2 * fs) {
          sumFirst += f;
          nFirst++;
        } else if (t >= total - 2 * fs) {
          sumLast += f;
          nLast++;
        }
      }
      i += len;
    }
    const drift = sumLast / nLast - sumFirst / nFirst;
    const rms = Math.sqrt(se / nAll);
    console.log(`long run ${seconds} s: mean f drift (last 2 s - first 2 s) = ${drift.toExponential(2)} Hz, RMS ${rms.toFixed(4)} Hz`);
    expect(Math.abs(drift)).toBeLessThanOrEqual(0.01);
    expect(rms).toBeLessThanOrEqual(15);
  });

  it('non-finite samples become 0 and are counted (T5-5); reset restores the initial state; silence gives mixHz', () => {
    const fs = 22050;
    const d = makeDisc(fs);
    const n = d.taps.length + 400;
    const clean = synth(n, 0.5, toneCycles(fs, FWD.markHz, 0));
    const dirty = clean.slice();
    const zeroed = clean.slice();
    const bad = [5, 17, 200, 201, n - 1];
    const values = [Number.NaN, Infinity, -Infinity, Number.NaN, Infinity];
    bad.forEach((p, k) => {
      dirty[p] = values[k];
      zeroed[p] = 0;
    });
    const a = runDisc(d, dirty, [7, 100, 1]);
    expect(d.nonFiniteCount).toBe(bad.length);
    const b = runDisc(makeDisc(fs), zeroed);
    expect(a.f).toEqual(b.f);
    expect(a.re).toEqual(b.re);
    expect(a.f.every(Number.isFinite)).toBe(true);
    d.reset();
    expect(d.nonFiniteCount).toBe(0);
    const c = runDisc(d, zeroed);
    expect(c).toEqual(b);
    const silence = runDisc(makeDisc(fs), new Float32Array(n));
    expect(silence.f.every((f) => f === FWD.mixHz)).toBe(true);
    expect(silence.re.every((v) => v === 0) && silence.im.every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 6: UART with the fixed threshold. Signals come from modulate() or from the independent
// closed-form FSK generators below (used for clock offsets and sub-bit pulses).

const UART_RUNS = isSlowTestsEnabled() ? 100 : 15;
const M8_SNR_3K_DB = 20; // requirement 6.6 / property M8, SNR in the one-sided 3 kHz band (A7)
const STANDARD_AND_NON_INTEGER: readonly number[] = ALL_TEST_RATES;
const arbUartRate = fc.oneof(arbStandardSampleRate(), fc.constantFrom(...NON_INTEGER_RATES));

interface Decoded {
  chars: UartChar[];
  uart: Uart;
}

/** Discriminator + UART on x, pushed in chunks of the given lengths (remainder last). */
function decodeChars(x: Float32Array, fs: number, chunkLens: readonly number[] = []): Decoded {
  const d = makeDisc(fs);
  const uart = createUart(d);
  const chars: UartChar[] = [];
  const push = (c: Float32Array): void => {
    for (const ch of uart.push(d.push(c))) chars.push(ch);
  };
  let pos = 0;
  for (const len of chunkLens) {
    if (pos >= x.length) break;
    const end = Math.min(x.length, pos + len);
    push(x.subarray(pos, end));
    pos = end;
  }
  push(x.subarray(pos));
  return { chars, uart };
}

/** Line bits of bytes with `idle` mark bits between frames (built from frame.ts, not modulate). */
function lineBitsOf(bytes: Uint8Array, idle: number): Uint8Array {
  const bitsPerFrame = FRAME.bitsPerFrame;
  const out = new Uint8Array(bytes.length === 0 ? 0 : bytes.length * (bitsPerFrame + idle) - idle);
  out.fill(1);
  bytes.forEach((b, j) => byteToLineBits(b, out, j * (bitsPerFrame + idle)));
  return out;
}

/**
 * Independent phase-continuous FSK: line bit k covers [lead + k Tp, lead + (k + 1) Tp) seconds with
 * Tp = 1 / (baud (1 + eps)) (transmitter clock fast by eps), nominal tones, mark before and after.
 * Phase in closed form: c(t) = markHz t + (spaceHz - markHz) S(t), S = time spent at space.
 */
function fskClock(bits: Uint8Array, fs: number, o: { leadS: number; tailS: number; eps: number; amp: number }): Float32Array {
  const tp = 1 / (FWD.baud * (1 + o.eps));
  const cum = new Float64Array(bits.length + 1);
  for (let k = 0; k < bits.length; k++) cum[k + 1] = cum[k] + (bits[k] === 0 ? tp : 0);
  const end = o.leadS + bits.length * tp;
  const n = Math.round(fs * (end + o.tailS));
  const df = FWD.spaceHz - FWD.markHz;
  return synth(n, o.amp, (i) => {
    const t = i / fs;
    let sp: number;
    if (t < o.leadS) sp = 0;
    else if (t >= end) sp = cum[bits.length];
    else {
      const k = Math.min(bits.length - 1, Math.floor((t - o.leadS) / tp));
      sp = cum[k] + (bits[k] === 0 ? t - (o.leadS + k * tp) : 0);
    }
    return FWD.markHz * t + df * sp;
  });
}

/** Phase-continuous sequence of constant tones [frequency Hz, duration s]. */
function toneSegments(fs: number, segs: readonly [number, number][], amp: number): { x: Float32Array; startsS: number[] } {
  const startsS: number[] = [];
  let t = 0;
  for (const [, dur] of segs) {
    startsS.push(t);
    t += dur;
  }
  const n = Math.round(fs * t);
  const x = synth(n, amp, (i) => {
    const ti = i / fs;
    let c = 0;
    for (let k = 0; k < segs.length; k++) {
      const [f, dur] = segs[k];
      const span = Math.min(Math.max(ti - startsS[k], 0), dur);
      c += f * span;
    }
    return c;
  });
  return { x, startsS };
}

/** Segments [Hz, s] of one frame, as whole bits at the nominal rate. */
function frameSegments(byte: number): [number, number][] {
  return Array.from(byteToLineBits(byte), (b) => [b === 1 ? FWD.markHz : FWD.spaceHz, 1 / FWD.baud] as [number, number]);
}

/** Expected start-edge times (input samples) of the frames of modulate(bytes, ...). */
function frameStarts(n: number, fs: number, leadMs: number, idle: number): number[] {
  return Array.from({ length: n }, (_, j) => (leadMs / 1000 + (j * (FRAME.bitsPerFrame + idle)) / FWD.baud) * fs);
}

/**
 * Tolerance used only to match a received char to the frame it belongs to (0.1 T). It is not the
 * atSample precision requirement, which is tested separately (T6-6).
 */
function matchTol(fs: number): number {
  return (0.1 * fs) / FWD.baud;
}

function charsAreExact(chars: UartChar[], bytes: Uint8Array): boolean {
  return (
    chars.length === bytes.length &&
    chars.every((c, j) => c.value === bytes[j] && c.parityOk && c.framingOk)
  );
}

describe('v23-modem task 6.1: soft value and fixed threshold', () => {
  it('fixed threshold 1700 Hz; s = -1 at mark, +1 at space, 0 at the threshold (forward)', () => {
    expect(fixedThresholdHz(FWD)).toBe(FWD.thresholdHz);
    expect(softValue(FWD.markHz, FWD.thresholdHz, FWD)).toBe(-1);
    expect(softValue(FWD.spaceHz, FWD.thresholdHz, FWD)).toBe(1);
    expect(softValue(FWD.thresholdHz, FWD.thresholdHz, FWD)).toBe(0);
  });
});

describe('v23-modem task 6.2 and 6.3: UART', () => {
  it('M1 round-trip: demodulate(modulate(b)) returns b, all parityOk and framingOk (fixed threshold, clean, 8 rates, 0-500 bytes)', () => {
    fc.assert(
      fc.property(arbStandardSampleRate(), arbBytes7(0, 500), (fs, bytes) => {
        const m = modulate(bytes, { sampleRate: fs });
        expect(m.ok).toBe(true);
        if (!m.ok) return;
        const { chars } = decodeChars(m.value, fs);
        expect(chars.map((c) => c.value)).toEqual(Array.from(bytes));
        expect(chars.every((c) => c.parityOk && c.framingOk)).toBe(true);
      }),
      { numRuns: UART_RUNS },
    );
    // The longest case of the property at every rate, deterministic.
    const rng = createRng(2026);
    const longest = Uint8Array.from({ length: 500 }, () => Math.floor(rng.nextFloat() * 128));
    for (const fs of STANDARD_SAMPLE_RATES) {
      const m = modulate(longest, { sampleRate: fs });
      if (!m.ok) throw new Error('modulate');
      expect(charsAreExact(decodeChars(m.value, fs).chars, longest), `fs=${fs}`).toBe(true);
    }
  });

  it('round trip also holds with inter-frame idle bits and non-integer rates; atSample within 1 decimated estimate (D input samples) of the true edge (requirement 6.1, T6-6)', () => {
    // Error of atSample in units of the UART grid (D input samples), worst per rate.
    const worstByRate = new Map<number, { samples: number; ratio: number }>();
    const record = (fs: number, e: number): void => {
      const D = makeDisc(fs).decimation;
      const prev = worstByRate.get(fs);
      if (!prev || e > prev.samples) worstByRate.set(fs, { samples: e, ratio: e / D });
    };
    // Deterministic: 300 random bytes at every standard and non-integer rate, collated frames.
    const rng = createRng(17);
    const bytes300 = Uint8Array.from({ length: 300 }, () => Math.floor(rng.nextFloat() * 128));
    for (const fs of STANDARD_AND_NON_INTEGER) {
      const m = modulate(bytes300, { sampleRate: fs });
      if (!m.ok) throw new Error('modulate');
      const { chars } = decodeChars(m.value, fs);
      expect(charsAreExact(chars, bytes300), `fs=${fs}`).toBe(true);
      const starts = frameStarts(bytes300.length, fs, MODULATE_DEFAULTS.leadIdleMs, 0);
      chars.forEach((c, j) => record(fs, Math.abs(c.atSample - starts[j])));
    }
    // Property: inter-frame idle bits 0..3.
    fc.assert(
      fc.property(arbUartRate, arbBytes7(1, 40), fc.integer({ min: 0, max: 3 }), (fs, bytes, idle) => {
        const m = modulate(bytes, { sampleRate: fs, interFrameIdleBits: idle });
        if (!m.ok) throw new Error('modulate');
        const { chars } = decodeChars(m.value, fs);
        expect(charsAreExact(chars, bytes)).toBe(true);
        const starts = frameStarts(bytes.length, fs, MODULATE_DEFAULTS.leadIdleMs, idle);
        chars.forEach((c, j) => record(fs, Math.abs(c.atSample - starts[j])));
      }),
      { numRuns: UART_RUNS },
    );
    const rows = [...worstByRate.entries()].sort((a, b) => a[0] - b[0]);
    console.log(
      'UART atSample |error| vs true start edge (clean), worst per rate: ' +
        rows
          .map(([fs, w]) => `${fs}: ${w.samples.toFixed(3)} samples = ${w.ratio.toFixed(3)} D = ${((w.samples * FWD.baud) / fs).toFixed(4)} T`)
          .join(', '),
    );
    for (const [fs, w] of rows) expect(w.ratio, `fs=${fs}`).toBeLessThanOrEqual(1);
  });

  it('minConfidence = min |mean s| over the 10 windows, start bit included (T6-5): close to 1 on a clean signal', () => {
    let worst = Infinity;
    for (const fs of STANDARD_AND_NON_INTEGER) {
      // 0x55 alternates every bit (worst case for the windows), 0x00 and 0x7F give long runs.
      const bytes = Uint8Array.from([0x55, 0x2a, 0x00, 0x7f, 0x41]);
      const m = modulate(bytes, { sampleRate: fs });
      if (!m.ok) throw new Error('modulate');
      const { chars } = decodeChars(m.value, fs);
      expect(charsAreExact(chars, bytes), `fs=${fs}`).toBe(true);
      for (const c of chars) {
        expect(c.minConfidence).toBeLessThanOrEqual(1.2);
        worst = Math.min(worst, c.minConfidence);
      }
    }
    console.log(`UART minConfidence on clean signals: worst ${worst.toFixed(4)}`);
    expect(worst).toBeGreaterThanOrEqual(0.75);
  });

  it('chunk invariance: any partition of the input gives identical chars', () => {
    fc.assert(
      fc.property(
        arbUartRate,
        arbBytes7(0, 12),
        fc.integer({ min: 0, max: 2 }),
        fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 60 }),
        (fs, bytes, idle, lens) => {
          const m = modulate(bytes, { sampleRate: fs, interFrameIdleBits: idle });
          if (!m.ok) throw new Error('modulate');
          const whole = decodeChars(m.value, fs).chars;
          expect(decodeChars(m.value, fs, lens).chars).toEqual(whole);
        },
      ),
      { numRuns: UART_RUNS },
    );
  });

  it('M4 parity (detection half): inverting any line bit 1..8 of a frame gives parityOk = false for that frame only', () => {
    fc.assert(
      fc.property(
        arbUartRate,
        arbBytes7(1, 20),
        fc.nat(),
        fc.integer({ min: FIRST_DATA_BIT_INDEX, max: PARITY_BIT_INDEX }),
        fc.integer({ min: 0, max: 2 }),
        (fs, bytes, jRaw, b, idle) => {
          const j = jRaw % bytes.length;
          const m = modulate(bytes, { sampleRate: fs, interFrameIdleBits: idle, bitErrors: [j * (FRAME.bitsPerFrame + idle) + b] });
          if (!m.ok) throw new Error('modulate');
          const { chars } = decodeChars(m.value, fs);
          expect(chars.length).toBe(bytes.length);
          chars.forEach((c, i) => {
            const expectedValue = i === j && b < PARITY_BIT_INDEX ? bytes[i] ^ (1 << (b - FIRST_DATA_BIT_INDEX)) : bytes[i];
            expect(c.value).toBe(expectedValue);
            expect(c.parityOk).toBe(i !== j);
            expect(c.framingOk).toBe(true);
          });
        },
      ),
      { numRuns: UART_RUNS },
    );
  });

  it('characterization: inverting the start bit loses that frame; with 10 idle bits the next frames are intact', () => {
    let garbage = 0;
    fc.assert(
      fc.property(arbUartRate, arbBytes7(2, 8), fc.nat(), (fs, bytes, jRaw) => {
        const idle = 10;
        const j = jRaw % bytes.length;
        const m = modulate(bytes, { sampleRate: fs, interFrameIdleBits: idle, bitErrors: [j * (FRAME.bitsPerFrame + idle)] });
        if (!m.ok) throw new Error('modulate');
        const { chars } = decodeChars(m.value, fs);
        const starts = frameStarts(bytes.length, fs, MODULATE_DEFAULTS.leadIdleMs, idle);
        const frameSpan = (FRAME.bitsPerFrame + idle) * (fs / FWD.baud);
        const matched = new Set<number>();
        for (const c of chars) {
          const i = starts.findIndex((t) => Math.abs(c.atSample - t) <= matchTol(fs));
          if (i >= 0 && i !== j) {
            expect(c.value).toBe(bytes[i]);
            expect(c.parityOk && c.framingOk).toBe(true);
            matched.add(i);
          } else {
            // Anything else is decoded from frame j's own bits, after its (missing) start edge.
            expect(c.atSample).toBeGreaterThan(starts[j] + matchTol(fs));
            expect(c.atSample).toBeLessThan(starts[j] + frameSpan - matchTol(fs));
            garbage++;
          }
        }
        expect(matched.size).toBe(bytes.length - 1);
      }),
      { numRuns: UART_RUNS },
    );
    console.log(`start-bit inversion: ${garbage} misaligned chars decoded inside the damaged frames`);
  });

  it('characterization: inverting the stop bit gives framingOk = false (requirement 6.5); with 2 idle bits the search resumes and the next frames are intact', () => {
    let lostAfter = 0;
    let cases0 = 0;
    fc.assert(
      fc.property(arbUartRate, arbBytes7(2, 10), fc.nat(), fc.constantFrom(0, 2), (fs, bytes, jRaw, idle) => {
        const j = jRaw % bytes.length;
        const m = modulate(bytes, {
          sampleRate: fs,
          interFrameIdleBits: idle,
          bitErrors: [j * (FRAME.bitsPerFrame + idle) + STOP_BIT_INDEX],
        });
        if (!m.ok) throw new Error('modulate');
        const { chars } = decodeChars(m.value, fs);
        const starts = frameStarts(bytes.length, fs, MODULATE_DEFAULTS.leadIdleMs, idle);
        for (let i = 0; i <= j; i++) {
          expect(Math.abs(chars[i].atSample - starts[i])).toBeLessThanOrEqual(matchTol(fs));
          expect(chars[i].value).toBe(bytes[i]);
          expect(chars[i].parityOk).toBe(true);
          expect(chars[i].framingOk).toBe(i !== j);
        }
        if (idle === 2) {
          expect(charsAreExact(chars.slice(j + 1), bytes.slice(j + 1))).toBe(true);
        } else {
          // Collated frames: the next start bit follows a space stop bit, so it has no mark before
          // it and that frame may be lost (design.md M4). Characterised, not required.
          cases0++;
          const exactAfter = chars.filter((c) =>
            starts.some((t, i) => i > j && Math.abs(c.atSample - t) <= matchTol(fs) && c.value === bytes[i]),
          );
          lostAfter += bytes.length - 1 - j - exactAfter.length;
        }
      }),
      { numRuns: UART_RUNS },
    );
    console.log(`stop-bit inversion, collated frames: ${lostAfter} following frames lost over ${cases0} cases`);
  });

  it('requirement 6.4: a short space pulse is a false start, gives no char and the search goes on', () => {
    for (const fs of [8000, 22050, 44100.3, 48000, 96000]) {
      for (const width of [0.3, 0.4]) {
        const T = 1 / FWD.baud;
        const segs: [number, number][] = [
          [FWD.markHz, 0.06],
          [FWD.spaceHz, width * T],
          [FWD.markHz, 0.03],
          ...frameSegments(0x41),
          [FWD.markHz, 0.03],
        ];
        const { x, startsS } = toneSegments(fs, segs, 0.5);
        const { chars, uart } = decodeChars(x, fs);
        expect(uart.falseStarts, `fs=${fs} width=${width}`).toBeGreaterThanOrEqual(1);
        expect(chars.length, `fs=${fs} width=${width}`).toBe(1);
        expect(chars[0]).toMatchObject({ value: 0x41, parityOk: true, framingOk: true });
        expect(Math.abs(chars[0].atSample - startsS[3] * fs)).toBeLessThanOrEqual(matchTol(fs));
      }
    }
  });

  it('characterization: a space pulse of 0.6 T passes the start check (mean s > 0) and reads as 0x7F with good parity and framing', () => {
    // design.md UART: the start check is "mean of s over the central window > 0". Measured: pulses
    // up to 0.4 T are false starts; from about 0.5 T the filtered pulse keeps a positive mean.
    const T = 1 / FWD.baud;
    for (const fs of [8000, 22050, 48000, 96000]) {
      const { x } = toneSegments(fs, [[FWD.markHz, 0.06], [FWD.spaceHz, 0.6 * T], [FWD.markHz, 0.03]], 0.5);
      const { chars, uart } = decodeChars(x, fs);
      expect(uart.falseStarts, `fs=${fs}`).toBe(0);
      expect(chars.map((c) => [c.value, c.parityOk, c.framingOk]), `fs=${fs}`).toEqual([[0x7f, true, true]]);
    }
  });

  it('T6-2: after a false start, a start edge needs 1 T of measured mark before it', () => {
    for (const fs of [8000, 44100, 48000, 96000]) {
      const T = 1 / FWD.baud;
      const run = (gapBits: number) => {
        const segs: [number, number][] = [
          [FWD.markHz, 0.06],
          [FWD.spaceHz, 0.4 * T],
          [FWD.markHz, gapBits * T],
          ...frameSegments(0x41),
          [FWD.markHz, 0.03],
        ];
        const { x, startsS } = toneSegments(fs, segs, 0.5);
        const { chars, uart } = decodeChars(x, fs);
        expect(uart.falseStarts).toBeGreaterThanOrEqual(1);
        return chars.filter((c) => Math.abs(c.atSample - startsS[3] * fs) <= matchTol(fs));
      };
      expect(run(1.5), `fs=${fs}`).toMatchObject([{ value: 0x41, parityOk: true, framingOk: true }]);
      expect(run(0.5), `fs=${fs}`).toEqual([]);
    }
  });

  it('reset restores the initial state', () => {
    const fs = 16000;
    const bytes = Uint8Array.from(ascii('3615'));
    const m = modulate(bytes, { sampleRate: fs });
    if (!m.ok) throw new Error('modulate');
    const d = makeDisc(fs);
    const u = createUart(d);
    const first = u.push(d.push(m.value));
    d.reset();
    u.reset();
    expect(u.falseStarts).toBe(0);
    expect(u.push(d.push(m.value))).toEqual(first);
    expect(charsAreExact(first, bytes)).toBe(true);
  });

  it('A7 convention: gamma_3k = 20 dB gives sigma^2 = A^2 fs / (12000 gamma) (R4) and Eb/N0 = gamma_3k + 10 log10(3000 / 1200) dB (R5)', () => {
    const fs = 48000;
    const A = MODULATE_DEFAULTS.amplitude;
    const zeros = new Float32Array(400000);
    const bySnr = awgn(zeros, { sampleRate: fs, snrDb: M8_SNR_3K_DB, bandwidthHz: 3000, signalAmplitude: A, seed: 7 });
    const ebN0Db = M8_SNR_3K_DB + 10 * Math.log10(3000 / FWD.baud);
    const byEbN0 = awgn(zeros, { sampleRate: fs, ebN0Db, baud: FWD.baud, signalAmplitude: A, seed: 7 });
    let maxDiff = 0;
    let sumSq = 0;
    for (let i = 0; i < zeros.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(bySnr[i] - byEbN0[i]));
      sumSq += bySnr[i] * bySnr[i];
    }
    const sigma2 = (A * A * fs) / (12000 * 10 ** (M8_SNR_3K_DB / 10)); // R4
    const measured = sumSq / zeros.length;
    const ebN0FromSigma = 10 * Math.log10((A * A * fs) / (4 * FWD.baud * sigma2)); // R2
    console.log(
      `A7: sigma^2 expected ${sigma2.toExponential(4)}, measured ${measured.toExponential(4)}; ` +
        `Eb/N0 = ${ebN0FromSigma.toFixed(4)} dB for gamma_3k = ${M8_SNR_3K_DB} dB`,
    );
    expect(Math.abs(ebN0FromSigma - 23.979400086720375)).toBeLessThan(1e-9);
    expect(Math.abs(ebN0Db - ebN0FromSigma)).toBeLessThan(1e-9);
    expect(maxDiff).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(measured / sigma2 - 1)).toBeLessThan(0.01);
  });
});

describe('v23-modem task 6.3: M8 clock offset at 20 dB SNR (3 kHz)', () => {
  const EPS_SWEEP = [-0.02, -0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015, 0.02];
  const SWEEP_BYTES = isSlowTestsEnabled() ? 200 : 60;
  const A = MODULATE_DEFAULTS.amplitude;

  /** Noisy signal of one clock model. */
  function clockSignal(model: 'bit-clock' | 'resampled', bytes: Uint8Array, fs: number, eps: number, idle: number, seed: number): Float32Array {
    let clean: Float32Array;
    if (model === 'bit-clock') {
      clean = fskClock(lineBitsOf(bytes, idle), fs, { leadS: 0.1, tailS: 0.05, eps, amp: A });
    } else {
      const m = modulate(bytes, { sampleRate: fs, interFrameIdleBits: idle });
      if (!m.ok) throw new Error('modulate');
      clean = resample(m.value, { ratio: 1 / (1 + eps) });
    }
    return awgn(clean, { sampleRate: fs, snrDb: M8_SNR_3K_DB, bandwidthHz: 3000, signalAmplitude: A, seed });
  }

  for (const model of ['bit-clock', 'resampled'] as const) {
    it(`M8 clock (${model}): for any clock error in [-2%, +2%], bytes are decoded without error at 20 dB SNR`, () => {
      const failures: string[] = [];
      let worstConf = Infinity;
      const rng = createRng(model === 'bit-clock' ? 61 : 62);
      for (const fs of STANDARD_SAMPLE_RATES) {
        const bytes = Uint8Array.from({ length: SWEEP_BYTES }, () => Math.floor(rng.nextFloat() * 128));
        for (const eps of EPS_SWEEP) {
          const x = clockSignal(model, bytes, fs, eps, 0, 1000 + Math.round(eps * 1000) + fs);
          const { chars } = decodeChars(x, fs);
          if (!charsAreExact(chars, bytes)) {
            const bad = chars.filter((c, j) => c.value !== bytes[j] || !c.parityOk || !c.framingOk).length;
            failures.push(`fs=${fs} eps=${eps}: ${chars.length} chars for ${bytes.length}, ${bad} wrong`);
          }
          for (const c of chars) worstConf = Math.min(worstConf, c.minConfidence);
        }
      }
      fc.assert(
        fc.property(
          arbUartRate,
          fc.double({ min: -0.02, max: 0.02, noNaN: true }),
          arbBytes7(1, 40),
          fc.integer({ min: 0, max: 2 }),
          fc.integer({ min: 1, max: 0x7fffffff }),
          (fs, eps, bytes, idle, seed) => {
            const { chars } = decodeChars(clockSignal(model, bytes, fs, eps, idle, seed), fs);
            if (!charsAreExact(chars, bytes)) failures.push(`fs=${fs} eps=${eps} idle=${idle} seed=${seed} n=${bytes.length}`);
          },
        ),
        { numRuns: UART_RUNS },
      );
      console.log(`M8 ${model}: ${failures.length} failing cases; worst minConfidence ${worstConf.toFixed(3)}`);
      if (failures.length > 0) console.log(failures.slice(0, 20).join('\n'));
      expect(failures).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Task 7: streaming demodulator. Events come from the public createDemodulator.

const DEMOD_RUNS = isSlowTestsEnabled() ? 60 : 12;

/** Pushes x through a fresh demodulator in chunks of the given lengths; the remainder goes last. */
function demodEvents(x: Float32Array, fs: number, chunkLens: readonly number[] = [], o: { flush?: boolean } = {}): DemodEvent[] {
  const r = createDemodulator({ sampleRate: fs, threshold: 'fixed' });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  const events: DemodEvent[] = [];
  const push = (c: Float32Array): void => {
    for (const e of r.value.push(c)) events.push(e);
  };
  let pos = 0;
  for (const len of chunkLens) {
    if (pos >= x.length) break;
    const end = Math.min(x.length, pos + len);
    push(x.subarray(pos, end));
    pos = end;
  }
  push(x.subarray(pos));
  if (o.flush !== false) for (const e of r.value.flush()) events.push(e);
  return events;
}

function charsOf(events: readonly DemodEvent[]): Extract<DemodEvent, { type: 'char' }>[] {
  return events.filter((e): e is Extract<DemodEvent, { type: 'char' }> => e.type === 'char');
}

/** A tone of `ms` milliseconds at `fHz`, amplitude A, starting at sample 0. */
function toneMs(fs: number, fHz: number, ms: number, amp: number): Float32Array {
  return synth(Math.round((fs * ms) / 1000), amp, (i) => (fHz * i) / fs);
}

/** Phase-continuous FSK with every tone shifted by offsetHz (single-sideband style), closed form. */
function fskOffset(bytes: Uint8Array, fs: number, offsetHz: number, o: { idle?: number; leadS?: number; tailS?: number; amp?: number } = {}): Float32Array {
  const bits = lineBitsOf(bytes, o.idle ?? 0);
  const lead = o.leadS ?? 0.1;
  const tp = 1 / FWD.baud;
  const cum = new Float64Array(bits.length + 1);
  for (let k = 0; k < bits.length; k++) cum[k + 1] = cum[k] + (bits[k] === 0 ? tp : 0);
  const end = lead + bits.length * tp;
  const n = Math.round(fs * (end + (o.tailS ?? 0.05)));
  return synth(n, o.amp ?? 0.5, (i) => {
    const t = i / fs;
    let sp: number;
    if (t < lead) sp = 0;
    else if (t >= end) sp = cum[bits.length];
    else {
      const k = Math.min(bits.length - 1, Math.floor((t - lead) / tp));
      sp = cum[k] + (bits[k] === 0 ? t - (lead + k * tp) : 0);
    }
    return (FWD.markHz + offsetHz) * t + (FWD.spaceHz - FWD.markHz) * sp;
  });
}

/** JSON of events with typed arrays as plain arrays (stable for hashing). */
function eventsJson(events: readonly DemodEvent[]): string {
  return JSON.stringify(events, (_k, v) => (v instanceof Float32Array ? Array.from(v) : v));
}

/**
 * SHA-256 of the fixed-threshold event lists of four deterministic signals. The expected values
 * in the task 8 non-regression test were produced by the task 7 code (commit 18a066b).
 */
function fixedGoldenDigests(): string[] {
  // `connect` events are left out: they come from the answer-tone detector, not from the threshold
  // path, and none of these signals produced one with the task 7 code (the digests were computed
  // on the full lists). The Goertzel normalisation fixed in task 8 adds the connect of signal 3.
  // `quality` events (task 10) are left out for the same reason: the task 7 code emitted none, so
  // every event the digests cover is still compared.
  const bytes = Uint8Array.from(ascii('3615 NEOMINITEL'));
  const signals: [number, Float32Array][] = [];
  const m1 = modulate(bytes, { sampleRate: 48000 });
  if (!m1.ok) throw new Error('modulate');
  signals.push([48000, m1.value]);
  const m2 = modulate(bytes, { sampleRate: 44100 });
  if (!m2.ok) throw new Error('modulate');
  signals.push([44100, awgn(m2.value, { sampleRate: 44100, snrDb: 20, bandwidthHz: 3000, signalAmplitude: 0.5, seed: 11 })]);
  const seq = connectionSequence({ sampleRate: 16000 });
  const m3 = modulate(bytes, { sampleRate: 16000 });
  if (!m3.ok) throw new Error('modulate');
  const s3 = new Float32Array(seq.length + m3.value.length);
  s3.set(seq, 0);
  s3.set(m3.value, seq.length);
  signals.push([16000, s3]);
  signals.push([22050, awgn(fskOffset(bytes, 22050, 200), { sampleRate: 22050, snrDb: 20, bandwidthHz: 3000, signalAmplitude: 0.5, seed: 12 })]);
  return signals.map(([fs, x]) =>
    createHash('sha256')
      .update(eventsJson(demodEvents(x, fs).filter((e) => e.type !== 'connect' && e.type !== 'quality')))
      .digest('hex'),
  );
}

describe('v23-modem task 7: streaming demodulator', () => {
  it('factory: bad-sample-rate, bad-option for threshold, channel and carrierOnDbfs; setThresholdMode is a no-op', () => {
    for (const fs of [7999, 96001, Number.NaN, Infinity]) {
      expect(createDemodulator({ sampleRate: fs, threshold: 'fixed' })).toEqual({
        ok: false,
        error: { kind: 'bad-sample-rate', sampleRate: fs },
      });
    }
    // Non-integer rates are accepted (design.md "Factory").
    expect(createDemodulator({ sampleRate: 44100.3, threshold: 'fixed' }).ok).toBe(true);
    // From task 8 (design.md "Threshold mode"): an omitted threshold means 'adaptive', 'fixed' and
    // 'adaptive' are accepted, anything else is a bad option.
    for (const threshold of [undefined, 'adaptive' as const, 'fixed' as const]) {
      expect(createDemodulator({ sampleRate: 48000, threshold }).ok).toBe(true);
    }
    for (const threshold of ['auto' as never, '' as never, 1 as never]) {
      const r = createDemodulator({ sampleRate: 48000, threshold });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ kind: 'bad-option', option: 'threshold' });
    }
    const back = createDemodulator({ sampleRate: 48000, channel: 'backward', threshold: 'fixed' });
    expect(back).toMatchObject({ ok: false, error: { kind: 'bad-option', option: 'channel' } });
    expect(createDemodulator({ sampleRate: 48000, threshold: 'fixed', carrierOnDbfs: Number.NaN })).toMatchObject({
      ok: false,
      error: { kind: 'bad-option', option: 'carrierOnDbfs' },
    });
    const ok = createDemodulator({ sampleRate: 48000, threshold: 'fixed' });
    if (!ok.ok) throw new Error('demod');
    expect(() => ok.value.setThresholdMode('adaptive')).not.toThrow();
    expect(() => ok.value.setThresholdMode('bogus' as never)).not.toThrow();
  });

  it('D6: a carrier of amplitude A reads 20 log10(A) dBFS; A = 0.5 reads -6.02 dBFS (docs/math.md D6)', () => {
    const fs = 48000;
    const amps = [1, 0.5, 0.1, 0.01];
    for (const A of amps) {
      const x = toneMs(fs, FWD.markHz, 200, A);
      const det = createDetector(fs, 3, CARRIER.onDbfs);
      const d = makeDisc(fs);
      const out = d.push(x);
      const estimates = [];
      for (let m = 0; m < out.count; m++) {
        const t = out.firstTimeSamples + m * d.decimation;
        if (t >= d.settledTimeSamples) estimates.push({ t, re: out.re[m], im: out.im[m] });
      }
      const ev = det.push(x, 0, estimates);
      // The level is not returned; check the identity directly on the settled estimates.
      let sum = 0;
      for (const e of estimates) sum += e.re ** 2 + e.im ** 2;
      const level = carrierLevelDbfs(sum / estimates.length);
      expect(Math.abs(level - 20 * Math.log10(A)), `A=${A}`).toBeLessThan(0.2);
      expect(ev.carrier.length).toBeGreaterThan(0);
    }
    expect(carrierLevelDbfs(0)).toBe(-Infinity);
  });

  it('carrier: on after 20 ms above the threshold, off after 50 ms below it, hysteresis 3 dB (requirement 8.3)', () => {
    const fs = 48000;
    // -6.02 dBFS at A = 0.5, so the on threshold -45 dBFS is A = 0.5 * 10^((-45 + 6.02)/20).
    const aOn = 0.5 * 10 ** ((CARRIER.onDbfs - 20 * Math.log10(0.5)) / 20);
    const above = toneMs(fs, FWD.markHz, 1500, aOn * 1.3); // above -45
    const events = demodEvents(above, fs, [], { flush: false });
    const on = events.find((e) => e.type === 'carrier' && e.on);
    expect(on && on.type === 'carrier' && on.atSample).toBeGreaterThanOrEqual(Math.round(0.02 * fs) - 1);
    expect(on && on.type === 'carrier' && on.atSample).toBeLessThanOrEqual(Math.round(0.05 * fs));
    // Then silence: off 50 ms after the tone ends.
    const withSilence = new Float32Array(above.length + Math.round(0.2 * fs));
    withSilence.set(above);
    const ev2 = demodEvents(withSilence, fs, [], { flush: false });
    const off = ev2.filter((e) => e.type === 'carrier' && !e.on);
    expect(off.length).toBe(1);
    if (off[0].type === 'carrier') {
      expect(off[0].atSample).toBeGreaterThanOrEqual(above.length + Math.round(0.05 * fs) - fs * 0.012);
      expect(off[0].atSample).toBeLessThanOrEqual(above.length + Math.round(0.07 * fs));
    }
    // Below the on threshold the carrier never turns on, even when the level is still above the
    // off threshold: hysteresis only delays the drop, it does not lower the level needed to start.
    const weak = demodEvents(toneMs(fs, FWD.markHz, 500, aOn * 10 ** (-4 / 20)), fs, [], { flush: false });
    expect(weak.some((e) => e.type === 'carrier')).toBe(false);
    const justUnder = demodEvents(toneMs(fs, FWD.markHz, 500, aOn * 10 ** (-1 / 20)), fs, [], { flush: false });
    expect(justUnder.some((e) => e.type === 'carrier')).toBe(false);
    // Once on, a level between the two thresholds (2 dB under the on threshold, 1 dB over the off
    // threshold) holds the carrier: it does not drop.
    const midLen = Math.round(0.5 * fs);
    const held = new Float32Array(above.length + midLen);
    held.set(above, 0);
    held.set(toneMs(fs, FWD.markHz, 500, aOn * 10 ** (-2 / 20)), above.length);
    const heldEvents = demodEvents(held, fs, [], { flush: false });
    expect(heldEvents.filter((e) => e.type === 'carrier')).toEqual([
      expect.objectContaining({ type: 'carrier', on: true }),
    ]);
  });

  it('connect: 500 ms of 2100 Hz gives one connect, 450 ms gives none; a page and noise give none (requirement 3.3)', () => {
    const fs = 48000;
    // flush releases the events held at the end of the input (design.md "Event dates and latency").
    const tone = (ms: number, amp = 0.5) => demodEvents(toneMs(fs, ANSWER_TONE_HZ, ms, amp), fs);
    const connects = (ms: number) => tone(ms).filter((e) => e.type === 'connect');
    expect(connects(450)).toHaveLength(0);
    const c500 = connects(500);
    expect(c500).toHaveLength(1);
    if (c500[0].type === 'connect') expect(Math.abs(c500[0].atSample - Math.round(0.5 * fs))).toBeLessThanOrEqual(1);
    // Once per tone, re-armed after a gap.
    const two = demodEvents(
      (() => {
        const a = toneMs(fs, ANSWER_TONE_HZ, 600, 0.5);
        const gap = new Float32Array(Math.round(0.1 * fs));
        const b = toneMs(fs, ANSWER_TONE_HZ, 600, 0.5);
        const all = new Float32Array(a.length + gap.length + b.length);
        all.set(a, 0);
        all.set(b, a.length + gap.length);
        return all;
      })(),
      fs,
    );
    expect(two.filter((e) => e.type === 'connect')).toHaveLength(2);
    // A tone under the carrier threshold is not an answer tone.
    expect(tone(700, 0.0001).filter((e) => e.type === 'connect')).toHaveLength(0);
    // A page of data is not 500 ms of pure 2100 Hz.
    const page = modulate(Uint8Array.from(ascii('3615 SOMMAIRE 3615 SOMMAIRE')), { sampleRate: fs });
    if (!page.ok) throw new Error('modulate');
    expect(demodEvents(page.value, fs).filter((e) => e.type === 'connect')).toHaveLength(0);
    // The default connection sequence (700 ms of answer tone) gives exactly one.
    const seq = connectionSequence({ sampleRate: fs });
    expect(demodEvents(seq, fs).filter((e) => e.type === 'connect')).toHaveLength(1);
  });

  it('diag: at absolute 50 ms boundaries, at most every 50 ms, with the decimated discriminator output (requirement 8.4)', () => {
    const fs = 48000;
    const x = toneMs(fs, FWD.markHz, 1000, 0.5);
    const every = Math.round(0.05 * fs);
    const disc = makeDisc(fs);
    // design.md "Event dates and latency": the latest estimate is dated (last kept input index) -
    // (L - 1)/2 - D/2, and an event dated a is released by push once an estimate dated
    // a + 9.75 T + D + 0.5 has arrived. Without flush, the diags of the last boundaries are held;
    // flush releases them.
    const D0 = disc.decimation;
    const lastKept = Math.floor(x.length / D0) * D0 - 1;
    const lastT = lastKept - disc.groupDelaySamples - D0 / 2;
    const releaseLag = 9.75 * (fs / FWD.baud) + D0 + 0.5;
    const withoutFlush = demodEvents(x, fs, [1, 7, 4000], { flush: false }).filter((e) => e.type === 'diag');
    expect(withoutFlush.length).toBe(Math.floor((lastT - releaseLag) / every));
    expect(withoutFlush.length).toBe(19);
    const events = demodEvents(x, fs, [1, 7, 4000]);
    const diags = events.filter((e): e is Extract<DemodEvent, { type: 'diag' }> => e.type === 'diag');
    const D = Math.max(1, Math.floor(fs / 16000));
    // 1000 ms is itself a boundary, so flush adds no extra diag: exactly 20, all distinct.
    expect(diags.length).toBe(Math.floor(1000 / 50));
    expect(new Set(diags.map((g) => g.atSample)).size).toBe(diags.length);
    diags.forEach((g, i) => {
      expect(g.atSample).toBe(Math.round((i + 1) * 0.05 * fs));
      expect(g.decimation).toBe(D);
      expect(g.thresholdHz).toBe(FWD.thresholdHz);
      expect(g.markHz).toBe(FWD.markHz);
      expect(g.spaceHz).toBe(FWD.spaceHz);
      expect(g.nonFiniteCount).toBe(0);
      // About 0.05 * fs / D estimates per diag, and they read the mark tone. In the last diag, the
      // estimates dated within (L - 1)/2 of the end of the input see the zeros after it (flush):
      // only the first half of that diag is checked.
      expect(g.freqHz.length).toBeGreaterThan(700);
      expect(g.freqHz.length).toBeLessThan(900);
      const checked = i === diags.length - 1 ? g.freqHz.subarray(0, g.freqHz.length / 2) : g.freqHz;
      for (const f of checked) expect(Math.abs(f - FWD.markHz)).toBeLessThan(30);
    });
    // A NaN in the input is counted once and does not throw.
    const dirty = x.slice();
    dirty[100] = Number.NaN;
    dirty[5000] = Infinity;
    const diags2 = demodEvents(dirty, fs, [], { flush: false }).filter((e) => e.type === 'diag');
    const last = diags2[diags2.length - 1];
    expect(last && last.type === 'diag' && last.nonFiniteCount).toBe(2);
  });

  it('diag bitWindows: the windows of a completed frame fall inside the frame and cover its 10 bits', () => {
    const fs = 16000;
    const bytes = Uint8Array.from([0x41]);
    const m = modulate(bytes, { sampleRate: fs, leadIdleMs: 200, tailIdleMs: 100 });
    if (!m.ok) throw new Error('modulate');
    const diags = demodEvents(m.value, fs).filter((e): e is Extract<DemodEvent, { type: 'diag' }> => e.type === 'diag');
    const windows = diags.flatMap((g) => g.bitWindows);
    expect(windows).toHaveLength(10);
    // A frame is reported whole, in a single diag.
    expect(diags.filter((g) => g.bitWindows.length > 0).map((g) => g.bitWindows.length)).toEqual([10]);
    const start = frameStarts(1, fs, 200, 0)[0];
    const bit = fs / FWD.baud;
    windows.forEach(([a, b], i) => {
      expect(Math.abs(a - (start + i * bit))).toBeLessThan(bit / 2);
      expect(b - a).toBeCloseTo(bit, 5);
    });
  });

  it('bitWindows of a frame straddling a diag boundary: whole, in the diag that contains its decision time, for any chunking (regression)', () => {
    // Frame edge 20 samples before a 50 ms boundary, decided about 9.75 bit periods later. Before
    // the fix, 1-sample chunks lost the 2 windows that start before the boundary.
    for (const fs of [16000, 44100, 48000]) {
      const every = Math.round(0.05 * fs);
      const boundary = 4 * every;
      const bit = fs / FWD.baud;
      const m = modulate(Uint8Array.from([0x55]), {
        sampleRate: fs,
        leadIdleMs: ((boundary - 20) / fs) * 1000,
        tailIdleMs: 60,
      });
      if (!m.ok) throw new Error('modulate');
      const whole = demodEvents(m.value, fs);
      const byOne = demodEvents(m.value, fs, Array.from({ length: m.value.length }, () => 1));
      expect(byOne, `fs=${fs}`).toEqual(whole);
      const [c] = charsOf(whole);
      expect(c, `fs=${fs}`).toMatchObject({ value: 0x55, parityOk: true, framingOk: true });
      const carrying = whole.filter((e): e is Extract<DemodEvent, { type: 'diag' }> => e.type === 'diag' && e.bitWindows.length > 0);
      expect(carrying.map((g) => g.bitWindows.length), `fs=${fs}`).toEqual([10]);
      const decision = c.atSample + 9.75 * bit;
      const g = carrying[0];
      expect(g.atSample, `fs=${fs}`).toBeGreaterThan(decision - 1);
      expect(g.atSample - every, `fs=${fs}`).toBeLessThanOrEqual(decision + 1);
    }
  });

  it('flush: one final diag at the end of the input for the interval since the last boundary; the 50 ms grid resumes after it', () => {
    const fs = 16000;
    const every = Math.round(0.05 * fs);
    const x = toneMs(fs, FWD.markHz, 130, 0.5); // ends 30 ms after the 100 ms boundary
    const r = createDemodulator({ sampleRate: fs, threshold: 'fixed' });
    if (!r.ok) throw new Error('demod');
    const pushed = r.value.push(x);
    const flushed = r.value.flush();
    const diags = [...pushed, ...flushed].filter((e): e is Extract<DemodEvent, { type: 'diag' }> => e.type === 'diag');
    expect(diags.map((g) => g.atSample)).toEqual([every, 2 * every, x.length]);
    const last = diags[diags.length - 1];
    // The last diag holds the settled estimates dated in [100 ms, end): no estimate dated after the end.
    expect(last.freqHz.length).toBe(x.length - 2 * every);
    // Estimates dated before end - (L - 1)/2 use real input only and read the mark tone; the last
    // (L - 1)/2 see the zeros of the flush padding (the filter tail) and are not checked.
    const tail = Math.ceil(makeDisc(fs).groupDelaySamples) + 1;
    for (const f of last.freqHz.subarray(0, last.freqHz.length - tail)) expect(Math.abs(f - FWD.markHz)).toBeLessThan(30);
    // After flush, time continues and the next diag is on the absolute grid (150 ms), not 50 ms
    // after the end of the input.
    const after = r.value.push(toneMs(fs, FWD.markHz, 100, 0.5)).filter((e) => e.type === 'diag');
    expect(after[0]?.atSample).toBe(3 * every);
  });

  it('M1 through the public demodulator: createDemodulator decodes modulate(b), then flush, at 8 rates', () => {
    const rng = createRng(77);
    for (const fs of STANDARD_SAMPLE_RATES) {
      const bytes = Uint8Array.from({ length: 40 }, () => Math.floor(rng.nextFloat() * 128));
      const m = modulate(bytes, { sampleRate: fs });
      if (!m.ok) throw new Error('modulate');
      const chars = charsOf(demodEvents(m.value, fs));
      expect(chars.map((c) => c.value), `fs=${fs}`).toEqual(Array.from(bytes));
      expect(chars.every((c) => c.parityOk && c.framingOk), `fs=${fs}`).toBe(true);
    }
  });

  it('M5 chunk invariance: any partition, empty chunks included, gives the same events', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(16000, 48000),
        arbBytes7(1, 15),
        fc.array(fc.integer({ min: 0, max: 5000 }), { maxLength: 25 }),
        (fs, bytes, lens) => {
          const seq = connectionSequence({ sampleRate: fs, answerToneMs: 500, silenceMs: 40, carrierMs: 40 });
          const m = modulate(bytes, { sampleRate: fs, leadIdleMs: 60, tailIdleMs: 40 });
          if (!m.ok) throw new Error('modulate');
          const x = new Float32Array(seq.length + m.value.length);
          x.set(seq, 0);
          x.set(m.value, seq.length);
          const whole = demodEvents(x, fs, []);
          const parts = demodEvents(x, fs, [0, 1, ...lens]);
          expect(parts).toEqual(whole);
        },
      ),
      { numRuns: DEMOD_RUNS },
    );
  });

  it('silence and a dropped carrier produce no characters; flush emits the carrier off and the tail', () => {
    const fs = 48000;
    const bytes = Uint8Array.from(ascii('AB'));
    const m = modulate(bytes, { sampleRate: fs, leadIdleMs: 100, tailIdleMs: 30 });
    if (!m.ok) throw new Error('modulate');
    // Without flush the short tail may hold the last frame; with flush every byte comes out and
    // the carrier ends off.
    const flushed = demodEvents(m.value, fs);
    expect(charsOf(flushed).map((c) => c.value)).toEqual([65, 66]);
    const carriers = flushed.filter((e) => e.type === 'carrier');
    expect(carriers[carriers.length - 1]).toMatchObject({ type: 'carrier', on: false });
    // Pure silence: no carrier, no char.
    const quiet = demodEvents(new Float32Array(Math.round(0.3 * fs)), fs);
    expect(quiet.some((e) => e.type === 'carrier' || e.type === 'char')).toBe(false);
  });

  it('robustness: arbitrary samples never throw and events are well typed', () => {
    const types = ['carrier', 'connect', 'char', 'quality', 'diag'];
    fc.assert(
      fc.property(fc.float64Array({ minLength: 0, maxLength: 4000 }), (values) => {
        const x = Float32Array.from(values, (v) => (Number.isFinite(v) ? Math.max(-10, Math.min(10, v)) : v));
        let events: DemodEvent[] = [];
        expect(() => {
          events = demodEvents(x, 22050, [0, 1, 3]);
        }).not.toThrow();
        for (const e of events) {
          expect(types).toContain(e.type);
          expect(Number.isInteger(e.atSample)).toBe(true);
          expect(e.atSample).toBeGreaterThanOrEqual(0);
          if (e.type === 'quality') {
            // Task 10: SNR values are numbers (+-Infinity allowed), rates in [0, 1], offset finite.
            for (const v of [e.snrBandDb, e.snr3kDb, e.ebN0Db]) expect(Number.isNaN(v)).toBe(false);
            expect(e.parityErrorRate).toBeGreaterThanOrEqual(0);
            expect(e.parityErrorRate).toBeLessThanOrEqual(1);
            expect(Number.isFinite(e.offsetHz)).toBe(true);
          }
        }
      }),
      { numRuns: DEMOD_RUNS },
    );
  });

  it('quality events from task 10 (decision T7-5 lifted); reset returns to the initial state', () => {
    const fs = 16000;
    const m = modulate(Uint8Array.from(ascii('Z')), { sampleRate: fs });
    if (!m.ok) throw new Error('modulate');
    const r = createDemodulator({ sampleRate: fs, threshold: 'fixed' });
    if (!r.ok) throw new Error('demod');
    const first = [...r.value.push(m.value), ...r.value.flush()];
    // 'Z' lasts 158 ms: carrier on at 20 ms, so the 100 ms boundary has 80 ms of estimates.
    expect(first.filter((e) => e.type === 'quality').map((e) => e.atSample)).toEqual([1600]);
    expect(charsOf(first).map((c) => c.value)).toEqual([90]);
    r.value.reset();
    expect([...r.value.push(m.value), ...r.value.flush()]).toEqual(first);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 8: adaptive threshold. Offset signals are synthesised in closed form (fskOffset): the line
// simulator (task 9) does not exist yet. Noise: gamma_3k = 20 dB (A7).

const OFFSET_RUNS = isSlowTestsEnabled() ? 60 : 12;

/** Events of a demodulator with the given options; chunked pushes, then flush. */
function demodWith(x: Float32Array, fs: number, threshold: 'fixed' | 'adaptive' | undefined, chunkLens: readonly number[] = []): DemodEvent[] {
  const r = createDemodulator({ sampleRate: fs, threshold });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  const out: DemodEvent[] = [];
  let pos = 0;
  for (const len of chunkLens) {
    if (pos >= x.length) break;
    const end = Math.min(x.length, pos + len);
    out.push(...r.value.push(x.subarray(pos, end)));
    pos = end;
  }
  out.push(...r.value.push(x.subarray(pos)));
  out.push(...r.value.flush());
  return out;
}

function noisyOffset(bytes: Uint8Array, fs: number, offsetHz: number, seed: number, idle = 0): Float32Array {
  return awgn(fskOffset(bytes, fs, offsetHz, { idle }), { sampleRate: fs, snrDb: M8_SNR_3K_DB, bandwidthHz: 3000, signalAmplitude: 0.5, seed });
}

/** Estimated offset reported by the last diag: markHz - nominal mark. */
function reportedOffset(events: readonly DemodEvent[]): number {
  const diags = events.filter((e): e is Extract<DemodEvent, { type: 'diag' }> => e.type === 'diag');
  return diags[diags.length - 1].markHz - FWD.markHz;
}

describe('v23-modem task 8: adaptive threshold', () => {
  it('non-regression: the fixed-threshold output is identical to the task 7 code (golden digests)', () => {
    // Digests produced by the task 7 code (commit 18a066b) with fixedGoldenDigests(), before any
    // task 8 change: clean 48 kHz page, noisy 44.1 kHz page, connection + page at 16 kHz, and a
    // +200 Hz offset page with noise at 22.05 kHz.
    expect(fixedGoldenDigests()).toEqual([
      '399d1a228b3e18e41e59fafe8f7d0279d4642f2b833a89314a80583fa4832a7f',
      'f1b237aa2b9946ae7f0b79c473e7df98757ce863bff95c6ddb633d4edc15aeac',
      '901c9e28d1a7aa2c406ea284138a82382d58c1667afc54e378243471525509a7',
      'f5f84064866570dc49c731f4ae4077377cc5b3f7e13aa9f812f4a6ff0fea59d5',
    ]);
  });

  it('M7 offset: in adaptive mode, for any offset in [-400, +400] Hz at 20 dB SNR, bytes are decoded without error and |offsetHz - true offset| <= 20', () => {
    const failures: string[] = [];
    let worstOffsetErr = 0;
    const check = (fs: number, off: number, bytes: Uint8Array, seed: number, idle: number): void => {
      const events = demodWith(noisyOffset(bytes, fs, off, seed, idle), fs, undefined);
      const chars = charsOf(events);
      const exact = chars.length === bytes.length && chars.every((c, j) => c.value === bytes[j] && c.parityOk && c.framingOk);
      const err = Math.abs(reportedOffset(events) - off);
      worstOffsetErr = Math.max(worstOffsetErr, err);
      if (!exact || err > 20) failures.push(`fs=${fs} off=${off.toFixed(1)} idle=${idle} seed=${seed}: exact=${exact} offsetErr=${err.toFixed(2)}`);
    };
    const rng = createRng(88);
    for (const fs of STANDARD_SAMPLE_RATES) {
      const bytes = Uint8Array.from({ length: 40 }, () => Math.floor(rng.nextFloat() * 128));
      for (const off of [-400, -300, -200, -100, 0, 100, 200, 300, 400]) check(fs, off, bytes, 500 + off + fs, 0);
    }
    fc.assert(
      fc.property(
        arbUartRate,
        fc.double({ min: -400, max: 400, noNaN: true }),
        arbBytes7(1, 40),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 1, max: 0x7fffffff }),
        (fs, off, bytes, idle, seed) => check(fs, off, bytes, seed, idle),
      ),
      { numRuns: OFFSET_RUNS },
    );
    console.log(`M7: ${failures.length} failing cases; worst |offset estimate - offset| ${worstOffsetErr.toFixed(2)} Hz`);
    if (failures.length > 0) console.log(failures.slice(0, 20).join('\n'));
    expect(failures).toEqual([]);
  });

  it('characterization: at +400 Hz the fixed threshold fails (mark sits on 1700 Hz), the adaptive one decodes', () => {
    const fs = 48000;
    const bytes = Uint8Array.from(ascii('3615 FANTOME'));
    const x = noisyOffset(bytes, fs, 400, 4);
    const fixedChars = charsOf(demodWith(x, fs, 'fixed'));
    expect(charsAreExact(fixedChars as unknown as UartChar[], bytes)).toBe(false);
    expect(charsOf(demodWith(x, fs, 'adaptive')).map((c) => c.value)).toEqual(Array.from(bytes));
  });

  it('diag: adaptive mode reports the threshold and tone estimates, fixed mode the nominal values', () => {
    const fs = 22050;
    const bytes = Uint8Array.from(ascii('ABCDEFGH'));
    const x = noisyOffset(bytes, fs, -250, 9);
    const adaptive = demodWith(x, fs, 'adaptive').filter((e): e is Extract<DemodEvent, { type: 'diag' }> => e.type === 'diag');
    const last = adaptive[adaptive.length - 1];
    expect(Math.abs(last.markHz - (FWD.markHz - 250))).toBeLessThanOrEqual(20);
    expect(Math.abs(last.spaceHz - (FWD.spaceHz - 250))).toBeLessThanOrEqual(20);
    expect(last.thresholdHz).toBeCloseTo((last.markHz + last.spaceHz) / 2, 9);
    // Before the idle-carrier initialisation (carrier on + 20 ms), the nominal values are reported.
    const silenceFirst = new Float32Array(Math.round(0.2 * fs) + x.length);
    silenceFirst.set(x, Math.round(0.2 * fs));
    const early = demodWith(silenceFirst, fs, 'adaptive').filter((e): e is Extract<DemodEvent, { type: 'diag' }> => e.type === 'diag');
    expect(early[0]).toMatchObject({ thresholdHz: FWD.thresholdHz, markHz: FWD.markHz, spaceHz: FWD.spaceHz });
    for (const g of demodWith(x, fs, 'fixed').filter((e): e is Extract<DemodEvent, { type: 'diag' }> => e.type === 'diag')) {
      expect(g).toMatchObject({ thresholdHz: FWD.thresholdHz, markHz: FWD.markHz, spaceHz: FWD.spaceHz });
    }
  });

  it('requirement 7.4: switching the mode while decoding keeps the position', () => {
    const fs = 16000;
    const rng = createRng(31);
    const bytes = Uint8Array.from({ length: 60 }, () => Math.floor(rng.nextFloat() * 128));
    const frameSamples = (FRAME.bitsPerFrame * fs) / FWD.baud;
    const leadSamples = 0.1 * fs;
    // Zero offset: both modes decode, so every byte must come out whatever the switches.
    {
      const x = noisyOffset(bytes, fs, 0, 21);
      const r = createDemodulator({ sampleRate: fs, threshold: 'fixed' });
      if (!r.ok) throw new Error('demod');
      const events: DemodEvent[] = [];
      const step = Math.round(frameSamples * 7.3);
      let mode: 'fixed' | 'adaptive' = 'fixed';
      for (let p = 0; p < x.length; p += step) {
        events.push(...r.value.push(x.subarray(p, Math.min(x.length, p + step))));
        mode = mode === 'fixed' ? 'adaptive' : 'fixed';
        r.value.setThresholdMode(mode);
      }
      events.push(...r.value.flush());
      expect(charsOf(events).map((c) => c.value)).toEqual(Array.from(bytes));
    }
    // +300 Hz: start in fixed mode, switch to adaptive in the middle. Every frame that starts after
    // the switch is decoded, and no frame is duplicated or lost around it.
    {
      const x = noisyOffset(bytes, fs, 300, 22);
      const r = createDemodulator({ sampleRate: fs, threshold: 'fixed' });
      if (!r.ok) throw new Error('demod');
      const switchAt = Math.round(leadSamples + 30.4 * frameSamples);
      const events = [...r.value.push(x.subarray(0, switchAt))];
      r.value.setThresholdMode('adaptive');
      events.push(...r.value.push(x.subarray(switchAt)), ...r.value.flush());
      const after = charsOf(events).filter((c) => c.atSample > switchAt + frameSamples);
      const firstIndex = Math.round((after[0].atSample - leadSamples) / frameSamples);
      expect(after.map((c) => c.value)).toEqual(Array.from(bytes.slice(firstIndex)));
      expect(after.every((c) => c.parityOk && c.framingOk)).toBe(true);
      expect(firstIndex).toBeLessThanOrEqual(33);
    }
  });

  it('a connection sequence then an offset page: the estimates are re-initialised on the page carrier', () => {
    const fs = 16000;
    const seq = connectionSequence({ sampleRate: fs });
    const bytes = Uint8Array.from(ascii('3615 SOMMAIRE'));
    const page = noisyOffset(bytes, fs, 250, 5);
    // 150 ms of silence after the sequence: the carrier drops (50 ms hold), the estimates are
    // cleared, and the page carrier initialises them again. Without a drop, the estimates of the
    // nominal connection carrier would be kept (design.md "Threshold", limits).
    const gap = Math.round(0.15 * fs);
    const x = new Float32Array(seq.length + gap + page.length);
    x.set(seq, 0);
    x.set(page, seq.length + gap);
    const events = demodWith(x, fs, undefined);
    expect(events.filter((e) => e.type === 'connect')).toHaveLength(1);
    expect(charsOf(events).map((c) => c.value)).toEqual(Array.from(bytes));
    expect(Math.abs(reportedOffset(events) - 250)).toBeLessThanOrEqual(20);
  });

  it('connect at every standard rate: the default connection sequence gives exactly one connect, at 500 ms (Goertzel fix)', () => {
    for (const fs of STANDARD_SAMPLE_RATES) {
      const connects = demodWith(connectionSequence({ sampleRate: fs }), fs, undefined).filter((e) => e.type === 'connect');
      expect(connects, `fs=${fs}`).toHaveLength(1);
      // 25 blocks of round(0.02 fs) samples.
      expect(connects[0].atSample, `fs=${fs}`).toBe(25 * Math.round(0.02 * fs));
    }
    // A pure 2100 Hz tone fills its block: 2 |X|^2 / N^2 equals the mean square.
    const fs = 16000;
    const tone = demodWith(toneMs(fs, ANSWER_TONE_HZ, 600, 0.5), fs, undefined).filter((e) => e.type === 'connect');
    expect(tone).toHaveLength(1);
  });

  it('M5 in adaptive mode: any partition gives the same events, with an offset and noise', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(16000, 48000),
        arbBytes7(1, 15),
        fc.double({ min: -400, max: 400, noNaN: true }),
        fc.array(fc.integer({ min: 0, max: 5000 }), { maxLength: 25 }),
        (fs, bytes, off, lens) => {
          const x = noisyOffset(bytes, fs, off, 17);
          expect(demodWith(x, fs, 'adaptive', [0, 1, ...lens])).toEqual(demodWith(x, fs, 'adaptive'));
        },
      ),
      { numRuns: DEMOD_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Task 9: line simulator (requirement 11, design.md "Line simulator API")

const CH_RUNS = isSlowTestsEnabled() ? 60 : 10;
const PAGE_BYTES = Uint8Array.from(ascii('3615 NEOMINITEL'));

function mustChannel(p: ChannelParams): LineChannel {
  const r = createChannel(p);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function mustApply(x: Float32Array, p: ChannelParams): Float32Array {
  const r = applyChannel(x, p);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function concatF32(parts: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Byte-identical comparison of two Float32Arrays. */
function sameBytes(a: Float32Array, b: Float32Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

/** Streams x through a fresh channel in chunks of the given lengths (remainder last), then flush. */
function streamChannel(x: Float32Array, p: ChannelParams, chunkLens: readonly number[] = []): Float32Array {
  const ch = mustChannel(p);
  const parts: Float32Array[] = [];
  let pos = 0;
  for (const len of chunkLens) {
    if (pos >= x.length) break;
    const end = Math.min(x.length, pos + len);
    parts.push(ch.process(x.subarray(pos, end)));
    pos = end;
  }
  parts.push(ch.process(x.subarray(pos)));
  parts.push(ch.flush());
  return concatF32(parts);
}

function pageAt(fs: number): Float32Array {
  return mustModulate(PAGE_BYTES, { sampleRate: fs });
}

/** Hann-windowed tone amplitude at fHz over [from, to): A for a tone A sin(2 pi f t + phi). */
function hannAmplitude(x: Float32Array, fs: number, fHz: number, from: number, to: number): number {
  let re = 0;
  let im = 0;
  let ws = 0;
  const n = to - from;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const a = (2 * Math.PI * fHz * (from + i)) / fs;
    re += w * x[from + i] * Math.cos(a);
    im -= w * x[from + i] * Math.sin(a);
    ws += w;
  }
  return (2 * Math.hypot(re, im)) / ws;
}

function meanSquare(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return s / x.length;
}

describe('v23-modem task 9: line simulator', () => {
  it('factory: bad-sample-rate, bad-option for each invalid parameter; never throws', () => {
    for (const fs of [7999, 96001, NaN, Infinity]) {
      expect(createChannel({ sampleRate: fs, seed: 1 })).toEqual({ ok: false, error: { kind: 'bad-sample-rate', sampleRate: fs } });
    }
    const ok = { sampleRate: 48000, seed: 1 };
    const cases: [string, Record<string, unknown>][] = [
      ['seed', { seed: -1 }],
      ['seed', { seed: 1.5 }],
      ['seed', { seed: 2 ** 32 }],
      ['channel', { channel: 'up' }],
      ['signalAmplitude', { signalAmplitude: 0 }],
      ['signalAmplitude', { signalAmplitude: NaN }],
      ['noise', { noise: 3 }],
      ['noise', { noise: { kind: 'snr', db: 10 } }],
      ['noise', { noise: { kind: 'ebN0', db: NaN } }],
      ['offsetHz', { offsetHz: 24000 }],
      ['offsetHz', { offsetHz: NaN }],
      ['clockPpm', { clockPpm: 100001 }],
      ['clockPpm', { clockPpm: -Infinity }],
      ['hum', { hum: { levelDb: NaN } }],
      ['hum', { hum: { levelDb: -20, harmonics: 0 } }],
      ['hum', { hum: { levelDb: -20, harmonics: 2.5 } }],
      ['hum', { hum: { levelDb: -20, harmonics: 21 } }],
      ['hum', { hum: { levelDb: -20, fundamentalHz: 24000 } }],
      ['bursts', { bursts: { ratePerS: -1, durationMs: [5, 25], levelDb: 0 } }],
      ['bursts', { bursts: { ratePerS: 1, durationMs: [0, 25], levelDb: 0 } }],
      ['bursts', { bursts: { ratePerS: 1, durationMs: [30, 25], levelDb: 0 } }],
      ['bursts', { bursts: { ratePerS: 1, durationMs: [5], levelDb: 0 } }],
      ['bursts', { bursts: { ratePerS: 1, durationMs: [5, 25], levelDb: NaN } }],
    ];
    for (const [option, extra] of cases) {
      const r = createChannel({ ...ok, ...extra } as unknown as ChannelParams);
      expect(r, `${option} ${JSON.stringify(extra)}`).toEqual({ ok: false, error: { kind: 'bad-option', option, reason: expect.any(String) } });
    }
    expect(createChannel({ sampleRate: 8000, seed: 0xffffffff }).ok).toBe(true);
    const full: ChannelParams = {
      ...ok,
      channel: 'backward',
      signalAmplitude: 0.3,
      noise: { kind: 'snr3k', db: 20 },
      offsetHz: -300,
      clockPpm: -100000,
      hum: DEFAULT_HUM,
      bursts: DEFAULT_BURSTS,
    };
    expect(createChannel(full).ok).toBe(true);
    expect(applyChannel([1, 2] as unknown as Float32Array, ok)).toEqual({ ok: false, error: { kind: 'bad-option', option: 'x', reason: expect.any(String) } });
    expect(applyChannel(new Float32Array(0), ok)).toEqual({ ok: true, value: new Float32Array(0) });
    expect(DEFAULT_HUM).toEqual({ levelDb: -20, fundamentalHz: 50, harmonics: 5 });
    expect(DEFAULT_BURSTS).toEqual({ ratePerS: 0.5, durationMs: [5, 25], levelDb: 0 });
  });

  it('identity: with no impairment, applyChannel returns its input and the stream is the input delayed by the latency', () => {
    for (const fs of STANDARD_SAMPLE_RATES) {
      const x = pageAt(fs);
      expect(sameBytes(mustApply(x, { sampleRate: fs, seed: 3 }), x), `fs=${fs}`).toBe(true);
      const lat = channelLatencySamples(fs);
      const ch = mustChannel({ sampleRate: fs, seed: 3 });
      const a = ch.process(x.subarray(0, 1000));
      const b = ch.process(x.subarray(1000));
      const tail = ch.flush();
      expect([a.length, b.length, tail.length]).toEqual([1000, x.length - 1000, lat]);
      const all = concatF32([a, b, tail]);
      expect(all.subarray(0, lat).every((v) => v === 0)).toBe(true);
      expect(sameBytes(all.subarray(lat), x), `fs=${fs}`).toBe(true);
    }
  });

  it('9.2 determinism: same parameters and seed give byte-identical output, whatever the chunk boundaries', () => {
    const arbOptional = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });
    const arbCase = fc.record({
      fs: fc.constantFrom(8000, 22050, 44100, 48000),
      seed: fc.integer({ min: 0, max: 0xffffffff }),
      noise: arbOptional(
        fc.record({ kind: fc.constantFrom<'ebN0' | 'snr3k'>('ebN0', 'snr3k'), db: fc.double({ min: 0, max: 30, noNaN: true }) }),
      ),
      offsetHz: arbOptional(fc.double({ min: -400, max: 400, noNaN: true })),
      clockPpm: arbOptional(fc.double({ min: -30000, max: 30000, noNaN: true })),
      hum: arbOptional(fc.record({ levelDb: fc.double({ min: -30, max: 0, noNaN: true }), harmonics: fc.integer({ min: 1, max: 7 }) })),
      bursts: arbOptional(fc.constant({ ratePerS: 20, durationMs: [2, 10] as [number, number], levelDb: 0 })),
    });
    fc.assert(
      fc.property(arbCase, arbBytes7(1, 4), fc.array(fc.integer({ min: 0, max: 3000 }), { maxLength: 12 }), (q, bytes, lens) => {
        const x = mustModulate(bytes, { sampleRate: q.fs });
        const p: ChannelParams = {
          sampleRate: q.fs,
          seed: q.seed,
          noise: q.noise as ChannelParams['noise'],
          offsetHz: q.offsetHz,
          clockPpm: q.clockPpm,
          hum: q.hum,
          bursts: q.bursts,
        };
        const once = mustApply(x, p);
        expect(sameBytes(mustApply(x, p), once)).toBe(true);
        const whole = streamChannel(x, p);
        expect(sameBytes(streamChannel(x, p, [0, 1, ...lens]), whole)).toBe(true);
        // applyChannel is the stream without its latency.
        expect(sameBytes(whole.subarray(channelLatencySamples(q.fs)), once)).toBe(true);
      }),
      { numRuns: CH_RUNS },
    );
    // Another seed gives other noise.
    const x = pageAt(8000);
    const noisy = (seed: number) => mustApply(x, { sampleRate: 8000, seed, noise: { kind: 'ebN0', db: 10 } });
    expect(sameBytes(noisy(1), noisy(2))).toBe(false);
  });

  it('AWGN (A7): the noise-only channel equals the awgn helper for the same seed; ebN0 and snr3k follow R5; variance follows R1', () => {
    for (const fs of [8000, 48000]) {
      const x = pageAt(fs);
      const seed = 21;
      const viaEb = mustApply(x, { sampleRate: fs, seed, noise: { kind: 'ebN0', db: 12 } });
      expect(sameBytes(viaEb, awgn(x, { sampleRate: fs, ebN0Db: 12, signalAmplitude: 0.5, seed }))).toBe(true);
      const via3k = mustApply(x, { sampleRate: fs, seed, noise: { kind: 'snr3k', db: 20 } });
      expect(sameBytes(via3k, awgn(x, { sampleRate: fs, snrDb: 20, bandwidthHz: 3000, signalAmplitude: 0.5, seed }))).toBe(true);
      // R5: Eb/N0 = γ_3k + 10 log10(3000 / 1200).
      const viaR5 = mustApply(x, { sampleRate: fs, seed, noise: { kind: 'ebN0', db: 20 + 10 * Math.log10(3000 / 1200) } });
      let maxDiff = 0;
      for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(viaR5[i] - via3k[i]));
      expect(maxDiff).toBeLessThanOrEqual(1e-6);
    }
    // R1 on silence: sigma^2 = A^2 fs / (4 R 10^(Eb/N0 / 10)), with R the bit rate of the channel.
    for (const [channel, baud] of [
      ['forward', 1200],
      ['backward', 75],
    ] as const) {
      const fs = 16000;
      const amp = 0.3;
      const y = mustApply(new Float32Array(400000), { sampleRate: fs, seed: 5, channel, signalAmplitude: amp, noise: { kind: 'ebN0', db: 10 } });
      const s2 = (amp * amp * fs) / (4 * baud * 10);
      expect(Math.abs(meanSquare(y) / s2 - 1), channel).toBeLessThanOrEqual(0.01);
    }
  });

  it('frequency offset (SSB): a tone moves by offsetHz; the image and the original are at least 40 dB down', () => {
    const amp = 0.5;
    for (const fs of [8000, 44100, 48000]) {
      for (const f of [FWD.markHz, FWD.spaceHz]) {
        for (const off of [-400, -37.5, 120, 400]) {
          const x = toneMs(fs, f, 300, amp);
          const y = mustApply(x, { sampleRate: fs, seed: 1, offsetHz: off });
          expect(y.length).toBe(x.length);
          const from = Math.round(0.03 * fs);
          const to = y.length - from;
          const tag = `fs=${fs} f=${f} off=${off}`;
          expect(Math.abs(hannAmplitude(y, fs, f + off, from, to) / amp - 1), tag).toBeLessThanOrEqual(0.01);
          expect(hannAmplitude(y, fs, f - off, from, to) / amp, tag).toBeLessThanOrEqual(0.01);
          expect(hannAmplitude(y, fs, f, from, to) / amp, tag).toBeLessThanOrEqual(0.01);
        }
      }
    }
  });

  it('clock offset: the output lasts N / (1 + eps), tones are scaled by (1 + eps), and a page still decodes', () => {
    const amp = 0.5;
    for (const fs of [8000, 48000]) {
      for (const ppm of [-20000, 20000]) {
        const step = 1 + ppm * 1e-6;
        const x = toneMs(fs, FWD.markHz, 300, amp);
        const y = mustApply(x, { sampleRate: fs, seed: 1, clockPpm: ppm });
        let expectedLength = 0;
        while (expectedLength * step <= x.length - 1) expectedLength++;
        const tag = `fs=${fs} ppm=${ppm}`;
        expect(y.length, tag).toBe(expectedLength);
        const from = Math.round(0.03 * fs);
        const to = y.length - from;
        expect(Math.abs(hannAmplitude(y, fs, FWD.markHz * step, from, to) / amp - 1), tag).toBeLessThanOrEqual(0.01);
        expect(hannAmplitude(y, fs, FWD.markHz, from, to) / amp, tag).toBeLessThanOrEqual(0.01);
        const z = mustApply(pageAt(fs), { sampleRate: fs, seed: 2, clockPpm: ppm });
        expect(charsOf(demodWith(z, fs, undefined)).map((c) => c.value), tag).toEqual(Array.from(PAGE_BYTES));
      }
    }
  });

  it('hum: total power P 10^(levelDb / 10), harmonics k f0 with amplitudes c / k; a page under 0 dB hum still decodes', () => {
    const pSignal = 0.125; // A = 0.5
    for (const fs of [8000, 48000]) {
      const y = mustApply(new Float32Array(fs), { sampleRate: fs, seed: 1, hum: DEFAULT_HUM });
      const pHum = pSignal * 10 ** (-20 / 10);
      expect(Math.abs(meanSquare(y) / pHum - 1), `fs=${fs}`).toBeLessThanOrEqual(0.005);
      let s = 0;
      for (let k = 1; k <= 5; k++) s += 1 / (k * k);
      const c = Math.sqrt((2 * pHum) / s);
      for (let k = 1; k <= 5; k++) {
        // One second: every harmonic falls on a DFT bin.
        const mag = (2 * toneMagnitude(y, fs, 50 * k, 0, fs)) / fs;
        expect(Math.abs(mag / (c / k) - 1), `fs=${fs} k=${k}`).toBeLessThanOrEqual(0.005);
      }
    }
    const fs = 44100;
    const z = mustApply(pageAt(fs), { sampleRate: fs, seed: 3, hum: { levelDb: 0 } });
    for (const mode of ['fixed', 'adaptive'] as const) {
      expect(charsOf(demodWith(z, fs, mode)).map((ch) => ch.value), mode).toEqual(Array.from(PAGE_BYTES));
    }
  });

  it('bursts: Poisson arrivals with durations in range and the requested 3 kHz level; the AWGN stream is unchanged outside bursts', () => {
    const fs = 8000;
    const seconds = 60;
    const rate = 2;
    const levelDb = -3;
    const zeros = new Float32Array(seconds * fs);
    const bursts = { ratePerS: rate, durationMs: [5, 25] as [number, number], levelDb };
    const b = mustApply(zeros, { sampleRate: fs, seed: 9, bursts });
    const segs: [number, number][] = [];
    for (let i = 0; i < b.length; ) {
      if (b[i] === 0) {
        i++;
        continue;
      }
      const start = i;
      while (i < b.length && b[i] !== 0) i++;
      segs.push([start, i]);
    }
    // Poisson count, mean 120: accept 4 standard deviations.
    expect(segs.length).toBeGreaterThanOrEqual(76);
    expect(segs.length).toBeLessThanOrEqual(164);
    let energy = 0;
    let samples = 0;
    for (const [s0, s1] of segs) {
      expect(s1 - s0).toBeGreaterThanOrEqual(Math.round(0.005 * fs));
      expect(s1 - s0).toBeLessThanOrEqual(Math.round(0.025 * fs));
      for (let i = s0; i < s1; i++) energy += b[i] * b[i];
      samples += s1 - s0;
    }
    // sigma_b^2 = P 10^(levelDb / 10) / 3000 * fs / 2.
    const s2 = ((0.125 * 10 ** (levelDb / 10)) / 3000) * (fs / 2);
    expect(Math.abs(energy / samples / s2 - 1)).toBeLessThanOrEqual(0.05);
    const noise = { kind: 'snr3k', db: 10 } as const;
    const n = mustApply(zeros, { sampleRate: fs, seed: 9, noise });
    const both = mustApply(zeros, { sampleRate: fs, seed: 9, noise, bursts });
    let outside = true;
    let maxInside = 0;
    let k = 0;
    for (let i = 0; i < both.length; i++) {
      while (k < segs.length && segs[k][1] <= i) k++;
      const inBurst = k < segs.length && segs[k][0] <= i;
      if (inBurst) maxInside = Math.max(maxInside, Math.abs(both[i] - (n[i] + b[i])));
      else if (both[i] !== n[i]) outside = false;
    }
    expect(outside).toBe(true);
    expect(maxInside).toBeLessThanOrEqual(1e-6);
  });

  it('setParams: from the next sample; undefined switches an impairment off; unchanged or invalid updates change nothing; flush and reset restart', () => {
    const fs = 16000;
    const x = pageAt(fs);
    const lat = channelLatencySamples(fs);
    const cut = 3000;
    const p: ChannelParams = { sampleRate: fs, seed: 4, noise: { kind: 'ebN0', db: 10 }, hum: DEFAULT_HUM, bursts: DEFAULT_BURSTS };
    // Update shaped like src/workers/modem-bridge.ts: every key present, undefined when switched off.
    const ch = mustChannel(p);
    ch.process(x.subarray(0, cut));
    ch.setParams({ channel: 'forward', signalAmplitude: 0.5, noise: undefined, offsetHz: 0, clockPpm: 0, hum: undefined, bursts: undefined });
    expect(sameBytes(ch.process(x.subarray(cut)), x.subarray(cut - lat, x.length - lat))).toBe(true);

    // Re-sending the same values (the bridge does it on every slider move) and invalid updates.
    const q: ChannelParams = { ...p, offsetHz: 150, clockPpm: 3000 };
    const ref = streamChannel(x, q, [cut]);
    const c2 = mustChannel(q);
    const parts = [c2.process(x.subarray(0, cut))];
    c2.setParams({ noise: { kind: 'ebN0', db: 10 }, hum: { ...DEFAULT_HUM }, bursts: { ...DEFAULT_BURSTS, durationMs: [5, 25] }, offsetHz: 150, clockPpm: 3000 });
    c2.setParams({ offsetHz: NaN });
    c2.setParams({ noise: { kind: 'ebN0', db: 30 }, clockPpm: 1e9 }); // invalid as a whole
    c2.setParams(null as unknown as Partial<ChannelParams>);
    parts.push(c2.process(x.subarray(cut)), c2.flush());
    expect(sameBytes(concatF32(parts), ref)).toBe(true);

    // flush and reset bring back the initial state, with the current parameters.
    const fresh = streamChannel(x, q);
    const c3 = mustChannel(q);
    c3.process(x.subarray(0, 5000));
    c3.reset();
    expect(sameBytes(concatF32([c3.process(x), c3.flush()]), fresh)).toBe(true);
    expect(sameBytes(concatF32([c3.process(x), c3.flush()]), fresh)).toBe(true);

    // A live offset starts at phase 0 on the next output sample, then rotates.
    const c4 = mustChannel({ sampleRate: fs, seed: 4 });
    c4.process(x.subarray(0, cut));
    c4.setParams({ offsetHz: 200 });
    const after = c4.process(x.subarray(cut));
    expect(after[0]).toBe(x[cut - lat]);
    expect(sameBytes(after, x.subarray(cut - lat, x.length - lat))).toBe(false);
  });

  it('end to end: a page through clock offset, frequency offset, hum and 20 dB noise decodes in adaptive mode', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(8000, 44100, 48000),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        (fs, seed, off, ppm) => {
          const z = mustApply(pageAt(fs), { sampleRate: fs, seed, offsetHz: off, clockPpm: ppm, hum: DEFAULT_HUM, noise: { kind: 'snr3k', db: 20 } });
          expect(charsOf(demodWith(z, fs, 'adaptive')).map((c) => c.value)).toEqual(Array.from(PAGE_BYTES));
        },
      ),
      { numRuns: CH_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Task 10: quality and BER (requirements 9 and 10.1-10.3, design.md "Quality", "PN9 and BER")

const BER_RUNS = isSlowTestsEnabled() ? 400 : 60;

/** Two-sided noise bandwidth B_n of the forward low-pass at fs (the demodulator's). */
function forwardNoiseBandwidth(fs: number): number {
  return noiseBandwidthHz(designLowpass(fs, FWD.lowpassHz, DISCRIMINATOR.forward.transitionHz), fs);
}

function qualityOf(events: readonly DemodEvent[]): Extract<DemodEvent, { type: 'quality' }>[] {
  return events.filter((e): e is Extract<DemodEvent, { type: 'quality' }> => e.type === 'quality');
}

/** Sequence bits of pn9Frames output, 7 per byte, LSB first. */
function bitsOfFrames(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (const b of bytes) for (let i = 0; i < 7; i++) out.push((b >> i) & 1);
  return out;
}

describe('v23-modem task 10: PN9, BER counter and Wilson interval', () => {
  it('M11 PN9: period is 511; with k injected bit errors among n bits and no framing errors, the counter reports exactly k errors', () => {
    // Period: 73 frames of 7 bits = 511 bits, and no shorter period (511 = 7 x 73).
    const two = bitsOfFrames(pn9Frames(146));
    expect(two.slice(0, 511)).toEqual(two.slice(511));
    for (const p of [7, 73]) expect(two.slice(0, 511 - p)).not.toEqual(two.slice(p, 511));
    expect(two.slice(0, 511).reduce((s, b) => s + b, 0)).toBe(256); // m-sequence: 2^8 ones
    expect(two.slice(0, 9)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]); // seed 0x1FF
    // Recurrence of x^9 + x^5 + 1: a[n + 9] = a[n + 5] xor a[n].
    for (let n = 0; n + 9 < two.length; n++) expect(two[n + 9]).toBe(two[n + 5] ^ two[n]);
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 400 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (n, start, k, seed) => {
          const tx = pn9Frames(n, { startFrame: start });
          expect(Array.from(tx)).toEqual(Array.from(pn9Frames(start + n).subarray(start)));
          const rx = tx.slice();
          // k distinct error positions among the counted bits (after the 9 sync bits). At most
          // 20 errors, so no window of 100 bits exceeds the resync limit.
          const rng = createRng(seed);
          const counted = 7 * n - 9;
          const kk = Math.min(k, counted);
          const picked = new Set<number>();
          while (picked.size < kk) picked.add(9 + rng.nextInt(0, counted - 1));
          for (const pos of picked) rx[Math.floor(pos / 7)] ^= 1 << pos % 7;
          const c = new BerCounter();
          for (const v of rx) c.pushFrame(v, true);
          const s = c.snapshot();
          expect(s).toEqual({ ...s, bits: counted, errors: kk, synced: true, resyncs: 0 });
          expect(s.ber).toBeCloseTo(kk / counted, 15);
          expect([s.lo, s.hi]).toEqual([wilson95(kk, counted).lo, wilson95(kk, counted).hi]);
        },
      ),
      { numRuns: BER_RUNS },
    );
  });

  it('pn9Frames: 7-bit bytes; invalid arguments throw a RangeError', () => {
    const f = pn9Frames(300, { startFrame: 5 });
    expect(f.every((v) => v <= 127)).toBe(true);
    expect(pn9Frames(0)).toEqual(new Uint8Array(0));
    for (const bad of [-1, 1.5, NaN]) {
      expect(() => pn9Frames(bad)).toThrow(RangeError);
      expect(() => pn9Frames(3, { startFrame: bad })).toThrow(RangeError);
    }
  });

  it('BerCounter: framing errors count 7 errors once synced, sync needs 9 reliable bits, a frame slip resynchronises', () => {
    const tx = pn9Frames(400);
    // Before sync, a framing error restarts the load: nothing counted.
    const a = new BerCounter();
    a.pushFrame(tx[0], true);
    a.pushFrame(tx[1], false);
    expect(a.snapshot()).toMatchObject({ bits: 0, errors: 0, synced: false });
    // Synced: a framing-error frame counts its 7 bits as errors and the LFSR keeps running.
    const b = new BerCounter();
    for (let i = 0; i < 10; i++) b.pushFrame(tx[i], i !== 5);
    expect(b.snapshot()).toMatchObject({ bits: 70 - 9, errors: 7, synced: true, resyncs: 0 });
    // A lost frame (7-bit slip): more than 20 of 100 bits wrong, one resync, then error-free.
    const c = new BerCounter();
    for (let i = 0; i < 400; i++) if (i !== 100) c.pushFrame(tx[i], true);
    const s = c.snapshot();
    expect(s.synced).toBe(true);
    expect(s.resyncs).toBe(1);
    const errorsAfterSlip = s.errors;
    expect(errorsAfterSlip).toBeGreaterThan(20);
    expect(errorsAfterSlip).toBeLessThanOrEqual(100);
    // An out-of-range value is treated like a framing error.
    const d = new BerCounter();
    for (let i = 0; i < 4; i++) d.pushFrame(tx[i], true);
    d.pushFrame(200, true);
    expect(d.snapshot()).toMatchObject({ errors: 7 });
    d.reset();
    expect(d.snapshot()).toEqual({ bits: 0, errors: 0, ber: 0, lo: 0, hi: 1, synced: false, resyncs: 0 });
  });

  it('Wilson interval: reference values, [0, 1] for 0 bits, NaN for invalid arguments, lo <= p <= hi', () => {
    const w = wilson95(5, 10);
    expect(w.lo).toBeCloseTo(0.2366, 4);
    expect(w.hi).toBeCloseTo(0.7634, 4);
    expect(wilson95(0, 10).lo).toBe(0);
    expect(wilson95(0, 10).hi).toBeCloseTo(1.96 ** 2 / (10 + 1.96 ** 2), 12);
    expect(wilson95(10, 10).hi).toBe(1);
    expect(wilsonInterval(3, 40, 1.96)).toEqual(wilson95(3, 40));
    expect(wilson95(0, 0)).toEqual({ lo: 0, hi: 1 });
    for (const [e, n, z] of [
      [1.5, 10, 1.96],
      [-1, 10, 1.96],
      [11, 10, 1.96],
      [1, 10, 0],
      [1, 10, -1],
      [1, 10, NaN],
      [1, NaN, 1.96],
    ]) {
      const r = wilsonInterval(e, n, z);
      expect(Number.isNaN(r.lo) && Number.isNaN(r.hi), `${e} ${n} ${z}`).toBe(true);
    }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0.1, max: 5, noNaN: true }), (n, f, z) => {
        const e = Math.floor(f * n);
        const r = wilsonInterval(e, n, z);
        const wider = wilsonInterval(e, n, z * 1.5);
        expect(r.lo).toBeLessThanOrEqual(e / n + 1e-12);
        expect(r.hi).toBeGreaterThanOrEqual(e / n - 1e-12);
        expect(r.lo).toBeGreaterThanOrEqual(0);
        expect(r.hi).toBeLessThanOrEqual(1);
        expect(wider.lo).toBeLessThanOrEqual(r.lo + 1e-12);
        expect(wider.hi).toBeGreaterThanOrEqual(r.hi - 1e-12);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('v23-modem task 10: quality events', () => {
  it('M2M4 estimator: S and N from the moments, kurtosis-corrected; snrReport follows R5', () => {
    // Constant envelope S = 1 plus proper complex Gaussian noise N = 0.1: M2 = 1.1, M4 = 1 + 0.4 + 0.02.
    const plain = m2m4(1.1, 1.42);
    expect(plain.signal).toBeCloseTo(1, 12);
    expect(plain.noise).toBeCloseTo(0.1, 12);
    // Envelope kurtosis k: M4 = k S^2 + 4 S N + 2 N^2.
    const k = 1.0105;
    const corr = m2m4(1.1, k + 0.4 + 0.02, k);
    expect(corr.signal).toBeCloseTo(1, 12);
    expect(corr.noise).toBeCloseTo(0.1, 12);
    expect(m2m4(1, 2.5).snr).toBe(0); // 2 M2^2 - M4 < 0: noise only
    expect(m2m4(1, 1).snr).toBe(Infinity); // clean constant envelope
    const r = snrReport(100, 2100, 1200);
    expect(r.snrBandDb).toBeCloseTo(20, 12);
    expect(r.snr3kDb).toBeCloseTo(20 + 10 * Math.log10(2100 / 3000), 12);
    expect(r.ebN0Db).toBeCloseTo(20 + 10 * Math.log10(2100 / 1200), 12);
    expect(snrReport(0, 2100, 1200).snrBandDb).toBe(-Infinity);
  });

  it('every 100 ms while the carrier is on, none when it is off; SNR units follow B_n; parity rate over the last 100 frames; offset from the threshold', () => {
    const fs = 16000;
    const bn = forwardNoiseBandwidth(fs);
    const bytes = pn9Frames(150);
    const m = mustModulate(bytes, { sampleRate: fs, bitErrors: [15, 37] }); // parity errors in frames 1 and 3
    const silence = new Float32Array(Math.round(0.5 * fs));
    const x = concatF32([silence, mustApply(m, { sampleRate: fs, seed: 7, noise: { kind: 'snr3k', db: 25 } }), silence]);
    const events = demodWith(x, fs, undefined);
    const q = qualityOf(events);
    const on = events.filter((e) => e.type === 'carrier');
    expect(on.map((e) => (e as { on: boolean }).on)).toEqual([true, false]);
    const [tOn, tOff] = on.map((e) => e.atSample);
    expect(q.length).toBeGreaterThan(5);
    for (const e of q) {
      expect(e.atSample % 1600).toBe(0);
      expect(e.atSample).toBeGreaterThan(tOn);
      expect(e.atSample).toBeLessThan(tOff);
      if (Number.isFinite(e.snrBandDb)) {
        expect(e.snr3kDb - e.snrBandDb).toBeCloseTo(10 * Math.log10(bn / 3000), 9);
        expect(e.ebN0Db - e.snrBandDb).toBeCloseTo(10 * Math.log10(bn / 1200), 9);
      } else {
        // N <= 0 (+Infinity) or no signal (-Infinity): the three values agree.
        expect([e.snr3kDb, e.ebN0Db]).toEqual([e.snrBandDb, e.snrBandDb]);
      }
      expect(Math.abs(e.offsetHz)).toBeLessThan(20);
    }
    // Consecutive boundaries: none skipped while the carrier is on (requirement 9.1).
    for (let i = 1; i < q.length; i++) expect(q[i].atSample - q[i - 1].atSample).toBe(1600);
    // The estimates dated within 70 ms before the carrier off are dropped (silence in the moments).
    expect(q[q.length - 1].atSample).toBeLessThanOrEqual(tOff - 0.07 * fs);
    // 2 parity errors among the first frames, then 0 once they leave the last 100.
    const chars = charsOf(events);
    expect([chars[1].parityOk, chars[3].parityOk]).toEqual([false, false]);
    // Any other parity error is a frame read from the silence after the page while the carrier
    // off is pending (task 7 behaviour): a framing error, after the 150 page frames.
    for (const [i, c] of chars.entries()) if (!c.parityOk && i !== 1 && i !== 3) expect([i >= 150, c.framingOk]).toEqual([true, false]);
    for (const e of q) {
      const before = chars.filter((c) => c.atSample + 9.75 * (fs / 1200) < e.atSample).slice(-100);
      const expected = before.length > 0 ? before.filter((c) => !c.parityOk).length / before.length : 0;
      expect(e.parityErrorRate, `at ${e.atSample}`).toBeCloseTo(expected, 12);
    }
    expect(q.some((e) => e.parityErrorRate > 0)).toBe(true);
    expect(q[q.length - 1].parityErrorRate).toBe(0);
    // The last estimates read 25 dB in 3 kHz within 1 dB.
    expect(Math.abs(q[q.length - 1].snr3kDb - 25)).toBeLessThanOrEqual(1);
    // Offset: an offset page reports offsetHz = markHz - 1300 in adaptive mode.
    const y = mustApply(mustModulate(bytes, { sampleRate: fs }), { sampleRate: fs, seed: 8, offsetHz: 150, noise: { kind: 'snr3k', db: 25 } });
    const qo = qualityOf(demodWith(y, fs, 'adaptive'));
    expect(Math.abs(qo[qo.length - 1].offsetHz - 150)).toBeLessThanOrEqual(20);
    expect(qualityOf(demodWith(y, fs, 'fixed')).every((e) => e.offsetHz === 0)).toBe(true);
  });

  it('M10 SNR estimator: for band SNR in [0, 30] dB, the estimate is within ±1 dB (mean over 10 seeds)', () => {
    const rates = isSlowTestsEnabled() ? [8000, 16000, 44100, 48000] : [16000];
    const targets = isSlowTestsEnabled() ? [0, 5, 10, 15, 20, 25, 30] : [0, 15, 30];
    const report: string[] = [];
    let worst = 0;
    for (const fs of rates) {
      const bn = forwardNoiseBandwidth(fs);
      const x = mustModulate(pn9Frames(300), { sampleRate: fs });
      for (const g of targets) {
        let sum = 0;
        for (let seed = 1; seed <= 10; seed++) {
          const y = mustApply(x, { sampleRate: fs, seed, noise: { kind: 'ebN0', db: g + 10 * Math.log10(bn / 1200) } });
          // Estimates with a full second of moments: from 1.2 s (lead 0.1 s, carrier on, 1 s).
          const q = qualityOf(demodWith(y, fs, undefined)).filter((e) => e.atSample >= 1.2 * fs);
          expect(q.length, `fs=${fs} g=${g} seed=${seed}`).toBeGreaterThan(5);
          sum += q.reduce((s, e) => s + e.snrBandDb, 0) / q.length;
        }
        const mean = sum / 10;
        worst = Math.max(worst, Math.abs(mean - g));
        report.push(`${fs}/${g}: ${mean.toFixed(2)}`);
        expect(Math.abs(mean - g), `fs=${fs} band SNR ${g} dB: mean estimate ${mean}`).toBeLessThanOrEqual(1);
      }
    }
    console.log(`M10 mean band SNR estimate per fs/target: ${report.join(', ')}; worst |error| ${worst.toFixed(2)} dB`);
  });
});

describe('v23-modem task 10: BER under noise (slow mode)', () => {
  // design.md "Testing": the Monte Carlo property M6 runs in slow mode only.
  it.runIf(isSlowTestsEnabled())('M6 noise: at Eb/N0 >= 12 dB (target, to calibrate), BER on 20 000 PN9 bits is <= 1e-3 for 20 seeds', () => {
    const fs = 16000;
    const ebN0Db = 12;
    // 3 200 frames (22 400 bits): lost frames are not compared, so at least 20 000 bits remain.
    const x = mustModulate(pn9Frames(3200), { sampleRate: fs });
    const bers: string[] = [];
    let failing = 0;
    const results: { seed: number; bits: number; ber: number }[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const y = mustApply(x, { sampleRate: fs, seed, noise: { kind: 'ebN0', db: ebN0Db } });
      const counter = new BerCounter();
      for (const c of charsOf(demodWith(y, fs, undefined))) counter.pushFrame(c.value, c.framingOk);
      const s = counter.snapshot();
      results.push({ seed, bits: s.bits, ber: s.ber });
      bers.push(s.ber.toExponential(2));
      if (s.ber > 1e-3 || s.bits < 20000) failing++;
    }
    console.log(`M6 at Eb/N0 = ${ebN0Db} dB, BER per seed: ${bers.join(' ')}; ${failing} of 20 seeds fail`);
    for (const r of results) {
      expect(r.ber, `seed ${r.seed}`).toBeLessThanOrEqual(1e-3);
      expect(r.bits, `seed ${r.seed}`).toBeGreaterThanOrEqual(20000);
    }
  });
});
