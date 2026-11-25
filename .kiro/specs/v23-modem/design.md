# Design: v23-modem

## Overview
```
bytes ──► frame (7E1) ──► bit timeline ──► phase-continuous FSK ──► Float32Array
                                                                     │
                                         channel simulator (optional)│
                                                                     ▼
events ◄── UART ◄── threshold ◄── discriminator ◄── LP + decimate ◄── complex mix
  │                     ▲              │
  │                     └── adaptive ──┘
  ├── quality (M2M4 SNR, Eb/N0, parity rate)
  └── BER counter (PN9)
```

## Constants (`src/modem/v23.ts`)

| | Forward | Backward |
|---|---|---|
| Bit rate | 1200 bit/s | 75 bit/s |
| Mark (1, idle) | 1300 Hz | 390 Hz |
| Space (0) | 2100 Hz | 450 Hz |
| Mixer centre | 1800 Hz | 420 Hz |
| Low-pass cutoff (complex baseband) | 1100 Hz (band 700-2900 Hz) | 120 Hz (band 300-540 Hz) |
| Nominal threshold | 1700 Hz | 420 Hz |
| Characters per second | 120 | 7.5 |

Frame: `[0, d0, d1, d2, d3, d4, d5, d6, p, 1]` with p chosen so that d0..d6 + p has even weight.

```ts
type ChannelId = 'forward' | 'backward';
interface ChannelSpec {
  id: ChannelId; baud: number; markHz: number; spaceHz: number;
  mixHz: number; lowpassHz: number; thresholdHz: number;
}
export const CHANNELS: Record<ChannelId, ChannelSpec>;
export const FRAME = { dataBits: 7, parity: 'even', stopBits: 1, bitsPerFrame: 10 } as const;
```

## Interfaces

These types live in `src/modem/types.ts`. `src/modem/index.ts` is the only import point for code outside `src/modem/`. `ChannelId`, `ChannelSpec`, `CHANNELS` and `FRAME` stay in `v23.ts`. A change to this section or to property M4 needs the written approval of both developers.

```ts
interface ModulateOptions {
  sampleRate: number; channel?: ChannelId;      // default 'forward'
  amplitude?: number;                            // default 0.5, max 1
  leadIdleMs?: number; tailIdleMs?: number;      // default 100 / 50
  interFrameIdleBits?: number;                   // default 0
  rampMs?: number;                               // default 5
  bitErrors?: number[];                          // TEST ONLY: indices of line bits to invert
}
function modulate(bytes: Uint8Array, o: ModulateOptions): Result<Float32Array, ModemError>;
function connectionSequence(o: { sampleRate: number; answerToneMs?: number; silenceMs?: number; carrierMs?: number }): Float32Array;

interface DemodOptions {
  sampleRate: number; channel?: ChannelId;
  threshold?: 'fixed' | 'adaptive';              // see "Threshold mode" below
  carrierOnDbfs?: number;                        // default -45, hysteresis 3 dB
}
function createDemodulator(o: DemodOptions): Result<StreamingDemodulator, ModemError>;
interface StreamingDemodulator {
  push(chunk: Float32Array): DemodEvent[];
  flush(): DemodEvent[];
  reset(): void;
  setThresholdMode(m: 'fixed' | 'adaptive'): void;
}
type DemodEvent =
  | { type: 'carrier'; on: boolean; atSample: number }
  | { type: 'connect'; atSample: number }
  | { type: 'char'; value: number; parityOk: boolean; framingOk: boolean; atSample: number; minConfidence: number }
  | { type: 'quality'; atSample: number; snrBandDb: number; snr3kDb: number; ebN0Db: number; parityErrorRate: number; offsetHz: number }
  | { type: 'diag'; atSample: number; nonFiniteCount: number; freqHz: Float32Array; decimation: number; bitWindows: [number, number][]; thresholdHz: number; markHz: number; spaceHz: number };

type ModemError =
  | { kind: 'byte-out-of-range'; index: number; value: number }
  | { kind: 'bad-sample-rate'; sampleRate: number }
  | { kind: 'bad-option'; option: string; reason: string }
  | { kind: 'wav'; reason: string };
```

`Result<T, E>` is `{ ok: true; value: T } | { ok: false; error: E }`. No untyped exceptions leave the core.
`videotex` defines its own structurally identical `Result`; the two cores never import each other.

**Events.** `atSample` is an absolute input-sample index since the last `reset()`, group-delay compensated. Events are emitted in detection order, not sorted by `atSample` (a `char` is known about 10 bit periods after its start); consumers sort by `atSample` (stable). `nonFiniteCount` is the cumulative number of NaN or infinite input samples replaced by 0 since `reset()`.

