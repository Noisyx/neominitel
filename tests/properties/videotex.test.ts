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

describe('Videotex Property Tests', () => {
  const arbRxByte: fc.Arbitrary<RxByte> = fc.record({
    value: fc.integer({ min: 0, max: 127 }),
    error: fc.boolean(),
  });

  it('V2: byte-by-byte decoding and one-shot decoding give the same screen', () => {
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
      { numRuns: 100 },
    );
  });

  it('V5: for every 6-bit pattern, the G1 code is in 0x20-0x3F ∪ 0x60-0x7F and decodes back to the same pattern', () => {
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

  it('V6: for any byte sequence (0-127, random error flags), the decoder never throws and the cursor stays inside the screen', () => {
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
      { numRuns: 100 },
    );
  });
});
