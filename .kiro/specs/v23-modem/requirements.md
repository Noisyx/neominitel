# Requirements: v23-modem

## Introduction
`v23-modem` is the pure TypeScript modem of NeoMinitel. It turns bytes into V.23 audio and turns audio (live or recorded) back into bytes, with the parity and framing checks of the original Minitel link. It also provides what the original never showed: signal-quality estimates, BER measurement against a test pattern, tolerance to a mistuned signal, and the theoretical curves used by 3615 MATHS.

The core has no DOM or Web Audio dependency, so it runs in a Web Worker, in Node and in tests.

**Priority tags:** `[MVP]` is needed for the demo. `[STRETCH]` is done only if time allows.

## Glossary
- **Forward channel (voie descendante):** server to terminal, 1200 bit/s. **Backward channel (voie retour):** terminal to server, 75 bit/s.
- **Mark / space:** the two FSK tones. Mark carries a binary 1 and is the idle state of the line. Space carries a binary 0.
- **Frame:** one character on the line: start bit (0), 7 data bits least significant first, even parity bit, stop bit (1). 10 bits in total.
- **Parity error:** a received frame whose 8 data+parity bits have odd weight. **Framing error:** a frame whose stop bit reads 0.
- **Carrier:** the presence of the channel's tones in its band.
- **SNR:** signal-to-noise power ratio. Unless stated otherwise, noise is measured in a 3 kHz bandwidth.
- **Eb/N0:** energy per bit over noise spectral density, the standard measure for comparing BER curves.
- **BER:** bit error rate. **PN9:** the pseudo-random test sequence of polynomial x⁹ + x⁵ + 1 (period 511 bits).
- **Frequency offset:** a constant shift of all tones, as produced by a mistuned single-sideband radio.

## Requirement 1: Channel definitions `[MVP]`
**User Story:** As a developer, I want the V.23 channels described as data, so that the modulator and demodulator share one source of truth.

#### Acceptance Criteria
1. THE system SHALL define the forward channel as 1200 bit/s, mark 1300 Hz, space 2100 Hz.
2. THE system SHALL define the backward channel as 75 bit/s, mark 390 Hz, space 450 Hz.
3. THE system SHALL define the frame format as 1 start bit, 7 data bits sent least significant bit first, 1 even parity bit, 1 stop bit.
4. THESE values SHALL exist in exactly one module (`src/modem/v23.ts`).

## Requirement 2: Modulation `[MVP]`
**User Story:** As a server, I want to turn a byte sequence into V.23 audio, so that another device can receive it through the air.

#### Acceptance Criteria
1. WHEN given 7-bit bytes, a channel and a sample rate between 8 000 and 96 000 Hz, THE modulator SHALL output mono `Float32Array` samples encoding each byte as one frame.
2. THE modulator SHALL produce a phase-continuous signal: no phase jump at any bit boundary.
3. THE modulator SHALL emit a configurable idle mark tone before the first frame (default 100 ms) and after the last frame (default 50 ms).
4. THE modulator SHALL support an optional idle gap between frames, in whole bits (default 0).
5. THE start of bit k SHALL be placed at exactly t₀ + k / baud seconds; rounding errors SHALL NOT accumulate. THE total length SHALL be within ±1 sample of the exact duration.
6. THE peak amplitude SHALL be configurable, with a default of 0.5 and never more than 1.0. Carrier start and end SHALL use a raised-cosine ramp of 5 ms to avoid clicks.
7. IF a byte is above 127, THEN THE modulator SHALL return a typed error naming the position of the byte.

## Requirement 3: Connection sequence `[MVP]`
**User Story:** As a user, I want to hear the iconic connection sound when I press Connexion, so that the resurrection feels real.

#### Acceptance Criteria
1. THE modulator SHALL generate a connection sequence: a 2100 Hz answer tone, a short silence, then the forward mark carrier.
2. THE durations SHALL be configurable. THE defaults SHALL be checked against a reference recording and the result recorded in `docs/calibration.md`.
3. WHEN the demodulator hears an answer tone of at least 500 ms, THE demodulator SHALL emit a `connect` event.

## Requirement 4: WAV input/output `[MVP]`
**User Story:** As a user, I want to save transmissions as WAV files and load recordings, so that I can share and replay them.

#### Acceptance Criteria
1. THE system SHALL write mono 16-bit PCM WAV files with a standard RIFF header.
2. THE system SHALL read 8-, 16- and 24-bit PCM and 32-bit float WAV files, mono or multi-channel. Multi-channel input SHALL be down-mixed to mono.
3. IF a WAV file is malformed or uses an unsupported encoding, THEN THE system SHALL return a typed error naming the problem.

## Requirement 5: Frequency discrimination `[MVP]`
**User Story:** As a developer, I want an instantaneous frequency estimate of the channel, so that bits can be decided and shown in the HUD.

#### Acceptance Criteria
1. THE demodulator SHALL isolate the forward band (700 to 2900 Hz) and reject the backward channel and mains hum by at least 40 dB.
2. THE demodulator SHALL estimate the instantaneous frequency with an RMS error of at most 15 Hz on a clean tone between 1000 and 2500 Hz.
3. THE demodulator SHALL compensate the filter group delay, so that frequency estimates are aligned with the input within 1 input sample.
4. THE demodulator SHALL work at every sample rate from 8 000 to 96 000 Hz.

## Requirement 6: Character recovery `[MVP]`
**User Story:** As a terminal, I want characters recovered from the audio with their parity and framing status, so that the page can be drawn and errors can be shown.