**Factory.** `createDemodulator` returns `bad-sample-rate` when `sampleRate` is not finite or lies outside 8 000 to 96 000 Hz, and `bad-option` for any other invalid option. Non-integer rates are accepted. `push`, `flush` and `reset` never throw.

**Threshold mode.** Final behaviour (from task 8): `threshold` defaults to `'adaptive'`; `'fixed'` stays supported and its output is unchanged. Before task 8 lands, only `'fixed'` is accepted: any other value, or an omitted `threshold`, returns `bad-option`, with no silent fallback. Before task 8, `setThresholdMode('adaptive')` leaves the mode at `'fixed'` (documented no-op); the app keeps its automatic-tuning control disabled until task 8.

### Line simulator API (`src/modem/channel.ts`)
```ts
interface HumParams   { levelDb: number; fundamentalHz?: number /* 50 */; harmonics?: number /* 5 */ }  // level relative to the signal power
interface BurstParams { ratePerS: number; durationMs: [number, number]; levelDb: number }
const DEFAULT_HUM: HumParams; const DEFAULT_BURSTS: BurstParams;
interface ChannelParams {
  sampleRate: number; seed: number;                 // seed: uint32
  channel?: ChannelId;                              // bit rate used by Eb/N0, default 'forward'
  signalAmplitude?: number;                         // reference peak amplitude of the received tone, default 0.5
  noise?: { kind: 'ebN0'; db: number } | { kind: 'snr3k'; db: number };   // absent = no noise
  offsetHz?: number; clockPpm?: number; hum?: HumParams; bursts?: BurstParams;
}
interface LineChannel {
  process(chunk: Float32Array): Float32Array;       // new array; length differs when clockPpm != 0
  flush(): Float32Array;
  setParams(p: Partial<Omit<ChannelParams, 'sampleRate' | 'seed'>>): void;   // from the next sample
  reset(): void;
}
function createChannel(p: ChannelParams): Result<LineChannel, ModemError>;
function applyChannel(x: Float32Array, p: ChannelParams): Result<Float32Array, ModemError>;   // one-shot
```
Order of impairments: clock resampling, frequency offset, hum, bursts, then AWGN. The simulator has unit gain, so `signalAmplitude` must equal the amplitude of the signal passed in; it is the reference used to compute the noise, hum and burst levels. Eb/N0 and SNR refer to the AWGN only. Output is not clipped; consumers normalise before playback. With unchanged parameters, output does not depend on chunk boundaries.

### PN9 and BER API (`src/modem/prbs.ts`)
```ts
function pn9Frames(frames: number, o?: { startFrame?: number }): Uint8Array;   // 7 bits per byte, LSB first
function wilsonInterval(errors: number, bits: number, z: number): { lo: number; hi: number };
function wilson95(errors: number, bits: number): { lo: number; hi: number };   // = wilsonInterval(errors, bits, 1.96)
interface BerSnapshot { bits: number; errors: number; ber: number; lo: number; hi: number; synced: boolean; resyncs: number }
class BerCounter { pushFrame(value: number, framingOk: boolean): void; snapshot(): BerSnapshot; reset(): void }
```
The period is 511 bits = 73 frames of 7 bits. The 9 synchronisation bits are not counted. The `lo` and `hi` of `BerSnapshot` are the 95 % Wilson interval.

### Theory API (`src/modem/theory.ts`)
```ts
const FORWARD_RHO: number;                                                      // |sin(πh)/(πh)|, h = 2/3, derived from v23.ts
function berOrthogonalNoncoherent(ebN0Db: number): number;                      // curve 1
function berNoncoherentCorrelated(ebN0Db: number, rho: number): number;         // curve 2
```
Curve 3 is written by `scripts/montecarlo-ber.ts` to `public/data/ber-curve3.json` as `{ ebN0Db: number[]; ber: number[]; lo: number[]; hi: number[]; bitsPerPoint: number[]; seeds: number }`.

