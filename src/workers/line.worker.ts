import { createLineEngine, MAX_BLOCKS_AHEAD } from './line-engine';
import type { FromWorker, ToWorker } from './protocol';

interface DedicatedWorkerGlobal {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}

const workerScope = self as unknown as DedicatedWorkerGlobal;
const engine = createLineEngine();

let blocksInFlight = 0;
let activeCapturePort: MessagePort | null = null;
let captureSampleRate = 48000;
let captureAccumulator: Float32Array = new Float32Array(0);

function postFromWorker(msg: FromWorker): void {
  if (msg.t === 'block') {
    const transfer: Transferable[] = [msg.audio.buffer];
    for (const ev of msg.events) {
      if (ev.e === 'diag') {
        transfer.push(ev.spectrumDb.buffer);
      }
    }
    workerScope.postMessage(msg, transfer);
    return;
  }
  if (msg.t === 'live') {
    const transfer: Transferable[] = [];
    for (const ev of msg.events) {
      if (ev.e === 'diag') {
        transfer.push(ev.spectrumDb.buffer);
      }
    }
    workerScope.postMessage(msg, transfer);
    return;
  }
  workerScope.postMessage(msg);
}

function pumpTransmitBlocks(): void {
  while (engine.hasActiveTransmit() && blocksInFlight < MAX_BLOCKS_AHEAD) {
    const next = engine.nextTransmitBlock();
    if (!next) {
      break;
    }
    blocksInFlight++;
    postFromWorker(next);
    if (next.done) {
      break;
    }
  }
}

function detachCapturePort(): void {
  if (activeCapturePort) {
    activeCapturePort.onmessage = null;
    activeCapturePort.close();
    activeCapturePort = null;
  }
  captureAccumulator = new Float32Array(0);
}

workerScope.onmessage = (event: MessageEvent<ToWorker>): void => {
  const msg = event.data;
  try {
    switch (msg.t) {
      case 'init': {
        blocksInFlight = 0;
        const err = engine.init(msg.sampleRate);
        if (err) {
          postFromWorker(err);
        }
        break;
      }

      case 'transmit': {
        blocksInFlight = 0;
        const err = engine.startTransmit({
          id: msg.id,
          bytes: msg.bytes,
          pageId: msg.pageId,
          simulate: msg.simulate,
          withConnectionSequence: msg.withConnectionSequence,
          testPattern: msg.testPattern,
        });
        if (err) {
          postFromWorker(err);
          break;
        }
        pumpTransmitBlocks();
        break;
      }

      case 'ackBlock': {
        if (engine.activeTransmitId() === msg.id || engine.hasActiveTransmit()) {
          blocksInFlight = Math.max(0, blocksInFlight - 1);
          pumpTransmitBlocks();
        } else {
          blocksInFlight = 0;
        }
        break;
      }

      case 'stopTransmit': {
        blocksInFlight = 0;
        engine.stopTransmit();
        break;
      }

      case 'setSim': {
        engine.setSim(msg.sim);
        break;
      }

      case 'setThreshold': {
        engine.setThreshold(msg.mode);
        break;
      }

      case 'capturePort': {
        detachCapturePort();
        engine.stopTransmit();
        blocksInFlight = 0;
        captureSampleRate = msg.sampleRate;
        const initErr = engine.init(captureSampleRate);
        if (initErr) {
          postFromWorker(initErr);
          break;
        }
        activeCapturePort = msg.port;
        const targetChunkSamples = Math.max(128, Math.round(0.02 * captureSampleRate));
        activeCapturePort.onmessage = (portEv: MessageEvent<Float32Array>): void => {
          const frame = portEv.data;
          if (!(frame instanceof Float32Array) || frame.length === 0) return;
          const merged = new Float32Array(captureAccumulator.length + frame.length);
          merged.set(captureAccumulator, 0);
          merged.set(frame, captureAccumulator.length);
          captureAccumulator = merged;

          while (captureAccumulator.length >= targetChunkSamples) {
            const slice = captureAccumulator.slice(0, targetChunkSamples);
            captureAccumulator = captureAccumulator.slice(targetChunkSamples);
            const liveMsg = engine.pushLiveCaptureChunk(slice);
            if (liveMsg) {
              postFromWorker(liveMsg);
            }
          }
        };
        break;
      }

      case 'stopCapture': {
        detachCapturePort();
        break;
      }

      case 'decodeFile': {
        blocksInFlight = 0;
        detachCapturePort();
        if (msg.realtime) {
          const err = engine.startRealtimeWav({
            id: msg.id ?? 1,
            data: msg.data,
          });
          if (err) {
            postFromWorker(err);
            break;
          }
          pumpTransmitBlocks();
        } else {
          const res = engine.decodeWavFast(msg.data, (done, total) => {
            postFromWorker({ t: 'fileProgress', done, total });
          });
          postFromWorker(res);
        }
        break;
      }

      case 'reset': {
        blocksInFlight = 0;
        detachCapturePort();
        engine.reset();
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postFromWorker({ t: 'error', error: { kind: 'internal', message } });
  }
};
