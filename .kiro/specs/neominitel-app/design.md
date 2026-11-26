# Design: neominitel-app

## Architecture

```
 MAIN THREAD (React)                                   LINE WORKER (line.worker.ts)
┌───────────────────────────────┐                    ┌──────────────────────────────────┐
│ Terminal  HUD  Mode bar       │  transmit(bytes)   │ modulate (v23-modem)             │
│    ▲        ▲                 │ ─────────────────► │   └► channel sim (Seul only)     │
│    │ diffs  │ diag/quality    │                    │        └► demodulator            │
│ Scheduler (reveal at          │ ◄───────────────── │             └► videotex decoder  │
│ playback time)                │  audio blocks +    │                  └► screen diffs  │
│    │                          │  timed events      │ spectrum (512-pt FFT, 50 ms)     │
│ Router + services (pure)      │                    │ backward demod [STRETCH]         │
│ Playback (AudioBufferSource)  │                    └──────────────▲───────────────────┘
│ Capture (AudioWorklet) ───────┼──── MessagePort (raw samples) ────┘
└───────────────────────────────┘
```

- Services run on the main thread: they are pure and cheap.
- All signal processing and Videotex decoding run in the worker.
- The capture worklet sends samples to the worker directly through a `MessageChannel`, never through the main thread.

## Line modes

| Mode | Source of audio | What is decoded | Sound |
|---|---|---|---|
| Seul | Worker modulates service bytes, applies the simulator | Simulated audio | Played (mutable) |
| Écoute | Microphone | Live capture | None |
| Serveur | Worker modulates service bytes, clean | Same audio, clean (local preview) | Played on the speaker |
| Fichier | WAV file | File samples | Optional real-time playback |

### Block streaming and scheduled reveal (Seul, Serveur, Fichier real-time)
1. The worker modulates the whole page once (clean).
2. It processes it in blocks of 100 ms: apply the simulator with the current settings, demodulate, decode Videotex. It posts `{ audio, events }` for each block, keeping at most 3 blocks ahead of playback.
3. The main thread schedules each block gaplessly with `AudioBufferSourceNode.start(t)`.
4. Every event carries `atSample`. The scheduler applies screen diffs and HUD updates in `requestAnimationFrame` when `AudioContext.currentTime` passes their time. The page therefore draws in sync with the sound.
5. A simulator change applies from the next block, so within 200 ms (requirement 3.2).
6. Muting sets the gain to 0; the clock keeps running.

### Écoute
The worklet posts 128-sample frames; the worker buffers them into 20 ms chunks, decodes them and posts events immediately (no scheduling).

## Worker protocol

```ts
type ToWorker =
  | { t: 'init'; sampleRate: number }
  | { t: 'transmit'; id: number; bytes: Uint8Array; pageId: string; simulate: boolean }
  | { t: 'stopTransmit' }
  | { t: 'setSim'; sim: SimParams }
  | { t: 'setThreshold'; mode: 'fixed' | 'adaptive' }
  | { t: 'capturePort'; port: MessagePort; sampleRate: number }
  | { t: 'stopCapture' }
  | { t: 'decodeFile'; data: ArrayBuffer; realtime: boolean }
  | { t: 'reset' };

type FromWorker =
  | { t: 'block'; id: number; audio: Float32Array; startSample: number; events: TimedEvent[] }
  | { t: 'live'; events: TimedEvent[] }                  // Écoute and fast file decoding
  | { t: 'fileProgress'; done: number; total: number }
  | { t: 'error'; error: ModemError | { kind: 'internal'; message: string } };

type TimedEvent = { atSample: number } & (
  | { e: 'diff'; cells: [row: number, col: number, cell: Cell][] }
  | { e: 'pageStart' }                                   // FF received
  | { e: 'pageEnd'; screen: Screen }                     // 300 ms of idle carrier after a page
  | { e: 'carrier'; on: boolean } | { e: 'connect' }
  | { e: 'quality'; q: QualityEvent } | { e: 'diag'; d: DiagEvent; spectrumDb: Float32Array }
  | { e: 'ber'; bits: number; errors: number; lo: number; hi: number }
  | { e: 'key'; key: FunctionKey });                     // backward channel [STRETCH]

interface SimParams { ebN0Db: number | null; offsetHz: number; clockPct: number; hum: boolean; bursts: boolean; seed: number }
```
Audio buffers are transferred, not copied.

