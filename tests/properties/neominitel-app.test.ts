import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_FUNCTION_KEYS,
  buildPageScreen,
  cellErrorRate,
  cloneScreen,
  createBlankCell,
  createBlankScreen,
  encodePage,
  renderScreenToRgba,
  rowToText,
  SCREEN_COLS,
  SCREEN_ROWS,
  screensEqual,
  type FunctionKey,
  type PageSource,
} from '../../src/videotex';
import {
  ALL_SERVICE_IDS,
  connectRouter,
  getServiceById,
  lintPages,
  MAX_PAIRWISE_PAGE_SIMILARITY,
  overlayInputFieldOnScreen,
  stepRouterChar,
  stepRouterKey,
  type RouterState,
  type ServiceId,
  type ServiceInput,
} from '../../src/services';
import { App } from '../../src/ui/App';
import {
  applyTimedEventsToScreen,
  createInitialUiState,
  executeModeSwitch,
  uiReducer,
  type UiAction,
} from '../../src/ui/app-state';
import {
  formatModemErrorFr,
  formatPageErrorFr,
  formatWavErrorReasonFr,
} from '../../src/ui/errors';
import {
  classifyCaptureError,
  evaluateRawAudioSettings,
  RAW_AUDIO_CONSTRAINTS,
} from '../../src/audio/capture';
import {
  createGaplessPlayer,
  resampleBlockForPlayback,
  type AudioContextConstructor,
} from '../../src/audio/playback';
import {
  modulate,
  WAV_ERROR_REASONS,
  writeWav,
} from '../../src/modem';
import {
  FileDrop,
  FileModeBar,
  INITIAL_FILE_MODE_STATE,
} from '../../src/ui/screens/FileDrop';
import {
  checkBundleSize,
  MAX_GZIPPED_JS_BYTES,
} from '../../scripts/check-bundle-size';
import { MicPermission } from '../../src/ui/screens/MicPermission';
import { LINE_MODE_OPTIONS } from '../../src/ui/screens/ModeBar';
import { SimControls } from '../../src/ui/screens/SimControls';
import { BerChart } from '../../src/ui/hud/BerChart';
import {
  createHudSignalBuffer,
  extractEyeTraces,
  pushDiagToHudBuffer,
} from '../../src/ui/hud/hudStore';
import { MathHud } from '../../src/ui/hud/MathHud';
import { VoteCerPanel } from '../../src/ui/hud/VoteCerPanel';
import {
  erasureVoteFailureFormula,
  majorityVoteFailureFormula,
  parityUndetectedApprox,
} from '../../src/ui/hud/voteMetrics';
import {
  createEmptyVoteStore,
  getActiveVoteProgression,
  getActiveVoteSummary,
  preparePageVote,
  recordCompletedPageVote,
  selectDisplayedScreenForVote,
} from '../../src/ui/vote-manager';
import {
  MATHS_GUIDE_PAGE,
  MATHS_PROVISIONAL_PAGES,
  mathsService,
} from '../../src/services/maths';
import { MATHS_COURS_PAGES } from '../../content/pages/maths';
import { blocksToG1Code, decodeBytes, imageToMosaic } from '../../src/videotex';
import { applyImageCells, createBlankDraft, decodeShareFragment, draftToPageSource, encodeDraft, encodeShareFragment, setBackground, setBlock, setTextLines } from '../../src/services/libre-editor';
import { LibreEditor } from '../../src/ui/screens/LibreEditor';
import { encodeKey } from '../../src/videotex';
import { backwardBytesForChar, createBackwardKeyListener } from '../../src/workers/back-keys';
import { createEventScheduler } from '../../src/ui/scheduler';
import {
  decodePageSourceToScreen,
  SOMMAIRE_PREVIEW_PAGE_SOURCE,
  STANDBY_PAGE_SOURCE,
} from '../../src/ui/screens/previewPages';
import {
  mapKeyboardEventToMinitel,
  MINITEL_KEY_DESCRIPTORS,
} from '../../src/ui/terminal/FunctionKeys';
import { summarizeScreenForAria } from '../../src/ui/terminal/ScreenCanvas';
import { SPECTRUM_BINS } from '../../src/workers/fft512';
import { createLineEngine } from '../../src/workers/line-engine';
import { DEFAULT_SIM_PARAMS, type TimedEvent } from '../../src/workers/protocol';
import { isSlowTestsEnabled } from '../helpers/arbitraries';

function isPageSource(val: unknown): val is PageSource {
  if (!val || typeof val !== 'object') return false;
  const candidate = val as Record<string, unknown>;
  return typeof candidate.id === 'string' && Array.isArray(candidate.rows);
}

/**
 * Dynamically loads every exported `PageSource` across all `.ts` files in `content/pages/`
 * (automatically picking up `content/pages/maths.ts` once Role B commits it).
 */
async function loadAllContentPages(): Promise<PageSource[]> {
  const dir = resolve(process.cwd(), 'content/pages');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();

  const seenIds = new Set<string>();
  const pages: PageSource[] = [];

  for (const file of files) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)) as Record<
      string,
      unknown
    >;
    for (const exportedValue of Object.values(mod)) {
      if (isPageSource(exportedValue)) {
        if (!seenIds.has(exportedValue.id)) {
          seenIds.add(exportedValue.id);
          pages.push(exportedValue);
        }
      } else if (Array.isArray(exportedValue)) {
        for (const item of exportedValue) {
          if (isPageSource(item) && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            pages.push(item);
          }
        }
      }
    }
  }

  return pages;
}

describe('neominitel-app Task 1 & 5: App shell, MinitelShell, ScreenCanvas, StartScreen and Keyboard', () => {
  it('renders the start screen, 9 Minitel function keycaps, mute & palette toggles, and trademark-free MinitelShell', () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('30 juin 2012 : la France débranche le Minitel.');
    expect(html).toContain('Connexion');
    expect(html).toContain('Son : Activé');
    expect(html).toContain('Palette : Couleur');
    expect(html).toContain('<svg');
    expect(html).toContain('<canvas');
    for (const desc of MINITEL_KEY_DESCRIPTORS) {
      expect(html).toContain(desc.label);
    }
    expect(html.toLowerCase()).not.toContain('france télécom');
    expect(html.toLowerCase()).not.toContain('france telecom');
    expect(html.toLowerCase()).not.toContain('orange');
  });

  it('maps PC KeyboardEvent.code shortcuts accurately and ignores F1..F12', () => {
    const base = { key: '', altKey: false, ctrlKey: false, metaKey: false };
    expect(mapKeyboardEventToMinitel({ ...base, code: 'Enter' })).toEqual({
      kind: 'functionKey',
      key: 'Envoi',
    });
    expect(mapKeyboardEventToMinitel({ ...base, code: 'Backspace' })).toEqual({
      kind: 'functionKey',
      key: 'Correction',
    });
    expect(
      mapKeyboardEventToMinitel(
        { ...base, code: 'Backspace' },
        { insideTextInput: true },
      ),
    ).toBeNull();
    expect(mapKeyboardEventToMinitel({ ...base, code: 'Escape' })).toEqual({
      kind: 'functionKey',
      key: 'Annulation',
    });
    expect(mapKeyboardEventToMinitel({ ...base, code: 'PageDown' })).toEqual({
      kind: 'functionKey',
      key: 'Suite',
    });
    expect(mapKeyboardEventToMinitel({ ...base, code: 'PageUp' })).toEqual({
      kind: 'functionKey',
      key: 'Retour',
    });
    expect(mapKeyboardEventToMinitel({ ...base, code: 'Home' })).toEqual({
      kind: 'functionKey',
      key: 'Sommaire',
    });
    expect(mapKeyboardEventToMinitel({ ...base, code: 'End' })).toEqual({
      kind: 'functionKey',
      key: 'ConnexionFin',
    });
    expect(
      mapKeyboardEventToMinitel({ ...base, code: 'KeyG', altKey: true }),
    ).toEqual({
      kind: 'functionKey',
      key: 'Guide',
    });
    expect(
      mapKeyboardEventToMinitel({ ...base, code: 'KeyR', altKey: true }),
    ).toEqual({
      kind: 'functionKey',
      key: 'Repetition',
    });

    // F-keys must never be intercepted
    for (let f = 1; f <= 12; f++) {
      expect(mapKeyboardEventToMinitel({ ...base, code: `F${f}`, key: `F${f}` })).toBeNull();
    }

    // Local echo & Correction overlay
    const screen = createBlankScreen();
    const withText = overlayInputFieldOnScreen(
      screen,
      { row: 22, col: 16, maxLength: 12 },
      'MATHS',
    );
    expect(rowToText(withText, 22).slice(15, 27)).toBe('MATHS.......');
    expect(withText.cursor).toEqual({ row: 22, col: 20, visible: true });
  });

  it('encodes and rasterizes the SOMMAIRE and standby screens cleanly at 40x25 (320x250 px)', () => {
    for (const source of [STANDBY_PAGE_SOURCE, SOMMAIRE_PREVIEW_PAGE_SOURCE]) {
      const encoded = encodePage(source);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) continue;
      expect(encoded.value.warnings).toEqual([]);

      const screen = decodePageSourceToScreen(source);
      expect(screen.rows.length).toBe(SCREEN_ROWS);
      for (const row of screen.rows) {
        expect(row.length).toBe(SCREEN_COLS);
      }

      const rgbaColour = renderScreenToRgba(screen, { palette: 'couleur' });
      const rgbaMono = renderScreenToRgba(screen, { palette: 'nb' });
      expect(rgbaColour.length).toBe(320 * 250 * 4);
      expect(rgbaMono.length).toBe(320 * 250 * 4);
    }

    const summary = summarizeScreenForAria(
      decodePageSourceToScreen(SOMMAIRE_PREVIEW_PAGE_SOURCE),
    );
    expect(summary).toContain('3615 SOMMAIRE');
    expect(summary).toContain('MATHS');
    expect(summary).toContain('FANTOME');
  });
});

