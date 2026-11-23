// E3b: Eb/N0 invariance of the BER across sampling rates (reference detector).
//
// Seeds: stream keys "E3b|stage=<1|2>|fs=<fs>|ebn0=<dB>|seed=<i>|role=<bits|noise|phase>".
//        Stage 1: seeds 1..10; stage 2 (only if needed): seeds 11..40.
// Parameters: fs in {8000, 16000, 48000}; Eb/N0 in {6, 9} dB; 40,000 bits per seed.
//             Stage 1 = 400,000 bits per condition; stage 2 adds 1,200,000 (cumulative 1,600,000)
//             for every condition involved in a non-conclusive pair.
// Expected runtime: about 1 minute for stage 1.
// Run: node prototypes/dsp/e3b-ebn0-invariance.mjs
//
// Reference detector (known bit timing): phase-continuous FSK (mark 1300 / space 2100 Hz,
// A = 0.5), AWGN with sigma^2 = A^2 fs / (4 R 10^(EbN0/10)), R = 1200 (D2, convention per LINE bit),
// complex mix at 1800 Hz, E1 low-pass, decimation D, f[m] = mix + arg(z[m] conj z[m-1]) fs_d / 2 pi
// timed at the midpoint of its two samples minus the group delay (E2 finding), mean frequency
// over the central half-bit, fixed threshold 1700 Hz.
//
// Pre-registered statistics (fixed before results):
//   theta_ab = ln(BER_a / BER_b), SE = sqrt(1/k_a - 1/n_a + 1/k_b - 1/n_b),
//   97.5 % two-sided intervals (z = 2.241) at both stages; equivalence margin delta = ln(1.10).
//   Equivalent: CI inside [-delta, +delta]. Different: CI entirely outside. Otherwise non-conclusive.
//   Final verdict = stage-1 verdict if conclusive, else stage-2 verdict (cumulative counts), else
//   "non-conclusive final" (no stage 3). If k = 0 for either condition: non-conclusive at that
//   stage, no count correction; the Wilson interval is reported descriptively.
//   Also reported: Wilson intervals (same z), Newcombe interval of the absolute difference,
//   two-proportion z-test (informational only, never a proof of equivalence).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS, StreamRegistry, V23, designLowpass, forwardDecimation, gaussianTailQg, wilsonInterval, writeCsv, writeMeta } from './lib.mjs';

const t0 = performance.now();
const RATES = [8000, 16000, 48000];
const EBN0_DB = [6, 9];
const BITS_PER_SEED = 40_000;
const STAGE1_SEEDS = [1, 10];
const STAGE2_SEEDS = [11, 40];
const Z = 2.241;
const DELTA = Math.log(1.1);
const A = 0.5;
const F = V23.forward;
const PAIRS = [[8000, 16000], [16000, 48000], [8000, 48000]];

const selPath = join(RESULTS, 'e1-selected.json');
const sel = existsSync(selPath) ? JSON.parse(readFileSync(selPath, 'utf8')).selected : null;
const FILTER = sel ?? { window: 'hamming', convention: 'c1', cutoffHz: 1100, transitionHz: 400 };
const streams = new StreamRegistry('E3b|stage=<1|2>|fs=<fs>|ebn0=<dB>|seed=<i>|role=<bits|noise|phase>');
const filters = new Map(RATES.map((fs) => [fs, designLowpass({ fs, cutoffHz: FILTER.cutoffHz, transitionHz: FILTER.transitionHz, window: FILTER.window })]));

