# Implementation Plan: videotex

Tags: `[MVP]` is needed for the demo, `[STRETCH]` only if time allows. Property tests reference the properties in `design.md`.

- [x] 1. Code tables `[MVP]`
  - [x] 1.1 `codes.ts` with C0, ESC, colours, G1 formula, G2 accents, SEP keys from the design.
  - [x] 1.2 Unit tests that every table entry has a name and no code is defined twice.
  - [x] 1.3 Check every entry marked "(verify)" against the STUM1B document; record the source and any change in `docs/videotex-notes.md`.
  - _Requirements: 2.1-2.2, 5.1, 6.1, 7.1_

- [x] 2. Screen model `[MVP]`
  - [x] 2.1 `Cell`, `Screen`, blank screen, JSON serialization, cell equality.
  - _Requirements: 1.1-1.3_

- [x] 3. Decoder `[MVP]`
  - [x] 3.1 State machine for C0 codes, cursor movement and wrapping.
  - [x] 3.2 ESC attributes, PRO1-3 and CSI skipping.
  - [x] 3.3 G1 printing, REP, SS2 accents.
  - [x] 3.4 Error-flagged bytes as error cells; statistics.
  - [x] 3.5 Golden tests; property tests V2, V6.
  - _Requirements: 2.1-2.6, 3.1-3.2, 9.2_

- [x] 4. Encoder `[MVP]`
  - [x] 4.1 Robust row encoding (US on every row, explicit attributes, background before delimiters).
  - [x] 4.2 REP compression, accents, transliteration with warnings, typed errors.
  - [x] 4.3 Mosaic bitmaps to G1.
  - [x] 4.4 Property tests V1, V3, V4, V5, V7.
  - _Requirements: 4.1-4.6, 5.1-5.3, 6.1-6.2_

- [x] 5. Keyboard codes `[MVP]`
  - `encodeKey` / `decodeKey`; property test V11.
  - _Requirements: 7.1-7.2_

- [x] 6. Vote and metrics `[MVP]`
  - [x] 6.1 Batch vote and `IncrementalVote` with erasures.
  - [x] 6.2 Cell error rate per row and overall.
  - [x] 6.3 Property tests V8, V9, V10.
  - _Requirements: 8.1-8.4, 9.1_

- [x] 7. Rendering model `[MVP]`
  - [x] 7.1 8 × 10 bitmap font for the supported characters (drawn for the project or open licence, recorded in `docs/licenses.md`).
  - [x] 7.2 Colour and black-and-white palettes, mosaic block geometry, inverse and flash.
  - _Requirements: 10.1-10.3_

- [ ] 8. Double height and width `[STRETCH]`
  - Implement after verifying the direction of double height on a real Minitel reference.

- [ ] 9. Image to mosaic `[STRETCH]` (mathematician)
  - Per-cell best colour pair, optional error diffusion; used by 3615 LIBRE.
  - _Requirements: 6.3_
