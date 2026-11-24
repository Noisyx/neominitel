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

## Algorithms

### Modulator
- The bit timeline is computed in real time: bit k (counting idle lead as bits of mark) covers [t₀ + k/baud, t₀ + (k+1)/baud). Sample n gets the frequency of the bit that contains n / fs. This makes the length exact and stops rounding from accumulating.
- Phase in closed form, in double precision: c(t) = markHz·t + (spaceHz − markHz)·S(t) cycles, where S(t) is the time spent at space before t (integer count of past space bits divided by baud, plus the elapsed part of the current bit when it is a space). Sample = A·w(n)·sin(2π·frac(c(n/fs))), where w is the raised-cosine ramp at carrier start and end. c(t) is continuous, so the phase is exactly continuous at every bit boundary and no rounding accumulates.
  - Deviation from the first draft, recorded per AGENTS.md rule 7: the draft used an accumulator φ += 2π·f/fs with the frequency of the bit containing n/fs. That accumulator misplaces every bit boundary that falls between two samples by up to (spaceHz − markHz)/fs cycle; the closed form removes this error. Signatures and properties are unchanged.
- Ramp: R samples, w(n) = ½·(1 − cos(π·n/R)) for n < R and 1 from n = R; the ramp-down is symmetric and ends on the last sample (w = 0). The effective ramp length is min(`rampMs`, `leadIdleMs`) at the start and min(`rampMs`, `tailIdleMs`) at the end, also clamped to the number of idle samples, so a ramp never touches a frame sample. A zero idle or a zero `rampMs` means no ramp on that side. A ramp shorter than R_min = ⌈fs / (2√2·f_max)⌉ samples (f_max = max(markHz, spaceHz)) is also omitted: below that length the raised cosine itself breaks M3, while R ≥ R_min keeps |x[n+1] − x[n]| ≤ A·2π·f_max/fs (derivation in `modulator.ts`). R_min is at most 0.88 ms at every supported rate, so idles of 1 ms or more always keep their ramp; shorter idles are still accepted.
- `bitErrors` inverts chosen line bits after framing. It exists only for property tests (parity and framing errors) and is never set by the app. Indices count line bits from the first start bit (index 0), inter-frame idle bits included; the leading and trailing idle are not indexed. A non-integer or out-of-range index returns `bad-option`; a repeated index inverts its bit once.

### Discriminator
1. Complex mix: z[n] = x[n]·e^(−j2π·mixHz·n/fs).
2. Windowed-sinc low-pass (Hamming), cutoff `lowpassHz`, transition 400 Hz (forward), 60 Hz (backward). The number of taps is derived from fs.
3. Decimate by D = max(1, floor(fs / 16000)) for forward (≈ 13 samples per bit at 48 kHz) and D = max(1, floor(fs / 2000)) for backward. Only every D-th output is computed (polyphase), so the cost is divided by D.
4. Frequency: f[m] = mixHz + arg(z[m]·conj(z[m−1]))·fs_d / 2π.
5. Group delay (taps − 1)/2 input samples is subtracted from every reported time.

### Threshold
- Soft value: s = (f − θ) / ((spaceHz − markHz)/2). s < 0 is mark (1), s > 0 is space (0). Confidence is |s|.
- `fixed`: θ = thresholdHz.
- `adaptive` (decision-directed two-means):
  - μ_mark is initialised from the mean frequency during the first 20 ms of idle carrier (idle is mark by definition).
  - μ_space is initialised as μ_mark + (spaceHz − markHz).
  - After each decided bit, the mean frequency over that bit updates the matching estimate: μ ← (1 − α)μ + α·f̄, with α = 0.05.
  - θ = (μ_mark + μ_space)/2, and the reported offset is μ_mark − markHz.

### UART
States `HUNT → START → BITS → HUNT`. With T = fs_d / baud (fractional):
- HUNT: require at least one bit of mark; on a sign change of s from negative to positive, locate the edge t_e by linear interpolation between samples.
- START: the mean of s over [t_e + 0.25T, t_e + 0.75T] must be > 0, otherwise it is a false start and we return to HUNT.
- BITS: for i = 1..9, mean of s over [t_e + (i + 0.25)T, t_e + (i + 0.75)T]; bit = mean < 0 ? 1 : 0.
- Check parity (bits 1..8 even) and stop bit (bit 9 = 1). Emit `char`. On a framing error, return to HUNT at the current position.
- Each frame re-synchronises on its own start bit, so a clock error ε shifts the last sample by 9.75·ε·T. At ε = 2% that is 0.2 T, still inside the central window.

### Carrier and answer tone
- Carrier: mean |z|² over 10 ms. On when it is above `carrierOnDbfs` for 20 ms, off when it is below `carrierOnDbfs − 3 dB` for 50 ms.
- Answer tone: Goertzel at 2100 Hz over 20 ms blocks, compared with the total band energy. `connect` is emitted after 500 ms of continuous tone.

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
| M8 | Clock: for any clock error in [−2%, +2%], bytes are decoded without error at 20 dB SNR. |
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
