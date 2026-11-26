import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  blocksToG1Code,
  C0,
  C0_NAME_BY_CODE,
  COLOUR_NAME_BY_INDEX,
  COLOURS,
  composeG2Accent,
  ESC_CODES,
  ESC_NAME_BY_CODE,
  FUNCTION_KEY_BY_CODE,
  FUNCTION_KEYS,
  G2_DIACRITIC_NAME_BY_CODE,
  G2_DIACRITICS,
  g1CodeToBlocks,
  isMosaicG1Code,
  MONOCHROME_LUMINANCE_ORDER,
  SCREEN_COLS,
  SCREEN_ROWS,
  SUPPORTED_ACCENTS,
  type MosaicBlocks,
} from '../../src/videotex/codes';
import {
  cellsEqual,
  cellToChar,
  createBlankCell,
  createBlankScreen,
  deserializeScreen,
  rowToText,
  screensEqual,
  serializeScreen,
} from '../../src/videotex/screen';
import {
  createVideotexDecoder,
  decodeBytes,
  type RxByte,
} from '../../src/videotex/decoder';
import {
  bitmapToG1Grid,
  g1GridToBitmap,
} from '../../src/videotex/mosaic';
import {
  buildPageScreen,
  encodePage,
  type MosaicSource,
  type PageRowSource,
  type PageSource,
  type Segment,
  type SegmentSize,
} from '../../src/videotex/encoder';
import {
  ALL_FUNCTION_KEYS,
  createKeyDecoder,
  decodeKey,
  encodeKey,
  type FunctionKey,
} from '../../src/videotex/keys';
import {
  ERROR_HATCH_GLYPH,
  getAccentedGlyph,
  getAsciiGlyph,
  getSupportedGlyphCount,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
} from '../../src/videotex/font';
import {
  CELL_HEIGHT_PX,
  CELL_WIDTH_PX,
  getMosaicBlockRects,
  isFlashVisible,
  renderScreenToRgba,
  resolveCellRender,
  resolvePalette,
  SCREEN_HEIGHT_PX,
  SCREEN_WIDTH_PX,
} from '../../src/videotex/render';
import {
  cellErrorRate,
  cellErrorRateByRow,
  IncrementalVote,
  vote,
} from '../../src/videotex/vote';
import { cloneScreen } from '../../src/videotex/screen';
import { changedRowIndices } from '../helpers/screen-diff';
import { isSlowTestsEnabled } from '../helpers/arbitraries';

function assertUniqueTableValues(
  table: Record<string, number>,
  reverseMap: ReadonlyMap<number, string>,
): void {
  const entries = Object.entries(table);
  expect(entries.length).toBeGreaterThan(0);

  const seenCodes = new Set<number>();
  for (const [name, code] of entries) {
    expect(name.length).toBeGreaterThan(0);
    expect(seenCodes.has(code)).toBe(false);
    seenCodes.add(code);
    expect(reverseMap.get(code)).toBe(name);
  }
  expect(reverseMap.size).toBe(entries.length);
}

describe('Videotex Task 1: Code tables', () => {
  it('every table entry has a name and no code is defined twice', () => {
    assertUniqueTableValues(C0, C0_NAME_BY_CODE);
    assertUniqueTableValues(ESC_CODES, ESC_NAME_BY_CODE);
    assertUniqueTableValues(COLOURS, COLOUR_NAME_BY_INDEX);
    assertUniqueTableValues(G2_DIACRITICS, G2_DIACRITIC_NAME_BY_CODE);
    assertUniqueTableValues(FUNCTION_KEYS, FUNCTION_KEY_BY_CODE);

    expect(new Set(MONOCHROME_LUMINANCE_ORDER).size).toBe(8);
    expect(SUPPORTED_ACCENTS.length).toBe(12);
    for (const rule of SUPPORTED_ACCENTS) {
      expect(composeG2Accent(rule.diacritic, rule.baseCode)).toBe(rule.char);
    }
  });
});

describe('Videotex Task 2: Screen model', () => {
  it('creates a 25x40 blank screen, serializes to JSON and compares cell by cell', () => {
    const screen = createBlankScreen();
    expect(screen.rows.length).toBe(SCREEN_ROWS);
    for (const row of screen.rows) {
      expect(row.length).toBe(SCREEN_COLS);
    }
    expect(screen.cursor).toEqual({ row: 1, col: 0, visible: false });

    screen.rows[3][5] = createBlankCell({
      code: 0x41,
      fg: COLOURS.YELLOW,
      bg: COLOURS.BLUE,
      flash: true,
    });

    const json = serializeScreen(screen);
    const restored = deserializeScreen(json);
    expect(screensEqual(screen, restored, { includeCursorAndAttrs: true })).toBe(true);

    restored.rows[3][5].fg = COLOURS.RED;
    expect(cellsEqual(screen.rows[3][5], restored.rows[3][5])).toBe(false);
    expect(screensEqual(screen, restored)).toBe(false);
  });
});

