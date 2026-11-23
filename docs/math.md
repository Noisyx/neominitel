# NeoMinitel: the mathematics of the modem

Author: Role B (math, signal and Kiro). This document explains what the V.23 modem does, fixes the
signal and noise conventions shared by the code and the tests, and records the numerical evidence.

## Status of every statement

Each result carries one status:

| Status | Meaning |
|---|---|
| `Identity` | Algebraic identity, true without any simulation. |
| `Hypothesis` | Numerical prediction by hand calculation, not executed. |
| `Prototype result (Exx, commit, seed)` | Executed simulation in `prototypes/dsp/`. Never a hardware validation. |
| `Hardware measurement (device, date)` | Real speaker, microphone and room. |

Prototype results are simulations. They are never presented as hardware measurements.

---

## 1. What the modem does, in plain words

A Minitel page is a list of characters. The modem sends each character as **ten bits**: one start bit
(0), seven data bits (least significant first), one parity bit chosen so that the eight data and
parity bits contain an even number of ones, and one stop bit (1). Between characters the line rests
at 1.

Each bit becomes **a tone** for 1/1200 of a second: 1300 Hz for a 1 ("mark") and 2100 Hz for a 0
("space"). The tone never jumps in phase from one bit to the next, which is why the modem sounds like
a continuous warble rather than a series of clicks.

To read the sound back, the receiver:

1. **Shifts** the whole band down so that 1800 Hz, the middle of the two tones, becomes 0 Hz. Mark
   becomes -500 Hz and space +300 Hz.
2. **Filters** away everything outside the band: the slow return channel (390 and 450 Hz), mains
   hum (50 Hz) and the mirror image created by the shift.
3. **Measures the frequency** at every instant, from how fast the phase of the shifted signal turns.
4. **Decides** each bit by averaging that frequency over the middle half of the bit and comparing it
   with a threshold (1700 Hz, or a value learnt from the signal in adaptive mode).
5. **Rebuilds** the characters from the start bit, and checks parity and stop bit.

Noise makes the measured frequency wobble. When the wobble crosses the threshold, a bit is wrong.
The bit error rate (BER) depends on how strong the signal is compared with the noise, measured by
Eb/N0 (section 2).

---

## 2. Signal and noise convention

> **Status: Draft.** Experiment E3a has been executed (section 3.2) and is consistent with this
> convention. The convention becomes final when both developers sign it below.
> Numeric conversion examples are added only after both signatures (decision A7).
>
> Signed, Role A: ________ (date: ____)   Signed, Role B: ________ (date: ____)

### 2.1 Definitions

**D1. Signal level.** At the receiver input, before the mixer, x[n] = s[n] + w[n].

- A_mod is the peak amplitude at the modulator output (`ModulateOptions.amplitude`).
- A_rx is the peak amplitude of the carrier actually received at x[n].
- In a unit-gain simulation (the line simulator only shifts, resamples and adds noise),
  A_rx = A_mod. On hardware, A_rx = g · A_mod with an unknown, possibly time-varying gain g
  (speaker, room, microphone, automatic gain control).
- P = A_rx² / 2 is the received carrier power (constant envelope, the 5 ms ramps excluded).
- **Eb/N0 is always relative to the received signal.** In simulation it is *set* (input of the
  channel). On hardware it is *estimated* (carrier-only and noise-only segments, or the M2M4
  estimator), and the method and uncertainty are stated with the value.
- Only the white noise w enters N0. Mains hum and noise bursts are separate impairments.

**D2. Noise.** w[n] is white, real, Gaussian, with variance σ² per real sample. Its two-sided power
spectral density is σ²/fs; its one-sided density is **N0 = 2σ² / fs**.

At a fixed physical density N0, σ² = N0 · fs / 2 grows with fs. The simulator is parameterised by
Eb/N0 and derives σ² from fs (relation R1 below), so Eb/N0 is held fixed across sampling rates.
"N0 is independent of fs" is true only under that condition.

