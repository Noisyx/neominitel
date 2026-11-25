// Streaming demodulator (requirements 3.3, 8.1 to 8.4; design.md "Factory", "Events",
// "Threshold mode", "Carrier and answer tone"). Assembles the discriminator (task 5), the UART
// (task 6) and the carrier and answer-tone detector. The UART and the discriminator stay internal;
// only createDemodulator is exported, from task 7 on (decision T7-8).
import { createDetector } from './carrier';
import { createDiscriminator, type DiscriminatorOutput } from './discriminator';
import { ADAPTIVE_INIT_MS, createThresholdSource, type ThresholdMode, type ThresholdState } from './threshold';
import type { DemodEvent, DemodOptions, ModemError, Result, StreamingDemodulator } from './types';
import { m2m4, parityErrorRate, snrReport } from './quality';
import { createUart, type UartChar } from './uart';
import { CARRIER, CHANNELS, FRAME, QUALITY } from './v23';

/** diag is emitted at most this often (requirement 8.4), on absolute time boundaries (T7-6). */
const DIAG_INTERVAL_S = 0.05;

/** atSample of an event: nearest input-sample index (decision T7-2). */
function atIndex(samples: number): number {
  return Math.max(0, Math.round(samples));
}

/** Order of events that share an atSample: fixed, so it never depends on chunk boundaries. */
const TYPE_RANK: Record<DemodEvent['type'], number> = { carrier: 0, connect: 1, char: 2, quality: 3, diag: 4 };

interface Sample {
  t: number;
  f: number;
  re: number;
  im: number;
}

/**
 * Creates the streaming demodulator.
 *
 * Validation (design.md "Factory" and "Threshold mode"): `bad-sample-rate` when sampleRate is not
 * finite or outside 8 000..96 000 Hz; `bad-option` for an unknown channel, for the backward
 * channel until task 14 (decision T7-7), for a threshold other than 'fixed' or 'adaptive', and for
 * a non-finite carrierOnDbfs. `threshold` defaults to 'adaptive' (task 8, design.md "Threshold");
 * `carrierOnDbfs` defaults to -45 under the D6 reference (decision T7-1).
 *
 * `push` runs the discriminator, the carrier and answer-tone detector, and the UART. The UART
 * receives estimates only while the carrier is on and is reset when the carrier drops, so silence
 * (which the discriminator reads as 1800 Hz, space) cannot invent characters. `diag` is emitted at
 * every absolute 50 ms boundary whether or not the carrier is on. `quality` (task 10) is emitted at
 * every absolute 100 ms boundary B while the carrier is on, from the kurtosis-corrected M2M4
 * moments of the carrier-on estimates of the last second (design.md "Quality"); it is released
 * once the carrier state up to B + 70 ms is known, and dropped when the carrier goes off in that
 * span (its moments may contain the silence before the off decision).
 *
 * Event dates, order and latency (M5): every event is dated in input samples since reset
 * (rounded, decision T7-2) on the compensated time base of the discriminator. Time boundaries
 * (carrier windows, diags) are crossed by estimate time: the discriminator delivers the estimate
 * dated t once input t + (L - 1)/2 + D/2 has been pushed, and a boundary B is crossed when an
 * estimate dated B or later has arrived. A character is known only when its frame is decided,
 * 9.75 bit periods after its start. Events are therefore held and released in (atSample, type)
 * order once no earlier event can still appear: an event dated a is released when an estimate
 * dated a + 9.75 T + D + 0.5 or later has arrived. The concatenation of everything `push` and
 * `flush` return is then the same list for any chunking.
 *
 * `flush` (decision T7-4) feeds the filter internal zeros, not counted as input time and not given
 * to the answer-tone detector, so that it delivers the estimates of the last real samples. Only
 * estimates dated strictly before the end of the real input are kept. flush then closes the
 * carrier windows and diags up to that end, emits the characters completed inside the real input
 * (a frame cut by the end is dropped), forces the carrier off at the end of the input if it was
 * on, emits a final `diag` dated at the end of the input (unless the end is itself a 50 ms
 * boundary), releases every held event, and restarts the discriminator and the detectors. Time
 * continues from the last real sample, on the same absolute grids.
 * `push`, `flush` and `reset` never throw. `setThresholdMode` switches the mode live, keeping the
 * UART position (requirement 7.4).
 */