### WAV API (`src/modem/wav.ts`)
```ts
interface WavAudio { samples: Float32Array; sampleRate: number }                 // mono
const WAV_ERROR_REASONS: readonly ['too-short', 'not-riff', 'not-wave', 'missing-fmt', 'bad-fmt',
  'unsupported-encoding', 'missing-data', 'data-truncated', 'too-large'];
type WavErrorReason = (typeof WAV_ERROR_REASONS)[number];
function writeWav(samples: Float32Array, sampleRate: number): Result<Uint8Array, ModemError>;
function readWav(data: ArrayBuffer | Uint8Array): Result<WavAudio, ModemError>;
```
Added with task 4 (the first draft named only `writeWav` / `readWav` and the `wav` error); decisions W1 to W6.
- **Writing.** Mono 16-bit PCM, a fixed 44-byte header (RIFF, `fmt ` of 16 bytes, `data`), no other chunk and no timestamp, so equal input gives equal bytes (needed by fantome H1). Sample x is stored as q(x) = clamp(round(x·32768), −32768, 32767), with `Math.round` (W1). `sampleRate` must be an integer in 8 000..96 000 Hz, else `bad-sample-rate` (W3). `bad-option` `samples` when a sample is NaN or infinite (its index is in the reason, W2), when the input is not a `Float32Array`, or when 36 + 2n overflows the uint32 RIFF size (n > 2 147 483 629).
- **Reading.** 8-bit (unsigned), 16- and 24-bit PCM and 32-bit IEEE float, plain or in `WAVE_FORMAT_EXTENSIBLE` (sub-format GUID PCM or float, valid bits ≤ container bits). Integer codes are divided by 2^(bits−1) (8-bit: (u − 128)/128); float values are kept, NaN included. Several channels are averaged (arithmetic mean). Any header sample rate > 0 is returned; the demodulator checks the supported range (W3). Chunks other than `fmt ` and `data` are skipped with their odd-size pad byte; the RIFF size field is not trusted; the first `fmt ` and `data` are used. A chunk whose body runs past the end of the file ends the walk, except `data`, which is an error (W5).
- **Errors.** `{ kind: 'wav', reason }` where `reason` is a `WavErrorReason`: a stable code the app translates (never renamed). `too-short` (< 12 bytes), `not-riff`, `not-wave`, `missing-fmt`, `bad-fmt` (chunk < 16 bytes, 0 channels, 0 Hz, `blockAlign` ≠ channels·bits/8, bad extensible fields), `unsupported-encoding` (other codecs, 32-bit integer PCM (W6), 64-bit float, RIFX, RF64), `missing-data`, `data-truncated` (data past the end of the file, or not a whole number of frames), `too-large` (the header and data chunk are valid, but the `Float32Array` of decoded samples cannot be allocated, for example a multi-gigabyte recording or a device low on memory; readWav returns this code instead of letting the `RangeError` escape; not covered by tests, since triggering it needs a file of several GB). `bad-option` `data` when the input is neither an `ArrayBuffer` nor a typed-array view. `readWav` never throws.
- M9 holds exactly: `readWav(writeWav(x)).samples[i]` = q(x[i]) / 32768.

## Algorithms

### Modulator
- The bit timeline is computed in real time: bit k (counting idle lead as bits of mark) covers [t₀ + k/baud, t₀ + (k+1)/baud). Sample n gets the frequency of the bit that contains n / fs. This makes the length exact and stops rounding from accumulating.
- Phase in closed form, in double precision: c(t) = markHz·t + (spaceHz − markHz)·S(t) cycles, where S(t) is the time spent at space before t (integer count of past space bits divided by baud, plus the elapsed part of the current bit when it is a space). Sample = A·w(n)·sin(2π·frac(c(n/fs))), where w is the raised-cosine ramp at carrier start and end. c(t) is continuous, so the phase is exactly continuous at every bit boundary and no rounding accumulates.
  - Deviation from the first draft, recorded per AGENTS.md rule 7: the draft used an accumulator φ += 2π·f/fs with the frequency of the bit containing n/fs. That accumulator misplaces every bit boundary that falls between two samples by up to (spaceHz − markHz)/fs cycle; the closed form removes this error. Signatures and properties are unchanged.
- Ramp: R samples, w(n) = ½·(1 − cos(π·n/R)) for n < R and 1 from n = R; the ramp-down is symmetric and ends on the last sample (w = 0). The effective ramp length is min(`rampMs`, `leadIdleMs`) at the start and min(`rampMs`, `tailIdleMs`) at the end, also clamped to the number of idle samples, so a ramp never touches a frame sample. A zero idle or a zero `rampMs` means no ramp on that side. A ramp shorter than R_min = ⌈fs / (2√2·f_max)⌉ samples (f_max = max(markHz, spaceHz)) is also omitted: below that length the raised cosine itself breaks M3, while R ≥ R_min keeps |x[n+1] − x[n]| ≤ A·2π·f_max/fs (derivation in `modulator.ts`). R_min is at most 0.88 ms at every supported rate, so idles of 1 ms or more always keep their ramp; shorter idles are still accepted.
- `bitErrors` inverts chosen line bits after framing. It exists only for property tests (parity and framing errors) and is never set by the app. Indices count line bits from the first start bit (index 0), inter-frame idle bits included; the leading and trailing idle are not indexed. A non-integer or out-of-range index returns `bad-option`; a repeated index inverts its bit once.

