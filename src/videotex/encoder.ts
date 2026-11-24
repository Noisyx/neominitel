import {
  ACCENT_BY_CHAR,
  C0,
  COLOURS,
  ESC_CODES,
  PAGE_FIRST_ROW,
  PAGE_LAST_ROW,
  SCREEN_COLS,
  STATUS_ROW,
} from './codes';
import { bitmapToG1Grid } from './mosaic';
import {
  cellsEqual,
  createBlankCell,
  createBlankScreen,
  type Cell,
  type Screen,
} from './screen';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type SegmentSize = 'normal' | 'doubleHeight' | 'doubleWidth' | 'double';

export interface Segment {
  text: string;
  fg?: number;
  bg?: number;
  flash?: boolean;
  inverse?: boolean;
  size?: SegmentSize;
}

export interface PageRowSource {
  row: number;
  col?: number;
  segments: Segment[];
}

export interface MosaicSource {
  row: number;
  col: number;
  bitmap: string[];
  fg: number;
  bg: number;
}

export interface PageSource {
  id: string;
  status?: string;
  rows: PageRowSource[];
  mosaics?: MosaicSource[];
}

export type PageError =
  | { kind: 'row-too-long'; row: number; length: number }
  | { kind: 'too-many-rows' }
  | { kind: 'bad-bitmap'; reason: string };

export interface EncodeOptions {
  /** Enable REP (`0x12`) run-length compression for runs of >= 4 identical cells (default: true). */
  useRep?: boolean;
}

const TRANSLITERATION_MAP: Readonly<Record<string, string>> = {
  œ: 'oe',
  Œ: 'OE',
  æ: 'ae',
  Æ: 'AE',
  ß: 'ss',
  À: 'A',
  Á: 'A',
  Â: 'A',
  Ã: 'A',
  Ä: 'A',
  Å: 'A',
  á: 'a',
  ã: 'a',
  ä: 'a',
  å: 'a',
  Ç: 'C',
  È: 'E',
  É: 'E',
  Ê: 'E',
  Ë: 'E',
  Ì: 'I',
  Í: 'I',
  Î: 'I',
  Ï: 'I',
  ì: 'i',
  í: 'i',
  Ñ: 'N',
  ñ: 'n',
  Ò: 'O',
  Ó: 'O',
  Ô: 'O',
  Õ: 'O',
  Ö: 'O',
  ò: 'o',
  ó: 'o',
  õ: 'o',
  ö: 'o',
  Ù: 'U',
  Ú: 'U',
  Û: 'U',
  Ü: 'U',
  ú: 'u',
  ü: 'u',
  Ý: 'Y',
  Ÿ: 'Y',
  ý: 'y',
  ÿ: 'y',
  '«': '"',
  '»': '"',
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u02BC': "'",
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
  '\u2026': '...',
  '\u00A0': ' ',
  '\u202F': ' ',
  '\u2009': ' ',
  '€': 'EUR',
  '°': 'o',
  '×': 'x',
  '÷': '/',
  '±': '+/-',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '→': '->',
  '←': '<-',
};

interface EncodedGlyph {
  set: 'G0' | 'G2';
  code: number;
  accent?: number;
}

function transliterateUnsupportedChar(ch: string): string {
  const mapped = TRANSLITERATION_MAP[ch];
  if (mapped !== undefined) {
    return mapped;
  }
  const decomposed = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (decomposed.length > 0) {
    let ascii = '';
    for (const c of decomposed) {
      const cp = c.codePointAt(0) ?? 0;
      ascii += cp >= 0x20 && cp <= 0x7e ? c : '?';
    }
    return ascii;
  }
  return '?';
}

