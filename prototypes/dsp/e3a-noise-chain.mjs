// E3a: noise and level chain (validates the convention D1 to D5 of docs/math.md).
//
// Seeds: stream keys "E3a|fs=<fs>|seed=<i>|role=noise", i = 1..20 (xoshiro128**, see lib.mjs).
// Parameters: fs in {8000, 16000, 48000}; M = 20 seeds of N = 2e6 samples; sigma^2 = 1;
//             filter = results/e1-selected.json (fallback: spec Hamming, -6 dB 1100 Hz, 400 Hz).
// Expected runtime: about 1 to 3 minutes.
// Run: node prototypes/dsp/e3a-noise-chain.mjs
//
// Chain (D2, D3): w[n] ~ N(0, sigma^2) real; raw mix v[n] = w[n] exp(-j theta_n),
// theta_n = 2 pi f_mix n / fs (gain 1, as in design.md); y = h * v with sum h = 1.
// The first N_taps - 1 outputs (zero initial state) are excluded before ANY measurement;
// theta_n keeps its absolute index n. A sensitivity copy of every accumulator starts at 5 N_taps.
//
// Measurements:
//  a1 generator variance vs sigma^2 (seeds 1 to 5)
//  a2 one-sided PSD averaged over 300..3400 Hz vs N0 = 2 sigma^2 / fs (Welch, Hann, 1024 points)
//  a3 B_n from taps vs numerical integral of |H|^2 (relative 1e-9)
//  a4 E|v|^2 vs sigma^2
//  a5 E|y|^2 vs N0 B_n / 2 (gain-1 mixer); equals N0 B_n after the factor 2 (power-preserving)
//  a6 pseudo-variance after phase compensation C_p = (1/N) sum y[n]^2 exp(+j 2 theta_n)
//     vs its exact expectation sigma^2 sum_k h_k^2 exp(+j 2 omega k); rho_p = |C_p| / E|y|^2.
//     Positive control: same estimator on the unfiltered mix v (rho_p = 1).
//     Negative illustration: plain mean of y^2 without compensation (not a valid test).
//     I/Q on y' = y exp(+j theta): Var(I') - Var(Q') = Re C_p and 2 E[I'Q'] = Im C_p
//     (algebraic identity: a code check, not independent evidence).
//     This measures properness at ZERO LAG only.
//  a7 tone power after filtering = A^2/4 in the flat band; analytic image attenuation
//  a8 repetition at fs = 8000, 16000, 48000
// Pre-registered criteria (hypotheses): a1, a2, a4, a5, a7 pass if the relative deviation is
// <= 3 SE and <= 1 %. a3 passes at relative 1e-9. a6: (1) measured C_p within 3 SE of theory
// (real and imaginary parts); (2) rho_p,th <= tau_p = 0.01; (3) measured rho_p <= tau_p + 3 SE.
// Sensitivity: results with the 5 N_taps exclusion differ by at most 1 SE.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS, StreamRegistry, V23, designLowpass, dtft, fft, noiseBandwidthHz, toDb, writeCsv, writeMeta } from './lib.mjs';

const t0 = performance.now();
const RATES = [8000, 16000, 48000];
const M = 20;
const N = 2_000_000;
const SIGMA2 = 1;
const TAU_P = 0.01;
const A_TONE = 0.5;
const MIX = V23.forward.mixHz;

const selPath = join(RESULTS, 'e1-selected.json');
const sel = existsSync(selPath) ? JSON.parse(readFileSync(selPath, 'utf8')).selected : null;
const FILTER = sel ?? { window: 'hamming', convention: 'c1', cutoffHz: 1100, transitionHz: 400 };

const streams = new StreamRegistry('E3a|fs=<fs>|seed=<i>|role=noise');

function meanSe(values) {
  const n = values.length;
  const m = values.reduce((s, v) => s + v, 0) / n;
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  return { mean: m, se: Math.sqrt(v / n) };
}

function accumulate(X, w, vr, vi, yr, yi, cpRe, cpIm, cpvRe, cpvIm, plainRe, plainIm, ipr, ipi) {
  X.n++;
  X.w2 += w * w;
  X.v2 += vr * vr + vi * vi;
  X.y2 += yr * yr + yi * yi;
  X.cpRe += cpRe; X.cpIm += cpIm;
  X.cpvRe += cpvRe; X.cpvIm += cpvIm;
  X.plainRe += plainRe; X.plainIm += plainIm;
  X.iI += ipr * ipr; X.qQ += ipi * ipi; X.iQ += ipr * ipi; X.iM += ipr; X.qM += ipi;
}

