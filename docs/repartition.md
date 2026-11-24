# Task split

Two roles. Put your first names here:

- **A — Development**: ________ (the site, the on-screen Minitel, sound, microphone, services, deployment)
- **B — Math, signal and Kiro**: ________ (the modem brain, the theory, 3615 MATHS, level tuning, the Kiro hooks)

## Tools

- **B works in Kiro.** B runs tasks from the `tasks.md` files. Kiro is expected to tick the boxes as tasks complete, but this has not been verified yet: until it has been observed, B ticks the boxes by hand when a task is done. This is the work the jury will see in the "how we used Kiro" part.
- **A works in another editor** (while waiting for Kiro credits). A's AI assistant reads `AGENTS.md`, which points to the same rules (`.kiro/steering/`) and the same specs. A ticks the `[x]` boxes in `tasks.md` when a task is done, so that Kiro sees the progress.
- If A gets credits along the way, A switches to Kiro. Nothing else changes.

## Kiro hooks and manual check (B, J1, about 30 min)

In Kiro, **Agent Hooks** panel, describe each of the four hooks in one sentence:

1. When a file in `src/modem/` is saved, run the fast tests of `tests/properties/v23-modem.test.ts`.
2. When a file in `content/pages/` is saved, run the content test (A6: size, allowed characters, pages different enough).
3. When `content/fantome/levels.json` changes, rerun `scripts/generate-transmissions.ts --verify-only`.
4. When a `design.md` changes, check that every property (M1, V3, H2…) has a test with the same name, and report it otherwise.

Manual check (not a hook): before a commit or on request, check that no ghost code appears in clear text in `public/` (H4). It becomes automatic only if a real Git hook is installed.

Hooks 2 and 3 watch A's folders. They only fire once the watched files exist.

The numbers refer to the `tasks.md` files of each spec in `.kiro/specs/`. For example, "modem 5" = task 5 of `v23-modem/tasks.md`.

---

## How not to step on each other

**Each person has their own folders.** As long as everyone stays in theirs, git almost never creates conflicts.

