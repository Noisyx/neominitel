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
  threshold?: 'fixed' | 'adaptive';              // default 'adaptive'
  carrierOnDbfs?: number;                        // default -45, hysteresis 3 dB
}
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
  | { type: 'quality'; snrBandDb: number; snr3kDb: number; ebN0Db: number; parityErrorRate: number; offsetHz: number }
  | { type: 'diag'; freqHz: Float32Array; decimation: number; bitWindows: [number, number][]; thresholdHz: number; markHz: number; spaceHz: number };

type ModemError =
  | { kind: 'byte-out-of-range'; index: number; value: number }
  | { kind: 'bad-sample-rate'; sampleRate: number }
  | { kind: 'wav'; reason: string };
```

`Result<T, E>` is `{ ok: true; value: T } | { ok: false; error: E }`. No untyped exceptions leave the core.

## Algorithms

### Modulator
- The bit timeline is computed in real time: bit k (counting idle lead as bits of mark) covers [t₀ + k/baud, t₀ + (k+1)/baud). Sample n gets the frequency of the bit that contains n / fs. This makes the length exact and stops rounding from accumulating.
- Phase accumulator in double precision: φ += 2π·f/fs, sample = A·w(n)·sin φ, where w is the raised-cosine ramp at carrier start and end.
- `bitErrors` inverts chosen line bits after framing. It exists only for property tests (parity and framing errors) and is never set by the app.

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
- SNR at 3 kHz: SNR_band · B_n / 3000, where B_n is the equivalent noise bandwidth of the low-pass (≈ 2·lowpassHz).
- Eb/N0 = (S / baud) / (N / B_n) = SNR_band · B_n / baud.
- If 2·M2² − M4 ≤ 0, report SNR as `-Infinity` (noise only).

### PN9 and BER
- LFSR x⁹ + x⁵ + 1, seed 0x1FF, period 511. Bits are packed 7 per frame, least significant first.
- Receiver: load 9 received bits into its own LFSR, then predict every next bit and count mismatches. Reseed when more than 20 of the last 100 bits are wrong. Bits of frames with framing errors are counted as errors.
- Wilson 95% interval: (p̂ + z²/2n ± z·√(p̂(1−p̂)/n + z²/4n²)) / (1 + z²/n), with z = 1.96.

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
| M4 | Parity: every generated frame has even weight over data + parity. Inverting any single line bit of a frame (`bitErrors`) yields `parityOk = false` or `framingOk = false` for that frame. |
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
- Non-finite samples (NaN, ∞) in input are replaced with 0 and counted in `diag`.
- The demodulator never throws on any input.

## Testing
- Property tests M1-M13 in `tests/properties/v23-modem.test.ts` with seeded RNG.
- Calibration script `scripts/calibrate-modem.ts`: BER vs Eb/N0 for both threshold modes, SNR estimator bias, written to `docs/calibration.md`.
