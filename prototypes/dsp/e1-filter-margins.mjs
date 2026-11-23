// E1: filter margins of the forward complex low-pass.
//
// Seed: none (deterministic). Expected runtime: a few seconds.
// Run: node prototypes/dsp/e1-filter-margins.mjs
//
// For every sampling rate of M1, every window (Hamming, Blackman, Kaiser beta 6 and 8) and every
// cutoff convention, designs the windowed-sinc low-pass and evaluates its magnitude response.
// Baseband positions (real tone f seen from the 1800 Hz mixer sits at f - 1800):
//   -1380 Hz  420 Hz (backward channel centre)     -1350 / -1410 Hz  450 / 390 Hz (backward tones)
//   -1750 / -1850 Hz  50 Hz mains hum (both images)
//   -900, -500, +300, +700, +800 Hz  tone positions (mark -400 Hz offset, mark, space,
//   space +400 Hz offset, space +500 Hz offset)
// Pre-registered decision rule: stopband attenuation >= 46 dB for every |f| >= 1380 Hz and
// passband ripple <= 0.5 dB over [-950, +850] Hz, at all 8 rates.
// Spec check (requirement 5.1, tasks 5.3): attenuation >= 40 dB at 420 Hz and 50 Hz.
// Result: results/e1-filter-margins.csv, results/e1-summary.json, results/e1-selected.json.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RESULTS, SAMPLE_RATES, V23, designLowpass, dtft, forwardDecimation, magnitudeGrid, noiseBandwidthHz,
  toDb, writeCsv, writeMeta,
} from './lib.mjs';

const t0 = performance.now();
const WINDOWS = ['hamming', 'blackman', 'kaiser6', 'kaiser8'];
const CONVENTIONS = [
  { id: 'c1', label: '-6 dB point 1100 Hz, transition 400 Hz (spec, reading A)', cutoffHz: 1100, transitionHz: 400 },
  { id: 'c2', label: '-6 dB point 1150 Hz, transition 300 Hz', cutoffHz: 1150, transitionHz: 300 },
  { id: 'c3', label: 'passband edge 1100 Hz, transition 400 Hz (spec, reading B)', cutoffHz: 1300, transitionHz: 400 },
];
const MIX = V23.forward.mixHz;
const POINTS_ATT = { att420: 420 - MIX, att450: 450 - MIX, att390: 390 - MIX, att50a: 50 - MIX, att50b: -50 - MIX };
const POINTS_GAIN = { gainMarkMinus400: -900, gainMark: V23.forward.markHz - MIX, gainSpace: V23.forward.spaceHz - MIX, gainSpacePlus400: 700, gainSpacePlus500: 800 };
const STOP_FROM_HZ = 1380;
const RIPPLE_NEG_HZ = 950; // interval [-950, +850]; |H| is even, so |f| <= 950 covers it
const BACKWARD_BAND = [300 - MIX, 540 - MIX]; // -1500 .. -1260 Hz

const rows = [];
for (const fs of SAMPLE_RATES) {
  for (const conv of CONVENTIONS) {
    for (const window of WINDOWS) {
      const h = designLowpass({ fs, cutoffHz: conv.cutoffHz, transitionHz: conv.transitionHz, window });
      const grid = magnitudeGrid(h, fs, 2);
      let minStopAttDb = Infinity;
      let worstStopHz = NaN;
      let rippleDb = 0;
      let minBackwardAttDb = Infinity;
      for (let i = 0; i < grid.freqHz.length; i++) {
        const f = grid.freqHz[i];
        const db = toDb(grid.mag[i]);
        if (f >= STOP_FROM_HZ && -db < minStopAttDb) { minStopAttDb = -db; worstStopHz = f; }
        if (f <= RIPPLE_NEG_HZ) rippleDb = Math.max(rippleDb, Math.abs(db));
        if (f >= -BACKWARD_BAND[1] && f <= -BACKWARD_BAND[0]) minBackwardAttDb = Math.min(minBackwardAttDb, -db);
      }
      // exact values at the interval edges
      const edgeStop = -toDb(dtft(h, fs, STOP_FROM_HZ).mag);
      if (edgeStop < minStopAttDb) { minStopAttDb = edgeStop; worstStopHz = STOP_FROM_HZ; }
      rippleDb = Math.max(rippleDb, Math.abs(toDb(dtft(h, fs, RIPPLE_NEG_HZ).mag)), Math.abs(toDb(dtft(h, fs, 850).mag)));
      minBackwardAttDb = Math.min(minBackwardAttDb, -toDb(dtft(h, fs, BACKWARD_BAND[1]).mag));

      const row = {
        fs, convention: conv.id, window, taps: h.length,
        groupDelaySamples: (h.length - 1) / 2,
        groupDelayMs: (((h.length - 1) / 2) / fs) * 1000,
        noiseBandwidthHz: noiseBandwidthHz(h, fs),
        decimation: forwardDecimation(fs),
        macPerSecond: Math.round((fs / forwardDecimation(fs)) * h.length * 2),
      };
      for (const [k, f] of Object.entries(POINTS_ATT)) row[`${k}Db`] = -toDb(dtft(h, fs, f).mag);
      for (const [k, f] of Object.entries(POINTS_GAIN)) row[`${k}Db`] = toDb(dtft(h, fs, f).mag);
      row.minStopAttDb = minStopAttDb;
      row.worstStopHz = worstStopHz;
      row.rippleDb = rippleDb;
      row.minBackwardBandAttDb = minBackwardAttDb;
      row.pass46 = minStopAttDb >= 46;
      row.passRipple = rippleDb <= 0.5;
      row.spec40at420and50 = row.att420Db >= 40 && row.att50aDb >= 40 && row.att50bDb >= 40;
      row.spec40backwardBand = minBackwardAttDb >= 40;
      rows.push(row);
    }
  }
}