**D3. Mixer and baseband model.** The production mixer has gain 1 (design.md):
v[n] = x[n] · exp(-j θₙ), θₙ = 2π f_mix n / fs, f_mix = 1800 Hz.

- *Raw mix.* For the noise part, E|v|² = σ² at every n and the spectral density is flat (σ²/fs).
  The I and Q parts have time-varying variances σ² cos² θₙ and σ² sin² θₙ and a non-zero
  cross-covariance. The raw noise is **improper**: its pseudo-covariance is
  E[vₙ²] = σ² exp(-2j θₙ). (`Identity`)
- *Equivalent baseband model after image rejection.* y = h * v with Σ hₖ = 1.
  E|y|² = σ² B_n / fs = N0 B_n / 2 (gain 1). The carrier power after filtering is A²/4 = P/2.
  The ratio (P/2) / (N0 B_n / 2) = P / (N0 B_n) = γ_band. (`Identity`)
- *Analysis-only, power-preserving convention:* multiply y by √2. Signal power becomes P and noise
  power N0 B_n. This convention is not used in the code. All ratios are identical in both.
- Properness of y is a hypothesis, tested by E3a (a6) at zero lag only (section 3.2).

**D4. Noise bandwidth.** B_n = fs Σ hₖ² / (Σ hₖ)² = ∫ |H(f)|² df / |H(0)|² over (-fs/2, fs/2)
(Parseval). It is the **two-sided** equivalent noise bandwidth of the complex low-pass, which
corresponds to a one-sided real band of width B_n around f_mix. It is always computed from the taps.

**D5. 3 kHz reference band.** The 3000 Hz of γ_3k is a **one-sided** reference band (positive
frequencies), independent of the filter. The reference noise power is N0 · 3000.

**D6. dBFS reference of `carrierOnDbfs`.** *Proposal, to be agreed with Role A (not yet in the spec):*
0 dBFS is a full-scale real sine (peak 1, power 1/2). A real carrier of power P is at
10 log10(2P) dBFS. With the gain-1 mixer, a carrier gives mean |z|² = P/2 after the low-pass, so the
carrier level in dBFS is 10 log10(4 · mean |z|²). Example: A = 0.5 gives -6.0 dBFS. (`Identity`
under this proposal.)

### 2.2 Notation

| Symbol | Name in code | Definition |
|---|---|---|
| γ_band | `snrBandDb` | P / (N0 · B_n): signal-to-noise ratio in the filter band |
| γ_3k | `snr3kDb` | P / (N0 · 3000): same ratio in the one-sided 3 kHz reference band |
| Eb/N0 | `ebN0Db` | (P / R) / N0 with R = 1200 **line** bits per second |
| Qg(x) | | 0.5 · erfc(x / √2): Gaussian tail |
| marcumQ1(a, b) | `marcumQ1` | ∫_b^∞ x exp(-(x² + a²)/2) I0(a x) dx: Marcum Q function of order 1 |

The symbol γ_b is never used: in the literature (Proakis) it means Eb/N0, while γ_band is a ratio
inside the filter. Qg and marcumQ1 are different functions; neither is ever abbreviated to "Q".

The convention is **per line bit** (start, data, parity and stop bits all count). Expressed per
information bit (7 of 10), Eb/N0 would be 10 log10(10/7) = 1.55 dB higher. (`Identity`)

### 2.3 Relations (`Identity` under D1 to D5)

- R1: σ² = A² fs / (4 R · 10^(Eb/N0 [dB] / 10))
- R2: Eb/N0 = A² fs / (4 R σ²)
- R3: γ_band = A² fs / (4 B_n σ²)
- R4: γ_3k = A² fs / (12000 σ²)
- R5: Eb/N0 = γ_band · B_n / R = γ_3k · 3000 / R. In dB: Eb/N0 = γ_3k + 3.98 dB, and
  Eb/N0 = γ_band + 10 log10(B_n / R).

