import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTransmissionPage,
  FANTOME_DECOY_L5_PAGE,
} from '../content/fantome/transmission-pages';
import { normalizeFantomeCode } from '../src/fantome/normalize';
import type {
  FantomeFeature,
  FantomeManifest,
  LevelSource,
  ManifestLevel,
} from '../src/fantome/types';
import {
  createChannel,
  createDemodulator,
  modulate,
  readWav,
  writeWav,
  type ChannelId,
} from '../src/modem';
import {
  C0,
  cellErrorRate,
  createBlankScreen,
  createVideotexDecoder,
  decodeBytes,
  encodePage,
  type Screen,
} from '../src/videotex';
import {
  countScreenErrors,
  createEmptyVoteStore,
  getActiveVoteSummary,
  recordCompletedPageVote,
  selectDisplayedScreenForVote,
} from '../src/ui/vote-manager';

export const FANTOME_WAV_SAMPLE_RATE = 16_000;
export const MAX_SEED_ATTEMPTS = 50;
export const DEFAULT_MANIFEST_SALT = '3615fantome20120630velizyptt0001';

const DRONE_DB_BELOW_MODEM = 22; // >= 20 dB below modem signal (Req 5.1)
const NORMALIZE_PEAK_DBFS = -1; // -1 dBFS peak normalization (design.md step 5)
const PAGE_GAP_IDLE_SEC = 0.3;
const DEMOD_CHUNK_SAMPLES = 4096;

export interface VerificationOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly cerFeatureOn: number;
  readonly cerFeatureOff?: number;
  readonly pageErrorCellsOn: number;
  readonly receptionsGroupedOn: number;
  readonly minCodeRowAgreeOn?: number;
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes `hex(SHA-256(salt + normalizeFantomeCode(code)))` (`fantome/design.md`).
 */
export function hashLevelCode(salt: string, code: string): string {
  const normalized = normalizeFantomeCode(code);
  return createHash('sha256')
    .update(`${salt}${normalized}`, 'utf8')
    .digest('hex');
}

/**
 * Generates a deterministic procedural low-frequency drone (sum of 3 sines in `[55, 220] Hz`
 * with slow random amplitude modulation, `22 dB` below a `0.5`-peak V.23 carrier; Req 5.1).
 */
export function generateProceduralDrone(
  length: number,
  sampleRate: number,
  seed: number,
): Float32Array {
  const rng = createSeededRng((seed ^ 0xfa70_3615) >>> 0);
  const f1 = 58 + rng() * 22; // 58..80 Hz
  const f2 = 104 + rng() * 34; // 104..138 Hz
  const f3 = 162 + rng() * 48; // 162..210 Hz (< 220 Hz, well below 300 Hz backward band)
  const freqs = [f1, f2, f3];
  const lfoRates = [0.14 + rng() * 0.16, 0.19 + rng() * 0.18, 0.11 + rng() * 0.15];
  const carrierPhases = [rng() * 2 * Math.PI, rng() * 2 * Math.PI, rng() * 2 * Math.PI];
  const lfoPhases = [rng() * 2 * Math.PI, rng() * 2 * Math.PI, rng() * 2 * Math.PI];

  const raw = new Float32Array(length);
  let sumSq = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (let k = 0; k < 3; k++) {
      const env = 0.72 + 0.28 * Math.sin(2 * Math.PI * lfoRates[k] * t + lfoPhases[k]);
      sample += env * Math.sin(2 * Math.PI * freqs[k] * t + carrierPhases[k]);
    }
    raw[i] = sample;
    sumSq += sample * sample;
  }

  const rawRms = length > 0 ? Math.sqrt(sumSq / length) : 1;
  // Modem peak amplitude A = 0.5 => RMS = 0.5 / sqrt(2)
  const modemRms = 0.5 / Math.SQRT2;
  const targetDroneRms = modemRms * Math.pow(10, -DRONE_DB_BELOW_MODEM / 20);
  const scale = rawRms > 0 ? targetDroneRms / rawRms : 0;

  for (let i = 0; i < length; i++) {
    raw[i] *= scale;
  }
  return raw;
}

/**
 * Normalizes a buffer so its absolute peak equals `-1 dBFS`.
 */
