import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildTransmissionPage,
  FANTOME_DECOY_L5_PAGE,
} from '../../content/fantome/transmission-pages';
import {
  decodeWavWithAppPipeline,
  FANTOME_WAV_SAMPLE_RATE,
  generateAllTransmissions,
  generateProceduralDrone,
  hashLevelCode,
  verifyCommittedTransmissions,
  verifyLevelWav,
} from '../../scripts/generate-transmissions';
import {
  checkFantomeCode,
  checkFantomeCodeSync,
  createFantomeProgressStore,
  normalizeFantomeCode,
  sha256HexSync,
  type FantomeManifest,
  type LevelSource,
  type StorageLike,
} from '../../src/fantome';
import {
  ALL_FUNCTION_KEYS,
  cellErrorRate,
  decodeBytes,
  encodePage,
} from '../../src/videotex';
import {
  createFantomeService,
  lintPages,
  type ServiceInput,
} from '../../src/services';
import { createInitialUiState, uiReducer } from '../../src/ui/app-state';
import {
  decodePageSourceToScreen,
  STANDBY_PAGE_SOURCE,
} from '../../src/ui/screens/previewPages';
import { FFT_SIZE, SpectrumAnalyzer512 } from '../../src/workers/fft512';
import { createLineEngine } from '../../src/workers/line-engine';
import { DEFAULT_SIM_PARAMS } from '../../src/workers/protocol';
import { isSlowTestsEnabled } from '../helpers/arbitraries';

const ROOT = resolve(process.cwd());
const LEVELS_PATH = join(ROOT, 'content', 'fantome', 'levels.json');
const TRANSMISSIONS_DIR = join(ROOT, 'public', 'transmissions');

function loadLevels(): readonly LevelSource[] {
  return JSON.parse(readFileSync(LEVELS_PATH, 'utf8')) as readonly LevelSource[];
}

function loadManifest(): FantomeManifest {
  return JSON.parse(
    readFileSync(join(TRANSMISSIONS_DIR, 'manifest.json'), 'utf8'),
  ) as FantomeManifest;
}

