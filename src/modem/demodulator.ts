// Streaming demodulator (requirements 3.3, 8.1 to 8.4; design.md "Factory", "Events",
// "Threshold mode", "Carrier and answer tone"). Assembles the discriminator (task 5), the UART
// (task 6) and the carrier and answer-tone detector. The UART and the discriminator stay internal;
// only createDemodulator is exported, from task 7 on (decision T7-8).
import { createDetector } from './carrier';
import { createDiscriminator, type DiscriminatorOutput } from './discriminator';
import { fixedThresholdHz } from './threshold';
import type { DemodEvent, DemodOptions, ModemError, Result, StreamingDemodulator } from './types';
import { createUart, type UartChar } from './uart';
import { CARRIER, CHANNELS, FRAME } from './v23';

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
 * channel until task 14 (decision T7-7), for any threshold other than 'fixed' until task 8
 * (an omitted threshold included, no silent fallback), and for a non-finite carrierOnDbfs.
 * `carrierOnDbfs` defaults to -45 under the D6 reference (decision T7-1).
 *
 * `push` runs the discriminator, the carrier and answer-tone detector, and the UART. The UART
 * receives estimates only while the carrier is on and is reset when the carrier drops, so silence
 * (which the discriminator reads as 1800 Hz, space) cannot invent characters. `diag` is emitted at
 * every absolute 50 ms boundary whether or not the carrier is on. No `quality` event is emitted
 * before task 10 (decision T7-5).
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
 * `push`, `flush` and `reset` never throw. `setThresholdMode` is a documented no-op until task 8.
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
  if (o.threshold !== 'fixed') {
    return {
      ok: false,
      error: {
        kind: 'bad-option',
        option: 'threshold',
        reason: "before task 8, only threshold: 'fixed' is accepted (no silent fallback)",
      },
    };
  }
  const carrierOnDbfs = o.carrierOnDbfs ?? CARRIER.onDbfs;
  if (typeof carrierOnDbfs !== 'number' || !Number.isFinite(carrierOnDbfs)) {
    return { ok: false, error: { kind: 'bad-option', option: 'carrierOnDbfs', reason: 'must be a finite number' } };
  }

  const d = disc.value;
  const spec = CHANNELS.forward;
  const detector = createDetector(d.sampleRate, d.decimation, carrierOnDbfs);
  const uart = createUart(d);
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

  function hold(e: DemodEvent): void {
    held.push({ e, seq: seq++ });
  }

  /** Releases, in (atSample, type) order, the held events that nothing earlier can precede. */
  function release(horizon: number): DemodEvent[] {
    held.sort((a, b) => a.e.atSample - b.e.atSample || TYPE_RANK[a.e.type] - TYPE_RANK[b.e.type] || a.seq - b.seq);
    let n = 0;
    while (n < held.length && held[n].e.atSample + releaseLag <= horizon) n++;
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

  /** Runs the UART on the samples dated before `limit`, but only while the carrier is on. */
  function feedUart(samples: readonly Sample[], from: number, limit: number): number {
    let i = from;
    const slice: Sample[] = [];
    while (i < samples.length && samples[i].t < limit) {
      if (carrierOn) slice.push(samples[i]);
      i++;
    }
    if (slice.length > 0) {
      noteChars(
        uart.push({
          count: slice.length,
          firstTimeSamples: slice[0].t,
          freqHz: Float32Array.from(slice, (s) => s.f),
          re: Float32Array.from(slice, (s) => s.re),
          im: Float32Array.from(slice, (s) => s.im),
        }),
      );
    }
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
      thresholdHz: fixedThresholdHz(spec),
      markHz: spec.markHz,
      spaceHz: spec.spaceHz,
    });
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
      if (!ev.on) uart.reset();
      carrierOn = ev.on;
      hold({ type: 'carrier', on: ev.on, atSample: atIndex(ev.atSample) });
    }
    feedUart(samples, cursor, Infinity);
    for (const ev of detected.connect) hold({ type: 'connect', atSample: atIndex(ev.atSample) });
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
        const off = detector.forceOff(end);
        if (off) {
          uart.reset();
          carrierOn = false;
          hold({ type: 'carrier', on: false, atSample: atIndex(off.atSample) });
        }
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
        lastEstimateT = end;
        nextDiagAt = (Math.floor(end / diagEvery) + 1) * diagEvery;
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
    },
    setThresholdMode(_m: 'fixed' | 'adaptive'): void {
      // Documented no-op before task 8: the mode stays 'fixed' (design.md "Threshold mode").
    },
  };
  return { ok: true, value: demod };
}