/** One seed of one condition: returns { errors, bits }. */
function runSeed(stage, fs, ebn0Db, seed) {
  const key = `E3b|stage=${stage}|fs=${fs}|ebn0=${ebn0Db}|seed=${seed}`;
  const rb = streams.stream(`${key}|role=bits`);
  const rn = streams.stream(`${key}|role=noise`);
  const rp = streams.stream(`${key}|role=phase`);
  const h = filters.get(fs);
  const L = h.length;
  const D = forwardDecimation(fs);
  const T = fs / F.baud; // samples per bit (fractional)
  const sigma = Math.sqrt((A * A * fs) / (4 * F.baud * 10 ** (ebn0Db / 10)));
  const leadBits = Math.ceil(L / T) + 2;
  const nBits = BITS_PER_SEED;
  const bits = new Uint8Array(nBits);
  for (let i = 0; i < nBits; i++) bits[i] = rb.uniform() < 0.5 ? 1 : 0;
  const totalBits = leadBits + nBits + Math.ceil(L / T) + 2;
  const nSamples = Math.floor(totalBits * T);
  const gd = (L - 1) / 2;
  const dphiMix = (2 * Math.PI * F.mixHz) / fs;
  const fsd = fs / D;
  const br = new Float64Array(2 * L);
  const bi = new Float64Array(2 * L);
  let pos = 0;
  let phase = 2 * Math.PI * rp.uniform();
  let phaseD = 0;
  let prevRe = NaN;
  let prevIm = NaN;
  // per-bit accumulation of the frequency over the central half-bit
  const sumF = new Float64Array(nBits);
  const cntF = new Uint16Array(nBits);
  for (let n = 0; n < nSamples; n++) {
    const bitIndex = Math.floor(n / T); // exact real-time timeline: sample n belongs to bit floor(n/T)
    const k = bitIndex - leadBits;
    const mark = k < 0 || k >= nBits ? true : bits[k] === 1;
    const f = mark ? F.markHz : F.spaceHz;
    if (n > 0) phase += (2 * Math.PI * f) / fs;
    const x = A * Math.sin(phase) + sigma * rn.normal();
    const th = dphiMix * n;
    const vr = x * Math.cos(th);
    const vi = -x * Math.sin(th);
    br[pos] = vr; br[pos + L] = vr;
    bi[pos] = vi; bi[pos + L] = vi;
    const base = pos + L;
    pos = pos + 1 === L ? 0 : pos + 1;
    if (++phaseD < D) continue;
    phaseD = 0;
    let yr = 0;
    let yi = 0;
    for (let j = 0; j < L; j++) { yr += h[j] * br[base - j]; yi += h[j] * bi[base - j]; }
    if (!Number.isNaN(prevRe)) {
      const re = yr * prevRe + yi * prevIm;
      const im = yi * prevRe - yr * prevIm;
      const fest = F.mixHz + (Math.atan2(im, re) * fsd) / (2 * Math.PI);
      // time in input samples of this estimate, compensated (E2): midpoint minus group delay,
      // converted to the instantaneous-frequency time axis (increment of sample n is at n - 0.5)
      const t = n - D / 2 - gd + 0.5;
      const u = t / T - leadBits; // position in bits relative to the first data bit
      const kb = Math.floor(u);
      if (kb >= 0 && kb < nBits) {
        const frac = u - kb;
        if (frac >= 0.25 && frac < 0.75) { sumF[kb] += fest; cntF[kb]++; }
      }
    }
    prevRe = yr;
    prevIm = yi;
  }
  let errors = 0;
  let empty = 0;
  for (let k = 0; k < nBits; k++) {
    if (cntF[k] === 0) { empty++; continue; }
    const decided = sumF[k] / cntF[k] < F.thresholdHz ? 1 : 0;
    if (decided !== bits[k]) errors++;
  }
  if (empty) throw new Error(`no discriminator output in the central half-bit for ${empty} bits (fs ${fs})`);
  return { errors, bits: nBits };
}

function runStage(stage, fs, ebn0Db, [s0, s1]) {
  let errors = 0;
  let bits = 0;
  for (let seed = s0; seed <= s1; seed++) {
    const r = runSeed(stage, fs, ebn0Db, seed);
    errors += r.errors;
    bits += r.bits;
  }
  return { errors, bits };
}

