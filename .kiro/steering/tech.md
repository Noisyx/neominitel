---
inclusion: always
---

# Tech stack and engineering rules

## Stack
- **Language:** TypeScript, `strict: true`, ES2022 modules.
- **Build:** Vite. Static output, deployable to any HTTPS static host (Netlify, Vercel, GitHub Pages).
- **UI:** React 18 + Canvas 2D (Minitel screen, waterfall, charts).
- **Audio:** Web Audio API. `AudioWorklet` for capture, `AudioBufferSourceNode` for playback.
- **Concurrency:** all DSP and Videotex decoding run in a dedicated Web Worker. The main thread only renders.
- **Tests:** Vitest + fast-check (property-based testing). Node runs the pure cores directly.
- **Scripts:** TypeScript scripts (`scripts/`: calibration, Monte Carlo, benchmark) run with `tsx`. Numerical prototypes are plain `.mjs` files run with Node.

## Hard constraints
- **The cores are pure.** `src/modem/`, `src/videotex/` and `src/services/` have no DOM, no Web Audio, no `window`. They run unchanged in Node, a Worker and tests.
- **Sample rate is never assumed.** Input may be 8 to 96 kHz (typically 44.1 or 48 kHz). All timing is derived from `sampleRate` at runtime.
- **Microphone capture requests raw audio:** `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }`. Check `track.getSettings()` and warn if the browser ignores it.
- **No back-end.** Never send audio, keys or pages over the network.
- Microphone access requires HTTPS (localhost is fine in dev).

## Conventions
- V.23 constants live only in `src/modem/v23.ts`. Videotex codes live only in `src/videotex/codes.ts`. Never duplicate a frequency, baud rate or control code elsewhere. Single exception: `prototypes/dsp/lib.mjs` keeps one block of V.23 constants and one copy of the Wilson interval function so the numerical prototypes run in plain Node; guard tests compare both with `src/modem`.
- Units in names: `freqHz`, `durationMs`, `offsetSamples`, `ebN0Db`.
- Signals are `Float32Array`; bytes are `Uint8Array` holding 7-bit values. No allocation in per-sample hot loops.
- Time is tracked as exact cumulative real time (double) and converted to samples at the last step, so rounding never accumulates.
- Determinism: same input gives the same output, whatever the chunk boundaries. Tests and generated levels use a seeded RNG.
- Code and specs in English; user-facing text (pages, UI) in French.

## Testing policy
- Every correctness property in a spec's `design.md` has a fast-check test named after it (e.g. `M1 modulate-demodulate round-trip`).
- Tests run in two modes with identical names: fast (default, used by the save hook) and slow (`NEOMINITEL_SLOW=1`: more cases, Monte Carlo properties). Results of numerical prototypes are simulations and are never reported as hardware measurements.
- Numeric thresholds (BER, dB, Hz) start as the targets written in the spec. A threshold may only change through a calibration task, with the reason recorded in `docs/calibration.md`.
- Performance budget: the receive pipeline (demodulation + Videotex decoding) processes 1 s of 48 kHz audio in under 100 ms on a mid-range laptop (at least 10x real time).

## Browser support
Latest Chrome, Firefox and Safari on desktop; Safari on iOS; Chrome on Android. Resume the `AudioContext` on a user gesture (iOS).
