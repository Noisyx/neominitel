// 3615 LIBRE page editor model (neominitel-app task 16, requirement 11). Pure: no DOM.
// A draft is a full-page mosaic of 40 x 24 cells (80 x 72 blocks) plus text lines; a text line
// replaces the drawing on its row. The page can be sent by sound, exported as WAV (worker) or
// shared as a link holding its Videotex bytes in the URL fragment (no server).
import { C0, COLOURS, PAGE_FIRST_ROW, PAGE_LAST_ROW, SCREEN_COLS, encodePage, type MosaicCellChoice, type MosaicSource, type PageSource } from '../videotex';

export const LIBRE_PAGE_ID = 'libre/page';
export const LIBRE_GRID_COLS = SCREEN_COLS; // 40 cells = 80 blocks
export const LIBRE_GRID_ROWS = PAGE_LAST_ROW - PAGE_FIRST_ROW + 1; // 24 cells = 72 blocks
export const LIBRE_MAX_TEXT_LINES = 8;
/** Largest page accepted from a share link (bytes). */
export const LIBRE_MAX_SHARED_BYTES = 8192;
/** Fragment key of a share link: `#libre=<base64url bytes>`. */
export const LIBRE_SHARE_KEY = 'libre';

export type LibreBlocks = MosaicCellChoice['blocks'];

export interface LibreCell {
  fg: number;
  bg: number;
  blocks: LibreBlocks;
}

export interface LibreTextLine {
  /** Page row 1..24. */
  row: number;
  text: string;
  fg: number;
}

export interface LibreDraft {
  /** cells[r][c], r = row - 1. */
  cells: LibreCell[][];
  lines: LibreTextLine[];
}

function blankCell(): LibreCell {
  return { fg: COLOURS.WHITE, bg: COLOURS.BLACK, blocks: [0, 0, 0, 0, 0, 0] };
}

export function createBlankDraft(): LibreDraft {
  return {
    cells: Array.from({ length: LIBRE_GRID_ROWS }, () => Array.from({ length: LIBRE_GRID_COLS }, blankCell)),
    lines: [],
  };
}

function isColour(c: number): boolean {
  return Number.isInteger(c) && c >= 0 && c <= 7;
}

/**
 * Sets block (bx, by) of the 80 x 72 grid (0-based) on with colour `fg`, or off. Switching a block
 * on gives its cell the foreground `fg`; the cell's background is unchanged. Out-of-range input
 * returns the draft unchanged. Returns a new draft (the old one is not modified).
 */
export function setBlock(d: LibreDraft, bx: number, by: number, on: boolean, fg: number): LibreDraft {
  if (!Number.isInteger(bx) || !Number.isInteger(by) || bx < 0 || by < 0 || bx >= LIBRE_GRID_COLS * 2 || by >= LIBRE_GRID_ROWS * 3) return d;
  if (on && !isColour(fg)) return d;
  const r = Math.floor(by / 3);
  const c = Math.floor(bx / 2);
  const k = (by % 3) * 2 + (bx % 2);
  const old = d.cells[r][c];
  const blocks = [...old.blocks] as LibreBlocks;
  blocks[k] = on ? 1 : 0;
  const cell: LibreCell = { fg: on ? fg : old.fg, bg: old.bg, blocks };
  if (cell.blocks[k] === old.blocks[k] && cell.fg === old.fg) return d;
  const row = d.cells[r].slice();
  row[c] = cell;
  const cells = d.cells.slice();
  cells[r] = row;
  return { ...d, cells };
}

/** Fills the whole background of the drawing with colour `bg` (blocks unchanged). */
export function setBackground(d: LibreDraft, bg: number): LibreDraft {
  if (!isColour(bg)) return d;
  return { ...d, cells: d.cells.map((row) => row.map((cell) => ({ ...cell, bg }))) };
}

/**
 * Replaces the drawing with the cells of an image mosaic (`imageToMosaic(img, 40, 24)`), keeping
 * the text lines. A grid of another size is placed at the top left and clipped.
 */
export function applyImageCells(d: LibreDraft, cells: readonly (readonly MosaicCellChoice[])[]): LibreDraft {
  const next = createBlankDraft().cells;
  for (let r = 0; r < Math.min(LIBRE_GRID_ROWS, cells.length); r++) {
    for (let c = 0; c < Math.min(LIBRE_GRID_COLS, cells[r].length); c++) {
      const s = cells[r][c];
      next[r][c] = { fg: s.fg, bg: s.bg, blocks: [...s.blocks] as LibreBlocks };
    }
  }
  return { ...d, cells: next };
}