function compare(a, b) {
  const out = { ka: a.errors, na: a.bits, kb: b.errors, nb: b.bits };
  out.berA = a.errors / a.bits;
  out.berB = b.errors / b.bits;
  const wa = wilsonInterval(a.errors, a.bits, Z);
  const wb = wilsonInterval(b.errors, b.bits, Z);
  out.wilsonA = wa;
  out.wilsonB = wb;
  const d = out.berA - out.berB;
  out.newcombe = { lo: d - Math.sqrt((out.berA - wa.lo) ** 2 + (wb.hi - out.berB) ** 2), hi: d + Math.sqrt((wa.hi - out.berA) ** 2 + (out.berB - wb.lo) ** 2) };
  const pPool = (a.errors + b.errors) / (a.bits + b.bits);
  out.zTwoProportion = d / Math.sqrt(pPool * (1 - pPool) * (1 / a.bits + 1 / b.bits));
  if (a.errors === 0 || b.errors === 0) {
    out.theta = NaN; out.se = NaN; out.lo = NaN; out.hi = NaN;
    out.verdict = 'non-conclusive (zero errors)';
    return out;
  }
  out.theta = Math.log(out.berA / out.berB);
  out.se = Math.sqrt(1 / a.errors - 1 / a.bits + 1 / b.errors - 1 / b.bits);
  out.lo = out.theta - Z * out.se;
  out.hi = out.theta + Z * out.se;
  if (out.lo >= -DELTA && out.hi <= DELTA) out.verdict = 'equivalent';
  else if (out.hi < -DELTA || out.lo > DELTA) out.verdict = 'different';
  else out.verdict = 'non-conclusive';
  return out;
}

const conclusive = (v) => v === 'equivalent' || v === 'different';
const stage1 = new Map();
for (const fs of RATES) for (const e of EBN0_DB) {
  stage1.set(`${fs}|${e}`, runStage(1, fs, e, STAGE1_SEEDS));
  console.log(`stage 1 fs=${fs} Eb/N0=${e} dB: ${JSON.stringify(stage1.get(`${fs}|${e}`))} (${Math.round(performance.now() - t0)} ms)`);
}
const pairRows = [];
const needStage2 = new Set();
for (const e of EBN0_DB) for (const [fa, fb] of PAIRS) {
  const c = compare(stage1.get(`${fa}|${e}`), stage1.get(`${fb}|${e}`));
  pairRows.push({ ebn0Db: e, fa, fb, stage1: c });
  if (!conclusive(c.verdict)) { needStage2.add(`${fa}|${e}`); needStage2.add(`${fb}|${e}`); }
}
const cumulative = new Map();
for (const key of needStage2) {
  const [fs, e] = key.split('|').map(Number);
  const add = runStage(2, fs, e, STAGE2_SEEDS);
  const s1 = stage1.get(key);
  cumulative.set(key, { errors: s1.errors + add.errors, bits: s1.bits + add.bits });
  console.log(`stage 2 fs=${fs} Eb/N0=${e} dB cumulative: ${JSON.stringify(cumulative.get(key))}`);
}
for (const p of pairRows) {
  if (conclusive(p.stage1.verdict)) { p.finalVerdict = p.stage1.verdict; p.finalStage = 1; continue; }
  p.stage2 = compare(cumulative.get(`${p.fa}|${p.ebn0Db}`), cumulative.get(`${p.fb}|${p.ebn0Db}`));
  p.finalVerdict = conclusive(p.stage2.verdict) ? p.stage2.verdict : 'non-conclusive final';
  p.finalStage = 2;
}

