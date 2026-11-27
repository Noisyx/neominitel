import type { ChannelId, DiagEvent, ModemError, QualityEvent } from '../modem';
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
  /** Receive channel of the demodulator (3615 FANTOME L5, "Écoute voie retour"); default 'forward'. */
  | { t: 'setRxChannel'; channel: ChannelId }
  | { t: 'capturePort'; port: MessagePort; sampleRate: number }
  | { t: 'stopCapture' }
  | { t: 'decodeFile'; id?: number; data: ArrayBuffer; realtime: boolean }
  /** 3615 LIBRE: modulate a page (with the connection sequence) into a 16-bit WAV file. */
  | { t: 'exportWav'; id: number; bytes: Uint8Array }
  /** Backward keyboard, terminal side: modulate these bytes at 75 baud for the speaker. */
  | { t: 'sendBackward'; id: number; bytes: Uint8Array; sampleRate: number }
  /** Backward keyboard, server side: microphone port for the backward key receiver. */
  | { t: 'backCapturePort'; port: MessagePort; sampleRate: number }
  | { t: 'stopBackCapture' }
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
  /** Backward keyboard (task 17): a character typed on the terminal device. */
  | { e: 'keyChar'; char: string }
);

export type WorkerError = ModemError | { kind: 'internal'; message: string };

export type FromWorker =
  | {
      t: 'block';
      id: number;
      audio: Float32Array;
      startSample: number;
      sampleRate?: number;
      events: TimedEvent[];
      done?: boolean;
    }
  | { t: 'live'; events: TimedEvent[] }
  | { t: 'fileProgress'; done: number; total: number }
  | { t: 'wavExport'; id: number; data: ArrayBuffer }
  | { t: 'backAudio'; id: number; audio: Float32Array; sampleRate: number }
  | { t: 'error'; error: WorkerError };
