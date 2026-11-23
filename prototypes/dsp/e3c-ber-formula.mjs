// E3c: reference BER formula for non-coherent binary signals with correlation rho.
//
// Seeds: stream keys "E3c|series=<s>|ebn0=<dB>|rhoPhase=<p>|seed=<i>|role=<symbol|noise|phase>",
//        series 1 = seeds 1..20, series 2 (only if series 1 fails) = seeds 21..40.
// Parameters: Eb/N0 in {4, 6, 8, 10} dB x phase of rho in {0, 2 pi / 3}: 8 conditions;
//             2,000,000 bits per condition IN TOTAL (20 seeds x 100,000 bits); |rho| = |sin(pi h)/(pi h)|, h = 2/3.
// Expected runtime: about 1 minute per series.
// Run: node prototypes/dsp/e3c-ber-formula.mjs
//
// Model (complex plane, orthonormal u1, u2): s1 = u1, s2 = rho u1 + sqrt(1 - |rho|^2) u2,
// <s2, s1> = rho. Per bit: emitted symbol b in {1, 2} with probability 1/2; ONE noise realization
// n = n1 u1 + n2 u2, n1, n2 ~ CN(0, 1) independent; uniform phase phi;
// y = exp(j phi) sqrt(gamma) s_b + n, gamma = Eb/N0 (complex-envelope convention: signal energy
// 2 Eb, noise density 2 N0, same ratio). Both correlators use the SAME y:
// r1 = <y, s1>, r2 = <y, s2> (inner product <y, s> = conj(s) . y), with noise nu1 = n1,
// nu2 = conj(rho) n1 + sqrt(1 - |rho|^2) n2. Decision: argmax(|r1|, |r2|).
//
// Generator guard (a code defect if it fails: fix, then rerun with the SAME seeds):
// measured E|nu1|^2 = 1, E|nu2|^2 = 1 and E[nu1 conj(nu2)] = rho, each within 3 SE.
//
// Validation: global BER, P(e|1), P(e|2) against
// P_b = marcumQ1(a, b) - 0.5 exp(-(a^2 + b^2)/2) I0(a b), a, b = sqrt(gamma/2 (1 -/+ sqrt(1 - |rho|^2))).
// 24 simultaneous Wilson intervals (3 quantities x 8 conditions), Bonferroni at global 99 %:
// each at 1 - 0.01/24 (z = normalQuantile(1 - 0.01/48), about 3.53). Individual 99 % intervals are
// descriptive only. The P(e|1) - P(e|2) difference is reported with a Newcombe interval.
// Replication rule (fixed before any result): series 1 passes -> results COMPATIBLE with the
// formula, no replication (never a definitive confirmation). Series 1 fails -> ONE series 2,
// all 8 conditions: passes -> NON-CONCLUSIVE (investigate); fails -> INCOMPATIBLE with the
// formula (investigation required). No pooling, no third series, no selective re-run.
// Also: marcumQ1 vs numerical integration on a grid (tolerance 1e-7, a hypothesis).

import { StreamRegistry, berNoncoherentCorrelated, forwardRhoAbs, marcumQ1, marcumQ1Integral, normalQuantile, wilsonInterval, writeCsv, writeMeta } from './lib.mjs';

const t0 = performance.now();
const EBN0_DB = [4, 6, 8, 10];
const RHO_PHASES = [{ id: '0', value: 0 }, { id: '2pi/3', value: (2 * Math.PI) / 3 }];
const SEEDS_PER_SERIES = 20;
const BITS_PER_SEED = 100_000;
const FAMILY = 24;
const Z_SIMUL = normalQuantile(1 - 0.01 / (2 * FAMILY));
const Z_INDIV = normalQuantile(1 - 0.01 / 2);
const RHO_ABS = forwardRhoAbs();

const streams = new StreamRegistry('E3c|series=<s>|ebn0=<dB>|rhoPhase=<p>|seed=<i>|role=<symbol|noise|phase>');