describe('Videotex Task 3: Golden decoder tests', () => {
  it('decodes C0 cursor movement, wrapping, FF, RS, US, CAN, DC1/DC4', () => {
    const dec = createVideotexDecoder();

    // Show cursor (DC1), position at row 2 col 39 with US, print 'A', 'B' (wraps to row 3 col 1)
    dec.pushMany([
      C0.DC1,
      C0.US,
      0x40 + 2,
      0x40 + 39,
      0x41, // 'A' at row 2, col 38 (0-indexed)
      0x42, // 'B' at row 2, col 39 (0-indexed, column 40)
      0x43, // 'C' wraps to row 3, col 0 (0-indexed, column 1)
    ]);

    let s = dec.screen();
    expect(s.cursor.visible).toBe(true);
    expect(s.rows[2][38].code).toBe(0x41);
    expect(s.rows[2][39].code).toBe(0x42);
    expect(s.rows[3][0].code).toBe(0x43);
    expect(s.cursor.row).toBe(3);
    expect(s.cursor.col).toBe(1);

    // BS, HT, LF, VT, CR
    dec.pushMany([C0.BS, 0x5a]); // overwrites 'C' at (3, 0) with 'Z', cursor at (3, 1)
    expect(dec.screen().rows[3][0].code).toBe(0x5a);

    // Wrap from row 24 column 40 back to row 1 column 1
    dec.pushMany([C0.US, 0x40 + 24, 0x40 + 40, 0x58, 0x59]);
    s = dec.screen();
    expect(s.rows[24][39].code).toBe(0x58);
    expect(s.rows[1][0].code).toBe(0x59);

    // Status row 0 + LF deviation 2 -> goes back to row 1, column 1
    dec.pushMany([C0.US, 0x40 + 0, 0x40 + 5, 0x33, 0x36, 0x31, 0x35, C0.LF]);
    s = dec.screen();
    expect(rowToText(s, 0).slice(4, 8)).toBe('3615');
    expect(s.cursor.row).toBe(1);
    expect(s.cursor.col).toBe(0);

    // CAN clears from cursor to end of row
    dec.pushMany([C0.US, 0x40 + 5, 0x40 + 1, 0x41, 0x42, 0x43, 0x44, C0.CR, C0.HT, C0.CAN]);
    s = dec.screen();
    expect(s.rows[5][0].code).toBe(0x41);
    expect(s.rows[5][1].code).toBe(0x20);
    expect(s.rows[5][2].code).toBe(0x20);
    expect(s.rows[5][3].code).toBe(0x20);

    // FF clears rows 1..24 but keeps row 0, resets cursor to (1, 0) and hides cursor on DC4
    dec.pushMany([C0.FF, C0.DC4]);
    s = dec.screen();
    expect(s.rows[5][0].code).toBe(0x20);
    expect(rowToText(s, 0).slice(4, 8)).toBe('3615');
    expect(s.cursor).toEqual({ row: 1, col: 0, visible: false });
  });

  it('decodes ESC attributes, PRO1-3 and CSI skipping, G1 mosaic, REP, and SS2 French accents', () => {
    const dec = createVideotexDecoder();

    dec.pushMany([
      C0.FF,
      // ESC foreground yellow, background blue, flash, inverse, double size
      C0.ESC,
      ESC_CODES.FG_YELLOW,
      C0.ESC,
      ESC_CODES.BG_BLUE,
      C0.ESC,
      ESC_CODES.FLASH,
      C0.ESC,
      ESC_CODES.INVERSE_VIDEO,
      C0.ESC,
      ESC_CODES.SIZE_DOUBLE,
      // Skip PRO1 (1 param), PRO2 (2 params), PRO3 (3 params), CSI
      C0.ESC,
      ESC_CODES.PRO1,
      0x7f,
      C0.ESC,
      ESC_CODES.PRO2,
      0x61,
      0x62,
      C0.ESC,
      ESC_CODES.PRO3,
      0x61,
      0x62,
      0x63,
      C0.ESC,
      ESC_CODES.CSI,
      0x31,
      0x3b,
      0x32,
      0x48,
      // Print 'M' and repeat 4 more times (total 5 'M's)
      0x4d,
      C0.REP,
      0x40 + 4,
    ]);

    let s = dec.screen();
    for (let c = 0; c < 5; c++) {
      expect(s.rows[1][c]).toEqual({
        code: 0x4d,
        set: 'G0',
        fg: COLOURS.YELLOW,
        bg: COLOURS.BLUE,
        flash: true,
        inverse: true,
        disjoint: false,
        doubleHeight: true,
        doubleWidth: true,
        error: false,
      });
    }

    // Switch to G1 mosaic with disjoint blocks, print full block 0x7F and 0x41 (falls back to G0 'A')
    dec.pushMany([
      C0.SO,
      C0.ESC,
      ESC_CODES.MOSAIC_DISJOINT,
      0x7f,
      0x41,
      C0.SI,
      // French accent 'é' via SS2 (0x19 0x42 0x65)
      C0.SS2,
      G2_DIACRITICS.ACUTE,
      0x65,
    ]);

    s = dec.screen();
    expect(s.rows[1][5].set).toBe('G1');
    expect(s.rows[1][5].code).toBe(0x7f);
    expect(s.rows[1][5].disjoint).toBe(true);
    expect(s.rows[1][6].set).toBe('G0');
    expect(s.rows[1][6].code).toBe(0x41);
    expect(s.rows[1][7].set).toBe('G2');
    expect(s.rows[1][7].accent).toBe(G2_DIACRITICS.ACUTE);
    expect(cellToChar(s.rows[1][7])).toBe('é');
  });

  it('writes error-flagged bytes as error cells and aborts active control sequences', () => {
    const dec = createVideotexDecoder();

    // Start an US sequence, then receive an error byte instead of the column
    dec.push({ value: C0.US, error: false });
    dec.push({ value: 0x40 + 10, error: false });
    dec.push({ value: C0.FF, error: true }); // parity error on 0x0C: must NOT clear screen!
    dec.push({ value: 0x41, error: false }); // 'A'

    const s = dec.screen();
    expect(s.rows[1][0].error).toBe(true);
    expect(s.rows[1][1].code).toBe(0x41);
    expect(s.rows[1][1].error).toBe(false);
    expect(dec.stats().errorCells).toBe(1);
  });
});

