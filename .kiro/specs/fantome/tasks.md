# Implementation Plan: fantome

Tags: `[MVP]` is needed for the demo, `[STRETCH]` only if time allows. Depends on `v23-modem` tasks 1-10, `videotex` tasks 1-6 and `neominitel-app` tasks 2-4.

- [x] 1. Story and pages `[MVP]`
  - [x] 1.1 Write the story, the 5 story pages, the transmission pages with their code rows, the hints and the final page (French, mosaic ghosts).
  - [x] 1.2 `content/fantome/levels.json` with starting values from the design.
  - _Requirements: 1.1-1.2, 6.1_

- [x] 2. Generator `[MVP]`
  - [x] 2.1 Encode, modulate, repeat (L4), apply damage, procedural drone, normalize, write WAV.
  - [x] 2.2 Salt, normalized hashes, manifest.
  - [x] 2.3 Property test H1.
  - _Requirements: 4.1-4.2, 5.1, 3.4_

- [x] 3. Verifier `[MVP]`
  - [x] 3.1 Decode each WAV in Node with the feature on and off; CER checks from the design; seed search (max 50).
  - [x] 3.2 `--verify-only` flag; test decoding the committed WAVs (H2, H3).
  - _Requirements: 4.3-4.6, 5.2_

- [x] 4. Runtime service `[MVP]`
  - [x] 4.1 `playWav` extension of `ServiceOutput` in the app (worker real-time file decode).
  - [x] 4.2 `fantome.ts` service states, *Guide* hints, answer page with input field.
  - [x] 4.3 `check.ts` and `progress.ts`; property tests H5, H6.
  - [x] 4.4 Download link for each WAV (two-device play).
  - _Requirements: 1.3, 2.1-2.3, 3.1-3.3_

- [ ] 5. Calibration `[MVP]` (mathematician)
  - Tune Eb/N0, offset and repeats so that each level is hard but fair, by acoustic tests with two devices; record values in `docs/calibration.md`.
  - _Requirements: 4.3-4.5_

- [x] 6. No-leak check `[MVP]`
  - Property test H4 on `dist/` and `public/`.
  - _Requirements: 3.4_

- [ ] 7. Level 5, La voix du retour `[STRETCH]`
  - Needs `v23-modem` task 14. Decoy page, backward code page, "Écoute voie retour" toggle in the HUD.
  - _Requirements: 1.1_
