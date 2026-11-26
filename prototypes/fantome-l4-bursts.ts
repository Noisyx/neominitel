// fantome task 5, simulated pre-calibration: L4 with noise bursts instead of uniform noise
// (docs/calibration.md "FANTOME"). Same page, 7 repeats with 1 s gaps, light AWGN plus Poisson
// noise bursts (line simulator `bursts`), procedural drone omitted (it is below 250 Hz and does not
// change the checks, fantome requirement 5.2). For each configuration: 5 generation seeds, the
// WAVs that pass the generator's check (verifyLevelWav), then 5 acoustic perturbations each.
// Run: npx tsx prototypes/fantome-l4-bursts.ts   (deterministic)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTransmissionPage } from '../content/fantome/transmission-pages';
import { applyChannel, modulate, readWav, writeWav, type BurstParams, type ChannelParams } from '../src/modem';
import type { LevelSource } from '../src/fantome/types';
import { encodePage } from '../src/videotex';
import { verifyLevelWav } from '../scripts/generate-transmissions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(readFileSync(join(ROOT, 'content', 'fantome', 'levels.json'), 'utf8')) as LevelSource[];
const L4 = levels.find((l) => l.id === 'L4');
if (!L4 || L4.damage.kind !== 'whisper') throw new Error('L4');
const FS = 16000;

interface Config { ebN0Db: number; bursts: BurstParams }
const configs: Config[] = [
  { ebN0Db: 16, bursts: { ratePerS: 6, durationMs: [30, 80], levelDb: 0 } },
  { ebN0Db: 16, bursts: { ratePerS: 10, durationMs: [30, 80], levelDb: 0 } },
  { ebN0Db: 16, bursts: { ratePerS: 15, durationMs: [30, 80], levelDb: 0 } },
  { ebN0Db: 18, bursts: { ratePerS: 10, durationMs: [50, 120], levelDb: 0 } },
];

function synth(seed: number, c: Config): Uint8Array {
  const enc = encodePage(buildTransmissionPage(L4!.transmissionPage, L4!.code, L4!.codeRow));
  if (!enc.ok) throw new Error('encode');
  const one = modulate(enc.value.bytes, { sampleRate: FS, channel: 'forward', tailIdleMs: (L4!.damage as { gapMs: number }).gapMs });
  if (!one.ok) throw new Error('modulate');
  const reps = (L4!.damage as { repeats: number }).repeats;
  const x = new Float32Array(one.value.length * reps);
  for (let r = 0; r < reps; r++) x.set(one.value, r * one.value.length);
  const y = applyChannel(x, { sampleRate: FS, seed, noise: { kind: 'ebN0', db: c.ebN0Db }, bursts: c.bursts });
  if (!y.ok) throw new Error(JSON.stringify(y.error));
  let peak = 0;
  for (const v of y.value) peak = Math.max(peak, Math.abs(v));
  const g = 0.891 / peak; // -1 dBFS
  const w = writeWav(Float32Array.from(y.value, (v) => v * g), FS);
  if (!w.ok) throw new Error('wav');
  return w.value;
}

type Perturbation = { snr3kDb: number; clockPpm?: number; echo?: { delayMs: number; gain: number }; seed: number };
const perturbations: Perturbation[] = [
  { snr3kDb: 30, seed: 1 },
  { snr3kDb: 30, seed: 2 },
  { snr3kDb: 30, seed: 3 },
  { snr3kDb: 30, clockPpm: -1000, seed: 4 },
  { snr3kDb: 30, echo: { delayMs: 7, gain: 0.16 }, seed: 5 },
];

function perturb(wavBytes: Uint8Array, p: Perturbation): Uint8Array {
  const wav = readWav(wavBytes);
  if (!wav.ok) throw new Error('readWav');
  const x = wav.value.samples;
  let y = x;
  if (p.echo) {
    y = Float32Array.from(x);
    const d = Math.round((p.echo.delayMs / 1000) * FS);
    for (let i = d; i < x.length; i++) y[i] += p.echo.gain * x[i - d];
    let peak = 0;
    for (const v of y) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.99) for (let i = 0; i < y.length; i++) y[i] *= 0.99 / peak;
  }
  let s = 0;
  const a = Math.round(0.01 * FS);
  const b = Math.round(0.05 * FS);
  for (let i = a; i < b; i++) s += x[i] * x[i];
  const prm: ChannelParams = { sampleRate: FS, seed: 9000 + p.seed, signalAmplitude: Math.sqrt((2 * s) / (b - a)), noise: { kind: 'snr3k', db: p.snr3kDb } };
  if (p.clockPpm) prm.clockPpm = p.clockPpm;
  const z = applyChannel(y, prm);
  if (!z.ok) throw new Error(JSON.stringify(z.error));
  const w = writeWav(z.value, FS);
  if (!w.ok) throw new Error('wav');
  return w.value;
}

const onSolved = (o: ReturnType<typeof verifyLevelWav>): boolean => o.cerFeatureOn === 0 && (o.ok || (o.reason ?? '').startsWith('feature OFF'));

console.log('L4 bursts | accepted WAVs | solved after perturbation | feature off: code-row CER (min)');
for (const c of configs) {
  let accepted = 0;
  let solved = 0;
  let trials = 0;
  let offMin = Infinity;
  const fails = new Set<string>();
  for (let s = 0; s < 5; s++) {
    const wav = synth(L4.seed + s, c);
    const v = verifyLevelWav(L4, wav);
    if (v.cerFeatureOff !== undefined) offMin = Math.min(offMin, v.cerFeatureOff);
    if (!v.ok) {
      fails.add(`gen: ${v.reason}`);
      continue;
    }
    accepted++;
    for (const p of perturbations) {
      trials++;
      const o = verifyLevelWav(L4, perturb(wav, p));
      if (onSolved(o)) solved++;
      else fails.add(`perturbed: ${o.reason}`);
      if (o.cerFeatureOff !== undefined) offMin = Math.min(offMin, o.cerFeatureOff);
    }
  }
  const off = Number.isFinite(offMin) ? `${(offMin * 100).toFixed(0)} %` : '-';
  console.log(`Eb/N0 ${c.ebN0Db} dB, ${c.bursts.ratePerS}/s x ${c.bursts.durationMs[0]}-${c.bursts.durationMs[1]} ms @ ${c.bursts.levelDb} dB | ${accepted}/5 | ${solved}/${trials} | ${off}`);
  if (fails.size > 0) console.log(`   failures: ${[...fails].slice(0, 4).join(' ; ')}`);
}
