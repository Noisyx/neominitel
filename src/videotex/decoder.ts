import {
  C0,
  composeG2Accent,
  ESC_CODES,
  G2_DIACRITIC_NAME_BY_CODE,
  isMosaicG1Code,
  PAGE_FIRST_ROW,
  PAGE_LAST_ROW,
  SCREEN_COLS,
  SCREEN_ROWS,
  STATUS_ROW,
} from './codes';
import {
  cloneCell,
  cloneScreen,
  createBlankCell,
  createBlankScreen,
  createDefaultAttributes,
  type Cell,
  type Screen,
} from './screen';

export interface RxByte {
  value: number;
  error: boolean; // true on parity or framing error
}

export interface DecoderStats {
  bytes: number;
  printable: number;
  controls: number;
  unknown: number;
  errorCells: number;
}

export interface VideotexDecoder {
  push(b: RxByte): { changed: [row: number, col: number][] };
  pushMany(bytes: Iterable<RxByte | number>): { changed: [row: number, col: number][] };
  cellAt(row: number, col: number): Cell;
  screen(): Screen;
  stats(): DecoderStats;
  reset(): void;
}

type DecoderState =
  | { kind: 'NORMAL' }
  | { kind: 'ESC' }
  | { kind: 'ESC_PARAMS'; remaining: number }
  | { kind: 'CSI' }
  | { kind: 'US_ROW' }
  | { kind: 'US_COL'; rowByte: number }
  | { kind: 'REP_COUNT' }
  | { kind: 'SS2_1' }
  | { kind: 'SS2_2'; diacritic: number }
  | { kind: 'SEP_KEY' };

