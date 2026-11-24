# Implementation Plan: neominitel-app

Tags: `[MVP]` is needed for the demo, `[STRETCH]` only if time allows. Depends on `v23-modem` tasks 1-9 and `videotex` tasks 1-4.

- [x] 1. App shell `[MVP]`
  - [x] 1.1 React app, theme tokens, `MinitelShell` (original SVG), `ScreenCanvas` drawing a static screen model.
  - [x] 1.2 Start screen with the "30 juin 2012" line and the *Connexion* button.
  - _Requirements: 1.1, 4.1, 9.1_

- [x] 2. Line worker `[MVP]`
  - [x] 2.1 Worker with the protocol from the design; `transmit` with block streaming (100 ms, 3 blocks ahead).
  - [x] 2.2 Simulator in the block loop; `setSim`, `setThreshold`.
  - [x] 2.3 Videotex decoding in the worker; `diff`, `pageStart`, `pageEnd` events; spectrum in `diag`.
  - _Requirements: 2.1, 3.2, 13.1_

- [x] 3. Playback and scheduler `[MVP]`
  - [x] 3.1 Gapless block playback, mute, sample clock.
  - [x] 3.2 Scheduler applying timed events in `requestAnimationFrame`; property test A5.
  - [x] 3.3 Connection sequence on *Connexion*, then SOMMAIRE in `Seul` mode.
  - _Requirements: 1.2-1.5_

- [ ] 4. Router, services and content `[MVP]`
  - [ ] 4.1 `Service` interface, router, local echo, *Répétition* handling.
  - [ ] 4.2 3615 SOMMAIRE pages and code entry; error page for unknown codes.
  - [ ] 4.3 Content lint (property A6).
  - [ ] 4.4 Property tests A1, A2.
  - _Requirements: 5.1-5.5_

- [ ] 5. Terminal keyboard `[MVP]`
  - On-screen function keys, PC shortcuts with `KeyboardEvent.code`, mobile text input, palette switch.
  - _Requirements: 4.2-4.5_

- [ ] 6. End-to-end loopback test `[MVP]`
  - Property test A3 for every page.
  - _Requirements: 2.1_

- [ ] 7. Microphone receive (`Écoute`) `[MVP]`
  - [ ] 7.1 Capture worklet, raw constraints check, `MessageChannel` to the worker.
  - [ ] 7.2 Permission screen, raw-audio warning, no-carrier hint.
  - _Requirements: 2.2, 10.1-10.3_

- [ ] 8. Server mode (`Serveur`) `[MVP]`
  - Service runs on this device, pages played clean through the speaker, local preview.
  - _Requirements: 2.3_

- [ ] 9. Math HUD `[MVP]`
  - [ ] 9.1 Waterfall, discriminator trace with threshold and bit windows, eye diagram.
  - [ ] 9.2 Quality readout, error counters, characters per second, text equivalents.
  - [ ] 9.3 Toggles: "Accord automatique", "Vote"; HUD hide; frame-rate check.
  - _Requirements: 8.1-8.4_

- [ ] 10. Vote in the app `[MVP]`
  - [ ] 10.1 Votes per page id (Seul, Serveur), similarity matching (Écoute).
  - [ ] 10.2 Vote panel; property test A4 (after calibration).
  - _Requirements: 7.1-7.4_

- [ ] 11. 3615 MATHS `[MVP]` (mathematician writes the pages)
  - [ ] 11.1 Six explanation pages with mosaic diagrams.
  - [ ] 11.2 "Banc d'essai": PN9 frames, BER chart with three curves and live points.
  - [ ] 11.3 "Vote" page: measured cell error rate after 1/3/5/7 receptions vs formulas.
  - _Requirements: 6.1-6.4_

- [ ] 12. File mode `[MVP]`
  - Drop or select a WAV, fast decode with progress, optional real-time playback, French error messages.
  - _Requirements: 2.4, 10.4_

- [ ] 13. Simulator controls `[MVP]`
  - Sliders and toggles, seeded replay.
  - _Requirements: 3.1-3.3_

- [ ] 14. Accessibility and polish `[MVP]`
  - Keyboard-only path, visible focus, reduced motion, aria-live screen summary, CRT overlay, property test A7.
  - _Requirements: 9.2-9.4_

- [ ] 15. Deployment `[MVP]`
  - Static build, HTTPS host, bundle size check, manual checklist on two devices and every browser.
  - _Requirements: 13.2-13.3_

- [ ] 16. 3615 LIBRE `[STRETCH]`
  - Page editor with mosaic painting, send by sound, WAV export, share link in the URL fragment.
  - _Requirements: 11.1-11.2_

- [ ] 17. Backward channel in the app `[STRETCH]`
  - Terminal sends keys at 75 baud; server device listens and drives the service.
  - _Requirements: 12.1_
