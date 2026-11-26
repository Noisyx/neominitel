import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactElement,
} from 'react';
import {
  startMicrophoneCapture,
  type ActiveMicCapture,
} from '../audio/capture';
import { createGaplessPlayer, type GaplessPlayer } from '../audio/playback';
import { ANSWER_TONE_HZ, CHANNELS, FRAME, type QualityEvent } from '../modem';
import {
  ALL_SERVICE_IDS,
  connectRouter,
  getServiceById,
  overlayInputFieldOnScreen,
  stepRouterChar,
  stepRouterKey,
  stepRouterSetInput,
  type InputFieldSpec,
  type RouterEffect,
  type RouterState,
  type ServiceId,
  type ServiceOutput,
} from '../services';
import {
  cloneCell,
  createBlankScreen,
  type FunctionKey,
  type PaletteMode,
  type Screen,
} from '../videotex';
import {
  DEFAULT_SIM_PARAMS,
  type FromWorker,
  type SimParams,
  type TimedEvent,
  type ToWorker,
} from '../workers/protocol';
import {
  createHudSignalBuffer,
  pushDiagToHudBuffer,
  resetHudSignalBuffer,
  type HudSignalBuffer,
} from './hud/hudStore';
import { type BerPoint } from './hud/BerChart';
import { MathHud } from './hud/MathHud';
import {
  createEventScheduler,
  startRafScheduler,
  type EventScheduler,
} from './scheduler';
import { MicPermission, type MicState } from './screens/MicPermission';
import { ModeBar, type LineMode } from './screens/ModeBar';
import {
  decodePageSourceToScreen,
  STANDBY_PAGE_SOURCE,
} from './screens/previewPages';
import { SimControls } from './screens/SimControls';
import { StartScreen } from './screens/StartScreen';
import {
  FunctionKeys,
  mapKeyboardEventToMinitel,
} from './terminal/FunctionKeys';
import { InputOverlay } from './terminal/InputOverlay';
import { MinitelShell } from './terminal/MinitelShell';
import { ScreenCanvas, summarizeScreenForAria } from './terminal/ScreenCanvas';
import {
  createEmptyVoteStore,
  getActiveVoteProgression,
  getActiveVoteSummary,
  preparePageVote,
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
  | { type: 'START_AUTO_REPEAT'; target: number };

export function createInitialUiState(standby: Screen): UiState {
  return {
    mode: 'Seul',
    session: 'start',
    router: null,
    baseScreen: standby,
    shown: standby,
    pageComplete: false,
    completedAriaSummary: '',
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
    hudVisible: true,
    errors: { parity: 0, framing: 0 },
    cps: 0,
    rxHistory: [],
    rxSampleRate: 48000,
    berPoints: [],
    autoRepeatTarget: 0,
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

function activeInputSpec(router: RouterState | null): InputFieldSpec | undefined {
  return router?.lastOutput.input;
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'SWITCH_MODE': {
      const nextScreen =
        action.mode === 'Ecoute' ? createBlankScreen() : action.standby;
      return {
        ...state,
        mode: action.mode,
        session: 'start',
        router: null,
        baseScreen: nextScreen,
        shown: nextScreen,
        pageComplete: false,
        completedAriaSummary: '',
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
      const baseVotes = action.resetVote ? createEmptyVoteStore() : state.votes;
      const nextVotes = preparePageVote(
        baseVotes,
        action.router.lastOutput.pageId,
        action.router.lastOutput.bytes,
      );
      const samePage =
        !action.resetVote &&
        state.router?.lastOutput.pageId === action.router.lastOutput.pageId;
      return {
        ...state,
        session: state.session === 'start' ? 'connecting' : 'online',
        router: action.router,
        shown: overlayInputFieldOnScreen(state.baseScreen, undefined, ''),
        pageComplete: false,
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

    case 'DISCONNECT':
      return {
        ...state,
        session: 'start',
        router: null,
        baseScreen: action.standby,
        shown: action.standby,
        pageComplete: false,
        completedAriaSummary: '',
        carrierOn: false,
        noCarrierHint: false,
        micState: 'off',
        votes: createEmptyVoteStore(),
        errors: { parity: 0, framing: 0 },
        cps: 0,
        rxHistory: [],
        berPoints: [],
        autoRepeatTarget: 0,
        quality: undefined,
        notice: action.notice,
      };

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
            nextVotes = recordCompletedPageVote(nextVotes, ev.screen, state.mode);
            nextBase = selectDisplayedScreenForVote(
              nextVotes,
              state.voteOn,
              ev.screen,
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
  }
}

export function App(): ReactElement {
  const standbyScreen = useMemo(
    () => decodePageSourceToScreen(STANDBY_PAGE_SOURCE),
    [],
  );

  const [state, dispatch] = useReducer(
    uiReducer,
    standbyScreen,
    createInitialUiState,
  );

  const stateRef = useRef<UiState>(state);
  stateRef.current = state;

  const playerRef = useRef<GaplessPlayer | null>(null);
  const micCaptureRef = useRef<ActiveMicCapture | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerInitializedRef = useRef<boolean>(false);
  const schedulerRef = useRef<EventScheduler<TimedEvent>>(
    createEventScheduler<TimedEvent>(),
  );
  const txIdRef = useRef<number>(0);
  const hudBufferRef = useRef<HudSignalBuffer>(createHudSignalBuffer());

  const postToWorker = useCallback(
    (msg: ToWorker, transfer?: Transferable[]): void => {
      if (!workerRef.current) return;
      if (transfer && transfer.length > 0) {
        workerRef.current.postMessage(msg, transfer);
      } else {
        workerRef.current.postMessage(msg);
      }
    },
    [],
  );

  const stopAllPipelines = useCallback((): void => {
    txIdRef.current += 1;
    if (micCaptureRef.current) {
      micCaptureRef.current.stop();
      micCaptureRef.current = null;
      postToWorker({ t: 'stopCapture' });
    }
    postToWorker({ t: 'stopTransmit' });
    playerRef.current?.stopAll();
    schedulerRef.current.clear();
  }, [postToWorker]);

  const spawnLineWorker = useCallback((): Worker | null => {
    if (typeof Worker === 'undefined') {
      return null;
    }
    const worker = new Worker(
      new URL('../workers/line.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<FromWorker>): void => {
      const msg = event.data;
      switch (msg.t) {
        case 'block': {
          if (msg.id !== txIdRef.current) {
            return;
          }
          // Enqueue all events (including diag) so HUD canvases draw in exact sync with audio playback
          if (msg.events.length > 0) {
            schedulerRef.current.enqueue(msg.events);
          }

          playerRef.current?.scheduleBlock({
            id: msg.id,
            audio: msg.audio,
            startSample: msg.startSample,
            onEnded: (endedId) => {
              if (endedId === txIdRef.current) {
                worker.postMessage({ t: 'ackBlock', id: endedId } satisfies ToWorker);
              }
            },
          });
          break;
        }

        case 'live': {
          if (stateRef.current.mode !== 'Ecoute') {
            return;
          }
          const nonDiag: TimedEvent[] = [];
          for (const ev of msg.events) {
            if (ev.e === 'diag') {
              pushDiagToHudBuffer(
                hudBufferRef.current,
                ev.d,
                ev.spectrumDb,
                ev.sampleRate,
              );
            } else {
              nonDiag.push(ev);
            }
          }
          if (nonDiag.length > 0) {
            dispatch({ type: 'APPLY_TIMED_EVENTS', events: nonDiag });
          }
          break;
        }

        case 'error': {
          stopAllPipelines();
          workerInitializedRef.current = false;
          resetHudSignalBuffer(hudBufferRef.current);
          dispatch({
            type: 'DISCONNECT',
            standby: standbyScreen,
            notice: 'Erreur modem : retour à l’accueil.',
          });
          break;
        }

        case 'fileProgress':
          break;
      }
    };

    worker.onerror = (): void => {
      worker.terminate();
      workerRef.current = null;
      workerInitializedRef.current = false;
      stopAllPipelines();
      resetHudSignalBuffer(hudBufferRef.current);
      dispatch({
        type: 'DISCONNECT',
        standby: standbyScreen,
        notice: 'Ligne coupée, reconnexion…',
      });
    };

    workerRef.current = worker;
    workerInitializedRef.current = false;
    return worker;
  }, [standbyScreen, stopAllPipelines]);

  useEffect(() => {
    playerRef.current = createGaplessPlayer(false);
    const scheduler = schedulerRef.current;

    const rafLoop = startRafScheduler(
      scheduler,
      () => playerRef.current?.currentSample() ?? 0,
      (dueEvents) => {
        const reducerEvents: TimedEvent[] = [];
        for (const ev of dueEvents) {
          if (ev.e === 'diag') {
            pushDiagToHudBuffer(
              hudBufferRef.current,
              ev.d,
              ev.spectrumDb,
              ev.sampleRate,
            );
          } else {
            reducerEvents.push(ev);
          }
        }
        if (reducerEvents.length > 0) {
          dispatch({ type: 'APPLY_TIMED_EVENTS', events: reducerEvents });
        }
      },
    );

    return () => {
      rafLoop.stop();
      scheduler.clear();
      micCaptureRef.current?.stop();
      micCaptureRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  // Requirement 10.3: 10 s no-carrier hint in Écoute mode
  useEffect(() => {
    if (
      state.mode !== 'Ecoute' ||
      state.micState !== 'on' ||
      state.carrierOn
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      dispatch({ type: 'SHOW_NO_CARRIER_HINT' });
    }, NO_CARRIER_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [state.mode, state.micState, state.carrierOn, state.carrierEpoch]);

  const startEcouteMicrophone = useCallback(async (): Promise<void> => {
    stopAllPipelines();
    dispatch({ type: 'MIC_ASKING' });

    const captureRes = await startMicrophoneCapture();
    // Guard against mode switch while user was answering the browser prompt
    if (stateRef.current.mode !== 'Ecoute') {
      if (captureRes.ok) {
        captureRes.value.stop();
      }
      return;
    }

    if (!captureRes.ok) {
      dispatch({ type: 'MIC_DENIED', message: captureRes.error.message });
      return;
    }

    const capture = captureRes.value;
    micCaptureRef.current = capture;

    const worker = workerRef.current ?? spawnLineWorker();
    if (!worker) {
      capture.stop();
      micCaptureRef.current = null;
      dispatch({
        type: 'MIC_DENIED',
        message: 'Web Worker indisponible sur ce navigateur.',
      });
      return;
    }

    workerInitializedRef.current = false;
    resetHudSignalBuffer(hudBufferRef.current);
    postToWorker(
      {
        t: 'capturePort',
        port: capture.workerPort,
        sampleRate: capture.sampleRate,
      },
      [capture.workerPort],
    );
    postToWorker({ t: 'setThreshold', mode: stateRef.current.threshold });

    dispatch({
      type: 'MIC_STARTED',
      rawOk: capture.rawCheck.rawOk,
      rawAudioWarning: capture.rawCheck.warningMessage,
    });
  }, [postToWorker, spawnLineWorker, stopAllPipelines]);

  const handleSelectMode = useCallback(
    (nextMode: LineMode): void => {
      stopAllPipelines();
      postToWorker({ t: 'reset' });
      workerInitializedRef.current = false;
      resetHudSignalBuffer(hudBufferRef.current);
      dispatch({ type: 'SWITCH_MODE', mode: nextMode, standby: standbyScreen });

      if (nextMode === 'Ecoute') {
        void startEcouteMicrophone();
      }
    },
    [postToWorker, standbyScreen, startEcouteMicrophone, stopAllPipelines],
  );

  const transmitServiceOutput = useCallback(
    async (
      output: ServiceOutput,
      withConnectionSequence: boolean,
      forceReinit = false,
    ): Promise<void> => {
      const player = playerRef.current;
      if (!player) return;

      player.stopAll();
      schedulerRef.current.clear();

      const isServerMode = stateRef.current.mode === 'Serveur';
      if (isServerMode) {
        player.setMuted(false);
      }

      const sampleRate = await player.ensureStarted();
      const worker = workerRef.current ?? spawnLineWorker();
      if (!worker) return;

      const nextId = txIdRef.current + 1;
      txIdRef.current = nextId;

      if (!workerInitializedRef.current || withConnectionSequence || forceReinit) {
        postToWorker({ t: 'init', sampleRate });
        workerInitializedRef.current = true;
      } else {
        postToWorker({ t: 'stopTransmit' });
      }

      postToWorker({ t: 'setThreshold', mode: stateRef.current.threshold });
      postToWorker({ t: 'setSim', sim: stateRef.current.sim });
      postToWorker({
        t: 'transmit',
        id: nextId,
        bytes: output.bytes.slice(),
        pageId: output.pageId,
        // Serveur mode plays clean V.23 audio on the speaker; Seul mode runs through the simulator
        simulate: !isServerMode,
        withConnectionSequence,
        testPattern: output.testPattern,
      });
    },
    [postToWorker, spawnLineWorker],
  );

  const handleDisconnect = useCallback((): void => {
    stopAllPipelines();
    postToWorker({ t: 'reset' });
    workerInitializedRef.current = false;
    resetHudSignalBuffer(hudBufferRef.current);
    dispatch({ type: 'DISCONNECT', standby: standbyScreen });
  }, [postToWorker, standbyScreen, stopAllPipelines]);

  const handleConnect = useCallback(async (): Promise<void> => {
    const isServerMode = stateRef.current.mode === 'Serveur';
    if (isServerMode) {
      playerRef.current?.setMuted(false);
    }
    const { state: nextRouter, effect } = connectRouter();
    dispatch({
      type: 'BEGIN_SESSION',
      router: nextRouter,
      unmuteSpeaker: isServerMode,
    });
    if (effect.kind === 'transmit') {
      await transmitServiceOutput(effect.output, effect.withConnectionSequence);
    }
  }, [transmitServiceOutput]);

  const applyRouterOutcome = useCallback(
    (nextRouter: RouterState | null, effect: RouterEffect): void => {
      switch (effect.kind) {
        case 'disconnect':
          handleDisconnect();
          break;
        case 'transmit':
          if (nextRouter) {
            dispatch({ type: 'UPDATE_ROUTER_FOR_TRANSMIT', router: nextRouter });
          }
          void transmitServiceOutput(effect.output, effect.withConnectionSequence);
          break;
        case 'localEcho':
          if (nextRouter) {
            dispatch({ type: 'UPDATE_LOCAL_ECHO', router: nextRouter });
          }
          break;
        case 'none':
          if (nextRouter && nextRouter !== stateRef.current.router) {
            dispatch({ type: 'UPDATE_LOCAL_ECHO', router: nextRouter });
          }
          break;
      }
    },
    [handleDisconnect, transmitServiceOutput],
  );

  const handleQuickLaunchService = useCallback(
    (serviceId: ServiceId): void => {
      const targetSvc = getServiceById(serviceId);
      const [serviceState, output] = targetSvc.init();
      const nextRouter: RouterState = {
        activeServiceId: serviceId,
        serviceState,
        lastOutput: output,
        inputBuffer: '',
      };
      dispatch({ type: 'UPDATE_ROUTER_FOR_TRANSMIT', router: nextRouter });
      void transmitServiceOutput(output, false);
    },
    [transmitServiceOutput],
  );

  const handleFunctionKey = useCallback(
    (key: FunctionKey): void => {
      const current = stateRef.current;
      if (current.mode === 'Ecoute') {
        if (key === 'ConnexionFin') {
          if (current.micState === 'on') {
            handleDisconnect();
          } else {
            void startEcouteMicrophone();
          }
        }
        return;
      }
      if (current.mode === 'Fichier') {
        return;
      }

      if (current.session === 'start' || current.router === null) {
        if (key === 'ConnexionFin') {
          void handleConnect();
        }
        return;
      }
      const { state: nextRouter, effect } = stepRouterKey(current.router, key);
      applyRouterOutcome(nextRouter, effect);
    },
    [applyRouterOutcome, handleConnect, handleDisconnect, startEcouteMicrophone],
  );

  const handleSetInputText = useCallback(
    (rawText: string): void => {
      const current = stateRef.current;
      if (!current.router) return;
      const { state: nextRouter, effect } = stepRouterSetInput(
        current.router,
        rawText,
      );
      applyRouterOutcome(nextRouter, effect);
    },
    [applyRouterOutcome],
  );

  const handleToggleMute = useCallback((): void => {
    const nextMuted = !stateRef.current.muted;
    playerRef.current?.setMuted(nextMuted);
    dispatch({ type: 'TOGGLE_MUTE' });
  }, []);

  const handleToggleThreshold = useCallback((): void => {
    const nextMode =
      stateRef.current.threshold === 'adaptive' ? 'fixed' : 'adaptive';
    postToWorker({ t: 'setThreshold', mode: nextMode });
    dispatch({ type: 'TOGGLE_THRESHOLD' });
  }, [postToWorker]);

  const handleToggleVote = useCallback((): void => {
    dispatch({ type: 'TOGGLE_VOTE' });
  }, []);

  const handleToggleHudVisible = useCallback((): void => {
    dispatch({ type: 'TOGGLE_HUD_VISIBLE' });
  }, []);

  const handleChangeSim = useCallback(
    (nextSim: SimParams): void => {
      stateRef.current = { ...stateRef.current, sim: nextSim };
      dispatch({ type: 'SET_SIM', sim: nextSim });
      postToWorker({ t: 'setSim', sim: nextSim });
    },
    [postToWorker],
  );

  const handleReplaySeeded = useCallback((): void => {
    const current = stateRef.current;
    if (current.mode !== 'Seul' || !current.router) {
      return;
    }
    resetHudSignalBuffer(hudBufferRef.current);
    dispatch({
      type: 'UPDATE_ROUTER_FOR_TRANSMIT',
      router: current.router,
      resetVote: true,
    });
    void transmitServiceOutput(current.router.lastOutput, false, true);
  }, [transmitServiceOutput]);

  const handleClearBerPoints = useCallback((): void => {
    dispatch({ type: 'CLEAR_BER_POINTS' });
  }, []);

  const handleRunSevenReceptions = useCallback((): void => {
    const current = stateRef.current;
    if (current.mode !== 'Seul' || !current.router) {
      return;
    }
    dispatch({ type: 'START_AUTO_REPEAT', target: 7 });
    if (current.pageComplete) {
      const { state: nextRouter, effect } = stepRouterKey(
        current.router,
        'Repetition',
      );
      applyRouterOutcome(nextRouter, effect);
    }
  }, [applyRouterOutcome]);

  // Automatic repetition loop when measuring 1/3/5/7 vote receptions in Seul mode
  useEffect(() => {
    if (
      state.mode !== 'Seul' ||
      state.session !== 'online' ||
      !state.pageComplete ||
      state.autoRepeatTarget <= 0 ||
      !state.router
    ) {
      return;
    }
    const doneCount = getActiveVoteSummary(state.votes)?.receptions ?? 0;
    if (doneCount >= state.autoRepeatTarget) {
      return;
    }
    const timer = window.setTimeout(() => {
      handleFunctionKey('Repetition');
    }, 80);
    return () => window.clearTimeout(timer);
  }, [
    handleFunctionKey,
    state.autoRepeatTarget,
    state.mode,
    state.pageComplete,
    state.router,
    state.session,
    state.votes,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const insideTextInput =
        (typeof HTMLInputElement !== 'undefined' &&
          target instanceof HTMLInputElement) ||
        (typeof HTMLTextAreaElement !== 'undefined' &&
          target instanceof HTMLTextAreaElement);
      const onButton =
        typeof HTMLButtonElement !== 'undefined' &&
        target instanceof HTMLButtonElement;

      if (
        onButton &&
        (event.code === 'Enter' ||
          event.code === 'NumpadEnter' ||
          event.code === 'Space')
      ) {
        return;
      }

      const mapped = mapKeyboardEventToMinitel(event, { insideTextInput });
      if (!mapped) return;

      if (mapped.kind === 'functionKey') {
        event.preventDefault();
        handleFunctionKey(mapped.key);
        return;
      }

      const current = stateRef.current;
      if (
        (current.mode === 'Seul' || current.mode === 'Serveur') &&
        current.session === 'online' &&
        current.router &&
        current.router.lastOutput.input
      ) {
        event.preventDefault();
        const { state: nextRouter, effect } = stepRouterChar(
          current.router,
          mapped.char,
        );
        applyRouterOutcome(nextRouter, effect);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyRouterOutcome, handleFunctionKey]);

  const currentField = activeInputSpec(state.router);
  const serviceBadge = state.router
    ? `3615 ${state.router.activeServiceId}`
    : state.mode === 'Ecoute'
      ? 'Écoute micro'
      : 'Veille';

  const statusLabel = (() => {
    if (state.mode === 'Ecoute') {
      if (state.micState !== 'on') {
        return 'Micro en attente';
      }
      return state.carrierOn
        ? `Réception micro · Porteuse V.23 (${CHANNELS.forward.baud / FRAME.bitsPerFrame} car/s)`
        : 'Écoute micro · En attente de porteuse';
    }
    if (state.mode === 'Fichier') {
      return 'Mode Fichier WAV';
    }
    const prefix = state.mode === 'Serveur' ? 'Serveur HP · ' : '';
    if (state.session === 'start') {
      return `${prefix}Veille`;
    }
    if (state.session === 'connecting') {
      return `${prefix}Appel V.23 · ${ANSWER_TONE_HZ} Hz…`;
    }
    return state.carrierOn
      ? `${prefix}${serviceBadge} · ${CHANNELS.forward.baud} bd`
      : `${prefix}${serviceBadge} · En ligne`;
  })();

  const isInteractiveServiceMode =
    state.mode === 'Seul' || state.mode === 'Serveur';

  return (
    <div className="nm-app">
      <header className="nm-topbar">
        <div className="nm-brand">
          <h1 className="nm-brand-title">NeoMinitel</h1>
          <span className="nm-brand-meta">
            {`V.23 · ${CHANNELS.forward.baud} / ${CHANNELS.backward.baud} bauds`}
          </span>
        </div>

        <ModeBar mode={state.mode} onSelectMode={handleSelectMode} />

        <div className="nm-toolbar" role="toolbar" aria-label="Réglages du terminal">
          {state.mode !== 'Ecoute' && (
            <button
              type="button"
              className="nm-btn"
              aria-pressed={state.muted}
              onClick={handleToggleMute}
            >
              {state.muted ? 'Son : Muet' : 'Son : Activé'}
            </button>
          )}

          <button
            type="button"
            className="nm-btn"
            aria-pressed={state.palette === 'nb'}
            onClick={() => dispatch({ type: 'TOGGLE_PALETTE' })}
          >
            {state.palette === 'couleur'
              ? 'Palette : Couleur'
              : 'Palette : N&B Minitel 1'}
          </button>

          <button
            type="button"
            className="nm-btn"
            aria-pressed={state.crtEnabled}
            onClick={() => dispatch({ type: 'TOGGLE_CRT' })}
          >
            Tube cathodique
          </button>
        </div>
      </header>

      {(state.rawAudioWarning || state.noCarrierHint || state.notice) && (
        <div className="nm-banners">
          {state.rawAudioWarning && state.mode === 'Ecoute' && (
            <div className="nm-banner nm-banner-warn" role="status">
              {state.rawAudioWarning}
            </div>
          )}
          {state.noCarrierHint && state.mode === 'Ecoute' && (
            <div className="nm-banner nm-banner-hint" role="status">
              Aucune porteuse V.23 entendue depuis 10 s : montez le volume de
              l&apos;appareil serveur et rapprochez son haut-parleur du microphone.
            </div>
          )}
          {state.notice && (
            <div className="nm-banner nm-banner-warn" role="alert">
              {state.notice}
            </div>
          )}
        </div>
      )}

      <main className="nm-stage">
        <div
          className="nm-workspace"
          data-hud-open={state.hudVisible ? 'true' : 'false'}
        >
          <MinitelShell
            online={state.session === 'online'}
            statusLabel={statusLabel}
            footerSlot={
              <div className="nm-terminal-controls">
                {state.mode === 'Serveur' && state.session !== 'start' && (
                  <div
                    className="nm-server-bar"
                    role="group"
                    aria-label="Diffusion rapide mode Serveur"
                  >
                    <span className="nm-server-bar-label">
                      Diffuser sur haut-parleur :
                    </span>
                    <div className="nm-server-pills">
                      {ALL_SERVICE_IDS.map((svcId) => (
                        <button
                          key={svcId}
                          type="button"
                          className="nm-btn"
                          aria-pressed={state.router?.activeServiceId === svcId}
                          onClick={() => handleQuickLaunchService(svcId)}
                        >
                          3615 {svcId}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isInteractiveServiceMode &&
                  state.session === 'online' &&
                  currentField &&
                  state.router && (
                    <InputOverlay
                      field={currentField}
                      value={state.router.inputBuffer}
                      onChangeText={handleSetInputText}
                      onSubmitEnvoi={() => handleFunctionKey('Envoi')}
                      onClearAnnulation={() => handleFunctionKey('Annulation')}
                    />
                  )}

                {isInteractiveServiceMode && (
                  <FunctionKeys
                    online={state.session !== 'start'}
                    onPressKey={handleFunctionKey}
                  />
                )}

                {state.mode === 'Seul' && (
                  <SimControls
                    sim={state.sim}
                    canReplay={state.session !== 'start' && state.router !== null}
                    onChangeSim={handleChangeSim}
                    onReplaySeeded={handleReplaySeeded}
                  />
                )}

                {state.mode === 'Ecoute' && state.micState === 'on' && (
                  <div className="nm-server-bar">
                    <span className="nm-server-bar-label">
                      Microphone actif — les pages V.23 reçues se dessinent automatiquement.
                    </span>
                    <button
                      type="button"
                      className="nm-btn nm-btn-fin"
                      onClick={handleDisconnect}
                    >
                      Couper l&apos;écoute
                    </button>
                  </div>
                )}
              </div>
            }
          >
            <div style={{ position: 'relative' }}>
              <ScreenCanvas
                screen={state.shown}
                palette={state.palette}
                crt={state.crtEnabled}
                ariaSummary={state.completedAriaSummary}
              />

              {(state.mode === 'Seul' || state.mode === 'Serveur') &&
                state.session === 'start' && (
                  <StartScreen
                    mode={state.mode}
                    onConnect={() => void handleConnect()}
                  />
                )}

              {state.mode === 'Ecoute' && state.micState !== 'on' && (
                <MicPermission
                  micState={state.micState}
                  errorMessage={state.micError}
                  onRequestMic={() => void startEcouteMicrophone()}
                  onFallbackSeul={() => handleSelectMode('Seul')}
                />
              )}

              {state.mode === 'Fichier' && (
                <div
                  className="nm-start-overlay"
                  role="region"
                  aria-label="Mode Fichier WAV"
                >
                  <p className="nm-start-memorial">Décodage de fichier WAV</p>
                  <p className="nm-start-caption">
                    L&apos;importation par glisser-déposer de fichiers WAV est prévue au jalon
                    J11 (tâche 12).
                  </p>
                  <button
                    type="button"
                    className="nm-btn nm-btn-connexion"
                    onClick={() => handleSelectMode('Seul')}
                  >
                    Retour au mode Seul
                  </button>
                </div>
              )}
            </div>
          </MinitelShell>

          <MathHud
            visible={state.hudVisible}
            onToggleVisible={handleToggleHudVisible}
            thresholdMode={state.threshold}
            onToggleThreshold={handleToggleThreshold}
            voteOn={state.voteOn}
            onToggleVote={handleToggleVote}
            bufferRef={hudBufferRef}
            quality={state.quality}
            cps={state.cps}
            parityErrors={state.errors.parity}
            framingErrors={state.errors.framing}
            voteSummary={getActiveVoteSummary(state.votes)}
            berPoints={state.berPoints}
            onClearBerPoints={handleClearBerPoints}
            showBerChart={state.router?.activeServiceId === 'MATHS'}
            voteProgression={getActiveVoteProgression(state.votes)}
            showVoteCerPanel={
              state.router?.lastOutput.pageId === 'maths/vote' ||
              (getActiveVoteSummary(state.votes)?.receptions ?? 0) >= 2
            }
            canAutoRepeatVote={
              state.mode === 'Seul' &&
              state.session !== 'start' &&
              state.router !== null
            }
            autoRepeatingVote={state.autoRepeatTarget > 0}
            onRunSevenReceptions={handleRunSevenReceptions}
          />
        </div>
      </main>
    </div>
  );
}