/**
 * Sets the text lines (at most LIBRE_MAX_TEXT_LINES; rows outside 1..24, empty texts and bad colours
 * are dropped; a later line replaces an earlier one on the same row; texts are cut to 40 columns).
 */
export function setTextLines(d: LibreDraft, lines: readonly LibreTextLine[]): LibreDraft {
  const byRow = new Map<number, LibreTextLine>();
  for (const l of lines) {
    if (!Number.isInteger(l.row) || l.row < PAGE_FIRST_ROW || l.row > PAGE_LAST_ROW) continue;
    if (!isColour(l.fg)) continue;
    const text = l.text.replace(/\s+$/, '').slice(0, SCREEN_COLS);
    if (text.length === 0) continue;
    byRow.set(l.row, { row: l.row, text, fg: l.fg });
  }
  const kept = [...byRow.values()].sort((a, b) => a.row - b.row).slice(0, LIBRE_MAX_TEXT_LINES);
  return { ...d, lines: kept };
}

function isBlank(cell: LibreCell): boolean {
  return cell.bg === COLOURS.BLACK && cell.blocks.every((b) => b === 0);
}

/**
 * The PageSource of a draft. Text rows: one segment at column 1. Other rows: one MosaicSource per
 * horizontal run of non-blank cells with the same (fg, bg); blank cells (black background, no
 * block on) are left to the cleared screen.
 */
export function draftToPageSource(d: LibreDraft): PageSource {
  const textRows = new Set(d.lines.map((l) => l.row));
  const mosaics: MosaicSource[] = [];
  for (let r = 0; r < LIBRE_GRID_ROWS; r++) {
    const row = r + PAGE_FIRST_ROW;
    if (textRows.has(row)) continue;
    let c = 0;
    while (c < LIBRE_GRID_COLS) {
      const cell = d.cells[r][c];
      if (isBlank(cell)) {
        c++;
        continue;
      }
      let end = c + 1;
      while (end < LIBRE_GRID_COLS && !isBlank(d.cells[r][end]) && d.cells[r][end].fg === cell.fg && d.cells[r][end].bg === cell.bg) end++;
      const lines = ['', '', ''];
      for (let k = c; k < end; k++) {
        const b = d.cells[r][k].blocks;
        for (let i = 0; i < 6; i++) lines[Math.floor(i / 2)] += b[i] ? '#' : '.';
      }
      mosaics.push({ row, col: c + 1, bitmap: lines, fg: cell.fg, bg: cell.bg });
      c = end;
    }
  }
  return {
    id: LIBRE_PAGE_ID,
    status: '3615 LIBRE              PAGE PERSONNELLE',
    rows: d.lines.map((l) => ({ row: l.row, col: 1, segments: [{ text: l.text, fg: l.fg }] })),
    mosaics,
  };
}

/** Videotex bytes of a draft, or null when the encoder rejects it. */
export function encodeDraft(d: LibreDraft): Uint8Array | null {
  const res = encodePage(draftToPageSource(d));
  return res.ok ? res.value.bytes : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

function fromBase64Url(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null;
  const vals: number[] = [];
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    vals.push(v);
  }
  const out: number[] = [];
  for (let i = 0; i < vals.length; i += 4) {
    const n = (vals[i] << 18) | ((vals[i + 1] ?? 0) << 12) | ((vals[i + 2] ?? 0) << 6) | (vals[i + 3] ?? 0);
    out.push((n >> 16) & 255);
    if (i + 2 < vals.length) out.push((n >> 8) & 255);
    if (i + 3 < vals.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

/** The URL fragment (without '#') that shares `bytes`: `libre=<base64url>`. */
export function encodeShareFragment(bytes: Uint8Array): string {
  return `${LIBRE_SHARE_KEY}=${toBase64Url(bytes)}`;
}

/**
 * The page bytes of a share fragment (with or without the leading '#'), or null when the fragment
 * has no `libre=` entry or its bytes are not a page: 1..8192 bytes, all 7-bit, starting with FF.
 */
export function decodeShareFragment(fragment: string): Uint8Array | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== LIBRE_SHARE_KEY) continue;
    const bytes = fromBase64Url(part.slice(eq + 1));
    if (!bytes || bytes.length === 0 || bytes.length > LIBRE_MAX_SHARED_BYTES) return null;
    if (bytes[0] !== C0.FF) return null;
    for (const b of bytes) if (b > 127) return null;
    return bytes;
  }
  return null;
}
