# Requirements: neominitel-app

## Introduction
`neominitel-app` is the web application: the Minitel terminal on screen, the audio glue, the 3615 services and the Math HUD. It uses the `v23-modem` and `videotex` cores, and hosts the `fantome` puzzle. Everything runs in the browser, as a static site.

**Priority tags:** `[MVP]` is needed for the demo. `[STRETCH]` is done only if time allows.

## Glossary
- **Terminal:** the on-screen Minitel (shell, screen, keyboard).
- **Line:** the path from a service to the terminal: bytes → modem audio → (air or simulator) → demodulator → Videotex decoder.
- **Modes:** `Seul` (one device, simulated line), `Écoute` (this device receives through its microphone), `Serveur` (this device plays pages through its speaker for another device), `Fichier` (decode a WAV file).
- **Service:** a 3615 service. It receives keys and text, and returns Videotex bytes.
- **HUD:** the Math HUD, a panel next to the terminal that shows the modem's inner workings.

## Requirement 1: Zero-friction start `[MVP]`
**User Story:** As a jury member, I want the experience to start in one click, so that I understand the project in seconds.

#### Acceptance Criteria
1. WHEN the app opens, THE terminal SHALL show a screen inviting the user to press *Connexion*, with the line "30 juin 2012 : la France débranche le Minitel."
2. WHEN the user presses *Connexion* (button or key), THE app SHALL play the connection sequence and then display 3615 SOMMAIRE through the simulated line, in `Seul` mode.
3. THE `Seul` mode SHALL NOT request microphone permission.
4. THE page SHALL draw at the real rate of 120 characters per second, in sync with the modem sound.
5. THE audio SHALL be audible by default, with a mute button that keeps decoding running.

## Requirement 2: Line modes `[MVP]`
**User Story:** As a user, I want to choose how the signal travels, so that I can demo with one or two devices or a recording.

#### Acceptance Criteria
1. IN `Seul` mode, THE app SHALL send the service's bytes through the modulator, the line simulator and the demodulator, and decode what the demodulator outputs (never the original bytes).
2. IN `Écoute` mode, THE app SHALL capture raw microphone audio and decode it continuously.
3. IN `Serveur` mode, THE app SHALL run the selected service locally and play its pages through the speaker. Keys pressed on the server device SHALL drive the service.
4. IN `Fichier` mode, THE app SHALL decode a dropped or selected WAV file faster than real time, with a progress bar, and also allow real-time playback.
5. THE user SHALL be able to switch modes without reloading the page.

## Requirement 3: Line simulator controls `[MVP]`
**User Story:** As a presenter, I want to degrade the simulated line on purpose, so that I can show errors and their repair.

#### Acceptance Criteria
1. IN `Seul` mode, THE app SHALL offer controls for Eb/N0 (from 0 to 30 dB, and "clean"), frequency offset (−500 to +500 Hz), clock offset (−3% to +3%), hum and bursts.
2. CHANGES SHALL take effect within 200 ms, during a page.
3. THE simulator SHALL be seeded so that a demo can be replayed identically.

## Requirement 4: Terminal and keyboard `[MVP]`
**User Story:** As a user, I want to use the terminal like a Minitel, so that the experience feels authentic.

#### Acceptance Criteria
1. THE terminal SHALL render the screen model on a canvas, scaled to fit, with crisp pixels and an optional CRT effect.
2. THE terminal SHALL offer the nine function keys as on-screen buttons and as PC shortcuts: Enter = Envoi, Backspace = Correction, Escape = Annulation, Page Down = Suite, Page Up = Retour, Home = Sommaire, End = Connexion/Fin, Alt+G = Guide, Alt+R = Répétition. Shortcuts SHALL use `KeyboardEvent.code` and SHALL NOT use F-keys (F1 and F5 are taken by browsers).
3. WHEN the current service declares an input field, THE terminal SHALL echo typed characters into it locally, and *Correction* SHALL delete the last character.
4. THE palette SHALL be switchable between colour and black-and-white (Minitel 1).
5. ON phones, THE function keys and a text input SHALL be usable by touch.

## Requirement 5: Services and navigation `[MVP]`
**User Story:** As a user, I want to type a 3615 code and browse its pages, so that I relive the service experience.