export function normalizeToMinusOneDbfs(samples: Float32Array): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (Number.isFinite(a) && a > maxAbs) {
      maxAbs = a;
    }
  }
  const out = new Float32Array(samples.length);
  const targetPeak = Math.pow(10, NORMALIZE_PEAK_DBFS / 20);
  const scale = maxAbs > 0 ? targetPeak / maxAbs : 1;
  for (let i = 0; i < samples.length; i++) {
    out[i] = Number.isFinite(samples[i]) ? samples[i] * scale : 0;
  }
  return out;
}

function applyWhisperBurstWaveChannel(
  clean: Float32Array,
  singlePassSamples: number,
  gapMs: number,
  sampleRate: number,
  seed: number,
  cleanEbN0Db: number,
  burstWave: {
    readonly cyclesPerPass: number;
    readonly duty: number;
    readonly burstEbN0Db: number;
  },
): Float32Array {
  const chRes = createChannel({
    sampleRate,
    seed: seed >>> 0,
    channel: 'forward',
    signalAmplitude: 0.5,
    noise: { kind: 'ebN0', db: cleanEbN0Db },
  });
  if (!chRes.ok) {
    throw new Error(`createChannel failed: ${JSON.stringify(chRes.error)}`);
  }
  const ch = chRes.value;

  // Constant-frequency interference wave across the page body, out of phase with the
  // repetition period by +3/7 cycle so every cell lands in the clean Eb/N0 window on >= 3 passes
  // while every single pass suffers >= 50% code-row CER. Keep the 120 ms lead-in (carrier + FF)
  // and the inter-pass idle gap at cleanEbN0Db so adaptive init and pageEnd framing stay exact.
  const leadCleanSamples = Math.round(0.12 * sampleRate);
  const tailCleanSamples = Math.round((gapMs / 1000) * sampleRate);
  const bodySamples = Math.max(
    1,
    singlePassSamples - leadCleanSamples - tailCleanSamples,
  );
  const wavePeriodSamples = bodySamples / (burstWave.cyclesPerPass + 3 / 7);
  const phaseRng = createSeededRng((seed ^ 0x4c34_7768) >>> 0);
  const initialPhase = phaseRng();

  const chunks: Float32Array[] = [];
  const stepSamples = Math.max(64, Math.round(0.008 * sampleRate)); // 8 ms (~1 char) resolution
  let currentlyInBurst = false;

  for (let pos = 0; pos < clean.length; pos += stepSamples) {
    const end = Math.min(clean.length, pos + stepSamples);
    const mid = 0.5 * (pos + end);
    const passIdx = Math.floor(mid / singlePassSamples);
    const offsetInPass = mid - passIdx * singlePassSamples;
    const inPageBody =
      offsetInPass >= leadCleanSamples &&
      offsetInPass < singlePassSamples - tailCleanSamples;

    let wantBurst = false;
    if (inPageBody) {
      const bodyElapsed =
        passIdx * bodySamples + (offsetInPass - leadCleanSamples);
      const rawPhase = initialPhase + bodyElapsed / wavePeriodSamples;
      const fracPhase = rawPhase - Math.floor(rawPhase);
      wantBurst = fracPhase < burstWave.duty;
    }

    if (wantBurst !== currentlyInBurst) {
      ch.setParams({
        noise: {
          kind: 'ebN0',
          db: wantBurst ? burstWave.burstEbN0Db : cleanEbN0Db,
        },
      });
      currentlyInBurst = wantBurst;
    }
    chunks.push(ch.process(clean.subarray(pos, end)));
  }
  chunks.push(ch.flush());

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Float32Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function applyStreamedChannel(
  clean: Float32Array,
  sampleRate: number,
  seed: number,
  options: { ebN0Db?: number; offsetHz?: number },
): Float32Array {
  const chRes = createChannel({
    sampleRate,
    seed: seed >>> 0,
    channel: 'forward',
    signalAmplitude: 0.5,
    noise:
      options.ebN0Db !== undefined
        ? { kind: 'ebN0', db: options.ebN0Db }
        : undefined,
    offsetHz: options.offsetHz ?? 0,
  });
  if (!chRes.ok) {
    throw new Error(`createChannel failed: ${JSON.stringify(chRes.error)}`);
  }
  const ch = chRes.value;
  const chunks: Float32Array[] = [];
  for (let pos = 0; pos < clean.length; pos += DEMOD_CHUNK_SAMPLES) {
    chunks.push(
      ch.process(clean.subarray(pos, Math.min(clean.length, pos + DEMOD_CHUNK_SAMPLES))),
    );
  }
  chunks.push(ch.flush());

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Float32Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Synthesizes a single candidate 16-bit PCM WAV for `level` and `seedCandidate`
 * (`fantome/design.md` "Generation pipeline" steps 1–5).
 */
export function synthesizeLevelWav(
  level: LevelSource,
  seedCandidate: number,
  sampleRate = FANTOME_WAV_SAMPLE_RATE,
): { wavBytes: Uint8Array; referenceScreen: Screen } {
  const txPage = buildTransmissionPage(
    level.transmissionPage,
    level.code,
    level.codeRow,
  );
  const encoded = encodePage(txPage);
  if (!encoded.ok) {
    throw new Error(
      `Failed to encode ${level.transmissionPage}: ${JSON.stringify(encoded.error)}`,
    );
  }
  const referenceScreen = decodeBytes(encoded.value.bytes);

  let damagedSignal: Float32Array;

  switch (level.damage.kind) {
    case 'clean': {
      const mod = modulate(encoded.value.bytes, {
        sampleRate,
        channel: 'forward',
        tailIdleMs: 350,
      });
      if (!mod.ok) {
        throw new Error(`modulate failed for ${level.id}: ${JSON.stringify(mod.error)}`);
      }
      damagedSignal = mod.value;
      break;
    }

    case 'noise': {
      const mod = modulate(encoded.value.bytes, {
        sampleRate,
        channel: 'forward',
        tailIdleMs: 350,
      });
      if (!mod.ok) {
        throw new Error(`modulate failed for ${level.id}: ${JSON.stringify(mod.error)}`);
      }
      damagedSignal = applyStreamedChannel(mod.value, sampleRate, seedCandidate, {
        ebN0Db: level.damage.ebN0Db,
      });
      break;
    }

    case 'offset': {
      const mod = modulate(encoded.value.bytes, {
        sampleRate,
        channel: 'forward',
        tailIdleMs: 350,
      });
      if (!mod.ok) {
        throw new Error(`modulate failed for ${level.id}: ${JSON.stringify(mod.error)}`);
      }
      damagedSignal = applyStreamedChannel(mod.value, sampleRate, seedCandidate, {
        ebN0Db: level.damage.ebN0Db,
        offsetHz: level.damage.offsetHz,
      });
      break;
    }

    case 'whisper': {
      const singleMod = modulate(encoded.value.bytes, {
        sampleRate,
        channel: 'forward',
        tailIdleMs: level.damage.gapMs,
      });
      if (!singleMod.ok) {
        throw new Error(
          `modulate failed for ${level.id}: ${JSON.stringify(singleMod.error)}`,
        );
      }
      const singleLen = singleMod.value.length;
      const repeated = new Float32Array(singleLen * level.damage.repeats);
      for (let r = 0; r < level.damage.repeats; r++) {
        repeated.set(singleMod.value, r * singleLen);
      }
      if (level.damage.burstWave !== undefined) {
        damagedSignal = applyWhisperBurstWaveChannel(
          repeated,
          singleLen,
          level.damage.gapMs,
          sampleRate,
          seedCandidate,
          level.damage.ebN0Db,
          level.damage.burstWave,
        );
      } else {
        damagedSignal = applyStreamedChannel(repeated, sampleRate, seedCandidate, {
          ebN0Db: level.damage.ebN0Db,
        });
      }
      break;
    }

    case 'backward': {
      const decoyEncoded = encodePage(FANTOME_DECOY_L5_PAGE);
      if (!decoyEncoded.ok) {
        throw new Error('Failed to encode decoy page for L5');
      }
      const fwdMod = modulate(decoyEncoded.value.bytes, {
        sampleRate,
        channel: 'forward',
        tailIdleMs: 350,
      });
      const bwdMod = modulate(encoded.value.bytes, {
        sampleRate,
        channel: 'backward',
        tailIdleMs: 350,
      });
      if (!fwdMod.ok || !bwdMod.ok) {
        throw new Error(`L5 dual modulation failed`);
      }
      const totalLen = Math.max(fwdMod.value.length, bwdMod.value.length);
      const mixed = new Float32Array(totalLen);
      for (let i = 0; i < totalLen; i++) {
        const f = i < fwdMod.value.length ? fwdMod.value[i] : 0;
        const b = i < bwdMod.value.length ? bwdMod.value[i] : 0;
        mixed[i] = 0.5 * f + 0.5 * b;
      }
      damagedSignal = applyStreamedChannel(mixed, sampleRate, seedCandidate, {
        ebN0Db: level.damage.ebN0Db,
      });
      break;
    }
  }

  const drone = generateProceduralDrone(
    damagedSignal.length,
    sampleRate,
    seedCandidate,
  );
  const combined = new Float32Array(damagedSignal.length);
  for (let i = 0; i < combined.length; i++) {
    combined[i] = damagedSignal[i] + drone[i];
  }

  const normalized = normalizeToMinusOneDbfs(combined);
  const wavRes = writeWav(normalized, sampleRate);
  if (!wavRes.ok) {
    throw new Error(`writeWav failed for ${level.id}: ${JSON.stringify(wavRes.error)}`);
  }

  return {
    wavBytes: wavRes.value,
    referenceScreen,
  };
}

/**
 * Decodes a WAV buffer in Node using the exact same streaming chunk + `pageEnd` + similarity-vote
 * pipeline as the web application (`fantome/design.md` step 6).
 */
export function decodeWavWithAppPipeline(
  wavBytes: Uint8Array,
  options: {
    channel: ChannelId;
    threshold: 'fixed' | 'adaptive';
    voteOn: boolean;
  },
): {
  finalScreen: Screen;
  receptionsInActiveVote: number;
  activeVoteAgree?: Uint8Array;
} {
  const parsed = readWav(wavBytes);
  if (!parsed.ok) {
    throw new Error(`readWav failed: ${JSON.stringify(parsed.error)}`);
  }
  const { samples, sampleRate } = parsed.value;

  const demodRes = createDemodulator({
    sampleRate,
    channel: options.channel,
    threshold: options.threshold,
  });
  if (!demodRes.ok) {
    throw new Error(
      `createDemodulator(${options.channel}) failed: ${JSON.stringify(demodRes.error)}`,
    );
  }
  const demod = demodRes.value;
  const vtxDecoder = createVideotexDecoder();
  const idleSamplesThreshold = Math.round(PAGE_GAP_IDLE_SEC * sampleRate);

  let voteStore = createEmptyVoteStore();
  let pageActive = false;
  let pageStartedByFf = false;
  let lastCharSample = 0;
  let streamCursor = 0;
  let latestScreen = createBlankScreen();
  let recentErrorCount = 0;

  function commitCompletedPage(): void {
    const stats = vtxDecoder.stats();
    const completed = vtxDecoder.screen();
    const visitedMask = vtxDecoder.visitedMask();
    const wasStartedByFf = pageStartedByFf;
    vtxDecoder.reset();
    pageActive = false;
    pageStartedByFf = false;
    recentErrorCount = 0;

    if (!wasStartedByFf && stats.printable < 16) {
      return;
    }
    latestScreen = completed;
    voteStore = recordCompletedPageVote(
      voteStore,
      completed,
      'Fichier',
      visitedMask,
    );
  }

  function handleEvents(
    events: ReturnType<typeof demod.push>,
    chunkEndSample: number,
  ): void {
    for (const ev of events) {
      if (ev.type === 'carrier') {
        if (!ev.on && pageActive) {
          commitCompletedPage();
        }
      } else if (ev.type === 'char') {
        if (pageActive && ev.atSample - lastCharSample >= idleSamplesThreshold) {
          commitCompletedPage();
        }
        let hasError = !ev.parityOk || !ev.framingOk;
        if (
          !hasError &&
          (ev.value & 0x7f) === C0.FF &&
          pageActive &&
          recentErrorCount > 0
        ) {
          hasError = true;
        }
        const isCleanFf = !hasError && (ev.value & 0x7f) === C0.FF;
        if (isCleanFf && pageActive) {
          if (vtxDecoder.stats().printable >= 20) {
            commitCompletedPage();
          } else {
            vtxDecoder.reset();
            pageActive = false;
            pageStartedByFf = false;
            recentErrorCount = 0;
          }
        }
        const { changed } = vtxDecoder.push({
          value: ev.value,
          error: hasError,
        });
        const isPageClear = isCleanFf && changed.length === 960;
        if (isPageClear) {
          pageActive = true;
          pageStartedByFf = true;
        } else if (!pageActive) {
          pageActive = true;
        }
        lastCharSample = ev.atSample;
        recentErrorCount = hasError
          ? Math.min(4, recentErrorCount + 1)
          : Math.max(0, recentErrorCount - 1);
      }
    }

    if (pageActive && chunkEndSample - lastCharSample >= idleSamplesThreshold) {
      commitCompletedPage();
    }
  }

  for (let offset = 0; offset < samples.length; offset += DEMOD_CHUNK_SAMPLES) {
    const end = Math.min(samples.length, offset + DEMOD_CHUNK_SAMPLES);
    streamCursor = end;
    const evs = demod.push(samples.subarray(offset, end));
    handleEvents(evs, streamCursor);
  }

  const flushed = demod.flush();
  handleEvents(flushed, streamCursor);
  if (pageActive) {
    commitCompletedPage();
  }

  const finalScreen = selectDisplayedScreenForVote(
    voteStore,
    options.voteOn,
    latestScreen,
  );
  const summary = getActiveVoteSummary(voteStore);

  return {
    finalScreen,
    receptionsInActiveVote: summary?.receptions ?? 0,
    activeVoteAgree:
      voteStore.activePageId && voteStore.buckets[voteStore.activePageId]
        ? voteStore.buckets[voteStore.activePageId].latestResult.agree
        : undefined,
  };
}

function featureModes(feature: FantomeFeature): {
  on: { channel: ChannelId; threshold: 'fixed' | 'adaptive'; voteOn: boolean };
  off?: { channel: ChannelId; threshold: 'fixed' | 'adaptive'; voteOn: boolean };
} {
  switch (feature) {
    case 'none':
    case 'parity':
      return {
        on: { channel: 'forward', threshold: 'adaptive', voteOn: true },
      };
    case 'adaptive':
      return {
        on: { channel: 'forward', threshold: 'adaptive', voteOn: true },
        off: { channel: 'forward', threshold: 'fixed', voteOn: true },
      };
    case 'vote':
      return {
        on: { channel: 'forward', threshold: 'adaptive', voteOn: true },
        off: { channel: 'forward', threshold: 'adaptive', voteOn: false },
      };
    case 'backward':
      return {
        on: { channel: 'backward', threshold: 'adaptive', voteOn: true },
        off: { channel: 'forward', threshold: 'adaptive', voteOn: true },
      };
  }
}

/**
 * Verifies a WAV file against Requirements 4.3–4.5 (`H2`, `H3`, and L2 parity isolation).
 */
export function verifyLevelWav(
  level: LevelSource,
  wavBytes: Uint8Array,
): VerificationOutcome {
  const txPage = buildTransmissionPage(
    level.transmissionPage,
    level.code,
    level.codeRow,
  );
  const enc = encodePage(txPage);
  if (!enc.ok) {
    return {
      ok: false,
      reason: `encodePage failed for ${level.id}`,
      cerFeatureOn: 1,
      pageErrorCellsOn: 0,
      receptionsGroupedOn: 0,
    };
  }
  const refScreen = decodeBytes(enc.value.bytes);
  const modes = featureModes(level.feature);

  const onRun = decodeWavWithAppPipeline(wavBytes, modes.on);
  const cerOn = cellErrorRate(onRun.finalScreen, refScreen, [level.codeRow]);
  const pageErrorsOn = countScreenErrors(onRun.finalScreen);
  let minCodeRowAgreeOn: number | undefined;
  if (onRun.activeVoteAgree !== undefined) {
    let minA = 255;
    for (let c = 0; c < 40; c++) {
      const a = onRun.activeVoteAgree[level.codeRow * 40 + c];
      if (a < minA) minA = a;
    }
    minCodeRowAgreeOn = minA;
  }

  if (cerOn !== 0) {
    return {
      ok: false,
      reason: `feature ON codeRow CER = ${(cerOn * 100).toFixed(1)}% (must be 0%)`,
      cerFeatureOn: cerOn,
      pageErrorCellsOn: pageErrorsOn,
      receptionsGroupedOn: onRun.receptionsInActiveVote,
    };
  }

  // Requirement 4.5: L2 must have >= 1 error cell on the page, 0 on the code row
  if (level.id === 'L2' || level.feature === 'parity') {
    if (pageErrorsOn < 3) {
      return {
        ok: false,
        reason: `L2 has only ${pageErrorsOn} error cell(s) on the page (expected visible parity errors >= 3)`,
        cerFeatureOn: cerOn,
        pageErrorCellsOn: pageErrorsOn,
        receptionsGroupedOn: onRun.receptionsInActiveVote,
      };
    }
  }

  // For L4 whisper, ensure the similarity matcher grouped multiple repetitions into the vote
  if (level.damage.kind === 'whisper' && onRun.receptionsInActiveVote < 4) {
    return {
      ok: false,
      reason: `whisper grouped only ${onRun.receptionsInActiveVote} receptions into the active vote`,
      cerFeatureOn: cerOn,
      pageErrorCellsOn: pageErrorsOn,
      receptionsGroupedOn: onRun.receptionsInActiveVote,
    };
  }

  // Requirement 4.4: L3, L4, L5 with feature OFF must have codeRow CER >= 50%
  if (modes.off) {
    const offRun = decodeWavWithAppPipeline(wavBytes, modes.off);
    const cerOff = cellErrorRate(offRun.finalScreen, refScreen, [level.codeRow]);
    if (cerOff < 0.5) {
      return {
        ok: false,
        reason: `feature OFF codeRow CER = ${(cerOff * 100).toFixed(1)}% (must be >= 50%)`,
        cerFeatureOn: cerOn,
        cerFeatureOff: cerOff,
        pageErrorCellsOn: pageErrorsOn,
        receptionsGroupedOn: onRun.receptionsInActiveVote,
      };
    }

    return {
      ok: true,
      cerFeatureOn: cerOn,
      cerFeatureOff: cerOff,
      pageErrorCellsOn: pageErrorsOn,
      receptionsGroupedOn: onRun.receptionsInActiveVote,
      minCodeRowAgreeOn,
    };
  }

  return {
    ok: true,
    cerFeatureOn: cerOn,
    pageErrorCellsOn: pageErrorsOn,
    receptionsGroupedOn: onRun.receptionsInActiveVote,
    minCodeRowAgreeOn,
  };
}

export interface GenerateOptions {
  readonly levelsPath?: string;
  readonly outDir?: string;
  readonly sampleRate?: number;
  readonly salt?: string;
  readonly quiet?: boolean;
}

export function generateAllTransmissions(
  options?: GenerateOptions,
): FantomeManifest {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const levelsPath =
    options?.levelsPath ?? join(rootDir, 'content', 'fantome', 'levels.json');
  const outDir = options?.outDir ?? join(rootDir, 'public', 'transmissions');
  const sampleRate = options?.sampleRate ?? FANTOME_WAV_SAMPLE_RATE;
  const salt = options?.salt ?? DEFAULT_MANIFEST_SALT;

  const levels = JSON.parse(
    readFileSync(levelsPath, 'utf8'),
  ) as readonly LevelSource[];
  mkdirSync(outDir, { recursive: true });

  const manifestLevels: ManifestLevel[] = [];

  for (const level of levels) {
    let chosenSeed: number | null = null;
    let chosenWav: Uint8Array | null = null;
    let lastFailure = 'unknown failure';

    for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS; attempt++) {
      const candidateSeed = level.seed + attempt;
      const { wavBytes } = synthesizeLevelWav(level, candidateSeed, sampleRate);
      const check = verifyLevelWav(level, wavBytes);
      // For L4 whisper generation, require >= 3 agreeing votes on every code-row cell and
      // >= 60% feature-OFF CER so acoustic playback perturbations and extra bursts retain margin.
      const hasGenerationMargin =
        level.damage.kind !== 'whisper' ||
        ((check.minCodeRowAgreeOn ?? 0) >= 3 &&
          (check.cerFeatureOff ?? 0) >= 0.6);
      if (check.ok && hasGenerationMargin) {
        chosenSeed = candidateSeed;
        chosenWav = wavBytes;
        if (!options?.quiet) {
          const offText =
            check.cerFeatureOff !== undefined
              ? `, feature-OFF CER=${(check.cerFeatureOff * 100).toFixed(0)}%`
              : '';
          const agreeText =
            check.minCodeRowAgreeOn !== undefined && level.damage.kind === 'whisper'
              ? `, minAgree=${check.minCodeRowAgreeOn}`
              : '';
          console.log(
            `[fantome] ${level.id} (${level.title}): OK on seed ${chosenSeed} (attempt ${attempt + 1}/${MAX_SEED_ATTEMPTS}, pageErrors=${check.pageErrorCellsOn}${agreeText}${offText})`,
          );
        }
        break;
      }
      lastFailure = `seed ${candidateSeed}: ${
        check.ok
          ? `insufficient margin (minAgree=${check.minCodeRowAgreeOn ?? 0}, cerOff=${((check.cerFeatureOff ?? 0) * 100).toFixed(0)}%)`
          : (check.reason ?? 'failed')
      }`;
    }

    if (chosenSeed === null || chosenWav === null) {
      throw new Error(
        `[fantome] Level ${level.id} (${level.title}) failed verification across all ${MAX_SEED_ATTEMPTS} seeds. Last attempt: ${lastFailure}`,
      );
    }

    const wavFilename = `${level.id}.wav`;
    writeFileSync(join(outDir, wavFilename), chosenWav);

    manifestLevels.push({
      id: level.id,
      title: level.title,
      hint: level.hint,
      storyPage: level.storyPage,
      wav: `transmissions/${wavFilename}`,
      feature: level.feature,
      codeHash: hashLevelCode(salt, level.code),
      seedUsed: chosenSeed,
    });
  }

  const manifest: FantomeManifest = {
    version: 1,
    salt,
    levels: manifestLevels,
  };

  const manifestJsonText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(outDir, 'manifest.json'), manifestJsonText, 'utf8');

  const defaultPublicOutDir = join(rootDir, 'public', 'transmissions');
  if (resolve(outDir) === resolve(defaultPublicOutDir)) {
    writeFileSync(
      join(rootDir, 'src', 'fantome', 'manifest.json'),
      manifestJsonText,
      'utf8',
    );
  }

  return manifest;
}