| | A touches | B touches |
|---|---|---|
| Code | `src/videotex/`, `src/ui/`, `src/audio/`, `src/workers/`, `src/services/`, `src/fantome/`, `scripts/` (except B's three files) | `src/modem/`, `prototypes/`, `scripts/calibrate-modem.ts`, `scripts/montecarlo-ber.ts`, `scripts/bench-modem.ts`, `tests/helpers/modem-*.ts`, `tests/properties/v23-modem.test.ts` |
| Content | `content/pages/` (except MATHS), `content/fantome/` | `content/pages/maths.ts` |
| Data | reads `public/data/ber-curve3.json` | generates `public/data/ber-curve3.json` |
| Docs | `README.md`, `docs/demo-checklist.md` | `docs/math.md`, `docs/calibration.md` |

**The contract between you** is the TypeScript interfaces of `v23-modem/design.md` (section "Interfaces"): `modulate()`, `StreamingDemodulator`, `DemodEvent`. On J1 you review them together. You change them, or property M4, only with the written approval of both.

**A does not wait for B.** Until the real demodulator is ready, A uses a fake demodulator that returns the right bytes directly. When B delivers the real one (around J3), A plugs it in instead. Until task 8 (J5), the real demodulator only accepts `threshold: 'fixed'`, which A passes explicitly.

**Git routine**: `pull` before starting, `commit` + `push` after each finished task.

---

## A — Development

| Days | Tasks | Visible result |
|---|---|---|
| **J1** (23 Nov) | modem 1: create the project (Vite, TypeScript, tests) and push it to GitHub. Fake demodulator. | B can clone and code that evening |
| **J2** | videotex 1, 2, 3: code tables, screen model, decoder | Bytes give a screen |
| **J3** | videotex 4, 5, 7: encoder, keys, font and rendering. app 1: the drawn Minitel, the start screen | A page shows in the Minitel |
| **J4** | app 2, 3: worker, sound playback, page drawing at the pace of the sound. Plug in B's real modem | **Click on Connexion → SOMMAIRE draws itself** |
| **J5** | app 4, 5, 6: router, services, Minitel keyboard, end-to-end test | We navigate the 3615 services |
| **J6** | app 7, 8: Écoute mode (microphone) and Serveur mode (speaker) | **First phone → computer test** (with B) |
| **J7** | videotex 6 + app 10: majority vote. app 9: the HUD (charts) | Répétition repairs a damaged page |
| **J8** | app 11.2 and 11.3: UI of the test bench and the Vote page (with B). app 13: simulator settings | 3615 MATHS works |
| **J9** | fantome 1, 2, 3: story, pages, level generator and checker | The level sound files exist |
| **J10** | fantome 4, 6: the 3615 FANTOME service, code entry | **Levels 1 to 4 are playable** |
| **J11** | app 12, 14, 15: Fichier mode, accessibility, polish, deployment | The site is online |
| **J12** (4 Dec) | Video, README, submission **before 23:00 Paris time** (with B) | Submitted |

If time allows (in this order): app 17 (backward channel in the site, when B has finished modem 14), app 16 (3615 LIBRE), videotex 8 (double size).

---

## B — Math, signal and Kiro

| Days | Tasks | Visible result |
|---|---|---|
| **J1** (23 Nov) | Read `v23-modem` in full. Review the interfaces with A. Create the 4 Kiro hooks and the manual check list. Numerical prototypes E1 and E3a (`prototypes/dsp/`). Start `docs/math.md`: what the modem does, in plain words | The contract is frozen, Kiro is ready |
| **J2** | modem 2, 3, 4: constants, framing, modulator, WAV files. Prototypes E7, E2 (morning), then E3b and E3c | A text becomes a listenable modem sound |
| **J3** | modem 5, 6: discriminator (read the frequency), UART (read the letters back). First benchmark | **Sound → text works** (test M1), delivered to A |
| **J4** | modem 7: streaming demodulator, carrier detection and connection tone | A plugs in the real modem |
| **J5** | modem 8: adaptive threshold (the "automatic tuning") | A signal shifted by 380 Hz decodes |
| **J6** | modem 9: line simulator (noise, offset, hum). First phone → computer test (with A) | We can damage the signal on purpose |
| **J7** | modem 10: SNR estimation (M2M4), PN9 sequence, error-rate measurement | The measured error rate shows |
| **J8** | modem 11: the three theory curves (including the Marcum formula for h = 2/3), Monte Carlo simulation. Test bench UI (with A) | **Measured points land on the curve** |
| **J9** | app 11.1: the 6 explanation pages of 3615 MATHS. Check the vote formulas (videotex spec, "Math notes") | 3615 MATHS has content |
| **J10** | fantome 5: tune level difficulty with two real devices. modem 12: calibration | Levels are hard but doable |
| **J11** | modem 13: performance. Review of all the MATHS content. Demo rehearsal | Everything holds in real time |
| **J12** (4 Dec) | Video: the 3615 MATHS sequence and the "how we used Kiro" sequence (specs, tests, hooks in action) (with A) | Submitted |

If time allows (in this order): modem 14 + fantome 7 (backward channel and level 5), modem 15 (second demodulator), videotex 9 (mosaic image).

---

## What you do together

| When | What |
|---|---|
| J1 | Review the modem interfaces (30 min) and sign the Eb/N0 convention |
| J6 | First real test: a phone plays, a computer listens |
| J8 | MATHS test bench (B gives the calculations, A does the display) |
| J10 | Test the ghost levels with two devices |
| Before J11 | videotex 1.3: check the codes marked "(verify)" in the STUM1B standard (whoever has time) |
| J12 | Shoot the 3-minute video and submit |

**Daily 10-minute check-in**: what I finished, what I am doing, what blocks me.

## Checkpoints (if one is missed, we cut a bonus)

| Date | What must be true |
|---|---|
| J4 (26 Nov) | SOMMAIRE draws itself in Seul mode, with the real modem |
| J6 (28 Nov) | A page goes from a phone to a computer by sound |
| J8 (30 Nov) | 3615 MATHS shows measured points on the curve |
| J10 (2 Dec) | Levels 1 to 4 of 3615 FANTOME are playable |
| J11 (3 Dec) | The site is online, no new feature after that |
