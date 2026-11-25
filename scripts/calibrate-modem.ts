// Calibration of the modem targets (design.md "Testing", tasks.md task 12, docs/calibration.md).
// Run with `npx tsx scripts/calibrate-modem.ts`. Deterministic: fixed seeds, same output on every
// run. CAL_SECTIONS=connection,snr,ber,m6 (default: all) selects the sections; M6 takes about
// 40 min, the others a few minutes.
//
// - connection: margins of the connection-sequence defaults against the receiver (requirement 3.2).
// - snr: bias of the quality estimator against the true band SNR (requirement 9.3).
// - ber: BER against Eb/N0 for both threshold modes (design.md "Testing").
// - m6: the Eb/N0 at which BER <= 1e-3 on 20 000 bits for every seed (property M6).
//   M6_FROM_DB=<dB> skips the sweep and checks only that level (to run levels in parallel).
import { CHANNELS, applyChannel, connectionSequence, createDemodulator, modulate, pn9Frames, type DemodEvent } from '../src/modem';
import { CONNECTION_DEFAULTS } from '../src/modem/modulator';
import { designLowpass, noiseBandwidthHz } from '../src/modem/filters';
import { ANSWER_TONE, DISCRIMINATOR } from '../src/modem/v23';
import { chainBer, framesForBits } from '../tests/helpers/modem-ber';

const SECTIONS = new Set((process.env.CAL_SECTIONS ?? 'connection,snr,ber,m6').split(',').map((s) => s.trim()));
const RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000];
const MODES = ['adaptive', 'fixed'] as const;
const fmt = (x: number): string => x.toExponential(2);