## Services (`src/services/`)

```ts
type FunctionKey = 'Envoi' | 'Retour' | 'Repetition' | 'Guide' | 'Annulation' | 'Sommaire' | 'Correction' | 'Suite' | 'ConnexionFin';
type ServiceInput = { kind: 'key'; key: FunctionKey; text: string };   // text = content of the input field
interface ServiceOutput {
  pageId: string;                       // stable id, used by the vote
  bytes: Uint8Array;                    // from videotex encodePage
  input?: { row: number; col: number; maxLength: number };
  testPattern?: { frames: number };     // 3615 MATHS bench: send PN9 after the page
  playWav?: string;                     // 3615 FANTOME: play and decode this file instead of bytes (simulator off)
}
interface Service<S> {
  id: 'SOMMAIRE' | 'MATHS' | 'FANTOME' | 'LIBRE';
  init(): [S, ServiceOutput];
  handle(s: S, input: ServiceInput): [S, ServiceOutput | null];         // null = nothing to send
}
```
- The router owns the session: start screen → (Connexion) → SOMMAIRE → service code + Envoi → service. *Connexion/Fin* always returns to the start screen; *Sommaire* is forwarded to the service, which must return its main page.
- *Répétition* is handled by the router: it resends the last `ServiceOutput` unchanged.
- Local echo: the terminal writes typed characters into the declared input field and handles *Correction* and *Annulation* locally. Only *Envoi* and navigation keys reach the service.

## Vote
- `Seul` and `Serveur`: the page id is known from `ServiceOutput.pageId`; each `pageEnd` screen is added to `votes[pageId]`. A page whose bytes changed (new content) resets its vote.
- `Écoute` and `Fichier` (including 3615 FANTOME WAVs): at `pageEnd`, compare the screen with the last result of every vote; join the vote with the highest similarity if it is ≥ 80% of non-error cells, otherwise start a new vote.
- The terminal shows `vote.result()` when the vote toggle is on and at least 2 receptions exist; otherwise the last reception.
- **Calibration of A4 (task 10.2, recorded per AGENTS.md rule 7; `docs/calibration.md` is owned by Role B):** measured on `sommaire/accueil` across 5 repetitions (`modulate` → `createChannel` AWGN at `Eb/N0` → `StreamingDemodulator` → `VideotexDecoder` → `IncrementalVote`, seeds `0x3615_0001..0x3615_0014`):

  | Eb/N0 (dB) | fs (Hz) | seeds ≤ 1% CER | mean single CER | mean 5-vote CER | worst 5-vote CER |
  |---|---|---|---|---|---|
  | 8.0 | 16 000 | 0/20 | 84.92% | 79.60% | 79.60% |
  | 12.0 | 16 000 | 0/20 | 26.76% | 12.50% | 24.10% |
  | 13.0 | 16 000 | 14/20 | 11.02% | 0.83% | 2.70% |
  | 13.5 | 8 000 | 19/20 | 5.61% | 0.09% | 1.20% |
  | 13.5 | 16 000 | 20/20 | 5.99% | 0.09% | 0.80% |
  | 13.5 | 48 000 | 9/10 | 5.15% | 0.15% | 1.10% |
  | **14.0** | 8 000 | **20/20** | 2.90% | 0.01% | 0.10% |
  | **14.0** | 16 000 | **20/20** | 3.39% | 0.01% | 0.20% |
  | **14.0** | 48 000 | **10/10** | 2.65% | 0.00% | 0.00% |

  For the same Curve-3 discriminator and UART start/stop framing reason that calibrated `M6` from 12 dB to 16.5 dB (`docs/calibration.md`), `A4` is calibrated from the initial 8 dB target to **Eb/N0 = 14.0 dB** — the first 0.5 dB level where all sample rates pass (2.5 dB below single-pass `M6`, repairing ~30 damaged cells per reception down to ≤ 0.2% CER).

