// Performance benchmark of the modem (requirements 13.1 and 13.2, tasks.md task 13, tech.md
// "Performance budget"). Run with `npx tsx scripts/bench-modem.ts`; exits with code 1 when a
// budget is missed. Results are recorded in docs/calibration.md "Performance".
//
// - Demodulator: 60 s of 48 kHz PN9 traffic with noise (gamma_3k = 20 dB), pushed in 100 ms
//   chunks (the line engine's block) and in 128-sample chunks (an AudioWorklet quantum).
//   Budget: 3.6 s for 60 s, i.e. 60 ms per second of audio (requirement 13.1).
// - Receive pipeline: the same, plus Videotex decoding of every character (tech.md: 100 ms per
//   second of 48 kHz audio).
// - Modulator: a page of 1 000 characters at 48 kHz. Budget: 50 ms (requirement 13.2).
// Every figure is the median of REPEATS runs after one warm-up run.
import { performance } from 'node:perf_hooks';
import { CHANNELS, FRAME, applyChannel, createDemodulator, modulate, pn9Frames } from '../src/modem';
import { createVideotexDecoder } from '../src/videotex/decoder';

const REPEATS = 5;
const SECONDS = 60;
const DEMOD_BUDGET_MS_PER_S = 60;
const PIPELINE_BUDGET_MS_PER_S = 100;
const MODULATOR_BUDGET_MS = 50;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function signal(fs: number): Float32Array {
  // baud / 10 frames per second; the 100 ms lead and 50 ms tail add 0.15 s.
  const framesPerS = CHANNELS.forward.baud / FRAME.bitsPerFrame;
  const m = modulate(pn9Frames(Math.round((SECONDS - 0.15) * framesPerS)), { sampleRate: fs });
  if (!m.ok) throw new Error(JSON.stringify(m.error));
  const y = applyChannel(m.value, { sampleRate: fs, seed: 1, noise: { kind: 'snr3k', db: 20 } });
  if (!y.ok) throw new Error(JSON.stringify(y.error));
  return y.value;
}

/** Wall time of one streaming run, and the number of characters decoded. */
function runOnce(x: Float32Array, fs: number, chunk: number, videotex: boolean): { ms: number; chars: number } {
  const d = createDemodulator({ sampleRate: fs });
  if (!d.ok) throw new Error(JSON.stringify(d.error));
  const vtx = videotex ? createVideotexDecoder() : null;
  let chars = 0;
  const t0 = performance.now();
  for (let pos = 0; pos < x.length; pos += chunk) {
    for (const e of d.value.push(x.subarray(pos, Math.min(x.length, pos + chunk)))) {
      if (e.type !== 'char') continue;
      chars++;
      vtx?.push({ value: e.value, error: !e.parityOk || !e.framingOk });
    }
  }
  for (const e of d.value.flush()) if (e.type === 'char') chars++;
  return { ms: performance.now() - t0, chars };
}

function bench(x: Float32Array, fs: number, chunk: number, videotex: boolean): { msPerS: number; chars: number } {
  runOnce(x, fs, chunk, videotex); // warm-up (JIT)
  const times: number[] = [];
  let chars = 0;
  for (let i = 0; i < REPEATS; i++) {
    const r = runOnce(x, fs, chunk, videotex);
    times.push(r.ms);
    chars = r.chars;
  }
  return { msPerS: median(times) / (x.length / fs), chars };
}

let failed = false;
const check = (ok: boolean): string => {
  if (!ok) failed = true;
  return ok ? 'pass' : 'FAIL';
};

console.log(`Node ${process.version}, ${process.platform} ${process.arch}; median of ${REPEATS} runs after a warm-up`);
console.log('\n| fs | chunk | demodulator (ms per s of audio) | x real time | + Videotex (ms per s) | chars |');
console.log('|---|---|---|---|---|---|');
for (const fs of [48000, 44100, 96000]) {
  const x = signal(fs);
  for (const chunk of [Math.round(0.1 * fs), 128]) {
    const demod = bench(x, fs, chunk, false);
    const pipe = bench(x, fs, chunk, true);
    const budget = fs === 48000;
    const d = `${demod.msPerS.toFixed(1)}${budget ? ` (${check(demod.msPerS < DEMOD_BUDGET_MS_PER_S)})` : ''}`;
    const p = `${pipe.msPerS.toFixed(1)}${budget ? ` (${check(pipe.msPerS < PIPELINE_BUDGET_MS_PER_S)})` : ''}`;
    console.log(`| ${fs} | ${chunk} | ${d} | ${(1000 / demod.msPerS).toFixed(0)} | ${p} | ${demod.chars} |`);
  }
}
console.log(`\nBudgets at 48 kHz: demodulator < ${DEMOD_BUDGET_MS_PER_S} ms per s (60 s in < ${(DEMOD_BUDGET_MS_PER_S * SECONDS) / 1000} s), pipeline < ${PIPELINE_BUDGET_MS_PER_S} ms per s.`);

const page = Uint8Array.from({ length: 1000 }, (_, i) => 0x20 + (i % 95));
const modTimes: number[] = [];
for (let i = 0; i <= 20; i++) {
  const t0 = performance.now();
  const m = modulate(page, { sampleRate: 48000 });
  const ms = performance.now() - t0;
  if (!m.ok) throw new Error(JSON.stringify(m.error));
  if (i > 0) modTimes.push(ms); // run 0 is the warm-up
}
const modMs = median(modTimes);
const pageSeconds = (page.length * FRAME.bitsPerFrame) / CHANNELS.forward.baud + 0.15;
console.log(`\nModulator, 1 000 characters at 48 kHz (${pageSeconds.toFixed(2)} s of audio): ${modMs.toFixed(2)} ms, median of 20 (${check(modMs < MODULATOR_BUDGET_MS)}, budget ${MODULATOR_BUDGET_MS} ms)`);

if (failed) {
  console.log('\nA budget is missed.');
  process.exitCode = 1;
}