describe('fantome Tasks 1, 2 & 3: Transmission pages, procedural drone, manifest hashes, and verifier', () => {
  it('validates all offline transmission pages and decoy page against size, alphabet, and < 80% similarity', () => {
    const levels = loadLevels();
    const txPages = levels.map((lvl) =>
      buildTransmissionPage(lvl.transmissionPage, lvl.code, lvl.codeRow),
    );
    // L5 is in levels.json since fantome task 7; before that it was linted with a placeholder code.
    const extra = levels.some((lvl) => lvl.transmissionPage === 'fantome/tx-l5')
      ? []
      : [buildTransmissionPage('fantome/tx-l5', 'Phantasme', 13)];
    const report = lintPages([...txPages, ...extra, FANTOME_DECOY_L5_PAGE]);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('generates a procedural drone strictly under 250 Hz and >= 20 dB below the modem carrier (Req 5.1 & 5.2)', () => {
    const sampleRate = FANTOME_WAV_SAMPLE_RATE;
    const drone = generateProceduralDrone(sampleRate * 2, sampleRate, 2026);

    let sumSq = 0;
    for (let i = 0; i < drone.length; i++) {
      sumSq += drone[i] * drone[i];
    }
    const droneRms = Math.sqrt(sumSq / drone.length);
    const modemRms = 0.5 / Math.SQRT2;
    const dbBelowModem = 20 * Math.log10(modemRms / droneRms);
    expect(dbBelowModem).toBeGreaterThanOrEqual(20);

    // Check spectrum: peak must lie below 250 Hz, and bins >= 300 Hz must be > 35 dB below peak
    const fft = new SpectrumAnalyzer512();
    fft.pushSamples(drone);
    const specDb = fft.computeSpectrumDb();
    const binHz = sampleRate / FFT_SIZE;

    let maxBelow250 = -120;
    let maxAbove300 = -120;
    for (let b = 1; b < specDb.length; b++) {
      const hz = b * binHz;
      if (hz < 250 && specDb[b] > maxBelow250) {
        maxBelow250 = specDb[b];
      }
      if (hz >= 300 && specDb[b] > maxAbove300) {
        maxAbove300 = specDb[b];
      }
    }
    expect(maxBelow250).toBeGreaterThan(-60);
    expect(maxBelow250 - maxAbove300).toBeGreaterThan(30);
  });

  it('normalizes accents/case/spaces in hashLevelCode and verifies committed transmissions via --verify-only logic', () => {
    const salt = 'testsalt';
    expect(normalizeFantomeCode('  SÉPULTURE  ')).toBe('sepulture');
    expect(hashLevelCode(salt, 'Sépulture')).toBe(
      hashLevelCode(salt, '  SEPULTURE '),
    );
    expect(() => verifyCommittedTransmissions({ quiet: true })).not.toThrow();
  });
});

describe('fantome Property Tests (J9: H1, H2, H3)', () => {
  it('H1 determinism: running the generator twice gives byte-identical WAVs and manifest', () => {
    const allLevels = loadLevels();
    const subset = isSlowTestsEnabled()
      ? allLevels
      : allLevels.filter((l) => l.id === 'L1' || l.id === 'L3');

    const tmpRoot = mkdtempSync(join(tmpdir(), 'neominitel-h1-'));
    try {
      const subsetPath = join(tmpRoot, 'levels-subset.json');
      writeFileSync(subsetPath, JSON.stringify(subset, null, 2), 'utf8');

      const outA = join(tmpRoot, 'out-a');
      const outB = join(tmpRoot, 'out-b');

      const manifestA = generateAllTransmissions({
        levelsPath: subsetPath,
        outDir: outA,
        salt: 'fixed-h1-salt',
        quiet: true,
      });
      const manifestB = generateAllTransmissions({
        levelsPath: subsetPath,
        outDir: outB,
        salt: 'fixed-h1-salt',
        quiet: true,
      });

      expect(manifestA).toEqual(manifestB);

      const rawManifestA = readFileSync(join(outA, 'manifest.json'));
      const rawManifestB = readFileSync(join(outB, 'manifest.json'));
      expect(Buffer.compare(rawManifestA, rawManifestB)).toBe(0);

      for (const lvl of subset) {
        const wavA = readFileSync(join(outA, `${lvl.id}.wav`));
        const wavB = readFileSync(join(outB, `${lvl.id}.wav`));
        expect(Buffer.compare(wavA, wavB)).toBe(0);
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('H2 solvable: for every level, decoding with the feature on gives the exact code row', () => {
    const levels = loadLevels();
    const manifest = loadManifest();
    expect(manifest.levels.length).toBe(levels.length);

    for (const lvl of levels) {
      const wavBytes = new Uint8Array(
        readFileSync(join(TRANSMISSIONS_DIR, `${lvl.id}.wav`)),
      );
      const outcome = verifyLevelWav(lvl, wavBytes);
      expect(outcome.ok).toBe(true);
      expect(outcome.cerFeatureOn).toBe(0);

      if (lvl.id === 'L2') {
        expect(outcome.pageErrorCellsOn).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('H3 necessary: for L3-L5, decoding with the feature off gives a code row CER >= 50%', () => {
    const levels = loadLevels().filter(
      (lvl) =>
        lvl.feature === 'adaptive' ||
        lvl.feature === 'vote' ||
        lvl.feature === 'backward',
    );
    expect(levels.length).toBeGreaterThanOrEqual(2);

    for (const lvl of levels) {
      const txPage = buildTransmissionPage(
        lvl.transmissionPage,
        lvl.code,
        lvl.codeRow,
      );
      const enc = encodePage(txPage);
      expect(enc.ok).toBe(true);
      if (!enc.ok) continue;
      const refScreen = decodeBytes(enc.value.bytes);

      const wavBytes = new Uint8Array(
        readFileSync(join(TRANSMISSIONS_DIR, `${lvl.id}.wav`)),
      );
      const offDecoded = decodeWavWithAppPipeline(wavBytes, {
        channel: 'forward',
        threshold: lvl.feature === 'adaptive' ? 'fixed' : 'adaptive',
        voteOn: lvl.feature === 'vote' ? false : true,
      });

      const cerOff = cellErrorRate(
        offDecoded.finalScreen,
        refScreen,
        [lvl.codeRow],
      );
      expect(cerOff).toBeGreaterThanOrEqual(0.5);
    }
  });
});

function walkFilesRecursively(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkFilesRecursively(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe('fantome Task 4 & 6: Runtime service, real-time playWav streaming, and Properties H4, H5, H6', () => {
  const runs = (fast: number, slow: number): number =>
    isSlowTestsEnabled() ? slow : fast;

  it('plays L1..L4 end-to-end through createFantomeService, streams L3.wav/L4.wav via startRealtimeWav (simulator off), and exposes WAV download links', () => {
    const levels = loadLevels();
    const manifest = loadManifest();

    const memoryMap = new Map<string, string>();
    const mockStorage: StorageLike = {
      getItem: (k) => memoryMap.get(k) ?? null,
      setItem: (k, v) => {
        memoryMap.set(k, v);
      },
    };
    const progressStore = createFantomeProgressStore(mockStorage);
    const svc = createFantomeService({ manifest, progressStore });

    let [state, out] = svc.init();
    expect(state.unlocked).toBe(0);
    expect(out.pageId).toBe('fantome/accueil');

    // Trying to open L2 while unlocked=0 is refused (locked page)
    const [lockedState, lockedOut] = svc.handle(state, {
      kind: 'key',
      key: 'Envoi',
      text: '2',
    });
    expect(lockedState.view.kind).toBe('locked');
    expect(lockedOut?.pageId).toBe('fantome/locked-2');

    // Walk through all 4 MVP levels in order
    for (let idx = 0; idx < levels.length; idx++) {
      const lvl = levels[idx];
      const manifestLvl = manifest.levels[idx];
      // Open frontier story page via Suite
      const [storyState, storyOut] = svc.handle(state, {
        kind: 'key',
        key: 'Suite',
        text: '',
      });
      expect(storyState.view).toEqual({ kind: 'story', levelIndex: idx });
      expect(storyOut?.downloadWav?.url).toBe(`/${manifestLvl.wav}`);

      // Press Guide on story -> shows level-specific hint
      const [guideState, guideOut] = svc.handle(storyState, {
        kind: 'key',
        key: 'Guide',
        text: '',
      });
      expect(guideState.view.kind).toBe('guide');
      expect(guideOut?.pageId).toBe(`fantome/hint-${lvl.id.toLowerCase()}`);

      const [backToStory] = svc.handle(guideState, {
        kind: 'key',
        key: 'Retour',
        text: '',
      });
      expect(backToStory.view).toEqual({ kind: 'story', levelIndex: idx });

      // Press Envoi on story -> starts WAV reception (`playWav`)
      const [rxState, rxOut] = svc.handle(backToStory, {
        kind: 'key',
        key: 'Envoi',
        text: '',
      });
      expect(rxState.view).toEqual({ kind: 'receiving', levelIndex: idx });
      expect(rxOut?.playWav).toBe(`/${manifestLvl.wav}`);
      expect(rxOut?.downloadWav?.filename).toBe(
        `neominitel-${lvl.id.toLowerCase()}.wav`,
      );

      // Press Suite -> answer page with input field
      const [ansState, ansOut] = svc.handle(rxState, {
        kind: 'key',
        key: 'Suite',
        text: '',
      });
      expect(ansState.view).toEqual({ kind: 'answer', levelIndex: idx });
      expect(ansOut?.input).toBeDefined();

      // Wrong code -> "les esprits restent muets" retry page
      const [wrongState, wrongOut] = svc.handle(ansState, {
        kind: 'key',
        key: 'Envoi',
        text: 'MAUVAIS-CODE',
      });
      expect(wrongState.view).toEqual({ kind: 'wrong', levelIndex: idx });
      expect(wrongOut?.pageId).toBe(`fantome/wrong-${lvl.id.toLowerCase()}`);

      // Correct code with mixed case, accents & spaces -> unlocks next level!
      const [okState, okOut] = svc.handle(wrongState, {
        kind: 'key',
        key: 'Envoi',
        text: `  ${lvl.code.toUpperCase()}  `,
      });
      expect(okState.unlocked).toBe(idx + 1);
      expect(progressStore.readUnlocked()).toBe(idx + 1);
      expect(okState.view).toEqual({ kind: 'success', levelIndex: idx });
      expect(okOut?.pageId).toBe(`fantome/success-${lvl.id.toLowerCase()}`);

      // Advance from success page
      const [afterSuccess, nextOut] = svc.handle(okState, {
        kind: 'key',
        key: 'Suite',
        text: '',
      });
      state = afterSuccess;
      out = nextOut ?? out;
      if (idx + 1 < levels.length) {
        // Return to menu before next iteration's Suite check, or verify we're already on next story
        expect(state.view).toEqual({ kind: 'story', levelIndex: idx + 1 });
        const [menuAgain] = svc.handle(state, {
          kind: 'key',
          key: 'Sommaire',
          text: '',
        });
        state = menuAgain;
      } else {
        // After L4 (last available level), shows final epilogue inviting to 3615 MATHS (Req 6.1)
        expect(state.view).toEqual({ kind: 'final' });
        expect(out.pageId).toBe('fantome/final');
      }
    }

    // Verify LineEngine.startRealtimeWav ignores noisy simulator settings (Req 2.3) and solves L3.wav
    const l3 = levels.find((l) => l.id === 'L3');
    expect(l3).toBeDefined();
    if (!l3) return;

    const l3Page = buildTransmissionPage(l3.transmissionPage, l3.code, l3.codeRow);
    const l3Enc = encodePage(l3Page);
    expect(l3Enc.ok).toBe(true);
    if (!l3Enc.ok) return;
    const l3Ref = decodeBytes(l3Enc.value.bytes);

    const engine = createLineEngine();
    expect(engine.init(48000)).toBeNull();
    // Configure extreme destructive noise on simulator — startRealtimeWav MUST ignore it!
    engine.setSim({
      ...DEFAULT_SIM_PARAMS,
      ebN0Db: 0,
      offsetHz: -500,
      hum: true,
      bursts: true,
    });
    engine.setThreshold('adaptive');

    const l3Wav = new Uint8Array(
      readFileSync(join(TRANSMISSIONS_DIR, 'L3.wav')),
    );
    expect(engine.startRealtimeWav({ id: 99, data: l3Wav })).toBeNull();

    const standby = decodePageSourceToScreen(STANDBY_PAGE_SOURCE);
    let ui = createInitialUiState(standby);
    while (engine.hasActiveTransmit()) {
      const blk = engine.nextTransmitBlock();
      if (!blk) break;
      expect(blk.sampleRate).toBe(FANTOME_WAV_SAMPLE_RATE);
      ui = uiReducer(ui, { type: 'APPLY_TIMED_EVENTS', events: blk.events });
    }
    expect(cellErrorRate(ui.baseScreen, l3Ref, [l3.codeRow])).toBe(0);
  });

  it('H4 no leak: no file in dist/ or public/ contains any code (normalized or not) as a substring', () => {
    const levels = loadLevels();
    const rawCodes = [...levels.map((l) => l.code), 'Phantasme'];

    const needles = new Set<string>();
    for (const code of rawCodes) {
      const norm = normalizeFantomeCode(code);
      expect(norm.length).toBeGreaterThanOrEqual(6);
      needles.add(norm);
      needles.add(code.trim().toLowerCase());
    }

    const publicDir = join(ROOT, 'public');
    const distDir = join(ROOT, 'dist');
    const filesToScan = [
      ...walkFilesRecursively(publicDir),
      ...walkFilesRecursively(distDir),
    ];
    expect(filesToScan.length).toBeGreaterThanOrEqual(5);

    const leaks: string[] = [];
    for (const filePath of filesToScan) {
      const buf = readFileSync(filePath);
      const utf8Lower = buf.toString('utf8').toLowerCase();
      const latin1Lower = buf.toString('latin1').toLowerCase();

      for (const needle of needles) {
        if (utf8Lower.includes(needle) || latin1Lower.includes(needle)) {
          leaks.push(`${filePath} leaked "${needle}"`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });

  it('H5 check: for any string s, check(s) is true if and only if normalize(s) equals the normalized code', async () => {
    const arbBaseCode = fc.constantFrom(
      'Sépulture',
      'Catacombe',
      'Ectoplasme',
      'Crépuscule',
      'Phantasme',
      'Vélizy 1982',
    );

    const mutateEquivalent = (code: string, variant: number): string => {
      const stripped = normalizeFantomeCode(code);
      switch (variant % 4) {
        case 0:
          return `   ${code.toUpperCase()}   `;
        case 1:
          return stripped.toUpperCase();
        case 2:
          return `\t ${stripped.replace(/ /g, '   ')} \n`;
        default:
          return code.toLowerCase();
      }
    };

    await fc.assert(
      fc.asyncProperty(
        arbBaseCode,
        fc.hexaString({ minLength: 8, maxLength: 32 }),
        fc.oneof(
          fc.tuple(arbBaseCode, fc.integer({ min: 0, max: 10 })).map(([c, v]) =>
            mutateEquivalent(c, v),
          ),
          fc.string({ maxLength: 24 }),
        ),
        async (secretCode, salt, candidateInput) => {
          const expectedHash = sha256HexSync(
            `${salt}${normalizeFantomeCode(secretCode)}`,
          );
          const shouldMatch =
            normalizeFantomeCode(candidateInput) ===
            normalizeFantomeCode(secretCode);

          expect(
            checkFantomeCodeSync(candidateInput, salt, expectedHash),
          ).toBe(shouldMatch);
          expect(
            await checkFantomeCode(candidateInput, salt, expectedHash),
          ).toBe(shouldMatch);
        },
      ),
      { numRuns: runs(100, 400) },
    );
  });

  it('H6 progress: the service never shows a level above unlocked + 1, and works when storage throws', () => {
    const manifest = loadManifest();
    const arbInput: fc.Arbitrary<ServiceInput> = fc.record({
      kind: fc.constant('key' as const),
      key: fc.constantFrom(...ALL_FUNCTION_KEYS),
      text: fc.oneof(
        fc.constantFrom('', '1', '2', '3', '4', '5', '9', 'L2', 'L4', 'INCONNU'),
        fc.string({ maxLength: 12 }),
      ),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: manifest.levels.length }),
        fc.boolean(),
        fc.array(arbInput, { minLength: 1, maxLength: 35 }),
        (initialUnlocked, storageThrows, inputs) => {
          const backing = new Map<string, string>([
            [
              'neominitel.fantome.progress.v1',
              JSON.stringify({ unlocked: initialUnlocked }),
            ],
          ]);

          const storage: StorageLike = storageThrows
            ? {
                getItem(): string | null {
                  throw new Error('SecurityError: storage disabled');
                },
                setItem(): void {
                  throw new Error('QuotaExceededError: storage full');
                },
              }
            : {
                getItem: (k) => backing.get(k) ?? null,
                setItem: (k, v) => {
                  backing.set(k, v);
                },
              };

          const progressStore = createFantomeProgressStore(storage);
          if (storageThrows) {
            progressStore.recordUnlocked(initialUnlocked);
          }

          const svc = createFantomeService({ manifest, progressStore });
          let [state] = svc.init();
          expect(state.unlocked).toBe(
            Math.min(manifest.levels.length, initialUnlocked),
          );

          for (const inp of inputs) {
            if (inp.key === 'ConnexionFin' || inp.key === 'Repetition') {
              continue;
            }
            const [nextState] = svc.handle(state, inp);
            state = nextState;

            const maxAllowedIndex = state.unlocked; // 0-indexed => level number <= state.unlocked + 1
            const v = state.view;
            if (
              v.kind === 'story' ||
              v.kind === 'receiving' ||
              v.kind === 'answer' ||
              v.kind === 'wrong' ||
              v.kind === 'success'
            ) {
              expect(v.levelIndex).toBeLessThanOrEqual(maxAllowedIndex);
            } else if (v.kind === 'guide' && v.levelIndex !== null) {
              expect(v.levelIndex).toBeLessThanOrEqual(maxAllowedIndex);
            }
          }
        },
      ),
      { numRuns: runs(100, 400) },
    );
  });
});
