# DSP prototypes (simulation only)

Numerical experiments that de-risk the V.23 modem before and during implementation (Role B).
They are plain `.mjs` files run with Node (>= 18), with **zero dependencies**, and are **not part of
the build**: nothing in `src/` imports them and they import nothing from `src/`.

Exception: `demo-wav.ts` (task 4) is a TypeScript demo, run with `tsx`, that imports the public
barrel `src/modem/index.ts` to write a listenable WAV. It is not an experiment and records no result;
its output goes to `out/`, which is git-ignored (`prototypes/dsp/.gitignore`).

**Every result here is a simulation.** It is never reported as a hardware measurement. Results that
need real speakers, microphones and rooms belong to `docs/calibration.md`, section "Hardware".

## Commands

Run from the repository root. Each script writes `results/<id>.csv` and `results/<id>.meta.json`.

| Experiment | Command | Expected runtime (i5-8350U) |
|---|---|---|
| Library self-checks | `node prototypes/dsp/lib.mjs` | < 1 s |
| E1 filter margins | `node prototypes/dsp/e1-filter-margins.mjs` | < 1 s |
| E3a noise and level chain | `node prototypes/dsp/e3a-noise-chain.mjs` | about 2 min |
| E7 mixer + polyphase FIR benchmark | `node prototypes/dsp/e7-perf.mjs` | about 1 min (run alone) |
| E2 discriminator accuracy and alignment | `node prototypes/dsp/e2-discriminator.mjs` | a few seconds |
| E3c reference BER formula | `node prototypes/dsp/e3c-ber-formula.mjs` | about 1 min |
| E3b Eb/N0 invariance of BER | `node prototypes/dsp/e3b-ebn0-invariance.mjs` | about 1 to 2 min |
| WAV demo (writes `out/demo-3615-sommaire-<fs>.wav`) | `npx tsx prototypes/dsp/demo-wav.ts [sampleRate]` | < 2 s |

Order matters: E1 writes `results/e1-selected.json` and `results/e1-summary.json`, which E3a, E7, E2
and E3b read. Run E7 with no other heavy process, otherwise its timings are meaningless.

## Reproducibility

- **RNG:** xoshiro128** (period 2^128 - 1). Each stream is seeded by splitmix32 from the 32-bit FNV-1a
  hash of a stream key, for example `E3b|stage=1|fs=8000|ebn0=6|seed=3|role=noise`. There is one
  distinct stream per condition, seed and role; no stream is shared between sampling rates or Eb/N0
  values. Each script asserts that its derived 32-bit seeds are unique.
- Stream independence rests on distinct keys and a large-state generator. No quantified overlap
  probability is claimed.
- Normal deviates use Box-Muller on 53-bit uniforms. The xoshiro128** core reproduces the reference
  output for the state {1, 2, 3, 4} (11520, 0, 5927040, 70819200, 2031721883, 1637235492).
- Every `meta.json` records the Node version, the commit, the RNG algorithm, the key template and
  every derived seed, and `"kind": "simulation"`.
- Same Node major version, same commit: byte-identical CSV values (timings in E7 excepted).

## Files

| File | Purpose |
|---|---|
| `lib.mjs` | V.23 constants (the single intentional copy, exception U3), RNG, FIR design, DTFT, FFT, B_n, `wilsonInterval` (single implementation, decision P1/P3), `normalQuantile`, `marcumQ1`, reference BER formula, result writers, self-checks |
| `e1-filter-margins.mjs` | Forward low-pass margins for 4 windows x 3 cutoff conventions x 8 sampling rates |
| `e3a-noise-chain.mjs` | Validates the noise convention (D1 to D5 of `docs/math.md`), including properness at zero lag |
| `e7-perf.mjs` | CPU cost of mixer + polyphase FIR + frequency estimate |
| `e2-discriminator.mjs` | RMS frequency error on clean tones and time alignment on a frequency step |
| `e3c-ber-formula.mjs` | Two-symbol non-coherent Monte Carlo against the Marcum-Q BER formula |
| `e3b-ebn0-invariance.mjs` | Equivalence of BER across sampling rates at fixed Eb/N0 |

## Guard tests (to be added in `tests/properties/v23-modem.test.ts`)

- The `V23` block of `lib.mjs` must equal `CHANNELS` and `FRAME` of `src/modem/v23.ts` (task J2-1).
- `wilsonInterval` of `lib.mjs` must equal the one of `src/modem/prbs.ts` on a grid of (errors, bits, z)
  (added with task 10).
