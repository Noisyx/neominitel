import { C0, createVideotexDecoder, type Cell, type VideotexDecoder } from '../videotex';
import type { DemodEvent, StreamingDemodulator } from '../modem';
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
export const MAX_BLOCKS_AHEAD = 3; // at most 3 blocks ahead of playback (design.md)
export const PAGE_IDLE_END_SEC = 0.3; // 300 ms of idle carrier after a page triggers pageEnd

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
  }): FromWorker | null;
  /** Produces the next 100 ms `{ t: 'block', ... }` message, or `null` if no transmission is active. */
  nextTransmitBlock(): Extract<FromWorker, { t: 'block' }> | null;
  hasActiveTransmit(): boolean;
  activeTransmitId(): number | null;
  stopTransmit(): void;
  setSim(sim: SimParams): void;
  setThreshold(mode: 'fixed' | 'adaptive'): void;
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

  let demod: StreamingDemodulator | null = null;
  let simulator: StreamingSimulator | null = null;
  const vtxDecoder: VideotexDecoder = createVideotexDecoder();
  const spectrum = new SpectrumAnalyzer512();

  let streamSampleCursor = 0;
  let demodSampleOrigin = 0;
  let pageActive = false;
  let lastCharGlobalSample = 0;
  let activeTx: ActiveTransmission | null = null;

  function createFreshDemodulator(): FromWorker | null {
    // Until modem task 8 lands, only threshold: 'fixed' is accepted on initialization (design.md)
    const initialThreshold = thresholdMode === 'adaptive' ? 'adaptive' : 'fixed';
    let res = modem.createDemodulator({
      sampleRate,
      channel: 'forward',
      threshold: initialThreshold,
    });
    if (!res.ok && initialThreshold === 'adaptive') {
      // Fallback before task 8 lands: initialize with 'fixed' and delegate setThresholdMode
      res = modem.createDemodulator({
        sampleRate,
        channel: 'forward',
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
            out.push({
              atSample: globalSample,
              e: 'pageEnd',
              screen: vtxDecoder.screen(),
            });
            pageActive = false;
          }
          break;
        }
        case 'connect': {
          out.push({ atSample: globalSample, e: 'connect' });
          break;
        }
        case 'quality': {
          out.push({
            atSample: globalSample,
            e: 'quality',
            q: { ...ev, atSample: globalSample },
          });
          break;
        }
        case 'diag': {
          out.push({
            atSample: globalSample,
            e: 'diag',
            d: { ...ev, atSample: globalSample },
            spectrumDb: spectrum.computeSpectrumDb(),
          });
          break;
        }
        case 'char': {
          const hasError = !ev.parityOk || !ev.framingOk;
          const { changed } = vtxDecoder.push({
            value: ev.value,
            error: hasError,
          });

          // FF clears all 24x40 = 960 page cells
          const isPageClear = !hasError && (ev.value & 0x7f) === C0.FF && changed.length === 960;
          if (isPageClear) {
            out.push({ atSample: globalSample, e: 'pageStart' });
            pageActive = true;
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
      out.push({
        atSample: chunkEndGlobalSample,
        e: 'pageEnd',
        screen: vtxDecoder.screen(),
      });
      pageActive = false;
    }

    return out;
  }

  return {
    init(nextSampleRate: number): FromWorker | null {
      sampleRate = nextSampleRate;
      streamSampleCursor = 0;
      demodSampleOrigin = 0;
      pageActive = false;
      lastCharGlobalSample = 0;
      activeTx = null;
      vtxDecoder.reset();
      spectrum.reset();
      simulator = modem.createSimulator(sampleRate, simParams);
      return createFreshDemodulator();
    },

    startTransmit({
      id,
      bytes,
      pageId,
      simulate,
      withConnectionSequence = false,
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
      };

      if (connectionAudio && demod) {
        demod.reset();
        demodSampleOrigin = streamSampleCursor;
      }

      return null;
    },

    nextTransmitBlock(): Extract<FromWorker, { t: 'block' }> | null {
      if (!activeTx || !demod || !simulator) {
        return null;
      }

      const blockSamples = Math.max(1, Math.round(BLOCK_DURATION_SEC * sampleRate));

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
          events,
          done: isAllDone,
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
      const isLastBlock = activeTx.pageOffset >= activeTx.pageAudio.length;

      const processed = activeTx.simulate
        ? simulator.process(cleanSlice)
        : cleanSlice.slice();
      const blockStartSample = streamSampleCursor;
      streamSampleCursor += processed.length;

      spectrum.pushSamples(processed);
      const rawEvents = demod.push(processed);
      if (isLastBlock) {
        const flushed = demod.flush();
        for (const f of flushed) {
          rawEvents.push(f);
        }
      }

      const events = convertDemodEvents(rawEvents, streamSampleCursor);
      if (isLastBlock && pageActive) {
        events.push({
          atSample: streamSampleCursor,
          e: 'pageEnd',
          screen: vtxDecoder.screen(),
        });
        pageActive = false;
      }

      const txId = activeTx.id;
      if (isLastBlock) {
        activeTx = null;
      }

      return {
        t: 'block',
        id: txId,
        audio: normalizeAudioForPlayback(processed),
        startSample: blockStartSample,
        events,
        done: isLastBlock,
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
    },

    setSim(nextSim: SimParams): void {
      simParams = { ...nextSim };
      simulator?.setSim(simParams);
    },

    setThreshold(mode: 'fixed' | 'adaptive'): void {
      thresholdMode = mode;
      demod?.setThresholdMode(mode);
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
      lastCharGlobalSample = 0;
      vtxDecoder.reset();
      spectrum.reset();
      demod?.reset();
      simulator?.reset();
    },
  };
}