// First-order prediction (math.md, hypothesis): Pe ~ Qg(1.047 sqrt(gamma_band)), gamma_band = Eb/N0 R / B_n
const csv = [];
for (const fs of RATES) for (const e of EBN0_DB) {
  const s = stage1.get(`${fs}|${e}`);
  const w = wilsonInterval(s.errors, s.bits, Z);
  csv.push({ kind: 'condition', stage: 1, fs, ebn0Db: e, errors: s.errors, bits: s.bits, ber: s.errors / s.bits, wilsonLo: w.lo, wilsonHi: w.hi, fa: '', fb: '', theta: '', se: '', lo: '', hi: '', newcombeLo: '', newcombeHi: '', zTwoProportion: '', verdict: '' });
  const cm = cumulative.get(`${fs}|${e}`);
  if (cm) {
    const w2 = wilsonInterval(cm.errors, cm.bits, Z);
    csv.push({ kind: 'condition', stage: 2, fs, ebn0Db: e, errors: cm.errors, bits: cm.bits, ber: cm.errors / cm.bits, wilsonLo: w2.lo, wilsonHi: w2.hi, fa: '', fb: '', theta: '', se: '', lo: '', hi: '', newcombeLo: '', newcombeHi: '', zTwoProportion: '', verdict: '' });
  }
}
for (const p of pairRows) {
  for (const [stage, c] of [[1, p.stage1], [2, p.stage2]]) {
    if (!c) continue;
    csv.push({ kind: 'pair', stage, fs: '', ebn0Db: p.ebn0Db, errors: '', bits: '', ber: '', wilsonLo: '', wilsonHi: '', fa: p.fa, fb: p.fb, theta: c.theta, se: c.se, lo: c.lo, hi: c.hi, newcombeLo: c.newcombe.lo, newcombeHi: c.newcombe.hi, zTwoProportion: c.zTwoProportion, verdict: c.verdict });
  }
}
const nStreams = streams.assertUniqueSeeds();
writeCsv('e3b-ebn0-invariance', csv);
writeMeta('e3b-ebn0-invariance', {
  experiment: 'E3b Eb/N0 invariance of BER across sampling rates (reference detector)',
  filter: FILTER,
  parameters: { rates: RATES, ebN0Db: EBN0_DB, bitsPerSeed: BITS_PER_SEED, stage1Seeds: STAGE1_SEEDS, stage2Seeds: STAGE2_SEEDS, z: Z, delta: DELTA, amplitude: A, bitRate: F.baud },
  rng: streams.toJSON(),
  finalVerdicts: pairRows.map((p) => ({ ebn0Db: p.ebn0Db, pair: [p.fa, p.fb], stage: p.finalStage, verdict: p.finalVerdict })),
  caveat: 'A BER difference may come from the detector (window discretization at 6.7 samples/bit at 8 kHz) and does not by itself invalidate the convention, which E3a validates.',
  runtimeMs: Math.round(performance.now() - t0),
});

console.log(`E3b (simulation), filter ${FILTER.convention}/${FILTER.window}, ${nStreams} unique streams, z=${Z}, delta=ln(1.1)=${DELTA.toFixed(4)}`);
for (const fs of RATES) for (const e of EBN0_DB) {
  const s = stage1.get(`${fs}|${e}`);
  const w = wilsonInterval(s.errors, s.bits, Z);
  console.log(`  fs=${String(fs).padStart(5)} Eb/N0=${e} dB: BER=${(s.errors / s.bits).toExponential(4)} (k=${s.errors}, n=${s.bits}) Wilson97.5=[${w.lo.toExponential(4)}, ${w.hi.toExponential(4)}]`);
}
for (const p of pairRows) {
  const c = p.stage2 ?? p.stage1;
  console.log(`  Eb/N0=${p.ebn0Db} dB (${p.fa}, ${p.fb}) stage ${p.finalStage}: theta=${c.theta.toFixed(4)} CI=[${c.lo.toFixed(4)}, ${c.hi.toFixed(4)}] Newcombe=[${c.newcombe.lo.toExponential(2)}, ${c.newcombe.hi.toExponential(2)}] z2p=${c.zTwoProportion.toFixed(2)} -> ${p.finalVerdict}`);
}
const g = (e) => 10 ** (e / 10);
console.log(`First-order prediction (hypothesis, B_n = 2099 Hz): ${EBN0_DB.map((e) => `${e} dB -> ${gaussianTailQg(1.047 * Math.sqrt((g(e) * F.baud) / 2099)).toExponential(3)}`).join(', ')}`);
console.log(`Runtime ${Math.round(performance.now() - t0)} ms`);