#### Acceptance Criteria
1. 3615 SOMMAIRE SHALL list the available services; typing a code (MATHS, FANTOME, LIBRE) and *Envoi* SHALL open it. An unknown code SHALL show an error page.
2. FROM any page of any service, *Sommaire* SHALL return to the service's main page, and *Connexion/Fin* SHALL end the session and show the start screen.
3. *Suite* and *Retour* SHALL move through multi-page content; *Guide* SHALL show the service's help page.
4. *Répétition* SHALL resend the current page. EACH repetition SHALL be added to the vote of that page (Requirement 7).
5. EVERY service SHALL be a pure state machine `(state, input) → (state, bytes)` in `src/services/`, with page texts in `content/pages/`.

## Requirement 6: 3615 MATHS `[MVP]`
**User Story:** As the mathematician, I want a service that explains the modem and measures it live, so that the jury sees theory and practice meet.

#### Acceptance Criteria
1. 3615 MATHS SHALL contain at least 6 explanation pages written by the mathematician: FSK, framing and parity, the discriminator, the adaptive threshold, BER and Eb/N0, the vote.
2. THE "Banc d'essai" page SHALL send PN9 test frames and show, in the HUD, the measured BER with its 95% interval, plotted over the three theory curves from `v23-modem`.
3. THE user SHALL be able to change Eb/N0 during the test (in `Seul` mode) and see a new measured point after at most 10 s.
4. THE "Vote" page SHALL show the measured cell error rate after 1, 3, 5 and 7 receptions next to the formulas from the `videotex` design.

## Requirement 7: Repair by vote `[MVP]`
**User Story:** As a user receiving a damaged page, I want repeated receptions combined, so that the page becomes clean.

#### Acceptance Criteria
1. THE app SHALL keep, per page identifier, the screens received for it since the last time it changed.
2. WHEN the vote is enabled (HUD toggle, on by default), THE terminal SHALL display the vote result instead of the last reception.
3. THE HUD SHALL show the number of receptions and the number of unresolved cells.
4. IN `Écoute` mode, a new page SHALL be detected when FF is received, and it SHALL be matched to a previous reception when at least 80% of its non-error cells are equal.

## Requirement 8: Math HUD `[MVP]`
**User Story:** As a jury member, I want to see what the modem does, so that the math is not hidden.

#### Acceptance Criteria
1. THE HUD SHALL show: a waterfall of 0-3 kHz with mark and space markers, the discriminator trace with the threshold and the bit sampling windows, an eye diagram over one bit period, SNR and Eb/N0, the estimated offset, characters per second, and parity and framing error counts.
2. THE HUD SHALL have a toggle for the adaptive threshold ("Accord automatique") and for the vote.
3. THE HUD SHALL be hideable, and SHALL never slow the terminal below 30 frames per second.
4. EVERY chart SHALL also expose its key value as text, for screen readers.

## Requirement 9: Look and accessibility `[MVP]`
1. THE terminal shell SHALL be an original drawing inspired by the Minitel 1 (no logo or trademark of Orange or France Télécom).
2. THE app SHALL be usable with the keyboard only; focus SHALL be visible.
3. WHEN `prefers-reduced-motion` is set, flashing text and the CRT flicker SHALL be disabled.
4. A text summary of the current screen SHALL be available to screen readers (aria-live, updated when a page is complete).

## Requirement 10: Errors and guidance `[MVP]`
1. IF microphone permission is denied, THEN THE app SHALL explain how to allow it and offer `Seul` mode.
2. IF the browser ignores the raw-audio constraints, THEN THE app SHALL show a warning with the settings it got.
3. IF no carrier is heard for 10 s in `Écoute` mode, THEN THE app SHALL suggest turning up the volume and moving the devices closer.
4. IF a WAV file cannot be read, THEN THE app SHALL show the typed error from the core in plain French.

## Requirement 11: 3615 LIBRE `[STRETCH]`
1. THE user SHALL be able to compose a page (text, colours, mosaic drawing on 80 × 72 blocks) in an editor.
2. THE user SHALL be able to send it by sound, export it as WAV, or share it as a link containing the bytes in the URL fragment (no server).

## Requirement 12: Backward channel `[STRETCH]`
1. IN two-device mode, WHEN the backward channel is enabled, THE terminal device SHALL send its keys at 75 baud and the server device SHALL listen for them, so that the receiving device drives the service.

## Requirement 13: Performance and deployment `[MVP]`
1. Demodulation and Videotex decoding SHALL run in a Web Worker; the main thread SHALL keep 60 frames per second on a mid-range laptop.
2. THE app SHALL build to static files, served over HTTPS, and work in the browsers listed in `tech.md`.
3. THE first load SHALL be under 1 MB of JavaScript (gzipped), excluding audio files.