function runCondition(series, ebn0Db, rhoPhase) {
  const gamma = 10 ** (ebn0Db / 10);
  const sg = Math.sqrt(gamma);
  const rRe = RHO_ABS * Math.cos(rhoPhase.value);
  const rIm = RHO_ABS * Math.sin(rhoPhase.value);
  const c = Math.sqrt(1 - RHO_ABS * RHO_ABS);
  const s = { n1: 0, e1: 0, n2: 0, e2: 0, g11: 0, g22: 0, g12re: 0, g12im: 0, gN: 0, perSeed: [] };
  const firstSeed = (series - 1) * SEEDS_PER_SERIES + 1;
  const g11s = [];
  const g22s = [];
  const g12res = [];
  const g12ims = [];
  for (let seed = firstSeed; seed < firstSeed + SEEDS_PER_SERIES; seed++) {
    const key = `E3c|series=${series}|ebn0=${ebn0Db}|rhoPhase=${rhoPhase.id}|seed=${seed}`;
    const rs = streams.stream(`${key}|role=symbol`);
    const rn = streams.stream(`${key}|role=noise`);
    const rp = streams.stream(`${key}|role=phase`);
    let a11 = 0, a22 = 0, a12re = 0, a12im = 0;
    for (let i = 0; i < BITS_PER_SEED; i++) {
      const b = rs.uniform() < 0.5 ? 1 : 2;
      // CN(0,1): real and imaginary parts N(0, 1/2)
      const n1r = rn.normal() * Math.SQRT1_2, n1i = rn.normal() * Math.SQRT1_2;
      const n2r = rn.normal() * Math.SQRT1_2, n2i = rn.normal() * Math.SQRT1_2;
      const phi = 2 * Math.PI * rp.uniform();
      const er = Math.cos(phi) * sg, ei = Math.sin(phi) * sg;
      // y in the (u1, u2) basis
      let y1r, y1i, y2r, y2i;
      if (b === 1) { y1r = er + n1r; y1i = ei + n1i; y2r = n2r; y2i = n2i; }
      else {
        // s2 = rho u1 + c u2
        y1r = er * rRe - ei * rIm + n1r; y1i = er * rIm + ei * rRe + n1i;
        y2r = er * c + n2r; y2i = ei * c + n2i;
      }
      // r1 = conj(s1) . y = y1 ; r2 = conj(rho) y1 + c y2
      const r1r = y1r, r1i = y1i;
      const r2r = rRe * y1r + rIm * y1i + c * y2r;
      const r2i = rRe * y1i - rIm * y1r + c * y2i;
      const m1 = r1r * r1r + r1i * r1i;
      const m2 = r2r * r2r + r2i * r2i;
      if (b === 1) { s.n1++; if (m2 >= m1) s.e1++; }
      else { s.n2++; if (m1 >= m2) s.e2++; }
      // guard: nu1 = n1, nu2 = conj(rho) n1 + c n2
      const v1r = n1r, v1i = n1i;
      const v2r = rRe * n1r + rIm * n1i + c * n2r;
      const v2i = rRe * n1i - rIm * n1r + c * n2i;
      a11 += v1r * v1r + v1i * v1i;
      a22 += v2r * v2r + v2i * v2i;
      // nu1 conj(nu2)
      a12re += v1r * v2r + v1i * v2i;
      a12im += v1i * v2r - v1r * v2i;
    }
    g11s.push(a11 / BITS_PER_SEED); g22s.push(a22 / BITS_PER_SEED);
    g12res.push(a12re / BITS_PER_SEED); g12ims.push(a12im / BITS_PER_SEED);
  }
  const ms = (xs) => {
    const m = xs.reduce((a, v) => a + v, 0) / xs.length;
    const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
    return { mean: m, se: Math.sqrt(v / xs.length) };
  };
  const guard = { e11: ms(g11s), e22: ms(g22s), e12re: ms(g12res), e12im: ms(g12ims) };
  guard.pass =
    Math.abs(guard.e11.mean - 1) <= 3 * guard.e11.se &&
    Math.abs(guard.e22.mean - 1) <= 3 * guard.e22.se &&
    Math.abs(guard.e12re.mean - rRe) <= 3 * guard.e12re.se &&
    Math.abs(guard.e12im.mean - rIm) <= 3 * guard.e12im.se;
  return { gamma, counts: s, guard, rho: { re: rRe, im: rIm } };
}

/** Newcombe hybrid score interval for p1 - p2 from two Wilson intervals with the same z. */
function newcombe(k1, n1, k2, n2, z) {
  const p1 = k1 / n1, p2 = k2 / n2;
  const w1 = wilsonInterval(k1, n1, z), w2 = wilsonInterval(k2, n2, z);
  const d = p1 - p2;
  return {
    lo: d - Math.sqrt((p1 - w1.lo) ** 2 + (w2.hi - p2) ** 2),
    hi: d + Math.sqrt((w1.hi - p1) ** 2 + (p2 - w2.lo) ** 2),
  };
}

function runSeries(series) {
  const rows = [];
  let guardOk = true;
  for (const ebn0Db of EBN0_DB) {
    for (const ph of RHO_PHASES) {
      const r = runCondition(series, ebn0Db, ph);
      guardOk &&= r.guard.pass;
      const formula = berNoncoherentCorrelated(r.gamma, RHO_ABS);
      const { n1, e1, n2, e2 } = r.counts;
      const qty = [
        ['global BER', e1 + e2, n1 + n2],
        ['P(e|1)', e1, n1],
        ['P(e|2)', e2, n2],
      ];
      const diff = newcombe(e1, n1, e2, n2, Z_SIMUL);
      for (const [name, k, n] of qty) {
        const ws = wilsonInterval(k, n, Z_SIMUL);
        const wi = wilsonInterval(k, n, Z_INDIV);
        rows.push({
          series, ebN0Db: ebn0Db, rhoPhase: ph.id, quantity: name, errors: k, bits: n, estimate: k / n, formula,
          simulLo: ws.lo, simulHi: ws.hi, indivLo99: wi.lo, indivHi99: wi.hi,
          containsFormula: formula >= ws.lo && formula <= ws.hi,
          diffPe1MinusPe2: name === 'global BER' ? e1 / n1 - e2 / n2 : '', diffLo: name === 'global BER' ? diff.lo : '', diffHi: name === 'global BER' ? diff.hi : '',
          guardE11: r.guard.e11.mean, guardE22: r.guard.e22.mean, guardE12re: r.guard.e12re.mean, guardE12im: r.guard.e12im.mean, guardPass: r.guard.pass,
        });
      }
    }
  }
  return { rows, guardOk, pass: rows.every((r) => r.containsFormula) };
}

