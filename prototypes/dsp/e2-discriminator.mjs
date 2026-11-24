// E2: discriminator accuracy and time alignment (clean signals).
//
// Seed: none (deterministic). Expected runtime: under a minute.
// Run: node prototypes/dsp/e2-discriminator.mjs
//
// Chain (design.md, Discriminator): complex mix at 1800 Hz (gain 1), low-pass from
// results/e1-selected.json, decimation D = max(1, floor(fs / 16000)) (output every D-th input),
// f[m] = mixHz + arg(z[m] conj z[m-1]) fs_d / 2 pi.
// 1) RMS frequency error for clean tones 1000 to 2500 Hz in 100 Hz steps at the 8 rates of M1,
//    measured after the filter transient. Target (requirement 5.2): <= 15 Hz; aim <= 8 Hz.
// 2) Alignment on a phase-continuous frequency step 1300 -> 2100 Hz: time where the estimate
//    crosses the midpoint 1700 Hz, minus the true step time, after compensation.
//    Two compensations are reported: (a) group delay only, (L - 1) / 2 input samples (design.md);
//    (b) group delay plus the half output interval D / 2 of the phase difference.
//    Target (requirement 5.3): |error| <= 1 input sample.
// The true step time: sample n gets phase increment 2 pi f_n / fs; the first sample with the new
// frequency is n0, so the increment changes over the interval (n0 - 1, n0): t* = n0 - 0.5.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS, SAMPLE_RATES, V23, designLowpass, forwardDecimation, writeCsv, writeMeta } from './lib.mjs';

const t0 = performance.now();
const selPath = join(RESULTS, 'e1-selected.json');
const sel = existsSync(selPath) ? JSON.parse(readFileSync(selPath, 'utf8')).selected : null;
const FILTER = sel ?? { window: 'hamming', convention: 'c1', cutoffHz: 1100, transitionHz: 400 };
const MIX = V23.forward.mixHz;
const A = 0.5;

/** Discriminator over a real signal; returns { t: input-sample time of each output, f }. */
function discriminate(x, fs, h, D) {
  const L = h.length;
  const br = new Float64Array(2 * L);
  const bi = new Float64Array(2 * L);
  let pos = 0;
  const dphi = (2 * Math.PI * MIX) / fs;
  const fsd = fs / D;
  const outT = [];
  const outF = [];
  let prevRe = NaN;
  let prevIm = NaN;
  let phaseD = 0;
  for (let n = 0; n < x.length; n++) {
    const th = dphi * n;
    const vr = x[n] * Math.cos(th);
    const vi = -x[n] * Math.sin(th);
    br[pos] = vr; br[pos + L] = vr;
    bi[pos] = vi; bi[pos + L] = vi;
    const base = pos + L;
    pos = pos + 1 === L ? 0 : pos + 1;
    if (++phaseD < D) continue;
    phaseD = 0;
    let yr = 0;
    let yi = 0;
    for (let k = 0; k < L; k++) { yr += h[k] * br[base - k]; yi += h[k] * bi[base - k]; }
    if (!Number.isNaN(prevRe) && n >= L - 1 + D) {
      const re = yr * prevRe + yi * prevIm;
      const im = yi * prevRe - yr * prevIm;
      outT.push(n);
      outF.push(MIX + (Math.atan2(im, re) * fsd) / (2 * Math.PI));
    }
    prevRe = yr;
    prevIm = yi;
  }
  return { t: outT, f: outF };
}

function tone(fs, f, n) {
  const x = new Float64Array(n);
  let ph = 0.3;
  for (let i = 0; i < n; i++) { x[i] = A * Math.sin(ph); ph += (2 * Math.PI * f) / fs; }
  return x;
}

