// Calibration of the modem targets (design.md "Testing", docs/calibration.md). Run with
// `npx tsx scripts/calibrate-modem.ts`. Deterministic: fixed seeds, same output on every run.
//
// Section M6: the Eb/N0 at which the full chain (PN9 -> modulate -> AWGN -> demodulator ->
// BerCounter) gives BER <= 1e-3 on 20 000 bits for every seed. Sweep at 16 kHz with seeds 1..20,
// then check the candidate at 8, 16 and 48 kHz, both threshold modes, seeds 1..40.
import { chainBer, framesForBits } from '../tests/helpers/modem-ber';

const BITS = 20000;
const TARGET_BER = 1e-3;
const frames = framesForBits(BITS);

interface Point {
  fs: number;
  ebN0Db: number;
  mode: 'fixed' | 'adaptive';
  seeds: [number, number];
}

function run(p: Point): { mean: number; worst: number; failing: number; minBits: number } {
  let sum = 0;
  let worst = 0;
  let failing = 0;
  let minBits = Infinity;
  const n = p.seeds[1] - p.seeds[0] + 1;
  for (let seed = p.seeds[0]; seed <= p.seeds[1]; seed++) {
    const s = chainBer({ sampleRate: p.fs, ebN0Db: p.ebN0Db, seed, frames, threshold: p.mode });
    sum += s.ber;
    worst = Math.max(worst, s.ber);
    minBits = Math.min(minBits, s.bits);
    if (s.ber > TARGET_BER || s.bits < BITS) failing++;
  }
  return { mean: sum / n, worst, failing, minBits };
}

const fmt = (x: number): string => x.toExponential(2);

// Optional: M6_FROM_DB=<dB> skips the sweep and checks only that level (to run levels in parallel).
const fromDb = process.env.M6_FROM_DB !== undefined ? Number(process.env.M6_FROM_DB) : NaN;
let candidate = fromDb;
if (Number.isNaN(fromDb)) {
  console.log('## M6 sweep (16 kHz, adaptive, seeds 1..20)');
  console.log('| Eb/N0 (dB) | mean BER | worst BER | seeds > 1e-3 | min bits |');
  console.log('|---|---|---|---|---|');
  for (let db = 12; db <= 18.001; db += 0.5) {
    const r = run({ fs: 16000, ebN0Db: db, mode: 'adaptive', seeds: [1, 20] });
    console.log(`| ${db.toFixed(1)} | ${fmt(r.mean)} | ${fmt(r.worst)} | ${r.failing}/20 | ${r.minBits} |`);
    if (r.failing === 0 && Number.isNaN(candidate)) candidate = db;
  }
}

console.log(`\n## M6 robustness from ${candidate} dB (seeds 1..40, 8/16/48 kHz, both modes)`);
console.log('| Eb/N0 (dB) | fs | mode | mean BER | worst BER | seeds > 1e-3 |');
console.log('|---|---|---|---|---|---|');
let calibrated = NaN;
const lastDb = Number.isNaN(fromDb) ? 20 : fromDb;
for (let db = candidate; db <= lastDb + 0.001 && Number.isNaN(calibrated); db += 0.5) {
  let allPass = true;
  for (const fs of [8000, 16000, 48000]) {
    for (const mode of ['adaptive', 'fixed'] as const) {
      const r = run({ fs, ebN0Db: db, mode, seeds: [1, 40] });
      if (r.failing > 0) allPass = false;
      console.log(`| ${db.toFixed(1)} | ${fs} | ${mode} | ${fmt(r.mean)} | ${fmt(r.worst)} | ${r.failing}/40 |`);
    }
  }
  if (allPass) calibrated = db;
}
console.log(`\nM6 calibrated Eb/N0: ${calibrated} dB`);