// marcumQ1 against numerical integration (grid of (a, b))
const grid = [];
let worstQ = 0;
for (const a of [0, 0.5, 1, 1.5, 2, 3]) {
  for (const b of [0.25, 0.5, 1, 2, 3, 4]) {
    const q = marcumQ1(a, b);
    const qi = marcumQ1Integral(a, b);
    worstQ = Math.max(worstQ, Math.abs(q - qi));
    grid.push({ a, b, marcumQ1: q, integral: qi, absDiff: Math.abs(q - qi) });
  }
}
const marcumPass = worstQ <= 1e-7;

const s1 = runSeries(1);
let s2 = null;
let verdict;
if (!s1.guardOk) verdict = 'GENERATOR GUARD FAILED (code defect): fix and rerun with the same seeds; no statistical verdict';
else if (s1.pass) verdict = 'COMPATIBLE with the formula (series 1, all 24 simultaneous intervals contain it); no replication; not a definitive confirmation';
else {
  s2 = runSeries(2);
  if (!s2.guardOk) verdict = 'GENERATOR GUARD FAILED in series 2 (code defect)';
  else verdict = s2.pass ? 'NON-CONCLUSIVE (series 1 failed, series 2 passed): investigate' : 'INCOMPATIBLE with the formula (both series failed): investigation required';
}
const nStreams = streams.assertUniqueSeeds();
writeCsv('e3c-ber-formula', [...s1.rows, ...(s2 ? s2.rows : [])]);
writeCsv('e3c-marcum-grid', grid);
writeMeta('e3c-ber-formula', {
  experiment: 'E3c reference BER formula (two-symbol non-coherent model)',
  parameters: {
    ebN0Db: EBN0_DB, rhoPhases: RHO_PHASES.map((p) => p.id), rhoAbs: RHO_ABS, seedsPerSeries: SEEDS_PER_SERIES,
    bitsPerSeed: BITS_PER_SEED, bitsPerConditionTotal: SEEDS_PER_SERIES * BITS_PER_SEED,
    familySize: FAMILY, zSimultaneous: Z_SIMUL, zIndividual99: Z_INDIV,
  },
  rng: streams.toJSON(),
  marcumGrid: { worstAbsDiff: worstQ, tolerance: 1e-7, pass: marcumPass },
  checks: { 'marcumQ1 special values': 'see lib.mjs self-checks', 'ber formula reduces to 0.5*exp(-Eb/(2*N0)) at rho=0': 'see lib.mjs self-checks' },
  series1: { guardOk: s1.guardOk, pass: s1.pass },
  series2: s2 && { guardOk: s2.guardOk, pass: s2.pass },
  verdict,
  runtimeMs: Math.round(performance.now() - t0),
});

console.log(`E3c (simulation). |rho| = ${RHO_ABS.toFixed(6)}, z simultaneous = ${Z_SIMUL.toFixed(4)}, ${nStreams} unique streams`);
console.log(`marcumQ1 vs numerical integration: worst |diff| = ${worstQ.toExponential(2)} (tolerance 1e-7) -> ${marcumPass}`);
for (const r of [...s1.rows, ...(s2 ? s2.rows : [])]) {
  console.log(`s${r.series} Eb/N0=${String(r.ebN0Db).padStart(2)} dB phase=${r.rhoPhase.padEnd(5)} ${r.quantity.padEnd(10)} k=${String(r.errors).padStart(7)} n=${String(r.bits).padStart(7)} est=${r.estimate.toExponential(4)} formula=${r.formula.toExponential(4)} CI=[${r.simulLo.toExponential(4)}, ${r.simulHi.toExponential(4)}] ${r.containsFormula ? 'in' : 'OUT'}${r.quantity === 'global BER' ? `  Pe1-Pe2=${Number(r.diffPe1MinusPe2).toExponential(2)} [${Number(r.diffLo).toExponential(2)}, ${Number(r.diffHi).toExponential(2)}] guard=${r.guardPass}` : ''}`);
}
console.log(`Verdict: ${verdict}`);
console.log(`Runtime ${Math.round(performance.now() - t0)} ms`);