export function verifyCommittedTransmissions(options?: {
  levelsPath?: string;
  outDir?: string;
  quiet?: boolean;
}): void {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const levelsPath =
    options?.levelsPath ?? join(rootDir, 'content', 'fantome', 'levels.json');
  const outDir = options?.outDir ?? join(rootDir, 'public', 'transmissions');
  const manifestPath = join(outDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`[fantome --verify-only] Missing manifest at ${manifestPath}`);
  }

  const defaultPublicOutDir = join(rootDir, 'public', 'transmissions');
  if (resolve(outDir) === resolve(defaultPublicOutDir)) {
    const srcManifestPath = join(rootDir, 'src', 'fantome', 'manifest.json');
    if (!existsSync(srcManifestPath)) {
      throw new Error(
        `[fantome --verify-only] Missing synced manifest at ${srcManifestPath}`,
      );
    }
    if (readFileSync(srcManifestPath, 'utf8') !== readFileSync(manifestPath, 'utf8')) {
      throw new Error(
        '[fantome --verify-only] src/fantome/manifest.json differs from public/transmissions/manifest.json',
      );
    }
  }

  const levels = JSON.parse(
    readFileSync(levelsPath, 'utf8'),
  ) as readonly LevelSource[];
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as FantomeManifest;

  if (manifest.levels.length !== levels.length) {
    throw new Error(
      `[fantome --verify-only] Manifest has ${manifest.levels.length} levels, expected ${levels.length}`,
    );
  }

  for (let i = 0; i < levels.length; i++) {
    const src = levels[i];
    const entry = manifest.levels[i];
    if (entry.id !== src.id) {
      throw new Error(
        `[fantome --verify-only] Level mismatch at index ${i}: ${entry.id} != ${src.id}`,
      );
    }
    const expectedHash = hashLevelCode(manifest.salt, src.code);
    if (entry.codeHash !== expectedHash) {
      throw new Error(
        `[fantome --verify-only] Hash mismatch for ${src.id} in manifest.json`,
      );
    }
    const wavPath = join(outDir, `${src.id}.wav`);
    if (!existsSync(wavPath)) {
      throw new Error(`[fantome --verify-only] Missing WAV file ${wavPath}`);
    }
    const wavBytes = new Uint8Array(readFileSync(wavPath));
    const check = verifyLevelWav(src, wavBytes);
    if (!check.ok) {
      throw new Error(
        `[fantome --verify-only] ${src.id} WAV verification failed: ${check.reason ?? 'unknown'}`,
      );
    }
    if (!options?.quiet) {
      const offText =
        check.cerFeatureOff !== undefined
          ? `, feature-OFF CER=${(check.cerFeatureOff * 100).toFixed(0)}%`
          : '';
      console.log(
        `[fantome --verify-only] ${src.id} verified OK (seedUsed=${entry.seedUsed}${offText})`,
      );
    }
  }
}

const isDirectCliRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectCliRun) {
  const verifyOnly = process.argv.includes('--verify-only');
  try {
    if (verifyOnly) {
      verifyCommittedTransmissions();
    } else {
      generateAllTransmissions();
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