function events(x: Float32Array, fs: number, threshold: 'fixed' | 'adaptive'): DemodEvent[] {
  const d = createDemodulator({ sampleRate: fs, threshold });
  if (!d.ok) throw new Error(JSON.stringify(d.error));
  return [...d.value.push(x), ...d.value.flush()];
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Connection sequence

const PAGE = Uint8Array.from('3615 NEOMINITEL'.split('').map((c) => c.charCodeAt(0)));

function page(fs: number): Float32Array {
  const m = modulate(PAGE, { sampleRate: fs });
  if (!m.ok) throw new Error(JSON.stringify(m.error));
  return m.value;
}

/** Sequence + page decodes the page exactly with one connect, in this mode. */
function sequenceThenPageOk(fs: number, o: { answerToneMs?: number; silenceMs?: number; carrierMs?: number }, mode: 'fixed' | 'adaptive', noiseSeed?: number): { ok: boolean; connects: number; extra: number } {
  let x = concat(connectionSequence({ sampleRate: fs, ...o }), page(fs));
  if (noiseSeed !== undefined) {
    const y = applyChannel(x, { sampleRate: fs, seed: noiseSeed, noise: { kind: 'snr3k', db: 20 } });
    if (!y.ok) throw new Error(JSON.stringify(y.error));
    x = y.value;
  }
  const ev = events(x, fs, mode);
  const chars = ev.filter((e) => e.type === 'char').map((e) => (e as { value: number }).value);
  const connects = ev.filter((e) => e.type === 'connect').length;
  // With noise, the carrier stays on in the silence and noise frames may come before the page:
  // the page must be the exact end of the character list.
  const tail = chars.slice(chars.length - PAGE.length);
  const ok = connects === 1 && chars.length >= PAGE.length && tail.every((v, i) => v === PAGE[i]);
  return { ok, connects, extra: chars.length - PAGE.length };
}

function connectionSection(): void {
  console.log(`## Connection sequence (defaults ${JSON.stringify(CONNECTION_DEFAULTS)})`);

  console.log('\n### Defaults, sequence + page, every rate and mode');
  console.log('| fs | adaptive clean | fixed clean | adaptive 20 dB (5 seeds) | fixed 20 dB (5 seeds) |');
  console.log('|---|---|---|---|---|');
  for (const fs of RATES) {
    const cells: string[] = [];
    for (const mode of MODES) cells.push(sequenceThenPageOk(fs, {}, mode).ok ? 'ok' : 'FAIL');
    for (const mode of MODES) {
      let pass = 0;
      let extra = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const r = sequenceThenPageOk(fs, {}, mode, seed);
        if (r.ok) pass++;
        extra += Math.max(0, r.extra);
      }
      cells.push(`${pass}/5 (${extra} noise chars)`);
    }
    console.log(`| ${fs} | ${cells.join(' | ')} |`);
  }

  // Sweep from 50 ms below the detector's nominal duration (500 ms) in 1 ms steps.
  const toneFromMs = ANSWER_TONE.durationMs - 50;
  console.log(`\n### Shortest answer tone giving \`connect\` (clean, every rate, 1 ms steps from ${toneFromMs} ms)`);
  let minTone = NaN;
  for (let ms = toneFromMs; ms <= ANSWER_TONE.durationMs + 100 && Number.isNaN(minTone); ms++) {
    const all = RATES.every((fs) => events(connectionSequence({ sampleRate: fs, answerToneMs: ms }), fs, 'adaptive').some((e) => e.type === 'connect'));
    if (all) minTone = ms;
  }
  console.log(`shortest answer tone detected at every rate: ${minTone} ms (default ${CONNECTION_DEFAULTS.answerToneMs} ms, margin ${CONNECTION_DEFAULTS.answerToneMs - minTone} ms)`);

  console.log('\n### Shortest silence for which the page decodes (clean / 20 dB, every rate, both modes)');
  for (const noisy of [false, true]) {
    let minSilence = NaN;
    for (let ms = 0; ms <= 400 && Number.isNaN(minSilence); ms += 10) {
      const all = RATES.every((fs) => MODES.every((mode) => sequenceThenPageOk(fs, { silenceMs: ms }, mode, noisy ? 1 : undefined).ok));
      if (all) minSilence = ms;
    }
    console.log(`${noisy ? '20 dB (seed 1)' : 'clean'}: ${Number.isNaN(minSilence) ? '> 400' : minSilence} ms (default ${CONNECTION_DEFAULTS.silenceMs} ms)`);
  }

  console.log('\n### Shortest mark carrier giving a `carrier` on after the silence (clean, every rate, 5 ms steps)');
  let minCarrier = NaN;
  for (let ms = 5; ms <= 300 && Number.isNaN(minCarrier); ms += 5) {
    const all = RATES.every((fs) => {
      const x = connectionSequence({ sampleRate: fs, carrierMs: ms });
      const silenceEnd = ((CONNECTION_DEFAULTS.answerToneMs + CONNECTION_DEFAULTS.silenceMs) / 1000) * fs;
      return events(x, fs, 'adaptive').some((e) => e.type === 'carrier' && e.on && e.atSample >= silenceEnd);
    });
    if (all) minCarrier = ms;
  }
  console.log(`shortest carrier detected at every rate: ${minCarrier} ms (default ${CONNECTION_DEFAULTS.carrierMs} ms)`);
}

// ---------------------------------------------------------------------------------------------
// SNR estimator bias (requirement 9.3; same method as M10)