describe('neominitel-app Task 2, 3 & 4: Line engine streaming and 3615 service routing', () => {
  it('routes 3615 codes (MATHS, FANTOME, LIBRE), shows error page on unknown code, and handles local echo + Correction', () => {
    let { state: router } = connectRouter();
    expect(router.activeServiceId).toBe('SOMMAIRE');
    expect(router.lastOutput.pageId).toBe('sommaire/accueil');

    // Type unknown code + Correction + Envoi -> error page
    router = stepRouterChar(router, 'INCONNU!').state;
    const afterCorr = stepRouterKey(router, 'Correction');
    expect(afterCorr.state?.inputBuffer).toBe('INCONNU');
    if (!afterCorr.state) return;

    const unknownRes = stepRouterKey(afterCorr.state, 'Envoi');
    expect(unknownRes.state?.activeServiceId).toBe('SOMMAIRE');
    expect(unknownRes.state?.lastOutput.pageId).toBe('sommaire/erreur');
    if (!unknownRes.state) return;

    // From error page, type 'maths' + Envoi -> opens 3615 MATHS
    const typedMaths = stepRouterChar(unknownRes.state, 'maths').state;
    const openMaths = stepRouterKey(typedMaths, 'Envoi');
    expect(openMaths.state?.activeServiceId).toBe('MATHS');
    expect(openMaths.state?.lastOutput.pageId).toBe('maths/accueil');
  });

  it('streams 100 ms audio blocks with connection sequence, 512-pt FFT diag, diffs, pageStart/pageEnd', () => {
    const sampleRate = 48000;
    const engine = createLineEngine();
    expect(engine.init(sampleRate)).toBeNull();
    engine.setSim({ ...DEFAULT_SIM_PARAMS });
    engine.setThreshold('fixed');

    const encoded = encodePage(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    expect(
      engine.startTransmit({
        id: 1,
        bytes: encoded.value.bytes,
        pageId: SOMMAIRE_PREVIEW_PAGE_SOURCE.id,
        simulate: true,
        withConnectionSequence: true,
      }),
    ).toBeNull();

    let expectedStartSample = 0;
    let sawConnect = false;
    let sawPageStart = false;
    let sawPageEnd = false;
    let sawSpectrum = false;
    let progressiveScreen = createBlankScreen();
    const allTimedEvents: TimedEvent[] = [];

    while (engine.hasActiveTransmit()) {
      const block = engine.nextTransmitBlock();
      expect(block).not.toBeNull();
      if (!block) break;

      expect(block.startSample).toBe(expectedStartSample);
      expect(block.audio.length).toBeGreaterThan(0);
      expect(block.audio.length).toBeLessThanOrEqual(Math.round(0.1 * sampleRate));
      expectedStartSample += block.audio.length;

      for (const ev of block.events) {
        allTimedEvents.push(ev);
        if (ev.e === 'connect') sawConnect = true;
        if (ev.e === 'pageStart') sawPageStart = true;
        if (ev.e === 'pageEnd') sawPageEnd = true;
        if (ev.e === 'diag') {
          sawSpectrum = true;
          expect(ev.spectrumDb.length).toBe(SPECTRUM_BINS);
        }
      }

      progressiveScreen = applyTimedEventsToScreen(
        progressiveScreen,
        block.events,
      ).screen;
    }

    expect(sawConnect).toBe(true);
    expect(sawPageStart).toBe(true);
    expect(sawPageEnd).toBe(true);
    expect(sawSpectrum).toBe(true);
    expect(
      screensEqual(
        progressiveScreen,
        decodePageSourceToScreen(SOMMAIRE_PREVIEW_PAGE_SOURCE),
      ),
    ).toBe(true);
  });
});

describe('neominitel-app Task 7 & 8: Écoute microphone capture, Serveur mode and mode switching', () => {
  it('requests raw audio constraints, warns when browser ignores them, and offers Seul mode on denial', () => {
    expect(RAW_AUDIO_CONSTRAINTS).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });

    const cleanCheck = evaluateRawAudioSettings({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
    });
    expect(cleanCheck.rawOk).toBe(true);
    expect(cleanCheck.warningMessage).toBeNull();

    const ignoredCheck = evaluateRawAudioSettings({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    });
    expect(ignoredCheck.rawOk).toBe(false);
    expect(ignoredCheck.warningMessage).toContain('annulation d’écho : activé');
    expect(ignoredCheck.warningMessage).toContain('réduction de bruit : activé');
    expect(ignoredCheck.warningMessage).toContain('gain automatique : désactivé');

    const deniedErr = new Error('Permission denied');
    deniedErr.name = 'NotAllowedError';
    expect(classifyCaptureError(deniedErr).kind).toBe('denied');

    const notFoundErr = new Error('No mic');
    notFoundErr.name = 'NotFoundError';
    expect(classifyCaptureError(notFoundErr).kind).toBe('no-device');

    const deniedHtml = renderToStaticMarkup(
      createElement(MicPermission, {
        micState: 'denied',
        onRequestMic: () => undefined,
        onFallbackSeul: () => undefined,
      }),
    );
    expect(deniedHtml).toContain('Passer en mode Seul');
    expect(deniedHtml).toContain('barre d');
  });

  it('manages 10 s no-carrier hint, unmutes speaker in Serveur mode, and cleans up state across mode switches', () => {
    const standby = decodePageSourceToScreen(STANDBY_PAGE_SOURCE);
    let state = createInitialUiState(standby);

    // Mute in Seul, switch to Serveur, and connect -> Serveur unmutes speaker
    state = uiReducer(state, { type: 'TOGGLE_MUTE' });
    expect(state.muted).toBe(true);

    state = uiReducer(state, { type: 'SWITCH_MODE', mode: 'Serveur', standby });
    expect(state.mode).toBe('Serveur');
    const { state: router } = connectRouter();
    state = uiReducer(state, {
      type: 'BEGIN_SESSION',
      router,
      unmuteSpeaker: true,
    });
    expect(state.muted).toBe(false);

    // Switch to Écoute -> resets session/router, starts mic, triggers 10s no-carrier hint, clears on carrier
    state = uiReducer(state, { type: 'SWITCH_MODE', mode: 'Ecoute', standby });
    expect(state.router).toBeNull();
    expect(state.micState).toBe('off');

    state = uiReducer(state, {
      type: 'MIC_STARTED',
      rawOk: false,
      rawAudioWarning: 'Attention DSP',
    });
    expect(state.micState).toBe('on');
    expect(state.rawAudioWarning).toBe('Attention DSP');
    expect(state.noCarrierHint).toBe(false);

    state = uiReducer(state, { type: 'SHOW_NO_CARRIER_HINT' });
    expect(state.noCarrierHint).toBe(true);

    state = uiReducer(state, {
      type: 'APPLY_TIMED_EVENTS',
      events: [{ atSample: 1000, e: 'carrier', on: true }],
    });
    expect(state.carrierOn).toBe(true);
    expect(state.noCarrierHint).toBe(false);

    // Every mode preserves 25x40 screen dimensions
    for (const opt of LINE_MODE_OPTIONS) {
      state = uiReducer(state, { type: 'SWITCH_MODE', mode: opt.id, standby });
      expect(state.shown.rows.length).toBe(SCREEN_ROWS);
      for (const row of state.shown.rows) {
        expect(row.length).toBe(SCREEN_COLS);
      }
    }
  });

  it('transmits clean speaker audio in Serveur mode (ignoring simulator noise) and decodes it in Écoute 20 ms live chunks', () => {
    const sampleRate = 48000;
    const serverEngine = createLineEngine();
    expect(serverEngine.init(sampleRate)).toBeNull();
    // Configure heavy noise on simulator, then transmit with simulate: false (Serveur mode)
    serverEngine.setSim({
      ...DEFAULT_SIM_PARAMS,
      ebN0Db: 0,
      hum: true,
    });

    const encoded = encodePage(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    expect(
      serverEngine.startTransmit({
        id: 1,
        bytes: encoded.value.bytes,
        pageId: SOMMAIRE_PREVIEW_PAGE_SOURCE.id,
        simulate: false,
        withConnectionSequence: false,
      }),
    ).toBeNull();

    const speakerChunks: Float32Array[] = [];
    let serverPreview = createBlankScreen();
    while (serverEngine.hasActiveTransmit()) {
      const block = serverEngine.nextTransmitBlock();
      if (!block) break;
      speakerChunks.push(block.audio);
      serverPreview = applyTimedEventsToScreen(serverPreview, block.events).screen;
    }

    const expectedScreen = decodePageSourceToScreen(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    expect(screensEqual(serverPreview, expectedScreen)).toBe(true);

    // Concatenate speaker audio and feed in 20 ms chunks (960 samples @ 48 kHz) into Écoute engine
    const totalLen = speakerChunks.reduce((acc, c) => acc + c.length, 0);
    const airAudio = new Float32Array(totalLen);
    let offset = 0;
    for (const c of speakerChunks) {
      airAudio.set(c, offset);
      offset += c.length;
    }

    const ecouteEngine = createLineEngine();
    expect(ecouteEngine.init(sampleRate)).toBeNull();

    const chunk20ms = Math.round(0.02 * sampleRate);
    let ecouteScreen = createBlankScreen();
    for (let pos = 0; pos < airAudio.length; pos += chunk20ms) {
      const slice = airAudio.subarray(pos, Math.min(airAudio.length, pos + chunk20ms));
      const liveMsg = ecouteEngine.pushLiveCaptureChunk(slice);
      if (liveMsg) {
        ecouteScreen = applyTimedEventsToScreen(ecouteScreen, liveMsg.events).screen;
      }
    }

    expect(screensEqual(ecouteScreen, expectedScreen)).toBe(true);
  });
});

describe('neominitel-app Task 9 & 10: Math HUD, screen-reader summaries, toggles, and Vote in the app', () => {
  it('renders MathHud charts, accessible screen-reader summaries, Accord automatique & Vote toggles, and collapse button', () => {
    const bufferRef = { current: createHudSignalBuffer() };

    const openHtml = renderToStaticMarkup(
      createElement(MathHud, {
        visible: true,
        onToggleVisible: () => undefined,
        thresholdMode: 'fixed',
        onToggleThreshold: () => undefined,
        voteOn: true,
        onToggleVote: () => undefined,
        bufferRef,
        quality: {
          type: 'quality',
          atSample: 4800,
          snrBandDb: 19.6,
          snr3kDb: 18.4,
          ebN0Db: 22.4,
          parityErrorRate: 0.03,
          offsetHz: -42,
        },
        cps: 120,
        parityErrors: 3,
        framingErrors: 1,
        voteSummary: {
          pageId: 'sommaire/accueil',
          receptions: 3,
          unresolved: 0,
          lastReceptionErrors: 12,
        },
      }),
    );

    expect(openHtml).toContain('Spectrogramme (0 – 3 kHz)');
    expect(openHtml).toContain('Discriminateur &amp; fenêtres bits');
    expect(openHtml).toContain('Diagramme de l');
    expect(openHtml).toContain('18.4 dB');
    expect(openHtml).toContain('22.4 dB');
    expect(openHtml).toContain('-42 Hz');
    expect(openHtml).toContain('120 car/s');
    expect(openHtml).toContain('Accord automatique');
    expect(openHtml).toContain('Vote');
    expect(openHtml).toContain('Masquer');
    expect(openHtml).toContain('12 case(s) réparée(s)');
    // Screen-reader summaries (Requirement 8.4)
    expect(openHtml).toContain('Spectre 0 à 3 kHz');
    expect(openHtml).toContain('Sortie du discriminateur');
    expect(openHtml).toContain('périodes superposées');

    const collapsedHtml = renderToStaticMarkup(
      createElement(MathHud, {
        visible: false,
        onToggleVisible: () => undefined,
        thresholdMode: 'adaptive',
        onToggleThreshold: () => undefined,
        voteOn: false,
        onToggleVote: () => undefined,
        bufferRef,
        cps: 0,
        parityErrors: 0,
        framingErrors: 0,
        voteSummary: null,
      }),
    );
    expect(collapsedHtml).toContain('Afficher le HUD mathématique');
    expect(collapsedHtml).not.toContain('<canvas');
  });

  it('populates HudSignalBuffer from live DiagEvent frames and extracts 2-bit eye diagram traces', () => {
    const sampleRate = 16000;
    const engine = createLineEngine();
    expect(engine.init(sampleRate)).toBeNull();
    const encoded = encodePage(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    expect(
      engine.startTransmit({
        id: 1,
        bytes: encoded.value.bytes,
        pageId: SOMMAIRE_PREVIEW_PAGE_SOURCE.id,
        simulate: false,
      }),
    ).toBeNull();

    const buf = createHudSignalBuffer();
    while (engine.hasActiveTransmit()) {
      const block = engine.nextTransmitBlock();
      if (!block) break;
      for (const ev of block.events) {
        if (ev.e === 'diag') {
          pushDiagToHudBuffer(buf, ev.d, ev.spectrumDb, ev.sampleRate);
        }
      }
    }

    expect(buf.waterfallRows.length).toBeGreaterThan(0);
    expect(buf.sampleCount).toBeGreaterThan(100);
    expect(buf.bitWindows.length).toBeGreaterThan(0);

    const eyeTraces = extractEyeTraces(buf, 16);
    expect(eyeTraces.length).toBeGreaterThan(0);
    for (const tr of eyeTraces) {
      expect(tr.xNorm.length).toBeGreaterThanOrEqual(2);
      for (const x of tr.xNorm) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(2);
      }
    }
  });

  it('tracks characters/s, parity & framing errors, per-pageId vote in Seul, and >= 80% similarity vote in Écoute', async () => {
    const pages = await loadAllContentPages();
    const pageA = pages[0];
    const pageB = pages[1];
    const encA = encodePage(pageA);
    const encB = encodePage(pageB);
    expect(encA.ok && encB.ok).toBe(true);
    if (!encA.ok || !encB.ok) return;

    const cleanA = decodePageSourceToScreen(pageA);
    const cleanB = decodePageSourceToScreen(pageB);

    // 1. Per-pageId vote in Seul via uiReducer + live toggle of Vote
    const standby = decodePageSourceToScreen(STANDBY_PAGE_SOURCE);
    let state = createInitialUiState(standby);
    const { state: router } = connectRouter();
    state = uiReducer(state, { type: 'BEGIN_SESSION', router });

    const rx1 = cloneScreen(cleanA);
    rx1.rows[5][2] = createBlankCell({ error: true });
    rx1.rows[5][3] = createBlankCell({ error: true });

    const rx2 = cloneScreen(cleanA);
    rx2.rows[8][10] = createBlankCell({ error: true });

    // Simulate 10 character arrivals at 120 chars/s (every 400 samples @ 48 kHz) with 2 parity + 1 framing error
    const rxStatsEvents: TimedEvent[] = Array.from({ length: 10 }, (_, idx) => ({
      atSample: (idx + 1) * 400,
      e: 'rxStats',
      chars: 1,
      parityErrors: idx < 2 ? 1 : 0,
      framingErrors: idx === 4 ? 1 : 0,
      sampleRate: 48000,
    }));

    state = uiReducer(state, { type: 'APPLY_TIMED_EVENTS', events: rxStatsEvents });
    expect(state.errors).toEqual({ parity: 2, framing: 1 });
    expect(state.cps).toBeCloseTo(120, 0);

    // Complete reception 1 -> 2 error cells remain on screen
    state = uiReducer(state, {
      type: 'APPLY_TIMED_EVENTS',
      events: [{ atSample: 10000, e: 'pageEnd', screen: rx1 }],
    });
    expect(state.cps).toBe(0);
    expect(getActiveVoteSummary(state.votes)?.receptions).toBe(1);
    expect(cellErrorRate(state.shown, cleanA)).toBeGreaterThan(0);

    // Press Répétition -> transmit same pageId + same bytes -> complete reception 2 -> vote repairs all cells!
    state = uiReducer(state, { type: 'UPDATE_ROUTER_FOR_TRANSMIT', router });
    state = uiReducer(state, {
      type: 'APPLY_TIMED_EVENTS',
      events: [{ atSample: 20000, e: 'pageEnd', screen: rx2 }],
    });
    expect(getActiveVoteSummary(state.votes)).toEqual({
      pageId: router.lastOutput.pageId,
      receptions: 2,
      unresolved: 0,
      lastReceptionErrors: 2,
    });
    expect(screensEqual(state.baseScreen, cleanA)).toBe(true);
    expect(
      screensEqual(
        state.shown,
        overlayInputFieldOnScreen(cleanA, router.lastOutput.input, ''),
      ),
    ).toBe(true);

    // Toggling Vote off displays lastReception (rx2, which still has 1 error cell); toggling back on restores cleanA
    state = uiReducer(state, { type: 'TOGGLE_VOTE' });
    expect(state.voteOn).toBe(false);
    expect(screensEqual(state.baseScreen, rx2)).toBe(true);
    expect(
      screensEqual(
        state.shown,
        overlayInputFieldOnScreen(rx2, router.lastOutput.input, ''),
      ),
    ).toBe(true);
    state = uiReducer(state, { type: 'TOGGLE_VOTE' });
    expect(state.voteOn).toBe(true);
    expect(screensEqual(state.baseScreen, cleanA)).toBe(true);

    // Changing bytes for the same pageId resets its vote back to 0
    let store = preparePageVote(
      state.votes,
      router.lastOutput.pageId,
      encB.value.bytes,
    );
    expect(getActiveVoteSummary(store)).toBeNull();

    // 2. Écoute mode >= 80% non-error similarity matching across two interleaved pages
    store = createEmptyVoteStore();
    const ecouteA1 = cloneScreen(cleanA);
    const ecouteA2 = cloneScreen(cleanA);
    for (let c = 0; c < 30; c++) {
      ecouteA1.rows[4][c] = createBlankCell({ error: true });
      ecouteA2.rows[10][c] = createBlankCell({ error: true });
    }
    const ecouteB1 = cloneScreen(cleanB);
    for (let c = 0; c < 25; c++) {
      ecouteB1.rows[6][c] = createBlankCell({ error: true });
    }

    store = recordCompletedPageVote(store, ecouteA1, 'Ecoute');
    const idA = store.activePageId;
    expect(idA).toBe('ecoute/page-1');

    // Distinct page (< 80% similar) creates a second bucket
    store = recordCompletedPageVote(store, ecouteB1, 'Ecoute');
    expect(store.activePageId).toBe('ecoute/page-2');

    // Second copy of page A (>= 80% non-error cells equal) joins ecoute/page-1 and repairs it completely
    store = recordCompletedPageVote(store, ecouteA2, 'Ecoute');
    expect(store.activePageId).toBe(idA);
    expect(getActiveVoteSummary(store)?.receptions).toBe(2);
    expect(getActiveVoteSummary(store)?.unresolved).toBe(0);
    expect(
      screensEqual(
        selectDisplayedScreenForVote(store, true, ecouteA2),
        cleanA,
      ),
    ).toBe(true);
  });
});

describe('neominitel-app Task 11.2, 11.3 & 13: 3615 MATHS PN9 BER bench, Vote 1/3/5/7 vs formulas, and SimControls', () => {
  it('streams PN9 bench frames after maths/banc, emits live BER Wilson intervals, and produces a new point within < 2 s when Eb/N0 changes', () => {
    const lintReport = lintPages([...MATHS_PROVISIONAL_PAGES, MATHS_GUIDE_PAGE]);
    expect(lintReport.issues).toEqual([]);
    expect(lintReport.ok).toBe(true);

    const [initState] = mathsService.init();
    const [, bancOutput] = mathsService.handle(initState, {
      kind: 'key',
      key: 'Envoi',
      text: 'BANC',
    });
    expect(bancOutput).not.toBeNull();
    expect(bancOutput?.pageId).toBe('maths/banc');
    expect(bancOutput?.testPattern?.frames).toBeGreaterThan(0);
    if (!bancOutput) return;

    const sampleRate = 16000;
    const engine = createLineEngine();
    expect(engine.init(sampleRate)).toBeNull();
    engine.setThreshold('adaptive');
    engine.setSim({
      ...DEFAULT_SIM_PARAMS,
      ebN0Db: 10,
      seed: 0x2026_1125,
    });

    // Stream maths/banc followed by 360 PN9 frames (3.0 s of bench traffic)
    expect(
      engine.startTransmit({
        id: 1,
        bytes: bancOutput.bytes,
        pageId: bancOutput.pageId,
        simulate: true,
        testPattern: { frames: 360 },
      }),
    ).toBeNull();

    const standby = decodePageSourceToScreen(STANDBY_PAGE_SOURCE);
    let uiState = createInitialUiState(standby);
    let sawPageEnd = false;
    let switchedEbN0 = false;
    let blocksAfterSwitch = 0;
    let sawHighSnrPoint = false;

    while (engine.hasActiveTransmit()) {
      const block = engine.nextTransmitBlock();
      if (!block) break;

      if (switchedEbN0 && !sawHighSnrPoint) {
        blocksAfterSwitch++;
      }

      uiState = uiReducer(uiState, {
        type: 'APPLY_TIMED_EVENTS',
        events: block.events,
      });

      for (const ev of block.events) {
        if (ev.e === 'pageEnd') {
          sawPageEnd = true;
        }
        if (ev.e === 'ber' && ev.ebN0Db === 10 && !switchedEbN0 && ev.bits >= 400) {
          // Requirement 6.3: change Eb/N0 during the test and get a new measured point in < 10 s
          switchedEbN0 = true;
          engine.setSim({
            ...DEFAULT_SIM_PARAMS,
            ebN0Db: 16,
            seed: 0x2026_9999,
          });
        }
        if (ev.e === 'ber' && ev.ebN0Db === 16) {
          sawHighSnrPoint = true;
        }
      }
    }

    expect(sawPageEnd).toBe(true);
    expect(switchedEbN0).toBe(true);
    expect(sawHighSnrPoint).toBe(true);
    // 10 blocks = 1.0 s << 10 s ceiling from Requirement 6.3
    expect(blocksAfterSwitch).toBeLessThanOrEqual(10);

    const pt10 = uiState.berPoints.find((p) => p.ebN0Db === 10);
    const pt16 = uiState.berPoints.find((p) => p.ebN0Db === 16);
    expect(pt10).toBeDefined();
    expect(pt16).toBeDefined();
    if (pt10 && pt16) {
      expect(pt10.ber).toBeGreaterThan(0.05);
      expect(pt10.lo).toBeLessThanOrEqual(pt10.ber);
      expect(pt10.hi).toBeGreaterThanOrEqual(pt10.ber);
      expect(pt16.ber).toBeLessThan(0.01);
    }

    const chartHtml = renderToStaticMarkup(
      createElement(BerChart, { points: uiState.berPoints }),
    );
    expect(chartHtml).toContain('1. Orthog.');
    expect(chartHtml).toContain('2. Marcum h=2/3');
    expect(chartHtml).toContain('3. Discrim. MC');
    expect(chartHtml).toContain('Courbes BER V.23');
  });

  it('computes 1 / 3 / 5 / 7 reception CER progression next to erasure (p^N) and majority formulas', () => {
    expect(erasureVoteFailureFormula(0.2, 5)).toBeCloseTo(Math.pow(0.2, 5), 10);
    expect(majorityVoteFailureFormula(0.1, 3)).toBeCloseTo(
      3 * 0.01 * 0.9 + 0.001,
      10,
    );
    expect(parityUndetectedApprox(0.01)).toBeCloseTo(28 * 0.0001, 10);

    const votePage = MATHS_PROVISIONAL_PAGES[3];
    expect(votePage.id).toBe('maths/vote');
    const encoded = encodePage(votePage);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const cleanScreen = decodePageSourceToScreen(votePage);
    let store = preparePageVote(
      createEmptyVoteStore(),
      votePage.id,
      encoded.value.bytes,
    );

    // Feed 7 noisy receptions with shrinking disjoint & overlapping erasures
    for (let rep = 0; rep < 7; rep++) {
      const rx = cloneScreen(cleanScreen);
      // Erase 40 cells per reception; cell (2, 0) stays erased for reps 0..3 and recovers on rep 4
      if (rep < 4) {
        rx.rows[2][0] = createBlankCell({ error: true });
      }
      for (let k = 0; k < 39; k++) {
        const col = (rep * 7 + k) % SCREEN_COLS;
        const row = 3 + ((rep * 3 + k) % 18);
        rx.rows[row][col] = createBlankCell({ error: true });
      }
      store = recordCompletedPageVote(store, rx, 'Seul');
    }

    const prog = getActiveVoteProgression(store);
    expect(prog).not.toBeNull();
    if (!prog) return;

    expect(prog.totalReceptions).toBe(7);
    expect(prog.measuredErasureRate).toBeCloseTo(40 / 1000, 3);
    expect(prog.measuredUndetectedRate).toBe(0);
    expect(prog.rows.map((r) => r.receptions)).toEqual([1, 3, 5, 7]);

    const cer1 = prog.rows[0].measuredCer ?? 1;
    const cer3 = prog.rows[1].measuredCer ?? 1;
    const cer5 = prog.rows[2].measuredCer ?? 1;
    const cer7 = prog.rows[3].measuredCer ?? 1;
    expect(cer1).toBeCloseTo(0.04, 4);
    expect(cer3).toBeLessThan(cer1);
    expect(cer5).toBe(0);
    expect(cer7).toBe(0);

    const panelHtml = renderToStaticMarkup(
      createElement(VoteCerPanel, {
        progression: prog,
        canAutoRepeat: true,
        autoRepeating: false,
      }),
    );
    expect(panelHtml).toContain('Vote 1 / 3 / 5 / 7 vs formules');
    expect(panelHtml).toContain('Effac. p^N');
    expect(panelHtml).toContain('28·ε²');
  });

  it('renders SimControls, applies mid-page simulator changes within <= 200 ms, and replays seeded runs identically', () => {
    const simHtml = renderToStaticMarkup(
      createElement(SimControls, {
        sim: {
          ebN0Db: 12.5,
          offsetHz: -150,
          clockPct: 0.8,
          hum: true,
          bursts: false,
          seed: 1985,
        },
        canReplay: true,
        onChangeSim: () => undefined,
        onReplaySeeded: () => undefined,
      }),
    );
    expect(simHtml).toContain('12.5 dB');
    expect(simHtml).toContain('-150 Hz');
    expect(simHtml).toContain('+0.8 %');
    expect(simHtml).toContain('Ronflette 50 Hz');
    expect(simHtml).toContain('Salves parasites');
    expect(simHtml).toContain('Rejouer la graine');

    const encoded = encodePage(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    // 1. Mid-page simulator change takes effect on the very next 100 ms block (<= 200 ms, Req 3.2)
    const liveEngine = createLineEngine();
    expect(liveEngine.init(16000)).toBeNull();
    liveEngine.setSim({ ...DEFAULT_SIM_PARAMS });
    expect(
      liveEngine.startTransmit({
        id: 1,
        bytes: encoded.value.bytes,
        pageId: SOMMAIRE_PREVIEW_PAGE_SOURCE.id,
        simulate: true,
      }),
    ).toBeNull();

    const cleanBlock1 = liveEngine.nextTransmitBlock();
    const cleanBlock2 = liveEngine.nextTransmitBlock();
    expect(cleanBlock1).not.toBeNull();
    expect(cleanBlock2).not.toBeNull();

    // Inject severe noise (Eb/N0 = 2 dB) mid-page
    liveEngine.setSim({
      ...DEFAULT_SIM_PARAMS,
      ebN0Db: 2,
      seed: 0x9876,
    });
    const noisyNext1 = liveEngine.nextTransmitBlock();
    const noisyNext2 = liveEngine.nextTransmitBlock();
    let errorsWithin200ms = 0;
    for (const blk of [noisyNext1, noisyNext2]) {
      for (const ev of blk?.events ?? []) {
        if (ev.e === 'rxStats') {
          errorsWithin200ms += ev.parityErrors + ev.framingErrors;
        }
      }
    }
    expect(errorsWithin200ms).toBeGreaterThan(0);

    // 2. Seeded replay determinism (Req 3.3): identical seed gives cell-for-cell identical noisy screen
    function runSeededPage(seed: number) {
      const eng = createLineEngine();
      eng.init(16000);
      eng.setSim({
        ebN0Db: 11.5,
        offsetHz: 90,
        clockPct: 0,
        hum: true,
        bursts: false,
        seed,
      });
      eng.startTransmit({
        id: 1,
        bytes: encoded.ok ? encoded.value.bytes : new Uint8Array(),
        pageId: SOMMAIRE_PREVIEW_PAGE_SOURCE.id,
        simulate: true,
      });
      let endScreen = createBlankScreen();
      while (eng.hasActiveTransmit()) {
        const b = eng.nextTransmitBlock();
        if (!b) break;
        for (const ev of b.events) {
          if (ev.e === 'pageEnd') endScreen = ev.screen;
        }
      }
      return endScreen;
    }

    const replay1 = runSeededPage(0xabc_def);
    const replay2 = runSeededPage(0xabc_def);
    const differentSeed = runSeededPage(0x111_222);

    expect(screensEqual(replay1, replay2)).toBe(true);
    expect(screensEqual(replay1, differentSeed)).toBe(false);
  });
});

describe('neominitel-app Property Tests', () => {
  const runs = (fast: number, slow: number): number => (isSlowTestsEnabled() ? slow : fast);

  it('A1 services are deterministic: the same input sequence gives byte-identical outputs', () => {
    const arbServiceInput: fc.Arbitrary<ServiceInput> = fc.record({
      kind: fc.constant('key' as const),
      key: fc.constantFrom(...ALL_FUNCTION_KEYS),
      text: fc.oneof(
        fc.constantFrom('', 'MATHS', 'FANTOME', 'LIBRE', 'SOMMAIRE', 'INCONNU'),
        fc.string({ maxLength: 15 }),
      ),
    });

    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_SERVICE_IDS),
        fc.array(arbServiceInput, { minLength: 0, maxLength: 30 }),
        (serviceId, inputs) => {
          const svc = getServiceById(serviceId);
          const [firstStateA, initOutA] = svc.init();
          const [firstStateB, initOutB] = svc.init();
          let stateA = firstStateA;
          let stateB = firstStateB;

          expect(initOutA.pageId).toBe(initOutB.pageId);
          expect(Array.from(initOutA.bytes)).toEqual(Array.from(initOutB.bytes));

          for (const inp of inputs) {
            const [nextA, outA] = svc.handle(stateA, inp);
            const [nextB, outB] = svc.handle(stateB, inp);
            stateA = nextA;
            stateB = nextB;

            if (outA === null || outB === null) {
              expect(outA).toBeNull();
              expect(outB).toBeNull();
            } else {
              expect(outA.pageId).toBe(outB.pageId);
              expect(Array.from(outA.bytes)).toEqual(Array.from(outB.bytes));
            }
          }
        },
      ),
      { numRuns: runs(100, 400) },
    );
  });

  it('A2 navigation (model-based, fast-check commands): Sommaire returns main page, Connexion/Fin returns to start, Répétition resends identical bytes', () => {
    interface NavModel {
      online: boolean;
      activeServiceId: ServiceId | null;
      lastBytes: Uint8Array | null;
    }

    interface NavReal {
      router: RouterState | null;
    }

    class ConnectCmd implements fc.Command<NavModel, NavReal> {
      check(m: Readonly<NavModel>): boolean {
        return !m.online;
      }
      run(m: NavModel, r: NavReal): void {
        const { state, effect } = connectRouter();
        r.router = state;
        m.online = true;
        m.activeServiceId = 'SOMMAIRE';
        expect(effect.kind).toBe('transmit');
        if (effect.kind === 'transmit') {
          m.lastBytes = effect.output.bytes.slice();
        }
      }
      toString(): string {
        return 'Connect()';
      }
    }

    class TypeTextCmd implements fc.Command<NavModel, NavReal> {
      constructor(readonly text: string) {}
      check(m: Readonly<NavModel>): boolean {
        return m.online;
      }
      run(_m: NavModel, r: NavReal): void {
        if (!r.router) return;
        const { state } = stepRouterChar(r.router, this.text);
        r.router = state;
      }
      toString(): string {
        return `Type(${JSON.stringify(this.text)})`;
      }
    }

    class PressKeyCmd implements fc.Command<NavModel, NavReal> {
      constructor(readonly key: FunctionKey) {}
      check(): boolean {
        return true;
      }
      run(m: NavModel, r: NavReal): void {
        if (!m.online || r.router === null) {
          if (this.key === 'ConnexionFin') {
            const { state, effect } = connectRouter();
            r.router = state;
            m.online = true;
            m.activeServiceId = 'SOMMAIRE';
            if (effect.kind === 'transmit') {
              m.lastBytes = effect.output.bytes.slice();
            }
          }
          return;
        }

        const prevBytes = m.lastBytes ? m.lastBytes.slice() : null;
        const { state: nextRouter, effect } = stepRouterKey(r.router, this.key);
        r.router = nextRouter;

        if (this.key === 'ConnexionFin') {
          expect(nextRouter).toBeNull();
          expect(effect).toEqual({ kind: 'disconnect' });
          m.online = false;
          m.activeServiceId = null;
          m.lastBytes = null;
          return;
        }

        expect(nextRouter).not.toBeNull();
        if (!nextRouter) return;

        m.activeServiceId = nextRouter.activeServiceId;

        if (this.key === 'Repetition') {
          expect(effect.kind).toBe('transmit');
          if (effect.kind === 'transmit' && prevBytes !== null) {
            expect(effect.isRepetition).toBe(true);
            expect(Array.from(effect.output.bytes)).toEqual(Array.from(prevBytes));
          }
        }

        if (this.key === 'Sommaire') {
          const expectedMain = getServiceById(nextRouter.activeServiceId).init()[1];
          expect(effect.kind).toBe('transmit');
          if (effect.kind === 'transmit') {
            expect(effect.output.pageId).toBe(expectedMain.pageId);
            expect(Array.from(effect.output.bytes)).toEqual(
              Array.from(expectedMain.bytes),
            );
          }
        }

        if (effect.kind === 'transmit') {
          m.lastBytes = effect.output.bytes.slice();
        }
      }
      toString(): string {
        return `Key(${this.key})`;
      }
    }

    const commandArbs = [
      fc.constant(new ConnectCmd()),
      fc
        .oneof(
          fc.constantFrom('MATHS', 'FANTOME', 'LIBRE', 'SOMMAIRE', '3615 maths', 'XYZ'),
          fc.string({ minLength: 1, maxLength: 10 }),
        )
        .map((t) => new TypeTextCmd(t)),
      fc.constantFrom(...ALL_FUNCTION_KEYS).map((k) => new PressKeyCmd(k)),
    ];

    fc.assert(
      fc.property(fc.commands(commandArbs, { maxCommands: 40 }), (cmds) => {
        const setup = (): { model: NavModel; real: NavReal } => ({
          model: { online: false, activeServiceId: null, lastBytes: null },
          real: { router: null },
        });
        fc.modelRun(setup, cmds);
      }),
      { numRuns: runs(100, 400) },
    );
  });

  it('A3 clean loopback: for every page in content/pages/, the full Seul pipeline with a clean line gives the expected screen exactly', async () => {
    const pages = await loadAllContentPages();
    expect(pages.length).toBeGreaterThanOrEqual(8);

    const sampleRates = isSlowTestsEnabled() ? [8000, 44100, 48000] : [48000];

    for (const sampleRate of sampleRates) {
      const engine = createLineEngine();
      expect(engine.init(sampleRate)).toBeNull();
      engine.setSim({ ...DEFAULT_SIM_PARAMS });
      engine.setThreshold('fixed');

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const expectedRes = buildPageScreen(page);
        expect(expectedRes.ok).toBe(true);
        if (!expectedRes.ok) continue;

        const encodedRes = encodePage(page);
        expect(encodedRes.ok).toBe(true);
        if (!encodedRes.ok) continue;

        expect(
          engine.startTransmit({
            id: i + 1,
            bytes: encodedRes.value.bytes,
            pageId: page.id,
            simulate: true,
            withConnectionSequence: false,
          }),
        ).toBeNull();

        let diffScreen = createBlankScreen();
        let pageEndScreen = null;

        while (engine.hasActiveTransmit()) {
          const block = engine.nextTransmitBlock();
          if (!block) break;
          diffScreen = applyTimedEventsToScreen(diffScreen, block.events).screen;
          for (const ev of block.events) {
            if (ev.e === 'pageEnd') {
              pageEndScreen = ev.screen;
            }
          }
        }

        expect(pageEndScreen).not.toBeNull();
        if (pageEndScreen) {
          expect(screensEqual(pageEndScreen, expectedRes.value.screen)).toBe(true);
        }
        expect(screensEqual(diffScreen, expectedRes.value.screen)).toBe(true);
      }
    }
  });

  it('A4 noisy loopback with vote: at Eb/N0 = 14.0 dB (calibrated) and 5 repetitions, the voted screen matches the reference on >= 99% of cells for 10 seeds', () => {
    const A4_EBN0_DB = 14.0;
    const REPETITIONS = 5;
    const page = SOMMAIRE_PREVIEW_PAGE_SOURCE;
    const built = buildPageScreen(page);
    const encoded = encodePage(page);
    expect(built.ok && encoded.ok).toBe(true);
    if (!built.ok || !encoded.ok) return;

    const refScreen = built.value.screen;
    const bytes = encoded.value.bytes;

    const configs: readonly { sampleRate: number; seeds: number }[] =
      isSlowTestsEnabled()
        ? [
            { sampleRate: 8000, seeds: 20 },
            { sampleRate: 16000, seeds: 20 },
            { sampleRate: 48000, seeds: 10 },
          ]
        : [{ sampleRate: 16000, seeds: 10 }];

    for (const { sampleRate, seeds } of configs) {
      let totalSingleCer = 0;

      for (let seedIdx = 1; seedIdx <= seeds; seedIdx++) {
        const engine = createLineEngine();
        expect(engine.init(sampleRate)).toBeNull();
        engine.setThreshold('adaptive');
        engine.setSim({
          ...DEFAULT_SIM_PARAMS,
          ebN0Db: A4_EBN0_DB,
          seed: 0x3615_0000 + seedIdx,
        });

        let voteStore = preparePageVote(createEmptyVoteStore(), page.id, bytes);

        for (let rep = 0; rep < REPETITIONS; rep++) {
          expect(
            engine.startTransmit({
              id: rep + 1,
              bytes,
              pageId: page.id,
              simulate: true,
              withConnectionSequence: false,
            }),
          ).toBeNull();

          let receivedScreen = null;
          while (engine.hasActiveTransmit()) {
            const block = engine.nextTransmitBlock();
            if (!block) break;
            for (const ev of block.events) {
              if (ev.e === 'pageEnd') {
                receivedScreen = ev.screen;
              }
            }
          }

          expect(receivedScreen).not.toBeNull();
          if (receivedScreen) {
            totalSingleCer += cellErrorRate(receivedScreen, refScreen);
            voteStore = recordCompletedPageVote(voteStore, receivedScreen, 'Seul');
          }
        }

        const votedScreen = selectDisplayedScreenForVote(
          voteStore,
          true,
          createBlankScreen(),
        );
        const votedCer = cellErrorRate(votedScreen, refScreen);
        expect(votedCer).toBeLessThanOrEqual(0.01);
      }

      // Sanity check: single receptions under 14 dB AWGN do carry real errors (repaired by the vote)
      const meanSingleCer = totalSingleCer / (seeds * REPETITIONS);
      expect(meanSingleCer).toBeGreaterThan(0.002);
    }
  }, 120_000);

  it('A5 scheduler: events are applied in atSample order and never before their playback time', () => {
    interface TestItem {
      atSample: number;
      id: number;
    }

    const arbBatchAndTicks = fc.record({
      batches: fc.array(
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 0, maxLength: 25 }),
        { minLength: 1, maxLength: 12 },
      ),
      tickDeltas: fc.array(fc.integer({ min: 0, max: 15_000 }), {
        minLength: 1,
        maxLength: 20,
      }),
    });

    fc.assert(
      fc.property(arbBatchAndTicks, ({ batches, tickDeltas }) => {
        const scheduler = createEventScheduler<TestItem>();
        let nextId = 0;

        const allItems: TestItem[] = [];
        for (const batch of batches) {
          const items = batch.map((atSample) => {
            const item = { atSample, id: nextId++ };
            allItems.push(item);
            return item;
          });
          scheduler.enqueue(items);
        }

        let currentSample = 0;
        const emittedAll: TestItem[] = [];

        for (const delta of tickDeltas) {
          currentSample += delta;
          const due = scheduler.drainUpTo(currentSample);

          for (const ev of due) {
            expect(ev.atSample).toBeLessThanOrEqual(currentSample);
            emittedAll.push(ev);
          }
        }

        const finalSample = 200_000;
        const rest = scheduler.drainUpTo(finalSample);
        for (const ev of rest) {
          expect(ev.atSample).toBeLessThanOrEqual(finalSample);
          emittedAll.push(ev);
        }

        expect(scheduler.pendingCount()).toBe(0);
        expect(emittedAll.length).toBe(allItems.length);

        for (let i = 1; i < emittedAll.length; i++) {
          const prev = emittedAll[i - 1];
          const curr = emittedAll[i];
          expect(curr.atSample).toBeGreaterThanOrEqual(prev.atSample);
          if (curr.atSample === prev.atSample) {
            expect(curr.id).toBeGreaterThan(prev.id);
          }
        }
      }),
      { numRuns: runs(120, 500) },
    );
  });

  it('A6 content lint: every page satisfies the size, alphabet and < 80% similarity rules', async () => {
    const pages = await loadAllContentPages();
    expect(pages.length).toBeGreaterThanOrEqual(8);

    const report = lintPages(pages);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.maxSimilarity).toBeLessThan(MAX_PAIRWISE_PAGE_SIMILARITY);
  });

  it('A7 reducer: shown always has 25x40 cells; switching mode never leaves a capture or a transmission running', () => {
    const standby = decodePageSourceToScreen(STANDBY_PAGE_SOURCE);
    const { state: sampleRouter } = connectRouter();
    const encodedSommaire = encodePage(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    expect(encodedSommaire.ok).toBe(true);
    const sampleBytes = encodedSommaire.ok
      ? encodedSommaire.value.bytes
      : new Uint8Array([0x0c]);

    type HarnessStep =
      | { kind: 'switchMode'; mode: (typeof LINE_MODE_OPTIONS)[number]['id'] }
      | { kind: 'startCapture' }
      | { kind: 'startTransmit' }
      | { kind: 'startFile'; realtime: boolean }
      | { kind: 'action'; action: UiAction };

    const arbMalformedScreen = fc
      .array(
        fc.array(fc.constant(createBlankCell({ code: 0x58 })), {
          minLength: 0,
          maxLength: 45,
        }),
        { minLength: 0, maxLength: 30 },
      )
      .map((rows) => ({
        rows,
        cursor: { row: 99, col: -5, visible: true },
        attrs: createBlankScreen().attrs,
      }));

    const arbDiffEvent: fc.Arbitrary<TimedEvent> = fc
      .array(
        fc.tuple(
          fc.integer({ min: -5, max: 30 }),
          fc.integer({ min: -5, max: 45 }),
          fc.constant(createBlankCell({ code: 0x4d })),
        ),
        { minLength: 0, maxLength: 10 },
      )
      .map((cells) => ({ atSample: 100, e: 'diff' as const, cells }));

    const arbAction: fc.Arbitrary<UiAction> = fc.oneof(
      fc.constant<UiAction>({
        type: 'BEGIN_SESSION',
        router: sampleRouter,
        unmuteSpeaker: true,
      }),
      fc.constant<UiAction>({
        type: 'UPDATE_ROUTER_FOR_TRANSMIT',
        router: sampleRouter,
      }),
      fc.constant<UiAction>({ type: 'UPDATE_LOCAL_ECHO', router: sampleRouter }),
      fc.constant<UiAction>({ type: 'DISCONNECT', standby }),
      fc.constant<UiAction>({ type: 'MIC_ASKING' }),
      fc.constant<UiAction>({
        type: 'MIC_STARTED',
        rawOk: true,
        rawAudioWarning: null,
      }),
      fc.constant<UiAction>({ type: 'MIC_DENIED', message: 'Refusé' }),
      fc.constant<UiAction>({ type: 'SHOW_NO_CARRIER_HINT' }),
      fc.constant<UiAction>({ type: 'TOGGLE_MUTE' }),
      fc.constant<UiAction>({ type: 'TOGGLE_PALETTE' }),
      fc.constant<UiAction>({ type: 'TOGGLE_CRT' }),
      fc.constant<UiAction>({ type: 'TOGGLE_HUD_VISIBLE' }),
      fc.constant<UiAction>({ type: 'TOGGLE_THRESHOLD' }),
      fc.constant<UiAction>({ type: 'TOGGLE_VOTE' }),
      fc.constant<UiAction>({ type: 'CLEAR_BER_POINTS' }),
      fc.constant<UiAction>({ type: 'START_AUTO_REPEAT', target: 5 }),
      fc.constant<UiAction>({
        type: 'FILE_PROGRESS',
        done: 50,
        total: 100,
      }),
      fc.constant<UiAction>({ type: 'FILE_REALTIME_ENDED' }),
      fc.constant<UiAction>({
        type: 'FILE_ERROR',
        fileName: 'bad.wav',
        message: 'Erreur WAV',
      }),
      arbDiffEvent.map(
        (ev): UiAction => ({ type: 'APPLY_TIMED_EVENTS', events: [ev] }),
      ),
      arbMalformedScreen.map(
        (scr): UiAction => ({
          type: 'APPLY_TIMED_EVENTS',
          events: [{ atSample: 500, e: 'pageEnd', screen: scr }],
        }),
      ),
      arbMalformedScreen.map(
        (scr): UiAction => ({
          type: 'FILE_FAST_COMPLETE',
          events: [{ atSample: 500, e: 'pageEnd', screen: scr }],
        }),
      ),
    );

    const arbStep: fc.Arbitrary<HarnessStep> = fc.oneof(
      fc
        .constantFrom(...LINE_MODE_OPTIONS.map((o) => o.id))
        .map((mode): HarnessStep => ({ kind: 'switchMode', mode })),
      fc.constant<HarnessStep>({ kind: 'startCapture' }),
      fc.constant<HarnessStep>({ kind: 'startTransmit' }),
      fc
        .boolean()
        .map((realtime): HarnessStep => ({ kind: 'startFile', realtime })),
      arbAction.map((action): HarnessStep => ({ kind: 'action', action })),
    );

    const engine = createLineEngine();
    expect(engine.init(16000)).toBeNull();

    fc.assert(
      fc.property(
        fc.array(arbStep, { minLength: 1, maxLength: 35 }),
        (steps) => {
          engine.reset();
          expect(engine.init(16000)).toBeNull();
          let state = createInitialUiState(standby);
          let captureRunning = false;
          let playerPlaying = false;
          let scheduledEvents = 0;

          for (const step of steps) {
            if (step.kind === 'switchMode') {
              state = executeModeSwitch(state, step.mode, standby, {
                stopCapture: () => {
                  captureRunning = false;
                },
                stopTransmit: () => {
                  engine.stopTransmit();
                },
                stopPlayer: () => {
                  playerPlaying = false;
                },
                clearScheduler: () => {
                  scheduledEvents = 0;
                },
                resetWorker: () => {
                  engine.reset();
                  engine.init(16000);
                },
              });

              // Mode switch invariant: never leaves a capture or a transmission running
              expect(captureRunning).toBe(false);
              expect(engine.hasActiveTransmit()).toBe(false);
              expect(playerPlaying).toBe(false);
              expect(scheduledEvents).toBe(0);
              expect(state.micState).toBe('off');
              expect(state.carrierOn).toBe(false);
              expect(state.autoRepeatTarget).toBe(0);
              expect(state.file.status).toBe('idle');
            } else if (step.kind === 'startCapture') {
              if (state.mode === 'Ecoute') {
                captureRunning = true;
                state = uiReducer(state, {
                  type: 'MIC_STARTED',
                  rawOk: true,
                  rawAudioWarning: null,
                });
              }
            } else if (step.kind === 'startTransmit') {
              if (state.mode === 'Seul' || state.mode === 'Serveur') {
                engine.startTransmit({
                  id: 1,
                  bytes: sampleBytes,
                  pageId: 'sommaire/accueil',
                  simulate: state.mode === 'Seul',
                });
                playerPlaying = true;
                scheduledEvents = 3;
                state = uiReducer(state, {
                  type: 'BEGIN_SESSION',
                  router: sampleRouter,
                });
              }
            } else if (step.kind === 'startFile') {
              if (state.mode === 'Fichier') {
                playerPlaying = step.realtime;
                state = uiReducer(state, {
                  type: 'FILE_START',
                  fileName: 'sample.wav',
                  realtime: step.realtime,
                });
              }
            } else {
              state = uiReducer(state, step.action);
            }

            // Screen dimension invariant: shown ALWAYS has 25 x 40 cells
            expect(state.shown.rows.length).toBe(SCREEN_ROWS);
            for (let r = 0; r < SCREEN_ROWS; r++) {
              expect(state.shown.rows[r].length).toBe(SCREEN_COLS);
            }
          }
        },
      ),
      { numRuns: runs(120, 400) },
    );
  });
});

