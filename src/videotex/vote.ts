import { PAGE_FIRST_ROW, PAGE_LAST_ROW, SCREEN_COLS, SCREEN_ROWS } from './codes';
import {
  cellsEqual,
  cloneCell,
  cloneScreen,
  createBlankCell,
  createBlankScreen,
  serializeCellKey,
  type Cell,
  type Screen,
} from './screen';

export interface VoteResult {
  /** Reconstructed 25x40 screen where ties or all-erased cells are marked `error: true`. */
  screen: Screen;
  /** Row-major (25 * 40 = 1000) count of valid receptions agreeing with the chosen cell (0 if unresolved). */
  agree: Uint8Array;
  /** Row-major (25 * 40 = 1000) count of non-error receptions at each cell. */
  valid: Uint8Array;
  /** Total number of unresolved (`error: true`) cells across the 25x40 screen. */
  unresolved: number;
}

interface CandidateBucket {
  cell: Cell;
  count: number;
}

function resolveCellBuckets(buckets: Map<string, CandidateBucket>): {
  cell: Cell;
  agree: number;
  valid: number;
  resolved: boolean;
} {
  let valid = 0;
  let bestCount = 0;
  let secondBestCount = 0;
  let bestCell: Cell | null = null;

  for (const entry of buckets.values()) {
    valid += entry.count;
    if (entry.count > bestCount) {
      secondBestCount = bestCount;
      bestCount = entry.count;
      bestCell = entry.cell;
    } else if (entry.count > secondBestCount) {
      secondBestCount = entry.count;
    }
  }

  if (valid === 0 || bestCell === null || bestCount === secondBestCount) {
    return {
      cell: createBlankCell({ error: true }),
      agree: 0,
      valid: Math.min(255, valid),
      resolved: false,
    };
  }

  const cleanWinner = cloneCell(bestCell);
  cleanWinner.error = false;
  return {
    cell: cleanWinner,
    agree: Math.min(255, bestCount),
    valid: Math.min(255, valid),
    resolved: true,
  };
}

/**
 * Incremental per-cell majority vote treating `error: true` cells as erasures.
 * Order-independent (Property V10): adding receptions in any order produces the exact same `VoteResult`.
 */
export class IncrementalVote {
  private readonly cellBuckets: Map<string, CandidateBucket>[];
  private receptions = 0;

  constructor() {
    this.cellBuckets = Array.from(
      { length: SCREEN_ROWS * SCREEN_COLS },
      () => new Map<string, CandidateBucket>(),
    );
  }

  add(s: Screen): void {
    this.receptions++;
    for (let r = 0; r < SCREEN_ROWS; r++) {
      const row = s.rows[r];
      if (!row) continue;
      for (let c = 0; c < SCREEN_COLS; c++) {
        const cell = row[c];
        if (!cell || cell.error) {
          continue;
        }
        const idx = r * SCREEN_COLS + c;
        const map = this.cellBuckets[idx];
        const key = serializeCellKey(cell, true);
        const existing = map.get(key);
        if (existing) {
          existing.count++;
        } else {
          const stored = cloneCell(cell);
          stored.error = false;
          map.set(key, { cell: stored, count: 1 });
        }
      }
    }
  }

  count(): number {
    return this.receptions;
  }

  reset(): void {
    this.receptions = 0;
    for (const map of this.cellBuckets) {
      map.clear();
    }
  }

  clone(): IncrementalVote {
    const copy = new IncrementalVote();
    copy.receptions = this.receptions;
    for (let i = 0; i < this.cellBuckets.length; i++) {
      const srcMap = this.cellBuckets[i];
      const dstMap = copy.cellBuckets[i];
      for (const [key, entry] of srcMap.entries()) {
        dstMap.set(key, { cell: entry.cell, count: entry.count });
      }
    }
    return copy;
  }