## State (`useReducer`)

```ts
interface AppState {
  mode: 'Seul' | 'Ecoute' | 'Serveur' | 'Fichier';
  session: 'start' | 'connecting' | 'online';
  router: RouterState;                  // service states
  shown: Screen;                        // what the terminal displays
  votes: Record<string, VoteSummary>;
  sim: SimParams; threshold: 'fixed' | 'adaptive'; voteOn: boolean;
  hud: { visible: boolean; quality?: QualityEvent; ber?: BerPoint[]; errors: { parity: number; framing: number }; cps: number };
  audio: { muted: boolean; micState: 'off' | 'asking' | 'on' | 'denied'; rawOk?: boolean };
  palette: 'couleur' | 'nb';
}
```
The worker's events go through the scheduler into reducer actions. Diag frames are kept out of React state (a ref read by canvas components) to avoid re-rendering at 20 Hz.

## UI components (`src/ui/`)
- `terminal/`: `MinitelShell` (original SVG case), `ScreenCanvas` (draws the render model, dirty cells only), `FunctionKeys`, `InputOverlay` (mobile text input).
- `hud/`: `Waterfall`, `DiscriminatorTrace` (threshold line, bit windows), `EyeDiagram` (overlay of 2-bit windows), `QualityReadout`, `BerChart` (three theory curves from JSON + live points with intervals), `VotePanel`, toggles for "Accord automatique" and "Vote".
- `screens/`: `ModeBar`, `SimControls`, `FileDrop`, `MicPermission`.
- `theme/`: tokens (beige case, dark glass, phosphor colours), CRT effect as a CSS overlay.

## Content (`content/pages/`)
One TypeScript file per service exporting `PageSource` objects, written in French. A lint test checks: every row ≤ 40 cells, ≤ 24 rows, only supported characters, every pair of pages < 80% similar (so Écoute matching cannot confuse two pages).

## Audio glue (`src/audio/`)
- `capture.ts`: `getUserMedia` with raw constraints, reads `track.getSettings()`, creates the worklet and the `MessageChannel`, reports `rawOk`.
- `playback.ts`: gapless block scheduling, gain node for mute, `currentTime` → sample clock for the scheduler.
- The `AudioContext` is created and resumed on the first user gesture (*Connexion*).

## Correctness properties
| ID | Property |
|---|---|
| A1 | Services are deterministic: the same input sequence gives byte-identical outputs. |
| A2 | Navigation (model-based, fast-check commands): no input sequence throws; *Sommaire* always returns the current service's main page; *Connexion/Fin* always returns to the start screen; *Répétition* resends identical bytes. |
| A3 | Clean loopback: for every page in `content/pages/`, the full `Seul` pipeline with a clean line gives the expected screen exactly. |
| A4 | Noisy loopback with vote: at Eb/N0 = 14.0 dB (calibrated; design target 8 dB, see "Vote" section above) and 5 repetitions, the voted screen matches the reference on ≥ 99% of cells, for 10 seeds. |
| A5 | Scheduler: events are applied in `atSample` order and never before their playback time. |
| A6 | Content lint: every page satisfies the size, alphabet and < 80% similarity rules. |
| A7 | Reducer: `shown` always has 25 × 40 cells; switching mode never leaves a capture or a transmission running. |

## Error handling
- Every `ModemError` and `PageError` has a French message in `src/ui/errors.ts`.
- Microphone denied → `MicPermission` screen with instructions per browser, and a button to `Seul` mode.
- Worker crash → restart the worker, show "Ligne coupée, reconnexion…" and return to the start screen.

## Testing
- A1, A2, A5-A7 as Vitest tests in `tests/properties/neominitel-app.test.ts`.
- A3, A4 run the worker logic in Node (same pure modules, no Worker API).
- Manual checklist `docs/demo-checklist.md`: two devices (iPhone speaker → MacBook mic, Android → Windows), each browser, mute, mode switches.
