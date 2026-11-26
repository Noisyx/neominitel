// fantome task 5, simulated pre-calibration (docs/calibration.md "FANTOME"). Not a substitute for
// the two-device acoustic test: it estimates how much extra degradation the generated levels
// tolerate on the way from a speaker to a microphone.
//
// For each committed WAV (public/transmissions/L*.wav), adds an "acoustic path" and re-runs the
// generator's own check (verifyLevelWav, the app pipeline): feature on -> code row CER = 0 (plus
// the L2 and L4 conditions), feature off -> code row CER >= 50 % (L3, L4).
// Run: npx tsx prototypes/fantome-acoustic-margin.ts   (deterministic, 3 seeds per condition)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChannel, readWav, writeWav, type ChannelParams } from '../src/modem';
import type { LevelSource } from '../src/fantome/types';
import { verifyLevelWav } from '../scripts/generate-transmissions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(readFileSync(join(ROOT, 'content', 'fantome', 'levels.json'), 'utf8')) as LevelSource[];
const SEEDS = [1, 2, 3];

interface Condition {
  name: string;
  snr3kDb?: number; // extra AWGN, 3 kHz band SNR relative to the tone in the WAV
  clockPpm?: number; // playback / capture clock mismatch
  echo?: { delayMs: number; gain: number }[]; // room reflections
}

const conditions: Condition[] = [
  { name: 'none' },
  { name: 'noise 40 dB', snr3kDb: 40 },
  { name: 'noise 30 dB', snr3kDb: 30 },
  { name: 'noise 25 dB', snr3kDb: 25 },
  { name: 'noise 20 dB', snr3kDb: 20 },
  { name: 'noise 15 dB', snr3kDb: 15 },
  { name: 'clock +1000 ppm, noise 30 dB', snr3kDb: 30, clockPpm: 1000 },
  { name: 'clock -1000 ppm, noise 30 dB', snr3kDb: 30, clockPpm: -1000 },
  { name: 'echo -10 dB @7 ms, -16 dB @19 ms, noise 30 dB', snr3kDb: 30, echo: [{ delayMs: 7, gain: 0.32 }, { delayMs: 19, gain: 0.16 }] },
  { name: 'echo -6 dB @5 ms, noise 30 dB', snr3kDb: 30, echo: [{ delayMs: 5, gain: 0.5 }] },
];

/** Tone amplitude estimate from the RMS of the first 50 ms (idle carrier + the WAV's own noise). */
function toneAmplitude(x: Float32Array, fs: number): number {
  const n = Math.min(x.length, Math.round(0.05 * fs));
  let s = 0;
  for (let i = Math.round(0.01 * fs); i < n; i++) s += x[i] * x[i];
  return Math.sqrt((2 * s) / (n - Math.round(0.01 * fs)));
}

function withEcho(x: Float32Array, fs: number, echo: { delayMs: number; gain: number }[]): Float32Array {
  const y = Float32Array.from(x);
  for (const e of echo) {
    const d = Math.round((e.delayMs / 1000) * fs);
    for (let i = d; i < x.length; i++) y[i] += e.gain * x[i - d];
  }
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.99) for (let i = 0; i < y.length; i++) y[i] *= 0.99 / peak;
  return y;
}

console.log('level | condition | feature on: solved seeds | feature off: min code-row CER');
for (const level of levels) {
  const wav = readWav(readFileSync(join(ROOT, 'public', 'transmissions', `${level.id}.wav`)));
  if (!wav.ok) throw new Error(`${level.id}: ${JSON.stringify(wav.error)}`);
  const { samples, sampleRate } = wav.value;
  const amp = toneAmplitude(samples, sampleRate);
  for (const c of conditions) {
    let solved = 0;
    let minOff = Infinity;
    const reasons = new Set<string>();
    for (const seed of c.snr3kDb === undefined && !c.clockPpm && !c.echo ? [1] : SEEDS) {
      let x = c.echo ? withEcho(samples, sampleRate, c.echo) : samples;
      if (c.snr3kDb !== undefined || c.clockPpm) {
        const p: ChannelParams = { sampleRate, seed: 7000 + seed, signalAmplitude: amp };
        if (c.snr3kDb !== undefined) p.noise = { kind: 'snr3k', db: c.snr3kDb };
        if (c.clockPpm) p.clockPpm = c.clockPpm;
        const y = applyChannel(x, p);
        if (!y.ok) throw new Error(`${c.name}: ${JSON.stringify(y.error)}`);
        x = y.value;
      }
      const bytes = writeWav(x, sampleRate);
      if (!bytes.ok) throw new Error(`writeWav: ${JSON.stringify(bytes.error)}`);
      const out = verifyLevelWav(level, bytes.value);
      // verifyLevelWav fails on the off check too; separate the two outcomes.
      const onOk = out.cerFeatureOn === 0 && (out.ok || (out.reason ?? '').startsWith('feature OFF'));
      if (onOk) solved++;
      else reasons.add(out.reason ?? '');
      if (out.cerFeatureOff !== undefined) minOff = Math.min(minOff, out.cerFeatureOff);
    }
    const runs = c.snr3kDb === undefined && !c.clockPpm && !c.echo ? 1 : SEEDS.length;
    const off = Number.isFinite(minOff) ? `${(minOff * 100).toFixed(0)} %` : '-';
    console.log(`${level.id} | ${c.name} | ${solved}/${runs} | ${off}${reasons.size ? ` | ${[...reasons].join('; ')}` : ''}`);
  }
}
