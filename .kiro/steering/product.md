---
inclusion: always
---

# Product: NeoMinitel

## Pitch
On 30 June 2012, France switched off the Minitel network. NeoMinitel brings it back the way it really worked: **pages travel as sound**. A real V.23 modem (1200 baud to the terminal, 75 baud back) runs in the browser. It turns Videotex pages into the famous modem screech and decodes them again, live, from a microphone. One phone plays the server, a laptop is the Minitel, and the page draws itself line by line at 120 characters per second, exactly as in 1985.

Hackathon: Kiroween 2026, category **Resurrection**. Deadline: 4 December 2026, 14:00 PST (23:00 Paris).

## Users
- **The jury** (3-minute video): must understand and feel the project without installing anything.
- **Retro-computing fans**: want authentic tones, authentic bytes, authentic 3615 feel.
- **Signal-processing students**: want to see the math behind a modem (the 3615 MATHS service).

## Principles
1. **Authentic protocol.** Real V.23 frequencies, real 7-bit even-parity framing, real Videotex control codes. When we simplify, we document it in the spec (never pretend).
2. **The math is visible.** Every decision the modem makes (threshold, bit timing, parity, vote) can be shown in the HUD.
3. **Zero friction.** It works with one device, no microphone permission, no account, no install. Two devices make it magic, not mandatory.
4. **Static site, no back-end.** Audio never leaves the device.
5. **Halloween through the protocol.** 3615 FANTOME is haunted by signal problems that the player solves with real DSP features.

## Non-goals
- No AI chatbot, no LLM, no server-side service.
- No connection to real phone lines or real Minitel hardware.
- Not a complete STUM1B implementation: we implement a documented subset (see `videotex` spec).
- No accounts, no network multiplayer.
- No Orange / France Télécom logos or trademarks. The terminal shell is an original drawing inspired by the 1980s look.

## Services
| Service | Priority | Content |
|---|---|---|
| 3615 SOMMAIRE | MVP | Menu and welcome page |
| 3615 MATHS | MVP | The mathematician's service: explanations + live BER test bench |
| 3615 FANTOME | MVP (levels 1-4), STRETCH (level 5) | Haunted puzzle: 5 ghost transmissions |
| 3615 LIBRE | STRETCH | Page editor, send your own page by sound |

## 3-minute demo script
1. **0:00** Black screen, one line: "30 juin 2012 : la France débranche 9 millions de Minitel." Press *Connexion*: the real connection tones play.
2. **0:20** 3615 SOMMAIRE draws itself at 1200 baud. The HUD shows the two tones (1300 / 2100 Hz) and the bits being sampled.
3. **0:50** Two devices: a phone plays the page, the laptop receives it over the air. Someone talks: parity errors appear. Press *Répétition*: majority vote repairs the page.
4. **1:30** 3615 MATHS: the mathematician moves the noise slider; measured BER points land on the theoretical curve.
5. **2:10** 3615 FANTOME: a ghost page from a "mistuned radio" decodes as garbage. Turn on automatic tuning: the ghost's message appears.
6. **2:40** How Kiro built it: specs, property tests (count them), hooks.

## Milestones (12 days)
| Days | Goal |
|---|---|
| J1-J2 (23-24 Nov) | Scaffold, V.23 modulator + demodulator round-trip in tests |
| J3-J4 | Videotex decoder + renderer, loopback mode shows SOMMAIRE |
| J5-J6 | Microphone receive, server mode, HUD |
| J7-J8 | 3615 MATHS (test bench, curves), majority vote |
| J9-J10 | 3615 FANTOME levels 1-4, generation script |
| J11 | Polish, calibration, deployment |
| J12 (4 Dec) | Video, README, submission before 23:00 Paris |