function textToGlyphs(
  text: string,
  rowLabel: number,
  warnings: string[],
): EncodedGlyph[] {
  const glyphs: EncodedGlyph[] = [];
  for (const ch of text) {
    const accentRule = ACCENT_BY_CHAR.get(ch);
    if (accentRule !== undefined) {
      glyphs.push({
        set: 'G2',
        code: accentRule.baseCode,
        accent: accentRule.diacritic,
      });
      continue;
    }

    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x20 && cp <= 0x7e) {
      glyphs.push({ set: 'G0', code: cp });
      continue;
    }

    const replacement = transliterateUnsupportedChar(ch);
    warnings.push(
      `Row ${rowLabel}: transliterated '${ch}' (U+${cp.toString(16).toUpperCase().padStart(4, '0')}) to '${replacement}'`,
    );
    for (const repChar of replacement) {
      const repCode = repChar.codePointAt(0) ?? 0x3f;
      glyphs.push({
        set: 'G0',
        code: repCode >= 0x20 && repCode <= 0x7e ? repCode : 0x3f,
      });
    }
  }
  return glyphs;
}

function isValidColour(c: number): boolean {
  return Number.isInteger(c) && c >= 0 && c <= 7;
}

function normalizeColour(c: number | undefined, fallback: number): number {
  if (c === undefined) {
    return fallback;
  }
  if (!Number.isFinite(c)) {
    return fallback;
  }
  return Math.max(0, Math.min(7, Math.trunc(c)));
}

function sizeFlags(size: SegmentSize | undefined): {
  doubleHeight: boolean;
  doubleWidth: boolean;
} {
  switch (size) {
    case 'doubleHeight':
      return { doubleHeight: true, doubleWidth: false };
    case 'doubleWidth':
      return { doubleHeight: false, doubleWidth: true };
    case 'double':
      return { doubleHeight: true, doubleWidth: true };
    default:
      return { doubleHeight: false, doubleWidth: false };
  }
}

function sizeEscCode(cell: Cell): number {
  if (cell.doubleHeight && cell.doubleWidth) {
    return ESC_CODES.SIZE_DOUBLE;
  }
  if (cell.doubleHeight) {
    return ESC_CODES.SIZE_DOUBLE_HEIGHT;
  }
  if (cell.doubleWidth) {
    return ESC_CODES.SIZE_DOUBLE_WIDTH;
  }
  return ESC_CODES.SIZE_NORMAL;
}

function isBackgroundDelimiterCell(cell: Cell): boolean {
  return cell.set === 'G1' || (cell.set === 'G0' && cell.code === 0x20);
}

const DEFAULT_BLANK_CELL: Cell = createBlankCell();

function isDefaultBlankCell(cell: Cell): boolean {
  return cellsEqual(cell, DEFAULT_BLANK_CELL);
}

/**
 * Resolves `PageSource` into the target 25x40 `Screen` (plus transliteration/delimiter warnings),
 * enforcing the Minitel background delimiter rule (Req 4.4 / Deviation 1) so that our decoder
 * and a strict STUM1B terminal produce identical cells.
 */