describe('neominitel-app Task 12, 14 & 15: Fichier mode, French errors, Accessibility & Bundle budget', () => {
  it('maps every ModemError, WavErrorReason, and PageError to a clear French message', () => {
    for (const reason of WAV_ERROR_REASONS) {
      const msg = formatWavErrorReasonFr(reason);
      expect(msg.length).toBeGreaterThan(15);
      expect(msg).not.toContain('undefined');
      expect(formatModemErrorFr({ kind: 'wav', reason })).toBe(msg);
    }

    expect(formatModemErrorFr({ kind: 'bad-sample-rate', sampleRate: 4000 })).toContain(
      '4000 Hz',
    );
    expect(
      formatModemErrorFr({ kind: 'byte-out-of-range', index: 3, value: 200 }),
    ).toContain('200');
    expect(
      formatModemErrorFr({
        kind: 'bad-option',
        option: 'amplitude',
        reason: 'out of range',
      }),
    ).toContain('amplitude');
    expect(
      formatModemErrorFr({ kind: 'internal', message: 'boom' }),
    ).toContain('boom');

    expect(formatPageErrorFr({ kind: 'row-too-long', row: 5, length: 44 })).toContain(
      '40 colonnes',
    );
    expect(formatPageErrorFr({ kind: 'too-many-rows' })).toContain('24 lignes');
    expect(formatPageErrorFr({ kind: 'bad-bitmap', reason: '6x6' })).toContain(
      'mosaïque',
    );
  });

  it('decodes WAV files in Fichier mode faster than real time with progress, supports real-time streaming, and reports corrupted WAVs in French', () => {
    const encoded = encodePage(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const sampleRate = 16000;
    const mod = modulate(encoded.value.bytes, {
      sampleRate,
      channel: 'forward',
      tailIdleMs: 350,
    });
    expect(mod.ok).toBe(true);
    if (!mod.ok) return;

    const wavRes = writeWav(mod.value, sampleRate);
    expect(wavRes.ok).toBe(true);
    if (!wavRes.ok) return;

    const engine = createLineEngine();
    const progressSteps: number[] = [];
    const fastMsg = engine.decodeWavFast(wavRes.value, (done, total) => {
      progressSteps.push(Math.round((done / total) * 100));
    });
    expect(fastMsg.t).toBe('live');
    expect(progressSteps.length).toBeGreaterThan(1);
    expect(progressSteps[progressSteps.length - 1]).toBe(100);

    const standby = decodePageSourceToScreen(STANDBY_PAGE_SOURCE);
    let state = createInitialUiState(standby);
    state = uiReducer(state, { type: 'SWITCH_MODE', mode: 'Fichier', standby });
    state = uiReducer(state, {
      type: 'FILE_START',
      fileName: 'sommaire.wav',
      realtime: false,
    });
    state = uiReducer(state, { type: 'FILE_PROGRESS', done: 50, total: 100 });
    expect(state.file.progressPct).toBe(50);

    if (fastMsg.t === 'live') {
      const nonDiag = fastMsg.events.filter((ev) => ev.e !== 'diag');
      state = uiReducer(state, {
        type: 'FILE_FAST_COMPLETE',
        events: nonDiag,
      });
    }
    expect(state.file.status).toBe('done');
    expect(state.file.progressPct).toBe(100);
    expect(
      screensEqual(
        state.shown,
        decodePageSourceToScreen(SOMMAIRE_PREVIEW_PAGE_SOURCE),
      ),
    ).toBe(true);
    expect(state.completedAriaSummary).toContain('3615 SOMMAIRE');

    // Invalid WAV produces typed error -> translated into plain French for FileDrop UI
    const badWavRes = engine.decodeWavFast(new Uint8Array([1, 2, 3, 4]));
    expect(badWavRes.t).toBe('error');
    if (badWavRes.t === 'error') {
      const frMsg = formatModemErrorFr(badWavRes.error);
      expect(frMsg).toContain('WAV trop court');
      state = uiReducer(state, {
        type: 'FILE_ERROR',
        fileName: 'corrompu.wav',
        message: frMsg,
      });
      const dropHtml = renderToStaticMarkup(
        createElement(FileDrop, {
          fileState: state.file,
          onSelectWavFile: () => undefined,
          onToggleRealtime: () => undefined,
        }),
      );
      expect(dropHtml).toContain('WAV trop court');
      expect(dropHtml).toContain('Choisir un fichier .wav');
    }

    const barHtml = renderToStaticMarkup(
      createElement(FileModeBar, {
        fileState: {
          ...INITIAL_FILE_MODE_STATE,
          status: 'done',
          fileName: 'L1.wav',
          progressPct: 100,
        },
        hasLoadedBuffer: true,
        onSelectWavFile: () => undefined,
        onToggleRealtime: () => undefined,
        onReplayFast: () => undefined,
        onReplayRealtime: () => undefined,
        onStopPlayback: () => undefined,
      }),
    );
    expect(barHtml).toContain('100 %');
    expect(barHtml).toContain('Décoder rapidement');
    expect(barHtml).toContain('Écouter en temps réel');
  });

  it('exposes keyboard skip link, aria-live completed screen summary, and keeps gzipped JS bundle strictly < 1 MB', () => {
    const appHtml = renderToStaticMarkup(createElement(App));
    expect(appHtml).toContain('href="#nm-terminal-main"');
    expect(appHtml).toContain('id="nm-terminal-main"');
    expect(appHtml).toContain('aria-live="polite"');

    const bundleReport = checkBundleSize();
    expect(bundleReport.issues).toEqual([]);
    expect(bundleReport.ok).toBe(true);
    expect(bundleReport.totalGzipJsBytes).toBeGreaterThan(0);
    expect(bundleReport.totalGzipJsBytes).toBeLessThan(MAX_GZIPPED_JS_BYTES);

    // Vite dev-server guard: no file in src/ may import directly from public/
    function listSrcFiles(dir: string): string[] {
      const res: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          res.push(...listSrcFiles(full));
        } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) {
          res.push(full);
        }
      }
      return res;
    }

    for (const srcFile of listSrcFiles(resolve(process.cwd(), 'src'))) {
      const code = readFileSync(srcFile, 'utf8');
      expect(code).not.toMatch(/from\s+['"][^'"]*\/public\//);
    }
  });
});