### Discriminator
`src/modem/filters.ts` and `src/modem/discriminator.ts` are internal to the core (not exported by `index.ts`, decision T5-6). The transition widths and decimated rates live in `DISCRIMINATOR` in `v23.ts`, outside `ChannelSpec` (decision T5-3).
0. A NaN or infinite input sample is replaced by 0 and counted here, before the mixer (decision T5-5); the demodulator reports the count as `diag.nonFiniteCount`.
1. Complex mix: z[n] = x[n]·e^(−j2π·mixHz·n/fs), where n is the global input index since `reset()`. The phase is computed in closed form, frac(mixHz·n/fs), never accumulated, so it does not depend on chunk boundaries. Its only rounding is the division: at most ½ ulp(mixHz·t) cycles, i.e. 1.5·10⁻⁸ cycle after 24 h at any rate (measured in the tests against an exact BigInt reference).
2. Windowed-sinc low-pass (Hamming) whose **−6 dB point is `lowpassHz`** (reading c1, decision U2, selected by experiment E1): h[k] = 2f_c·sinc(2f_c(k − M))·w[k], f_c = `lowpassHz`/fs, M = (L − 1)/2, w[k] = 0.54 − 0.46·cos(2πk/(L − 1)), normalised to DC gain 1. Transition 400 Hz (forward), 60 Hz (backward), centred on `lowpassHz`. L = ⌈3.3·fs/transition⌉, made odd (397 taps at 48 kHz). Reading 1100 Hz as the passband edge (c3) was rejected: it leaves only 14.7 dB at 420 Hz. The forward filter gives ≥ 52.7 dB on the backward tones 390, 420 and 450 Hz and on 50 Hz at every rate; requirement 5.1 is checked on these tones, not on the whole 300 to 540 Hz band (decision T5-2: the band edge near 540 Hz gets only 31.6 dB).
3. Decimate by D = max(1, floor(fs / 16000)) for forward (≈ 13 samples per bit at 48 kHz) and D = max(1, floor(fs / 2000)) for backward. Only every D-th output is computed (polyphase), so the cost is divided by D. Input j produces an output when j + 1 is a multiple of D.
4. Frequency: f[m] = mixHz + arg(z[m]·conj(z[m−1]))·fs_d / 2π, from the second kept output on. Everything is computed in double precision; only the returned arrays are `Float32Array`. Silence (z = 0) gives f = mixHz.
5. Time compensation: an estimate computed at input index n is dated **n − (L − 1)/2 − D/2** input samples. The (L − 1)/2 term is the filter group delay. The −D/2 term dates a phase difference at the midpoint of its two samples. Without it, the step-alignment error measured by E2 reaches 1.12 samples at 48 kHz and 2.77 at 96 kHz; with it, requirement 5.3 holds (≤ 0.47 sample in E2, ≤ 0.54 in the task 5 tests including non-integer rates). Estimates dated before (L − 1 + D) − (L − 1)/2 − D/2 still contain the filter's zero history (warm-up).
   - Clarification recorded per AGENTS.md rule 7: the first draft subtracted only the group delay; the −D/2 term is required by requirement 5.3. Signatures and properties are unchanged.
6. `flush()` (feeding the filter tail) is defined with the streaming demodulator in task 7 (decision T5-7).

### Threshold
- Soft value: s = (f − θ) / ((spaceHz − markHz)/2). s < 0 is mark (1), s > 0 is space (0). Confidence is |s|.
- `fixed`: θ = thresholdHz.
- `adaptive` (decision-directed two-means):
  - μ_mark is initialised from the mean frequency during the first 20 ms of idle carrier (idle is mark by definition).
  - μ_space is initialised as μ_mark + (spaceHz − markHz).
  - After each decided bit, the mean frequency over that bit updates the matching estimate: μ ← (1 − α)μ + α·f̄, with α = 0.05.
  - θ = (μ_mark + μ_space)/2, and the reported offset is μ_mark − markHz.

