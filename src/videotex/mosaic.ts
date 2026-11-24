import {
  blocksToG1Code,
  g1CodeToBlocks,
  isMosaicG1Code,
  SCREEN_COLS,
  PAGE_LAST_ROW,
  type MosaicBlocks,
} from './codes';

export { blocksToG1Code, g1CodeToBlocks, isMosaicG1Code, type MosaicBlocks };

export const MAX_MOSAIC_BITMAP_WIDTH = SCREEN_COLS * 2; // 80 blocks
export const MAX_MOSAIC_BITMAP_HEIGHT = PAGE_LAST_ROW * 3; // 72 blocks

export type MosaicBitmapError = { kind: 'bad-bitmap'; reason: string };

export type MosaicResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MosaicBitmapError };

/**
 * Converts a 1-bit `#`/`.` bitmap (width multiple of 2 up to 80, height multiple of 3 up to 72)
 * into a 2D array of Videotex G1 character codes (`0x20..0x3F` and `0x60..0x7F`).
 */
export function bitmapToG1Grid(bitmap: readonly string[]): MosaicResult<number[][]> {
  if (bitmap.length === 0) {
    return {
      ok: false,
      error: { kind: 'bad-bitmap', reason: 'Bitmap must contain at least 3 block rows' },
    };
  }
  if (bitmap.length > MAX_MOSAIC_BITMAP_HEIGHT) {
    return {
      ok: false,
      error: {
        kind: 'bad-bitmap',
        reason: `Bitmap height ${bitmap.length} exceeds maximum ${MAX_MOSAIC_BITMAP_HEIGHT}`,
      },
    };
  }
  if (bitmap.length % 3 !== 0) {
    return {
      ok: false,
      error: {
        kind: 'bad-bitmap',
        reason: `Bitmap height ${bitmap.length} must be a multiple of 3`,
      },
    };
  }

  const width = bitmap[0].length;
  if (width === 0) {
    return {
      ok: false,
      error: { kind: 'bad-bitmap', reason: 'Bitmap rows must not be empty' },
    };
  }
  if (width > MAX_MOSAIC_BITMAP_WIDTH) {
    return {
      ok: false,
      error: {
        kind: 'bad-bitmap',
        reason: `Bitmap width ${width} exceeds maximum ${MAX_MOSAIC_BITMAP_WIDTH}`,
      },
    };
  }
  if (width % 2 !== 0) {
    return {
      ok: false,
      error: {
        kind: 'bad-bitmap',
        reason: `Bitmap width ${width} must be a multiple of 2`,
      },
    };
  }

  for (let r = 0; r < bitmap.length; r++) {
    const line = bitmap[r];
    if (line.length !== width) {
      return {
        ok: false,
        error: {
          kind: 'bad-bitmap',
          reason: `Bitmap row ${r} has width ${line.length}, expected ${width}`,
        },
      };
    }
    for (let c = 0; c < width; c++) {
      const ch = line[c];
      if (ch !== '#' && ch !== '.') {
        return {
          ok: false,
          error: {
            kind: 'bad-bitmap',
            reason: `Invalid character '${ch}' at bitmap (${r}, ${c}); expected '#' or '.'`,
          },
        };
      }
    }
  }

  const cellRows = bitmap.length / 3;
  const cellCols = width / 2;
  const grid: number[][] = [];

  for (let cr = 0; cr < cellRows; cr++) {
    const rowCodes: number[] = [];
    const r0 = cr * 3;
    for (let cc = 0; cc < cellCols; cc++) {
      const c0 = cc * 2;
      const b1 = bitmap[r0][c0] === '#' ? 1 : 0;
      const b2 = bitmap[r0][c0 + 1] === '#' ? 1 : 0;
      const b3 = bitmap[r0 + 1][c0] === '#' ? 1 : 0;
      const b4 = bitmap[r0 + 1][c0 + 1] === '#' ? 1 : 0;
      const b5 = bitmap[r0 + 2][c0] === '#' ? 1 : 0;
      const b6 = bitmap[r0 + 2][c0 + 1] === '#' ? 1 : 0;
      rowCodes.push(blocksToG1Code([b1, b2, b3, b4, b5, b6]));
    }
    grid.push(rowCodes);
  }

  return { ok: true, value: grid };
}

/**
 * Converts a 2D grid of G1 codes back into `#`/`.` strings (3 block rows per cell row,
 * 2 block columns per cell column). Returns `null` if any code is outside G1 mosaic range.
 */
export function g1GridToBitmap(grid: readonly (readonly number[])[]): string[] | null {
  if (grid.length === 0) {
    return [];
  }
  const cols = grid[0].length;
  const out: string[] = [];

  for (let cr = 0; cr < grid.length; cr++) {
    if (grid[cr].length !== cols) {
      return null;
    }
    let line0 = '';
    let line1 = '';
    let line2 = '';
    for (let cc = 0; cc < cols; cc++) {
      const blocks = g1CodeToBlocks(grid[cr][cc]);
      if (blocks === null) {
        return null;
      }
      line0 += (blocks[0] ? '#' : '.') + (blocks[1] ? '#' : '.');
      line1 += (blocks[2] ? '#' : '.') + (blocks[3] ? '#' : '.');
      line2 += (blocks[4] ? '#' : '.') + (blocks[5] ? '#' : '.');
    }
    out.push(line0, line1, line2);
  }

  return out;
}
