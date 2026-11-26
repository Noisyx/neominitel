import type { QualityEvent } from '../modem';
import {
  overlayInputFieldOnScreen,
  type InputFieldSpec,
  type RouterState,
} from '../services';
import {
  cloneCell,
  createBlankCell,
  createBlankScreen,
  SCREEN_COLS,
  SCREEN_ROWS,
  type Cell,
  type PaletteMode,
  type Screen,
} from '../videotex';
import {
  DEFAULT_SIM_PARAMS,
  type SimParams,
  type TimedEvent,
} from '../workers/protocol';
import type { BerPoint } from './hud/BerChart';
import {
  INITIAL_FILE_MODE_STATE,
  type FileModeState,
} from './screens/FileDrop';
import type { MicState } from './screens/MicPermission';
import type { LineMode } from './screens/ModeBar';
import { summarizeScreenForAria } from './terminal/ScreenCanvas';
import {
  createEmptyVoteStore,
  getActiveVoteSummary,
  preparePageVote,
  prepareWavVote,
  recordCompletedPageVote,
  selectDisplayedScreenForVote,
  type VoteStore,
} from './vote-manager';

export type SessionPhase = 'start' | 'connecting' | 'online';

export const NO_CARRIER_TIMEOUT_MS = 10_000;

export interface RxSamplePoint {
  readonly atSample: number;
  readonly chars: number;
}

export interface UiState {
  mode: LineMode;
  session: SessionPhase;
  router: RouterState | null;
  baseScreen: Screen;
  shown: Screen;
  pageComplete: boolean;
  completedAriaSummary: string;
  carrierOn: boolean;
  carrierEpoch: number;
  noCarrierHint: boolean;
  micState: MicState;
  micError?: string;
  rawOk?: boolean;
  rawAudioWarning: string | null;
  muted: boolean;
  palette: PaletteMode;
  crtEnabled: boolean;
  sim: SimParams;
  threshold: 'fixed' | 'adaptive';
  voteOn: boolean;
  votes: VoteStore;
  hudVisible: boolean;
  errors: { parity: number; framing: number };
  cps: number;
  rxHistory: readonly RxSamplePoint[];
  rxSampleRate: number;
  berPoints: readonly BerPoint[];
  autoRepeatTarget: number;
  file: FileModeState;
  quality?: QualityEvent;
  notice?: string;
}

export type UiAction =
  | { type: 'SWITCH_MODE'; mode: LineMode; standby: Screen }
  | { type: 'BEGIN_SESSION'; router: RouterState; unmuteSpeaker?: boolean }
  | {
      type: 'UPDATE_ROUTER_FOR_TRANSMIT';
      router: RouterState;
      resetVote?: boolean;
    }
  | { type: 'UPDATE_LOCAL_ECHO'; router: RouterState }
  | { type: 'DISCONNECT'; standby: Screen; notice?: string }
  | { type: 'MIC_ASKING' }
  | {
      type: 'MIC_STARTED';
      rawOk: boolean;
      rawAudioWarning: string | null;
    }
  | { type: 'MIC_DENIED'; message: string }
  | { type: 'SHOW_NO_CARRIER_HINT' }
  | { type: 'APPLY_TIMED_EVENTS'; events: TimedEvent[] }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_PALETTE' }
  | { type: 'TOGGLE_CRT' }
  | { type: 'TOGGLE_HUD_VISIBLE' }
  | { type: 'TOGGLE_THRESHOLD' }
  | { type: 'TOGGLE_VOTE' }
  | { type: 'SET_SIM'; sim: SimParams }
  | { type: 'CLEAR_BER_POINTS' }
  | { type: 'START_AUTO_REPEAT'; target: number }
  | { type: 'FILE_SET_REALTIME'; realtime: boolean }
  | { type: 'FILE_START'; fileName: string; realtime: boolean }
  | { type: 'FILE_PROGRESS'; done: number; total: number }
  | { type: 'FILE_FAST_COMPLETE'; events: TimedEvent[] }
  | { type: 'FILE_REALTIME_ENDED' }
  | { type: 'FILE_ERROR'; fileName?: string | null; message: string };