Implementation choices (task 8, `src/modem/threshold.ts`, `uart.ts`, `demodulator.ts`; recorded per AGENTS.md rule 7):
- **Mode.** `threshold` defaults to `'adaptive'`; `'fixed'` and `'adaptive'` are accepted, any other value returns `bad-option`. `setThresholdMode` switches live: the UART keeps its state (position), and the new threshold applies from the next estimate processed; an invalid value is ignored.
- **Initialisation.** After each `carrier` on dated onT, the mean frequency of the settled estimates dated in [onT, onT + 20 ms) initialises μ_mark, and μ_space = μ_mark + (spaceHz − markHz). This runs in both modes, so a later switch to adaptive starts from the idle estimate. In adaptive mode the UART is not fed before that point (it starts on a known threshold); once started it is fed continuously, whatever the mode switches. Before initialisation the nominal values are used. The estimates are cleared at every `carrier` off, at `flush` and at `reset`: a new transmission may carry another offset. A transmission therefore needs about 20 ms (carrier detection) + 20 ms (initialisation) of idle mark before its first start bit; the default `leadIdleMs` of 100 ms leaves margin.
- **Decision-directed update (deviation from the text above).** Only the centre bit of a run of **five equal decided bits inside a frame** updates its tone estimate, with the mean frequency over its central window. Through the filter, a neighbouring bit of the other tone pulls the window mean towards it (inter-symbol interference). Measured in task 8, at 20 dB SNR (γ_3k), over the 8 standard rates and offsets of −400 to +400 Hz: updating on every bit biased the offset estimate by up to 66 Hz (44 of 72 cases outside ±20 Hz); on runs of 3, by up to 21.7 Hz; on runs of 5, the worst error is 10.6 Hz. Decisions are not affected in any of these cases. The fixed mode never updates.
- **Reporting.** `diag.thresholdHz`, `markHz` and `spaceHz` are the threshold in use and the tone estimates (adaptive mode, after initialisation) or the nominal values (fixed mode, or before initialisation); the estimated offset is `markHz − 1300`. They are the values in force just before the `diag` date: the state after a frame's update takes effect at the frame's decision time, so the report does not depend on chunk boundaries. `quality.offsetHz` arrives with task 10.
- **Non-regression.** The fixed path reads the same soft values (s = (f − 1700)/400 per estimate) and gives event lists identical to the task 7 code (SHA-256 digests of four signals, recorded in the tests).
- **Limit.** The estimates are initialised only at a carrier on. If the offset changes while the carrier stays on (for example a nominal connection carrier followed without a gap by an offset page), only the run-of-five updates move the estimates, slowly; decisions keep working while the offset error stays well inside the 400 Hz half gap.

### UART
States `HUNT → START → BITS → HUNT`. With T = fs_d / baud (fractional):
- HUNT: require at least one bit of mark; on a sign change of s from negative to positive, locate the edge t_e by linear interpolation between samples.
- START: the mean of s over [t_e + 0.25T, t_e + 0.75T] must be > 0, otherwise it is a false start and we return to HUNT.
- BITS: for i = 1..9, mean of s over [t_e + (i + 0.25)T, t_e + (i + 0.75)T]; bit = mean < 0 ? 1 : 0.
- Check parity (bits 1..8 even) and stop bit (bit 9 = 1). Emit `char`. On a framing error, return to HUNT at the current position.
- Each frame re-synchronises on its own start bit, so a clock error ε shifts the last sample by 9.75·ε·T. At ε = 2% that is 0.2 T, still inside the central window.