const rmsRows = [];
const alignRows = [];
for (const fs of SAMPLE_RATES) {
  const h = designLowpass({ fs, cutoffHz: FILTER.cutoffHz, transitionHz: FILTER.transitionHz, window: FILTER.window });
  const L = h.length;
  const D = forwardDecimation(fs);
  // 1) RMS error on clean tones, 0.5 s after the transient
  let worst = 0;
  for (let f = 1000; f <= 2500; f += 100) {
    const n = L + Math.round(0.5 * fs) + 4 * D;
    const { f: est } = discriminate(tone(fs, f, n), fs, h, D);
    let se = 0;
    let maxAbs = 0;
    for (const v of est) { se += (v - f) ** 2; maxAbs = Math.max(maxAbs, Math.abs(v - f)); }
    const rms = Math.sqrt(se / est.length);
    worst = Math.max(worst, rms);
    rmsRows.push({ fs, toneHz: f, taps: L, decimation: D, rmsErrorHz: rms, maxAbsErrorHz: maxAbs, outputs: est.length, pass15: rms <= 15, pass8: rms <= 8 });
  }
  // 2) Alignment on a frequency step at several sub-sample positions of the step
  for (const frac of [0, 0.25, 0.5, 0.75]) {
    const n0 = L + 4 * D + Math.round(0.05 * fs) + Math.round(frac * D); // first sample at 2100 Hz
    const n = n0 + L + Math.round(0.05 * fs);
    const x = new Float64Array(n);
    let ph = 0.3;
    for (let i = 0; i < n; i++) {
      const f = i < n0 ? V23.forward.markHz : V23.forward.spaceHz;
      if (i > 0) ph += (2 * Math.PI * f) / fs;
      x[i] = A * Math.sin(ph);
    }
    const { t, f } = discriminate(x, fs, h, D);
    const thr = V23.forward.thresholdHz;
    let cross = NaN;
    for (let i = 1; i < f.length; i++) {
      if (f[i - 1] < thr && f[i] >= thr) {
        const a = (thr - f[i - 1]) / (f[i] - f[i - 1]);
        cross = t[i - 1] + a * (t[i] - t[i - 1]);
        break;
      }
    }
    const tTrue = n0 - 0.5;
    const gd = (L - 1) / 2;
    const errGroupDelayOnly = cross - gd - tTrue;
    const errWithHalfOutput = cross - gd - D / 2 - tTrue;
    alignRows.push({
      fs, taps: L, decimation: D, stepFraction: frac,
      errGroupDelayOnlySamples: errGroupDelayOnly,
      errGroupDelayPlusHalfOutputSamples: errWithHalfOutput,
      passGroupDelayOnly: Math.abs(errGroupDelayOnly) <= 1,
      passWithHalfOutput: Math.abs(errWithHalfOutput) <= 1,
    });
  }
  console.log(`fs=${fs}: worst RMS ${worst.toFixed(3)} Hz`);
}

writeCsv('e2-discriminator-rms', rmsRows);
writeCsv('e2-discriminator-alignment', alignRows);
writeMeta('e2-discriminator', {
  experiment: 'E2 discriminator accuracy and alignment (clean)',
  seeds: 'none (deterministic)',
  filter: FILTER,
  parameters: { tonesHz: '1000..2500 step 100', amplitude: A, step: '1300 -> 2100 Hz, phase continuous', crossingHz: V23.forward.thresholdHz },
  runtimeMs: Math.round(performance.now() - t0),
});

const worstRms = Math.max(...rmsRows.map((r) => r.rmsErrorHz));
const worstAlignA = Math.max(...alignRows.map((r) => Math.abs(r.errGroupDelayOnlySamples)));
const worstAlignB = Math.max(...alignRows.map((r) => Math.abs(r.errGroupDelayPlusHalfOutputSamples)));
console.log(`E2 (simulation), filter ${FILTER.convention}/${FILTER.window}`);
console.log(`Worst RMS error over tones 1000-2500 Hz and 8 rates: ${worstRms.toFixed(3)} Hz (target <= 15, aim <= 8)`);
console.log('Alignment error [input samples], worst over step positions:');
for (const fs of SAMPLE_RATES) {
  const rs = alignRows.filter((r) => r.fs === fs);
  const a = Math.max(...rs.map((r) => Math.abs(r.errGroupDelayOnlySamples)));
  const b = Math.max(...rs.map((r) => Math.abs(r.errGroupDelayPlusHalfOutputSamples)));
  console.log(`  fs=${String(fs).padStart(5)} D=${rs[0].decimation}: group delay only ${a.toFixed(3)}, group delay + D/2 ${b.toFixed(3)}`);
}
console.log(`Worst: group delay only ${worstAlignA.toFixed(3)} samples; with D/2 ${worstAlignB.toFixed(3)} samples (target <= 1)`);
console.log(`Runtime ${Math.round(performance.now() - t0)} ms`);