describe('GaplessPlayer Web Audio resilience (gesture unlock, Safari interrupted, 16->48 kHz resampling, non-blocking autoplay)', () => {
  interface ScheduledRecord {
    readonly sampleRate: number;
    readonly length: number;
    readonly startAt: number;
    readonly peak: number;
    triggerEnded(): void;
  }

  function createMockAudioEnv(options?: {
    hwSampleRate?: number;
    initialState?: string;
    hangResume?: boolean;
  }) {
    const hwSampleRate = options?.hwSampleRate ?? 48000;
    let state = options?.initialState ?? 'suspended';
    let currentTime = 0;
    let resumeCalls = 0;
    let closeCalls = 0;
    let gainValue = 1;
    const scheduled: ScheduledRecord[] = [];
    let stateChangeHandler: (() => void) | null = null;

    class MockAudioContext {
      sampleRate = hwSampleRate;
      destination = {};
      get state(): string {
        return state;
      }
      get currentTime(): number {
        return currentTime;
      }
      set onstatechange(fn: (() => void) | null) {
        stateChangeHandler = fn;
      }
      get onstatechange(): (() => void) | null {
        return stateChangeHandler;
      }
      createGain() {
        return {
          gain: {
            get value(): number {
              return gainValue;
            },
            set value(v: number) {
              gainValue = v;
            },
            cancelScheduledValues(): void {
              // no-op
            },
            setValueAtTime(v: number): void {
              gainValue = v;
            },
          },
          connect(): void {
            // no-op
          },
        };
      }
      createBuffer(_channels: number, length: number, rate: number) {
        const data = new Float32Array(length);
        return {
          length,
          sampleRate: rate,
          duration: length / rate,
          getChannelData: () => data,
        };
      }
      createBufferSource() {
        let assignedBuffer: {
          length: number;
          sampleRate: number;
          getChannelData: () => Float32Array;
        } | null = null;
        const node = {
          onended: null as (() => void) | null,
          set buffer(b: typeof assignedBuffer) {
            assignedBuffer = b;
          },
          get buffer() {
            return assignedBuffer;
          },
          connect(): void {
            // no-op
          },
          disconnect(): void {
            // no-op
          },
          start(when = 0): void {
            if (!assignedBuffer) return;
            const samples = assignedBuffer.getChannelData();
            let peak = 0;
            for (let i = 0; i < samples.length; i++) {
              const a = Math.abs(samples[i]);
              if (a > peak) peak = a;
            }
            scheduled.push({
              sampleRate: assignedBuffer.sampleRate,
              length: assignedBuffer.length,
              startAt: when,
              peak,
              triggerEnded: () => node.onended?.(),
            });
          },
          stop(): void {
            // no-op
          },
        };
        return node;
      }
      resume(): Promise<void> {
        resumeCalls++;
        if (options?.hangResume) {
          return new Promise<void>(() => {
            // Simulates Chrome/Safari hanging resume() when called outside user gesture
          });
        }
        state = 'running';
        stateChangeHandler?.();
        return Promise.resolve();
      }
      close(): Promise<void> {
        closeCalls++;
        state = 'closed';
        return Promise.resolve();
      }
    }

    return {
      Ctor: MockAudioContext as unknown as AudioContextConstructor,
      scheduled,
      getResumeCalls: () => resumeCalls,
      getCloseCalls: () => closeCalls,
      getGainValue: () => gainValue,
      setState: (next: string) => {
        state = next;
        stateChangeHandler?.();
      },
      advanceTime: (dtSec: number) => {
        currentTime += dtSec;
      },
    };
  }

  it('unlocks Safari interrupted & suspended states, resamples 16 kHz WAV blocks cleanly to 48 kHz hardware rate, and resets cleanly', async () => {
    const env = createMockAudioEnv({
      hwSampleRate: 48000,
      initialState: 'interrupted',
    });
    const player = createGaplessPlayer({
      initialMuted: false,
      audioContextCtor: env.Ctor,
      resumeTimeoutMs: 25,
    });

    // Synchronous gesture unlock recovers from Safari's 'interrupted' state immediately
    player.unlockFromGesture();
    expect(env.getResumeCalls()).toBeGreaterThanOrEqual(1);
    expect(env.getGainValue()).toBe(1);

    const activeRate = await player.ensureStarted();
    expect(activeRate).toBe(48000);

    // Schedule two consecutive 100 ms blocks of a 16 kHz WAV (1600 samples each)
    const wavBlock0 = new Float32Array(1600);
    const wavBlock1 = new Float32Array(1600);
    for (let i = 0; i < 1600; i++) {
      wavBlock0[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 16000);
      wavBlock1[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * (1600 + i)) / 16000);
    }

    const acked: number[] = [];
    player.scheduleBlock({
      id: 7,
      audio: wavBlock0,
      startSample: 0,
      sampleRate: 16000,
      onEnded: (id) => acked.push(id),
    });
    player.scheduleBlock({
      id: 7,
      audio: wavBlock1,
      startSample: 1600,
      sampleRate: 16000,
      onEnded: (id) => acked.push(id),
    });

    // Filter out the 1-sample silent gesture unlock buffer
    const realBuffers = env.scheduled.filter((b) => b.length > 1);
    expect(realBuffers.length).toBe(2);
    // Both buffers are created at native 48000 Hz (4800 samples = 0.100 s each) with audible signal
    expect(realBuffers[0].sampleRate).toBe(48000);
    expect(realBuffers[0].length).toBe(4800);
    expect(realBuffers[0].peak).toBeGreaterThan(0.45);
    expect(realBuffers[1].sampleRate).toBe(48000);
    expect(realBuffers[1].length).toBe(4800);
    expect(realBuffers[1].startAt).toBeCloseTo(realBuffers[0].startAt + 0.1, 6);

    // Sample clock still advances in stream units (16 kHz -> 1600 samples per 0.1 s)
    env.advanceTime(0.12);
    expect(player.currentSample()).toBe(1600);

    realBuffers[0].triggerEnded();
    expect(acked).toEqual([7]);

    // Mute & unmute update GainNode immediately
    player.setMuted(true);
    expect(env.getGainValue()).toBe(0);
    player.setMuted(false);
    expect(env.getGainValue()).toBe(1);

    // resetContext closes the old AudioContext so leaving Écoute recreates a fresh speaker context
    player.resetContext();
    expect(env.getCloseCalls()).toBe(1);
    player.dispose();
  });

  it('never hangs ensureStarted() or freezes block acks when browser autoplay blocks resume()', async () => {
    const blockedEnv = createMockAudioEnv({
      hwSampleRate: 44100,
      initialState: 'suspended',
      hangResume: true,
    });
    const player = createGaplessPlayer({
      audioContextCtor: blockedEnv.Ctor,
      resumeTimeoutMs: 20,
    });

    const t0 = Date.now();
    const rate = await player.ensureStarted();
    expect(rate).toBe(44100);
    expect(Date.now() - t0).toBeLessThan(250);

    // Even while AudioContext is stuck suspended, wall-clock fallback fires onEnded so worker never deadlocks
    const endedPromise = new Promise<number>((resolve) => {
      player.scheduleBlock({
        id: 42,
        audio: new Float32Array(441),
        startSample: 0,
        sampleRate: 44100,
        onEnded: (id) => resolve(id),
      });
    });
    expect(await endedPromise).toBe(42);

    // Once user clicks and AudioContext transitions to running, next block immediately plays on hardware
    blockedEnv.setState('running');
    const audibleBlock = new Float32Array(441).fill(0.4);
    player.scheduleBlock({
      id: 42,
      audio: audibleBlock,
      startSample: 441,
      sampleRate: 44100,
    });
    const hardwareBlocks = blockedEnv.scheduled.filter((b) => b.length === 441);
    expect(hardwareBlocks.length).toBe(1);
    expect(hardwareBlocks[0].peak).toBeCloseTo(0.4, 5);
    player.dispose();

    // Pure resampler check for odd non-integer ratios (16000 -> 44100 Hz)
    const resampled = resampleBlockForPlayback(
      new Float32Array(1600).fill(0.25),
      0,
      16000,
      44100,
    );
    expect(resampled.length).toBe(4410);
    expect(resampled[2000]).toBeCloseTo(0.25, 6);
  });
});