export function normalizeScreenDimensions(candidate: Screen): Screen {
  let valid = candidate.rows.length === SCREEN_ROWS;
  if (valid) {
    for (let r = 0; r < SCREEN_ROWS; r++) {
      if (candidate.rows[r]?.length !== SCREEN_COLS) {
        valid = false;
        break;
      }
    }
  }
  if (valid) {
    return candidate;
  }

  const rows: Cell[][] = [];
  for (let r = 0; r < SCREEN_ROWS; r++) {
    const srcRow = candidate.rows[r];
    const row: Cell[] = [];
    for (let c = 0; c < SCREEN_COLS; c++) {
      const cell = srcRow?.[c];
      row.push(cell ? cloneCell(cell) : createBlankCell());
    }
    rows.push(row);
  }
  return {
    rows,
    cursor: {
      row: Math.max(0, Math.min(SCREEN_ROWS - 1, candidate.cursor?.row ?? 0)),
      col: Math.max(0, Math.min(SCREEN_COLS - 1, candidate.cursor?.col ?? 0)),
      visible: Boolean(candidate.cursor?.visible),
    },
    attrs: { ...createBlankScreen().attrs, ...(candidate.attrs ?? {}) },
  };
}

export interface PipelineCleanupHooks {
  stopCapture(): void;
  stopTransmit(): void;
  stopPlayer(): void;
  clearScheduler(): void;
  resetWorker(): void;
}

/**
 * Pure mode-switch coordinator guaranteeing that switching modes stops any active
 * microphone capture or transmission before transitioning reducer state (Property A7).
 */
export function executeModeSwitch(
  prevState: UiState,
  nextMode: LineMode,
  standby: Screen,
  hooks: PipelineCleanupHooks,
): UiState {
  hooks.stopCapture();
  hooks.stopTransmit();
  hooks.stopPlayer();
  hooks.clearScheduler();
  hooks.resetWorker();
  return uiReducer(prevState, {
    type: 'SWITCH_MODE',
    mode: nextMode,
    standby,
  });
}

export function createInitialUiState(standby: Screen): UiState {
  const safeStandby = normalizeScreenDimensions(standby);
  return {
    mode: 'Seul',
    session: 'start',
    router: null,
    baseScreen: safeStandby,
    shown: safeStandby,
    pageComplete: false,
    completedAriaSummary: summarizeScreenForAria(safeStandby),
    carrierOn: false,
    carrierEpoch: 0,
    noCarrierHint: false,
    micState: 'off',
    rawAudioWarning: null,
    muted: false,
    palette: 'couleur',
    crtEnabled: true,
    sim: { ...DEFAULT_SIM_PARAMS },
    threshold: 'fixed',
    voteOn: true,
    votes: createEmptyVoteStore(),
    hudVisible: false,
    errors: { parity: 0, framing: 0 },
    cps: 0,
    rxHistory: [],
    rxSampleRate: 48000,
    berPoints: [],
    autoRepeatTarget: 0,
    file: INITIAL_FILE_MODE_STATE,
  };
}

export function applyTimedEventsToScreen(
  prev: Screen,
  events: readonly TimedEvent[],
): { screen: Screen; changed: boolean } {
  let rowsCopied = false;
  let nextRows = prev.rows;
  const clonedRowSet = new Set<number>();

  for (const ev of events) {
    if (ev.e !== 'diff') continue;
    for (const [r, c, cell] of ev.cells) {
      if (r < 0 || r >= nextRows.length || c < 0 || c >= nextRows[r].length) {
        continue;
      }
      if (!rowsCopied) {
        nextRows = prev.rows.slice();
        rowsCopied = true;
      }
      if (!clonedRowSet.has(r)) {
        nextRows[r] = nextRows[r].slice();
        clonedRowSet.add(r);
      }
      nextRows[r][c] = cloneCell(cell);
    }
  }

  if (!rowsCopied) {
    return { screen: prev, changed: false };
  }
  return {
    screen: {
      rows: nextRows,
      cursor: { ...prev.cursor },
      attrs: { ...prev.attrs },
    },
    changed: true,
  };
}

