import type { FunctionKey } from '../videotex';

export type { FunctionKey };

export type ServiceId = 'SOMMAIRE' | 'MATHS' | 'FANTOME' | 'LIBRE';

export interface ServiceInput {
  kind: 'key';
  key: FunctionKey;
  /** Current text of the terminal's local input field. */
  text: string;
}

export interface InputFieldSpec {
  /** 1-indexed page row (1..24). */
  row: number;
  /** 1-indexed starting column (1..40). */
  col: number;
  /** Maximum number of characters accepted in this field. */
  maxLength: number;
}

export interface ServiceOutput {
  /** Stable page identifier used for per-page majority voting. */
  pageId: string;
  /** 7-bit Videotex stream produced by `encodePage`. */
  bytes: Uint8Array;
  /** Optional local-echo input field active on this page. */
  input?: InputFieldSpec;
  /** 3615 MATHS bench: append PN9 test frames after the page. */
  testPattern?: { frames: number };
  /** 3615 FANTOME: stream and decode this WAV path instead of `bytes` (simulator off). */
  playWav?: string;
  /** 3615 FANTOME: optional direct WAV link so the player can play it from another device. */
  downloadWav?: {
    readonly url: string;
    readonly filename: string;
    readonly label: string;
  };
}

export interface Service<S> {
  id: ServiceId;
  init(): [S, ServiceOutput];
  handle(s: S, input: ServiceInput): [S, ServiceOutput | null];
}