Implementation choices (task 6, `src/modem/uart.ts` and `threshold.ts`, internal to the core; recorded per AGENTS.md rule 7):
- **Input.** The UART reads the discriminator estimates (task 5) on their uniform grid of D input samples. Estimates dated before the discriminator's `settledTimeSamples` (filter warm-up) are ignored. All arithmetic is in double precision; the result does not depend on chunk boundaries.
- **Window mean (T6-1).** s between two estimates is the linear interpolation, and the mean over a window is the exact integral of that piecewise-linear s divided by the window length. The result does not depend on where the estimates fall in the window, which matters at 8 kHz (3.3 estimates per window).
- **Mark before a start edge (T6-2).** The mark run is measured from the last space-to-mark crossing (interpolated). After a reset, a false start or a framing error, an edge is accepted only after at least 1 T of measured mark. After a frame with a valid stop bit, the stop bit counts as that mark.
- **Resume point (T6-2, revised).** After a valid stop bit, HUNT resumes at the centre of the stop bit, t_e + 9.5 T; after a framing error, at the end of the stop window, t_e + 9.75 T (requirement 6.5). The first draft resumed at 9.75 T in both cases. Measured reason for the change (task 6, γ_3k = 20 dB, collated frames, 224 cases per clock model): with a transmitter clock fast by 2 %, the next start edge comes at about 9.8 T, inside the filter's transition, and resuming at 9.75 T missed it in 26 (bit clock) and 27 (resampled) cases, then decoded misaligned frames; resuming at 9.5 T gave 0 failures, and clean signals gave 0 failures either way.
- **`minConfidence` (T6-5).** The smallest |mean of s| over the 10 windows, start bit included.
- **`atSample` (T6-6).** The interpolated time of the mark-to-space crossing of s, in input samples, group-delay compensated (task 5 dating). Requirement 6.1 ("sub-sample precision") is read on the grid the UART works on: the edge is located between two estimates, and the target on a clean signal is **≤ 1 decimated estimate, i.e. ≤ D input samples**. The residual error is about 36 µs (0.03 to 0.05 T) whatever the sampling rate, caused by inter-symbol interference through the discriminator (largest when the start bit lasts only 1 T, d0 = 1); it is therefore about 3.4 input samples at 96 kHz (D = 6) and 0.3 at 8 kHz (D = 1). A target of 1 input sample was rejected: it cannot be met above 32 kHz without a different receiver.
- **Start check.** As specified, a start bit is valid when the mean of s over its central window is positive. Measured: an isolated space pulse of up to 0.4 T is rejected as a false start; from about 0.5 T it passes and is read as a frame (0x7F with good parity and framing for an isolated pulse). This is a property of the criterion, covered by a characterization test; carrier detection (task 7) limits it to the carrier-on periods.
- **Threshold.** Fixed at `thresholdHz` (1700 Hz forward) until task 8.
- **Noise in M8.** "20 dB SNR" is γ_3k = 20 dB (glossary: noise in 3 kHz unless stated otherwise), i.e. Eb/N0 = 23.98 dB, under the convention of `docs/math.md` section 2 (A7). M8 is tested with two clock models: a transmitter bit clock off by ε with nominal tones, and the whole signal resampled by 1/(1 + ε) (tones shifted too).

### Carrier and answer tone
- Carrier: mean |z|² over 10 ms. On when it is above `carrierOnDbfs` for 20 ms, off when it is below `carrierOnDbfs − 3 dB` for 50 ms.
- Answer tone: Goertzel at 2100 Hz over 20 ms blocks, compared with the total band energy. `connect` is emitted after 500 ms of continuous tone.