describe('neominitel-app Task 11.1: 3615 MATHS course pages', () => {
  type MathsInput = Parameters<typeof mathsService.handle>[1];
  const key = (k: string, text = ''): MathsInput => ({ kind: 'key', key: k, text }) as MathsInput;

  it('menu choice 4 (or COURS) opens the six course pages; SUITE / RETOUR walk them; the ends, SOMMAIRE and GUIDE behave', () => {
    const lint = lintPages([...MATHS_PROVISIONAL_PAGES, MATHS_GUIDE_PAGE, ...MATHS_COURS_PAGES]);
    expect(lint.issues).toEqual([]);
    expect(MATHS_COURS_PAGES).toHaveLength(6);

    const [home] = mathsService.init();
    for (const choice of ['4', 'cours', ' COURS ']) {
      const [s, out] = mathsService.handle(home, key('Envoi', choice));
      expect(out?.pageId, choice).toBe(MATHS_COURS_PAGES[0].id);
      expect(s.cours).toBe(0);
    }

    // Forward through the six pages, then back to the menu.
    let [state, out] = mathsService.handle(home, key('Envoi', '4'));
    const seen = [out?.pageId];
    for (let i = 1; i < 6; i++) {
      [state, out] = mathsService.handle(state, key('Suite'));
      seen.push(out?.pageId);
    }
    expect(seen).toEqual(MATHS_COURS_PAGES.map((p) => p.id));
    [state, out] = mathsService.handle(state, key('Suite'));
    expect(out?.pageId).toBe('maths/accueil');
    expect(state.cours).toBeUndefined();

    // RETOUR on page 2 goes to page 1, on page 1 to the menu.
    [state] = mathsService.handle(home, key('Envoi', '4'));
    [state] = mathsService.handle(state, key('Suite'));
    [state, out] = mathsService.handle(state, key('Retour'));
    expect(out?.pageId).toBe(MATHS_COURS_PAGES[0].id);
    [state, out] = mathsService.handle(state, key('Retour'));
    expect(out?.pageId).toBe('maths/accueil');

    // GUIDE from page 3, then RETOUR comes back to page 3; SOMMAIRE always returns to the menu.
    [state] = mathsService.handle(home, key('Envoi', '4'));
    [state] = mathsService.handle(state, key('Suite'));
    [state] = mathsService.handle(state, key('Suite'));
    [state, out] = mathsService.handle(state, key('Guide'));
    expect(out?.pageId).toBe('maths/guide');
    [state, out] = mathsService.handle(state, key('Retour'));
    expect(out?.pageId).toBe(MATHS_COURS_PAGES[2].id);
    [state, out] = mathsService.handle(state, key('Sommaire'));
    expect(out?.pageId).toBe('maths/accueil');
    expect(state.cours).toBeUndefined();

    // The existing choices are unchanged.
    expect(mathsService.handle(home, key('Envoi', '2'))[1]?.pageId).toBe('maths/banc');
    expect(mathsService.handle(home, key('Envoi', '5'))[1]).toBeNull();
  });
});