  result(): VoteResult {
    const outScreen = createBlankScreen();
    const agree = new Uint8Array(SCREEN_ROWS * SCREEN_COLS);
    const valid = new Uint8Array(SCREEN_ROWS * SCREEN_COLS);
    let unresolved = 0;

    for (let r = 0; r < SCREEN_ROWS; r++) {
      for (let c = 0; c < SCREEN_COLS; c++) {
        const idx = r * SCREEN_COLS + c;
        const resolved = resolveCellBuckets(this.cellBuckets[idx]);
        outScreen.rows[r][c] = resolved.cell;
        agree[idx] = resolved.agree;
        valid[idx] = resolved.valid;
        if (!resolved.resolved) {
          unresolved++;
        }
      }
    }

    return {
      screen: outScreen,
      agree,
      valid,
      unresolved,
    };
  }
}

/**
 * Batch majority vote over `N` screens of the same page, treating `error: true` cells as erasures.
 */
export function vote(screens: readonly Screen[]): VoteResult {
  const acc = new IncrementalVote();
  for (const s of screens) {
    acc.add(s);
  }
  return acc.result();
}

export interface VisitedReception {
  readonly screen: Screen;
  /** Optional 1000-byte mask (`1` = explicitly written since FF/reset, `0` = unvisited blank). */
  readonly visitedMask?: Uint8Array;
}

const DEFAULT_BLANK = createBlankCell();
const DEFAULT_BLANK_KEY = serializeCellKey(DEFAULT_BLANK, true);

function isBlankSpaceGlyph(cell: Cell): boolean {
  return cell.set === 'G0' && cell.code === 0x20;
}

function sameGlyphAndPart(a: Cell, b: Cell): boolean {
  const samePart =
    a.part === undefined && b.part === undefined
      ? true
      : a.part !== undefined &&
        b.part !== undefined &&
        a.part.x === b.part.x &&
        a.part.y === b.part.y;
  return (
    a.set === b.set &&
    a.code === b.code &&
    a.accent === b.accent &&
    samePart
  );
}

/**
 * Burst-resilient, order-independent majority vote over `N` receptions:
 * 1. Realigns contiguous clean character islands (`>= 3` cells) that follow an error on the row
 *    (or spilled onto `r - 1` when `US(r)` was lost) against the consensus of the other receptions,
 *    using symmetric Jacobi updates so arrival order never changes the result (Property V15).
 * 2. Distinguishes explicitly visited cells from unvisited `FF`-cleared cells so lost `US` codes
 *    do not outvote genuine characters with blank spaces.
 */
