import { C0, createVideotexDecoder, type Cell, type VideotexDecoder } from '../videotex';
import {
  BerCounter,
  pn9Frames,
  readWav,
  writeWav,
  type ChannelId,
  type DemodEvent,
  type StreamingDemodulator,
} from '../modem';
import { createBackwardKeyListener, type BackwardKeyListener } from './back-keys';
import { SpectrumAnalyzer512 } from './fft512';
import {
  resolveModemProvider,
  type ModemProvider,
  type StreamingSimulator,
} from './modem-bridge';
import {
  DEFAULT_SIM_PARAMS,
  type FromWorker,
  type SimParams,
  type TimedEvent,
} from './protocol';

export const BLOCK_DURATION_SEC = 0.1; // 100 ms blocks (design.md)
export const MAX_BLOCKS_AHEAD = 2; // <= 200 ms lookahead so setSim takes effect within 200 ms (Req 3.2)
export const PAGE_IDLE_END_SEC = 0.3; // 300 ms of idle carrier after a page triggers pageEnd
export const BER_REPORT_INTERVAL_SEC = 0.25; // emit live BER snapshots 4x/s during PN9 bench
export const CLEAN_BENCH_EBN0_DB = 18; // x-axis ceiling when simulator noise is disabled ("clean")
export const EXPORT_WAV_SAMPLE_RATE = 48000; // 3615 LIBRE WAV export
export const BACK_KEY_IDLE_MS = 120; // idle carrier around a backward key burst (task 17)

interface ActiveTransmission {
  id: number;
  pageId: string;
  simulate: boolean;
  connectionAudio: Float32Array | null;
  connectionOffset: number;
  connectSampleOffset: number;
  connectEmitted: boolean;
  pageBytes: Uint8Array;
  pageAudio: Float32Array | null;
  pageOffset: number;
  testPatternFrames: number;
  inPn9Phase: boolean;
  pn9Audio: Float32Array | null;
  pn9Offset: number;
  /** Non-null when streaming a pre-recorded WAV (3615 FANTOME `playWav` or `Fichier` realtime). */
  rawWavSamples: Float32Array | null;
  rawWavOffset: number;
}

export interface LineEngineOptions {
  modem?: ModemProvider;
}

export interface LineEngine {
  init(sampleRate: number): FromWorker | null;
  startTransmit(params: {
    id: number;
    bytes: Uint8Array;
    pageId: string;
    simulate: boolean;
    withConnectionSequence?: boolean;
    testPattern?: { frames: number };
  }): FromWorker | null;
  /** Starts real-time 100 ms block streaming of a WAV buffer (simulator disabled, Req 2.3). */
  startRealtimeWav(params: {
    id: number;
    data: ArrayBuffer | Uint8Array;
  }): FromWorker | null;
  /** Decodes a WAV buffer faster than real time in 4096-sample chunks, reporting progress. */
  decodeWavFast(
    data: ArrayBuffer | Uint8Array,
    onProgress?: (done: number, total: number) => void,
  ): Extract<FromWorker, { t: 'live' } | { t: 'error' }>;
  /** Produces the next 100 ms `{ t: 'block', ... }` message, or `null` if no transmission is active. */
  nextTransmitBlock(): Extract<FromWorker, { t: 'block' }> | null;
  hasActiveTransmit(): boolean;
  activeTransmitId(): number | null;
  stopTransmit(): void;
  setSim(sim: SimParams): void;
  setThreshold(mode: 'fixed' | 'adaptive'): void;
  /**
   * Receive channel of the demodulator (default 'forward'). A change recreates the demodulator;
   * locally transmitted pages are always forward, so the app sets 'forward' before a transmit.
   */
  setRxChannel(channel: ChannelId): void;
  /**
   * 3615 LIBRE export: the connection sequence then the page at EXPORT_WAV_SAMPLE_RATE, as a
   * 16-bit WAV. Independent of the engine's state (no transmission is started).
   */
  exportPageWav(bytes: Uint8Array): Extract<FromWorker, { t: 'error' }> | { t: 'ok'; data: Uint8Array };
  /**
   * Terminal side of the backward keyboard (task 17): the bytes at 75 baud, with short idle
   * margins, at `sampleRate`, ready for the speaker. Independent of the forward pipeline.
   */
  modulateBackward(bytes: Uint8Array, sampleRate: number): Extract<FromWorker, { t: 'error' }> | { t: 'ok'; audio: Float32Array };
  /** Server side: starts (or restarts) the backward key receiver at `sampleRate`. */
  startBackwardKeys(sampleRate: number): Extract<FromWorker, { t: 'error' }> | null;
  /** Server side: one microphone chunk into the backward key receiver; `key` / `keyChar` events. */
  pushBackwardKeyChunk(chunk: Float32Array): Extract<FromWorker, { t: 'live' }> | null;
  stopBackwardKeys(): void;
  pushLiveCaptureChunk(chunk: Float32Array): Extract<FromWorker, { t: 'live' }> | null;
  reset(): void;
}