describe('neominitel-app Task 11.2: curve 4 on the BER chart', () => {
  it('draws curve 4 (correlator receiver, v23-modem task 15) with its legend, over the 19 points of the curve 3 grid', () => {
    const html = renderToStaticMarkup(createElement(BerChart, { points: [] }));
    expect(html).toContain('4. Corrél. MC');
    const m = html.match(/<path d="([^"]+)" fill="none" stroke="#d18cff"/);
    expect(m).not.toBeNull();
    const vertices = (m?.[1] ?? '').trim().split(' ');
    expect(vertices).toHaveLength(19);
    expect(vertices[0].startsWith('M')).toBe(true);
    expect(vertices.slice(1).every((v) => v.startsWith('L'))).toBe(true);
    expect(html).toContain('4 courbes affichées');
  });
});

describe('fantome Task 7 / neominitel-app: "Écoute voie retour" (backward receive channel)', () => {
  function backwardPageWav(text: string, sampleRate: number): Uint8Array {
    const page: PageSource = { id: 'test/voie-retour', rows: [{ row: 5, col: 2, segments: [{ text }] }] };
    const enc = encodePage(page);
    if (!enc.ok) throw new Error('encodePage');
    const mod = modulate(enc.value.bytes, { sampleRate, channel: 'backward', tailIdleMs: 400 });
    if (!mod.ok) throw new Error('modulate');
    const wav = writeWav(mod.value, sampleRate);
    if (!wav.ok) throw new Error('writeWav');
    return wav.value;
  }

  function decodedText(engine: ReturnType<typeof createLineEngine>, wav: Uint8Array): string {
    const res = engine.decodeWavFast(wav);
    expect(res.t).toBe('live');
    if (res.t !== 'live') return '';
    let text = '';
    for (const ev of res.events) if (ev.e === 'pageEnd') text += rowToText(ev.screen, 5);
    return text;
  }

  it('the line engine decodes a backward-channel WAV only after setRxChannel("backward"), and goes back to forward on request', () => {
    const fs = 16000;
    const wav = backwardPageWav('LA VOIX DU RETOUR', fs);
    const engine = createLineEngine();
    expect(engine.init(fs)).toBeNull();
    expect(decodedText(engine, wav)).not.toContain('LA VOIX DU RETOUR');
    engine.setRxChannel('backward');
    expect(decodedText(engine, wav)).toContain('LA VOIX DU RETOUR');
    engine.setRxChannel('forward');
    expect(decodedText(engine, wav)).not.toContain('LA VOIX DU RETOUR');
  });

  it('TOGGLE_RX_CHANNEL flips the receive channel (default forward)', () => {
    const s0 = createInitialUiState(createBlankScreen());
    expect(s0.rxChannel).toBe('forward');
    const s1 = uiReducer(s0, { type: 'TOGGLE_RX_CHANNEL' });
    expect(s1.rxChannel).toBe('backward');
    expect(uiReducer(s1, { type: 'TOGGLE_RX_CHANNEL' }).rxChannel).toBe('forward');
  });
});