#### Acceptance Criteria
1. WHILE the carrier is present AND the line has been mark for at least one bit, THE demodulator SHALL detect a start bit at the first mark-to-space transition, located with sub-sample precision.
2. THE demodulator SHALL decide each bit from the average soft value over the central 50% of the bit period.
3. FOR each frame, THE demodulator SHALL emit a `char` event with: the 7-bit value, `parityOk`, `framingOk`, the start time in samples, and the confidence of the weakest bit.
4. IF the start bit does not stay at space over its central 50%, THEN THE demodulator SHALL discard it as a false start and keep searching.
5. IF the stop bit reads space, THEN THE demodulator SHALL emit the frame with `framingOk = false` and search for the next start bit from the current position.
6. THE demodulator SHALL decode without error when the transmitter's bit clock differs from nominal by up to ±2%.

## Requirement 7: Adaptive threshold `[MVP]`
**User Story:** As a player of 3615 FANTOME, I want the modem to tune itself to a shifted signal, so that a "mistuned radio" transmission becomes readable.

#### Acceptance Criteria
1. THE demodulator SHALL support two threshold modes: `fixed` (midpoint of the nominal tones, 1700 Hz) and `adaptive`.
2. IN `adaptive` mode, THE demodulator SHALL estimate the mark frequency from the idle carrier, estimate the space frequency from decided bits, and place the threshold at their midpoint.
3. IN `adaptive` mode, THE demodulator SHALL decode without error at 20 dB SNR for any frequency offset between −400 and +400 Hz, and report the estimated offset within ±20 Hz.
4. THE threshold mode SHALL be switchable while decoding, without losing the current position.

## Requirement 8: Streaming `[MVP]`
**User Story:** As the app, I want to feed audio in chunks of any size, so that live capture and file decoding use the same code.

#### Acceptance Criteria
1. THE demodulator SHALL accept chunks of any length, including 1 sample, and SHALL produce the same events whatever the chunk boundaries.
2. THE demodulator SHALL provide `flush()` (process buffered samples) and `reset()` (return to the initial state).
3. THE demodulator SHALL emit events: `carrier` (on/off), `connect`, `char`, `quality` and `diag`.
4. THE `diag` event SHALL be emitted at most every 50 ms and carry decimated discriminator output, bit sampling windows, current threshold and estimated offset, for the HUD.

## Requirement 9: Signal quality `[MVP]`
**User Story:** As a user of 3615 MATHS, I want to see how good the signal is, so that I can relate errors to noise.

#### Acceptance Criteria
1. WHILE the carrier is present, THE demodulator SHALL estimate the in-band SNR at least every 100 ms and report it in dB, both in the filter band and normalized to 3 kHz.
2. THE demodulator SHALL convert the SNR into Eb/N0 using the filter's noise bandwidth and the bit rate.
3. ON synthetic signals with white Gaussian noise, THE SNR estimate SHALL be within ±1 dB of the true value for band SNR from 0 to 30 dB.
4. THE demodulator SHALL report the running parity error rate over the last 100 frames.

## Requirement 10: BER measurement `[MVP]`
**User Story:** As the mathematician, I want an exact bit error rate, so that measured points can be compared with theory.

#### Acceptance Criteria
1. THE system SHALL generate the PN9 sequence (x⁹ + x⁵ + 1) packed into the 7 data bits of successive frames.
2. THE BER counter SHALL synchronize itself on the received sequence, count data-bit errors, and resynchronize when more than 20% of the last 100 bits are wrong.
3. THE BER counter SHALL report the number of bits, the number of errors, the BER and a 95% Wilson confidence interval.
4. THE system SHALL compute theoretical BER curves as a function of Eb/N0 (see design, section Math).

## Requirement 11: Line simulator `[MVP]`
**User Story:** As a developer and as the demo, I want to degrade a clean signal in controlled ways, so that loopback, tests, 3615 MATHS and FANTOME levels share one channel model.

#### Acceptance Criteria
1. THE channel SHALL add white Gaussian noise at a requested Eb/N0 or SNR, using a seeded RNG.
2. THE channel SHALL apply a frequency offset (single-sideband style, all frequencies shifted by the same amount), a clock offset in ppm (resampling), a mains hum at 50 Hz with harmonics, and random noise bursts.
3. THE same parameters and seed SHALL produce byte-identical output.

## Requirement 12: Backward channel `[STRETCH]`
**User Story:** As a terminal user in two-device mode, I want my keys sent back to the server by sound, so that the link is full duplex like the original.

#### Acceptance Criteria
1. THE modulator and demodulator SHALL support the backward channel with the same framing.
2. THE backward demodulator SHALL isolate 300 to 540 Hz and reject the forward channel by at least 50 dB.
3. WHEN forward and backward signals are present at the same time, at equal amplitude, THE demodulators SHALL decode both without error at 20 dB SNR.

## Requirement 13: Performance `[MVP]`
1. THE forward demodulator SHALL process 1 s of 48 kHz audio in under 60 ms on a mid-range laptop, leaving budget for Videotex decoding.
2. THE modulator SHALL generate a full page (1 000 characters) in under 50 ms.

## Requirement 14: Interoperability `[STRETCH]`
1. THE demodulator SHALL decode at least one real V.23 recording from `tests/fixtures/` (license checked and recorded in `tests/fixtures/README.md`).
2. THE modulator output SHALL be decodable by an independent tool (for example `minimodem` with custom mark and space frequencies). The exact command SHALL be recorded in `docs/calibration.md` once verified.
