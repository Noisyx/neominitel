// Curves 3 and 4 (design.md "Math notes", tasks 11.2 and 15): BER of a full receiver chain,
// measured by Monte Carlo simulation, with 95 % Wilson intervals. Deterministic.
//   npx tsx scripts/montecarlo-ber.ts                         -> public/data/ber-curve3.json
//   npx tsx scripts/montecarlo-ber.ts --receiver correlator   -> public/data/ber-curve4.json
// Both files have the format of design.md "Theory API".
//
// Chain per seed: PN9 frames -> modulate (16 kHz) -> applyChannel AWGN at Eb/N0 (A7, per line
// bit) -> receiver -> BerCounter, the counter the app uses in 3615 MATHS, so live points are
// comparable. Curve 3: the streaming demodulator (adaptive threshold, the app default). Curve 4:
// the correlator receiver (task 15). Errors and bits are pooled over the seeds.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson95 } from '../src/modem';
import { chainBer, framesForBits } from '../tests/helpers/modem-ber';

const SAMPLE_RATE = 16000;
const SEEDS = 10;
const BITS_PER_SEED = 20000;
const EBN0_DB = Array.from({ length: 19 }, (_, i) => i); // 0 to 18 dB

const receiverArg = process.argv.indexOf('--receiver');
const receiver = receiverArg >= 0 ? process.argv[receiverArg + 1] : 'discriminator';
if (receiver !== 'discriminator' && receiver !== 'correlator') {
  console.error(`unknown receiver "${receiver}" (discriminator or correlator)`);
  process.exit(1);
}
const fileName = receiver === 'correlator' ? 'ber-curve4.json' : 'ber-curve3.json';

const frames = framesForBits(BITS_PER_SEED);
const out = { ebN0Db: [] as number[], ber: [] as number[], lo: [] as number[], hi: [] as number[], bitsPerPoint: [] as number[], seeds: SEEDS };
for (const db of EBN0_DB) {
  let bits = 0;
  let errors = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = chainBer({ sampleRate: SAMPLE_RATE, ebN0Db: db, seed, frames, receiver });
    bits += s.bits;
    errors += s.errors;
  }
  const { lo, hi } = wilson95(errors, bits);
  out.ebN0Db.push(db);
  out.ber.push(bits > 0 ? errors / bits : 0);
  out.lo.push(lo);
  out.hi.push(hi);
  out.bitsPerPoint.push(bits);
  console.log(`${receiver} Eb/N0 ${db} dB: BER ${(errors / bits).toExponential(3)} [${lo.toExponential(2)}, ${hi.toExponential(2)}], ${bits} bits`);
}

const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', fileName);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`written ${file}`);
