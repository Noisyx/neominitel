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
import { ANSWER_TONE_HZ, CHANNELS, FRAME, type DiagEvent, type QualityEvent } from '../modem';
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
import { StartScreen } from './screens/StartScreen';
import {
  FunctionKeys,
  mapKeyboardEventToMinitel,
} from './terminal/FunctionKeys';
import { InputOverlay } from './terminal/InputOverlay';
import { MinitelShell } from './terminal/MinitelShell';
import { ScreenCanvas, summarizeScreenForAria } from './terminal/ScreenCanvas';

export type SessionPhase = 'start' | 'connecting' | 'online';

export const NO_CARRIER_TIMEOUT_MS = 10_000;

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
  quality?: QualityEvent;
  notice?: string;
}

export type UiAction =
  | { type: 'SWITCH_MODE'; mode: LineMode; standby: Screen }
  | { type: 'BEGIN_SESSION'; router: RouterState; unmuteSpeaker?: boolean }
  | { type: 'UPDATE_ROUTER_FOR_TRANSMIT'; router: RouterState }
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
  | { type: 'TOGGLE_CRT' };

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
        notice: undefined,
      };
    }

    case 'BEGIN_SESSION': {
      const blank = createBlankScreen();
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
        notice: undefined,
      };
    }

    case 'UPDATE_ROUTER_FOR_TRANSMIT': {
      return {
        ...state,
        session: state.session === 'start' ? 'connecting' : 'online',
        router: action.router,
        shown: overlayInputFieldOnScreen(state.baseScreen, undefined, ''),
        pageComplete: false,
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

      const { screen: diffedBase } = applyTimedEventsToScreen(
        state.baseScreen,
        action.events,
      );
      let nextBase = diffedBase;

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
            }
            break;
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
          case 'pageEnd':
            nextBase = ev.screen;
            nextPageComplete = true;
            nextAria = summarizeScreenForAria(ev.screen);
            break;
          case 'quality':
            nextQuality = ev.q;
            break;
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
  const latestDiagRef = useRef<{ d: DiagEvent; spectrumDb: Float32Array } | null>(
    null,
  );

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
          const nonDiagEvents: TimedEvent[] = [];
          for (const ev of msg.events) {
            if (ev.e === 'diag') {
              latestDiagRef.current = { d: ev.d, spectrumDb: ev.spectrumDb };
            } else {
              nonDiagEvents.push(ev);
            }
          }
          if (nonDiagEvents.length > 0) {
            schedulerRef.current.enqueue(nonDiagEvents);
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
              latestDiagRef.current = { d: ev.d, spectrumDb: ev.spectrumDb };
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
        dispatch({ type: 'APPLY_TIMED_EVENTS', events: dueEvents });
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
    postToWorker(
      {
        t: 'capturePort',
        port: capture.workerPort,
        sampleRate: capture.sampleRate,
      },
      [capture.workerPort],
    );

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
      dispatch({ type: 'SWITCH_MODE', mode: nextMode, standby: standbyScreen });

      if (nextMode === 'Ecoute') {
        void startEcouteMicrophone();
      }
    },
    [postToWorker, standbyScreen, startEcouteMicrophone, stopAllPipelines],
  );

  const transmitServiceOutput = useCallback(
    async (output: ServiceOutput, withConnectionSequence: boolean): Promise<void> => {
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

      if (!workerInitializedRef.current || withConnectionSequence) {
        postToWorker({ t: 'init', sampleRate });
        workerInitializedRef.current = true;
      } else {
        postToWorker({ t: 'stopTransmit' });
      }

      postToWorker({ t: 'setSim', sim: stateRef.current.sim });
      postToWorker({
        t: 'transmit',
        id: nextId,
        bytes: output.bytes.slice(),
        pageId: output.pageId,
        // Serveur mode plays clean V.23 audio on the speaker; Seul mode runs through the simulator
        simulate: !isServerMode,
        withConnectionSequence,
      });
    },
    [postToWorker, spawnLineWorker],
  );

  const handleDisconnect = useCallback((): void => {
    stopAllPipelines();
    postToWorker({ t: 'reset' });
    workerInitializedRef.current = false;
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
      </main>
    </div>
  );
}