export function createVideotexDecoder(): VideotexDecoder {
  let currentScreen: Screen = createBlankScreen();
  let state: DecoderState = { kind: 'NORMAL' };
  let lastPrintedCell: Cell | null = null;
  let currentStats: DecoderStats = {
    bytes: 0,
    printable: 0,
    controls: 0,
    unknown: 0,
    errorCells: 0,
  };

  function clampCursor(): void {
    if (currentScreen.cursor.row < 0 || currentScreen.cursor.row >= SCREEN_ROWS) {
      currentScreen.cursor.row = PAGE_FIRST_ROW;
    }
    if (currentScreen.cursor.col < 0 || currentScreen.cursor.col >= SCREEN_COLS) {
      currentScreen.cursor.col = 0;
    }
  }

  function advanceCursor(): void {
    clampCursor();
    if (currentScreen.cursor.col < SCREEN_COLS - 1) {
      currentScreen.cursor.col++;
    } else {
      currentScreen.cursor.col = 0;
      if (currentScreen.cursor.row === STATUS_ROW) {
        currentScreen.cursor.row = PAGE_FIRST_ROW;
      } else if (currentScreen.cursor.row < PAGE_LAST_ROW) {
        currentScreen.cursor.row++;
      } else {
        currentScreen.cursor.row = PAGE_FIRST_ROW;
      }
    }
  }

  function writeCellAtCursor(
    cell: Cell,
    changed: [row: number, col: number][],
  ): void {
    clampCursor();
    const { row, col } = currentScreen.cursor;
    currentScreen.rows[row][col] = cloneCell(cell);
    changed.push([row, col]);
    advanceCursor();
  }

  function handleC0(val: number, changed: [row: number, col: number][]): void {
    switch (val) {
      case C0.BEL: {
        currentStats.controls++;
        break;
      }
      case C0.BS: {
        currentStats.controls++;
        lastPrintedCell = null;
        if (currentScreen.cursor.col > 0) {
          currentScreen.cursor.col--;
        } else {
          currentScreen.cursor.col = SCREEN_COLS - 1;
          if (currentScreen.cursor.row === STATUS_ROW) {
            currentScreen.cursor.row = STATUS_ROW;
          } else if (currentScreen.cursor.row === PAGE_FIRST_ROW) {
            currentScreen.cursor.row = PAGE_LAST_ROW;
          } else {
            currentScreen.cursor.row--;
          }
        }
        break;
      }
      case C0.HT: {
        currentStats.controls++;
        lastPrintedCell = null;
        advanceCursor();
        break;
      }
      case C0.LF: {
        currentStats.controls++;
        lastPrintedCell = null;
        if (currentScreen.cursor.row === STATUS_ROW) {
          currentScreen.cursor.row = PAGE_FIRST_ROW;
          currentScreen.cursor.col = 0;
        } else if (currentScreen.cursor.row >= PAGE_LAST_ROW) {
          currentScreen.cursor.row = PAGE_FIRST_ROW;
        } else {
          currentScreen.cursor.row++;
        }
        break;
      }
      case C0.VT: {
        currentStats.controls++;
        lastPrintedCell = null;
        if (currentScreen.cursor.row === STATUS_ROW) {
          currentScreen.cursor.row = STATUS_ROW;
        } else if (currentScreen.cursor.row <= PAGE_FIRST_ROW) {
          currentScreen.cursor.row = PAGE_LAST_ROW;
        } else {
          currentScreen.cursor.row--;
        }
        break;
      }
      case C0.FF: {
        currentStats.controls++;
        lastPrintedCell = null;
        for (let r = PAGE_FIRST_ROW; r <= PAGE_LAST_ROW; r++) {
          for (let c = 0; c < SCREEN_COLS; c++) {
            currentScreen.rows[r][c] = createBlankCell();
            changed.push([r, c]);
          }
        }
        currentScreen.cursor.row = PAGE_FIRST_ROW;
        currentScreen.cursor.col = 0;
        currentScreen.attrs = createDefaultAttributes();
        break;
      }
      case C0.CR: {
        currentStats.controls++;
        lastPrintedCell = null;
        currentScreen.cursor.col = 0;
        break;
      }
      case C0.SO: {
        currentStats.controls++;
        lastPrintedCell = null;
        currentScreen.attrs.set = 'G1';
        break;
      }
      case C0.SI: {
        currentStats.controls++;
        lastPrintedCell = null;
        currentScreen.attrs.set = 'G0';
        break;
      }
      case C0.DC1: {
        currentStats.controls++;
        currentScreen.cursor.visible = true;
        break;
      }
      case C0.DC4: {
        currentStats.controls++;
        currentScreen.cursor.visible = false;
        break;
      }
      case C0.REP: {
        state = { kind: 'REP_COUNT' };
        break;
      }
      case C0.SEP: {
        state = { kind: 'SEP_KEY' };
        break;
      }
      case C0.CAN: {
        currentStats.controls++;
        lastPrintedCell = null;
        const r = currentScreen.cursor.row;
        for (let c = currentScreen.cursor.col; c < SCREEN_COLS; c++) {
          currentScreen.rows[r][c] = createBlankCell({
            fg: currentScreen.attrs.fg,
            bg: currentScreen.attrs.bg,
          });
          changed.push([r, c]);
        }
        break;
      }
      case C0.SS2: {
        state = { kind: 'SS2_1' };
        break;
      }
      case C0.ESC: {
        state = { kind: 'ESC' };
        break;
      }
      case C0.RS: {
        currentStats.controls++;
        lastPrintedCell = null;
        currentScreen.cursor.row = PAGE_FIRST_ROW;
        currentScreen.cursor.col = 0;
        currentScreen.attrs = createDefaultAttributes();
        break;
      }
      case C0.US: {
        state = { kind: 'US_ROW' };
        break;
      }
      default: {
        currentStats.unknown++;
        break;
      }
    }
  }

  function handleEsc(val: number): void {
    if (val >= ESC_CODES.FG_BLACK && val <= ESC_CODES.FG_WHITE) {
      currentStats.controls++;
      currentScreen.attrs.fg = val - ESC_CODES.FG_BLACK;
      state = { kind: 'NORMAL' };
      return;
    }
    if (val >= ESC_CODES.BG_BLACK && val <= ESC_CODES.BG_WHITE) {
      currentStats.controls++;
      currentScreen.attrs.bg = val - ESC_CODES.BG_BLACK;
      state = { kind: 'NORMAL' };
      return;
    }
    switch (val) {
      case ESC_CODES.FLASH:
        currentStats.controls++;
        currentScreen.attrs.flash = true;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.STEADY:
        currentStats.controls++;
        currentScreen.attrs.flash = false;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.SIZE_NORMAL:
        currentStats.controls++;
        currentScreen.attrs.doubleHeight = false;
        currentScreen.attrs.doubleWidth = false;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.SIZE_DOUBLE_HEIGHT:
        currentStats.controls++;
        currentScreen.attrs.doubleHeight = true;
        currentScreen.attrs.doubleWidth = false;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.SIZE_DOUBLE_WIDTH:
        currentStats.controls++;
        currentScreen.attrs.doubleHeight = false;
        currentScreen.attrs.doubleWidth = true;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.SIZE_DOUBLE:
        currentStats.controls++;
        currentScreen.attrs.doubleHeight = true;
        currentScreen.attrs.doubleWidth = true;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.MOSAIC_CONTIGUOUS:
        currentStats.controls++;
        currentScreen.attrs.disjoint = false;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.MOSAIC_DISJOINT:
        currentStats.controls++;
        currentScreen.attrs.disjoint = true;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.NORMAL_VIDEO:
        currentStats.controls++;
        currentScreen.attrs.inverse = false;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.INVERSE_VIDEO:
        currentStats.controls++;
        currentScreen.attrs.inverse = true;
        state = { kind: 'NORMAL' };
        break;
      case ESC_CODES.PRO1:
        currentStats.controls++;
        state = { kind: 'ESC_PARAMS', remaining: 1 };
        break;
      case ESC_CODES.PRO2:
        currentStats.controls++;
        state = { kind: 'ESC_PARAMS', remaining: 2 };
        break;
      case ESC_CODES.PRO3:
        currentStats.controls++;
        state = { kind: 'ESC_PARAMS', remaining: 3 };
        break;
      case ESC_CODES.CSI:
        currentStats.controls++;
        state = { kind: 'CSI' };
        break;
      default:
        currentStats.unknown++;
        state = { kind: 'NORMAL' };
        break;
    }
  }

  function push(b: RxByte): { changed: [row: number, col: number][] } {
    const changed: [row: number, col: number][] = [];
    currentStats.bytes++;

    const val = b.value & 0x7f;

    if (b.error) {
      currentStats.errorCells++;
      state = { kind: 'NORMAL' };
      lastPrintedCell = null;
      const errCell: Cell = {
        code: val >= 0x20 ? val : 0x20,
        set: currentScreen.attrs.set,
        fg: currentScreen.attrs.fg,
        bg: currentScreen.attrs.bg,
        flash: currentScreen.attrs.flash,
        inverse: currentScreen.attrs.inverse,
        disjoint: currentScreen.attrs.disjoint,
        doubleHeight: currentScreen.attrs.doubleHeight,
        doubleWidth: currentScreen.attrs.doubleWidth,
        error: true,
      };
      writeCellAtCursor(errCell, changed);
      return { changed };
    }

    switch (state.kind) {
      case 'NORMAL': {
        if (val < 0x20) {
          handleC0(val, changed);
        } else {
          // Printable character (0x20..0x7F)
          currentStats.printable++;
          const effectiveSet =
            currentScreen.attrs.set === 'G1' && !isMosaicG1Code(val)
              ? 'G0'
              : currentScreen.attrs.set;
          const cell: Cell = {
            code: val,
            set: effectiveSet,
            fg: currentScreen.attrs.fg,
            bg: currentScreen.attrs.bg,
            flash: currentScreen.attrs.flash,
            inverse: currentScreen.attrs.inverse,
            disjoint: currentScreen.attrs.disjoint,
            doubleHeight: currentScreen.attrs.doubleHeight,
            doubleWidth: currentScreen.attrs.doubleWidth,
            error: false,
          };
          lastPrintedCell = cloneCell(cell);
          writeCellAtCursor(cell, changed);
        }
        break;
      }

      case 'ESC': {
        handleEsc(val);
        break;
      }

      case 'ESC_PARAMS': {
        const nextRemaining = state.remaining - 1;
        state =
          nextRemaining > 0
            ? { kind: 'ESC_PARAMS', remaining: nextRemaining }
            : { kind: 'NORMAL' };
        break;
      }

      case 'CSI': {
        if (val >= 0x40 && val <= 0x7e) {
          state = { kind: 'NORMAL' };
        } else if (val < 0x20) {
          // Abort malformed CSI on unexpected C0 control
          currentStats.unknown++;
          state = { kind: 'NORMAL' };
        }
        break;
      }

      case 'US_ROW': {
        state = { kind: 'US_COL', rowByte: val };
        break;
      }

      case 'US_COL': {
        const r = state.rowByte - 0x40;
        const c = val - 0x40;
        state = { kind: 'NORMAL' };
        if (r >= 0 && r < SCREEN_ROWS && c >= 1 && c <= SCREEN_COLS) {
          currentStats.controls++;
          currentScreen.cursor.row = r;
          currentScreen.cursor.col = c - 1;
          currentScreen.attrs = createDefaultAttributes();
          lastPrintedCell = null;
        } else {
          currentStats.unknown++;
        }
        break;
      }

      case 'REP_COUNT': {
        state = { kind: 'NORMAL' };
        const n = val - 0x40;
        if (n >= 1 && n <= 63) {
          currentStats.controls++;
          if (lastPrintedCell !== null) {
            for (let i = 0; i < n; i++) {
              writeCellAtCursor(lastPrintedCell, changed);
            }
          }
        } else {
          currentStats.unknown++;
        }
        break;
      }

      case 'SS2_1': {
        if (G2_DIACRITIC_NAME_BY_CODE.has(val)) {
          state = { kind: 'SS2_2', diacritic: val };
        } else {
          currentStats.unknown++;
          state = { kind: 'NORMAL' };
        }
        break;
      }

      case 'SS2_2': {
        const diacritic = state.diacritic;
        state = { kind: 'NORMAL' };
        const composed = composeG2Accent(diacritic, val);
        if (composed !== null) {
          currentStats.controls++;
          currentStats.printable++;
          const cell: Cell = {
            code: val,
            set: 'G2',
            accent: diacritic,
            fg: currentScreen.attrs.fg,
            bg: currentScreen.attrs.bg,
            flash: currentScreen.attrs.flash,
            inverse: currentScreen.attrs.inverse,
            disjoint: currentScreen.attrs.disjoint,
            doubleHeight: currentScreen.attrs.doubleHeight,
            doubleWidth: currentScreen.attrs.doubleWidth,
            error: false,
          };
          lastPrintedCell = cloneCell(cell);
          writeCellAtCursor(cell, changed);
        } else {
          currentStats.unknown++;
        }
        break;
      }

      case 'SEP_KEY': {
        // Function key sequences are ignored on the forward channel
        currentStats.controls++;
        state = { kind: 'NORMAL' };
        break;
      }
    }

    clampCursor();
    return { changed };
  }

  function pushMany(
    bytes: Iterable<RxByte | number>,
  ): { changed: [row: number, col: number][] } {
    const allChanged: [row: number, col: number][] = [];
    for (const item of bytes) {
      const rx: RxByte =
        typeof item === 'number' ? { value: item, error: false } : item;
      const { changed } = push(rx);
      allChanged.push(...changed);
    }
    return { changed: allChanged };
  }

  return {
    push,
    pushMany,
    cellAt(row: number, col: number): Cell {
      if (row < 0 || row >= SCREEN_ROWS || col < 0 || col >= SCREEN_COLS) {
        return createBlankCell();
      }
      return cloneCell(currentScreen.rows[row][col]);
    },
    screen(): Screen {
      return cloneScreen(currentScreen);
    },
    stats(): DecoderStats {
      return { ...currentStats };
    },
    reset(): void {
      currentScreen = createBlankScreen();
      state = { kind: 'NORMAL' };
      lastPrintedCell = null;
      currentStats = {
        bytes: 0,
        printable: 0,
        controls: 0,
        unknown: 0,
        errorCells: 0,
      };
    },
  };
}

/**
 * Convenience helper to decode an entire sequence of bytes or `RxByte`s in one call.
 */
export function decodeBytes(
  bytes: Uint8Array | readonly (RxByte | number)[],
): Screen {
  const decoder = createVideotexDecoder();
  if (bytes instanceof Uint8Array) {
    for (let i = 0; i < bytes.length; i++) {
      decoder.push({ value: bytes[i], error: false });
    }
  } else {
    decoder.pushMany(bytes);
  }
  return decoder.screen();
}