function upsertBerPoint(
  prev: readonly BerPoint[],
  incoming: BerPoint,
): readonly BerPoint[] {
  const roundedDb = Math.round(incoming.ebN0Db * 2) / 2;
  const filtered = prev.filter(
    (p) => Math.abs(p.ebN0Db - roundedDb) > 0.05,
  );
  return [...filtered, { ...incoming, ebN0Db: roundedDb }];
}

export function activeInputSpec(
  router: RouterState | null,
): InputFieldSpec | undefined {
  return router?.lastOutput.input;
}

export function resolvePublicAssetUrl(rawUrl: string): string {
  if (/^(https?:|blob:|data:)/i.test(rawUrl)) {
    return rawUrl;
  }
  const base =
    (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const cleanRel = rawUrl.replace(/^\/+/, '');
  return `${normalizedBase}${cleanRel}`;
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'SWITCH_MODE': {
      const safeStandby = normalizeScreenDimensions(action.standby);
      const nextScreen =
        action.mode === 'Ecoute' || action.mode === 'Fichier'
          ? createBlankScreen()
          : safeStandby;
      return {
        ...state,
        mode: action.mode,
        session: 'start',
        router: null,
        baseScreen: nextScreen,
        shown: nextScreen,
        pageComplete: false,
        completedAriaSummary: summarizeScreenForAria(nextScreen),
        carrierOn: false,
        carrierEpoch: state.carrierEpoch + 1,
        noCarrierHint: false,
        micState: 'off',
        micError: undefined,
        rawOk: undefined,
        rawAudioWarning: null,
        votes: createEmptyVoteStore(),
        errors: { parity: 0, framing: 0 },
        cps: 0,
        rxHistory: [],
        berPoints: [],
        autoRepeatTarget: 0,
        file: INITIAL_FILE_MODE_STATE,
        quality: undefined,
        notice: undefined,
      };
    }

    case 'BEGIN_SESSION': {
      const blank = createBlankScreen();
      const nextVotes = preparePageVote(
        createEmptyVoteStore(),
        action.router.lastOutput.pageId,
        action.router.lastOutput.bytes,
      );
      return {
        ...state,
        session: 'connecting',
        router: action.router,
        baseScreen: blank,
        shown: blank,
        pageComplete: false,
        completedAriaSummary: '',
        carrierOn: false,
        noCarrierHint: false,
        muted: action.unmuteSpeaker ? false : state.muted,
        votes: nextVotes,
        errors: { parity: 0, framing: 0 },
        cps: 0,
        rxHistory: [],
        berPoints: [],
        autoRepeatTarget: 0,
        quality: undefined,
        notice: undefined,
      };
    }

    case 'UPDATE_ROUTER_FOR_TRANSMIT': {
      const isWavOutput = action.router.lastOutput.playWav !== undefined;
      const sameWav =
        isWavOutput &&
        !action.resetVote &&
        state.router?.lastOutput.playWav === action.router.lastOutput.playWav;

      let nextVotes: VoteStore;
      if (isWavOutput) {
        nextVotes = sameWav
          ? prepareWavVote(state.votes)
          : createEmptyVoteStore();
      } else {
        const baseVotes = action.resetVote ? createEmptyVoteStore() : state.votes;
        nextVotes = preparePageVote(
          baseVotes,
          action.router.lastOutput.pageId,
          action.router.lastOutput.bytes,
        );
      }

      const samePage =
        !action.resetVote &&
        state.router?.lastOutput.pageId === action.router.lastOutput.pageId;
      const nextBase =
        isWavOutput && !sameWav ? createBlankScreen() : state.baseScreen;

      const enteringMaths =
        action.router.activeServiceId === 'MATHS' &&
        state.router?.activeServiceId !== 'MATHS';

      return {
        ...state,
        session: state.session === 'start' ? 'connecting' : 'online',
        router: action.router,
        baseScreen: nextBase,
        shown: overlayInputFieldOnScreen(nextBase, undefined, ''),
        pageComplete: false,
        hudVisible: enteringMaths ? true : state.hudVisible,
        votes: nextVotes,
        cps: 0,
        rxHistory: [],
        autoRepeatTarget: samePage ? state.autoRepeatTarget : 0,
        notice: undefined,
      };
    }

    case 'UPDATE_LOCAL_ECHO': {
      const field = activeInputSpec(action.router);
      const nextShown = state.pageComplete
        ? overlayInputFieldOnScreen(
            state.baseScreen,
            field,
            action.router.inputBuffer,
          )
        : state.shown;
      return {
        ...state,
        router: action.router,
        shown: nextShown,
      };
    }

    case 'DISCONNECT': {
      const safeStandby = normalizeScreenDimensions(action.standby);
      return {
        ...state,
        session: 'start',
        router: null,
        baseScreen: safeStandby,
        shown: safeStandby,
        pageComplete: false,
        completedAriaSummary: summarizeScreenForAria(safeStandby),
        carrierOn: false,
        noCarrierHint: false,
        micState: 'off',
        votes: createEmptyVoteStore(),
        errors: { parity: 0, framing: 0 },
        cps: 0,
        rxHistory: [],
        berPoints: [],
        autoRepeatTarget: 0,
        file: INITIAL_FILE_MODE_STATE,
        quality: undefined,
        notice: action.notice,
      };
    }

    case 'MIC_ASKING': {
      const blank = createBlankScreen();
      return {
        ...state,
        session: 'connecting',
        micState: 'asking',
        micError: undefined,
        noCarrierHint: false,
        carrierOn: false,
        baseScreen: blank,
        shown: blank,
        votes: createEmptyVoteStore(),
        errors: { parity: 0, framing: 0 },
        cps: 0,
        rxHistory: [],
      };
    }

    case 'MIC_STARTED':
      return {
        ...state,
        session: 'online',
        micState: 'on',
        micError: undefined,
        rawOk: action.rawOk,
        rawAudioWarning: action.rawAudioWarning,
        carrierOn: false,
        carrierEpoch: state.carrierEpoch + 1,
        noCarrierHint: false,
      };

    case 'MIC_DENIED':
      return {
        ...state,
        session: 'start',
        micState: 'denied',
        micError: action.message,
        carrierOn: false,
        noCarrierHint: false,
      };

    case 'SHOW_NO_CARRIER_HINT':
      if (state.mode !== 'Ecoute' || state.micState !== 'on' || state.carrierOn) {
        return state;
      }
      return {
        ...state,
        noCarrierHint: true,
      };

    case 'APPLY_TIMED_EVENTS': {
      let nextSession = state.session;
      let nextCarrier = state.carrierOn;
      let nextEpoch = state.carrierEpoch;
      let nextNoCarrierHint = state.noCarrierHint;
      let nextQuality = state.quality;
      let nextAria = state.completedAriaSummary;
      let nextPageComplete = state.pageComplete;
      let nextVotes = state.votes;
      let nextParity = state.errors.parity;
      let nextFraming = state.errors.framing;
      let nextSampleRate = state.rxSampleRate;
      let nextCps = state.cps;
      let rxHistoryMut: RxSamplePoint[] | null = null;
      let nextBerPoints = state.berPoints;
      let nextAutoRepeatTarget = state.autoRepeatTarget;

      const { screen: diffedBase } = applyTimedEventsToScreen(
        state.baseScreen,
        action.events,
      );
      let nextBase = diffedBase;

      const getMutableHistory = (): RxSamplePoint[] => {
        if (rxHistoryMut === null) {
          rxHistoryMut = state.rxHistory.slice();
        }
        return rxHistoryMut;
      };

      for (const ev of action.events) {
        switch (ev.e) {
          case 'connect':
            if (nextSession === 'connecting') {
              nextSession = 'online';
            }
            nextNoCarrierHint = false;
            nextEpoch++;
            break;
          case 'carrier':
            nextCarrier = ev.on;
            nextEpoch++;
            if (ev.on) {
              nextNoCarrierHint = false;
              if (nextSession === 'connecting') {
                nextSession = 'online';
              }
            } else {
              nextCps = 0;
              rxHistoryMut = [];
            }
            break;
          case 'rxStats': {
            nextParity += ev.parityErrors;
            nextFraming += ev.framingErrors;
            if (ev.sampleRate > 0) {
              nextSampleRate = ev.sampleRate;
            }
            const hist = getMutableHistory();
            if (
              hist.length > 0 &&
              ev.atSample < hist[hist.length - 1].atSample
            ) {
              hist.length = 0;
            }
            hist.push({ atSample: ev.atSample, chars: ev.chars });
            const windowSamples = 0.5 * nextSampleRate;
            while (
              hist.length > 0 &&
              ev.atSample - hist[0].atSample > windowSamples
            ) {
              hist.shift();
            }
            if (hist.length >= 2) {
              const dtSec =
                (hist[hist.length - 1].atSample - hist[0].atSample) /
                nextSampleRate;
              if (dtSec >= 0.015) {
                let totalAfterFirst = 0;
                for (let i = 1; i < hist.length; i++) {
                  totalAfterFirst += hist[i].chars;
                }
                nextCps = Math.min(999, totalAfterFirst / dtSec);
              }
            }
            break;
          }
          case 'diff':
            nextNoCarrierHint = false;
            break;
          case 'pageStart':
            if (nextSession === 'connecting') {
              nextSession = 'online';
            }
            nextNoCarrierHint = false;
            nextPageComplete = false;
            break;
          case 'pageEnd': {
            const safeScreen = normalizeScreenDimensions(ev.screen);
            nextVotes = recordCompletedPageVote(
              nextVotes,
              safeScreen,
              state.mode,
            );
            nextBase = selectDisplayedScreenForVote(
              nextVotes,
              state.voteOn,
              safeScreen,
            );
            nextPageComplete = true;
            nextAria = summarizeScreenForAria(nextBase);
            nextCps = 0;
            rxHistoryMut = [];
            const activeSummary = getActiveVoteSummary(nextVotes);
            if (
              nextAutoRepeatTarget > 0 &&
              activeSummary &&
              activeSummary.receptions >= nextAutoRepeatTarget
            ) {
              nextAutoRepeatTarget = 0;
            }
            break;
          }
          case 'ber': {
            const ber = ev.bits > 0 ? ev.errors / ev.bits : 0;
            nextBerPoints = upsertBerPoint(nextBerPoints, {
              ebN0Db: ev.ebN0Db,
              bits: ev.bits,
              errors: ev.errors,
              ber,
              lo: ev.lo,
              hi: ev.hi,
            });
            break;
          }
          case 'quality': {
            nextQuality = ev.q;
            const histRef = rxHistoryMut ?? state.rxHistory;
            if (
              histRef.length > 0 &&
              ev.atSample - histRef[histRef.length - 1].atSample >
                0.25 * nextSampleRate
            ) {
              nextCps = 0;
              rxHistoryMut = [];
            }
            break;
          }
          default:
            break;
        }
      }

      const field = activeInputSpec(state.router);
      const nextShown =
        nextPageComplete && state.router
          ? overlayInputFieldOnScreen(
              nextBase,
              field,
              state.router.inputBuffer,
            )
          : nextBase;

      const errorsChanged =
        nextParity !== state.errors.parity ||
        nextFraming !== state.errors.framing;

      return {
        ...state,
        session: nextSession,
        carrierOn: nextCarrier,
        carrierEpoch: nextEpoch,
        noCarrierHint: nextNoCarrierHint,
        baseScreen: nextBase,
        shown: nextShown,
        pageComplete: nextPageComplete,
        completedAriaSummary: nextAria,
        votes: nextVotes,
        errors: errorsChanged
          ? { parity: nextParity, framing: nextFraming }
          : state.errors,
        cps: nextCps,
        rxHistory: rxHistoryMut ?? state.rxHistory,
        rxSampleRate: nextSampleRate,
        berPoints: nextBerPoints,
        autoRepeatTarget: nextAutoRepeatTarget,
        quality: nextQuality,
      };
    }

    case 'TOGGLE_MUTE':
      return { ...state, muted: !state.muted };

    case 'TOGGLE_PALETTE':
      return {
        ...state,
        palette: state.palette === 'couleur' ? 'nb' : 'couleur',
      };

    case 'TOGGLE_CRT':
      return { ...state, crtEnabled: !state.crtEnabled };

    case 'TOGGLE_HUD_VISIBLE':
      return { ...state, hudVisible: !state.hudVisible };

    case 'TOGGLE_THRESHOLD':
      return {
        ...state,
        threshold: state.threshold === 'adaptive' ? 'fixed' : 'adaptive',
      };

    case 'TOGGLE_VOTE': {
      const nextVoteOn = !state.voteOn;
      if (!state.pageComplete) {
        return { ...state, voteOn: nextVoteOn };
      }
      const nextBase = selectDisplayedScreenForVote(
        state.votes,
        nextVoteOn,
        state.baseScreen,
      );
      const field = activeInputSpec(state.router);
      const nextShown = state.router
        ? overlayInputFieldOnScreen(nextBase, field, state.router.inputBuffer)
        : nextBase;
      return {
        ...state,
        voteOn: nextVoteOn,
        baseScreen: nextBase,
        shown: nextShown,
        completedAriaSummary: summarizeScreenForAria(nextBase),
      };
    }

    case 'SET_SIM':
      return { ...state, sim: { ...action.sim } };

    case 'CLEAR_BER_POINTS':
      return { ...state, berPoints: [] };

    case 'START_AUTO_REPEAT':
      return { ...state, autoRepeatTarget: action.target };

    case 'FILE_SET_REALTIME':
      return {
        ...state,
        file: { ...state.file, realtime: action.realtime },
      };

    case 'FILE_START': {
      const blank = createBlankScreen();
      return {
        ...state,
        session: action.realtime ? 'connecting' : 'online',
        baseScreen: blank,
        shown: blank,
        pageComplete: false,
        completedAriaSummary: '',
        carrierOn: false,
        noCarrierHint: false,
        votes: createEmptyVoteStore(),
        errors: { parity: 0, framing: 0 },
        cps: 0,
        rxHistory: [],
        berPoints: [],
        autoRepeatTarget: 0,
        quality: undefined,
        notice: undefined,
        file: {
          status: action.realtime ? 'playing-realtime' : 'decoding-fast',
          fileName: action.fileName,
          progressPct: 0,
          realtime: action.realtime,
          errorMessage: null,
        },
      };
    }

    case 'FILE_PROGRESS': {
      if (state.mode !== 'Fichier') {
        return state;
      }
      const pct =
        action.total > 0
          ? Math.min(100, Math.max(0, Math.round((action.done / action.total) * 100)))
          : 0;
      return {
        ...state,
        file: { ...state.file, progressPct: pct },
      };
    }

    case 'FILE_FAST_COMPLETE': {
      const applied = uiReducer(state, {
        type: 'APPLY_TIMED_EVENTS',
        events: action.events,
      });
      return {
        ...applied,
        session: 'online',
        pageComplete: true,
        completedAriaSummary: summarizeScreenForAria(applied.shown),
        cps: 0,
        file: {
          ...applied.file,
          status: 'done',
          progressPct: 100,
          errorMessage: null,
        },
      };
    }

    case 'FILE_REALTIME_ENDED': {
      if (state.mode !== 'Fichier') {
        return state;
      }
      return {
        ...state,
        session: 'online',
        carrierOn: false,
        cps: 0,
        completedAriaSummary: summarizeScreenForAria(state.shown),
        file: {
          ...state.file,
          status: 'done',
          progressPct: 100,
        },
      };
    }

    case 'FILE_ERROR': {
      return {
        ...state,
        session: 'start',
        carrierOn: false,
        cps: 0,
        file: {
          ...state.file,
          status: 'error',
          fileName:
            action.fileName !== undefined
              ? action.fileName
              : state.file.fileName,
          progressPct: 0,
          errorMessage: action.message,
        },
      };
    }
  }
}