/** One seed: generate, mix, filter and accumulate every statistic in a single pass. */
function runSeed(fs, h, seedIndex) {
  const rng = streams.stream(`E3a|fs=${fs}|seed=${seedIndex}|role=noise`);
  const L = h.length;
  const skipA = L - 1;
  const skipB = 5 * L;
  const omega = (2 * Math.PI * MIX) / fs;
  // circular buffers doubled to avoid modulo in the inner loop
  const br = new Float64Array(2 * L);
  const bi = new Float64Array(2 * L);
  let pos = 0;
  // Welch PSD of w (Hann, 1024, 50 % overlap is not needed: non-overlapping segments)
  const NF = 1024;
  const win = new Float64Array(NF);
  let winPow = 0;
  for (let i = 0; i < NF; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NF); winPow += win[i] * win[i]; }
  const seg = new Float64Array(NF);
  const psd = new Float64Array(NF / 2 + 1);
  let segCount = 0;
  let segFill = 0;
  const acc = () => ({ n: 0, w2: 0, v2: 0, y2: 0, cpRe: 0, cpIm: 0, cpvRe: 0, cpvIm: 0, plainRe: 0, plainIm: 0, iI: 0, qQ: 0, iQ: 0, iM: 0, qM: 0 });
  const A = acc();
  const B = acc();
  let w2All = 0;
  for (let n = 0; n < N; n++) {
    const w = Math.sqrt(SIGMA2) * rng.normal();
    w2All += w * w;
    seg[segFill++] = w;
    if (segFill === NF) {
      const re = new Float64Array(NF);
      const im = new Float64Array(NF);
      for (let i = 0; i < NF; i++) re[i] = seg[i] * win[i];
      fft(re, im);
      for (let i = 0; i <= NF / 2; i++) psd[i] += re[i] * re[i] + im[i] * im[i];
      segCount++;
      segFill = 0;
    }
    const th = omega * n;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const vr = w * c;
    const vi = -w * s;
    br[pos] = vr; br[pos + L] = vr;
    bi[pos] = vi; bi[pos + L] = vi;
    // y[n] = sum_k h[k] v[n-k]; newest sample at index pos + L (doubled buffer)
    let yr = 0;
    let yi = 0;
    const base = pos + L;
    for (let k = 0; k < L; k++) {
      const hk = h[k];
      yr += hk * br[base - k];
      yi += hk * bi[base - k];
    }
    pos = pos + 1 === L ? 0 : pos + 1;
    // e^{+j 2 theta}
    const c2 = c * c - s * s;
    const s2 = 2 * s * c;
    const yy2re = yr * yr - yi * yi;
    const yy2im = 2 * yr * yi;
    const cpRe = yy2re * c2 - yy2im * s2;
    const cpIm = yy2re * s2 + yy2im * c2;
    const vv2re = vr * vr - vi * vi;
    const vv2im = 2 * vr * vi;
    // y' = y e^{+j theta}
    const ipr = yr * c - yi * s;
    const ipi = yr * s + yi * c;
    if (n >= skipA) accumulate(A, w, vr, vi, yr, yi, cpRe, cpIm, vv2re * c2 - vv2im * s2, vv2re * s2 + vv2im * c2, yy2re, yy2im, ipr, ipi);
    if (n >= skipB) accumulate(B, w, vr, vi, yr, yi, cpRe, cpIm, vv2re * c2 - vv2im * s2, vv2re * s2 + vv2im * c2, yy2re, yy2im, ipr, ipi);
  }
  const fin = (X) => {
    const k = X.n;
    const iMean = X.iM / k;
    const qMean = X.qM / k;
    return {
      w2: X.w2 / k, v2: X.v2 / k, y2: X.y2 / k,
      cpRe: X.cpRe / k, cpIm: X.cpIm / k, cpvRe: X.cpvRe / k, cpvIm: X.cpvIm / k,
      plainRe: X.plainRe / k, plainIm: X.plainIm / k,
      varI: X.iI / k - iMean * iMean, varQ: X.qQ / k - qMean * qMean, covIQ: X.iQ / k - iMean * qMean,
    };
  };
  // one-sided PSD (density per Hz): 2 |X|^2 / (fs sum w^2), averaged over segments, 300..3400 Hz
  let psdBand = 0;
  let bins = 0;
  for (let i = 0; i <= NF / 2; i++) {
    const f = (i * fs) / NF;
    if (f >= 300 && f <= 3400) { psdBand += (2 * psd[i]) / (segCount * fs * winPow); bins++; }
  }
  return { A: fin(A), B: fin(B), w2All: w2All / N, psdOneSided: psdBand / bins };
}