describe('neominitel-app Task 16: 3615 LIBRE editor', () => {
  it('a draft becomes a page: blocks give G1 cells with their colours, a text line replaces the drawing on its row, blank cells are not sent', () => {
    let d = createBlankDraft();
    expect(draftToPageSource(d).mosaics).toEqual([]); // blank cells are not sent
    d = setBlock(d, 0, 0, true, 2); // cell (row 1, col 1), block b1, green
    d = setBlock(d, 3, 5, true, 1); // cell (row 2, col 2), block b6, red
    d = setBlock(d, 4, 3, true, 3); // cell (row 2, col 3), block b1, yellow
    d = setBlock(d, 4, 3, false, 3); // switched off again
    d = setBlock(d, 79, 71, true, 7); // last block of the page
    d = setTextLines(d, [{ row: 1, text: 'TITRE', fg: 6 }, { row: 30, text: 'hors page', fg: 7 }, { row: 5, text: '', fg: 7 }]);
    expect(d.lines).toEqual([{ row: 1, text: 'TITRE', fg: 6 }]);
    const bytes = encodeDraft(d);
    expect(bytes).not.toBeNull();
    if (!bytes) return;
    const screen = decodeBytes(bytes);
    expect(rowToText(screen, 1).startsWith('TITRE')).toBe(true); // the text wins over block (0, 0)
    const c22 = screen.rows[2][1];
    expect(c22.set).toBe('G1');
    expect(c22.code).toBe(blocksToG1Code([0, 0, 0, 0, 0, 1]));
    expect(c22.fg).toBe(1);
    const c23 = screen.rows[2][2];
    expect(c23.set === 'G1' && c23.code !== blocksToG1Code([0, 0, 0, 0, 0, 0])).toBe(false);
    const last = screen.rows[24][39];
    expect(last.set).toBe('G1');
    expect(last.code).toBe(blocksToG1Code([0, 0, 0, 0, 0, 1]));
    expect(last.fg).toBe(7);
  });

  it('an image mosaic fills the drawing (kept text lines), and setBackground colours every cell', () => {
    const img = { width: 80, height: 72, data: new Uint8Array(80 * 72 * 3).fill(255), channels: 3 as const };
    const res = imageToMosaic(img, 40, 24);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let d = setTextLines(createBlankDraft(), [{ row: 3, text: 'GARDE', fg: 2 }]);
    d = applyImageCells(d, res.value.cells);
    expect(d.lines).toHaveLength(1);
    expect(d.cells[10][10].bg).toBe(7); // white image: single colour white
    const bg = setBackground(createBlankDraft(), 4);
    expect(bg.cells.every((row) => row.every((c) => c.bg === 4))).toBe(true);
    const bytes = encodeDraft(d);
    expect(bytes).not.toBeNull();
    if (bytes) expect(rowToText(decodeBytes(bytes), 3).startsWith('GARDE')).toBe(true);
  });

  it('share link: decodeShareFragment(encodeShareFragment(b)) = b for any page bytes, and bad fragments are rejected', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 127 }), { minLength: 0, maxLength: 600 }), (tail) => {
        const bytes = Uint8Array.from([0x0c, ...tail]);
        const frag = encodeShareFragment(bytes);
        expect(frag.startsWith('libre=')).toBe(true);
        expect(/^libre=[A-Za-z0-9_-]*$/.test(frag)).toBe(true);
        expect(Array.from(decodeShareFragment(`#${frag}`) ?? [])).toEqual(Array.from(bytes));
        expect(Array.from(decodeShareFragment(`x=1&${frag}`) ?? [])).toEqual(Array.from(bytes));
      }),
      { numRuns: 100, seed: 1601 },
    );
    expect(decodeShareFragment('')).toBeNull();
    expect(decodeShareFragment('#autre=AAAA')).toBeNull();
    expect(decodeShareFragment('#libre=!!!!')).toBeNull();
    expect(decodeShareFragment(`#${encodeShareFragment(Uint8Array.from([0x41, 0x42]))}`)).toBeNull(); // no FF
    expect(decodeShareFragment(`#${encodeShareFragment(Uint8Array.from([0x0c, 0xc1]))}`)).toBeNull(); // 8-bit byte
    expect(decodeShareFragment(`#${encodeShareFragment(new Uint8Array(8193).fill(0x0c))}`)).toBeNull(); // too long
  });

  it('WAV export: the worker engine builds a WAV that decodes back to the page of the draft', () => {
    let d = setTextLines(createBlankDraft(), [{ row: 2, text: 'BONJOUR 3615', fg: 3 }]);
    for (let x = 0; x < 80; x++) d = setBlock(d, x, 30, true, 5);
    const bytes = encodeDraft(d);
    expect(bytes).not.toBeNull();
    if (!bytes) return;
    const engine = createLineEngine();
    const wav = engine.exportPageWav(bytes);
    expect(wav.t).toBe('ok');
    if (wav.t !== 'ok') return;
    expect(engine.init(48000)).toBeNull();
    const res = engine.decodeWavFast(wav.data);
    expect(res.t).toBe('live');
    if (res.t !== 'live') return;
    const ends = res.events.filter((e): e is Extract<TimedEvent, { e: 'pageEnd' }> => e.e === 'pageEnd');
    expect(ends.length).toBeGreaterThan(0);
    expect(screensEqual(ends[ends.length - 1].screen, decodeBytes(bytes))).toBe(true);
  });

  it('the editor renders its tools and the three ways out (sound, WAV, link)', () => {
    const html = renderToStaticMarkup(createElement(LibreEditor, { onSend: () => undefined, onExportWav: () => undefined, shareBaseUrl: 'https://x.test/' }));
    for (const label of ['Crayon', 'Gomme', 'Importer une image', 'Envoyer par le son', 'Exporter en WAV', 'Copier le lien de partage', 'Ajouter une ligne']) {
      expect(html, label).toContain(label);
    }
    expect(html).toMatch(/\d+ octets/);
  });
});

