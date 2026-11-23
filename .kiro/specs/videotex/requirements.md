# Requirements: videotex

## Introduction
`videotex` is the pure TypeScript page layer of NeoMinitel. It turns page descriptions into the Videotex byte stream understood by a Minitel, and turns received bytes back into a 40×25 screen, character by character. It also repairs pages received several times, using a majority vote that treats parity errors as erasures.

We implement a **documented subset** of the Minitel Videotex standard (STUM1B). Every simplification is listed in `design.md`, section "Deviations". Codes marked "to verify" in the design must be checked against the STUM1B document before the pitch.

**Priority tags:** `[MVP]` is needed for the demo. `[STRETCH]` is done only if time allows.

## Glossary
- **Screen:** 40 columns × 25 rows. Row 0 is the status row; rows 1 to 24 hold the page.
- **G0:** the alphanumeric character set. **G1:** the semi-graphic (mosaic) set, where each character is a 2×3 grid of blocks. **G2:** extra characters, used here for French accents through the SS2 prefix.
- **Mosaic resolution:** 80 × 72 blocks over the page area.
- **Serial attribute:** a colour or style set by an escape sequence that applies to the following characters.
- **Erasure:** a cell known to be wrong (received with a parity or framing error), as opposed to an undetected error.
- **PageSource:** our own description of a page (text, colours, mosaics), stored in `content/pages/`.

## Requirement 1: Screen model `[MVP]`
**User Story:** As a developer, I want a plain data model of the Minitel screen, so that decoding, voting and rendering share it.

#### Acceptance Criteria
1. THE screen SHALL hold 25 rows × 40 cells, each with: character code, set (G0, G1 or composed G2), foreground colour (0-7), background colour (0-7), and flags `flash`, `inverse`, `disjoint`, `doubleHeight`, `doubleWidth`, `error`.
2. THE screen SHALL hold the cursor position, the cursor visibility and the current serial attributes.
3. THE screen SHALL be serializable to JSON and comparable cell by cell.

## Requirement 2: Decoding `[MVP]`
**User Story:** As a terminal, I want to apply received bytes to the screen exactly like a Minitel, so that pages written for a Minitel display correctly.

#### Acceptance Criteria
1. THE decoder SHALL implement the C0 codes listed in the design: BS, HT, LF, VT, FF, CR, SO, SI, DC1, DC4, REP, CAN, SS2, ESC, RS, US.
2. THE decoder SHALL implement the ESC attribute sequences listed in the design: foreground and background colours, flash/steady, normal/double height/double width/double size, normal/inverse, contiguous/disjoint mosaic.
3. WHEN a printable byte arrives, THE decoder SHALL write it at the cursor with the current attributes and advance the cursor. After column 40, the cursor SHALL move to column 1 of the next row. After row 24, it SHALL return to row 1 (page mode).
4. WHEN a byte arrives flagged with a parity or framing error, THE decoder SHALL write an error cell at the cursor, advance the cursor, and not interpret the byte as a control code.
5. THE decoder SHALL ignore unknown control codes and unknown escape sequences, and count them in its statistics.
6. THE decoder SHALL never throw, and the cursor SHALL always stay inside the screen, for any byte sequence.

## Requirement 3: Streaming decoding `[MVP]`
**User Story:** As a user, I want to see the page draw itself as bytes arrive, so that I see the real 1200-baud rhythm.

#### Acceptance Criteria
1. THE decoder SHALL accept bytes one at a time and report the cells changed by each byte.
2. Decoding a byte sequence in one call or byte by byte SHALL produce the same screen.

## Requirement 4: Encoding `[MVP]`
**User Story:** As a service author, I want to describe pages in a simple format, so that I never write control codes by hand.

#### Acceptance Criteria
1. THE encoder SHALL turn a `PageSource` (rows of text segments with colours, plus mosaic blocks) into a Videotex byte sequence starting with FF.
2. THE encoder SHALL position every non-empty row with US (row, column), so that an error on the line damages at most the neighbouring rows.
3. THE encoder SHALL use REP for runs of 4 or more identical characters.
4. THE encoder SHALL only change the background colour just before a space or a mosaic character, so that the result is the same with or without the delimiter rule of real terminals (see Deviations).
5. THE encoder SHALL output only 7-bit bytes.
6. IF a `PageSource` has a row longer than 40 cells or more than 24 rows, THEN THE encoder SHALL return a typed error naming the row.

## Requirement 5: French accents `[MVP]`
**User Story:** As a French user, I want accented characters, so that pages read naturally.

#### Acceptance Criteria
1. THE encoder SHALL encode à â ç è é ê ë î ï ô ù û with SS2, a diacritic code and the base letter.
2. THE decoder SHALL compose these sequences into a single cell displaying the accented letter.
3. THE encoder SHALL transliterate any other non-ASCII character deterministically (for example œ → oe), and report it as a warning.

## Requirement 6: Mosaics `[MVP]`
**User Story:** As a service author, I want to draw with mosaic blocks, so that pages have the classic Minitel look (logos, ghosts, charts).

#### Acceptance Criteria
1. THE system SHALL map any 2×3 block pattern to its G1 code and back.
2. THE encoder SHALL accept a 1-bit bitmap (up to 80 × 72) with a foreground and background colour, and output the matching G1 characters.
3. `[STRETCH]` THE system SHALL convert an RGB image to a mosaic page, choosing for each cell the two colours that minimize the squared error over its six blocks.

## Requirement 7: Keyboard codes `[MVP]`
**User Story:** As a terminal, I want Minitel function keys encoded as on the original, so that services and the backward channel speak the same language.

#### Acceptance Criteria
1. THE system SHALL encode the function keys Envoi, Retour, Répétition, Guide, Annulation, Sommaire, Correction, Suite and Connexion/Fin as SEP followed by their code (see design).
2. THE system SHALL decode such sequences back into key names.

## Requirement 8: Majority vote `[MVP]`
**User Story:** As a user receiving a noisy page, I want several receptions combined, so that the page is repaired.

#### Acceptance Criteria
1. GIVEN N ≥ 2 screens of the same page, THE vote SHALL produce one screen in which each cell is the most frequent value among the cells that are not erasures.
2. IF no valid value exists for a cell, or the top values are tied, THEN THE cell SHALL be marked `error`.
3. THE vote SHALL report, per cell, the number of agreeing votes and valid votes, and globally the number of unresolved cells.
4. THE vote SHALL be updatable incrementally: adding one more reception SHALL give the same result as voting over all receptions at once.

## Requirement 9: Page metrics `[MVP]`
1. THE system SHALL compute the cell error rate between a screen and a reference screen, overall and per row.
2. THE system SHALL report decoder statistics: bytes, printable characters, control codes, unknown codes, error cells.

## Requirement 10: Rendering model `[MVP]`
**User Story:** As the UI, I want a pixel-exact description of each cell, so that the canvas renderer stays simple.

#### Acceptance Criteria
1. THE system SHALL provide two palettes: colour (8 RGB colours) and black-and-white (8 grey levels ordered by luminance, as on the Minitel 1).
2. THE system SHALL provide, for each cell, its glyph bitmap (8 × 10 pixels) or its mosaic blocks, with colours resolved.
3. THE glyph font SHALL be drawn for the project or carry an open licence recorded in `docs/licenses.md`.
