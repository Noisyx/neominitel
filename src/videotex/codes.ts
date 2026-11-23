/**
 * Single source of truth for Videotex (STUM1B subset) control codes,
 * escape attributes, colour palettes, G1 mosaic mapping, G2 accents,
 * and SEP function keys.
 */

export const SCREEN_ROWS = 25;
export const SCREEN_COLS = 40;
export const PAGE_FIRST_ROW = 1;
export const PAGE_LAST_ROW = 24;
export const STATUS_ROW = 0;

/**
 * C0 control codes (0x00 - 0x1F).
 */
export const C0 = {
  BEL: 0x07, // Bell (ignored by screen, HUD indicator)
  BS: 0x08, // Cursor left (wraps to col 40 of previous row)
  HT: 0x09, // Cursor right (wraps like printing)
  LF: 0x0a, // Cursor down (row 24 -> row 1; from row 0 -> row 1 col 1)
  VT: 0x0b, // Cursor up (row 1 -> row 24)
  FF: 0x0c, // Clear rows 1-24, cursor to (1, 1), reset attributes, G0
  CR: 0x0d, // Cursor to column 1
  SO: 0x0e, // Switch to G1 (mosaic character set)
  SI: 0x0f, // Switch to G0 (alphanumeric character set)
  DC1: 0x11, // Cursor visible (CON)
  REP: 0x12, // Repeat last printed character (next byte 0x40 + n, 1 <= n <= 63)
  SEP: 0x13, // Function key prefix (next byte = key code)
  DC4: 0x14, // Cursor hidden (COFF)
  CAN: 0x18, // Clear from cursor to end of row; cursor unchanged
  SS2: 0x19, // Single shift to G2 (accents: diacritic + base letter)
  ESC: 0x1b, // Escape sequence introducer
  RS: 0x1e, // Cursor to row 1 col 1, reset attributes, G0
  US: 0x1f, // Unit Separator / direct cursor address: row (0x40 + r), col (0x40 + c)
} as const;

export type C0Name = keyof typeof C0;

export const C0_NAME_BY_CODE: ReadonlyMap<number, C0Name> = new Map(
  (Object.entries(C0) as [C0Name, number][]).map(([name, code]) => [code, name]),
);

/**
 * ESC attribute and protocol codes (byte immediately following ESC 0x1B).
 */
export const ESC_CODES = {
  // Protocol sequences PRO1 (1 param byte), PRO2 (2 param bytes), PRO3 (3 param bytes)
  PRO1: 0x39,
  PRO2: 0x3a,
  PRO3: 0x3b,

  // Foreground colours 0..7 (0x40..0x47)
  FG_BLACK: 0x40,
  FG_RED: 0x41,
  FG_GREEN: 0x42,
  FG_YELLOW: 0x43,
  FG_BLUE: 0x44,
  FG_MAGENTA: 0x45,
  FG_CYAN: 0x46,
  FG_WHITE: 0x47,

  // Flashing / steady
  FLASH: 0x48,
  STEADY: 0x49,

  // Character size
  SIZE_NORMAL: 0x4c,
  SIZE_DOUBLE_HEIGHT: 0x4d,
  SIZE_DOUBLE_WIDTH: 0x4e,
  SIZE_DOUBLE: 0x4f,

  // Background colours 0..7 (0x50..0x57)
  BG_BLACK: 0x50,
  BG_RED: 0x51,
  BG_GREEN: 0x52,
  BG_YELLOW: 0x53,
  BG_BLUE: 0x54,
  BG_MAGENTA: 0x55,
  BG_CYAN: 0x56,
  BG_WHITE: 0x57,

  // Contiguous / disjoint mosaic (underline off / on in G0)
  MOSAIC_CONTIGUOUS: 0x59,
  MOSAIC_DISJOINT: 0x5a,

  // CSI introducer (ESC 0x5B ... final byte in 0x40..0x7E)
  CSI: 0x5b,

  // Normal / inverse Polarity
  NORMAL_VIDEO: 0x5c,
  INVERSE_VIDEO: 0x5d,
} as const;

export type EscCodeName = keyof typeof ESC_CODES;

