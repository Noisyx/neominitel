# NeoMinitel

> *30 juin 2012 : la France débranche le Minitel.* NeoMinitel brings it back the way it really worked: pages travel as sound.

NeoMinitel is a Kiroween 2026 entry (category **Resurrection**). A real V.23 modem (1200 baud to the terminal, 75 baud back), rebuilt in the browser, turns Videotex pages into the famous modem screech and decodes them again, live, from a microphone. A phone plays the server, a laptop is the Minitel, and the page draws itself line by line, as in 1985. No internet is involved: the data travels through the air of the room.

## Services
- **3615 SOMMAIRE**: the menu.
- **3615 MATHS**: how the modem works, with a live bench where measured bit error rates land on the theoretical curves.
- **3615 FANTOME**: a haunted Halloween service. Five ghost transmissions, each damaged by a real signal problem and solved by a real modem feature.
- **3615 LIBRE** (stretch): draw your own page and send it by sound.

## Built with Kiro
This project is developed spec-first with [Kiro](https://kiro.dev). Everything lives in [`.kiro/`](.kiro):
- **Steering:** [`product.md`](.kiro/steering/product.md), [`tech.md`](.kiro/steering/tech.md), [`structure.md`](.kiro/steering/structure.md).
- **Specs:** each spec has requirements (EARS), design (with correctness properties) and tasks.
  - [`v23-modem`](.kiro/specs/v23-modem): modulation, demodulation, adaptive threshold, line simulator, BER measurement.
  - [`videotex`](.kiro/specs/videotex): 40×25 screen, decoder and encoder, mosaics, majority vote.
  - [`neominitel-app`](.kiro/specs/neominitel-app): terminal, line modes, services, Math HUD.
  - [`fantome`](.kiro/specs/fantome): the haunted levels, generated and verified offline.
- Every correctness property in a design is a property-based test (Vitest + fast-check).

## Status
Specifications written. Implementation in progress.

## Stack
TypeScript, Vite, React, Web Audio API (AudioWorklet), Web Workers, Vitest, fast-check. Static site, no back-end.

## License
[MIT](LICENSE)
