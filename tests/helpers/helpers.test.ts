import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  arbBytes7,
  arbStandardSampleRate,
  awgn,
  createRng,
  measureSignalPower,
  resample,
} from './index';
import { createDemodulator, modulate, type DemodEvent } from '../../src/modem';

describe('J1 scaffold and test helpers', () => {
  it('createRng produces deterministic sequences for identical seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 50; i++) {
      expect(a.nextFloat()).toBe(b.nextFloat());
      expect(a.nextGaussian()).toBe(b.nextGaussian());
    }
  });

  it('awgn adds deterministic noise at the requested Eb/N0 scale', () => {
    const fs = 48000;
    const n = 48000;
    const clean = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      clean[i] = 0.5 * Math.sin((2 * Math.PI * 1300 * i) / fs);
    }
    const pSignal = measureSignalPower(clean);
    expect(pSignal).toBeCloseTo(0.125, 3);

    const noisy1 = awgn(clean, { sampleRate: fs, ebN0Db: 10, baud: 1200, seed: 7 });
    const noisy2 = awgn(clean, { sampleRate: fs, ebN0Db: 10, baud: 1200, seed: 7 });
    expect(noisy1).toEqual(noisy2);

    const diff = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      diff[i] = noisy1[i] - clean[i];
    }
    const measuredNoiseVar = measureSignalPower(diff);
    const expectedNoiseVar = (pSignal * fs) / (2 * 1200 * 10);
    expect(measuredNoiseVar).toBeCloseTo(expectedNoiseVar, 2);
  });

  it('windowed-sinc resample preserves a low-frequency sinusoid and scales length', () => {
    const fs = 16000;
    const n = 1600;
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      signal[i] = Math.sin((2 * Math.PI * 400 * i) / fs);
    }
    const ratio = 1.02;
    const out = resample(signal, { ratio });
    expect(out.length).toBe(Math.round(n * ratio));
    expect(measureSignalPower(out)).toBeCloseTo(0.5, 1);
  });

  it('fake modulator + demodulator round-trips arbitrary 7-bit bytes and is chunk-invariant', () => {
    fc.assert(
      fc.property(arbBytes7(1, 30), arbStandardSampleRate(), (bytes, sampleRate) => {
        const modRes = modulate(bytes, { sampleRate });
        expect(modRes.ok).toBe(true);
        if (!modRes.ok) return;

        const demodWhole = createDemodulator({ sampleRate, threshold: 'fixed' });
        const eventsWhole = demodWhole.push(modRes.value);
        const charsWhole = eventsWhole
          .filter((e): e is Extract<DemodEvent, { type: 'char' }> => e.type === 'char')
          .map((e) => e.value);

        expect(Uint8Array.from(charsWhole)).toEqual(bytes);

        const demodChunked = createDemodulator({ sampleRate, threshold: 'fixed' });
        const eventsChunked: DemodEvent[] = [];
        const step = 137;
        for (let offset = 0; offset < modRes.value.length; offset += step) {
          eventsChunked.push(
            ...demodChunked.push(modRes.value.subarray(offset, offset + step)),
          );
        }
        expect(eventsChunked).toEqual(eventsWhole);
      }),
      { numRuns: 20 },
    );
  });
});