export const ESC_NAME_BY_CODE: ReadonlyMap<number, EscCodeName> = new Map(
  (Object.entries(ESC_CODES) as [EscCodeName, number][]).map(([name, code]) => [code, name]),
);

/**
 * Videotex colour indices (0..7).
 */
export const COLOURS = {
  BLACK: 0,
  RED: 1,
  GREEN: 2,
  YELLOW: 3,
  BLUE: 4,
  MAGENTA: 5,
  CYAN: 6,
  WHITE: 7,
} as const;

export type ColourName = keyof typeof COLOURS;
export type ColourIndex = (typeof COLOURS)[ColourName];

export const COLOUR_NAME_BY_INDEX: ReadonlyMap<number, ColourName> = new Map(
  (Object.entries(COLOURS) as [ColourName, number][]).map(([name, idx]) => [idx, name]),
);

/**
 * Colour RGB palette (8 standard Videotex colours) and
 * Minitel 1 monochrome grey levels ordered by increasing luminance:
 * black (0), blue (4), red (1), magenta (5), green (2), cyan (6), yellow (3), white (7).
 */
export const COLOUR_PALETTE_RGB: readonly [number, number, number][] = [
  [0, 0, 0], // 0: black
  [255, 59, 48], // 1: red
  [52, 199, 89], // 2: green
  [255, 214, 10], // 3: yellow
  [10, 132, 255], // 4: blue
  [255, 55, 95], // 5: magenta
  [100, 210, 255], // 6: cyan
  [245, 245, 247], // 7: white
] as const;

export const MONOCHROME_LUMINANCE_ORDER: readonly ColourIndex[] = [
  0, // black (0%)
  4, // blue (40%)
  1, // red (50%)
  5, // magenta (60%)
  2, // green (70%)
  6, // cyan (80%)
  3, // yellow (90%)
  7, // white (100%)
] as const;

/**
 * Grey levels (0..255) indexed by colour code 0..7.
 * Rank 0..7 in MONOCHROME_LUMINANCE_ORDER maps evenly across 0..255.
 */
export const MONOCHROME_PALETTE_RGB: readonly [number, number, number][] = (() => {
  const levels = new Array<[number, number, number]>(8);
  for (let rank = 0; rank < MONOCHROME_LUMINANCE_ORDER.length; rank++) {
    const colourIdx = MONOCHROME_LUMINANCE_ORDER[rank];
    const v = Math.round((rank / 7) * 255);
    levels[colourIdx] = [v, v, v];
  }
  return levels;
})();

/**
 * G1 2x3 mosaic block mapping.
 * Blocks:
 *   b1 (top-left, weight 1)      b2 (top-right, weight 2)
 *   b3 (middle-left, weight 4)   b4 (middle-right, weight 8)
 *   b5 (bottom-left, weight 16)  b6 (bottom-right, weight 64)
 * Formula: code = 0x20 + b1 + 2*b2 + 4*b3 + 8*b4 + 16*b5 + 64*b6
 * Resulting codes lie in 0x20..0x3F (when b6=0) and 0x60..0x7F (when b6=1).
 */
export type MosaicBlocks = readonly [
  b1: 0 | 1,
  b2: 0 | 1,
  b3: 0 | 1,
  b4: 0 | 1,
  b5: 0 | 1,
  b6: 0 | 1,
];

export function blocksToG1Code(blocks: MosaicBlocks): number {
  const [b1, b2, b3, b4, b5, b6] = blocks;
  return 0x20 + b1 + 2 * b2 + 4 * b3 + 8 * b4 + 16 * b5 + 64 * b6;
}

export function isMosaicG1Code(code: number): boolean {
  return (code >= 0x20 && code <= 0x3f) || (code >= 0x60 && code <= 0x7f);
}

export function g1CodeToBlocks(code: number): MosaicBlocks | null {
  if (!isMosaicG1Code(code)) {
    return null;
  }
  const offset = code - 0x20;
  const b1 = (offset & 1 ? 1 : 0) as 0 | 1;
  const b2 = (offset & 2 ? 1 : 0) as 0 | 1;
  const b3 = (offset & 4 ? 1 : 0) as 0 | 1;
  const b4 = (offset & 8 ? 1 : 0) as 0 | 1;
  const b5 = (offset & 16 ? 1 : 0) as 0 | 1;
  const b6 = (offset & 64 ? 1 : 0) as 0 | 1;
  return [b1, b2, b3, b4, b5, b6];
}