E3a verifies that the implemented chain realises D1 to D5 (section 3.2).

---

## 3. Prototype findings (simulation only)

All experiments are in `prototypes/dsp/`, run with plain Node and recorded in
`prototypes/dsp/results/` (CSV and `meta.json` with commit, RNG and seeds). Commit of the recorded
run: see each `meta.json` (`6797a2f` for the run of 23 Nov 2026).

### 3.1 E1, filter margins (`Prototype result (E1, 6797a2f, deterministic)`)

Forward low-pass, 4 windows x 3 cutoff conventions x 8 sampling rates. Worst case over the 8 rates:

| Convention | Window | Taps at 48 kHz | B_n at 48 kHz | Min stopband att. (\|f\| ≥ 1380 Hz) | Ripple over [-950, 850] Hz | Att. at 420 Hz |
|---|---|---|---|---|---|---|
| c1: -6 dB at 1100 Hz, transition 400 Hz | Hamming | 397 | 2099.0 Hz | 56.6 dB | 0.334 dB | 56.6 dB |
| c1 | Blackman | 661 | 2125.2 Hz | 75.3 dB | 0.074 dB | 76.2 dB |
| c2: -6 dB at 1150 Hz, transition 300 Hz | Hamming | 529 | 2226.5 Hz | 56.8 dB | 0.023 dB | 57.6 dB |
| c3: passband edge 1100 Hz, transition 400 Hz | Hamming | 397 | 2500.7 Hz | 14.7 dB | 0.027 dB | 14.7 dB |

- The spec filter (Hamming, `lowpassHz` = 1100 Hz, transition 400 Hz) meets requirement 5.1 **if
  1100 Hz is read as the -6 dB point** (reading c1): worst attenuation 56.6 dB at 420 Hz, 52.8 dB at
  450 Hz, 62.5 dB at 390 Hz, 60.5 dB at 50 Hz. If 1100 Hz is read as the passband edge (c3), it gets
  only 14.7 dB at 420 Hz and fails. Choosing the reading is decision U2 (owner).
- Between the backward tones the c1 Hamming filter is weaker: over the whole backward band
  300 to 540 Hz (|f| from 1260 to 1500 Hz after the mixer) the minimum is 31.6 dB, at the band edge
  near 540 Hz. The two actual backward tones (390 and 450 Hz) are rejected by more than 52 dB.
- The mark tone shifted by -400 Hz (900 Hz, at -900 Hz after the mixer) loses only 0.04 dB.
- Pre-registered rule (≥ 46 dB for |f| ≥ 1380 Hz, ripple ≤ 0.5 dB, all rates): met by all c1 and c2
  candidates; c1 Hamming is the cheapest and is the candidate for J3-1.
- B_n of the selected filter: 2099 to 2100 Hz (not the 2200 Hz assumed during planning).

### 3.2 E3a, noise and level chain (`Prototype result (E3a, 6797a2f, keys E3a|fs=<fs>|seed=1..20|role=noise)`)

Filter c1 Hamming; fs in {8000, 16000, 48000}; 20 seeds of 2·10⁶ samples; σ² = 1. The first
N_taps - 1 outputs are excluded before every measurement.

