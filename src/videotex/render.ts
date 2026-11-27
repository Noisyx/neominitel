import {
  COLOUR_PALETTE_RGB,
  g1CodeToBlocks,
  isMosaicG1Code,
  MONOCHROME_PALETTE_RGB,
  SCREEN_COLS,
  SCREEN_ROWS,
} from './codes';
import {
  ERROR_HATCH_GLYPH,
  getAccentedGlyph,
  getAsciiGlyph,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
} from './font';
import type { Cell, Screen } from './screen';

export const CELL_WIDTH_PX = GLYPH_WIDTH; // 8
export const CELL_HEIGHT_PX = GLYPH_HEIGHT; // 10
export const SCREEN_WIDTH_PX = SCREEN_COLS * CELL_WIDTH_PX; // 320
export const SCREEN_HEIGHT_PX = SCREEN_ROWS * CELL_HEIGHT_PX; // 250

export const MOSAIC_COL_WIDTHS = [4, 4] as const;
export const MOSAIC_ROW_HEIGHTS = [3, 4, 3] as const;

export type PaletteMode = 'couleur' | 'nb';
export type RgbTuple = readonly [r: number, g: number, b: number];

export interface MosaicBlockRect {
  index: 0 | 1 | 2 | 3 | 4 | 5;
  x: number;
  y: number;
  width: number;
  height: number;
  on: boolean;
}

export interface RenderCellOptions {
  palette?: PaletteMode;
  /** Whether flashing foregrounds are currently in their visible phase (default: true). */
  flashVisible?: boolean;
  /** Whether the visible terminal cursor rests on this cell (default: false). */
  cursorHere?: boolean;
}

export type ResolvedCellRender =
  | {
      kind: 'glyph' | 'error';
      fgRgb: RgbTuple;
      bgRgb: RgbTuple;
      bitmap: Uint8Array;
    }
  | {
      kind: 'mosaic';
      fgRgb: RgbTuple;
      bgRgb: RgbTuple;
      disjoint: boolean;
      blocks: MosaicBlockRect[];
      bitmap: Uint8Array;
    };

const EMPTY_BITMAP = new Uint8Array(CELL_HEIGHT_PX);

/**
 * Returns the 8-entry RGB palette for `'couleur'` (RGB) or `'nb'` (Minitel 1 luminance greyscale).
 */
export function resolvePalette(mode: PaletteMode): readonly RgbTuple[] {
  return mode === 'nb' ? MONOCHROME_PALETTE_RGB : COLOUR_PALETTE_RGB;
}

/**
 * Computes whether `flash` characters are visible at `timeMs`.
 * Per design: hidden for 1/3 of a 1 s period (`[667, 1000)` ms), unless `reducedMotion` is true.
 */
export function isFlashVisible(timeMs: number, reducedMotion = false): boolean {
  if (reducedMotion) {
    return true;
  }
  const phase = ((timeMs % 1000) + 1000) % 1000;
  return phase < 667;
}

/**
 * Computes the six 2x3 mosaic block rectangles inside an 8x10 cell:
 * columns 4 + 4 px, rows 3 + 4 + 3 px; disjoint leaves a 1 px gap on right and bottom.
 */
export function getMosaicBlockRects(
  code: number,
  disjoint: boolean,
  visible = true,
): MosaicBlockRect[] {
  const bits = g1CodeToBlocks(code) ?? [0, 0, 0, 0, 0, 0];
  const colX = [0, 4] as const;
  const rowY = [0, 3, 7] as const;
  const rects: MosaicBlockRect[] = [];

  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 2; bc++) {
      const idx = (br * 2 + bc) as 0 | 1 | 2 | 3 | 4 | 5;
      const fullW = MOSAIC_COL_WIDTHS[bc];
      const fullH = MOSAIC_ROW_HEIGHTS[br];
      rects.push({
        index: idx,
        x: colX[bc],
        y: rowY[br],
        width: disjoint ? fullW - 1 : fullW,
        height: disjoint ? fullH - 1 : fullH,
        on: visible && bits[idx] === 1,
      });
    }
  }
  return rects;
}

