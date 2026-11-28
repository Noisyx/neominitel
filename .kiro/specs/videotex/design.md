# Design: videotex

## Overview
```
PageSource ──► encoder ──► Uint8Array (7-bit) ──► [modem] ──► chars + error flags
                                                                     │
Screen ◄── decoder (byte by byte, reports changed cells) ◄──────────┘
  │
  ├── vote (N screens → repaired screen + confidence)
  ├── metrics (cell error rate vs reference)
  └── render model (glyph bitmaps, mosaic blocks, palette) ──► canvas (UI)
```

## Code tables (`src/videotex/codes.ts`)
All values below come from our reading of the Minitel Videotex standard. Entries marked **(verify)** must be checked against STUM1B before the pitch; the check is task 1.3.

### C0 control codes
| Code | Name | Effect |
|---|---|---|
| 0x07 | BEL | Ignored (HUD shows a bell) |
| 0x08 | BS | Cursor left; from column 1 to column 40 of the previous row |
| 0x09 | HT | Cursor right; wraps like printing |
| 0x0A | LF | Cursor down; row 24 → row 1. From row 0: back to row 1, column 1 (Deviation 2) |
| 0x0B | VT | Cursor up; row 1 → row 24 |
| 0x0C | FF | Clear rows 1-24, cursor to row 1 column 1, reset attributes, G0 |
| 0x0D | CR | Cursor to column 1 |
| 0x0E | SO | Switch to G1 (mosaic) |
| 0x0F | SI | Switch to G0 (alphanumeric) |
| 0x11 / 0x14 | DC1 / DC4 | Cursor visible / hidden |
| 0x12 | REP | Next byte 0x40 + n: repeat the last printed character n times (1 ≤ n ≤ 63) |
| 0x13 | SEP | Next byte: key code (table below). Ignored on the forward channel |
| 0x18 | CAN | Clear from the cursor to the end of the row; cursor unchanged |
| 0x19 | SS2 | Next byte(s) from G2 (accents table) |
| 0x1B | ESC | Attribute or protocol sequence (table below) |
| 0x1E | RS | Cursor to row 1 column 1, reset attributes, G0 |
| 0x1F | US | Next two bytes: row 0x40 + r (0 ≤ r ≤ 24), column 0x40 + c (1 ≤ c ≤ 40). Resets attributes and G0 **(verify)** |
| others | | Ignored, counted as unknown |

### ESC sequences
| Bytes after ESC | Effect |
|---|---|
| 0x40-0x47 | Foreground colour 0-7 |
| 0x48 / 0x49 | Flash / steady |
| 0x4C / 0x4D / 0x4E / 0x4F | Normal size / double height / double width / double size `[STRETCH]` |
| 0x50-0x57 | Background colour 0-7 |
| 0x59 / 0x5A | Contiguous mosaic (underline off) / disjoint mosaic (underline on) |
| 0x5C / 0x5D | Normal / inverse video |
| 0x39 x, 0x3A x y, 0x3B x y z | Protocol sequences PRO1/PRO2/PRO3: parameters skipped **(verify)** |
| 0x5B ... final | CSI sequence: skipped up to its final byte (0x40-0x7E) |
| others | Ignored, counted as unknown |

Colours: 0 black, 1 red, 2 green, 3 yellow, 4 blue, 5 magenta, 6 cyan, 7 white.
Black-and-white palette, by increasing luminance: black, blue, red, magenta, green, cyan, yellow, white. Grey values are evenly spaced as a start **(verify the exact levels)**.

### G1 mosaic mapping
Blocks: b1 top-left, b2 top-right, b3 middle-left, b4 middle-right, b5 bottom-left, b6 bottom-right.
code = 0x20 + b1 + 2·b2 + 4·b3 + 8·b4 + 16·b5 + 64·b6.
Codes are therefore 0x20-0x3F and 0x60-0x7F; 0x7F is the full block. In G1, codes 0x40-0x5F are shown as their G0 character **(verify)**.

