// Image to mosaic (videotex task 9, requirement 6.3, design.md "Mosaic from image"). Pure: no DOM.
// The caller decodes the image (canvas, file) into RGB or RGBA bytes; this module only computes.
import { COLOUR_PALETTE_RGB, PAGE_FIRST_ROW, PAGE_LAST_ROW, SCREEN_COLS } from './codes';
import type { MosaicSource } from './encoder';
import type { MosaicBitmapError, MosaicResult } from './mosaic';

/** An image in row-major order, 3 (RGB) or 4 (RGBA, alpha ignored) bytes per pixel. */
export interface RgbImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
  /** Bytes per pixel; default 4 when data.length = 4 * width * height, else 3. */
  channels?: 3 | 4;
}

export interface ImageMosaicOptions {
  /** Palette, 8 RGB entries indexed by Videotex colour code. Default: COLOUR_PALETTE_RGB. */
  palette?: readonly (readonly [number, number, number])[];
  /** Floyd-Steinberg error diffusion between cells (default false). */
  diffusion?: boolean;
  /** Screen position of the top-left cell, as in MosaicSource (row 1..24, col 1..40; defaults 1, 1). */
  row?: number;
  col?: number;
}

/** The decision for one 2x3 cell. */
export interface MosaicCellChoice {
  fg: number;
  bg: number;
  /** b1..b6 (top-left to bottom-right): 1 = foreground. */
  blocks: [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1];
  /** Squared RGB error of the cell, summed over its six blocks (after diffusion, if on). */
  error: number;
}

export interface ImageMosaic {
  /** cells[r][c], rows x cols cells. */
  cells: MosaicCellChoice[][];
  /** Sum of the cell errors. */
  totalError: number;
  /** One MosaicSource per horizontal run of cells with the same colours, ready for a PageSource. */
  sources: MosaicSource[];
}

function bad(reason: string): { ok: false; error: MosaicBitmapError } {
  return { ok: false, error: { kind: 'bad-bitmap', reason } };
}

function channelsOf(img: RgbImage): number {
  if (img.channels !== undefined) return img.channels;
  return img.data.length === 4 * img.width * img.height ? 4 : 3;
}

function checkImage(img: RgbImage): string | null {
  if (!img || !Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width <= 0 || img.height <= 0) {
    return 'Image width and height must be positive integers';
  }
  const ch = channelsOf(img);
  if (ch !== 3 && ch !== 4) return 'Image channels must be 3 or 4';
  if (!img.data || img.data.length < ch * img.width * img.height) return `Image data must hold ${ch} bytes per pixel`;
  return null;
}

/**
 * Box-filter resampling of an image to `blocksWide` x `blocksHigh` blocks (one RGB triple per
 * block, as a Float64Array of 3 values per block, row-major). Each block is the mean of the source
 * pixels it covers, with fractional coverage at its edges, so any source size works.
 */
export function resampleToBlocks(img: RgbImage, blocksWide: number, blocksHigh: number): MosaicResult<Float64Array> {
  const problem = checkImage(img);
  if (problem) return bad(problem);
  if (!Number.isInteger(blocksWide) || !Number.isInteger(blocksHigh) || blocksWide <= 0 || blocksHigh <= 0) {
    return bad('Block grid size must be positive integers');
  }
  const ch = channelsOf(img);
  const out = new Float64Array(blocksWide * blocksHigh * 3);
  const sx = img.width / blocksWide;
  const sy = img.height / blocksHigh;
  for (let by = 0; by < blocksHigh; by++) {
    const y0 = by * sy;
    const y1 = y0 + sy;
    for (let bx = 0; bx < blocksWide; bx++) {
      const x0 = bx * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (let py = Math.floor(y0); py < Math.ceil(y1) && py < img.height; py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        if (wy <= 0) continue;
        for (let px = Math.floor(x0); px < Math.ceil(x1) && px < img.width; px++) {
          const wx = Math.min(x1, px + 1) - Math.max(x0, px);
          if (wx <= 0) continue;
          const k = wx * wy;
          const i = (py * img.width + px) * ch;
          r += k * img.data[i];
          g += k * img.data[i + 1];
          b += k * img.data[i + 2];
          w += k;
        }
      }
      const o = (by * blocksWide + bx) * 3;
      out[o] = r / w;
      out[o + 1] = g / w;
      out[o + 2] = b / w;
    }
  }
  return { ok: true, value: out };
}

/**
 * Converts an image to a mosaic of `cols` x `rows` cells (2 x 3 blocks each).
 *
 * The image is first resampled to 2·cols x 3·rows blocks (`resampleToBlocks`). Then, for each cell
 * in raster order, every candidate is tried: the 28 pairs of distinct palette colours (fg < bg by
 * colour code) and the 8 single colours. For a pair, each block takes the nearer colour (squared
 * RGB distance; a tie goes to the background). The candidate with the lowest summed squared error
 * wins; ties keep the first candidate in the order singles 0..7, then pairs (0,1), (0,2) .. (6,7).
 * A single colour c is written as fg = bg = c with every block off.
 *
 * With `diffusion`, the residual of each block (value - chosen colour) is spread with the
 * Floyd-Steinberg weights 7/16 (right), 3/16 (down-left), 5/16 (down), 1/16 (down-right) to the
 * blocks of cells not yet decided; the weights that would fall inside decided cells or outside
 * the image are dropped and the others renormalised. Without it, each cell is optimal on its own.
 *
 * Limits: 1..40 cols and 1..24 rows (the page area), and the grid must fit at (row, col).
 * Deterministic.
 */