function rasterizeMosaicBlocks(rects: readonly MosaicBlockRect[]): Uint8Array {
  const out = new Uint8Array(CELL_HEIGHT_PX);
  for (const rect of rects) {
    if (!rect.on) continue;
    let xMask = 0;
    for (let dx = 0; dx < rect.width; dx++) {
      xMask |= 0x80 >> (rect.x + dx);
    }
    for (let dy = 0; dy < rect.height; dy++) {
      out[rect.y + dy] |= xMask;
    }
  }
  return out;
}

/**
 * Part (px, py) of an 8 x 10 glyph enlarged w x h times (w, h in {1, 2}): output pixel (x, y)
 * shows glyph pixel (floor((x + 8 px) / w), floor((y + 10 py) / h)) (nearest neighbour).
 */
export function scaleGlyphPart(glyph: Uint8Array, w: number, h: number, px: number, py: number): Uint8Array {
  const out = new Uint8Array(CELL_HEIGHT_PX);
  for (let y = 0; y < CELL_HEIGHT_PX; y++) {
    const src = glyph[Math.floor((y + py * CELL_HEIGHT_PX) / h)] ?? 0;
    let row = 0;
    for (let x = 0; x < CELL_WIDTH_PX; x++) {
      const sx = Math.floor((x + px * CELL_WIDTH_PX) / w);
      if (src & (0x80 >> sx)) row |= 0x80 >> x;
    }
    out[y] = row;
  }
  return out;
}

function clampColourIndex(idx: number): number {
  if (!Number.isFinite(idx)) return 0;
  return Math.max(0, Math.min(7, Math.trunc(idx)));
}

/**
 * Resolves a single `Cell` into its pixel-exact glyph bitmap or mosaic block geometry and RGB colours.
 */
export function resolveCellRender(
  cell: Cell,
  options?: RenderCellOptions,
): ResolvedCellRender {
  const palette = resolvePalette(options?.palette ?? 'couleur');
  const flashVisible = options?.flashVisible ?? true;
  const cursorHere = options?.cursorHere ?? false;

  const baseFg = palette[clampColourIndex(cell.fg)];
  const baseBg = palette[clampColourIndex(cell.bg)];

  // Error cell: hatched block (Deviation 5)
  if (cell.error) {
    const swap = cell.inverse && cell.set !== 'G1';
    const fgRgb = swap ? baseBg : baseFg;
    const bgRgb = swap ? baseFg : baseBg;
    const bitmap = cursorHere
      ? Uint8Array.from(ERROR_HATCH_GLYPH, (row) => row ^ 0xff)
      : ERROR_HATCH_GLYPH.slice();
    return { kind: 'error', fgRgb, bgRgb, bitmap };
  }

  // G1 mosaic cell (0x20..0x3F, 0x60..0x7F); inverse does NOT swap fg/bg in G1 (design.md)
  if (cell.set === 'G1' && isMosaicG1Code(cell.code)) {
    const blocksVisible = !cell.flash || flashVisible;
    const blocks = getMosaicBlockRects(cell.code, cell.disjoint, blocksVisible);
    const bitmap = rasterizeMosaicBlocks(blocks);
    if (cursorHere) {
      for (let y = 0; y < CELL_HEIGHT_PX; y++) {
        bitmap[y] ^= 0xff;
      }
    }
    return {
      kind: 'mosaic',
      fgRgb: baseFg,
      bgRgb: baseBg,
      disjoint: cell.disjoint,
      blocks,
      bitmap,
    };
  }

  // Alphanumeric G0 / G2 cell: inverse swaps fg and bg
  const fgRgb = cell.inverse ? baseBg : baseFg;
  const bgRgb = cell.inverse ? baseFg : baseBg;

  if (cell.flash && !flashVisible && !cursorHere) {
    return {
      kind: 'glyph',
      fgRgb,
      bgRgb,
      bitmap: EMPTY_BITMAP.slice(),
    };
  }

  const rawGlyph =
    cell.set === 'G2' && cell.accent !== undefined
      ? getAccentedGlyph(cell.accent, cell.code)
      : getAsciiGlyph(cell.code);

  const bitmap = cell.flash && !flashVisible ? new Uint8Array(CELL_HEIGHT_PX) : rawGlyph.slice();

  // In alphanumeric mode, ESC 0x5A (disjoint flag) enables underline on bottom scanline
  if (cell.disjoint && (!cell.flash || flashVisible)) {
    bitmap[CELL_HEIGHT_PX - 1] |= 0xff;
  }

  // Enlarged character (videotex task 8): this cell shows one part of the glyph scaled x2.
  if (cell.part !== undefined && (cell.doubleWidth || cell.doubleHeight)) {
    const scaled = scaleGlyphPart(bitmap, cell.doubleWidth ? 2 : 1, cell.doubleHeight ? 2 : 1, cell.part.x, cell.part.y);
    bitmap.set(scaled);
  }

  if (cursorHere) {
    for (let y = 0; y < CELL_HEIGHT_PX; y++) {
      bitmap[y] ^= 0xff;
    }
  }

  return { kind: 'glyph', fgRgb, bgRgb, bitmap };
}