const rows = [];
const verdicts = [];
for (const fs of RATES) {
  const h = designLowpass({ fs, cutoffHz: FILTER.cutoffHz, transitionHz: FILTER.transitionHz, window: FILTER.window });
  const L = h.length;
  const Bn = noiseBandwidthHz(h, fs);
  const N0 = (2 * SIGMA2) / fs;
  const omega = (2 * Math.PI * MIX) / fs;
  // a3: Parseval check. Integral of |H|^2 over one period with K > 2 L uniform points is exact
  // for a trigonometric polynomial of degree L - 1.
  const K = 4 * L;
  let integ = 0;
  for (let i = 0; i < K; i++) {
    const f = -fs / 2 + (i * fs) / K;
    integ += dtft(h, fs, f).mag ** 2;
  }
  integ *= fs / K;
  let sumH = 0;
  for (const v of h) sumH += v;
  const BnIntegral = integ / (sumH * sumH);
  // a6 theory: sigma^2 sum_k h_k^2 e^{+j 2 omega k}
  let thRe = 0;
  let thIm = 0;
  let sh2 = 0;
  for (let k = 0; k < L; k++) {
    thRe += h[k] * h[k] * Math.cos(2 * omega * k);
    thIm += h[k] * h[k] * Math.sin(2 * omega * k);
    sh2 += h[k] * h[k];
  }
  thRe *= SIGMA2;
  thIm *= SIGMA2;
  const rhoPth = Math.hypot(thRe, thIm) / (SIGMA2 * sh2);

  const per = [];
  for (let i = 1; i <= M; i++) per.push(runSeed(fs, h, i));
  const col = (sel, key) => per.map((p) => p[sel][key]);
  const stat = (sel, key) => meanSe(col(sel, key));

  const expY2 = (SIGMA2 * Bn) / fs; // = N0 Bn / 2
  const a1 = meanSe(per.slice(0, 5).map((p) => p.w2All));
  const a2 = meanSe(per.map((p) => p.psdOneSided));
  const a4 = stat('A', 'v2');
  const a5 = stat('A', 'y2');
  const cpRe = stat('A', 'cpRe');
  const cpIm = stat('A', 'cpIm');
  const rhoPseeds = per.map((p) => Math.hypot(p.A.cpRe, p.A.cpIm) / p.A.y2);
  // rho_p of the mean C_p over the mean E|y|^2, with a delta-method SE from the per-seed values
  const rhoP = Math.hypot(cpRe.mean, cpIm.mean) / a5.mean;
  const rhoPse = meanSe(rhoPseeds).se;
  const pos = { re: stat('A', 'cpvRe'), im: stat('A', 'cpvIm'), v2: a4 };
  const rhoPositive = Math.hypot(pos.re.mean, pos.im.mean) / a4.mean;
  const plain = { re: stat('A', 'plainRe'), im: stat('A', 'plainIm') };
  const varI = stat('A', 'varI');
  const varQ = stat('A', 'varQ');
  const covIQ = stat('A', 'covIQ');
  const identityGap = Math.max(
    ...per.map((p) => Math.abs(p.A.varI - p.A.varQ - p.A.cpRe)),
    ...per.map((p) => Math.abs(2 * p.A.covIQ - p.A.cpIm)),
  );
  // Sensitivity (5 N_taps exclusion)
  const a5B = stat('B', 'y2');
  const cpReB = stat('B', 'cpRe');
  const cpImB = stat('B', 'cpIm');

  // a7: tone power after filtering (deterministic, no noise) and analytic image attenuation
  const tones = [V23.forward.markHz, 1700, V23.forward.spaceHz];
  const toneRows = tones.map((f) => {
    const n = 40 * L + 20000;
    const br = new Float64Array(2 * L);
    const bi = new Float64Array(2 * L);
    let p = 0;
    let pow = 0;
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      const x = A_TONE * Math.cos((2 * Math.PI * f * i) / fs + 0.3);
      const th = omega * i;
      const vr = x * Math.cos(th);
      const vi = -x * Math.sin(th);
      br[p] = vr; br[p + L] = vr; bi[p] = vi; bi[p + L] = vi;
      let yr = 0;
      let yi = 0;
      for (let k = 0; k < L; k++) { yr += h[k] * br[p + L - k]; yi += h[k] * bi[p + L - k]; }
      p = p + 1 === L ? 0 : p + 1;
      if (i >= L - 1) { pow += yr * yr + yi * yi; cnt++; }
    }
    const measured = pow / cnt;
    const expected = (A_TONE * A_TONE) / 4;
    const gain = dtft(h, fs, f - MIX).mag;
    return { f, measured, expected, relDev: measured / expected - 1, passbandGainDb: toDb(gain), imageAttDb: -toDb(dtft(h, fs, -f - MIX).mag) };
  });

  const rel = (m, e) => m / e - 1;
  const passRel = (m, se, e) => Math.abs(m - e) <= 3 * se && Math.abs(rel(m, e)) <= 0.01;
  const v = {
    fs, taps: L, BnHz: Bn,
    a1_pass: passRel(a1.mean, a1.se, SIGMA2),
    a2_pass: passRel(a2.mean, a2.se, N0),
    a3_pass: Math.abs(BnIntegral / Bn - 1) <= 1e-9,
    a4_pass: passRel(a4.mean, a4.se, SIGMA2),
    a5_pass: passRel(a5.mean, a5.se, expY2),
    a6_c1_pass: Math.abs(cpRe.mean - thRe) <= 3 * cpRe.se && Math.abs(cpIm.mean - thIm) <= 3 * cpIm.se,
    a6_c2_pass: rhoPth <= TAU_P,
    a6_c3_pass: rhoP <= TAU_P + 3 * rhoPse,
    // Unfiltered: v^2 e^{+j2theta} = w^2 exactly, so rho_p = 1 identically (up to rounding).
    a6_positiveControl_pass: Math.abs(rhoPositive - 1) <= 1e-9,
    a7_pass: toneRows.every((t) => Math.abs(t.relDev) <= 0.01),
    sensitivity_pass: Math.abs(a5B.mean - a5.mean) <= a5.se && Math.abs(cpReB.mean - cpRe.mean) <= cpRe.se && Math.abs(cpImB.mean - cpIm.mean) <= cpIm.se,
  };
  verdicts.push(v);
  rows.push(
    { fs, quantity: 'a1 generator variance (seeds 1-5)', measured: a1.mean, se: a1.se, expected: SIGMA2, relDev: rel(a1.mean, SIGMA2), pass: v.a1_pass },
    { fs, quantity: 'a2 one-sided PSD 300-3400 Hz', measured: a2.mean, se: a2.se, expected: N0, relDev: rel(a2.mean, N0), pass: v.a2_pass },
    { fs, quantity: 'a3 B_n taps vs integral of |H|^2 [Hz]', measured: BnIntegral, se: 0, expected: Bn, relDev: rel(BnIntegral, Bn), pass: v.a3_pass },
    { fs, quantity: 'a4 E|v|^2 raw mix', measured: a4.mean, se: a4.se, expected: SIGMA2, relDev: rel(a4.mean, SIGMA2), pass: v.a4_pass },
    { fs, quantity: 'a5 E|y|^2 vs N0*Bn/2 (gain 1)', measured: a5.mean, se: a5.se, expected: expY2, relDev: rel(a5.mean, expY2), pass: v.a5_pass },
    { fs, quantity: 'a5 2*E|y|^2 vs N0*Bn (power-preserving)', measured: 2 * a5.mean, se: 2 * a5.se, expected: N0 * Bn, relDev: rel(2 * a5.mean, N0 * Bn), pass: v.a5_pass },
    { fs, quantity: 'a6 Re C_p', measured: cpRe.mean, se: cpRe.se, expected: thRe, relDev: NaN, pass: Math.abs(cpRe.mean - thRe) <= 3 * cpRe.se },
    { fs, quantity: 'a6 Im C_p', measured: cpIm.mean, se: cpIm.se, expected: thIm, relDev: NaN, pass: Math.abs(cpIm.mean - thIm) <= 3 * cpIm.se },
    { fs, quantity: 'a6 rho_p theoretical', measured: rhoPth, se: 0, expected: TAU_P, relDev: NaN, pass: v.a6_c2_pass },
    { fs, quantity: 'a6 rho_p measured', measured: rhoP, se: rhoPse, expected: TAU_P, relDev: NaN, pass: v.a6_c3_pass },
    { fs, quantity: 'a6 positive control rho_p (unfiltered mix)', measured: rhoPositive, se: pos.re.se / a4.mean, expected: 1, relDev: rel(rhoPositive, 1), pass: v.a6_positiveControl_pass },
    { fs, quantity: 'a6 negative illustration |mean y^2| / E|y|^2 (not a test)', measured: Math.hypot(plain.re.mean, plain.im.mean) / a5.mean, se: NaN, expected: NaN, relDev: NaN, pass: 'n/a' },
    { fs, quantity: "a6 Var(I') - Var(Q') (= Re C_p)", measured: varI.mean - varQ.mean, se: Math.hypot(varI.se, varQ.se), expected: cpRe.mean, relDev: NaN, pass: 'identity' },
    { fs, quantity: "a6 2 Cov(I',Q') (= Im C_p)", measured: 2 * covIQ.mean, se: 2 * covIQ.se, expected: cpIm.mean, relDev: NaN, pass: 'identity' },
    { fs, quantity: 'a6 identity max per-seed gap (code check)', measured: identityGap, se: 0, expected: 0, relDev: NaN, pass: identityGap < 1e-9 },
    { fs, quantity: 'sensitivity E|y|^2 (5 N_taps exclusion), criterion |diff| <= 1 SE', measured: a5B.mean, se: a5.se, expected: a5.mean, relDev: rel(a5B.mean, a5.mean), pass: Math.abs(a5B.mean - a5.mean) <= a5.se },
    { fs, quantity: 'sensitivity Re C_p (5 N_taps exclusion), criterion |diff| <= 1 SE', measured: cpReB.mean, se: cpRe.se, expected: cpRe.mean, relDev: NaN, pass: Math.abs(cpReB.mean - cpRe.mean) <= cpRe.se },
    { fs, quantity: 'sensitivity Im C_p (5 N_taps exclusion), criterion |diff| <= 1 SE', measured: cpImB.mean, se: cpIm.se, expected: cpIm.mean, relDev: NaN, pass: Math.abs(cpImB.mean - cpIm.mean) <= cpIm.se },
    ...toneRows.map((t) => ({ fs, quantity: `a7 tone ${t.f} Hz power vs A^2/4 (passband gain ${t.passbandGainDb.toFixed(4)} dB, image att ${t.imageAttDb.toFixed(1)} dB)`, measured: t.measured, se: 0, expected: t.expected, relDev: t.relDev, pass: Math.abs(t.relDev) <= 0.01 })),
  );
  console.log(`fs=${fs} done (${Math.round(performance.now() - t0)} ms)`);
}

