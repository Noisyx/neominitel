# NeoMinitel

> *« 30 juin 2012 : la France débranche 9 millions de Minitel. »*  
> NeoMinitel brings the French Minitel back the way it actually worked: **pages travel as sound**.

**Kiroween 2026 — Category: Resurrection**

NeoMinitel rebuilds an authentic **ITU-T V.23 acoustic modem** (1200 baud forward at 1300 / 2100 Hz, 75 baud backward at 390 / 450 Hz) and a **STUM1B Videotex terminal** (40×25 screen, G0/G1 mosaics, G2 French accents) directly in the browser. A phone plays the server through its speaker, a laptop listens through its microphone, and each page draws itself line by line at **120 characters per second**, as in 1985 — across the air of the room, with **zero back-end** and **zero network traffic**.

---

## Try It in 30 Seconds

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (`http://localhost:5173`) and press **Connexion**.

### Four Ways to Connect

| Mode | Devices | Microphone needed? | What happens |
|---|---|---|---|
| **Seul** *(default)* | 1 | No | Full V.23 modulation → simulated telephone line → live demodulation and 120 char/s rendering on one device. |
| **Serveur** + **Écoute** | 2 | Receiver only (HTTPS / `localhost`) | One device broadcasts clean V.23 audio from its speaker (**Serveur**); the other decodes live from its microphone (**Écoute**). Optional **Clavier 75 bauds** sends keystrokes back over the air at 390 / 450 Hz. |
| **Fichier** | 1 | No | Drag-and-drop any `.wav` recording (or a downloaded ghost transmission) for instant decoding or real-time 1200-baud playback. |

> **Two-device acoustic tip:** set speaker volume to ~75 %, hold the speaker 15–25 cm from the microphone, and make sure OS *Voice Isolation* (*Isolement de la voix* on macOS / iOS) is turned **off** so the system does not filter out steady 1300 / 2100 Hz modem carriers. Full setup checklist: [`docs/demo-checklist.md`](docs/demo-checklist.md).

---

## The Four `3615` Services

Type a service code on **3615 SOMMAIRE** and press **Envoi**:

- **`3615 SOMMAIRE`** — Welcome directory and Télétel navigation hub.
- **`3615 FANTOME`** — *Transmissions d'outre-tombe.* Five haunted archives from a PTT room that never shut down on 30 June 2012. Every level is a real physical signal impairment solved by a real modem capability:
  1. **L1 — Premier contact**: clean 1200-baud V.23 transmission.
  2. **L2 — Parasites**: white Gaussian noise where **7E1 even parity** isolates damaged bytes as hatched erasure cells while keeping row positioning intact.
  3. **L3 — La radio mal accordée**: `+380 Hz` carrier frequency drift, unreadable with a fixed 1700 Hz slicer and solved by **Accord automatique** (decision-directed adaptive threshold).
  4. **L4 — Le murmure**: 7-pass loop swept by periodic static bursts; any single pass loses ≥ 60 % of the code row, and **Vote** reconstructs 100 % of the page via intra-row `US` re-anchoring and island-aligned majority voting.
  5. **L5 — La voix du retour**: a forward-channel decoy page masks the true message transmitted simultaneously at **75 baud** in the low band (390 / 450 Hz), revealed by **Écoute voie retour**.
- **`3615 MATHS`** — Interactive signal-processing lab:
  - **6 illustrated Videotex course pages** explaining FSK modulation, complex baseband mixing, non-orthogonal correlation ($\rho$ for $h = 2/3$), parity erasures, and majority voting.
  - **Live PN9 BER test bench** plotting real-time measured bit error rates (with 95 % Wilson confidence intervals) directly onto **four reference curves**: ideal orthogonal BFSK, non-coherent correlated BFSK (Marcum $Q_1$), discriminator receiver Monte Carlo, and per-bit quadrature correlator receiver Monte Carlo.
  - **Vote progression bench** comparing empirical 1 / 3 / 5 / 7-pass cell error rates against theoretical erasure ($p^N$) and undetected-error formulas.
- **`3615 LIBRE`** — Create and broadcast your own Videotex page:
  - 80×72 sixel mosaic painter, coloured text rows, and **RGB image-to-mosaic import** (optimal two-colour squared-error search per 2×3 cell with optional Floyd–Steinberg error diffusion).
  - Send live by sound, export a 48 kHz 16-bit `.wav`, or copy a serverless `#libre=…` share URL.

---

## Architecture & Visible Math

Click **Sous le capot** at the bottom of the terminal (auto-opened on `3615 MATHS`) to inspect every decision the modem makes in real time:

- **512-point FFT waterfall** showing the forward (1300 / 2100 Hz) and backward (390 / 450 Hz) bands.
- **Phase-difference discriminator trace** with live decision threshold (fixed or adaptive) and UART bit-sampling windows.
- **Eye diagram** and **kurtosis-corrected $M_2 M_4$ $E_b/N_0$ estimator**, plus live seeded **line simulator** controls ($E_b/N_0$, Hilbert SSB frequency offset, windowed-sinc clock drift, 50 Hz harmonic hum, Poisson noise bursts).

```text
src/
  modem/      Pure V.23 DSP core (zero DOM): CPFSK modulator, FIR + polyphase decimation,
              discriminator, adaptive threshold, 7E1 UART, M2M4 quality, correlator, WAV, channel sim
  videotex/   Pure STUM1B subset (zero DOM): streaming decoder, intra-row anchored encoder,
              G1 mosaics, RGB image quantizer, 8x10 bitmap font, island-aligned majority vote
  services/   Pure state machines: SOMMAIRE, FANTOME, MATHS, LIBRE + router & content linter
  workers/    Dedicated Web Worker running all DSP, FFT and Videotex decoding off the main thread
  audio/      Web Audio API glue: raw-audio AudioWorklet capture + gapless resampled playback
  ui/         React 18 + Canvas 2D CRT terminal, keyboard/touch overlays, Math HUD
  fantome/    Salted SHA-256 code verification and localStorage-resilient progress store
```

- **Static & private:** `124.9 KiB` total gzipped JS (`< 13 %` of the 1 MiB budget), zero external services, audio never leaves the device.
- **Real-time headroom:** Node benchmark processes 60 s of 48 kHz audio in ~1.9 s (> 30× real time; [`docs/calibration.md`](docs/calibration.md)).

---

## Built Spec-First with Kiro

Every component in NeoMinitel was designed and verified spec-first in [`.kiro/`](.kiro):

1. **Mandatory steering rules** — [`product.md`](.kiro/steering/product.md), [`tech.md`](.kiro/steering/tech.md), [`structure.md`](.kiro/steering/structure.md).
2. **Four EARS specifications** (`requirements.md` → `design.md` → `tasks.md`):
   - [`v23-modem`](.kiro/specs/v23-modem) — Properties **`M1`–`M15`** (CPFSK phase continuity, chunk invariance, `±400 Hz` adaptive tracking, `±2 %` clock tolerance, full-duplex separation, correlator BER).
   - [`videotex`](.kiro/specs/videotex) — Properties **`V1`–`V15`** (round-trip encoding, single-byte error locality, `REP` equivalence, double-size geometry, optimal mosaic quantization, burst-aligned vote).
   - [`neominitel-app`](.kiro/specs/neominitel-app) — Properties **`A1`–`A7`** (router invariants, content lint `< 80 %` pairwise similarity, full loopback on every page, calibrated 5-pass noisy vote, sample-accurate scheduler, clean mode-switch teardown).
   - [`fantome`](.kiro/specs/fantome) — Properties **`H1`–`H6`** (byte-identical deterministic `.wav` generation, solvable with feature on, `≥ 50 %` code-row CER with feature off, **zero plain-text code leak** across `public/` and `dist/`).
3. **43 correctness properties → 228 automated tests** (`Vitest` + `fast-check`), backed by signed signal conventions and derivations in [`docs/math.md`](docs/math.md) and [`docs/calibration.md`](docs/calibration.md).

---

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite development server |
| `npm run build` | Type-check (`tsc --noEmit`) and build static bundle into `dist/` |
| `npm test` | Run fast unit & `fast-check` property suites (228 tests) |
| `npm run test:slow` | Run extended Monte Carlo & high-iteration `fast-check` suites (`NEOMINITEL_SLOW=1`) |
| `npm run lint` | Run ESLint across `src/`, `tests/`, `scripts/`, and `content/` |
| `npx tsx scripts/generate-transmissions.ts --verify-only` | Verify `public/transmissions/L1..L5.wav` and `manifest.json` against `H2` / `H3` |
| `npx tsx scripts/check-bundle-size.ts` | Check gzipped JS bundle size against the `< 1 MiB` budget |

---

## Original Assets & Licence

Released under the [MIT License](LICENSE). The 8×10 Videotex pixel font, procedural ambient drones, and terminal shell SVG are original works created for NeoMinitel with **no** Orange, France Télécom, or PTT logos or trademarks — see [`docs/licenses.md`](docs/licenses.md).