/**
 * Blits a single cell at `(row, col)` into a `320 x 250` RGBA pixel buffer (`Uint8ClampedArray`).
 */
export function blitCellToRgba(
  rgba: Uint8ClampedArray,
  row: number,
  col: number,
  cell: Cell,
  options?: RenderCellOptions,
): void {
  if (row < 0 || row >= SCREEN_ROWS || col < 0 || col >= SCREEN_COLS) {
    return;
  }
  const resolved = resolveCellRender(cell, options);
  const { fgRgb, bgRgb, bitmap } = resolved;
  const baseX = col * CELL_WIDTH_PX;
  const baseY = row * CELL_HEIGHT_PX;

  for (let dy = 0; dy < CELL_HEIGHT_PX; dy++) {
    const rowBits = bitmap[dy];
    let pixelOffset = ((baseY + dy) * SCREEN_WIDTH_PX + baseX) * 4;
    for (let dx = 0; dx < CELL_WIDTH_PX; dx++) {
      const on = (rowBits & (0x80 >> dx)) !== 0;
      const rgb = on ? fgRgb : bgRgb;
      rgba[pixelOffset] = rgb[0];
      rgba[pixelOffset + 1] = rgb[1];
      rgba[pixelOffset + 2] = rgb[2];
      rgba[pixelOffset + 3] = 255;
      pixelOffset += 4;
    }
  }
}

/**
 * Rasterizes an entire 25x40 `Screen` into a `320 x 250` RGBA buffer (`Uint8ClampedArray`).
 */
export function renderScreenToRgba(
  screen: Screen,
  options?: Omit<RenderCellOptions, 'cursorHere'> & { target?: Uint8ClampedArray },
): Uint8ClampedArray {
  const out =
    options?.target && options.target.length === SCREEN_WIDTH_PX * SCREEN_HEIGHT_PX * 4
      ? options.target
      : new Uint8ClampedArray(SCREEN_WIDTH_PX * SCREEN_HEIGHT_PX * 4);

  const palette = options?.palette ?? 'couleur';
  const flashVisible = options?.flashVisible ?? true;

  for (let r = 0; r < SCREEN_ROWS; r++) {
    for (let c = 0; c < SCREEN_COLS; c++) {
      const cursorHere =
        screen.cursor.visible && screen.cursor.row === r && screen.cursor.col === c;
      blitCellToRgba(out, r, c, screen.rows[r][c], {
        palette,
        flashVisible,
        cursorHere,
      });
    }
  }
  return out;
}
