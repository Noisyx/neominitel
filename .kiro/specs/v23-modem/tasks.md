# Implementation Plan: v23-modem

Tags: `[MVP]` is needed for the demo, `[STRETCH]` only if time allows. Property tests reference the properties in `design.md`.

- [x] 1. Project scaffold and test helpers `[MVP]`
  - Vite + TypeScript strict, Vitest, fast-check, ESLint. Create the layout from `structure.md`.
  - `tsx` as the TypeScript script runner (devDependency). Scripts `test` (fast) and `test:slow` (`NEOMINITEL_SLOW=1`). `prototypes/` is excluded from ESLint and `tsconfig`.
  - Helpers: seeded RNG, `awgn` (Eb/N0 convention of `docs/math.md`), windowed-sinc `resample`, random 7-bit byte arbitrary.
  - _Requirements: 13_

- [x] 2. Constants and framing `[MVP]`
  - [x] 2.1 `v23.ts` with `CHANNELS` and `FRAME` from the design table.
  - [x] 2.2 `frame.ts`: byte → 10 line bits, line bits → byte + parity/framing status.
  - [x] 2.3 Unit tests for parity of 0x00, 0x7F, 'A'.
  - _Requirements: 1.1-1.4_

- [x] 3. Modulator `[MVP]`
  - [x] 3.1 Phase-continuous oscillator driven by an exact bit timeline.
  - [x] 3.2 `modulate()` with idle lead/tail, inter-frame idle, raised-cosine ramps limited to the available idle duration, typed errors, `bitErrors` test option.
  - [x] 3.3 `connectionSequence()`. Default durations are provisional until task 12.
  - [x] 3.4 Property tests M2, M3, M4 (parity half).
  - _Requirements: 2.1-2.7, 3.1-3.2_

- [x] 4. WAV input/output `[MVP]`
  - [x] 4.1 `writeWav` / `readWav` with typed errors.
  - [x] 4.2 Property test M9 and malformed-header unit tests.
  - _Requirements: 4.1-4.3_

- [x] 5. Discriminator `[MVP]`
  - [x] 5.1 FIR design, streaming FIR with saved state, polyphase decimation.
  - [x] 5.2 Complex mixer, phase-difference frequency, group-delay compensation.
  - [x] 5.3 Tests: tone accuracy ≤ 15 Hz RMS, rejection of 420 Hz and 50 Hz ≥ 40 dB, all sample rates.
  - _Requirements: 5.1-5.4_

- [x] 6. UART and fixed threshold `[MVP]`
  - [x] 6.1 Soft value, HUNT/START/BITS state machine with sub-sample edge location.
  - [x] 6.2 `char` events with parity, framing and confidence.
  - [x] 6.3 Property tests M1 (fixed threshold, clean), M4 (detection half, line bits 1 to 8), M8. Characterization tests for start-bit and stop-bit inversion.
  - _Requirements: 6.1-6.6_

- [x] 7. Streaming demodulator `[MVP]`
  - [x] 7.1 `createDemodulator` and `StreamingDemodulator` with `push`, `flush`, `reset`, events. Until task 8 lands, only `threshold: 'fixed'` is accepted (see "Threshold mode" in `design.md`); `'fixed'` remains supported afterwards.
  - [x] 7.2 Carrier detect with hysteresis, answer-tone detect (`connect`).
  - [x] 7.3 `diag` events, rate-limited to 50 ms.
  - [x] 7.4 Property test M5.
  - _Requirements: 3.3, 8.1-8.4_

- [x] 8. Adaptive threshold `[MVP]`
  - [x] 8.1 Decision-directed two-means, live mode switch.
  - [x] 8.2 Property test M7. Non-regression test: the fixed-threshold path is unchanged after task 8. From this task, `threshold` defaults to `'adaptive'`.
  - _Requirements: 7.1-7.4_

- [ ] 9. Line simulator `[MVP]`
  - [ ] 9.1 AWGN by Eb/N0 or SNR, SSB frequency offset (Hilbert transform), clock offset (resample), 50 Hz hum, bursts.
  - [ ] 9.2 Determinism test (same seed → identical output).
  - _Requirements: 11.1-11.3_

- [ ] 10. Quality and BER `[MVP]`
  - [ ] 10.1 M2M4 SNR estimator, 3 kHz normalization, Eb/N0, parity error rate.
  - [ ] 10.2 PN9 generator (`pn9Frames`), self-synchronizing `BerCounter`, `wilsonInterval` and its `wilson95` convenience wrapper.
  - [ ] 10.3 Property tests M10, M11, M6.
  - _Requirements: 9.1-9.4, 10.1-10.3_

- [ ] 11. Theory curves `[MVP]` (mathematician)
  - [ ] 11.1 Orthogonal reference, Marcum Q formula with ρ for h = 2/3, write derivations in `docs/math.md`.
  - [ ] 11.2 `scripts/montecarlo-ber.ts` producing curve 3 with intervals, saved as `public/data/ber-curve3.json` for the app.
  - [ ] 11.3 Property test M12.
  - _Requirements: 10.4_

- [ ] 12. Calibration `[MVP]`
  - Run `scripts/calibrate-modem.ts`, set the M6 Eb/N0 target and the connection-sequence durations, record everything in `docs/calibration.md`.
  - _Requirements: 3.2, 9.3_

- [ ] 13. Performance `[MVP]`
  - Benchmark (`scripts/bench-modem.ts`) 60 s of 48 kHz audio in Node; must run in under 3.6 s. Profile the FIR if not. A preliminary run is recorded earlier in `docs/calibration.md`.
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