describe('Videotex Task 4: Encoder and mosaics', () => {
  it('validates row limits, row lengths (including transliteration expansion) and mosaic bitmaps', () => {
    const tooManyRows: PageSource = {
      id: 'test/too-many',
      rows: Array.from({ length: 25 }, (_, i) => ({
        row: i + 1,
        segments: [{ text: 'X' }],
      })),
    };
    expect(encodePage(tooManyRows)).toEqual({
      ok: false,
      error: { kind: 'too-many-rows' },
    });

    const rowTooLong: PageSource = {
      id: 'test/long-row',
      rows: [{ row: 4, col: 35, segments: [{ text: '1234567' }] }],
    };
    expect(encodePage(rowTooLong)).toEqual({
      ok: false,
      error: { kind: 'row-too-long', row: 4, length: 41 },
    });

    // 'œ' transliterates to 'oe' (2 cells), pushing 40 chars to 41 cells
    const translitOverflow: PageSource = {
      id: 'test/translit-overflow',
      rows: [{ row: 7, segments: [{ text: 'a'.repeat(39) + 'œ' }] }],
    };
    expect(encodePage(translitOverflow)).toEqual({
      ok: false,
      error: { kind: 'row-too-long', row: 7, length: 41 },
    });

    const statusTooLong: PageSource = {
      id: 'test/status-long',
      status: 'S'.repeat(41),
      rows: [],
    };
    expect(encodePage(statusTooLong)).toEqual({
      ok: false,
      error: { kind: 'row-too-long', row: 0, length: 41 },
    });

    expect(bitmapToG1Grid(['##', '##'])).toEqual({
      ok: false,
      error: { kind: 'bad-bitmap', reason: 'Bitmap height 2 must be a multiple of 3' },
    });
    expect(bitmapToG1Grid(['###', '###', '###'])).toEqual({
      ok: false,
      error: { kind: 'bad-bitmap', reason: 'Bitmap width 3 must be a multiple of 2' },
    });
    expect(bitmapToG1Grid(['#?', '..', '..'])).toEqual({
      ok: false,
      error: {
        kind: 'bad-bitmap',
        reason: "Invalid character '?' at bitmap (0, 1); expected '#' or '.'",
      },
    });
  });

  it('transliterates unsupported non-ASCII characters deterministically with warnings and compresses runs >= 4 with REP', () => {
    const page: PageSource = {
      id: 'test/translit-rep',
      status: '3615 «Néo»',
      rows: [
        {
          row: 2,
          segments: [
            { text: 'Cœur d’été ======', fg: COLOURS.CYAN },
          ],
        },
      ],
    };

    const encodedWithRep = encodePage(page, { useRep: true });
    const encodedNoRep = encodePage(page, { useRep: false });
    expect(encodedWithRep.ok).toBe(true);
    expect(encodedNoRep.ok).toBe(true);
    if (!encodedWithRep.ok || !encodedNoRep.ok) return;

    // '«', '»', 'œ', '’' each produce a warning; 'é' is supported in G2 without warning
    expect(encodedWithRep.value.warnings.length).toBe(4);
    expect(encodedWithRep.value.bytes.includes(C0.REP)).toBe(true);
    expect(encodedWithRep.value.bytes.length).toBeLessThan(encodedNoRep.value.bytes.length);

    const screen = decodeBytes(encodedWithRep.value.bytes);
    expect(rowToText(screen, 0).trimEnd()).toBe('3615 "Néo"');
    expect(rowToText(screen, 2).trimEnd()).toBe("Coeur d'été ======");
  });

  it('defers non-delimited background changes with a warning and encodes mosaic bitmaps', () => {
    const bitmap = [
      '#.#.',
      '.#.#',
      '####',
    ];
    const grid = bitmapToG1Grid(bitmap);
    expect(grid.ok).toBe(true);
    if (grid.ok) {
      expect(g1GridToBitmap(grid.value)).toEqual(bitmap);
    }

    const page: PageSource = {
      id: 'test/bg-delimiter',
      rows: [
        {
          row: 1,
          segments: [
            { text: 'SANS_ESPACE puis AVEC', fg: COLOURS.WHITE, bg: COLOURS.BLUE },
          ],
        },
      ],
      mosaics: [
        { row: 3, col: 2, bitmap, fg: COLOURS.YELLOW, bg: COLOURS.RED },
      ],
    };

    const res = encodePage(page);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // First 11 chars ('SANS_ESPACE') had no space delimiter so bg stayed 0; at index 11 (' ') bg became BLUE (4)
    expect(res.value.warnings.length).toBe(11);
    const decoded = decodeBytes(res.value.bytes);
    expect(decoded.rows[1][0].bg).toBe(COLOURS.BLACK);
    expect(decoded.rows[1][10].bg).toBe(COLOURS.BLACK);
    expect(decoded.rows[1][11].bg).toBe(COLOURS.BLUE);
    expect(decoded.rows[1][12].bg).toBe(COLOURS.BLUE);
    expect(decoded.rows[3][1].set).toBe('G1');
    expect(decoded.rows[3][1].fg).toBe(COLOURS.YELLOW);
    expect(decoded.rows[3][1].bg).toBe(COLOURS.RED);
  });
});