### G2 accents (SS2 + diacritic + letter)
| Diacritic byte | Accent | Letters supported |
|---|---|---|
| 0x41 | grave | à è ù |
| 0x42 | acute | é |
| 0x43 | circumflex | â ê î ô û |
| 0x48 | diaeresis | ë ï |
| 0x4B | cedilla | ç |
Example: é = 0x19 0x42 0x65. All other non-ASCII characters are transliterated (œ → oe, « → ", ’ → '). **(verify)**

### Function keys (SEP + code)
| Code | Key | | Code | Key |
|---|---|---|---|---|
| 0x41 | Envoi | | 0x46 | Sommaire |
| 0x42 | Retour | | 0x47 | Correction |
| 0x43 | Répétition | | 0x48 | Suite |
| 0x44 | Guide | | 0x49 | Connexion/Fin |
| 0x45 | Annulation | | | |
**(verify)**

## Interfaces

```ts
type CharSet = 'G0' | 'G1' | 'G2';
interface Cell {
  code: number; set: CharSet; accent?: number;     // accent = G2 diacritic byte
  fg: number; bg: number;
  flash: boolean; inverse: boolean; disjoint: boolean;
  doubleHeight: boolean; doubleWidth: boolean;
  error: boolean;
}
interface Screen {
  rows: Cell[][];                                   // 25 × 40, rows[0] = status row
  cursor: { row: number; col: number; visible: boolean };
  attrs: Omit<Cell, 'code' | 'accent' | 'error'>;   // current serial attributes
}
interface RxByte { value: number; error: boolean }  // error = parity or framing error
interface VideotexDecoder {
  push(b: RxByte): { changed: [row: number, col: number][] };
  screen(): Screen;
  stats(): { bytes: number; printable: number; controls: number; unknown: number; errorCells: number };
  reset(): void;
}

interface PageSource {
  id: string;                                       // e.g. 'sommaire/accueil'
  status?: string;                                  // text for row 0
  rows: { row: number; col?: number; segments: Segment[] }[];
  mosaics?: { row: number; col: number; bitmap: string[]; fg: number; bg: number }[];
}
type Segment = { text: string; fg?: number; bg?: number; flash?: boolean; inverse?: boolean; size?: 'normal' | 'doubleHeight' | 'doubleWidth' | 'double' };

function encodePage(p: PageSource): Result<{ bytes: Uint8Array; warnings: string[] }, PageError>;
function vote(screens: Screen[]): { screen: Screen; agree: Uint8Array; valid: Uint8Array; unresolved: number };
class IncrementalVote { add(s: Screen): void; result(): ReturnType<typeof vote> }
function cellErrorRate(s: Screen, ref: Screen, rows?: number[]): number;
```

`mosaics[].bitmap` is a list of strings of `#` and `.`, one per block row, with width a multiple of 2 and height a multiple of 3.

## Algorithms

### Decoder
- State machine: `NORMAL`, `ESC`, `ESC_PARAMS(k)`, `CSI`, `US_ROW`, `US_COL`, `REP_COUNT`, `SS2_1`, `SS2_2`, `SEP_KEY`.
- A byte flagged `error` always aborts the current sequence, writes an error cell at the cursor with the current attributes, and advances the cursor.
- Printing writes `{code, set, attrs}` at the cursor, then advances: column 40 → column 1 of the next row, row 24 → row 1.
- REP repeats the last printed cell, including its attributes. REP with no previous character is ignored.
- US to an invalid position (row > 24 or column outside 1-40) is ignored and counted as unknown.

### Encoder (robust page encoding)
1. Emit FF, then DC4 (cursor hidden).
2. For **every** row 1-24, in order, emit US (row, first column) and the active attributes that differ from the US defaults (empty rows need only US, since US already resets attributes to defaults). With US on every row, a lost byte damages at most the row before, its own row and the row after (property V3).
3. Within each non-empty row, re-anchor the cursor and active attributes with US (row, column) every 8 columns whenever the background delimiter rule allows (`bg` is black or the cell is a space / mosaic delimiter), so a mid-row burst or UART framing slip cannot shift all remaining columns of the row.
4. Emit segments. Change the background colour only just before a space or a mosaic character (Deviation 1).
5. Replace runs of 4 or more identical cells with the character followed by REP (0x40 + n − 1), splitting runs longer than 64.
6. Accents: SS2 + diacritic + base letter.
7. Row 0 (status): US 0x40 0x41 then the text (plus CAN when shorter than 40 columns), emitted last.

### Mosaic from image `[STRETCH]`
For each 2×3 cell, try all 28 pairs of distinct palette colours plus the 8 single colours; assign each block to the nearer colour of the pair; keep the pair with the lowest squared error. Optional Floyd-Steinberg error diffusion between cells.

Implementation (task 9, `src/videotex/image-mosaic.ts`, pure):
```ts
interface RgbImage { width: number; height: number; data: ArrayLike<number>; channels?: 3 | 4 }   // row-major, alpha ignored
interface ImageMosaicOptions { palette?: readonly [number, number, number][]; diffusion?: boolean; row?: number; col?: number }
interface MosaicCellChoice { fg: number; bg: number; blocks: [0|1, 0|1, 0|1, 0|1, 0|1, 0|1]; error: number }
function resampleToBlocks(img: RgbImage, blocksWide: number, blocksHigh: number): MosaicResult<Float64Array>;
function imageToMosaic(img: RgbImage, cols: number, rows: number, o?: ImageMosaicOptions):
  MosaicResult<{ cells: MosaicCellChoice[][]; totalError: number; sources: MosaicSource[] }>;
```
- The image is first resampled to 2·cols × 3·rows blocks by a box filter (mean of the covered pixels, fractional coverage at the edges), so any image size works. The caller decodes the image file (canvas in the UI); the module has no DOM.
- Distance: squared RGB distance to the palette colour (default `COLOUR_PALETTE_RGB`). Ties: a block equally near both colours takes the background; between candidates, the first in the order singles 0..7, then pairs (0,1), (0,2) … (6,7) wins. A pair is written fg < bg by colour code; a single colour c is fg = bg = c with every block off.
- Diffusion: the residual of each block goes to blocks of cells not yet decided with the weights 7/16 (right), 3/16 (down-left), 5/16 (down), 1/16 (down-right); weights falling in decided cells or outside the image are dropped and the rest renormalised.
- `sources`: one `MosaicSource` per horizontal run of cells with the same (fg, bg), at (row, col) (defaults 1, 1), ready for a `PageSource`. Errors (`bad-bitmap`): cols outside 1..40, rows outside 1..24, a grid that does not fit at (row, col), or image data shorter than width × height × channels.
- Used by 3615 LIBRE (app task 16, Role A) for the image import.

### Vote
- Two cells are equal when every field except `error` is equal.
- For each cell, count values among non-error cells (a map from the serialized cell to its count). The winner needs a strict majority over the other values; otherwise, or if there are no valid votes, the cell is an error cell.
- `IncrementalVote` keeps the counts per cell, so adding a reception costs 1 000 updates.
- **Burst-resilient alignment (`voteAligned`, added after `docs/calibration.md` L4 analysis):** when noise bursts destroy `US` cursor positioning codes or slip UART framing mid-row, two failure modes arise in plain cell-by-cell voting: (a) skipped rows/spans stay at `FF`-cleared blank cells (`error: false`) and outvote genuine characters, and (b) contiguous clean islands after an error on the row shift horizontally (or land on `r − 1` when `US(r)` is lost). `VideotexDecoder.visitedMask()` records which cells were explicitly written since `FF`/`reset`, and `voteAligned` performs two symmetric Jacobi passes realigning post-error islands (`≥ 3` cells) against the consensus of the other receptions before tallying votes while keeping unvisited blanks subordinate to any `≥ 2`-reception explicit consensus (property V15).

### Math notes (for 3615 MATHS)
- If each reception damages a cell independently with probability p, and every damage is detected (erasure), the vote fails only when all N copies are erased: P_fail = pᴺ.
- If damage is undetected (wrong value) with probability q, the plain majority fails with probability Σ_{k > N/2} C(N, k)·qᵏ(1 − q)ᴺ⁻ᵏ.
- One parity bit detects every single-bit error and no double-bit error. With bit error rate ε over the 8 checked bits, P(undetected) ≈ C(8, 2)·ε² for small ε. 3615 MATHS shows the measured erasure and undetected rates next to these formulas.

## Deviations from the real Minitel
1. **Background colour:** applied immediately to the following characters. On a real terminal it is validated by a delimiter (space or mosaic). The encoder only changes it before a delimiter, so our pages look the same on both.
2. **Row 0:** LF from row 0 goes to row 1, column 1, instead of restoring the previous position.
3. **Page mode only:** no scroll mode.
4. **Skipped sequences:** PRO1-3 and CSI are skipped, not executed.
5. **Error cells:** drawn as a hatched block. We do not claim this is the historical rendering.
6. **Not implemented:** masking, DRCS (redefinable characters). Double size is implemented (task 8) following the miedit emulator; its direction was not checked on a real Minitel.

## Rendering model
- Cell: 8 × 10 pixels; the screen is 320 × 250 pixels before scaling.
- Mosaic blocks: columns of 4 + 4 pixels, rows of 3 + 4 + 3 pixels. Disjoint blocks leave a 1-pixel gap on the right and bottom.
- Inverse swaps fg and bg (G0 only). Flash: hidden for 1/3 of a 1 s period, unless `prefers-reduced-motion`.
- Double height draws the glyph scaled ×2 vertically over the current row and the row above. Checked against the miedit emulator (F. Bisson, `library/minitel/decoder.js`), **not on a real Minitel**.

### Character size (task 8)
- Cell field `part?: { x: 0 | 1; y: 0 | 1 }`: which part of an enlarged character the cell shows (x: left / right half, y: top / bottom half); absent for normal size. `cellsEqual` and the vote compare it. The origin cell (`isCharacterOrigin`) is the bottom-left part, where the cursor was.
- Decoder: a G0 / G2 character with double width fills 2 columns; with double height its top half goes on the row above the cursor. Parts outside the page (column 41, above row 1) are dropped. The cursor moves by the width; past column 40 it goes to column 1, down by the height (page mode, row 24 continues on row 1). Error bytes and REP follow the same geometry.
- Refused size codes (as miedit): any size code in G1 (mosaics are never enlarged) and on the status row; a size with double height on row 1. SO and SI return to normal size.
- Rendering: nearest-neighbour ×2 of the 8 × 10 glyph (`scaleGlyphPart`), underline included.
- Encoder: a double-width segment counts 2 columns per glyph. Double height needs a free row above (not row 1, no text row or mosaic on row r − 1); otherwise it is drawn at normal height with a warning. The row above is sent empty and the top halves are drawn by the bytes of row r, which come later. Right halves send no byte. After SO / SI the encoder sends the size again. A row that ends enlarged is followed by ESC 0x4C (normal size), so that a corrupted US on the next row does not print that row's characters enlarged. A lost US on a double-height row itself still reaches r−2 (V3).
- Not handled: double size inside the status row, and the "delimiter" behaviour of enlarged spaces for background colour (Deviation 1 applies as for normal size).

## Correctness properties
| ID | Property |
|---|---|
| V1 | Round-trip: for any valid PageSource (text from the supported alphabet with accents, colours, mosaics), decoding encodePage(p) gives the screen expected for p, cell by cell. |
| V2 | Byte-by-byte decoding and one-shot decoding give the same screen. |
| V3 | Locality: replacing any single byte except the first (FF) with an error-flagged byte changes cells only in rows r−1, r and r+1, where r is the row being written; r−2 to r+2 when row r holds double-height characters (task 8: if its US is lost, they print one row early and their top halves reach r−2; a wrap moves down 2 rows). |
| V4 | REP: encoding with and without REP gives the same screen. |
| V5 | Mosaic: for every 6-bit pattern, the G1 code is in 0x20-0x3F ∪ 0x60-0x7F and decodes back to the same pattern. |
| V6 | Robustness: for any byte sequence (0-127, random error flags), the decoder never throws and the cursor stays inside the screen. |
| V7 | Encoder output contains only bytes ≤ 127 and starts with FF. |
| V8 | Vote, erasures: with N copies of a screen where each cell is erased in at most N − 1 copies, the vote returns the reference exactly. |
| V9 | Vote, majority: with N = 2k + 1 copies where each cell has at most k wrong (non-erased) values, the vote returns the reference exactly. |
| V10 | Incremental vote equals batch vote for any order of the receptions. |
| V11 | Keys: decodeKey(encodeKey(k)) = k for the nine function keys. |
| V12 `[STRETCH]` | Image to mosaic optimality: without diffusion, every cell's squared error equals the error of its reported colours and blocks and is ≤ that of every single colour and every pair of the palette. |
| V14 `[STRETCH]` | Character size: double width fills 2 columns and moves the cursor by 2; double height fills the cursor cell and the cell above; size codes are ignored in G1, on the status row and (with double height) on row 1; SO / SI reset the size; the parts of an enlarged character tile its glyph scaled ×2. |
| V13 `[STRETCH]` | Image to mosaic round trip: an image with at most two palette colours per cell gives total error 0 (with or without diffusion), and decoding encodePage of its `sources` gives, cell by cell, the chosen G1 code, fg and bg. |
| V15 | Vote alignment under bursts: given ≥ 3 receptions of a valid PageSource where individual receptions suffer shifted post-error character islands or unvisited rows (`visitedMask = 0`) while at least two receptions preserve each character, `voteAligned` recovers the reference row regardless of reception order. |

## Error handling
- `PageError`: `{ kind: 'row-too-long'; row: number; length: number } | { kind: 'too-many-rows' } | { kind: 'bad-bitmap'; reason: string }`.
- The decoder never throws (V6).

## Testing
- Property tests V1-V13 in `tests/properties/videotex.test.ts`.
- Golden tests: a handful of hand-written byte sequences with expected screens, including every code in the tables.