function snrSection(): void {
  console.log('\n## SNR estimator bias (PN9, 300 frames, 10 seeds, estimates with 1 s of moments)');
  console.log('| fs | ' + [0, 5, 10, 15, 20, 25, 30].map((g) => `${g} dB`).join(' | ') + ' |');
  console.log('|---|' + '---|'.repeat(7));
  for (const fs of [8000, 16000, 44100, 48000]) {
    const bn = noiseBandwidthHz(designLowpass(fs, CHANNELS.forward.lowpassHz, DISCRIMINATOR.forward.transitionHz), fs);
    const m = modulate(pn9Frames(300), { sampleRate: fs });
    if (!m.ok) throw new Error('modulate');
    const cells: string[] = [];
    for (const g of [0, 5, 10, 15, 20, 25, 30]) {
      let sum = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const y = applyChannel(m.value, { sampleRate: fs, seed, noise: { kind: 'ebN0', db: g + 10 * Math.log10(bn / CHANNELS.forward.baud) } });
        if (!y.ok) throw new Error('channel');
        const q = events(y.value, fs, 'adaptive').filter((e): e is Extract<DemodEvent, { type: 'quality' }> => e.type === 'quality' && e.atSample >= 1.2 * fs);
        sum += q.reduce((s, e) => s + e.snrBandDb, 0) / q.length;
      }
      const bias = sum / 10 - g;
      cells.push(`${bias >= 0 ? '+' : ''}${bias.toFixed(2)}`);
    }
    console.log(`| ${fs} | ${cells.join(' | ')} |`);
  }
}

// ---------------------------------------------------------------------------------------------
// BER against Eb/N0, both threshold modes

function berSection(): void {
  console.log('\n## BER against Eb/N0, both modes (16 kHz, 5 seeds of >= 20 000 bits, pooled, BerCounter)');
  console.log('| Eb/N0 (dB) | adaptive | fixed |');
  console.log('|---|---|---|');
  const frames = framesForBits(20000);
  for (let db = 8; db <= 18; db++) {
    const cells: string[] = [];
    for (const mode of MODES) {
      let bits = 0;
      let errors = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const s = chainBer({ sampleRate: 16000, ebN0Db: db, seed, frames, threshold: mode });
        bits += s.bits;
        errors += s.errors;
      }
      cells.push(fmt(errors / bits));
    }
    console.log(`| ${db} | ${cells.join(' | ')} |`);
  }
}

// ---------------------------------------------------------------------------------------------
// M6

function m6Section(): void {
  const BITS = 20000;
  const frames = framesForBits(BITS);
  const run = (fs: number, ebN0Db: number, mode: 'fixed' | 'adaptive', seeds: number): { mean: number; worst: number; failing: number; minBits: number } => {
    let sum = 0;
    let worst = 0;
    let failing = 0;
    let minBits = Infinity;
    for (let seed = 1; seed <= seeds; seed++) {
      const s = chainBer({ sampleRate: fs, ebN0Db, seed, frames, threshold: mode });
      sum += s.ber;
      worst = Math.max(worst, s.ber);
      minBits = Math.min(minBits, s.bits);
      if (s.ber > 1e-3 || s.bits < BITS) failing++;
    }
    return { mean: sum / seeds, worst, failing, minBits };
  };
  const fromDb = process.env.M6_FROM_DB !== undefined ? Number(process.env.M6_FROM_DB) : NaN;
  let candidate = fromDb;
  if (Number.isNaN(fromDb)) {
    console.log('\n## M6 sweep (16 kHz, adaptive, seeds 1..20)');
    console.log('| Eb/N0 (dB) | mean BER | worst BER | seeds > 1e-3 | min bits |');
    console.log('|---|---|---|---|---|');
    for (let db = 12; db <= 18.001; db += 0.5) {
      const r = run(16000, db, 'adaptive', 20);
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
      for (const mode of MODES) {
        const r = run(fs, db, mode, 40);
        if (r.failing > 0) allPass = false;
        console.log(`| ${db.toFixed(1)} | ${fs} | ${mode} | ${fmt(r.mean)} | ${fmt(r.worst)} | ${r.failing}/40 |`);
      }
    }
    if (allPass) calibrated = db;
  }
  console.log(`\nM6 calibrated Eb/N0: ${calibrated} dB`);
}

if (SECTIONS.has('connection')) connectionSection();
if (SECTIONS.has('snr')) snrSection();
if (SECTIONS.has('ber')) berSection();
if (SECTIONS.has('m6')) m6Section();