describe('Videotex Task 7: Rendering model and 8x10 bitmap font', () => {
  it('provides 8x10 glyphs for all ASCII printables and the 12 French G2 accents', () => {
    expect(CELL_WIDTH_PX).toBe(8);
    expect(CELL_HEIGHT_PX).toBe(10);
    expect(SCREEN_WIDTH_PX).toBe(320);
    expect(SCREEN_HEIGHT_PX).toBe(250);
    expect(GLYPH_WIDTH).toBe(8);
    expect(GLYPH_HEIGHT).toBe(10);

    const counts = getSupportedGlyphCount();
    expect(counts.ascii).toBe(96); // 0x20..0x7F
    expect(counts.accented).toBe(12);

    // Space is blank; non-space ASCII glyphs have lit pixels
    expect(Array.from(getAsciiGlyph(0x20)).every((b) => b === 0)).toBe(true);
    for (let code = 0x21; code <= 0x7f; code++) {
      const g = getAsciiGlyph(code);
      expect(g.length).toBe(10);
      expect(Array.from(g).some((b) => b !== 0)).toBe(true);
    }

    // Accented glyphs differ from their unaccented base letter
    for (const rule of SUPPORTED_ACCENTS) {
      const accented = getAccentedGlyph(rule.diacritic, rule.baseCode);
      const base = getAsciiGlyph(rule.baseCode);
      expect(accented.length).toBe(10);
      expect(Array.from(accented)).not.toEqual(Array.from(base));
    }
  });

  it('orders monochrome palette by Minitel 1 luminance, resolves mosaic geometry, inverse (G0 only), flash, and RGBA blitting', () => {
    const colourPalette = resolvePalette('couleur');
    const monoPalette = resolvePalette('nb');
    expect(colourPalette.length).toBe(8);
    expect(monoPalette.length).toBe(8);

    // Monochrome grey levels strictly increase along MONOCHROME_LUMINANCE_ORDER (0, 4, 1, 5, 2, 6, 3, 7)
    for (let i = 0; i < MONOCHROME_LUMINANCE_ORDER.length - 1; i++) {
      const cLo = MONOCHROME_LUMINANCE_ORDER[i];
      const cHi = MONOCHROME_LUMINANCE_ORDER[i + 1];
      expect(monoPalette[cLo][0]).toBe(monoPalette[cLo][1]);
      expect(monoPalette[cLo][1]).toBe(monoPalette[cLo][2]);
      expect(monoPalette[cLo][0]).toBeLessThan(monoPalette[cHi][0]);
    }

    // Contiguous mosaic geometry: columns 4+4, rows 3+4+3; disjoint subtracts 1 px right & bottom
    const contig = getMosaicBlockRects(0x7f, false);
    expect(contig.map((b) => [b.x, b.y, b.width, b.height])).toEqual([
      [0, 0, 4, 3],
      [4, 0, 4, 3],
      [0, 3, 4, 4],
      [4, 3, 4, 4],
      [0, 7, 4, 3],
      [4, 7, 4, 3],
    ]);
    const disjoint = getMosaicBlockRects(0x7f, true);
    expect(disjoint.map((b) => [b.x, b.y, b.width, b.height])).toEqual([
      [0, 0, 3, 2],
      [4, 0, 3, 2],
      [0, 3, 3, 3],
      [4, 3, 3, 3],
      [0, 7, 3, 2],
      [4, 7, 3, 2],
    ]);

    // Inverse swaps fg and bg in G0, NOT in G1
    const g0Inv = resolveCellRender(
      createBlankCell({ code: 0x41, set: 'G0', fg: COLOURS.YELLOW, bg: COLOURS.BLUE, inverse: true }),
    );
    expect(g0Inv.fgRgb).toEqual(colourPalette[COLOURS.BLUE]);
    expect(g0Inv.bgRgb).toEqual(colourPalette[COLOURS.YELLOW]);

    const g1Inv = resolveCellRender(
      createBlankCell({ code: 0x7f, set: 'G1', fg: COLOURS.YELLOW, bg: COLOURS.BLUE, inverse: true }),
    );
    expect(g1Inv.fgRgb).toEqual(colourPalette[COLOURS.YELLOW]);
    expect(g1Inv.bgRgb).toEqual(colourPalette[COLOURS.BLUE]);

    // Flash: visible for 2/3 of 1 s ([0, 667)), hidden for 1/3 ([667, 1000)), always visible on reducedMotion
    expect(isFlashVisible(100, false)).toBe(true);
    expect(isFlashVisible(800, false)).toBe(false);
    expect(isFlashVisible(800, true)).toBe(true);

    const hiddenFlash = resolveCellRender(
      createBlankCell({ code: 0x41, flash: true }),
      { flashVisible: false },
    );
    expect(Array.from(hiddenFlash.bitmap).every((b) => b === 0)).toBe(true);

    // Error cell uses hatched glyph
    const errRender = resolveCellRender(createBlankCell({ error: true }));
    expect(errRender.kind).toBe('error');
    expect(Array.from(errRender.bitmap)).toEqual(Array.from(ERROR_HATCH_GLYPH));

    // Full screen RGBA render produces 320 * 250 * 4 bytes
    const screen = createBlankScreen();
    screen.rows[1][0] = createBlankCell({ code: 0x7f, set: 'G1', fg: COLOURS.RED, bg: COLOURS.BLACK });
    const rgba = renderScreenToRgba(screen);
    expect(rgba.length).toBe(320 * 250 * 4);
    // Row 1, col 0 top-left pixel (x=0, y=10) should be RED
    const offset = (10 * 320 + 0) * 4;
    expect([rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]]).toEqual([
      ...colourPalette[COLOURS.RED],
      255,
    ]);
  });
});

