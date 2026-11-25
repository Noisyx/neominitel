import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactElement,
} from 'react';
import { createGaplessPlayer, type GaplessPlayer } from '../audio/playback';
import { ANSWER_TONE_HZ, CHANNELS, FRAME, type DiagEvent, type QualityEvent } from '../modem';
import {
  cloneCell,
  createBlankScreen,
  encodePage,
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
import {
  decodePageSourceToScreen,
  SOMMAIRE_PREVIEW_PAGE_SOURCE,
  STANDBY_PAGE_SOURCE,
} from './screens/previewPages';
import { StartScreen } from './screens/StartScreen';
import { MinitelShell } from './terminal/MinitelShell';
import { ScreenCanvas, summarizeScreenForAria } from './terminal/ScreenCanvas';

export type SessionPhase = 'start' | 'connecting' | 'online';

interface UiState {
  mode: 'Seul' | 'Ecoute' | 'Serveur' | 'Fichier';
  session: SessionPhase;
  shown: Screen;
  completedAriaSummary: string;
  carrierOn: boolean;
  muted: boolean;
  palette: PaletteMode;
  crtEnabled: boolean;
  sim: SimParams;
  quality?: QualityEvent;
  notice?: string;
}

type UiAction =
  | { type: 'START_CONNECTING' }
  | { type: 'DISCONNECT'; standby: Screen; notice?: string }
  | { type: 'APPLY_TIMED_EVENTS'; events: TimedEvent[] }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_PALETTE' }
  | { type: 'TOGGLE_CRT' };

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

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'START_CONNECTING':
      return {
        ...state,
        session: 'connecting',
        shown: createBlankScreen(),
        completedAriaSummary: '',
        carrierOn: false,
        notice: undefined,
      };

    case 'DISCONNECT':
      return {
        ...state,
        session: 'start',
        shown: action.standby,
        completedAriaSummary: '',
        carrierOn: false,
        notice: action.notice,
      };

    case 'APPLY_TIMED_EVENTS': {
      let nextSession = state.session;
      let nextCarrier = state.carrierOn;
      let nextQuality = state.quality;
      let nextAria = state.completedAriaSummary;

      const { screen: diffedScreen } = applyTimedEventsToScreen(
        state.shown,
        action.events,
      );
      let nextShown = diffedScreen;

      for (const ev of action.events) {
        switch (ev.e) {
          case 'connect':
            if (nextSession === 'connecting') {
              nextSession = 'online';
            }
            break;
          case 'carrier':
            nextCarrier = ev.on;
            if (ev.on && nextSession === 'connecting') {
              nextSession = 'online';
            }
            break;
          case 'pageStart':
            if (nextSession === 'connecting') {
              nextSession = 'online';
            }
            break;
          case 'pageEnd':
            nextShown = ev.screen;
            nextAria = summarizeScreenForAria(ev.screen);
            break;
          case 'quality':
            nextQuality = ev.q;
            break;
          default:
            break;
        }
      }

      return {
        ...state,
        session: nextSession,
        carrierOn: nextCarrier,
        shown: nextShown,
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
  const sommaireBytes = useMemo(() => {
    const res = encodePage(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    return res.ok ? res.value.bytes : new Uint8Array(0);
  }, []);

  const [state, dispatch] = useReducer(uiReducer, undefined, (): UiState => ({
    mode: 'Seul',
    session: 'start',
    shown: standbyScreen,
    completedAriaSummary: '',
    carrierOn: false,
    muted: false,
    palette: 'couleur',
    crtEnabled: true,
    sim: { ...DEFAULT_SIM_PARAMS },
  }));

  const playerRef = useRef<GaplessPlayer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const schedulerRef = useRef<EventScheduler<TimedEvent>>(
    createEventScheduler<TimedEvent>(),
  );
  const txIdRef = useRef<number>(0);
  const latestDiagRef = useRef<{ d: DiagEvent; spectrumDb: Float32Array } | null>(
    null,
  );

  const postToWorker = useCallback((msg: ToWorker): void => {
    workerRef.current?.postMessage(msg);
  }, []);

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
          // Separate 20 Hz diag frames into a ref so canvas HUD reads them without React re-renders
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
          playerRef.current?.stopAll();
          schedulerRef.current.clear();
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
      playerRef.current?.stopAll();
      schedulerRef.current.clear();
      dispatch({
        type: 'DISCONNECT',
        standby: standbyScreen,
        notice: 'Ligne coupée, reconnexion…',
      });
    };

    workerRef.current = worker;
    return worker;
  }, [standbyScreen]);

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
      workerRef.current?.terminate();
      workerRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const handleConnect = useCallback(async (): Promise<void> => {
    const player = playerRef.current;
    if (!player) return;

    player.stopAll();
    schedulerRef.current.clear();
    dispatch({ type: 'START_CONNECTING' });

    const sampleRate = await player.ensureStarted();
    const worker = workerRef.current ?? spawnLineWorker();
    if (!worker) return;

    const nextId = txIdRef.current + 1;
    txIdRef.current = nextId;

    postToWorker({ t: 'init', sampleRate });
    postToWorker({ t: 'setSim', sim: state.sim });
    postToWorker({
      t: 'transmit',
      id: nextId,
      bytes: sommaireBytes.slice(),
      pageId: SOMMAIRE_PREVIEW_PAGE_SOURCE.id,
      simulate: true,
      withConnectionSequence: true,
    });
  }, [postToWorker, sommaireBytes, spawnLineWorker, state.sim]);

  const handleDisconnect = useCallback((): void => {
    txIdRef.current += 1;
    postToWorker({ t: 'stopTransmit' });
    postToWorker({ t: 'reset' });
    playerRef.current?.stopAll();
    schedulerRef.current.clear();
    dispatch({ type: 'DISCONNECT', standby: standbyScreen });
  }, [postToWorker, standbyScreen]);

  const handleToggleMute = useCallback((): void => {
    const nextMuted = !state.muted;
    playerRef.current?.setMuted(nextMuted);
    dispatch({ type: 'TOGGLE_MUTE' });
  }, [state.muted]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'End') {
        event.preventDefault();
        if (state.session === 'start') {
          void handleConnect();
        } else {
          handleDisconnect();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleConnect, handleDisconnect, state.session]);

  const statusLabel =
    state.session === 'start'
      ? 'Veille'
      : state.session === 'connecting'
        ? `Appel V.23 · ${ANSWER_TONE_HZ} Hz…`
        : state.carrierOn
          ? `Porteuse V.23 · ${CHANNELS.forward.baud} bd (${CHANNELS.forward.baud / FRAME.bitsPerFrame} car/s)`
          : `En ligne · ${CHANNELS.forward.baud} / ${CHANNELS.backward.baud} bd`;

  return (
    <div className="nm-app">
      <header className="nm-topbar">
        <div className="nm-brand">
          <h1 className="nm-brand-title">NeoMinitel</h1>
          <span className="nm-brand-meta">
            {`Mode Seul · V.23 ${CHANNELS.forward.baud} / ${CHANNELS.backward.baud} bauds`}
          </span>
        </div>

        <div className="nm-toolbar" role="toolbar" aria-label="Réglages du terminal">
          <button
            type="button"
            className="nm-btn"
            aria-pressed={state.muted}
            onClick={handleToggleMute}
          >
            {state.muted ? 'Son : Muet' : 'Son : Activé'}
          </button>

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

          {state.session !== 'start' && (
            <button
              type="button"
              className="nm-btn nm-btn-fin"
              onClick={handleDisconnect}
            >
              Connexion/Fin
            </button>
          )}
        </div>
      </header>

      <main className="nm-stage">
        <MinitelShell
          online={state.session === 'online'}
          statusLabel={statusLabel}
        >
          <div style={{ position: 'relative' }}>
            <ScreenCanvas
              screen={state.shown}
              palette={state.palette}
              crt={state.crtEnabled}
              ariaSummary={state.completedAriaSummary}
            />
            {state.session === 'start' && (
              <StartScreen onConnect={() => void handleConnect()} />
            )}
          </div>
        </MinitelShell>
      </main>
    </div>
  );
}
