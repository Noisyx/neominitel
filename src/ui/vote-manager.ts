import { screenSimilarity } from '../services';
import {
  cellsEqual,
  createBlankCell,
  decodeBytes,
  IncrementalVote,
  SCREEN_COLS,
  SCREEN_ROWS,
  voteAligned,
  type Cell,
  type Screen,
  type VisitedReception,
  type VoteResult,
} from '../videotex';
import type { ActiveVoteSummary } from './hud/VotePanel';
import {
  computeVoteProgression,
  type VoteProgressionReport,
} from './hud/voteMetrics';
import type { LineMode } from './screens/ModeBar';

/** Minimum non-error cell similarity required to join an existing vote in Écoute / Fichier mode (Req 7.4). */
export const VOTE_MATCH_SIMILARITY = 0.8;
export const MAX_STORED_RECEPTIONS_FOR_METRICS = 7;
const MAX_ALIGNED_RECEPTIONS = 16;
const DEFAULT_BLANK: Cell = createBlankCell();

export interface VoteBucket {
  readonly pageId: string;
  readonly bytesKey: string | null;
  readonly referenceScreen: Screen | null;
  readonly receptionsList: readonly Screen[];
  readonly visitedReceptions: readonly VisitedReception[];
  readonly accumulator: IncrementalVote;
  readonly latestResult: VoteResult;
  readonly lastReception: Screen;
  readonly maxSingleErrors: number;
}

export interface VoteStore {
  readonly buckets: Readonly<Record<string, VoteBucket>>;
  readonly pendingTx: {
    readonly pageId: string;
    readonly bytesKey: string;
    readonly referenceScreen: Screen;
  } | null;
  readonly activePageId: string | null;
  readonly lastOverallReception: Screen | null;
  readonly nextAutoIndex: number;
}

export function createEmptyVoteStore(): VoteStore {
  return {
    buckets: {},
    pendingTx: null,
    activePageId: null,
    lastOverallReception: null,
    nextAutoIndex: 1,
  };
}

export function countScreenErrors(screen: Screen): number {
  let count = 0;
  for (let r = 0; r < SCREEN_ROWS; r++) {
    const row = screen.rows[r];
    if (!row) continue;
    for (let c = 0; c < SCREEN_COLS; c++) {
      if (row[c]?.error) {
        count++;
      }
    }
  }
  return count;
}

export function fingerprintPageBytes(bytes: Uint8Array): string {
  let out = `${bytes.length}:`;
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] & 0x7f);
  }
  return out;
}

function visitedAwareSimilarity(
  incoming: Screen,
  visitedMask: Uint8Array | undefined,
  refScreen: Screen,
  refVisitedMask?: Uint8Array,
): number {
  if (!visitedMask && !refVisitedMask) {
    return screenSimilarity(incoming, refScreen);
  }
  let validPairs = 0;
  let equalPairs = 0;
  for (let r = 0; r < SCREEN_ROWS; r++) {
    for (let c = 0; c < SCREEN_COLS; c++) {
      const ca = incoming.rows[r][c];
      const cb = refScreen.rows[r][c];
      if (ca.error || cb.error) continue;
      const idx = r * SCREEN_COLS + c;
      if (visitedMask && visitedMask[idx] === 0 && !cellsEqual(cb, DEFAULT_BLANK, true)) {
        continue;
      }
      if (refVisitedMask && refVisitedMask[idx] === 0 && !cellsEqual(ca, DEFAULT_BLANK, true)) {
        continue;
      }
      validPairs++;
      if (cellsEqual(ca, cb, true)) {
        equalPairs++;
      }
    }
  }
  return validPairs === 0 ? 0 : equalPairs / validPairs;
}

/**
 * Registers an outgoing page in `Seul` or `Serveur` mode.
 * If `bytes` changed since the previous reception for `pageId`, resets that page's vote (Req 7.1).
 */
