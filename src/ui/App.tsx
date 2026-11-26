import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type DragEvent,
  type ReactElement,
} from 'react';
import {
  startMicrophoneCapture,
  type ActiveMicCapture,
} from '../audio/capture';
import { createGaplessPlayer, type GaplessPlayer } from '../audio/playback';
import { ANSWER_TONE_HZ, CHANNELS, FRAME } from '../modem';
import {
  ALL_SERVICE_IDS,
  connectRouter,
  getServiceById,
  stepRouterChar,
  stepRouterKey,
  stepRouterSetInput,
  type RouterEffect,
  type RouterState,
  type ServiceId,
  type ServiceOutput,
} from '../services';
import type { FunctionKey } from '../videotex';
import type {
  FromWorker,
  SimParams,
  TimedEvent,
  ToWorker,
} from '../workers/protocol';
import {
  activeInputSpec,
  createInitialUiState,
  executeModeSwitch,
  NO_CARRIER_TIMEOUT_MS,
  resolvePublicAssetUrl,
  uiReducer,
  type UiState,
} from './app-state';
import { formatModemErrorFr } from './errors';
import {
  createHudSignalBuffer,
  pushDiagToHudBuffer,
  resetHudSignalBuffer,
  type HudSignalBuffer,
} from './hud/hudStore';
import { MathHud } from './hud/MathHud';
import {
  createEventScheduler,
  startRafScheduler,
  type EventScheduler,
} from './scheduler';
import { FileDrop, FileModeBar } from './screens/FileDrop';
import { MicPermission } from './screens/MicPermission';
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
import { ScreenCanvas } from './terminal/ScreenCanvas';
import {
  getActiveVoteProgression,
  getActiveVoteSummary,
} from './vote-manager';

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
  const lastStreamWasWavRef = useRef<boolean>(false);
  const loadedWavRef = useRef<{ name: string; bytes: Uint8Array } | null>(null);
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

          const isFinalBlock = Boolean(msg.done);
          playerRef.current?.scheduleBlock({
            id: msg.id,
            audio: msg.audio,
            startSample: msg.startSample,
            sampleRate: msg.sampleRate,
            onEnded: (endedId) => {
              if (endedId === txIdRef.current) {
                worker.postMessage({ t: 'ackBlock', id: endedId } satisfies ToWorker);
                if (isFinalBlock && stateRef.current.mode === 'Fichier') {
                  dispatch({ type: 'FILE_REALTIME_ENDED' });
                }
              }
            },
          });
          break;
        }

        case 'live': {
          const currentMode = stateRef.current.mode;
          if (currentMode !== 'Ecoute' && currentMode !== 'Fichier') {
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
          if (currentMode === 'Fichier') {
            dispatch({ type: 'FILE_FAST_COMPLETE', events: nonDiag });
          } else if (nonDiag.length > 0) {
            dispatch({ type: 'APPLY_TIMED_EVENTS', events: nonDiag });
          }
          break;
        }

        case 'error': {
          const frenchMessage = formatModemErrorFr(msg.error);
          stopAllPipelines();
          workerInitializedRef.current = false;
          resetHudSignalBuffer(hudBufferRef.current);
          if (stateRef.current.mode === 'Fichier') {
            dispatch({ type: 'FILE_ERROR', message: frenchMessage });
          } else {
            dispatch({
              type: 'DISCONNECT',
              standby: standbyScreen,
              notice: frenchMessage,
            });
          }
          break;
        }

        case 'fileProgress':
          dispatch({
            type: 'FILE_PROGRESS',
            done: msg.done,
            total: msg.total,
          });
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
    playerRef.current = createGaplessPlayer(stateRef.current.muted);
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

    const unlockSpeakerOnGesture = (): void => {
      if (stateRef.current.mode !== 'Ecoute') {
        playerRef.current?.unlockFromGesture();
      }
    };
    window.addEventListener('pointerdown', unlockSpeakerOnGesture, {
      passive: true,
    });
    window.addEventListener('keydown', unlockSpeakerOnGesture);

    return () => {
      window.removeEventListener('pointerdown', unlockSpeakerOnGesture);
      window.removeEventListener('keydown', unlockSpeakerOnGesture);
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

  useEffect(() => {
    playerRef.current?.setMuted(state.muted);
  }, [state.muted]);

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
      const leavingMicMode =
        micCaptureRef.current !== null || stateRef.current.mode === 'Ecoute';
      loadedWavRef.current = null;
      executeModeSwitch(stateRef.current, nextMode, standbyScreen, {
        stopCapture: () => {
          if (micCaptureRef.current) {
            micCaptureRef.current.stop();
            micCaptureRef.current = null;
            postToWorker({ t: 'stopCapture' });
          }
        },
        stopTransmit: () => {
          txIdRef.current += 1;
          postToWorker({ t: 'stopTransmit' });
        },
        stopPlayer: () => {
          playerRef.current?.stopAll();
        },
        clearScheduler: () => {
          schedulerRef.current.clear();
        },
        resetWorker: () => {
          postToWorker({ t: 'reset' });
          workerInitializedRef.current = false;
          resetHudSignalBuffer(hudBufferRef.current);
        },
      });

      if (leavingMicMode && nextMode !== 'Ecoute') {
        playerRef.current?.resetContext();
      }
      if (nextMode === 'Seul' || nextMode === 'Serveur') {
        playerRef.current?.unlockFromGesture();
      }

      dispatch({ type: 'SWITCH_MODE', mode: nextMode, standby: standbyScreen });

      if (nextMode === 'Ecoute') {
        void startEcouteMicrophone();
      }
    },
    [postToWorker, standbyScreen, startEcouteMicrophone],
  );

  const runWavBufferDecode = useCallback(
    async (
      fileName: string,
      wavBytes: Uint8Array,
      realtime: boolean,
    ): Promise<void> => {
      stopAllPipelines();
      resetHudSignalBuffer(hudBufferRef.current);
      dispatch({ type: 'FILE_START', fileName, realtime });

      if (realtime && playerRef.current) {
        playerRef.current.unlockFromGesture();
        await playerRef.current.ensureStarted();
      }

      const worker = workerRef.current ?? spawnLineWorker();
      if (!worker) {
        dispatch({
          type: 'FILE_ERROR',
          fileName,
          message: 'Web Worker indisponible sur ce navigateur.',
        });
        return;
      }

      const nextId = txIdRef.current + 1;
      txIdRef.current = nextId;
      lastStreamWasWavRef.current = true;
      const transferCopy = wavBytes.slice().buffer;
      postToWorker({ t: 'setThreshold', mode: stateRef.current.threshold });
      postToWorker(
        {
          t: 'decodeFile',
          id: nextId,
          data: transferCopy,
          realtime,
        },
        [transferCopy],
      );
    },
    [postToWorker, spawnLineWorker, stopAllPipelines],
  );

  const handleSelectWavFile = useCallback(
    (file: File): void => {
      const wantRealtime = stateRef.current.file.realtime;
      if (wantRealtime) {
        playerRef.current?.unlockFromGesture();
      }
      void (async () => {
        try {
          const arrayBuffer = await file.arrayBuffer();
          if (stateRef.current.mode !== 'Fichier') {
            return;
          }
          const bytes = new Uint8Array(arrayBuffer);
          loadedWavRef.current = { name: file.name, bytes };
          await runWavBufferDecode(file.name, bytes, wantRealtime);
        } catch {
          dispatch({
            type: 'FILE_ERROR',
            fileName: file.name,
            message: 'Impossible de lire le fichier sélectionné depuis le disque.',
          });
        }
      })();
    },
    [runWavBufferDecode],
  );

  const handleToggleFileRealtime = useCallback((realtime: boolean): void => {
    if (realtime) {
      playerRef.current?.unlockFromGesture();
    }
    dispatch({ type: 'FILE_SET_REALTIME', realtime });
  }, []);

  const handleReplayWavFast = useCallback((): void => {
    const loaded = loadedWavRef.current;
    if (!loaded || stateRef.current.mode !== 'Fichier') return;
    void runWavBufferDecode(loaded.name, loaded.bytes, false);
  }, [runWavBufferDecode]);

  const handleReplayWavRealtime = useCallback((): void => {
    const loaded = loadedWavRef.current;
    if (!loaded || stateRef.current.mode !== 'Fichier') return;
    playerRef.current?.unlockFromGesture();
    void runWavBufferDecode(loaded.name, loaded.bytes, true);
  }, [runWavBufferDecode]);

  const handleStopWavPlayback = useCallback((): void => {
    stopAllPipelines();
    dispatch({ type: 'FILE_REALTIME_ENDED' });
  }, [stopAllPipelines]);

  const handleViewportDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (stateRef.current.mode !== 'Fichier') return;
      event.preventDefault();
      const dropped = event.dataTransfer.files?.[0];
      if (dropped) {
        handleSelectWavFile(dropped);
      }
    },
    [handleSelectWavFile],
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

      if (output.playWav) {
        try {
          const response = await fetch(resolvePublicAssetUrl(output.playWav));
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const wavBuffer = await response.arrayBuffer();
          if (txIdRef.current !== nextId) {
            return;
          }
          lastStreamWasWavRef.current = true;
          postToWorker({ t: 'stopTransmit' });
          postToWorker({ t: 'setThreshold', mode: stateRef.current.threshold });
          postToWorker(
            {
              t: 'decodeFile',
              id: nextId,
              data: wavBuffer,
              realtime: true,
            },
            [wavBuffer],
          );
        } catch {
          if (txIdRef.current === nextId) {
            dispatch({
              type: 'DISCONNECT',
              standby: standbyScreen,
              notice: 'Impossible de charger le fichier audio de cette transmission.',
            });
          }
        }
        return;
      }

      if (
        !workerInitializedRef.current ||
        withConnectionSequence ||
        forceReinit ||
        lastStreamWasWavRef.current
      ) {
        postToWorker({ t: 'init', sampleRate });
        workerInitializedRef.current = true;
        lastStreamWasWavRef.current = false;
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
    [postToWorker, spawnLineWorker, standbyScreen],
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
    playerRef.current?.unlockFromGesture();
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
          playerRef.current?.unlockFromGesture();
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
      playerRef.current?.unlockFromGesture();
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

      playerRef.current?.unlockFromGesture();
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
    if (!nextMuted) {
      playerRef.current?.unlockFromGesture();
    }
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
      const isInputElem =
        typeof HTMLInputElement !== 'undefined' &&
        target instanceof HTMLInputElement;
      const isTextAreaElem =
        typeof HTMLTextAreaElement !== 'undefined' &&
        target instanceof HTMLTextAreaElement;
      const isTerminalTextBar =
        isInputElem && target.classList.contains('nm-input-field');

      // Do not hijack keys inside non-terminal inputs (seed number, range sliders, checkboxes, file pickers)
      if ((isInputElem && !isTerminalTextBar) || isTextAreaElem) {
        return;
      }

      const onInteractiveControl =
        (typeof HTMLButtonElement !== 'undefined' &&
          target instanceof HTMLButtonElement) ||
        (typeof HTMLAnchorElement !== 'undefined' &&
          target instanceof HTMLAnchorElement);

      if (
        onInteractiveControl &&
        (event.code === 'Enter' ||
          event.code === 'NumpadEnter' ||
          event.code === 'Space')
      ) {
        return;
      }

      const mapped = mapKeyboardEventToMinitel(event, {
        insideTextInput: isTerminalTextBar,
      });
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
      if (state.file.status === 'decoding-fast') {
        return `Mode Fichier · Décodage (${state.file.progressPct} %)`;
      }
      if (state.file.status === 'playing-realtime') {
        return `Mode Fichier · Lecture V.23 (${CHANNELS.forward.baud} bd)`;
      }
      if (state.file.status === 'done') {
        return `Mode Fichier · ${state.file.fileName ?? 'WAV décodé'}`;
      }
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
  const showFileDropOverlay =
    state.mode === 'Fichier' &&
    (state.file.status === 'idle' || state.file.status === 'error');

  return (
    <div className="nm-app">
      <a href="#nm-terminal-main" className="nm-skip-link">
        Aller directement au terminal Minitel
      </a>
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

          <button
            type="button"
            className="nm-btn"
            aria-pressed={state.hudVisible}
            onClick={handleToggleHudVisible}
          >
            {state.hudVisible ? 'Fermer le capot' : 'Sous le capot'}
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
            chinControls={
              <div
                className="nm-chin-switches"
                role="group"
                aria-label="Aides de réception du terminal"
              >
                <button
                  type="button"
                  className="nm-chin-switch"
                  aria-pressed={state.threshold === 'adaptive'}
                  title="Recale automatiquement la radio si l’émetteur est déréglé"
                  onClick={handleToggleThreshold}
                >
                  <span
                    className="nm-chin-dot"
                    data-active={state.threshold === 'adaptive' ? 'true' : 'false'}
                    aria-hidden="true"
                  />
                  <span>Accord auto</span>
                </button>
                <button
                  type="button"
                  className="nm-chin-switch"
                  aria-pressed={state.voteOn}
                  title="Répare la page en combinant plusieurs écoutes (touche Répétition)"
                  onClick={handleToggleVote}
                >
                  <span
                    className="nm-chin-dot"
                    data-active={state.voteOn ? 'true' : 'false'}
                    aria-hidden="true"
                  />
                  <span>
                    {(getActiveVoteSummary(state.votes)?.receptions ?? 0) >= 2
                      ? `Vote (${getActiveVoteSummary(state.votes)?.receptions}×)`
                      : 'Vote'}
                  </span>
                </button>
              </div>
            }
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
                  state.router?.lastOutput.downloadWav && (
                    <div
                      className="nm-wav-bar"
                      role="group"
                      aria-label="Écoute sur un second appareil"
                    >
                      <span className="nm-server-bar-label">
                        {`Archive audio (${state.router.lastOutput.downloadWav.label}) :`}
                      </span>
                      <div className="nm-wav-links">
                        <a
                          className="nm-btn nm-wav-link"
                          href={resolvePublicAssetUrl(
                            state.router.lastOutput.downloadWav.url,
                          )}
                          download={state.router.lastOutput.downloadWav.filename}
                        >
                          Télécharger le .wav
                        </a>
                        <a
                          className="nm-btn nm-wav-link"
                          href={resolvePublicAssetUrl(
                            state.router.lastOutput.downloadWav.url,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Lire sur un autre appareil
                        </a>
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

                {state.mode === 'Fichier' && (
                  <FileModeBar
                    fileState={state.file}
                    hasLoadedBuffer={loadedWavRef.current !== null}
                    onSelectWavFile={handleSelectWavFile}
                    onToggleRealtime={handleToggleFileRealtime}
                    onReplayFast={handleReplayWavFast}
                    onReplayRealtime={handleReplayWavRealtime}
                    onStopPlayback={handleStopWavPlayback}
                  />
                )}
              </div>
            }
          >
            <div
              style={{ position: 'relative' }}
              onDragOver={
                state.mode === 'Fichier'
                  ? (e) => e.preventDefault()
                  : undefined
              }
              onDrop={state.mode === 'Fichier' ? handleViewportDrop : undefined}
            >
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

              {showFileDropOverlay && (
                <FileDrop
                  fileState={state.file}
                  onSelectWavFile={handleSelectWavFile}
                  onToggleRealtime={handleToggleFileRealtime}
                />
              )}
            </div>
          </MinitelShell>

          {state.hudVisible && (
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
              simSlot={
                state.mode === 'Seul' ? (
                  <SimControls
                    sim={state.sim}
                    canReplay={state.session !== 'start' && state.router !== null}
                    disabled={state.router?.lastOutput.playWav !== undefined}
                    onChangeSim={handleChangeSim}
                    onReplaySeeded={handleReplaySeeded}
                  />
                ) : undefined
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}
