import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_FUNCTION_KEYS,
  buildPageScreen,
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
import {
  App,
  applyTimedEventsToScreen,
  createInitialUiState,
  uiReducer,
} from '../../src/ui/App';
import {
  classifyCaptureError,
  evaluateRawAudioSettings,
  RAW_AUDIO_CONSTRAINTS,
} from '../../src/audio/capture';
import { MicPermission } from '../../src/ui/screens/MicPermission';
import { LINE_MODE_OPTIONS } from '../../src/ui/screens/ModeBar';
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
});