Implementation choices (task 7, `src/modem/carrier.ts` and `demodulator.ts`; recorded per AGENTS.md rule 7):
- **Level reference (T7-1, D6 of `docs/math.md`).** Carrier level = 10·log10(4·mean |z|²) dBFS: a carrier of peak amplitude A reads 20·log10(A) dBFS (A = 0.5 gives −6.02 dBFS), so the default −45 dBFS is A ≈ 0.0056. The constants live in `CARRIER` and `ANSWER_TONE` in `v23.ts`, outside `ChannelSpec`.
- **Carrier windows.** 10 ms windows [k·W, (k+1)·W) on the compensated time base of the discriminator; their mean |z|² is compared with `carrierOnDbfs` (on after 2 consecutive windows at or above it) and with `carrierOnDbfs − 3 dB` (off after 5 consecutive windows below it). A level between the two thresholds holds the current state: hysteresis delays the drop, it does not lower the level needed to start. A window with no settled estimate keeps the previous level. The decision is dated at the end of the window.
- **Answer tone (T7-3).** Goertzel at exactly 2100 Hz on the raw input, 20 ms blocks aligned on the absolute input index. The 2100 Hz power of a real block of N samples is 2·|X|²/N², with |X|² = g1² + g2² − 2cos(ω)·g1·g2, so a pure tone of amplitude A gives A²/2, its mean square (corrected in task 8: the first implementation had the wrong real part and a factor 2 missing, and missed `connect` at 8 and 16 kHz). A block is a tone when its 2100 Hz power is at least half of the block's mean square and the block level (mean square / 2) is at least `carrierOnDbfs`. `connect` is emitted once after 25 consecutive tone blocks (500 ms), dated at the end of the 25th block, and re-armed by one block that is not a tone.
- **Character gating.** The UART receives estimates only while the carrier is on, and is reset when the carrier drops, so silence (read as 1800 Hz, space) cannot invent characters.
- **Time boundaries (M5).** The discriminator delivers the estimate dated t only once input t + (L − 1)/2 + D/2 has been pushed. Every boundary on that time base is therefore crossed by **estimate time, never by input index**: carrier window k closes when an estimate dated (k+1)·W or later arrives, and the `diag` dated B is emitted once an estimate dated B or later has arrived. Estimates arrive in time order, so all the estimates before the boundary are present whatever the chunk boundaries, and no estimate is skipped. The answer-tone blocks run on the raw input and are crossed by input index. Recorded after a measured failure of M5: closing on the input index emitted a `diag` 67 estimates short at 16 kHz when a chunk ended on its boundary, and delayed `carrier on` by one window (160 samples) when a chunk ended on a window end.
- **Event dates.** Every `atSample` is the nearest integer input-sample index since `reset()` (T7-2), on the compensated time base. `carrier` is dated at the end of the deciding window, `connect` at the end of the 25th tone block, `char` at its start edge, `diag` at its boundary (or at the end of the input for the last `diag` of `flush`).
- **Event order and latency (M5).** Events become known with different delays: a `carrier` or `diag` dated B once input B + (L − 1)/2 + D/2 has been pushed (66.5 input samples at 16 kHz, 198.5 at 48 kHz), a `char` only when its frame is decided, 9.75 bit periods after its start. So that the concatenation of everything `push` and `flush` return is the same list for any chunking, the demodulator holds every event and releases it once no earlier event can still appear: an event dated a is released when an estimate dated a + 9.75·T + D + 0.5 or later has arrived (T = fs/baud; 131.5 input samples at 16 kHz, 393.5 at 48 kHz, about 8.2 ms), then the fixed filter latency above. Released events are in (`atSample`, type) order, with the type order `carrier` < `connect` < `char` < `quality` < `diag` for equal dates. `flush` releases everything still held. This supersedes the first draft's "events are emitted in detection order"; consumers may still sort by `atSample`, which is now a no-op. Recorded per AGENTS.md rule 7, after a measured failure: with 1-sample chunks, a `diag` dated 3200 was returned before a `char` dated 3180.
- **`diag` (T7-6).** At every absolute 50 ms boundary B = k·round(0.05·fs), carrier on or off. `freqHz` holds the settled estimates dated in [previous diag, B), `decimation` is D, `thresholdHz`, `markHz` and `spaceHz` are the nominal values (fixed threshold), `nonFiniteCount` is cumulative since `reset()`. `bitWindows` holds the 10 bit windows of every frame **decided** in that interval (decision time t_e + 9.75·T), a frame being reported whole in a single `diag`. The UART decides a frame at the first estimate dated at or after its decision time, and a `diag` dated B is built only after an estimate dated B or later, so the assignment never depends on chunk boundaries. Recorded after a measured failure: assigning windows by their start time lost the first 2 windows of a frame starting 20 samples before a boundary when the input came in 1-sample chunks.
- **`flush` (T7-4).** Feeds the filter (L − 1)/2 + D/2 + 2D internal zeros, which are not input time and are not given to the answer-tone detector, so that the filter delivers the estimates of the last real samples. Only estimates dated strictly before the end of the real input are kept; those dated after it are discarded. The kept estimates dated within (L − 1)/2 of the end see the zeros (filter tail). flush then closes the carrier windows and `diag` boundaries up to that end, emits the characters completed inside the real input (a frame cut by the end is dropped), forces the carrier off at the end of the input if it was on, emits a final `diag` dated at the end of the input for the interval since the last boundary (none when the end is itself a boundary), and releases every held event. It then restarts the discriminator and the detectors: time continues from the last real sample, the carrier windows, answer-tone blocks and `diag` boundaries stay on the absolute grids, the filter warms up again, and `nonFiniteCount` stays cumulative.
- **No `quality` event before task 10 (T7-5).** The backward channel returns `bad-option` until task 14 (T7-7).

### Quality (M2M4 estimator)
For a constant-envelope signal plus complex Gaussian noise, with M2 = E|z|² and M4 = E|z|⁴ over the last 100 ms:
S = √(2·M2² − M4), N = M2 − S, SNR_band = S/N.
- SNR at 3 kHz: SNR_band · B_n / 3000, where B_n = fs·Σh² / (Σh)² is the two-sided equivalent noise bandwidth of the complex low-pass, computed from its taps (≈ 2·lowpassHz). The 3 000 Hz is a one-sided reference band.
- Eb/N0 = (S / baud) / (N / B_n) = SNR_band · B_n / baud.
Definitions and notation (γ_band, γ_3k, Eb/N0, signal power P = A²/2, mixer normalisation) are fixed in `docs/math.md`. Eb/N0 is reported for the signal received at the demodulator input.
- If 2·M2² − M4 ≤ 0, report SNR as `-Infinity` (noise only).