| Check | Result at 8 / 16 / 48 kHz | Verdict |
|---|---|---|
| a1 generator variance vs σ² | +0.012 %, -0.021 %, +0.060 % | pass |
| a2 one-sided PSD (300 to 3400 Hz) vs N0 = 2σ²/fs | +0.028 %, +0.022 %, +0.135 % | pass |
| a3 B_n from taps vs ∫\|H\|² | relative 10⁻¹⁵ | pass |
| a4 E\|v\|² vs σ² | +0.029 %, +0.016 %, +0.015 % | pass |
| a5 E\|y\|² vs N0 B_n / 2 | +0.047 %, +0.005 %, +0.068 % | pass |
| a6 C_p within 3 SE of theory | yes at all rates | pass |
| a6 ρ_p theoretical ≤ 0.01 | 5.7·10⁻⁷, 4.8·10⁻⁷, 4.3·10⁻⁷ | pass |
| a6 ρ_p measured ≤ 0.01 + 3 SE | 7.5·10⁻⁸, 6.7·10⁻⁷, 1.0·10⁻⁶ | pass |
| a6 positive control (unfiltered mix) ρ_p = 1 | 1 (exact identity) | pass |
| a7 tone power vs A²/4 (1300, 1700, 2100 Hz) | within -0.59 % to +0.02 % | pass |
| Sensitivity, 5 N_taps exclusion, \|diff\| ≤ 1 SE | E\|y\|²: pass at all rates; Re C_p at 48 kHz: **fail** (1.67 SE) | 8 of 9 pass |

Reading:

- The noise and level chain realises D2 to D5 within 0.14 % at the three rates.
- After filtering, the noise is proper **at zero lag**: the pseudo-variance is below 10⁻⁶ of the
  noise power. This was not tested at other lags.
- The positive control turned out to be an exact identity (v² e^{2jθ} = w²), so it checks the
  code path only.
- The one failed pre-registered criterion is the sensitivity of Re C_p at 48 kHz. The difference is
  2.5·10⁻⁸, which is 6·10⁻⁷ of E|y|² and four orders of magnitude below τ_p = 0.01. It is reported
  as a failure of the pre-registered criterion. The criterion is not redefined after the fact.
  Hypothesis: the estimator's standard error (10⁻⁸) is so small that a deterministic edge effect of
  the rotating average over the shorter window is visible.

### 3.3 E2, discriminator (`Prototype result (E2, 6797a2f, deterministic)`)

- RMS frequency error on clean tones 1000 to 2500 Hz, 8 rates: worst 0.93 Hz (target ≤ 15 Hz).
- Alignment on a frequency step, worst over 4 step positions:
  - subtracting only the group delay (L - 1)/2: 0.04 to 0.06 sample for D = 1, 0.62 for D = 2,
    **1.12 for D = 3 (48 kHz) and 2.77 for D = 6 (96 kHz)**;
  - also dating each estimate at the midpoint of its two samples (subtract D/2): ≤ 0.47 sample at
    every rate.
- Consequence for J3-2 (implementation, no spec change): a phase-difference output is dated at the
  midpoint of the two samples it uses; then requirement 5.3 (≤ 1 input sample) holds.

### 3.4 E7, cost of mixer + polyphase FIR (`Prototype result (E7, 6797a2f)`)

Developer machine (Intel Core i5-8350U, one Node thread). Not the spec's mid-range laptop.

ms of CPU per second of audio, median of 5 runs (min to max in brackets), filter c1 Hamming:

| Run | 8 kHz | 44.1 kHz | 48 kHz | 96 kHz |
|---|---|---|---|---|
| First run (uncommitted tree, same code) | 2.2 | 19.8 | 17.0 (15.8 to 18.1) | 30.7 |
| Recorded run, commit `6797a2f` (`results/e7-perf.csv`) | 3.0 | 35.7 | 27.7 (25.4 to 33.3) | 105.5 (74.1 to 153.2) |

- At 48 kHz the alert threshold of 40 ms/s is met in both runs.
- The two runs differ by up to a factor 3 at 96 kHz. This laptop's timings are noisy (likely thermal
  throttling or background load), so these numbers are indicative only.
- 44.1 kHz costs more than 48 kHz because D = 2 gives more outputs per second than D = 3.
- 96 kHz is outside requirement 13.1 (which is stated at 48 kHz) but may matter on devices that
  capture at 96 kHz. To be re-measured in task 13.

### 3.5 E3c, reference BER formula (`Prototype result (E3c, 6797a2f, keys E3c|series=1|...|seed=1..20)`)