const nStreams = streams.assertUniqueSeeds();
writeCsv('e3a-noise-chain', rows);
writeMeta('e3a-noise-chain', {
  experiment: 'E3a noise and level chain',
  filter: FILTER,
  parameters: { rates: RATES, seeds: M, samplesPerSeed: N, sigma2: SIGMA2, tauP: TAU_P, toneAmplitude: A_TONE, mixHz: MIX },
  rng: streams.toJSON(),
  verdicts,
  scope: 'Properness is measured at zero lag only (pseudo-variance). Not generalised to other lags.',
  runtimeMs: Math.round(performance.now() - t0),
});

console.log(`E3a noise chain (simulation), filter ${FILTER.convention}/${FILTER.window}, ${nStreams} unique streams`);
for (const r of rows) {
  const fmt = (x) => (typeof x === 'number' ? (Number.isNaN(x) ? '-' : x.toPrecision(6)) : String(x));
  console.log(`${String(r.fs).padStart(5)}  ${r.quantity.padEnd(78)} meas ${fmt(r.measured).padStart(12)} se ${fmt(r.se).padStart(11)} exp ${fmt(r.expected).padStart(12)} rel ${fmt(r.relDev).padStart(12)}  ${r.pass}`);
}
console.log('Verdicts:', JSON.stringify(verdicts));
console.log(`Runtime ${Math.round(performance.now() - t0)} ms`);
