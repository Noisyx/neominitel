# Implementation Plan: v23-modem

Tags: `[MVP]` is needed for the demo, `[STRETCH]` only if time allows. Property tests reference the properties in `design.md`.

- [x] 1. Project scaffold and test helpers `[MVP]`
  - Vite + TypeScript strict, Vitest, fast-check, ESLint. Create the layout from `structure.md`.
  - Helpers: seeded RNG, `awgn`, windowed-sinc `resample`, random 7-bit byte arbitrary.
  - _Requirements: 13_

- [ ] 2. Constants and framing `[MVP]`
  - [ ] 2.1 `v23.ts` with `CHANNELS` and `FRAME` from the design table.
  - [ ] 2.2 `frame.ts`: byte → 10 line bits, line bits → byte + parity/framing status.
  - [ ] 2.3 Unit tests for parity of 0x00, 0x7F, 'A'.
  - _Requirements: 1.1-1.4_

- [ ] 3. Modulator `[MVP]`
  - [ ] 3.1 Phase-continuous oscillator driven by an exact bit timeline.
  - [ ] 3.2 `modulate()` with idle lead/tail, inter-frame idle, raised-cosine ramps, typed errors, `bitErrors` test option.
  - [ ] 3.3 `connectionSequence()`.
  - [ ] 3.4 Property tests M2, M3, M4 (parity half).
  - _Requirements: 2.1-2.7, 3.1-3.2_

- [ ] 4. WAV input/output `[MVP]`
  - [ ] 4.1 `writeWav` / `readWav` with typed errors.
  - [ ] 4.2 Property test M9 and malformed-header unit tests.
  - _Requirements: 4.1-4.3_

- [ ] 5. Discriminator `[MVP]`
  - [ ] 5.1 FIR design, streaming FIR with saved state, polyphase decimation.
  - [ ] 5.2 Complex mixer, phase-difference frequency, group-delay compensation.
  - [ ] 5.3 Tests: tone accuracy ≤ 15 Hz RMS, rejection of 420 Hz and 50 Hz ≥ 40 dB, all sample rates.
  - _Requirements: 5.1-5.4_

- [ ] 6. UART and fixed threshold `[MVP]`
  - [ ] 6.1 Soft value, HUNT/START/BITS state machine with sub-sample edge location.
  - [ ] 6.2 `char` events with parity, framing and confidence.
  - [ ] 6.3 Property tests M1 (fixed threshold, clean), M4 (detection half), M8.
  - _Requirements: 6.1-6.6_

- [ ] 7. Streaming demodulator `[MVP]`
  - [ ] 7.1 `StreamingDemodulator` with `push`, `flush`, `reset`, events.
  - [ ] 7.2 Carrier detect with hysteresis, answer-tone detect (`connect`).
  - [ ] 7.3 `diag` events, rate-limited to 50 ms.
  - [ ] 7.4 Property test M5.
  - _Requirements: 3.3, 8.1-8.4_

- [ ] 8. Adaptive threshold `[MVP]`
  - [ ] 8.1 Decision-directed two-means, live mode switch.
  - [ ] 8.2 Property test M7.
  - _Requirements: 7.1-7.4_

- [ ] 9. Line simulator `[MVP]`
  - [ ] 9.1 AWGN by Eb/N0 or SNR, SSB frequency offset (Hilbert transform), clock offset (resample), 50 Hz hum, bursts.
  - [ ] 9.2 Determinism test (same seed → identical output).
  - _Requirements: 11.1-11.3_

- [ ] 10. Quality and BER `[MVP]`
  - [ ] 10.1 M2M4 SNR estimator, 3 kHz normalization, Eb/N0, parity error rate.
  - [ ] 10.2 PN9 generator, self-synchronizing BER counter, Wilson interval.
  - [ ] 10.3 Property tests M10, M11, M6.
  - _Requirements: 9.1-9.4, 10.1-10.3_

- [ ] 11. Theory curves `[MVP]` (mathematician)
  - [ ] 11.1 Orthogonal reference, Marcum Q formula with ρ for h = 2/3, write derivations in `docs/math.md`.
  - [ ] 11.2 Monte Carlo script producing curve 3 with intervals, saved as JSON for the app.
  - [ ] 11.3 Property test M12.
  - _Requirements: 10.4_

- [ ] 12. Calibration `[MVP]`
  - Run `scripts/calibrate-modem.ts`, set the M6 Eb/N0 target and the connection-sequence durations, record everything in `docs/calibration.md`.
  - _Requirements: 3.2, 9.3_

- [ ] 13. Performance `[MVP]`
  - Benchmark 60 s of 48 kHz audio in Node; must run in under 3.6 s. Profile the FIR if not.
  - _Requirements: 13.1-13.2_

- [ ] 14. Backward channel `[STRETCH]`
  - [ ] 14.1 Backward channel spec in the demodulator, strong forward rejection.
  - [ ] 14.2 Property test M13.
  - _Requirements: 12.1-12.3_

- [ ] 15. Correlator demodulator `[STRETCH]` (mathematician)
  - Non-coherent quadrature correlators per bit, BER comparison plotted in 3615 MATHS.

- [ ] 16. Interoperability `[STRETCH]`
  - Decode a license-checked real recording; verify output with an independent decoder and record the command.
  - _Requirements: 14.1-14.2_
