---
inclusion: always
---

# Project structure

```
src/
  modem/                # Pure V.23 modem (no DOM). Spec: v23-modem
    v23.ts              # Channel and frame constants (single source of truth)
    types.ts            # Shared contract: Result, ModemError, ModulateOptions, DemodOptions, DemodEvent, StreamingDemodulator
    index.ts            # Public barrel: the only import point for code outside src/modem/
    frame.ts            # 7E1 framing, parity
    oscillator.ts       # Phase-continuous FSK synthesis
    modulator.ts        # Bytes -> audio, connection sequence
    filters.ts          # Windowed-sinc FIR, streaming FIR, decimation
    discriminator.ts    # Complex mixing + phase-difference frequency estimate
    threshold.ts        # Fixed and adaptive (decision-directed) threshold
    uart.ts             # Start-bit detection, bit sampling, parity/framing checks
    carrier.ts          # Carrier detect with hysteresis, answer-tone detect
    quality.ts          # M2M4 SNR estimator, Eb/N0 conversion
    prbs.ts             # PN9 generator, BER counter, Wilson interval
    theory.ts           # BER curves (orthogonal reference, Marcum Q formula)
    channel.ts          # Line simulator: AWGN, frequency offset, clock offset, hum, bursts
    demodulator.ts      # Streaming demodulator + events
    wav.ts              # WAV read/write
  videotex/             # Pure Videotex (no DOM). Spec: videotex
    codes.ts            # C0 codes, ESC attributes, SEP keys, SS2 accents
    screen.ts           # 40x25 screen model
    decoder.ts          # Bytes -> screen (streaming)
    encoder.ts          # PageSource -> bytes (robust encoding)
    mosaic.ts           # 2x3 G1 mapping, bitmap -> mosaic
    vote.ts             # Screen-level majority vote with erasures
  services/             # Pure service state machines. Spec: neominitel-app
    sommaire.ts  maths.ts  fantome.ts  libre.ts
    router.ts           # 3615 code -> service, key handling
  audio/                # Web Audio glue. Spec: neominitel-app
    capture.worklet.ts  capture.ts  playback.ts
  workers/
    line.worker.ts      # Hosts demodulator + Videotex decoder, posts events
  ui/                   # React components. Spec: neominitel-app
    terminal/           # Minitel shell, screen canvas, keyboard
    hud/                # Waterfall, discriminator trace, eye diagram, BER chart
    screens/            # Home, Ecoute (receive), Serveur (transmit), Fichier
    theme/
  fantome/              # Level runtime, hash check. Spec: fantome
content/
  pages/                # PageSource files (French text) for every service
  fantome/levels.json   # Level sources with plain codes (NOT served)
scripts/
  generate-transmissions.ts   # Builds public/transmissions/* and verifies levels
  calibrate-modem.ts          # (Role B) Calibration runs for docs/calibration.md
  montecarlo-ber.ts           # (Role B) Curve 3 Monte Carlo, writes public/data/ber-curve3.json
  bench-modem.ts              # (Role B) Receive pipeline benchmark
public/
  transmissions/        # Generated WAVs + manifest.json (hashed codes only)
  data/
    ber-curve3.json     # Monte Carlo BER curve with Wilson intervals (generated, Role B)
tests/
  helpers/              # Seeded RNG, AWGN, resample, screen diff. modem-*.ts owned by Role B
  properties/           # One file per spec; tests named after properties
  fixtures/             # Reference recordings (license-checked)
prototypes/
  dsp/                  # Numerical experiments: plain .mjs, Node only, zero dependencies. Simulation only,
                        # never reported as hardware measurement. Not part of the build.
    README.md  lib.mjs  e*.mjs
    results/            # CSV + <id>.meta.json (Node version, RNG algorithm and stream keys, commit, kind: "simulation"), committed
docs/
  calibration.md        # Measured thresholds, BER curves
  math.md               # Derivations by the mathematician
```

Dependency rule: `ui` → `workers` → (`modem`, `videotex`, `services`). `services` may import `videotex`. `modem` and `videotex` import nothing from other folders. Code outside `src/modem/` imports the modem only through `src/modem/index.ts`. `prototypes/` imports nothing from `src/`; its V.23 constants and its Wilson interval function are intentional single copies, checked by guard tests.
