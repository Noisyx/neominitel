import { COLOURS, composeG2Accent, SCREEN_COLS, SCREEN_ROWS } from './codes';

export type CharSet = 'G0' | 'G1' | 'G2';

export interface Cell {
  code: number;
  set: CharSet;
  accent?: number; // G2 diacritic byte when set === 'G2'
  fg: number;
  bg: number;
  flash: boolean;
  inverse: boolean;
  disjoint: boolean;
  doubleHeight: boolean;
  doubleWidth: boolean;
  error: boolean;
}

export type SerialAttributes = Omit<Cell, 'code' | 'accent' | 'error'>;

export interface CursorState {
  /** 0-indexed row in 0..24 (0 = status row, 1..24 = page rows). */
  row: number;
  /** 0-indexed column in 0..39 (corresponding to Minitel columns 1..40). */
  col: number;
  visible: boolean;
}

export interface Screen {
  rows: Cell[][]; // 25 × 40, rows[0] = status row
  cursor: CursorState;
  attrs: SerialAttributes;
}

export function createDefaultAttributes(): SerialAttributes {
  return {
    set: 'G0',
    fg: COLOURS.WHITE,
    bg: COLOURS.BLACK,
    flash: false,
    inverse: false,
    disjoint: false,
    doubleHeight: false,
    doubleWidth: false,
  };
}

export function createBlankCell(overrides?: Partial<Cell>): Cell {
  const cell: Cell = {
    code: 0x20,
    set: 'G0',
    fg: COLOURS.WHITE,
    bg: COLOURS.BLACK,
    flash: false,
    inverse: false,
    disjoint: false,
    doubleHeight: false,
    doubleWidth: false,
    error: false,
    ...overrides,
  };
  if (cell.accent === undefined) {
    delete cell.accent;
  }
  return cell;
}

export function createBlankScreen(): Screen {
  const rows: Cell[][] = [];
  for (let r = 0; r < SCREEN_ROWS; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < SCREEN_COLS; c++) {
      row.push(createBlankCell());
    }
    rows.push(row);
  }
  return {
    rows,
    cursor: { row: 1, col: 0, visible: false },
    attrs: createDefaultAttributes(),
  };
}

export function cloneCell(cell: Cell): Cell {
  const copy: Cell = {
    code: cell.code,
    set: cell.set,
    fg: cell.fg,
    bg: cell.bg,
    flash: cell.flash,
    inverse: cell.inverse,
    disjoint: cell.disjoint,
    doubleHeight: cell.doubleHeight,
    doubleWidth: cell.doubleWidth,
    error: cell.error,
  };
  if (cell.accent !== undefined) {
    copy.accent = cell.accent;
  }
  return copy;
}

export function cloneScreen(screen: Screen): Screen {
  return {
    rows: screen.rows.map((row) => row.map(cloneCell)),
    cursor: { ...screen.cursor },
    attrs: { ...screen.attrs },
  };
}

export function cellsEqual(a: Cell, b: Cell, ignoreError = false): boolean {
  if (!ignoreError && a.error !== b.error) {
    return false;
  }
  return (
    a.code === b.code &&
    a.set === b.set &&
    (a.accent ?? undefined) === (b.accent ?? undefined) &&
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.flash === b.flash &&
    a.inverse === b.inverse &&
    a.disjoint === b.disjoint &&
    a.doubleHeight === b.doubleHeight &&
    a.doubleWidth === b.doubleWidth
  );
}

export function screensEqual(
  a: Screen,
  b: Screen,
  options?: { includeCursorAndAttrs?: boolean },
): boolean {
  if (a.rows.length !== b.rows.length) {
    return false;
  }
  for (let r = 0; r < a.rows.length; r++) {
    if (a.rows[r].length !== b.rows[r].length) {
      return false;
    }
    for (let c = 0; c < a.rows[r].length; c++) {
      if (!cellsEqual(a.rows[r][c], b.rows[r][c])) {
        return false;
      }
    }
  }
  if (options?.includeCursorAndAttrs) {
    if (
      a.cursor.row !== b.cursor.row ||
      a.cursor.col !== b.cursor.col ||
      a.cursor.visible !== b.cursor.visible
    ) {
      return false;
    }
    const aa = a.attrs;
    const ba = b.attrs;
    if (
      aa.set !== ba.set ||
      aa.fg !== ba.fg ||
      aa.bg !== ba.bg ||
      aa.flash !== ba.flash ||
      aa.inverse !== ba.inverse ||
      aa.disjoint !== ba.disjoint ||
      aa.doubleHeight !== ba.doubleHeight ||
      aa.doubleWidth !== ba.doubleWidth
    ) {
      return false;
    }
  }
  return true;
}

export function serializeCellKey(cell: Cell, ignoreError = true): string {
  return [
    cell.code,
    cell.set,
    cell.accent ?? -1,
    cell.fg,
    cell.bg,
    cell.flash ? 1 : 0,
    cell.inverse ? 1 : 0,
    cell.disjoint ? 1 : 0,
    cell.doubleHeight ? 1 : 0,
    cell.doubleWidth ? 1 : 0,
    ignoreError ? 0 : cell.error ? 1 : 0,
  ].join(':');
}

export function serializeScreen(screen: Screen): string {
  return JSON.stringify(screen);
}

export function deserializeScreen(json: string): Screen {
  const parsed = JSON.parse(json) as Screen;
  return cloneScreen(parsed);
}

export function cellToChar(cell: Cell): string {
  if (cell.error) {
    return '▒';
  }
  if (cell.set === 'G2' && cell.accent !== undefined) {
    return composeG2Accent(cell.accent, cell.code) ?? String.fromCharCode(cell.code);
  }
  if (cell.set === 'G1') {
    if (cell.code >= 0x40 && cell.code <= 0x5f) {
      return String.fromCharCode(cell.code);
    }
    return cell.code === 0x20 ? ' ' : '#';
  }
  return String.fromCharCode(cell.code);
}

export function rowToText(screen: Screen, row: number): string {
  if (row < 0 || row >= screen.rows.length) {
    return '';
  }
  return screen.rows[row].map(cellToChar).join('');
}
