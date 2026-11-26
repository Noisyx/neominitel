import { SCREEN_COLS, SCREEN_ROWS } from './codes';
import {
  cellsEqual,
  cloneCell,
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
