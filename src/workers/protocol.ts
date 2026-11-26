import type { DiagEvent, ModemError, QualityEvent } from '../modem';
import type { Cell, FunctionKey, Screen } from '../videotex';

export interface SimParams {
  ebN0Db: number | null;
  offsetHz: number;
  clockPct: number;
  hum: boolean;
  bursts: boolean;
  seed: number;
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  ebN0Db: null,
  offsetHz: 0,
  clockPct: 0,
  hum: false,
  bursts: false,
  seed: 0x1985_3615,
};

export type ToWorker =
  | { t: 'init'; sampleRate: number }
  | {
      t: 'transmit';
      id: number;
      bytes: Uint8Array;
      pageId: string;
      simulate: boolean;
      /** When true, prepend the V.23 connection sequence (2100 Hz answer tone + carrier) before the page. */
      withConnectionSequence?: boolean;
      /** 3615 MATHS bench: stream this many PN9 frames right after the Videotex page completes. */
      testPattern?: { frames: number };
    }
  | { t: 'ackBlock'; id: number }
  | { t: 'stopTransmit' }
  | { t: 'setSim'; sim: SimParams }
  | { t: 'setThreshold'; mode: 'fixed' | 'adaptive' }
  | { t: 'capturePort'; port: MessagePort; sampleRate: number }
  | { t: 'stopCapture' }
  | { t: 'decodeFile'; data: ArrayBuffer; realtime: boolean }
  | { t: 'reset' };

export type TimedEvent = { atSample: number } & (
  | { e: 'diff'; cells: [row: number, col: number, cell: Cell][] }
  | {
      e: 'rxStats';
      chars: number;
      parityErrors: number;
      framingErrors: number;
      sampleRate: number;
    }
  | { e: 'pageStart' }
  | { e: 'pageEnd'; screen: Screen }
  | { e: 'carrier'; on: boolean }
  | { e: 'connect' }
  | { e: 'quality'; q: QualityEvent }
  | { e: 'diag'; d: DiagEvent; spectrumDb: Float32Array; sampleRate: number }
  | {
      e: 'ber';
      ebN0Db: number;
      bits: number;
      errors: number;
      lo: number;
      hi: number;
    }
  | { e: 'key'; key: FunctionKey }
);

export type WorkerError = ModemError | { kind: 'internal'; message: string };

export type FromWorker =
  | {
      t: 'block';
      id: number;
      audio: Float32Array;
      startSample: number;
      events: TimedEvent[];
      done?: boolean;
    }
  | { t: 'live'; events: TimedEvent[] }
  | { t: 'fileProgress'; done: number; total: number }
  | { t: 'error'; error: WorkerError };