describe('Videotex Property Tests', () => {
  const runs = (fast: number, slow: number): number => (isSlowTestsEnabled() ? slow : fast);

  const arbRxByte: fc.Arbitrary<RxByte> = fc.record({
    value: fc.integer({ min: 0, max: 127 }),
    error: fc.boolean(),
  });

  const SUPPORTED_TEXT_CHARS: readonly string[] = [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,;:!?+-*/=()[]"\'',
    ...SUPPORTED_ACCENTS.map((a) => a.char),
  ];

  const arbSupportedNonSpaceChar = fc.constantFrom(
    ...SUPPORTED_TEXT_CHARS.filter((c) => c !== ' '),
  );
  const arbSupportedChar = fc.constantFrom(...SUPPORTED_TEXT_CHARS);
  const arbColour = fc.integer({ min: 0, max: 7 });
  const arbSize: fc.Arbitrary<SegmentSize> = fc.constantFrom(
    'normal',
    'doubleHeight',
    'doubleWidth',
    'double',
  );

  /**
   * Generates a valid PageSource where every background colour change in G0 begins on a space
   * delimiter (Requirement 4.4) and row/mosaic coordinates fit within the 24x40 page area.
   */
  const arbValidPageSource: fc.Arbitrary<PageSource> = fc
    .record({
      hasStatus: fc.boolean(),
      statusChars: fc.array(arbSupportedChar, { minLength: 0, maxLength: 40 }),
      rowNumbers: fc.uniqueArray(fc.integer({ min: 1, max: 24 }), {
        minLength: 0,
        maxLength: 10,
      }),
      hasMosaic: fc.boolean(),
      mosaicRow: fc.integer({ min: 1, max: 21 }),
      mosaicCol: fc.integer({ min: 1, max: 35 }),
      mosaicCellRows: fc.integer({ min: 1, max: 3 }),
      mosaicCellCols: fc.integer({ min: 1, max: 5 }),
      mosaicFg: arbColour,
      mosaicBg: arbColour,
      mosaicBits: fc.array(fc.constantFrom('#', '.'), { minLength: 90, maxLength: 90 }),
    })
    .chain((base) => {
      const arbRowEntry = (rowNum: number): fc.Arbitrary<PageRowSource> =>
        fc
          .tuple(
            fc.integer({ min: 1, max: 10 }),
            fc.array(
              fc.record({
                len: fc.integer({ min: 1, max: 10 }),
                chars: fc.array(arbSupportedNonSpaceChar, { minLength: 10, maxLength: 10 }),
                fg: arbColour,
                bg: arbColour,
                flash: fc.boolean(),
                inverse: fc.boolean(),
                size: arbSize,
              }),
              { minLength: 1, maxLength: 3 },
            ),
          )
          .map(([col, rawSegs]) => {
            let remaining = SCREEN_COLS - (col - 1);
            let activeBg: number = COLOURS.BLACK;
            const segments: Segment[] = [];
            for (const s of rawSegs) {
              if (remaining <= 0) break;
              const take = Math.min(s.len, remaining);
              let text = s.chars.slice(0, take).join('');
              // Ensure background transition starts with a space delimiter (Req 4.4)
              if (s.bg !== activeBg) {
                text = ' ' + text.slice(1);
                activeBg = s.bg;
              }
              segments.push({
                text,
                fg: s.fg,
                bg: s.bg,
                flash: s.flash,
                inverse: s.inverse,
                size: s.size,
              });
              remaining -= text.length;
            }
            return { row: rowNum, col, segments };
          });

      const rowsArb =
        base.rowNumbers.length === 0
          ? fc.constant<PageRowSource[]>([])
          : fc.tuple(...base.rowNumbers.map(arbRowEntry));

      return rowsArb.map((rows) => {
        const occupiedRows = new Set(rows.map((r) => r.row));
        const mosaics: MosaicSource[] = [];
        if (base.hasMosaic) {
          const hCells = base.mosaicCellRows;
          const overlapsText = Array.from({ length: hCells }, (_, dr) => base.mosaicRow + dr).some(
            (r) => occupiedRows.has(r),
          );
          if (!overlapsText) {
            const h = hCells * 3;
            const w = base.mosaicCellCols * 2;
            const bitmap: string[] = [];
            let idx = 0;
            for (let r = 0; r < h; r++) {
              let line = '';
              for (let c = 0; c < w; c++) {
                line += base.mosaicBits[idx % base.mosaicBits.length];
                idx++;
              }
              bitmap.push(line);
            }
            mosaics.push({
              row: base.mosaicRow,
              col: base.mosaicCol,
              bitmap,
              fg: base.mosaicFg,
              bg: base.mosaicBg,
            });
          }
        }

        const page: PageSource = {
          id: 'prop/page',
          rows,
          ...(base.hasStatus ? { status: base.statusChars.join('') } : {}),
          ...(mosaics.length > 0 ? { mosaics } : {}),
        };
        return page;
      });
    });

  it('V1 round-trip: for any valid PageSource, decoding encodePage(p) gives the expected screen cell by cell', () => {
    fc.assert(
      fc.property(arbValidPageSource, (page) => {
        const expectedRes = buildPageScreen(page);
        expect(expectedRes.ok).toBe(true);
        if (!expectedRes.ok) return;
        expect(expectedRes.value.warnings).toEqual([]);

        const encodedRes = encodePage(page);
        expect(encodedRes.ok).toBe(true);
        if (!encodedRes.ok) return;

        const decoded = decodeBytes(encodedRes.value.bytes);
        expect(screensEqual(decoded, expectedRes.value.screen)).toBe(true);

        // Also check row text and mosaic blocks directly against the source PageSource
        if (page.status !== undefined) {
          expect(rowToText(decoded, 0).slice(0, page.status.length)).toBe(page.status);
        }
        for (const rSpec of page.rows) {
          const joined = rSpec.segments.map((s) => s.text).join('');
          const start = (rSpec.col ?? 1) - 1;
          expect(rowToText(decoded, rSpec.row).slice(start, start + joined.length)).toBe(
            joined,
          );
        }
        for (const m of page.mosaics ?? []) {
          const cellRows = m.bitmap.length / 3;
          const cellCols = m.bitmap[0].length / 2;
          const extractedGrid: number[][] = [];
          for (let dr = 0; dr < cellRows; dr++) {
            const rowCodes: number[] = [];
            for (let dc = 0; dc < cellCols; dc++) {
              const cell = decoded.rows[m.row + dr][m.col - 1 + dc];
              expect(cell.set).toBe('G1');
              expect(cell.fg).toBe(m.fg);
              expect(cell.bg).toBe(m.bg);
              rowCodes.push(cell.code);
            }
            extractedGrid.push(rowCodes);
          }
          expect(g1GridToBitmap(extractedGrid)).toEqual(m.bitmap);
        }
      }),
      { numRuns: runs(80, 400) },
    );
  });

  it('V2 byte-by-byte decoding and one-shot decoding give the same screen', () => {
    fc.assert(
      fc.property(fc.array(arbRxByte, { minLength: 0, maxLength: 300 }), (rxBytes) => {
        const oneShotScreen = decodeBytes(rxBytes);

        const streamDecoder = createVideotexDecoder();
        for (const b of rxBytes) {
          streamDecoder.push(b);
        }
        const streamScreen = streamDecoder.screen();

        expect(
          screensEqual(oneShotScreen, streamScreen, { includeCursorAndAttrs: true }),
        ).toBe(true);
      }),
      { numRuns: runs(100, 400) },
    );
  });

  it('V3 locality: replacing any single byte except the first (FF) with an error-flagged byte changes cells only in rows r-1, r and r+1', () => {
    function rowForByteOffsets(bytes: Uint8Array): number[] {
      const rowOfByte = new Array<number>(bytes.length).fill(1);
      let currentRow = 1;
      let i = 0;
      while (i < bytes.length) {
        if (bytes[i] === C0.US && i + 2 < bytes.length) {
          const r = bytes[i + 1] - 0x40;
          if (r >= 0 && r < SCREEN_ROWS) {
            currentRow = r;
          }
          rowOfByte[i] = currentRow;
          rowOfByte[i + 1] = currentRow;
          rowOfByte[i + 2] = currentRow;
          i += 3;
          continue;
        }
        rowOfByte[i] = currentRow;
        i++;
      }
      return rowOfByte;
    }

    function allowedNeighbourRows(r: number): Set<number> {
      if (r === 0) {
        // Status row 0 is emitted after row 24 and wraps to row 1
        return new Set([24, 0, 1]);
      }
      if (r === 24) {
        // Page mode wraps row 24 column 40 to row 1 column 1 (Requirement 2.3)
        return new Set([23, 24, 1]);
      }
      return new Set([r - 1, r, r + 1]);
    }

    fc.assert(
      fc.property(
        arbValidPageSource,
        fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 8, maxLength: 8 }),
        (page, rawPicks) => {
          const encoded = encodePage(page);
          expect(encoded.ok).toBe(true);
          if (!encoded.ok) return;

          const { bytes } = encoded.value;
          if (bytes.length <= 1) return;

          const cleanScreen = decodeBytes(bytes);
          const byteRows = rowForByteOffsets(bytes);

          // Always test every US introducer + sampled interior bytes
          const indicesToTest = new Set<number>();
          for (let i = 1; i < bytes.length; i++) {
            if (bytes[i] === C0.US) {
              indicesToTest.add(i);
            }
          }
          for (const pick of rawPicks) {
            indicesToTest.add(1 + (pick % (bytes.length - 1)));
          }

          for (const errIndex of indicesToTest) {
            const rxStream: RxByte[] = Array.from(bytes, (value, idx) => ({
              value,
              error: idx === errIndex,
            }));
            const damagedScreen = decodeBytes(rxStream);
            const r = byteRows[errIndex];
            const allowed = allowedNeighbourRows(r);
            const diffRows = changedRowIndices(damagedScreen, cleanScreen);
            for (const changedRow of diffRows) {
              expect(allowed.has(changedRow)).toBe(true);
            }
          }
        },
      ),
      { numRuns: runs(50, 250) },
    );
  });

  it('V4 REP: encoding with and without REP gives the same screen', () => {
    const arbRepHeavyPage: fc.Arbitrary<PageSource> = fc
      .tuple(
        arbValidPageSource,
        fc.constantFrom(...SUPPORTED_TEXT_CHARS),
        fc.integer({ min: 4, max: 35 }),
        arbColour,
      )
      .map(([base, ch, count, fg]) => ({
        ...base,
        rows: [
          ...base.rows.filter((r) => r.row !== 12),
          {
            row: 12,
            col: 1,
            segments: [{ text: ch.repeat(count), fg }],
          },
        ],
      }));

    fc.assert(
      fc.property(arbRepHeavyPage, (page) => {
        const withRep = encodePage(page, { useRep: true });
        const withoutRep = encodePage(page, { useRep: false });
        expect(withRep.ok).toBe(true);
        expect(withoutRep.ok).toBe(true);
        if (!withRep.ok || !withoutRep.ok) return;

        const screenRep = decodeBytes(withRep.value.bytes);
        const screenNoRep = decodeBytes(withoutRep.value.bytes);
        expect(screensEqual(screenRep, screenNoRep)).toBe(true);
        expect(withRep.value.bytes.length).toBeLessThanOrEqual(
          withoutRep.value.bytes.length,
        );
      }),
      { numRuns: runs(80, 300) },
    );
  });

  it('V5 for every 6-bit pattern, the G1 code is in 0x20-0x3F ∪ 0x60-0x7F and decodes back to the same pattern', () => {
    const arbBit = fc.constantFrom(0 as const, 1 as const);
    const arbMosaicBlocks: fc.Arbitrary<MosaicBlocks> = fc.tuple(
      arbBit,
      arbBit,
      arbBit,
      arbBit,
      arbBit,
      arbBit,
    );

    fc.assert(
      fc.property(arbMosaicBlocks, (blocks) => {
        const code = blocksToG1Code(blocks);
        expect(isMosaicG1Code(code)).toBe(true);
        expect((code >= 0x20 && code <= 0x3f) || (code >= 0x60 && code <= 0x7f)).toBe(
          true,
        );
        expect(g1CodeToBlocks(code)).toEqual(blocks);
      }),
      { numRuns: 64 },
    );
  });

  it('V6 for any byte sequence (0-127, random error flags), the decoder never throws and the cursor stays inside the screen', () => {
    fc.assert(
      fc.property(fc.array(arbRxByte, { minLength: 0, maxLength: 500 }), (rxBytes) => {
        const decoder = createVideotexDecoder();
        for (const b of rxBytes) {
          const { changed } = decoder.push(b);
          for (const [r, c] of changed) {
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThan(SCREEN_ROWS);
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThan(SCREEN_COLS);
          }
          const s = decoder.screen();
          expect(s.cursor.row).toBeGreaterThanOrEqual(0);
          expect(s.cursor.row).toBeLessThan(SCREEN_ROWS);
          expect(s.cursor.col).toBeGreaterThanOrEqual(0);
          expect(s.cursor.col).toBeLessThan(SCREEN_COLS);
        }
        const stats = decoder.stats();
        expect(stats.bytes).toBe(rxBytes.length);
      }),
      { numRuns: runs(100, 400) },
    );
  });

  it('V7 encoder output contains only bytes <= 127 and starts with FF', () => {
    fc.assert(
      fc.property(arbValidPageSource, (page) => {
        const res = encodePage(page);
        expect(res.ok).toBe(true);
        if (!res.ok) return;

        const { bytes } = res.value;
        expect(bytes.length).toBeGreaterThan(0);
        expect(bytes[0]).toBe(C0.FF);
        for (let i = 0; i < bytes.length; i++) {
          expect(bytes[i]).toBeGreaterThanOrEqual(0);
          expect(bytes[i]).toBeLessThanOrEqual(127);
        }
      }),
      { numRuns: runs(100, 400) },
    );
  });

  it('V11 decodeKey(encodeKey(k)) = k for the nine function keys', () => {
    expect(ALL_FUNCTION_KEYS.length).toBe(9);
    const arbKey: fc.Arbitrary<FunctionKey> = fc.constantFrom(...ALL_FUNCTION_KEYS);

    fc.assert(
      fc.property(arbKey, (key) => {
        const encoded = encodeKey(key);
        expect(encoded.length).toBe(2);
        expect(encoded[0]).toBe(C0.SEP);
        expect(decodeKey(encoded)).toBe(key);

        const stream = createKeyDecoder();
        expect(stream.push({ value: encoded[0], error: false })).toBeNull();
        expect(stream.push({ value: encoded[1], error: false })).toBe(key);
      }),
      { numRuns: 50 },
    );

    // Invalid sequences return null
    expect(decodeKey(Uint8Array.of(0x41))).toBeNull();
    expect(decodeKey(Uint8Array.of(0x00, 0x41))).toBeNull();
    expect(decodeKey(Uint8Array.of(C0.SEP, 0x50))).toBeNull();

    // Error-flagged key byte aborts sequence
    const stream = createKeyDecoder();
    expect(stream.push({ value: C0.SEP, error: false })).toBeNull();
    expect(stream.push({ value: 0x41, error: true })).toBeNull();
  });

  it('V8 vote with erasures: with N copies where each cell is erased in at most N-1 copies, vote returns the reference exactly', () => {
    const arbCase = fc.record({
      page: arbValidPageSource,
      copies: fc.integer({ min: 2, max: 6 }),
      seedMasks: fc.uniqueArray(fc.integer({ min: 0, max: 999 }), {
        minLength: 0,
        maxLength: 150,
      }),
    });

    fc.assert(
      fc.property(arbCase, ({ page, copies, seedMasks }) => {
        const built = buildPageScreen(page);
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const ref = built.value.screen;

        const receptions = Array.from({ length: copies }, () =>
          cloneScreen(ref),
        );

        // Erase random distinct cells across copies while always keeping >= 1 surviving copy per cell
        for (let i = 0; i < seedMasks.length; i++) {
          const cellIdx = seedMasks[i];
          const r = Math.floor(cellIdx / SCREEN_COLS);
          const c = cellIdx % SCREEN_COLS;
          const survivor = i % copies;
          for (let k = 0; k < copies; k++) {
            if (k !== survivor) {
              receptions[k].rows[r][c] = createBlankCell({ error: true });
            }
          }
        }

        const res = vote(receptions);
        expect(res.unresolved).toBe(0);
        expect(screensEqual(res.screen, ref)).toBe(true);
        expect(cellErrorRate(res.screen, ref)).toBe(0);
      }),
      { numRuns: runs(50, 200) },
    );
  });

  it('V9 vote majority: with N = 2k + 1 copies where each cell has at most k wrong non-erased values, vote returns the reference exactly', () => {
    const arbCase = fc.record({
      page: arbValidPageSource,
      k: fc.integer({ min: 1, max: 3 }),
      corruptCells: fc.uniqueArray(
        fc.record({
          cellIdx: fc.integer({ min: 0, max: 999 }),
          wrongCode: fc.integer({ min: 0x21, max: 0x7e }),
          wrongFg: arbColour,
        }),
        {
          selector: (item) => item.cellIdx,
          minLength: 0,
          maxLength: 120,
        },
      ),
    });

    fc.assert(
      fc.property(arbCase, ({ page, k, corruptCells }) => {
        const built = buildPageScreen(page);
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const ref = built.value.screen;

        const n = 2 * k + 1;
        const receptions = Array.from({ length: n }, () => cloneScreen(ref));

        for (let idx = 0; idx < corruptCells.length; idx++) {
          const { cellIdx, wrongCode, wrongFg } = corruptCells[idx];
          const r = Math.floor(cellIdx / SCREEN_COLS);
          const c = cellIdx % SCREEN_COLS;
          // Corrupt at most k copies at (r, c)
          for (let copy = 0; copy < k; copy++) {
            const targetCopy = (idx + copy) % n;
            const altCode =
              wrongCode === ref.rows[r][c].code
                ? ((wrongCode - 0x20 + 1) % 94) + 0x21
                : wrongCode;
            receptions[targetCopy].rows[r][c] = createBlankCell({
              code: altCode,
              fg: wrongFg,
              error: false,
            });
          }
        }

        const res = vote(receptions);
        expect(res.unresolved).toBe(0);
        expect(screensEqual(res.screen, ref)).toBe(true);
      }),
      { numRuns: runs(50, 200) },
    );
  });

  it('V10 incremental vote equals batch vote for any order of the receptions (and computes per-row CER)', () => {
    const arbCorruptedScreen = fc
      .tuple(
        arbValidPageSource,
        fc.array(
          fc.record({
            idx: fc.integer({ min: 0, max: 999 }),
            erased: fc.boolean(),
            code: fc.integer({ min: 0x20, max: 0x7e }),
          }),
          { minLength: 0, maxLength: 80 },
        ),
      )
      .map(([page, edits]) => {
        const built = buildPageScreen(page);
        const s = built.ok ? cloneScreen(built.value.screen) : createBlankScreen();
        for (const e of edits) {
          const r = Math.floor(e.idx / SCREEN_COLS);
          const c = e.idx % SCREEN_COLS;
          s.rows[r][c] = e.erased
            ? createBlankCell({ error: true })
            : createBlankCell({ code: e.code, error: false });
        }
        return s;
      });

    fc.assert(
      fc.property(
        fc.array(arbCorruptedScreen, { minLength: 1, maxLength: 6 }),
        (screens) => {
          const batchRes = vote(screens);

          // Reverse and rotated orders via IncrementalVote
          const reversed = [...screens].reverse();
          const incRev = new IncrementalVote();
          for (const s of reversed) {
            incRev.add(s);
          }
          const revRes = incRev.result();

          expect(revRes.unresolved).toBe(batchRes.unresolved);
          expect(Array.from(revRes.agree)).toEqual(Array.from(batchRes.agree));
          expect(Array.from(revRes.valid)).toEqual(Array.from(batchRes.valid));
          expect(screensEqual(revRes.screen, batchRes.screen)).toBe(true);
        },
      ),
      { numRuns: runs(50, 200) },
    );

    // Per-row and overall cellErrorRate check
    const ref = createBlankScreen();
    const damaged = cloneScreen(ref);
    damaged.rows[3][0] = createBlankCell({ error: true });
    damaged.rows[3][1] = createBlankCell({ code: 0x58 });
    const byRow = cellErrorRateByRow(damaged, ref);
    expect(byRow[3]).toBeCloseTo(2 / 40, 8);
    expect(byRow[1]).toBe(0);
    expect(cellErrorRate(damaged, ref)).toBeCloseTo(2 / 1000, 8);
  });
});
