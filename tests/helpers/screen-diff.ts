import { cellsEqual, type Cell, type Screen } from '../../src/videotex/screen';
import { SCREEN_COLS, SCREEN_ROWS } from '../../src/videotex/codes';

export interface CellDifference {
  row: number;
  col: number;
  actual: Cell;
  expected: Cell;
}

/**
 * Lists every cell that differs between two screens, optionally restricted to specific rows.
 */
export function diffScreens(
  actual: Screen,
  expected: Screen,
  rows?: readonly number[],
): CellDifference[] {
  const targetRows =
    rows ?? Array.from({ length: SCREEN_ROWS }, (_, index) => index);
  const diffs: CellDifference[] = [];

  for (const r of targetRows) {
    if (r < 0 || r >= SCREEN_ROWS) continue;
    for (let c = 0; c < SCREEN_COLS; c++) {
      const a = actual.rows[r][c];
      const b = expected.rows[r][c];
      if (!cellsEqual(a, b)) {
        diffs.push({ row: r, col: c, actual: a, expected: b });
      }
    }
  }
  return diffs;
}

/**
 * Returns the set of row indices (0..24) where at least one cell differs between two screens.
 */
export function changedRowIndices(actual: Screen, expected: Screen): number[] {
  const rows: number[] = [];
  for (let r = 0; r < SCREEN_ROWS; r++) {
    let rowDiffers = false;
    for (let c = 0; c < SCREEN_COLS; c++) {
      if (!cellsEqual(actual.rows[r][c], expected.rows[r][c])) {
        rowDiffers = true;
        break;
      }
    }
    if (rowDiffers) {
      rows.push(r);
    }
  }
  return rows;
}
