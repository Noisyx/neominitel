import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  createBlankScreen,
  encodePage,
  renderScreenToRgba,
  SCREEN_COLS,
  SCREEN_ROWS,
  screensEqual,
} from '../../src/videotex';
import {
  decodePageSourceToScreen,
  SOMMAIRE_PREVIEW_PAGE_SOURCE,
  STANDBY_PAGE_SOURCE,
} from '../../src/ui/screens/previewPages';
import { summarizeScreenForAria } from '../../src/ui/terminal/ScreenCanvas';
import { createEventScheduler } from '../../src/ui/scheduler';
import { App, applyTimedEventsToScreen } from '../../src/ui/App';
import { createLineEngine } from '../../src/workers/line-engine';
import { DEFAULT_SIM_PARAMS, type TimedEvent } from '../../src/workers/protocol';
import { SPECTRUM_BINS } from '../../src/workers/fft512';
import { isSlowTestsEnabled } from '../helpers/arbitraries';

describe('neominitel-app Task 1: App shell, MinitelShell, ScreenCanvas and StartScreen', () => {
  it('renders the start screen with the 30 juin 2012 line, Connexion button, mute toggle and trademark-free MinitelShell', () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('30 juin 2012 : la France débranche le Minitel.');
    expect(html).toContain('Connexion');
    expect(html).toContain('Son : Activé');
    expect(html).toContain('<svg');
    expect(html).toContain('<canvas');
    expect(html.toLowerCase()).not.toContain('france télécom');
    expect(html.toLowerCase()).not.toContain('france telecom');
    expect(html.toLowerCase()).not.toContain('orange');
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

describe('neominitel-app Task 2 & 3: Line engine block streaming and live SOMMAIRE reveal', () => {
  it('streams 100 ms audio blocks with connection sequence, 512-pt FFT diag, diffs, pageStart/pageEnd, and reconstructs SOMMAIRE', () => {
    const sampleRate = 48000;
    const engine = createLineEngine();
    expect(engine.init(sampleRate)).toBeNull();
    engine.setSim({ ...DEFAULT_SIM_PARAMS });
    engine.setThreshold('fixed');

    const encoded = encodePage(SOMMAIRE_PREVIEW_PAGE_SOURCE);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const startErr = engine.startTransmit({
      id: 1,
      bytes: encoded.value.bytes,
      pageId: SOMMAIRE_PREVIEW_PAGE_SOURCE.id,
      simulate: true,
      withConnectionSequence: true,
    });
    expect(startErr).toBeNull();

    let expectedStartSample = 0;
    let blockCount = 0;
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
      blockCount++;

      // Gapless startSample continuity and <= 100 ms block size
      expect(block.startSample).toBe(expectedStartSample);
      expect(block.audio.length).toBeGreaterThan(0);
      expect(block.audio.length).toBeLessThanOrEqual(Math.round(0.1 * sampleRate));
      expectedStartSample += block.audio.length;

      for (const ev of block.events) {
        allTimedEvents.push(ev);
        if (ev.e === 'connect') sawConnect = true;
        if (ev.e === 'pageStart') sawPageStart = true;
        if (ev.e === 'pageEnd') {
          sawPageEnd = true;
          expect(
            screensEqual(ev.screen, decodePageSourceToScreen(SOMMAIRE_PREVIEW_PAGE_SOURCE)),
          ).toBe(true);
        }
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

    expect(blockCount).toBeGreaterThan(15); // ~1.15 s connection + ~3 s page in 100 ms blocks
    expect(sawConnect).toBe(true);
    expect(sawPageStart).toBe(true);
    expect(sawPageEnd).toBe(true);
    expect(sawSpectrum).toBe(true);

    // Progressive diff application produces the exact same screen as one-shot decoding
    expect(
      screensEqual(
        progressiveScreen,
        decodePageSourceToScreen(SOMMAIRE_PREVIEW_PAGE_SOURCE),
      ),
    ).toBe(true);

    // Verify ~120 cps pacing: character diffs span multiple seconds of audio samples
    const diffSamples = allTimedEvents
      .filter((e) => e.e === 'diff')
      .map((e) => e.atSample);
    expect(diffSamples.length).toBeGreaterThan(20);
    const spanSec =
      (diffSamples[diffSamples.length - 1] - diffSamples[0]) / sampleRate;
    expect(spanSec).toBeGreaterThan(1.0);
  });
});

describe('neominitel-app Property Tests', () => {
  const runs = (fast: number, slow: number): number => (isSlowTestsEnabled() ? slow : fast);

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

        // Enqueue all batches upfront (representing blocks queued ahead of playback)
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
            // Never before playback time
            expect(ev.atSample).toBeLessThanOrEqual(currentSample);
            emittedAll.push(ev);
          }
        }

        // Drain any remaining events at max sample
        const finalSample = 200_000;
        const rest = scheduler.drainUpTo(finalSample);
        for (const ev of rest) {
          expect(ev.atSample).toBeLessThanOrEqual(finalSample);
          emittedAll.push(ev);
        }

        expect(scheduler.pendingCount()).toBe(0);
        expect(emittedAll.length).toBe(allItems.length);

        // Strict non-decreasing atSample order, with stable insertion-order tie-breaking
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
});
