// E7: micro-benchmark of the forward mixer + polyphase decimating FIR.
//
// Seed: stream key "E7|role=input" (input content does not affect the timing).
// Parameters: E1 candidates passing the pre-registered rule; fs in {8000, 44100, 48000, 96000};
//             10 s of audio per run, 1 warm-up run, median of 5 runs.
// Target (hypothesis): <= 40 ms of CPU per second of audio at 48 kHz.
// Expected runtime: about 1 minute. Run it alone (no other heavy process) for meaningful timings.
// Run: node prototypes/dsp/e7-perf.mjs
//
// The kernel is representative of the production design (design.md, Discriminator): double-precision
// phase accumulator, complex mix, circular buffer, and the FIR output computed only every D-th
// input sample (polyphase cost), plus the phase-difference frequency estimate on each output.
// It is a Node measurement on the developer machine, not on the spec's mid-range laptop.

import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { RESULTS, StreamRegistry, V23, designLowpass, forwardDecimation, writeCsv, writeMeta } from './lib.mjs';

const t0 = performance.now();
const RATES = [8000, 44100, 48000, 96000];
const SECONDS = 10;
const RUNS = 5;
const TARGET_MS_PER_S_48K = 40;
const summary = JSON.parse(readFileSync(join(RESULTS, 'e1-summary.json'), 'utf8'));
const CONV = { c1: { cutoffHz: 1100, transitionHz: 400 }, c2: { cutoffHz: 1150, transitionHz: 300 }, c3: { cutoffHz: 1300, transitionHz: 400 } };
const candidates = summary.passingCandidates.map((s) => {
  const [convention, window] = s.split('/');
  return { convention, window, ...CONV[convention] };
});

const streams = new StreamRegistry('E7|role=input');
const rng = streams.stream('E7|role=input');

function kernel(x, fs, h, D) {
  const L = h.length;
  const br = new Float64Array(2 * L);
  const bi = new Float64Array(2 * L);
  let pos = 0;
  let phase = 0;
  const dphi = (2 * Math.PI * V23.forward.mixHz) / fs;
  const fsd = fs / D;
  let prevRe = 1;
  let prevIm = 0;
  let acc = 0;
  let phaseD = 0;
  for (let n = 0; n < x.length; n++) {
    const xv = x[n];
    const vr = xv * Math.cos(phase);
    const vi = -xv * Math.sin(phase);
    phase += dphi;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    br[pos] = vr; br[pos + L] = vr;
    bi[pos] = vi; bi[pos + L] = vi;
    const base = pos + L;
    pos = pos + 1 === L ? 0 : pos + 1;
    if (++phaseD < D) continue;
    phaseD = 0;
    let yr = 0;
    let yi = 0;
    for (let k = 0; k < L; k++) {
      const hk = h[k];
      yr += hk * br[base - k];
      yi += hk * bi[base - k];
    }
    // f = mix + arg(z[m] conj z[m-1]) fs_d / 2 pi
    const re = yr * prevRe + yi * prevIm;
    const im = yi * prevRe - yr * prevIm;
    acc += V23.forward.mixHz + (Math.atan2(im, re) * fsd) / (2 * Math.PI);
    prevRe = yr;
    prevIm = yi;
  }
  return acc;
}

const rows = [];
let sink = 0;
for (const c of candidates) {
  for (const fs of RATES) {
    const h = designLowpass({ fs, cutoffHz: c.cutoffHz, transitionHz: c.transitionHz, window: c.window });
    const D = forwardDecimation(fs);
    const x = new Float32Array(fs * SECONDS);
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1300 * i) / fs) + 0.05 * rng.normal();
    sink += kernel(x, fs, h, D); // warm-up
    const times = [];
    for (let r = 0; r < RUNS; r++) {
      const a = performance.now();
      sink += kernel(x, fs, h, D);
      times.push(performance.now() - a);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(RUNS / 2)];
    rows.push({
      convention: c.convention, window: c.window, fs, taps: h.length, decimation: D,
      msPerSecondOfAudio: median / SECONDS,
      minMsPerSecond: times[0] / SECONDS, maxMsPerSecond: times[RUNS - 1] / SECONDS,
      realTimeFactor: 1000 / (median / SECONDS),
    });
  }
}

writeCsv('e7-perf', rows);
writeMeta('e7-perf', {
  experiment: 'E7 mixer + polyphase FIR + frequency estimate benchmark',
  machine: { cpu: cpus()[0]?.model ?? 'unknown', logicalCores: cpus().length, platform: process.platform },
  caveat: 'Developer machine, single Node thread. Not the mid-range laptop of the spec.',
  parameters: { rates: RATES, secondsPerRun: SECONDS, runs: RUNS, warmup: 1, targetMsPerSecondAt48k: TARGET_MS_PER_S_48K },
  rng: streams.toJSON(),
  runtimeMs: Math.round(performance.now() - t0),
});

console.log(`E7 (simulation, developer machine: ${cpus()[0]?.model ?? 'unknown'})`);
console.log('conv window    fs     taps  D  ms/s(median)  min   max   x real time');
for (const r of rows) {
  console.log(`${r.convention}   ${r.window.padEnd(9)} ${String(r.fs).padStart(5)} ${String(r.taps).padStart(5)} ${r.decimation}  ${r.msPerSecondOfAudio.toFixed(2).padStart(10)}  ${r.minMsPerSecond.toFixed(2).padStart(5)} ${r.maxMsPerSecond.toFixed(2).padStart(5)} ${r.realTimeFactor.toFixed(0).padStart(6)}`);
}
const r48 = rows.filter((r) => r.fs === 48000);
console.log(`48 kHz within ${TARGET_MS_PER_S_48K} ms/s: ${r48.map((r) => `${r.convention}/${r.window}=${r.msPerSecondOfAudio <= TARGET_MS_PER_S_48K}`).join(', ')}`);
console.log(`(checksum ${sink.toFixed(0)}) Runtime ${Math.round(performance.now() - t0)} ms`);