function stableSortDemodEvents(events: readonly DemodEvent[]): DemodEvent[] {
  return events
    .map((ev, idx) => ({ ev, idx }))
    .sort((a, b) => a.ev.atSample - b.ev.atSample || a.idx - b.idx)
    .map((x) => x.ev);
}

function normalizeAudioForPlayback(chunk: Float32Array): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < chunk.length; i++) {
    const v = Math.abs(chunk[i]);
    if (Number.isFinite(v) && v > maxAbs) {
      maxAbs = v;
    }
  }
  const out = new Float32Array(chunk.length);
  const scale = maxAbs > 1 ? 1 / maxAbs : 1;
  for (let i = 0; i < chunk.length; i++) {
    const s = chunk[i];
    out[i] = Number.isFinite(s) ? s * scale : 0;
  }
  return out;
}

/**
 * Pure line processing engine shared by `line.worker.ts` and Node end-to-end tests (`A3`, `A4`).
 * Hosts modulation, channel simulation, demodulation, Videotex decoding, and 512-pt FFT spectrum.
 */
export function createLineEngine(options?: LineEngineOptions): LineEngine {
  const modem = options?.modem ?? resolveModemProvider();

  let sampleRate = 48000;
  let simParams: SimParams = { ...DEFAULT_SIM_PARAMS };
  let thresholdMode: 'fixed' | 'adaptive' = 'fixed';
  let rxChannel: ChannelId = 'forward';
  let backKeys: BackwardKeyListener | null = null; // server side of the backward keyboard (task 17)

  let demod: StreamingDemodulator | null = null;
  let simulator: StreamingSimulator | null = null;
  const vtxDecoder: VideotexDecoder = createVideotexDecoder();
  const spectrum = new SpectrumAnalyzer512();
  const berCounter = new BerCounter();

  let streamSampleCursor = 0;
  let demodSampleOrigin = 0;
  let pageActive = false;
  let pageStartedByFf = false;
  let lastCharGlobalSample = 0;
  let berSettleUntilSample = 0;
  let lastBerEmitSample = 0;
  let latestMeasuredEbN0Db: number | null = null;
  let activeTx: ActiveTransmission | null = null;

  function resolveBenchEbN0Db(simulate: boolean): number {
    if (simulate && simParams.ebN0Db !== null) {
      return simParams.ebN0Db;
    }
    if (latestMeasuredEbN0Db !== null && Number.isFinite(latestMeasuredEbN0Db)) {
      return Math.max(0, Math.min(CLEAN_BENCH_EBN0_DB, latestMeasuredEbN0Db));
    }
    return CLEAN_BENCH_EBN0_DB;
  }

  function createFreshDemodulator(): Extract<FromWorker, { t: 'error' }> | null {
    // Until modem task 8 lands, only threshold: 'fixed' is accepted on initialization (design.md)
    const initialThreshold = thresholdMode === 'adaptive' ? 'adaptive' : 'fixed';
    let res = modem.createDemodulator({
      sampleRate,
      channel: rxChannel,
      threshold: initialThreshold,
    });
    if (!res.ok && initialThreshold === 'adaptive') {
      // Fallback before task 8 lands: initialize with 'fixed' and delegate setThresholdMode
      res = modem.createDemodulator({
        sampleRate,
        channel: rxChannel,
        threshold: 'fixed',
      });
      if (res.ok) {
        res.value.setThresholdMode('adaptive');
      }
    }
    if (!res.ok) {
      return { t: 'error', error: res.error };
    }
    demod = res.value;
    demodSampleOrigin = streamSampleCursor;
    return null;
  }

  function emitPageEndIfValid(atSample: number, out: TimedEvent[]): void {
    const stats = vtxDecoder.stats();
    const screen = vtxDecoder.screen();
    const visitedMask = vtxDecoder.visitedMask();
    const wasStartedByFf = pageStartedByFf;
    vtxDecoder.reset();
    pageActive = false;
    pageStartedByFf = false;

    // Ignore brief idle-carrier noise bursts that never started with FF and produced < 16 chars.
    if (!wasStartedByFf && stats.printable < 16) {
      return;
    }

    out.push({
      atSample,
      e: 'pageEnd',
      screen,
      ...(visitedMask ? { visitedMask } : {}),
    });
  }

  function convertDemodEvents(
    rawEvents: readonly DemodEvent[],
    chunkEndGlobalSample: number,
  ): TimedEvent[] {
    const sorted = stableSortDemodEvents(rawEvents);
    const out: TimedEvent[] = [];
    const idleSamplesThreshold = Math.round(PAGE_IDLE_END_SEC * sampleRate);

    for (const ev of sorted) {
      const globalSample = Math.max(0, demodSampleOrigin + ev.atSample);

      switch (ev.type) {
        case 'carrier': {
          out.push({ atSample: globalSample, e: 'carrier', on: ev.on });
          if (!ev.on && pageActive) {
            emitPageEndIfValid(globalSample, out);
          }
          break;
        }
        case 'connect': {
          out.push({ atSample: globalSample, e: 'connect' });
          break;
        }
        case 'quality': {
          if (Number.isFinite(ev.ebN0Db)) {
            latestMeasuredEbN0Db = ev.ebN0Db;
          }
          out.push({
            atSample: globalSample,
            e: 'quality',
            q: { ...ev, atSample: globalSample },
          });
          break;
        }
        case 'diag': {
          // Keep d.atSample and d.bitWindows on the same demodulator-local sample clock
          out.push({
            atSample: globalSample,
            e: 'diag',
            d: ev,
            spectrumDb: spectrum.computeSpectrumDb(),
            sampleRate,
          });
          break;
        }
        case 'char': {
          if (
            pageActive &&
            globalSample - lastCharGlobalSample >= idleSamplesThreshold
          ) {
            emitPageEndIfValid(globalSample, out);
          }

          const hasError = !ev.parityOk || !ev.framingOk;
          const isCleanFf = !hasError && (ev.value & 0x7f) === C0.FF;
          if (isCleanFf && pageActive) {
            // Commit completed previous repetition before FF wipes rows 1..24
            if (vtxDecoder.stats().printable >= 20) {
              emitPageEndIfValid(globalSample, out);
            } else {
              vtxDecoder.reset();
              pageActive = false;
              pageStartedByFf = false;
            }
          }

          out.push({
            atSample: globalSample,
            e: 'rxStats',
            chars: 1,
            parityErrors: ev.parityOk ? 0 : 1,
            framingErrors: ev.framingOk ? 0 : 1,
            sampleRate,
          });
          const { changed } = vtxDecoder.push({
            value: ev.value,
            error: hasError,
          });

          // FF clears all 24x40 = 960 page cells
          const isPageClear = isCleanFf && changed.length === 960;
          if (isPageClear) {
            out.push({ atSample: globalSample, e: 'pageStart' });
            pageActive = true;
            pageStartedByFf = true;
          } else if (!pageActive) {
            pageActive = true;
          }

          lastCharGlobalSample = globalSample;

          if (changed.length > 0) {
            const seen = new Set<number>();
            const cells: [row: number, col: number, cell: Cell][] = [];
            for (const [r, c] of changed) {
              const key = r * 64 + c;
              if (seen.has(key)) continue;
              seen.add(key);
              cells.push([r, c, vtxDecoder.cellAt(r, c)]);
            }
            out.push({ atSample: globalSample, e: 'diff', cells });
          }
          break;
        }
      }
    }

    if (
      pageActive &&
      chunkEndGlobalSample - lastCharGlobalSample >= idleSamplesThreshold
    ) {
      emitPageEndIfValid(chunkEndGlobalSample, out);
    }

    return out;
  }

  function convertPn9DemodEvents(rawEvents: readonly DemodEvent[]): TimedEvent[] {
    const sorted = stableSortDemodEvents(rawEvents);
    const out: TimedEvent[] = [];

    for (const ev of sorted) {
      const globalSample = Math.max(0, demodSampleOrigin + ev.atSample);

      switch (ev.type) {
        case 'carrier':
          out.push({ atSample: globalSample, e: 'carrier', on: ev.on });
          break;
        case 'connect':
          out.push({ atSample: globalSample, e: 'connect' });
          break;
        case 'quality':
          if (Number.isFinite(ev.ebN0Db)) {
            latestMeasuredEbN0Db = ev.ebN0Db;
          }
          out.push({
            atSample: globalSample,
            e: 'quality',
            q: { ...ev, atSample: globalSample },
          });
          break;
        case 'diag':
          out.push({
            atSample: globalSample,
            e: 'diag',
            d: ev,
            spectrumDb: spectrum.computeSpectrumDb(),
            sampleRate,
          });
          break;
        case 'char':
          out.push({
            atSample: globalSample,
            e: 'rxStats',
            chars: 1,
            parityErrors: ev.parityOk ? 0 : 1,
            framingErrors: ev.framingOk ? 0 : 1,
            sampleRate,
          });
          if (globalSample >= berSettleUntilSample) {
            berCounter.pushFrame(ev.value, ev.framingOk);
          }
          break;
      }
    }

    return out;
  }

  return {
    init(nextSampleRate: number): FromWorker | null {
      sampleRate = nextSampleRate;
      streamSampleCursor = 0;
      demodSampleOrigin = 0;
      pageActive = false;
      pageStartedByFf = false;
      lastCharGlobalSample = 0;
      berSettleUntilSample = 0;
      lastBerEmitSample = 0;
      latestMeasuredEbN0Db = null;
      activeTx = null;
      vtxDecoder.reset();
      spectrum.reset();
      berCounter.reset();
      simulator = modem.createSimulator(sampleRate, simParams);
      return createFreshDemodulator();
    },

    startTransmit({
      id,
      bytes,
      pageId,
      simulate,
      withConnectionSequence = false,
      testPattern,
    }): FromWorker | null {
      // Ensure demodulator & simulator exist even if init was not called explicitly
      if (!simulator) {
        simulator = modem.createSimulator(sampleRate, simParams);
      }
      if (!demod) {
        const err = createFreshDemodulator();
        if (err) return err;
      }

      const connectionAudio = withConnectionSequence
        ? modem.connectionSequence({ sampleRate })
        : null;

      // Validate bytes immediately so invalid inputs fail fast with typed ModemError
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] > 127) {
          return {
            t: 'error',
            error: { kind: 'byte-out-of-range', index: i, value: bytes[i] },
          };
        }
      }

      const requestedPn9Frames =
        testPattern && Number.isSafeInteger(testPattern.frames) && testPattern.frames > 0
          ? testPattern.frames
          : 0;

      activeTx = {
        id,
        pageId,
        simulate,
        connectionAudio,
        connectionOffset: 0,
        connectSampleOffset: Math.round(0.5 * sampleRate),
        connectEmitted: false,
        pageBytes: bytes,
        pageAudio: null, // modulated right after connection sequence finishes so fakeModulate stays fresh
        pageOffset: 0,
        testPatternFrames: requestedPn9Frames,
        inPn9Phase: false,
        pn9Audio: null,
        pn9Offset: 0,
        rawWavSamples: null,
        rawWavOffset: 0,
      };

      if (connectionAudio && demod) {
        demod.reset();
        demodSampleOrigin = streamSampleCursor;
      }

      return null;
    },

    startRealtimeWav({ id, data }): FromWorker | null {
      const parsed = readWav(data);
      if (!parsed.ok) {
        return { t: 'error', error: parsed.error };
      }

      sampleRate = parsed.value.sampleRate;
      streamSampleCursor = 0;
      demodSampleOrigin = 0;
      pageActive = false;
      pageStartedByFf = false;
      lastCharGlobalSample = 0;
      vtxDecoder.reset();
      spectrum.reset();
      berCounter.reset();

      const demodErr = createFreshDemodulator();
      if (demodErr) {
        return demodErr;
      }

      activeTx = {
        id,
        pageId: 'wav/realtime',
        simulate: false,
        connectionAudio: null,
        connectionOffset: 0,
        connectSampleOffset: 0,
        connectEmitted: true,
        pageBytes: new Uint8Array(0),
        pageAudio: null,
        pageOffset: 0,
        testPatternFrames: 0,
        inPn9Phase: false,
        pn9Audio: null,
        pn9Offset: 0,
        rawWavSamples: parsed.value.samples,
        rawWavOffset: 0,
      };
      return null;
    },

    decodeWavFast(
      data: ArrayBuffer | Uint8Array,
      onProgress?: (done: number, total: number) => void,
    ): Extract<FromWorker, { t: 'live' } | { t: 'error' }> {
      const parsed = readWav(data);
      if (!parsed.ok) {
        return { t: 'error', error: parsed.error };
      }

      activeTx = null;
      sampleRate = parsed.value.sampleRate;
      streamSampleCursor = 0;
      demodSampleOrigin = 0;
      pageActive = false;
      pageStartedByFf = false;
      lastCharGlobalSample = 0;
      vtxDecoder.reset();
      spectrum.reset();
      berCounter.reset();

      const demodErr = createFreshDemodulator();
      if (demodErr || !demod) {
        return (
          demodErr ?? {
            t: 'error',
            error: { kind: 'internal', message: 'Demodulator initialization failed' },
          }
        );
      }

      const samples = parsed.value.samples;
      const total = samples.length;
      const chunkLen = 4096;
      const allEvents: TimedEvent[] = [];

      for (let offset = 0; offset < total; offset += chunkLen) {
        const end = Math.min(total, offset + chunkLen);
        const slice = samples.subarray(offset, end);
        streamSampleCursor = end;
        spectrum.pushSamples(slice);
        const rawEvents = demod.push(slice);
        for (const ev of convertDemodEvents(rawEvents, streamSampleCursor)) {
          allEvents.push(ev);
        }
        onProgress?.(end, total);
      }

      const flushed = demod.flush();
      for (const ev of convertDemodEvents(flushed, streamSampleCursor)) {
        allEvents.push(ev);
      }
      if (pageActive) {
        emitPageEndIfValid(streamSampleCursor, allEvents);
      }

      return { t: 'live', events: allEvents };
    },

    nextTransmitBlock(): Extract<FromWorker, { t: 'block' }> | null {
      if (!activeTx || !demod) {
        return null;
      }

      const blockSamples = Math.max(1, Math.round(BLOCK_DURATION_SEC * sampleRate));

      // Phase 0: stream pre-recorded WAV samples (3615 FANTOME `playWav` or `Fichier` realtime; simulator off)
      if (activeTx.rawWavSamples !== null) {
        if (activeTx.rawWavOffset >= activeTx.rawWavSamples.length) {
          activeTx = null;
          return null;
        }
        const remainingWav =
          activeTx.rawWavSamples.length - activeTx.rawWavOffset;
        const takeWav = Math.min(blockSamples, remainingWav);
        const wavSlice = activeTx.rawWavSamples.subarray(
          activeTx.rawWavOffset,
          activeTx.rawWavOffset + takeWav,
        );
        activeTx.rawWavOffset += takeWav;
        const isLastWavBlock =
          activeTx.rawWavOffset >= activeTx.rawWavSamples.length;

        const blockStart = streamSampleCursor;
        streamSampleCursor += wavSlice.length;

        spectrum.pushSamples(wavSlice);
        const rawWavEvents = demod.push(wavSlice);
        if (isLastWavBlock) {
          for (const f of demod.flush()) {
            rawWavEvents.push(f);
          }
        }

        const eventsWav = convertDemodEvents(rawWavEvents, streamSampleCursor);
        if (isLastWavBlock && pageActive) {
          emitPageEndIfValid(streamSampleCursor, eventsWav);
        }

        const wavTxId = activeTx.id;
        if (isLastWavBlock) {
          activeTx = null;
        }

        return {
          t: 'block',
          id: wavTxId,
          audio: normalizeAudioForPlayback(wavSlice),
          startSample: blockStart,
          sampleRate,
          events: eventsWav,
          done: isLastWavBlock,
        };
      }

      if (!simulator) {
        return null;
      }

      // Phase 1: stream connection sequence if requested
      if (
        activeTx.connectionAudio !== null &&
        activeTx.connectionOffset < activeTx.connectionAudio.length
      ) {
        const remaining =
          activeTx.connectionAudio.length - activeTx.connectionOffset;
        const take = Math.min(blockSamples, remaining);
        const cleanSlice = activeTx.connectionAudio.subarray(
          activeTx.connectionOffset,
          activeTx.connectionOffset + take,
        );
        const prevConnOffset = activeTx.connectionOffset;
        activeTx.connectionOffset += take;

        const processed = activeTx.simulate
          ? simulator.process(cleanSlice)
          : cleanSlice.slice();
        const blockStartSample = streamSampleCursor;
        streamSampleCursor += processed.length;

        spectrum.pushSamples(processed);
        const rawEvents = demod.push(processed);
        for (const ev of rawEvents) {
          if (ev.type === 'connect') {
            activeTx.connectEmitted = true;
          }
        }
        const events = convertDemodEvents(rawEvents, streamSampleCursor);

        // Fake demodulator does not run Goertzel on 2100 Hz; emit synthetic connect after 500 ms
        if (
          !activeTx.connectEmitted &&
          prevConnOffset < activeTx.connectSampleOffset &&
          activeTx.connectionOffset >= activeTx.connectSampleOffset
        ) {
          activeTx.connectEmitted = true;
          const connectAt =
            blockStartSample + (activeTx.connectSampleOffset - prevConnOffset);
          events.push({ atSample: connectAt, e: 'connect' });
          events.sort((a, b) => a.atSample - b.atSample);
        }

        const isAllDone =
          activeTx.connectionOffset >= activeTx.connectionAudio.length &&
          activeTx.pageBytes.length === 0;
        const txId = activeTx.id;
        if (isAllDone) {
          activeTx = null;
        }

        return {
          t: 'block',
          id: txId,
          audio: normalizeAudioForPlayback(processed),
          startSample: blockStartSample,
          sampleRate,
          events,
          done: isAllDone,
        };
      }

      // Phase 3: PN9 test bench frames streamed after the Videotex page completes (Task 11.2)
      if (activeTx.inPn9Phase) {
        if (activeTx.pn9Audio === null) {
          const pn9Bytes = pn9Frames(activeTx.testPatternFrames);
          const pn9Mod = modem.modulate(pn9Bytes, {
            sampleRate,
            channel: 'forward',
            tailIdleMs: 40,
          });
          if (!pn9Mod.ok) {
            activeTx = null;
            return null;
          }
          activeTx.pn9Audio = pn9Mod.value;
          activeTx.pn9Offset = 0;

          berCounter.reset();
          demod.reset();
          demod.setThresholdMode(thresholdMode);
          demodSampleOrigin = streamSampleCursor;
          berSettleUntilSample = streamSampleCursor;
          lastBerEmitSample = streamSampleCursor;
        }

        if (activeTx.pn9Offset >= activeTx.pn9Audio.length) {
          activeTx = null;
          return null;
        }

        const remainingPn9 = activeTx.pn9Audio.length - activeTx.pn9Offset;
        const takePn9 = Math.min(blockSamples, remainingPn9);
        const cleanPn9Slice = activeTx.pn9Audio.subarray(
          activeTx.pn9Offset,
          activeTx.pn9Offset + takePn9,
        );
        activeTx.pn9Offset += takePn9;
        const isLastPn9Block = activeTx.pn9Offset >= activeTx.pn9Audio.length;

        const processedPn9 = activeTx.simulate
          ? simulator.process(cleanPn9Slice)
          : cleanPn9Slice.slice();
        const blockStart = streamSampleCursor;
        streamSampleCursor += processedPn9.length;

        spectrum.pushSamples(processedPn9);
        const rawPn9Events = demod.push(processedPn9);
        if (isLastPn9Block) {
          for (const f of demod.flush()) {
            rawPn9Events.push(f);
          }
        }

        const eventsPn9 = convertPn9DemodEvents(rawPn9Events);
        const reportSamples = Math.round(BER_REPORT_INTERVAL_SEC * sampleRate);
        if (
          streamSampleCursor - lastBerEmitSample >= reportSamples ||
          isLastPn9Block
        ) {
          const snap = berCounter.snapshot();
          if (snap.bits >= 50) {
            eventsPn9.push({
              atSample: streamSampleCursor,
              e: 'ber',
              ebN0Db: resolveBenchEbN0Db(activeTx.simulate),
              bits: snap.bits,
              errors: snap.errors,
              lo: snap.lo,
              hi: snap.hi,
            });
            lastBerEmitSample = streamSampleCursor;
          }
        }

        const txIdPn9 = activeTx.id;
        if (isLastPn9Block) {
          activeTx = null;
        }

        return {
          t: 'block',
          id: txIdPn9,
          audio: normalizeAudioForPlayback(processedPn9),
          startSample: blockStart,
          sampleRate,
          events: eventsPn9,
          done: isLastPn9Block,
        };
      }

      // Phase 2: modulate page once (with 300 ms tail idle carrier so pageEnd triggers cleanly)
      if (activeTx.pageAudio === null) {
        const modRes = modem.modulate(activeTx.pageBytes, {
          sampleRate,
          channel: 'forward',
          tailIdleMs: Math.round(PAGE_IDLE_END_SEC * 1000),
        });
        if (!modRes.ok) {
          activeTx = null;
          return null;
        }
        activeTx.pageAudio = modRes.value;
        activeTx.pageOffset = 0;

        // Reset demodulator at start of page audio so atSample aligns with streamSampleCursor
        demod.reset();
        demod.setThresholdMode(thresholdMode);
        demodSampleOrigin = streamSampleCursor;
      }

      if (activeTx.pageOffset >= activeTx.pageAudio.length) {
        activeTx = null;
        return null;
      }

      const remaining = activeTx.pageAudio.length - activeTx.pageOffset;
      const take = Math.min(blockSamples, remaining);
      const cleanSlice = activeTx.pageAudio.subarray(
        activeTx.pageOffset,
        activeTx.pageOffset + take,
      );
      activeTx.pageOffset += take;
      const isLastPageBlock = activeTx.pageOffset >= activeTx.pageAudio.length;

      const processed = activeTx.simulate
        ? simulator.process(cleanSlice)
        : cleanSlice.slice();
      const blockStartSample = streamSampleCursor;
      streamSampleCursor += processed.length;

      spectrum.pushSamples(processed);
      const rawEvents = demod.push(processed);
      if (isLastPageBlock) {
        const flushed = demod.flush();
        for (const f of flushed) {
          rawEvents.push(f);
        }
      }

      const events = convertDemodEvents(rawEvents, streamSampleCursor);
      if (isLastPageBlock && pageActive) {
        emitPageEndIfValid(streamSampleCursor, events);
      }

      const txId = activeTx.id;
      const hasPn9Next = activeTx.testPatternFrames > 0;
      if (isLastPageBlock) {
        if (hasPn9Next) {
          activeTx.inPn9Phase = true;
        } else {
          activeTx = null;
        }
      }

      return {
        t: 'block',
        id: txId,
        audio: normalizeAudioForPlayback(processed),
        startSample: blockStartSample,
        sampleRate,
        events,
        done: isLastPageBlock && !hasPn9Next,
      };
    },

    hasActiveTransmit(): boolean {
      return activeTx !== null;
    },

    activeTransmitId(): number | null {
      return activeTx ? activeTx.id : null;
    },

    stopTransmit(): void {
      activeTx = null;
      pageActive = false;
      pageStartedByFf = false;
    },

    setSim(nextSim: SimParams): void {
      const ebN0Changed = nextSim.ebN0Db !== simParams.ebN0Db;
      const impairmentChanged =
        ebN0Changed ||
        nextSim.offsetHz !== simParams.offsetHz ||
        nextSim.clockPct !== simParams.clockPct ||
        nextSim.hum !== simParams.hum ||
        nextSim.bursts !== simParams.bursts ||
        nextSim.seed !== simParams.seed;

      simParams = { ...nextSim };
      simulator?.setSim(simParams);

      // Requirement 6.3: when Eb/N0 or channel impairments change during the PN9 bench,
      // restart the BER counter after a 30 ms filter-settle window so a fresh point is measured.
      if (impairmentChanged && activeTx?.inPn9Phase) {
        berCounter.reset();
        berSettleUntilSample = streamSampleCursor + Math.round(0.03 * sampleRate);
        lastBerEmitSample = streamSampleCursor;
      }
    },

    setThreshold(mode: 'fixed' | 'adaptive'): void {
      thresholdMode = mode;
      demod?.setThresholdMode(mode);
    },

    setRxChannel(channel: ChannelId): void {
      if (channel !== 'forward' && channel !== 'backward') return;
      if (channel === rxChannel) return;
      rxChannel = channel;
      if (demod) createFreshDemodulator();
    },

    modulateBackward(bytes: Uint8Array, rate: number) {
      const res = modem.modulate(bytes, { sampleRate: rate, channel: 'backward', leadIdleMs: BACK_KEY_IDLE_MS, tailIdleMs: BACK_KEY_IDLE_MS });
      if (!res.ok) return { t: 'error', error: res.error };
      return { t: 'ok', audio: res.value };
    },

    startBackwardKeys(rate: number) {
      const res = createBackwardKeyListener(rate);
      if (!res.ok) return { t: 'error', error: res.error };
      backKeys = res.value;
      return null;
    },

    pushBackwardKeyChunk(chunk: Float32Array) {
      if (!backKeys) return null;
      const events: TimedEvent[] = [];
      // Dates are microphone samples since startBackwardKeys (the receiver's own time base).
      for (const input of backKeys.push(chunk)) {
        if (input.kind === 'key') events.push({ atSample: input.atSample, e: 'key', key: input.key });
        else events.push({ atSample: input.atSample, e: 'keyChar', char: input.char });
      }
      return events.length > 0 ? { t: 'live', events } : null;
    },

    stopBackwardKeys(): void {
      backKeys = null;
    },

    exportPageWav(bytes: Uint8Array) {
      const fs = EXPORT_WAV_SAMPLE_RATE;
      const intro = modem.connectionSequence({ sampleRate: fs });
      const page = modem.modulate(bytes, { sampleRate: fs, channel: 'forward', tailIdleMs: Math.round(PAGE_IDLE_END_SEC * 1000) });
      if (!page.ok) return { t: 'error', error: page.error };
      const all = new Float32Array(intro.length + page.value.length);
      all.set(intro, 0);
      all.set(page.value, intro.length);
      const wav = writeWav(all, fs);
      if (!wav.ok) return { t: 'error', error: wav.error };
      return { t: 'ok', data: wav.value };
    },

    pushLiveCaptureChunk(
      chunk: Float32Array,
    ): Extract<FromWorker, { t: 'live' }> | null {
      if (!demod) {
        const err = createFreshDemodulator();
        if (err || !demod) return null;
      }
      streamSampleCursor += chunk.length;
      spectrum.pushSamples(chunk);
      const rawEvents = demod.push(chunk);
      const events = convertDemodEvents(rawEvents, streamSampleCursor);
      if (events.length === 0) {
        return null;
      }
      return { t: 'live', events };
    },

    reset(): void {
      activeTx = null;
      streamSampleCursor = 0;
      demodSampleOrigin = 0;
      pageActive = false;
      pageStartedByFf = false;
      lastCharGlobalSample = 0;
      berSettleUntilSample = 0;
      lastBerEmitSample = 0;
      latestMeasuredEbN0Db = null;
      vtxDecoder.reset();
      spectrum.reset();
      berCounter.reset();
      demod?.reset();
      simulator?.reset();
    },
  };
}