export function buildPageScreen(
  p: PageSource,
): Result<{ screen: Screen; warnings: string[] }, PageError> {
  if (p.rows.length > PAGE_LAST_ROW) {
    return { ok: false, error: { kind: 'too-many-rows' } };
  }

  for (const rowSpec of p.rows) {
    if (
      !Number.isInteger(rowSpec.row) ||
      rowSpec.row < PAGE_FIRST_ROW ||
      rowSpec.row > PAGE_LAST_ROW
    ) {
      return { ok: false, error: { kind: 'too-many-rows' } };
    }
  }

  const screen = createBlankScreen();
  const warnings: string[] = [];

  // 1. Lay out text rows (1..24)
  for (const rowSpec of p.rows) {
    const startCol1 = rowSpec.col ?? 1;
    if (!Number.isInteger(startCol1) || startCol1 < 1 || startCol1 > SCREEN_COLS) {
      return {
        ok: false,
        error: {
          kind: 'row-too-long',
          row: rowSpec.row,
          length: Math.max(SCREEN_COLS + 1, Math.abs(Math.trunc(startCol1))),
        },
      };
    }

    let cursorCol = startCol1 - 1;
    for (const seg of rowSpec.segments) {
      const glyphs = textToGlyphs(seg.text, rowSpec.row, warnings);
      if (cursorCol + glyphs.length > SCREEN_COLS) {
        // Finish counting remaining segments on this row entry to report full length
        let totalEndCol = cursorCol + glyphs.length;
        const segIdx = rowSpec.segments.indexOf(seg);
        for (let k = segIdx + 1; k < rowSpec.segments.length; k++) {
          totalEndCol += textToGlyphs(rowSpec.segments[k].text, rowSpec.row, []).length;
        }
        return {
          ok: false,
          error: { kind: 'row-too-long', row: rowSpec.row, length: totalEndCol },
        };
      }

      const fg = normalizeColour(seg.fg, COLOURS.WHITE);
      const bg = normalizeColour(seg.bg, COLOURS.BLACK);
      const flash = seg.flash ?? false;
      const inverse = seg.inverse ?? false;
      const { doubleHeight, doubleWidth } = sizeFlags(seg.size);

      for (const g of glyphs) {
        const cell: Cell = {
          code: g.code,
          set: g.set,
          fg,
          bg,
          flash,
          inverse,
          disjoint: false,
          doubleHeight,
          doubleWidth,
          error: false,
        };
        if (g.accent !== undefined) {
          cell.accent = g.accent;
        }
        screen.rows[rowSpec.row][cursorCol] = cell;
        cursorCol++;
      }
    }
  }

  // 2. Lay out mosaics (1..24)
  if (p.mosaics !== undefined) {
    for (const m of p.mosaics) {
      if (
        !Number.isInteger(m.row) ||
        m.row < PAGE_FIRST_ROW ||
        m.row > PAGE_LAST_ROW
      ) {
        return {
          ok: false,
          error: {
            kind: 'bad-bitmap',
            reason: `Mosaic row ${m.row} must be an integer in 1..24`,
          },
        };
      }
      if (!Number.isInteger(m.col) || m.col < 1 || m.col > SCREEN_COLS) {
        return {
          ok: false,
          error: {
            kind: 'bad-bitmap',
            reason: `Mosaic column ${m.col} must be an integer in 1..40`,
          },
        };
      }
      if (!isValidColour(m.fg) || !isValidColour(m.bg)) {
        return {
          ok: false,
          error: {
            kind: 'bad-bitmap',
            reason: `Mosaic fg (${m.fg}) and bg (${m.bg}) must be integers in 0..7`,
          },
        };
      }

      const gridResult = bitmapToG1Grid(m.bitmap);
      if (!gridResult.ok) {
        return gridResult;
      }

      const g1Grid = gridResult.value;
      const cellHeight = g1Grid.length;
      const cellWidth = g1Grid[0].length;

      if (m.row - 1 + cellHeight > PAGE_LAST_ROW) {
        return {
          ok: false,
          error: {
            kind: 'bad-bitmap',
            reason: `Mosaic at row ${m.row} with height ${cellHeight} cells overflows row 24`,
          },
        };
      }
      if (m.col - 1 + cellWidth > SCREEN_COLS) {
        return {
          ok: false,
          error: {
            kind: 'bad-bitmap',
            reason: `Mosaic at col ${m.col} with width ${cellWidth} cells overflows column 40`,
          },
        };
      }

      for (let dr = 0; dr < cellHeight; dr++) {
        for (let dc = 0; dc < cellWidth; dc++) {
          screen.rows[m.row + dr][m.col - 1 + dc] = {
            code: g1Grid[dr][dc],
            set: 'G1',
            fg: m.fg,
            bg: m.bg,
            flash: false,
            inverse: false,
            disjoint: false,
            doubleHeight: false,
            doubleWidth: false,
            error: false,
          };
        }
      }
    }
  }

  // 3. Lay out status row 0
  if (p.status !== undefined) {
    const statusGlyphs = textToGlyphs(p.status, STATUS_ROW, warnings);
    if (statusGlyphs.length > SCREEN_COLS) {
      return {
        ok: false,
        error: { kind: 'row-too-long', row: STATUS_ROW, length: statusGlyphs.length },
      };
    }
    for (let c = 0; c < statusGlyphs.length; c++) {
      const g = statusGlyphs[c];
      const cell: Cell = {
        code: g.code,
        set: g.set,
        fg: COLOURS.WHITE,
        bg: COLOURS.BLACK,
        flash: false,
        inverse: false,
        disjoint: false,
        doubleHeight: false,
        doubleWidth: false,
        error: false,
      };
      if (g.accent !== undefined) {
        cell.accent = g.accent;
      }
      screen.rows[STATUS_ROW][c] = cell;
    }
  }

  // 4. Enforce background-before-delimiter invariant (Req 4.4 / Deviation 1) on every row
  for (let r = 0; r <= PAGE_LAST_ROW; r++) {
    let activeBg: number = COLOURS.BLACK;
    let lastNonDefault = -1;
    for (let c = SCREEN_COLS - 1; c >= 0; c--) {
      if (!isDefaultBlankCell(screen.rows[r][c])) {
        lastNonDefault = c;
        break;
      }
    }
    if (lastNonDefault < 0) {
      continue;
    }

    let firstNonDefault = 0;
    for (let c = 0; c <= lastNonDefault; c++) {
      if (!isDefaultBlankCell(screen.rows[r][c])) {
        firstNonDefault = c;
        break;
      }
    }

    for (let c = firstNonDefault; c <= lastNonDefault; c++) {
      const cell = screen.rows[r][c];
      if (cell.bg !== activeBg) {
        if (isBackgroundDelimiterCell(cell)) {
          activeBg = cell.bg;
        } else {
          warnings.push(
            `Row ${r}, col ${c + 1}: background ${cell.bg} deferred until a space or mosaic delimiter`,
          );
          cell.bg = activeBg;
        }
      }
    }
  }

  return { ok: true, value: { screen, warnings } };
}