describe('neominitel-app Task 17: backward keyboard (keys at 75 baud)', () => {
  const fs = 16000;
  // "MATHS" typed, then Envoi; then Suite.
  const typed = [...'MATHS'].flatMap((c) => Array.from(backwardBytesForChar(c)));
  const burst = Uint8Array.from([...typed, ...encodeKey('Envoi'), ...encodeKey('Suite')]);

  function inputsOf(x: Float32Array): string[] {
    const l = createBackwardKeyListener(fs);
    if (!l.ok) throw new Error('listener');
    const out: string[] = [];
    for (let p = 0; p < x.length; p += 320) {
      for (const i of l.value.push(x.subarray(p, Math.min(x.length, p + 320)))) out.push(i.kind === 'key' ? `[${i.key}]` : i.char);
    }
    return out;
  }

  it('the server-side receiver gives back the typed characters then the function keys, alone and under a forward page at equal amplitude', () => {
    const back = modulate(burst, { sampleRate: fs, channel: 'backward', leadIdleMs: 120, tailIdleMs: 300 });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const expected = ['M', 'A', 'T', 'H', 'S', '[Envoi]', '[Suite]'];
    expect(inputsOf(back.value)).toEqual(expected);

    // Full duplex on the server: its own page on the forward channel reaches its microphone too.
    const page = encodePage({ id: 't', rows: [{ row: 3, col: 1, segments: [{ text: 'PAGE DU SERVEUR EN COURS D ENVOI' }] }] });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const fwd = modulate(page.value.bytes, { sampleRate: fs, channel: 'forward' });
    expect(fwd.ok).toBe(true);
    if (!fwd.ok) return;
    const mix = new Float32Array(back.value.length);
    for (let i = 0; i < mix.length; i++) mix[i] = 0.5 * back.value[i] + 0.5 * fwd.value[i % fwd.value.length];
    expect(inputsOf(mix)).toEqual(expected);
  });

  it('a SEP followed by an unknown code and non-printable bytes are not reported; backwardBytesForChar sends only G0 printable characters', () => {
    const bytes = Uint8Array.from([0x13, 0x7a, 0x07, 0x41, ...encodeKey('Retour')]);
    const back = modulate(bytes, { sampleRate: fs, channel: 'backward', leadIdleMs: 120, tailIdleMs: 300 });
    expect(back.ok).toBe(true);
    if (back.ok) expect(inputsOf(back.value)).toEqual(['A', '[Retour]']);
    expect(Array.from(backwardBytesForChar('z'))).toEqual([0x7a]);
    expect(backwardBytesForChar('é')).toHaveLength(0);
    expect(backwardBytesForChar('ab')).toHaveLength(0);
  });

  it('line engine: modulateBackward on the terminal, startBackwardKeys / pushBackwardKeyChunk on the server give key and keyChar events', () => {
    const terminal = createLineEngine();
    const audio = terminal.modulateBackward(burst, fs);
    expect(audio.t).toBe('ok');
    if (audio.t !== 'ok') return;
    const server = createLineEngine();
    expect(server.startBackwardKeys(fs)).toBeNull();
    const seen: string[] = [];
    for (let p = 0; p < audio.audio.length; p += 960) {
      const msg = server.pushBackwardKeyChunk(audio.audio.subarray(p, Math.min(audio.audio.length, p + 960)));
      for (const ev of msg?.events ?? []) {
        if (ev.e === 'key') seen.push(`[${ev.key}]`);
        if (ev.e === 'keyChar') seen.push(ev.char);
      }
    }
    expect(seen).toEqual(['M', 'A', 'T', 'H', 'S', '[Envoi]', '[Suite]']);
    server.stopBackwardKeys();
    expect(server.pushBackwardKeyChunk(audio.audio)).toBeNull();
  });

  it('TOGGLE_BACK_KEYS flips the toggle (default off) and BACK_KEYS_FAILED turns it off with a notice', () => {
    const s0 = createInitialUiState(createBlankScreen());
    expect(s0.backKeys).toBe(false);
    const s1 = uiReducer(s0, { type: 'TOGGLE_BACK_KEYS' });
    expect(s1.backKeys).toBe(true);
    const s2 = uiReducer(s1, { type: 'BACK_KEYS_FAILED', message: 'micro refusé' });
    expect(s2.backKeys).toBe(false);
    expect(s2.notice).toBe('micro refusé');
  });
});