Two-symbol non-coherent model, |ρ| = |sin(πh)/(πh)| = 0.4135 (h = 2/3), Eb/N0 in {4, 6, 8, 10} dB,
phase of ρ in {0, 2π/3}, 2·10⁶ bits per condition in total.

- Generator guard (E|ν₁|², E|ν₂|², E[ν₁ ν₂*] = ρ): passed for all 8 conditions.
- `marcumQ1` against numerical integration: worst difference 3.9·10⁻¹⁴ (tolerance 10⁻⁷).
- `marcumQ1 special values` and `ber formula reduces to 0.5*exp(-Eb/(2*N0)) at rho=0`: pass
  (library self-checks).
- All 24 simultaneous Wilson intervals (global BER, P(e|1), P(e|2); Bonferroni, global 99 %,
  z = 3.53) contain the formula value.
- **Verdict: compatible with the formula.** No replication was needed. This is not a definitive
  confirmation.

| Eb/N0 | Formula (curve 2) | Measured global BER (phase 0) |
|---|---|---|
| 4 dB | 1.692·10⁻¹ | 1.691·10⁻¹ |
| 6 dB | 9.420·10⁻² | 9.405·10⁻² |
| 8 dB | 3.931·10⁻² | 3.938·10⁻² |
| 10 dB | 1.078·10⁻² | 1.058·10⁻² |

### 3.6 E3b, Eb/N0 invariance of the BER (`Prototype result (E3b, 6797a2f, keys E3b|stage=1|...|seed=1..10)`)

Reference detector (known bit timing, central half-bit mean frequency, fixed threshold 1700 Hz,
filter c1 Hamming); 400,000 bits per condition. Equivalence margin ±10 % relative BER
(δ = ln 1.1), 97.5 % intervals.

| Eb/N0 | BER at 8 / 16 / 48 kHz | All three pairs |
|---|---|---|
| 6 dB | 8.46·10⁻², 8.50·10⁻², 8.56·10⁻² | equivalent at stage 1 |
| 9 dB | 1.65·10⁻², 1.63·10⁻², 1.64·10⁻² | equivalent at stage 1 |

- The BER does not depend on the sampling rate at fixed Eb/N0, within ±10 %. Stage 2 was not needed.
- The first-order planning prediction Qg(1.047 √γ_band) is optimistic: 5.7·10⁻² and 1.28·10⁻²
  predicted, against 8.5·10⁻² and 1.64·10⁻² measured.
- **Open question.** At 9 dB this discriminator detector (1.64·10⁻²) does better than curve 2 at the
  same Eb/N0, which interpolates to about 2·10⁻². The design note expected the discriminator to
  be worse than curve 2. Possible reasons: curve 2 describes single-bit correlators that ignore
  phase continuity, and this detector has known bit timing. This is a Hypothesis to examine in
  task 11 (curve 3) before the 3615 MATHS text is written.

---

## 4. Planning hypotheses still open

| Item | Statement | Status | Checked by |
|---|---|---|---|
| M6 target | BER ≤ 10⁻³ at Eb/N0 = 12 dB for each of 20 seeds of 20,000 bits may need a higher Eb/N0. | Hypothesis | Task 12 (decision U6) |
| M10 | M2M4 estimator within ±1 dB from 0 to 30 dB band SNR; the 30 dB end needs an envelope CV ≲ 2 %. | Hypothesis | E5 / task 10 |
| M7 | The adaptive mark estimate needs the central-half-bit mean (not the whole bit) to stay within ±20 Hz. | Hypothesis | E4 / task 8 |
| M4 | A start-bit inversion loses the frame; a stop-bit inversion gives `framingOk = false` and may lose the next frame. | Hypothesis (spec amended) | Characterization tests, J3-3 |

## 5. Hardware measurements

None yet. The first phone to laptop test is planned for J6.