function emitSingleCell(out: number[], cell: Cell): void {
  if (cell.set === 'G2' && cell.accent !== undefined) {
    out.push(C0.SS2, cell.accent, cell.code);
  } else {
    out.push(cell.code);
  }
}

function emitRow(
  out: number[],
  rowIndex: number,
  cells: readonly Cell[],
  useRep: boolean,
): { endedAtLastCol: boolean } {
  let lastCol = -1;
  for (let c = SCREEN_COLS - 1; c >= 0; c--) {
    if (!isDefaultBlankCell(cells[c])) {
      lastCol = c;
      break;
    }
  }

  if (lastCol < 0) {
    // Empty row: still emit US(row, 1) and explicit default attributes (Design step 2)
    out.push(C0.US, 0x40 + rowIndex, 0x41);
    out.push(
      C0.SI,
      C0.ESC,
      ESC_CODES.FG_WHITE,
      C0.ESC,
      ESC_CODES.BG_BLACK,
      C0.ESC,
      ESC_CODES.STEADY,
      C0.ESC,
      ESC_CODES.NORMAL_VIDEO,
      C0.ESC,
      ESC_CODES.MOSAIC_CONTIGUOUS,
      C0.ESC,
      ESC_CODES.SIZE_NORMAL,
    );
    return { endedAtLastCol: false };
  }

  let firstCol = 0;
  for (let c = 0; c <= lastCol; c++) {
    if (!isDefaultBlankCell(cells[c])) {
      firstCol = c;
      break;
    }
  }

  const firstCell = cells[firstCol];
  let curSet: 'G0' | 'G1' = firstCell.set === 'G1' ? 'G1' : 'G0';
  let curFg = firstCell.fg;
  let curBg = isBackgroundDelimiterCell(firstCell) ? firstCell.bg : COLOURS.BLACK;
  let curFlash = firstCell.flash;
  let curInverse = firstCell.inverse;
  let curDisjoint = firstCell.disjoint;
  let curSizeCode = sizeEscCode(firstCell);

  // Position row with US(row, firstCol + 1) and emit every attribute explicitly
  out.push(C0.US, 0x40 + rowIndex, 0x40 + firstCol + 1);
  out.push(curSet === 'G1' ? C0.SO : C0.SI);
  out.push(C0.ESC, ESC_CODES.FG_BLACK + curFg);
  out.push(C0.ESC, ESC_CODES.BG_BLACK + curBg);
  out.push(C0.ESC, curFlash ? ESC_CODES.FLASH : ESC_CODES.STEADY);
  out.push(C0.ESC, curInverse ? ESC_CODES.INVERSE_VIDEO : ESC_CODES.NORMAL_VIDEO);
  out.push(
    C0.ESC,
    curDisjoint ? ESC_CODES.MOSAIC_DISJOINT : ESC_CODES.MOSAIC_CONTIGUOUS,
  );
  out.push(C0.ESC, curSizeCode);

  let c = firstCol;
  while (c <= lastCol) {
    const cell = cells[c];
    let runLen = 1;
    while (c + runLen <= lastCol && cellsEqual(cells[c + runLen], cell)) {
      runLen++;
    }

    const targetSet: 'G0' | 'G1' = cell.set === 'G1' ? 'G1' : 'G0';
    if (targetSet !== curSet) {
      out.push(targetSet === 'G1' ? C0.SO : C0.SI);
      curSet = targetSet;
    }
    if (cell.fg !== curFg) {
      out.push(C0.ESC, ESC_CODES.FG_BLACK + cell.fg);
      curFg = cell.fg;
    }
    if (cell.bg !== curBg && isBackgroundDelimiterCell(cell)) {
      out.push(C0.ESC, ESC_CODES.BG_BLACK + cell.bg);
      curBg = cell.bg;
    }
    if (cell.flash !== curFlash) {
      out.push(C0.ESC, cell.flash ? ESC_CODES.FLASH : ESC_CODES.STEADY);
      curFlash = cell.flash;
    }
    if (cell.inverse !== curInverse) {
      out.push(C0.ESC, cell.inverse ? ESC_CODES.INVERSE_VIDEO : ESC_CODES.NORMAL_VIDEO);
      curInverse = cell.inverse;
    }
    if (cell.disjoint !== curDisjoint) {
      out.push(
        C0.ESC,
        cell.disjoint ? ESC_CODES.MOSAIC_DISJOINT : ESC_CODES.MOSAIC_CONTIGUOUS,
      );
      curDisjoint = cell.disjoint;
    }
    const nextSizeCode = sizeEscCode(cell);
    if (nextSizeCode !== curSizeCode) {
      out.push(C0.ESC, nextSizeCode);
      curSizeCode = nextSizeCode;
    }

    if (useRep && runLen >= 4) {
      let remaining = runLen;
      while (remaining >= 4) {
        const chunk = Math.min(64, remaining);
        emitSingleCell(out, cell);
        out.push(C0.REP, 0x40 + (chunk - 1));
        remaining -= chunk;
      }
      for (let i = 0; i < remaining; i++) {
        emitSingleCell(out, cell);
      }
    } else {
      for (let i = 0; i < runLen; i++) {
        emitSingleCell(out, cell);
      }
    }

    c += runLen;
  }

  return { endedAtLastCol: lastCol === SCREEN_COLS - 1 };
}

/**
 * Encodes a `PageSource` into a robust 7-bit Videotex byte sequence starting with `FF` (`0x0C`).
 */
export function encodePage(
  p: PageSource,
  options?: EncodeOptions,
): Result<{ bytes: Uint8Array; warnings: string[] }, PageError> {
  const built = buildPageScreen(p);
  if (!built.ok) {
    return built;
  }

  const useRep = options?.useRep ?? true;
  const { screen, warnings } = built.value;
  const out: number[] = [C0.FF, C0.DC4];

  let row24Wrapped = false;
  for (let r = PAGE_FIRST_ROW; r <= PAGE_LAST_ROW; r++) {
    const res = emitRow(out, r, screen.rows[r], useRep);
    if (r === PAGE_LAST_ROW) {
      row24Wrapped = res.endedAtLastCol;
    }
  }

  if (p.status !== undefined) {
    if (row24Wrapped) {
      // Keep cursor on row 24 before emitting row 0 so a corrupted US on row 0 stays adjacent
      out.push(C0.VT);
    }
    emitRow(out, STATUS_ROW, screen.rows[STATUS_ROW], useRep);
  }

  return {
    ok: true,
    value: {
      bytes: Uint8Array.from(out),
      warnings,
    },
  };
}
