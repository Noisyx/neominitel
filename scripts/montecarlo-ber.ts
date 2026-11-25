// Curve 3 (design.md "Math notes", task 11.2): BER of the full receiver chain, measured by Monte
// Carlo simulation, with 95 % Wilson intervals. Run with `npx tsx scripts/montecarlo-ber.ts`;
// writes public/data/ber-curve3.json in the format of design.md "Theory API". Deterministic.
//
// Chain per seed: PN9 frames -> modulate (16 kHz) -> applyChannel AWGN at Eb/N0 (A7, per line
// bit) -> demodulator (adaptive threshold, the app default) -> BerCounter, the counter the app
// uses in 3615 MATHS, so live points are comparable. Errors and bits are pooled over the seeds.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson95 } from '../src/modem';
import { chainBer, framesForBits } from '../tests/helpers/modem-ber';

const SAMPLE_RATE = 16000;
const SEEDS = 10;
const BITS_PER_SEED = 20000;
const EBN0_DB = Array.from({ length: 19 }, (_, i) => i); // 0 to 18 dB

const frames = framesForBits(BITS_PER_SEED);
const out = { ebN0Db: [] as number[], ber: [] as number[], lo: [] as number[], hi: [] as number[], bitsPerPoint: [] as number[], seeds: SEEDS };
for (const db of EBN0_DB) {
  let bits = 0;
  let errors = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = chainBer({ sampleRate: SAMPLE_RATE, ebN0Db: db, seed, frames });
    bits += s.bits;
    errors += s.errors;
  }
  const { lo, hi } = wilson95(errors, bits);
  out.ebN0Db.push(db);
  out.ber.push(bits > 0 ? errors / bits : 0);
  out.lo.push(lo);
  out.hi.push(hi);
  out.bitsPerPoint.push(bits);
  console.log(`Eb/N0 ${db} dB: BER ${(errors / bits).toExponential(3)} [${lo.toExponential(2)}, ${hi.toExponential(2)}], ${bits} bits`);
}

const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'ber-curve3.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`written ${file}`);