/**
 * G2 French accents (SS2 0x19 + diacritic + base ASCII letter).
 */
export const G2_DIACRITICS = {
  GRAVE: 0x41, // à, è, ù
  ACUTE: 0x42, // é
  CIRCUMFLEX: 0x43, // â, ê, î, ô, û
  DIAERESIS: 0x48, // ë, ï
  CEDILLA: 0x4b, // ç
} as const;

export type G2DiacriticName = keyof typeof G2_DIACRITICS;

export const G2_DIACRITIC_NAME_BY_CODE: ReadonlyMap<number, G2DiacriticName> = new Map(
  (Object.entries(G2_DIACRITICS) as [G2DiacriticName, number][]).map(([name, code]) => [
    code,
    name,
  ]),
);

export interface AccentRule {
  char: string;
  diacritic: number;
  baseChar: string;
  baseCode: number;
}

export const SUPPORTED_ACCENTS: readonly AccentRule[] = [
  { char: 'à', diacritic: G2_DIACRITICS.GRAVE, baseChar: 'a', baseCode: 0x61 },
  { char: 'è', diacritic: G2_DIACRITICS.GRAVE, baseChar: 'e', baseCode: 0x65 },
  { char: 'ù', diacritic: G2_DIACRITICS.GRAVE, baseChar: 'u', baseCode: 0x75 },
  { char: 'é', diacritic: G2_DIACRITICS.ACUTE, baseChar: 'e', baseCode: 0x65 },
  { char: 'â', diacritic: G2_DIACRITICS.CIRCUMFLEX, baseChar: 'a', baseCode: 0x61 },
  { char: 'ê', diacritic: G2_DIACRITICS.CIRCUMFLEX, baseChar: 'e', baseCode: 0x65 },
  { char: 'î', diacritic: G2_DIACRITICS.CIRCUMFLEX, baseChar: 'i', baseCode: 0x69 },
  { char: 'ô', diacritic: G2_DIACRITICS.CIRCUMFLEX, baseChar: 'o', baseCode: 0x6f },
  { char: 'û', diacritic: G2_DIACRITICS.CIRCUMFLEX, baseChar: 'u', baseCode: 0x75 },
  { char: 'ë', diacritic: G2_DIACRITICS.DIAERESIS, baseChar: 'e', baseCode: 0x65 },
  { char: 'ï', diacritic: G2_DIACRITICS.DIAERESIS, baseChar: 'i', baseCode: 0x69 },
  { char: 'ç', diacritic: G2_DIACRITICS.CEDILLA, baseChar: 'c', baseCode: 0x63 },
] as const;

export const ACCENT_BY_CHAR: ReadonlyMap<string, AccentRule> = new Map(
  SUPPORTED_ACCENTS.map((rule) => [rule.char, rule]),
);

export const ACCENT_CHAR_BY_PAIR: ReadonlyMap<string, string> = new Map(
  SUPPORTED_ACCENTS.map((rule) => [`${rule.diacritic}:${rule.baseCode}`, rule.char]),
);

export function composeG2Accent(diacritic: number, baseCode: number): string | null {
  return ACCENT_CHAR_BY_PAIR.get(`${diacritic}:${baseCode}`) ?? null;
}

/**
 * Function keys (SEP 0x13 + key code).
 */
export const FUNCTION_KEYS = {
  Envoi: 0x41,
  Retour: 0x42,
  Repetition: 0x43,
  Guide: 0x44,
  Annulation: 0x45,
  Sommaire: 0x46,
  Correction: 0x47,
  Suite: 0x48,
  ConnexionFin: 0x49,
} as const;

export type FunctionKeyName = keyof typeof FUNCTION_KEYS;

export const FUNCTION_KEY_BY_CODE: ReadonlyMap<number, FunctionKeyName> = new Map(
  (Object.entries(FUNCTION_KEYS) as [FunctionKeyName, number][]).map(([name, code]) => [
    code,
    name,
  ]),
);