// Aggregate per (convention, window) over the 8 rates.
const summary = [];
for (const conv of CONVENTIONS) {
  for (const window of WINDOWS) {
    const rs = rows.filter((r) => r.convention === conv.id && r.window === window);
    const r48 = rs.find((r) => r.fs === 48000);
    summary.push({
      convention: conv.id, conventionLabel: conv.label, window,
      allRatesPass46: rs.every((r) => r.pass46),
      allRatesPassRipple: rs.every((r) => r.passRipple),
      allRatesSpec40at420and50: rs.every((r) => r.spec40at420and50),
      allRatesSpec40backwardBand: rs.every((r) => r.spec40backwardBand),
      worstMinStopAttDb: Math.min(...rs.map((r) => r.minStopAttDb)),
      worstRippleDb: Math.max(...rs.map((r) => r.rippleDb)),
      worstAtt420Db: Math.min(...rs.map((r) => r.att420Db)),
      worstMinBackwardBandAttDb: Math.min(...rs.map((r) => r.minBackwardBandAttDb)),
      worstGainMarkMinus400Db: Math.min(...rs.map((r) => r.gainMarkMinus400Db)),
      taps48k: r48.taps, noiseBandwidthHz48k: r48.noiseBandwidthHz, macPerSecond48k: r48.macPerSecond,
      taps96k: rs.find((r) => r.fs === 96000).taps,
    });
  }
}
const passing = summary.filter((s) => s.allRatesPass46 && s.allRatesPassRipple).sort((a, b) => a.taps48k - b.taps48k);
const selected = passing[0] ?? null;
const specHamming = summary.filter((s) => s.window === 'hamming' && (s.convention === 'c1' || s.convention === 'c3'));

writeCsv('e1-filter-margins', rows);
writeFileSync(join(RESULTS, 'e1-summary.json'), JSON.stringify({ summary, passingCandidates: passing.map((s) => `${s.convention}/${s.window}`) }, null, 2) + '\n');
writeFileSync(
  join(RESULTS, 'e1-selected.json'),
  JSON.stringify(
    {
      status: 'Prototype result (E1), simulation only. Candidate filter for J3-1; final choice is decision U2.',
      rule: 'cheapest candidate (taps at 48 kHz) meeting >= 46 dB for |f| >= 1380 Hz and ripple <= 0.5 dB over [-950, 850] Hz at all 8 rates',
      selected: selected && {
        window: selected.window,
        convention: selected.convention,
        cutoffHz: CONVENTIONS.find((c) => c.id === selected.convention).cutoffHz,
        transitionHz: CONVENTIONS.find((c) => c.id === selected.convention).transitionHz,
      },
    },
    null,
    2,
  ) + '\n',
);
writeMeta('e1-filter-margins', {
  experiment: 'E1 filter margins',
  seeds: 'none (deterministic)',
  parameters: { sampleRates: SAMPLE_RATES, windows: WINDOWS, conventions: CONVENTIONS, stopFromHz: STOP_FROM_HZ, rippleInterval: [-950, 850], gridStepHzMax: 2 },
  runtimeMs: Math.round(performance.now() - t0),
});

console.log('E1 filter margins (simulation). Worst case over the 8 sampling rates:');
console.log('conv window    taps48k  Bn48k[Hz]  minStop[dB]  ripple[dB]  att420[dB]  backwardBandMin[dB]  gain(-900)[dB]  pass46 ripple spec40(420,50) spec40(backward band)');
for (const s of summary) {
  console.log(
    `${s.convention}   ${s.window.padEnd(9)} ${String(s.taps48k).padStart(6)}  ${s.noiseBandwidthHz48k.toFixed(1).padStart(9)}  ${s.worstMinStopAttDb.toFixed(1).padStart(11)}  ${s.worstRippleDb.toFixed(3).padStart(10)}  ${s.worstAtt420Db.toFixed(1).padStart(10)}  ${s.worstMinBackwardBandAttDb.toFixed(1).padStart(19)}  ${s.worstGainMarkMinus400Db.toFixed(2).padStart(14)}  ${String(s.allRatesPass46).padEnd(6)} ${String(s.allRatesPassRipple).padEnd(6)} ${String(s.allRatesSpec40at420and50).padEnd(15)} ${s.allRatesSpec40backwardBand}`,
  );
}
console.log(`Spec filter (Hamming, 1100 Hz, 400 Hz): reading A (c1) worst att at 420 Hz = ${specHamming[0].worstAtt420Db.toFixed(1)} dB; reading B (c3) = ${specHamming[1].worstAtt420Db.toFixed(1)} dB.`);
console.log(`Selected candidate: ${selected ? `${selected.convention}/${selected.window} (${selected.taps48k} taps at 48 kHz)` : 'none meets the pre-registered rule'}`);
console.log(`Runtime ${Math.round(performance.now() - t0)} ms`);