export function preparePageVote(
  store: VoteStore,
  pageId: string,
  bytes: Uint8Array,
): VoteStore {
  const bytesKey = fingerprintPageBytes(bytes);
  const existing = store.buckets[pageId];
  let nextBuckets = store.buckets;

  if (existing && existing.bytesKey !== null && existing.bytesKey !== bytesKey) {
    const copy = { ...store.buckets };
    delete copy[pageId];
    nextBuckets = copy;
  }

  const referenceScreen =
    existing && existing.bytesKey === bytesKey && existing.referenceScreen
      ? existing.referenceScreen
      : decodeBytes(bytes);

  return {
    ...store,
    buckets: nextBuckets,
    pendingTx: { pageId, bytesKey, referenceScreen },
    activePageId: pageId,
  };
}

/**
 * Clears `pendingTx` before streaming a WAV archive (`3615 FANTOME` or `Fichier`),
 * so `recordCompletedPageVote` groups repetitions by `>= 80%` similarity matching.
 */
export function prepareWavVote(store: VoteStore): VoteStore {
  if (store.pendingTx === null) {
    return store;
  }
  return {
    ...store,
    pendingTx: null,
  };
}

/**
 * Records a completed `pageEnd` screen into the immutable `VoteStore`:
 * - In `Seul` / `Serveur` (with `pendingTx`), adds to `buckets[pageId]`.
 * - In `Écoute` / `Fichier` (or WAV playback without `pendingTx`), joins the bucket whose
 *   `latestResult.screen` has the highest similarity `>= 80%`, or starts a new bucket (Req 7.4).
 */
export function recordCompletedPageVote(
  store: VoteStore,
  screen: Screen,
  mode: LineMode,
  visitedMask?: Uint8Array,
): VoteStore {
  const errCount = countScreenErrors(screen);
  const entry: VisitedReception = visitedMask
    ? { screen, visitedMask }
    : { screen };
  const useKnownPageId =
    (mode === 'Seul' || mode === 'Serveur') && store.pendingTx !== null;

  if (useKnownPageId && store.pendingTx) {
    const { pageId, bytesKey, referenceScreen } = store.pendingTx;
    const prev = store.buckets[pageId];
    const isSameContent = prev !== undefined && prev.bytesKey === bytesKey;
    const acc = isSameContent ? prev.accumulator.clone() : new IncrementalVote();
    acc.add(screen);
    const nextVisited = isSameContent
      ? prev.visitedReceptions.length < MAX_ALIGNED_RECEPTIONS
        ? [...prev.visitedReceptions, entry]
        : prev.visitedReceptions
      : [entry];
    const latestResult =
      nextVisited.length >= 2 ? voteAligned(nextVisited) : acc.result();
    const maxSingleErrors = isSameContent
      ? Math.max(prev.maxSingleErrors, errCount)
      : errCount;
    const nextList = isSameContent
      ? prev.receptionsList.length < MAX_STORED_RECEPTIONS_FOR_METRICS
        ? [...prev.receptionsList, screen]
        : prev.receptionsList
      : [screen];

    const updatedBucket: VoteBucket = {
      pageId,
      bytesKey,
      referenceScreen,
      receptionsList: nextList,
      visitedReceptions: nextVisited,
      accumulator: acc,
      latestResult,
      lastReception: screen,
      maxSingleErrors,
    };

    return {
      ...store,
      buckets: {
        ...store.buckets,
        [pageId]: updatedBucket,
      },
      activePageId: pageId,
      lastOverallReception: screen,
    };
  }

  // Similarity matching for Écoute / Fichier (Req 7.4)
  let bestBucket: VoteBucket | null = null;
  let bestSimilarity = -1;

  for (const key of Object.keys(store.buckets)) {
    const candidate = store.buckets[key];
    const isMulti = candidate.accumulator.count() >= 2;
    const refScreen = isMulti
      ? candidate.latestResult.screen
      : candidate.lastReception;
    const refVisited = isMulti
      ? undefined
      : candidate.visitedReceptions[0]?.visitedMask;
    const sim = visitedAwareSimilarity(screen, visitedMask, refScreen, refVisited);
    if (sim >= VOTE_MATCH_SIMILARITY && sim > bestSimilarity) {
      bestSimilarity = sim;
      bestBucket = candidate;
    }
  }

  if (bestBucket) {
    const acc = bestBucket.accumulator.clone();
    acc.add(screen);
    const nextVisited =
      bestBucket.visitedReceptions.length < MAX_ALIGNED_RECEPTIONS
        ? [...bestBucket.visitedReceptions, entry]
        : bestBucket.visitedReceptions;
    const latestResult =
      nextVisited.length >= 2 ? voteAligned(nextVisited) : acc.result();
    const nextList =
      bestBucket.receptionsList.length < MAX_STORED_RECEPTIONS_FOR_METRICS
        ? [...bestBucket.receptionsList, screen]
        : bestBucket.receptionsList;
    const updatedBucket: VoteBucket = {
      ...bestBucket,
      receptionsList: nextList,
      visitedReceptions: nextVisited,
      accumulator: acc,
      latestResult,
      lastReception: screen,
      maxSingleErrors: Math.max(bestBucket.maxSingleErrors, errCount),
    };
    return {
      ...store,
      buckets: {
        ...store.buckets,
        [bestBucket.pageId]: updatedBucket,
      },
      activePageId: bestBucket.pageId,
      lastOverallReception: screen,
    };
  }

  const autoId = `ecoute/page-${store.nextAutoIndex}`;
  const acc = new IncrementalVote();
  acc.add(screen);
  const latestResult = acc.result();
  const createdBucket: VoteBucket = {
    pageId: autoId,
    bytesKey: null,
    referenceScreen: null,
    receptionsList: [screen],
    visitedReceptions: [entry],
    accumulator: acc,
    latestResult,
    lastReception: screen,
    maxSingleErrors: errCount,
  };

  // Do not let a single heavily damaged outlier pass displace an established >= 3-reception vote.
  const currentActive = store.activePageId
    ? store.buckets[store.activePageId]
    : undefined;
  const keepEstablishedActive =
    currentActive !== undefined &&
    currentActive.accumulator.count() >= 3 &&
    errCount >= 40;

  return {
    ...store,
    buckets: {
      ...store.buckets,
      [autoId]: createdBucket,
    },
    activePageId: keepEstablishedActive ? store.activePageId : autoId,
    lastOverallReception: screen,
    nextAutoIndex: store.nextAutoIndex + 1,
  };
}