export function createDemodulator(o: DemodOptions): Result<StreamingDemodulator, ModemError> {
  const channel = o?.channel ?? 'forward';
  const disc = createDiscriminator(o?.sampleRate, channel);
  if (!disc.ok) return disc;
  if (channel !== 'forward') {
    return {
      ok: false,
      error: { kind: 'bad-option', option: 'channel', reason: 'the backward channel is not available before task 14' },
    };
  }
  // From task 8, threshold defaults to 'adaptive'; 'fixed' stays supported (design.md
  // "Threshold mode"). Any other value is a bad option.
  const initialMode: ThresholdMode = o.threshold ?? 'adaptive';
  if (initialMode !== 'fixed' && initialMode !== 'adaptive') {
    return {
      ok: false,
      error: { kind: 'bad-option', option: 'threshold', reason: "must be 'fixed' or 'adaptive'" },
    };
  }
  const carrierOnDbfs = o.carrierOnDbfs ?? CARRIER.onDbfs;
  if (typeof carrierOnDbfs !== 'number' || !Number.isFinite(carrierOnDbfs)) {
    return { ok: false, error: { kind: 'bad-option', option: 'carrierOnDbfs', reason: 'must be a finite number' } };
  }

  const d = disc.value;
  const spec = CHANNELS.forward;
  const detector = createDetector(d.sampleRate, d.decimation, carrierOnDbfs);
  const threshold = createThresholdSource(spec, initialMode);
  const uart = createUart(d, threshold);
  const initSamples = (ADAPTIVE_INIT_MS / 1000) * d.sampleRate;
  const diagEvery = Math.max(1, Math.round(DIAG_INTERVAL_S * d.sampleRate));
  const bitSamples = d.sampleRate / spec.baud;
  const decisionOffset = (FRAME.bitsPerFrame - 1 + 0.75) * bitSamples;
  // An event dated a can no longer be preceded by a later-known event once an estimate dated
  // a + releaseLag has arrived (a char is decided at the first estimate at or after t_e + 9.75 T,
  // and its rounded atSample can be 0.5 below t_e).
  const releaseLag = decisionOffset + d.decimation + 0.5;
  // Zeros fed by flush so that the filter delivers the estimates of the last real samples.
  const flushPad = Math.ceil(d.groupDelaySamples + d.decimation / 2) + 2 * d.decimation;

  let inputCount = 0; // real samples since reset
  let timeOrigin = 0; // input index of the discriminator's sample 0 (moves at each flush)
  let nonFiniteBase = 0; // non-finite samples counted by discriminator runs before the last flush
  let carrierOn = false;
  let nextDiagAt = diagEvery;
  let prevDiagAt = 0; // start of the next diag's interval
  // Every estimate dated before lastEstimateT (inclusive) has been received.
  let lastEstimateT = -Infinity;
  const buffer: Sample[] = []; // settled estimates not yet reported in a diag
  // Frames decided but not yet reported in a diag (requirement 8.4). A frame is reported whole, in
  // the diag whose interval contains its decision time t_e + 9.75 T.
  const frames: { decisionT: number; windows: [number, number][] }[] = [];
  const held: { e: DemodEvent; seq: number }[] = []; // events waiting for release
  let seq = 0;

  // Quality (task 10, design.md "Quality"): moments of z over absolute blocks of intervalMs, summed
  // over the carrier-on blocks of the last averageMs; an estimate at every block end while the
  // carrier is on. A boundary B is crossed at the first estimate dated B or later, in time order
  // with the carrier events, so the result never depends on chunk boundaries.
  const qualityEvery = Math.max(1, Math.round((QUALITY.intervalMs / 1000) * d.sampleRate));
  const qualityBlocks = Math.max(1, Math.round(QUALITY.averageMs / QUALITY.intervalMs));
  const qualityMinEstimates = ((QUALITY.minMs / 1000) * d.sampleRate) / d.decimation;
  let nextQualityAt = qualityEvery;
  let block = { s2: 0, s4: 0, c: 0 }; // block ending at nextQualityAt
  const blockHistory: { s2: number; s4: number; c: number }[] = []; // previous blocks, newest last
  // Estimates crossed but not yet emitted: the parity rate and the offset need every frame decided
  // before B, known at the end of the current consume.
  const pendingQuality: { at: number; s2: number; s4: number; c: number }[] = [];
  const decided: { t: number; parityOk: boolean }[] = []; // frames by decision time

  function clearQualityMoments(): void {
    block = { s2: 0, s4: 0, c: 0 };
    blockHistory.length = 0;
  }

  /** Crosses the quality boundaries B <= t. */
  function crossQuality(t: number): void {
    while (nextQualityAt <= t) {
      if (carrierOn) {
        let s2 = block.s2;
        let s4 = block.s4;
        let c = block.c;
        for (const b of blockHistory) {
          s2 += b.s2;
          s4 += b.s4;
          c += b.c;
        }
        if (c >= qualityMinEstimates) pendingQuality.push({ at: nextQualityAt, s2, s4, c });
      }
      blockHistory.push(block);
      if (blockHistory.length > qualityBlocks - 1) blockHistory.shift();
      block = { s2: 0, s4: 0, c: 0 };
      nextQualityAt += qualityEvery;
    }
  }

  // A carrier off is decided up to offHoldMs + 2 windows after the signal drops. An estimate dated
  // B is kept only once the carrier state up to B + qualityTail is known, and dropped when a
  // carrier off falls in (B, B + qualityTail]: its moments may contain the silence after the drop.
  const qualityTail = ((CARRIER.offHoldMs + 2 * CARRIER.windowMs) / 1000) * d.sampleRate;
  const awaitingQuality: Extract<DemodEvent, { type: 'quality' }>[] = [];
  const carrierOffs: number[] = []; // dates of detected (not forced) carrier off

  /** Computes the crossed estimates (every frame decided before B is known now). */
  function emitQuality(): void {
    for (const q of pendingQuality) {
      const est = m2m4(q.s2 / q.c, q.s4 / q.c, QUALITY.forwardEnvelopeKurtosis);
      awaitingQuality.push({
        type: 'quality',
        atSample: q.at,
        ...snrReport(est.snr, d.noiseBandwidthHz, spec.baud),
        parityErrorRate: parityErrorRate(decided, q.at, QUALITY.parityFrames),
        offsetHz: stateBefore(q.at).markHz - spec.markHz,
      });
    }
    pendingQuality.length = 0;
    let before = 0;
    for (let i = decided.length - 1; i >= 0; i--) if (decided[i].t < nextQualityAt) before++;
    if (before > QUALITY.parityFrames) decided.splice(0, before - QUALITY.parityFrames);
  }

  /** Holds or drops the awaiting estimates whose tail is known (all of them when `final`). */
  function settleQuality(knownUpTo: number, final: boolean): void {
    while (awaitingQuality.length > 0) {
      const q = awaitingQuality[0];
      if (!final && knownUpTo < q.atSample + qualityTail) break;
      awaitingQuality.shift();
      if (!carrierOffs.some((t) => t > q.atSample && t <= q.atSample + qualityTail)) hold(q);
    }
    const keepFrom = awaitingQuality.length > 0 ? awaitingQuality[0].atSample : nextQualityAt - qualityEvery;
    while (carrierOffs.length > 0 && carrierOffs[0] <= keepFrom) carrierOffs.shift();
  }

  /** Held events dated at or after this cannot be released: an estimate dated there is awaited. */
  function releaseCap(): number {
    if (pendingQuality.length > 0) return pendingQuality[0].at;
    return awaitingQuality.length > 0 ? awaitingQuality[0].atSample : Infinity;
  }

  // Adaptive threshold (task 8). After each carrier on, the mean frequency of the estimates dated
  // in [onT, onT + 20 ms) initialises mu_mark (idle carrier is mark), in both modes, so a switch to
  // adaptive can use it. In adaptive mode the UART starts only once that estimate exists; once
  // started it is fed continuously, whatever the mode switches.
  let initStart = NaN; // carrier-on time of the pending initialisation (NaN = none pending)
  let initSum = 0;
  let initCount = 0;
  let uartStarted = false;
  // Threshold states with the time they take effect, for diags (chunk-invariant reporting).
  const stateLog: { t: number; s: ThresholdState }[] = [{ t: -Infinity, s: threshold.state() }];

  function logState(t: number): void {
    stateLog.push({ t, s: threshold.state() });
  }

  /** The threshold state in force just before time `at`. */
  function stateBefore(at: number): ThresholdState {
    let best = 0;
    for (let i = 1; i < stateLog.length; i++) if (stateLog[i].t < at && stateLog[i].t >= stateLog[best].t) best = i;
    return stateLog[best].s;
  }

  /** Drops the states superseded before `at` (keeps the one in force at `at`). */
  function pruneStates(at: number): void {
    let best = 0;
    for (let i = 1; i < stateLog.length; i++) if (stateLog[i].t < at && stateLog[i].t >= stateLog[best].t) best = i;
    const base = stateLog[best];
    const rest = stateLog.filter((e, i) => i !== best && e.t >= at);
    stateLog.length = 0;
    stateLog.push({ t: -Infinity, s: base.s }, ...rest);
  }

  function clearThreshold(at: number): void {
    threshold.clear();
    initStart = NaN;
    initSum = 0;
    initCount = 0;
    uartStarted = false;
    logState(at);
  }

  function hold(e: DemodEvent): void {
    held.push({ e, seq: seq++ });
  }

  /** Releases, in (atSample, type) order, the held events that nothing earlier can precede. */
  function release(horizon: number): DemodEvent[] {
    held.sort((a, b) => a.e.atSample - b.e.atSample || TYPE_RANK[a.e.type] - TYPE_RANK[b.e.type] || a.seq - b.seq);
    const cap = releaseCap();
    let n = 0;
    while (n < held.length && held[n].e.atSample + releaseLag <= horizon && held[n].e.atSample < cap) n++;
    return held.splice(0, n).map((h) => h.e);
  }

  function nonFiniteCount(): number {
    return nonFiniteBase + d.nonFiniteCount;
  }

  /** Settled estimates of one discriminator output, on the input time base, dated before `limit`. */
  function take(out: DiscriminatorOutput, limit: number): Sample[] {
    const samples: Sample[] = [];
    for (let m = 0; m < out.count; m++) {
      const local = out.firstTimeSamples + m * d.decimation;
      if (local < d.settledTimeSamples) continue;
      const t = timeOrigin + local;
      if (t >= limit) continue;
      const s = { t, f: out.freqHz[m], re: out.re[m], im: out.im[m] };
      samples.push(s);
      buffer.push(s);
      lastEstimateT = t;
    }
    return samples;
  }

  function noteChars(chars: readonly UartChar[]): void {
    for (const c of chars) {
      const windows: [number, number][] = [];
      for (let i = 0; i < FRAME.bitsPerFrame; i++) {
        windows.push([c.atSample + i * bitSamples, c.atSample + (i + 1) * bitSamples]);
      }
      frames.push({ decisionT: c.atSample + decisionOffset, windows });
      decided.push({ t: c.atSample + decisionOffset, parityOk: c.parityOk });
      // The frame's decision-directed update takes effect at its decision time.
      stateLog.push({ t: c.atSample + decisionOffset, s: c.threshold });
      hold({
        type: 'char',
        value: c.value,
        parityOk: c.parityOk,
        framingOk: c.framingOk,
        atSample: atIndex(c.atSample),
        minConfidence: c.minConfidence,
      });
    }
  }

  /** Feeds a contiguous run of estimates to the UART. */
  function pushToUart(slice: Sample[]): void {
    if (slice.length === 0) return;
    noteChars(
      uart.push({
        count: slice.length,
        firstTimeSamples: slice[0].t,
        freqHz: Float32Array.from(slice, (s) => s.f),
        re: Float32Array.from(slice, (s) => s.re),
        im: Float32Array.from(slice, (s) => s.im),
      }),
    );
    slice.length = 0;
  }

  /**
   * Runs the UART on the samples dated before `limit`, but only while the carrier is on, and
   * completes the idle-carrier initialisation of the adaptive threshold. The UART always processes
   * the estimates before the initialisation point first, so the threshold switch happens at the same
   * estimate whatever the chunk boundaries.
   */
  function feedUart(samples: readonly Sample[], from: number, limit: number): number {
    let i = from;
    const slice: Sample[] = [];
    while (i < samples.length && samples[i].t < limit) {
      const s = samples[i];
      i++;
      crossQuality(s.t);
      if (!carrierOn) continue;
      const p = s.re * s.re + s.im * s.im;
      block.s2 += p;
      block.s4 += p * p;
      block.c++;
      if (!Number.isNaN(initStart)) {
        if (s.t < initStart + initSamples) {
          initSum += s.f;
          initCount++;
        } else {
          pushToUart(slice);
          if (initCount > 0) threshold.initMark(initSum / initCount);
          initStart = NaN;
          logState(s.t);
        }
      }
      if (!uartStarted && threshold.mode === 'adaptive' && !threshold.initialised) continue;
      uartStarted = true;
      slice.push(s);
    }
    pushToUart(slice);
    return i;
  }

  /** Bit windows of the frames decided in [from, to); those frames are then dropped. */
  function windowsDecidedIn(from: number, to: number): [number, number][] {
    const hit: [number, number][] = [];
    for (const f of frames) if (f.decisionT >= from && f.decisionT < to) hit.push(...f.windows);
    for (let i = frames.length - 1; i >= 0; i--) if (frames[i].decisionT < to) frames.splice(i, 1);
    return hit;
  }

  /** Holds the diag of the interval [prevDiagAt, at). */
  function diagUpTo(at: number): void {
    let end = 0;
    while (end < buffer.length && buffer[end].t < at) end++;
    const span = buffer.splice(0, end);
    hold({
      type: 'diag',
      atSample: atIndex(at),
      nonFiniteCount: nonFiniteCount(),
      freqHz: Float32Array.from(span, (s) => s.f),
      decimation: d.decimation,
      bitWindows: windowsDecidedIn(prevDiagAt, at),
      ...stateBefore(at),
    });
    pruneStates(at);
    prevDiagAt = at;
  }

  /** Diags of the boundaries B <= knownUpTo (every estimate dated before knownUpTo is known). */
  function crossDiagBoundaries(knownUpTo: number): void {
    while (nextDiagAt <= knownUpTo) {
      diagUpTo(nextDiagAt);
      nextDiagAt += diagEvery;
    }
  }

  /**
   * Carrier, UART, answer tone and diags for one discriminator output, in time order. `raw` is the
   * real input of this call, starting at absolute index `rawStart` (empty in flush). `limit` keeps
   * only the estimates dated before it. `endOfInput` (flush) closes the windows and diags up to it.
   */
  function consume(out: DiscriminatorOutput, raw: Float32Array, rawStart: number, limit: number, endOfInput?: number): void {
    const samples = take(out, limit);
    const detected = detector.push(raw, rawStart, samples, endOfInput);
    let cursor = 0;
    for (const ev of detected.carrier) {
      cursor = feedUart(samples, cursor, ev.atSample);
      clearQualityMoments(); // the moments of one transmission only
      if (!ev.on) {
        carrierOffs.push(ev.atSample);
        uart.reset();
        clearThreshold(ev.atSample); // a new transmission may have another offset
      } else {
        initStart = ev.atSample;
        initSum = 0;
        initCount = 0;
      }
      carrierOn = ev.on;
      hold({ type: 'carrier', on: ev.on, atSample: atIndex(ev.atSample) });
    }
    feedUart(samples, cursor, Infinity);
    for (const ev of detected.connect) hold({ type: 'connect', atSample: atIndex(ev.atSample) });
    if (endOfInput !== undefined) crossQuality(endOfInput);
    // Before the diags: a diag prunes the threshold states that the offset of an estimate reads.
    emitQuality();
    settleQuality(endOfInput ?? lastEstimateT, false);
    crossDiagBoundaries(endOfInput ?? lastEstimateT);
  }

  const demod: StreamingDemodulator = {
    push(chunk: Float32Array): DemodEvent[] {
      try {
        const out = d.push(chunk);
        const start = inputCount;
        inputCount += chunk.length;
        consume(out, chunk, start, Infinity);
        return release(lastEstimateT);
      } catch {
        return []; // never throws (design.md "Factory")
      }
    },
    flush(): DemodEvent[] {
      try {
        const end = inputCount;
        consume(d.push(new Float32Array(flushPad)), new Float32Array(0), end, end, end);
        // The end of the input is not a carrier drop: the remaining estimates are kept, unless a
        // detected carrier off follows them.
        settleQuality(end, true);
        const off = detector.forceOff(end);
        if (off) {
          uart.reset();
          carrierOn = false;
          hold({ type: 'carrier', on: false, atSample: atIndex(off.atSample) });
        }
        // The final diag reports the threshold state in force up to the end; it is cleared after.
        if (end > prevDiagAt) diagUpTo(end);
        const out = release(Infinity);
        // Restart on the absolute grids: time continues from the end of the real input.
        nonFiniteBase += d.nonFiniteCount;
        d.reset();
        timeOrigin = end;
        detector.reset(end);
        uart.reset();
        carrierOn = false;
        buffer.length = 0;
        frames.length = 0;
        clearThreshold(end);
        lastEstimateT = end;
        nextDiagAt = (Math.floor(end / diagEvery) + 1) * diagEvery;
        clearQualityMoments();
        decided.length = 0;
        carrierOffs.length = 0;
        nextQualityAt = (Math.floor(end / qualityEvery) + 1) * qualityEvery;
        return out;
      } catch {
        return []; // never throws
      }
    },
    reset(): void {
      d.reset();
      detector.reset();
      uart.reset();
      inputCount = 0;
      timeOrigin = 0;
      nonFiniteBase = 0;
      carrierOn = false;
      nextDiagAt = diagEvery;
      prevDiagAt = 0;
      lastEstimateT = -Infinity;
      buffer.length = 0;
      frames.length = 0;
      held.length = 0;
      seq = 0;
      clearQualityMoments();
      pendingQuality.length = 0;
      awaitingQuality.length = 0;
      carrierOffs.length = 0;
      decided.length = 0;
      nextQualityAt = qualityEvery;
      threshold.mode = initialMode;
      threshold.clear();
      initStart = NaN;
      initSum = 0;
      initCount = 0;
      uartStarted = false;
      stateLog.length = 0;
      stateLog.push({ t: -Infinity, s: threshold.state() });
    },
    setThresholdMode(m: 'fixed' | 'adaptive'): void {
      // Live switch (requirement 7.4): the UART keeps its position; the new threshold applies from
      // the next estimate processed. Any other value is ignored (never throws).
      if (m !== 'fixed' && m !== 'adaptive') return;
      threshold.mode = m;
      logState(lastEstimateT);
    },
  };
  return { ok: true, value: demod };
}