export function imageToMosaic(img: RgbImage, cols: number, rows: number, options: ImageMosaicOptions = {}): MosaicResult<ImageMosaic> {
  const row0 = options.row ?? PAGE_FIRST_ROW;
  const col0 = options.col ?? 1;
  const pageRows = PAGE_LAST_ROW - PAGE_FIRST_ROW + 1;
  if (!Number.isInteger(cols) || cols < 1 || cols > SCREEN_COLS) return bad(`cols must be an integer in 1..${SCREEN_COLS}`);
  if (!Number.isInteger(rows) || rows < 1 || rows > pageRows) return bad(`rows must be an integer in 1..${pageRows}`);
  if (!Number.isInteger(row0) || row0 < PAGE_FIRST_ROW || row0 + rows - 1 > PAGE_LAST_ROW) return bad('The grid does not fit in the page rows');
  if (!Number.isInteger(col0) || col0 < 1 || col0 - 1 + cols > SCREEN_COLS) return bad('The grid does not fit in the page columns');
  const palette = options.palette ?? COLOUR_PALETTE_RGB;
  if (palette.length !== 8) return bad('The palette must have 8 colours');

  const bw = cols * 2;
  const bh = rows * 3;
  const resampled = resampleToBlocks(img, bw, bh);
  if (!resampled.ok) return resampled;
  const v = resampled.value; // modified in place by diffusion

  // Candidates: singles first, then pairs.
  const candidates: [number, number][] = [];
  for (let c = 0; c < 8; c++) candidates.push([c, c]);
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) candidates.push([a, b]);

  const dist = (o: number, c: number): number => {
    const p = palette[c];
    const dr = v[o] - p[0];
    const dg = v[o + 1] - p[1];
    const db = v[o + 2] - p[2];
    return dr * dr + dg * dg + db * db;
  };

  const cells: MosaicCellChoice[][] = [];
  let totalError = 0;
  const blockOffsets = new Array<number>(6);
  const decided = (bx: number, by: number, cr: number, cc: number): boolean => {
    const r = Math.floor(by / 3);
    const c = Math.floor(bx / 2);
    return r < cr || (r === cr && c <= cc);
  };

  for (let cr = 0; cr < rows; cr++) {
    const line: MosaicCellChoice[] = [];
    for (let cc = 0; cc < cols; cc++) {
      // Block order b1..b6: (0,0) (1,0) (0,1) (1,1) (0,2) (1,2) inside the cell.
      for (let k = 0; k < 6; k++) {
        const bx = cc * 2 + (k % 2);
        const by = cr * 3 + Math.floor(k / 2);
        blockOffsets[k] = (by * bw + bx) * 3;
      }
      let best = 0;
      let bestErr = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const [fg, bg] = candidates[i];
        let e = 0;
        for (let k = 0; k < 6; k++) e += Math.min(dist(blockOffsets[k], fg), dist(blockOffsets[k], bg));
        if (e < bestErr) {
          bestErr = e;
          best = i;
        }
      }
      const [fg, bg] = candidates[best];
      const blocks: MosaicCellChoice['blocks'] = [0, 0, 0, 0, 0, 0];
      let cellErr = 0;
      for (let k = 0; k < 6; k++) {
        const o = blockOffsets[k];
        const on = fg !== bg && dist(o, fg) < dist(o, bg);
        blocks[k] = on ? 1 : 0;
        const chosen = on ? fg : bg;
        cellErr += dist(o, chosen);
        if (options.diffusion) {
          const bx = cc * 2 + (k % 2);
          const by = cr * 3 + Math.floor(k / 2);
          const p = palette[chosen];
          const res = [v[o] - p[0], v[o + 1] - p[1], v[o + 2] - p[2]];
          const targets: [number, number, number][] = [
            [bx + 1, by, 7],
            [bx - 1, by + 1, 3],
            [bx, by + 1, 5],
            [bx + 1, by + 1, 1],
          ];
          const valid = targets.filter(([x, y]) => x >= 0 && x < bw && y < bh && !decided(x, y, cr, cc));
          const wsum = valid.reduce((s, t) => s + t[2], 0);
          for (const [x, y, wt] of valid) {
            const t = (y * bw + x) * 3;
            for (let j = 0; j < 3; j++) v[t + j] += (res[j] * wt) / wsum;
          }
        }
      }
      totalError += cellErr;
      line.push({ fg, bg, blocks, error: cellErr });
    }
    cells.push(line);
  }

  // Horizontal runs with the same colours become one MosaicSource each.
  const sources: MosaicSource[] = [];
  for (let cr = 0; cr < rows; cr++) {
    let start = 0;
    while (start < cols) {
      const { fg, bg } = cells[cr][start];
      let end = start + 1;
      while (end < cols && cells[cr][end].fg === fg && cells[cr][end].bg === bg) end++;
      const lines = ['', '', ''];
      for (let cc = start; cc < end; cc++) {
        const b = cells[cr][cc].blocks;
        for (let k = 0; k < 6; k++) lines[Math.floor(k / 2)] += b[k] ? '#' : '.';
      }
      sources.push({ row: row0 + cr, col: col0 + start, bitmap: lines, fg, bg });
      start = end;
    }
  }
  return { ok: true, value: { cells, totalError, sources } };
}
