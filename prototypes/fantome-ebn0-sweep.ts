// fantome task 5, simulated pre-calibration: Eb/N0 sweep of L2 and L4 (docs/calibration.md
// "FANTOME"). For each candidate Eb/N0, synthesises the level with the generator's own function for
// 5 seeds, keeps the WAVs the generator would accept (verifyLevelWav passes), then replays each
// accepted WAV through 5 small acoustic perturbations and re-runs the same check.
// Run: npx tsx prototypes/fantome-ebn0-sweep.ts   (deterministic)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChannel, readWav, writeWav, type ChannelParams } from '../src/modem';
import type { LevelSource } from '../src/fantome/types';
import { synthesizeLevelWav, verifyLevelWav } from '../scripts/generate-transmissions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(readFileSync(join(ROOT, 'content', 'fantome', 'levels.json'), 'utf8')) as LevelSource[];
const GEN_SEEDS = 5;

type Perturbation = { name: string; snr3kDb: number; clockPpm?: number; echo?: { delayMs: number; gain: number }[]; seed: number };
const perturbations: Perturbation[] = [
  { name: 'noise 30 dB #1', snr3kDb: 30, seed: 1 },
  { name: 'noise 30 dB #2', snr3kDb: 30, seed: 2 },
  { name: 'noise 30 dB #3', snr3kDb: 30, seed: 3 },
  { name: 'clock -1000 ppm', snr3kDb: 30, clockPpm: -1000, seed: 4 },
  { name: 'echo -16 dB @7 ms', snr3kDb: 30, echo: [{ delayMs: 7, gain: 0.16 }], seed: 5 },
];

function toneAmplitude(x: Float32Array, fs: number): number {
  const a = Math.round(0.01 * fs);
  const b = Math.min(x.length, Math.round(0.05 * fs));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt((2 * s) / (b - a));
}

function perturb(x: Float32Array, fs: number, p: Perturbation): Uint8Array {
  let y = x;
  if (p.echo) {
    y = Float32Array.from(x);
    for (const e of p.echo) {
      const d = Math.round((e.delayMs / 1000) * fs);
      for (let i = d; i < x.length; i++) y[i] += e.gain * x[i - d];
    }
    let peak = 0;
    for (const v of y) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.99) for (let i = 0; i < y.length; i++) y[i] *= 0.99 / peak;
  }
  const prm: ChannelParams = { sampleRate: fs, seed: 9000 + p.seed, signalAmplitude: toneAmplitude(x, fs), noise: { kind: 'snr3k', db: p.snr3kDb } };
  if (p.clockPpm) prm.clockPpm = p.clockPpm;
  const z = applyChannel(y, prm);
  if (!z.ok) throw new Error(JSON.stringify(z.error));
  const w = writeWav(z.value, fs);
  if (!w.ok) throw new Error(JSON.stringify(w.error));
  return w.value;
}

const onSolved = (o: ReturnType<typeof verifyLevelWav>): boolean => o.cerFeatureOn === 0 && (o.ok || (o.reason ?? '').startsWith('feature OFF'));

const sweeps: Record<string, number[]> = { L2: [12.5, 13.5, 14.5, 15.5, 16.5], L4: [11.5, 12.5, 13.5, 14.5] };
console.log('level | Eb/N0 | accepted WAVs | solved after perturbation | L2: error cells on page (min-max) | feature off: code-row CER (min)');
for (const [id, grid] of Object.entries(sweeps)) {
  const base = levels.find((l) => l.id === id);
  if (!base) throw new Error(id);
  for (const db of grid) {
    const level: LevelSource = { ...base, damage: { ...base.damage, ebN0Db: db } as LevelSource['damage'] };
    let accepted = 0;
    let solved = 0;
    let trials = 0;
    let cellsMin = Infinity;
    let cellsMax = 0;
    let offMin = Infinity;
    const fails = new Set<string>();
    for (let s = 0; s < GEN_SEEDS; s++) {
      const { wavBytes } = synthesizeLevelWav(level, base.seed + s);
      const v = verifyLevelWav(level, wavBytes);
      if (!v.ok) {
        fails.add(`gen: ${v.reason}`);
        continue;
      }
      accepted++;
      cellsMin = Math.min(cellsMin, v.pageErrorCellsOn);
      cellsMax = Math.max(cellsMax, v.pageErrorCellsOn);
      if (v.cerFeatureOff !== undefined) offMin = Math.min(offMin, v.cerFeatureOff);
      const wav = readWav(wavBytes);
      if (!wav.ok) throw new Error('readWav');
      for (const p of perturbations) {
        trials++;
        const o = verifyLevelWav(level, perturb(wav.value.samples, wav.value.sampleRate, p));
        if (onSolved(o)) solved++;
        else fails.add(`${p.name}: ${o.reason}`);
        if (o.cerFeatureOff !== undefined) offMin = Math.min(offMin, o.cerFeatureOff);
      }
    }
    const cells = accepted > 0 ? `${cellsMin}-${cellsMax}` : '-';
    const off = Number.isFinite(offMin) ? `${(offMin * 100).toFixed(0)} %` : '-';
    console.log(`${id} | ${db} dB | ${accepted}/${GEN_SEEDS} | ${solved}/${trials} | ${cells} | ${off}`);
    if (fails.size > 0) console.log(`   failures: ${[...fails].slice(0, 4).join(' ; ')}`);
  }
}