/**
 * Returns `vote.result().screen` when `voteOn` is enabled and at least 2 receptions exist,
 * otherwise returns the latest reception (`design.md` "Vote").
 */
export function selectDisplayedScreenForVote(
  store: VoteStore,
  voteOn: boolean,
  fallback: Screen,
): Screen {
  if (!store.activePageId) {
    return fallback;
  }
  const bucket = store.buckets[store.activePageId];
  if (!bucket) {
    return fallback;
  }
  if (voteOn && bucket.accumulator.count() >= 2) {
    return bucket.latestResult.screen;
  }
  return store.lastOverallReception ?? bucket.lastReception;
}

export function getActiveVoteSummary(store: VoteStore): ActiveVoteSummary | null {
  if (!store.activePageId) {
    return null;
  }
  const bucket = store.buckets[store.activePageId];
  if (!bucket) {
    return null;
  }
  return {
    pageId: bucket.pageId,
    receptions: bucket.accumulator.count(),
    unresolved: bucket.latestResult.unresolved,
    lastReceptionErrors: bucket.maxSingleErrors,
  };
}

export function getActiveVoteProgression(
  store: VoteStore,
): VoteProgressionReport | null {
  if (!store.activePageId) {
    return null;
  }
  const bucket = store.buckets[store.activePageId];
  if (!bucket || !bucket.referenceScreen) {
    return null;
  }
  return computeVoteProgression(
    bucket.pageId,
    bucket.receptionsList,
    bucket.referenceScreen,
  );
}