export function voteAligned(receptions: readonly VisitedReception[]): VoteResult {
  const n = receptions.length;
  if (n === 0) {
    return new IncrementalVote().result();
  }
  if (n === 1 && receptions[0].visitedMask === undefined) {
    return vote([receptions[0].screen]);
  }

  let curScreens: Screen[] = receptions.map((r) => cloneScreen(r.screen));
  let curVisited: (Uint8Array | undefined)[] = receptions.map((r) =>
    r.visitedMask ? r.visitedMask.slice() : undefined,
  );
  let curUncertain: Uint8Array[] = receptions.map(
    () => new Uint8Array(SCREEN_ROWS * SCREEN_COLS),
  );
  let curTrustedIsland: Uint8Array[] = receptions.map(() =>
    new Uint8Array(SCREEN_ROWS * SCREEN_COLS).fill(1),
  );

  if (n >= 2) {
    for (let iter = 0; iter < 2; iter++) {
      const nextScreens = new Array<Screen>(n);
      const nextVisited = new Array<Uint8Array | undefined>(n);
      const nextUncertain = new Array<Uint8Array>(n);
      const nextTrusted = new Array<Uint8Array>(n);

      for (let k = 0; k < n; k++) {
        const src = receptions[k].screen;
        const srcVis = receptions[k].visitedMask;
        let hasAnyError = false;
        for (let r = 0; r < SCREEN_ROWS && !hasAnyError; r++) {
          for (let c = 0; c < SCREEN_COLS; c++) {
            if (src.rows[r][c].error) {
              hasAnyError = true;
              break;
            }
          }
        }

        if (!hasAnyError && srcVis === undefined) {
          nextScreens[k] = cloneScreen(src);
          nextVisited[k] = undefined;
          nextUncertain[k] = new Uint8Array(SCREEN_ROWS * SCREEN_COLS);
          nextTrusted[k] = new Uint8Array(SCREEN_ROWS * SCREEN_COLS).fill(1);
          continue;
        }

        const builtScreen = createBlankScreen();
        const builtVis = new Uint8Array(SCREEN_ROWS * SCREEN_COLS);
        const builtUnc = new Uint8Array(SCREEN_ROWS * SCREEN_COLS);
        const builtTrusted = new Uint8Array(SCREEN_ROWS * SCREEN_COLS);
        for (let r = 0; r < SCREEN_ROWS; r++) {
          for (let c = 0; c < SCREEN_COLS; c++) {
            if (src.rows[r][c].error) {
              builtScreen.rows[r][c] = createBlankCell({ error: true });
            }
          }
        }

        for (let r = 0; r < SCREEN_ROWS; r++) {
          const row = src.rows[r];
          let sawErrorOnRow = false;
          let c = 0;
          while (c < SCREEN_COLS) {
            const idx = r * SCREEN_COLS + c;
            if (row[c].error) {
              sawErrorOnRow = true;
              c++;
              continue;
            }
            if (srcVis !== undefined && srcVis[idx] === 0) {
              c++;
              continue;
            }
            const start = c;
            while (
              c < SCREEN_COLS &&
              !row[c].error &&
              (srcVis === undefined || srcVis[r * SCREEN_COLS + c] === 1)
            ) {
              c++;
            }
            const end = c - 1;
            const canShift = sawErrorOnRow;

            let bestRow = r;
            let bestShift = 0;
            let nonBlankCount = 0;
            for (let col = start; col <= end; col++) {
              if (!isBlankSpaceGlyph(row[col])) nonBlankCount++;
            }

            if (end - start + 1 >= 3 && nonBlankCount >= 2) {
              const candidateRows = [r];
              if (r >= PAGE_FIRST_ROW && r < PAGE_LAST_ROW) {
                candidateRows.push(r + 1);
              }
              let bestScore = -1;
              let originScore = 0;

              for (const candR of candidateRows) {
                const minShift = candR === r && !canShift ? 0 : -16;
                const maxShift = candR === r && !canShift ? 0 : 16;
                for (let shift = minShift; shift <= maxShift; shift++) {
                  let glyphMatches = 0;
                  let exactMatches = 0;
                  let matchedCols = 0;
                  for (let col = start; col <= end; col++) {
                    const dstCol = col + shift;
                    if (dstCol < 0 || dstCol >= SCREEN_COLS) continue;
                    const cell = row[col];
                    if (isBlankSpaceGlyph(cell)) continue;
                    let colMatched = false;
                    for (let j = 0; j < n; j++) {
                      if (j === k) continue;
                      const other = curScreens[j].rows[candR][dstCol];
                      const otherVis = curVisited[j];
                      if (other.error) continue;
                      if (
                        otherVis !== undefined &&
                        otherVis[candR * SCREEN_COLS + dstCol] === 0
                      ) {
                        continue;
                      }
                      if (sameGlyphAndPart(cell, other)) {
                        glyphMatches++;
                        if (cellsEqual(cell, other, true)) exactMatches++;
                        colMatched = true;
                      }
                    }
                    if (colMatched) matchedCols++;
                  }
                  const score =
                    glyphMatches +
                    0.25 * exactMatches +
                    (candR === r && shift === 0 ? 0.6 : 0);
                  if (candR === r && shift === 0) {
                    originScore = score;
                  }
                  const minMatchedCols = candR === r ? 2 : 4;
                  if (matchedCols >= minMatchedCols && score > bestScore) {
                    bestScore = score;
                    bestRow = candR;
                    bestShift = shift;
                  }
                }
              }

              if (bestScore <= originScore) {
                bestRow = r;
                bestShift = 0;
              }
            }

            const attrUncertain = canShift || bestRow !== r || bestShift !== 0;
            const isTrustedSpan = end - start + 1 >= 3;
            for (let col = start; col <= end; col++) {
              const dstCol = col + bestShift;
              if (dstCol >= 0 && dstCol < SCREEN_COLS) {
                builtScreen.rows[bestRow][dstCol] = cloneCell(row[col]);
                builtVis[bestRow * SCREEN_COLS + dstCol] = 1;
                builtUnc[bestRow * SCREEN_COLS + dstCol] = attrUncertain ? 1 : 0;
                builtTrusted[bestRow * SCREEN_COLS + dstCol] = isTrustedSpan ? 1 : 0;
              }
            }
          }
        }

        nextScreens[k] = builtScreen;
        nextVisited[k] = srcVis !== undefined ? builtVis : undefined;
        nextUncertain[k] = builtUnc;
        nextTrusted[k] = builtTrusted;
      }

      curScreens = nextScreens;
      curVisited = nextVisited;
      curUncertain = nextUncertain;
      curTrustedIsland = nextTrusted;
    }
  }

  const outScreen = createBlankScreen();
  const agree = new Uint8Array(SCREEN_ROWS * SCREEN_COLS);
  const valid = new Uint8Array(SCREEN_ROWS * SCREEN_COLS);
  let unresolved = 0;

  for (let r = 0; r < SCREEN_ROWS; r++) {
    for (let c = 0; c < SCREEN_COLS; c++) {
      const idx = r * SCREEN_COLS + c;
      // 1. Find unique clean-attribute representative per glyph (if any) at (r, c)
      const cleanByGlyph = new Map<
        string,
        Map<string, { cell: Cell; count: number }>
      >();
      for (let k = 0; k < n; k++) {
        const cell = curScreens[k].rows[r][c];
        if (!cell || cell.error) continue;
        const vis = curVisited[k];
        if (vis !== undefined && vis[idx] === 0) continue;
        if (curUncertain[k][idx] !== 0) continue;
        const gKey = `${cell.set}:${cell.code}:${cell.accent ?? -1}:${cell.part ? `${cell.part.x},${cell.part.y}` : ''}`;
        let sub = cleanByGlyph.get(gKey);
        if (!sub) {
          sub = new Map();
          cleanByGlyph.set(gKey, sub);
        }
        const fKey = serializeCellKey(cell, true);
        const ex = sub.get(fKey);
        if (ex) ex.count++;
        else {
          const st = cloneCell(cell);
          st.error = false;
          sub.set(fKey, { cell: st, count: 1 });
        }
      }

      const dominantCleanForGlyph = new Map<string, Cell>();
      for (const [gKey, sub] of cleanByGlyph.entries()) {
        let best = 0;
        let second = 0;
        let bestCell: Cell | null = null;
        for (const entry of sub.values()) {
          if (entry.count > best) {
            second = best;
            best = entry.count;
            bestCell = entry.cell;
          } else if (entry.count > second) {
            second = entry.count;
          }
        }
        if (bestCell !== null && best > second) {
          dominantCleanForGlyph.set(gKey, bestCell);
        }
      }

      // 2. Tally explicitly visited cells (letting uncertain post-burst islands inherit a unique clean attribute match)
      const explicitBuckets = new Map<string, CandidateBucket>();
      const trustedKeys = new Set<string>();
      let unvisitedCount = 0;
      for (let k = 0; k < n; k++) {
        const rawCell = curScreens[k].rows[r][c];
        if (!rawCell || rawCell.error) continue;
        const vis = curVisited[k];
        if (vis !== undefined && vis[idx] === 0) {
          unvisitedCount++;
          continue;
        }
        let voteCell = rawCell;
        if (curUncertain[k][idx] !== 0) {
          const gKey = `${rawCell.set}:${rawCell.code}:${rawCell.accent ?? -1}:${rawCell.part ? `${rawCell.part.x},${rawCell.part.y}` : ''}`;
          const cleanMatch = dominantCleanForGlyph.get(gKey);
          if (cleanMatch !== undefined) {
            voteCell = cleanMatch;
          }
        }
        const fKey = serializeCellKey(voteCell, true);
        if (curTrustedIsland[k][idx] !== 0) {
          trustedKeys.add(fKey);
        }
        const existing = explicitBuckets.get(fKey);
        if (existing) {
          existing.count++;
        } else {
          const stored = cloneCell(voteCell);
          stored.error = false;
          explicitBuckets.set(fKey, { cell: stored, count: 1 });
        }
      }

      const explicitRes = resolveCellBuckets(explicitBuckets);
      const winnerKey = explicitRes.resolved
        ? serializeCellKey(explicitRes.cell, true)
        : '';
      const unanimousTrustedSingle =
        explicitRes.resolved &&
        explicitRes.agree === 1 &&
        explicitRes.valid === 1 &&
        trustedKeys.has(winnerKey);
      if (
        explicitRes.resolved &&
        (explicitRes.agree >= 2 || unvisitedCount === 0 || unanimousTrustedSingle)
      ) {
        outScreen.rows[r][c] = explicitRes.cell;
        agree[idx] = explicitRes.agree;
        valid[idx] = explicitRes.valid;
        continue;
      }

      if (unvisitedCount > 0) {
        const merged = new Map<string, CandidateBucket>(explicitBuckets);
        const exBlank = merged.get(DEFAULT_BLANK_KEY);
        if (exBlank) {
          merged.set(DEFAULT_BLANK_KEY, {
            cell: exBlank.cell,
            count: exBlank.count + unvisitedCount,
          });
        } else {
          merged.set(DEFAULT_BLANK_KEY, {
            cell: cloneCell(DEFAULT_BLANK),
            count: unvisitedCount,
          });
        }
        const fallbackRes = resolveCellBuckets(merged);
        outScreen.rows[r][c] = fallbackRes.cell;
        agree[idx] = fallbackRes.agree;
        valid[idx] = fallbackRes.valid;
        if (!fallbackRes.resolved) unresolved++;
      } else {
        outScreen.rows[r][c] = explicitRes.cell;
        agree[idx] = explicitRes.agree;
        valid[idx] = explicitRes.valid;
        if (!explicitRes.resolved) unresolved++;
      }
    }
  }

  return {
    screen: outScreen,
    agree,
    valid,
    unresolved,
  };
}

/**
 * Computes the cell error rate in `[0, 1]` between `s` and `ref`, optionally restricted to `rows`.
 * An `error: true` cell on `s` never matches a clean (`error: false`) cell on `ref`.
 */
export function cellErrorRate(
  s: Screen,
  ref: Screen,
  rows?: readonly number[],
): number {
  const targetRows =
    rows ?? Array.from({ length: SCREEN_ROWS }, (_, index) => index);

  let totalCells = 0;
  let wrongCells = 0;

  for (const r of targetRows) {
    if (r < 0 || r >= SCREEN_ROWS) continue;
    for (let c = 0; c < SCREEN_COLS; c++) {
      totalCells++;
      if (!cellsEqual(s.rows[r][c], ref.rows[r][c], false)) {
        wrongCells++;
      }
    }
  }

  return totalCells === 0 ? 0 : wrongCells / totalCells;
}

/**
 * Returns the 25-element array of per-row cell error rates (`row 0 .. row 24`).
 */
export function cellErrorRateByRow(s: Screen, ref: Screen): number[] {
  const rates = new Array<number>(SCREEN_ROWS);
  for (let r = 0; r < SCREEN_ROWS; r++) {
    rates[r] = cellErrorRate(s, ref, [r]);
  }
  return rates;
}