### PN9 and BER
- LFSR x⁹ + x⁵ + 1, seed 0x1FF, period 511. Bits are packed 7 per frame, least significant first.
- Receiver: load 9 received bits into its own LFSR, then predict every next bit and count mismatches. Reseed when more than 20 of the last 100 bits are wrong. Bits of frames with framing errors are counted as errors.
- Wilson interval: (p̂ + z²/2n ± z·√(p̂(1−p̂)/n + z²/4n²)) / (1 + z²/n). `wilsonInterval(errors, bits, z)` is the single implementation for every confidence level; the 95 % interval is z = 1.96 (`wilson95`). For `bits = 0` the interval is [0, 1]; invalid arguments (non-integer counts, `errors` outside [0, `bits`], `z` ≤ 0) return `NaN` bounds and never throw.

## Math notes (`src/modem/theory.ts`, derivations in `docs/math.md`)
These notes are for the mathematician to check and extend.
- V.23 forward has modulation index h = Δf·T = 800/1200 = 2/3. Over a bit, the two tones are **not orthogonal**: |ρ| = |sin(πh)/(πh)| ≈ 0.41.
- Reference curve 1, orthogonal non-coherent BFSK: P_b = ½·exp(−E_b / 2N₀).
- Reference curve 2, non-coherent binary signals with correlation ρ (envelope detection):
  P_b = Q₁(a, b) − ½·exp(−(a² + b²)/2)·I₀(ab), with a, b = √(E_b/2N₀ · (1 ∓ √(1 − |ρ|²))). Q₁ is the Marcum Q function. To be confirmed by the mathematician.
- Curve 3, what our receiver actually does: a Monte Carlo simulation of the full modulator → channel → demodulator chain, with Wilson intervals. The live points in 3615 MATHS must fall inside this band. The gap between curves 2 and 3 shows the price of a discriminator receiver compared with an ideal one.
- `[STRETCH]` A second demodulator: two non-coherent quadrature correlators per bit (energy comparison), plotted next to the discriminator.

## Correctness properties
| ID | Property |
|---|---|
| M1 | Round-trip: for any 7-bit byte sequence (length 0-500) and any fs in {8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000}, demodulate(modulate(b)) returns b, all `parityOk` and `framingOk`. |
| M2 | Exact length: output length = round(fs·(lead + 10·n/baud + idle bits/baud + tail)) ± 1. |
| M3 | Phase continuity: |x[n+1] − x[n]| ≤ A·2π·f_max/fs + 1e-6 for all n. |
| M4 | Parity: every generated frame has even weight over data + parity. Inverting any single data or parity line bit (line bits 1 to 8) of a frame (`bitErrors`) yields `parityOk = false` for that frame. Inverting the start bit (bit 0) or the stop bit (bit 9) is outside this property: a start-bit inversion loses the frame, and a stop-bit inversion yields `framingOk = false` and may lose the following frame. Both behaviours are covered by characterization tests. |
| M5 | Chunk invariance: for any partition of the input into chunks, the event list is identical. |
| M6 | Noise: at Eb/N0 ≥ 12 dB (target, to calibrate), BER on 20 000 PN9 bits is ≤ 1e-3 for 20 seeds. |
| M7 | Offset: in adaptive mode, for any offset in [−400, +400] Hz at 20 dB SNR, bytes are decoded without error and \|offsetHz − true offset\| ≤ 20. |
| M8 | Clock: for any clock error in [−2%, +2%], bytes are decoded without error at 20 dB SNR (γ_3k, see "UART"). |
| M9 | WAV: readWav(writeWav(x)) equals x quantized to 16 bits. |
| M10 | SNR estimator: for band SNR in [0, 30] dB, the estimate is within ±1 dB (mean over 10 seeds). |
| M11 | PN9: period is 511; with k injected bit errors among n bits and no framing errors, the counter reports exactly k errors. |
| M12 | Theory: curve 1 and curve 2 are decreasing in Eb/N0; curve 2 equals curve 1 when ρ = 0 (numerical check ≤ 1e-6). |
| M13 `[STRETCH]` | Full duplex: forward and backward at equal amplitude are both decoded without error at 20 dB SNR. |

## Error handling
- Bad sample rate (outside 8-96 kHz) or byte > 127: typed `ModemError`.
- Non-finite samples (NaN, ∞) in input are replaced with 0 and counted in `diag.nonFiniteCount`.
- The demodulator never throws on any input.

## Testing
- Property tests M1-M13 in `tests/properties/v23-modem.test.ts` with seeded RNG.
- Two modes with identical test names: fast (default) and slow (`NEOMINITEL_SLOW=1`: more cases, enables the Monte Carlo properties M6 and M10).
- Calibration script `scripts/calibrate-modem.ts`: BER vs Eb/N0 for both threshold modes, SNR estimator bias, written to `docs/calibration.md`.
