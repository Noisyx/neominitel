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

> **Status: Final (signed by both developers).** Experiment E3a has been executed (section 3.2) and
> is consistent with this convention. Property M8 and the noise tests from task 6 on use it as
> written here (section 2.4). Any change to sections 2.1 to 2.4 needs both signatures again.
>
> Signed, Role A: Role A, agreement given to Role B and recorded by Role B (date: 2026-11-25)
> Signed, Role B: Role B (date: 2026-11-25)

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

### 2.4 Use in the tests (decision T6-3)

- **Noise generator.** The test helper `awgn` (`tests/helpers/awgn-resample.ts`) realises D2:
  N0 = P / (B · γ) for a target SNR γ in a reference band B (or N0 = P / (R · Eb/N0) for a target
  Eb/N0), then σ² = N0 · fs / 2. The reference power is P = A² / 2 with A the `signalAmplitude`
  option, so silences and ramps do not change the noise level (D1).
- **SNR without a band means γ_3k.** The glossary of `requirements.md` measures noise in 3 kHz
  unless stated otherwise. "20 dB SNR" in requirement 6.6 and property M8 is therefore
  γ_3k = 20 dB, generated with `awgn({ snrDb: 20, bandwidthHz: 3000, signalAmplitude: A })`.
- **Conversion for M8** (R4, R5, with R = 1200 line bits per second): γ_3k = 20 dB gives
  σ² = A² fs / (12000 · 100) and Eb/N0 = 20 + 10 log10(3000 / 1200) = 23.98 dB. With A = 0.5 and
  fs = 48 kHz, σ² = 0.0100. (`Identity`)
- **Checked by a test** in `tests/properties/v23-modem.test.ts` ("A7 convention"): the σ² derived
  from R4 gives 23.9794 dB through R2; `awgn` with `snrDb: 20` and with `ebN0Db: 23.98` produce the
  same noise for the same seed (difference ≤ 10⁻⁶); the measured noise variance over 4·10⁵ samples
  is within 1 % of σ² (measured +0.47 %).

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
| M6 target | BER ≤ 10⁻³ at Eb/N0 = 12 dB for each of 20 seeds of 20,000 bits may need a higher Eb/N0. | Confirmed: not met at 12 dB (3.2·10⁻² with `BerCounter`: data-bit BER 2.2·10⁻³ plus 7-bit framing slips). Calibrated to 16.5 dB | `docs/calibration.md` "M6" |
| M10 | M2M4 estimator within ±1 dB from 0 to 30 dB band SNR; the 30 dB end needs an envelope CV ≲ 2 %. | Refuted for the plain estimator (clean FSK reads 22.8 dB); met with the kurtosis-corrected estimator (k_s = 1.0105) averaged over 1 s, task 10 | Task 10 (design.md "Quality") |
| M7 | The adaptive mark estimate needs the central-half-bit mean (not the whole bit) to stay within ±20 Hz. | Hypothesis | E4 / task 8 |
| M4 | A start-bit inversion loses the frame; a stop-bit inversion gives `framingOk = false` and may lose the next frame. | Hypothesis (spec amended) | Characterization tests, J3-3 |

## 5. Hardware measurements

None yet. The first phone to laptop test is planned for J6.

---

## 6. Theory curves (task 11, `src/modem/theory.ts`)

Notation of section 2.2: γ = Eb/N0 per line bit, linear. All three curves are plotted against the
same γ, so they can be compared directly with the live points of 3615 MATHS.

### 6.1 Curve 1, orthogonal non-coherent BFSK

Two orthogonal tones (|ρ| = 0), each received through a matched filter followed by an envelope
detector; the larger envelope wins. The textbook result is P_b = ½·exp(−γ/2)
(`berOrthogonalNoncoherent`). It is the reference that every non-coherent FSK receiver is compared
with. (`Identity`, standard result.)

### 6.2 Curve 2, non-coherent binary signals with correlation ρ

**Why V.23 is not orthogonal.** Over one bit of length T, the two tones f₁ and f₂ have the
normalised complex correlation ρ = (1/T)∫₀ᵀ e^{j2π(f₂−f₁)t} dt, so
|ρ| = |sin(πh)/(πh)| with h = (f₂ − f₁)·T. Forward channel: h = 800/1200 = 2/3, so
**|ρ| = (√3/2)/(2π/3) = 0.4135** (`FORWARD_RHO`, derived from `v23.ts`). (`Identity`)

**Formula.** For two equal-energy signals with correlation |ρ| and envelope detection:

P_b = Q₁(a, b) − ½·e^{−(a²+b²)/2}·I₀(ab),  a, b = √(γ/2 · (1 ∓ √(1 − |ρ|²)))

(standard result for non-orthogonal non-coherent binary signalling, still to be confirmed by the
mathematician as design.md asks; `Prototype result (E3c)` in section 3.5: compatible with a
two-symbol simulation at 4 to 10 dB.) Checks:

- |ρ| = 0: a = 0, b = √γ, Q₁(0, b) = e^{−b²/2} and I₀(0) = 1, so P_b = e^{−γ/2} − ½e^{−γ/2} =
  ½e^{−γ/2}, curve 1. (`Identity`)
- |ρ| = 1: a = b, and P_b = ½ (the signals are identical; the receiver guesses). (`Identity`)

**Numerical form used in the code (no cancellation).** The two terms of the formula are almost
equal when γ is large, so their difference loses digits. The Neumann series of the Marcum Q
function, Q₁(a, b) = e^{−(a²+b²)/2}·Σ_{k≥0} (a/b)^k I_k(ab) for 0 ≤ a < b, gives

P_b = e^{−(a²+b²)/2}·[½·I₀(ab) + Σ_{k≥1} (a/b)^k I_k(ab)]
  = e^{−(b−a)²/2} · [e^{−ab} I₀(ab)] · (½ + Σ_{k≥1} (a/b)^k I_k(ab)/I₀(ab)),

using (a² + b²)/2 = (b − a)²/2 + ab. Every term is positive. The ratios I_k/I₀ come from Miller's
backward recurrence I_{k−1}(x) = I_{k+1}(x) + (2k/x)·I_k(x), which is stable downwards; e^{−x}I₀(x)
from its power series for x ≤ 25 and from the asymptotic expansion
(2πx)^{−½}·Σ_k [(2k−1)!!]²/(k!·(8x)^k) above (the power series overflows near x ≈ 700, reached at
31.6 dB with |ρ| = 0.99; found by the slow M12 run). (`Identity`; the code is checked against Q₁(a, b) − ½e^{−(a²+b²)/2}I₀(ab)
within 10⁻⁷ relative wherever P_b ≥ 10⁻⁸, and Q₁ against numerical integration within 10⁻⁹.)

**Properties (property M12, checked numerically in the tests, not proven here).** Curves 1 and 2
decrease strictly in γ from −10 to 30 dB; curve 2 at ρ = 0 equals curve 1 (difference 0, the
series reduces exactly); curve 2 is above curve 1 and grows with |ρ|.

Values from the code (curves 1 and 2) and from `public/data/ber-curve3.json` (curve 3):

| Eb/N0 | Curve 1 | Curve 2 (\|ρ\| = 0.4135) | Curve 3 (95 % interval) |
|---|---|---|---|
| 2 dB | 2.26·10^-1 | 2.49·10^-1 | 6.81·10^-1 [6.78·10^-1, 6.85·10^-1] |
| 4 dB | 1.42·10^-1 | 1.69·10^-1 | 6.37·10^-1 [6.34·10^-1, 6.40·10^-1] |
| 6 dB | 6.83·10^-2 | 9.42·10^-2 | 5.49·10^-1 [5.46·10^-1, 5.52·10^-1] |
| 8 dB | 2.13·10^-2 | 3.93·10^-2 | 3.73·10^-1 [3.71·10^-1, 3.76·10^-1] |
| 10 dB | 3.37·10^-3 | 1.08·10^-2 | 1.58·10^-1 [1.56·10^-1, 1.60·10^-1] |
| 12 dB | 1.81·10^-4 | 1.56·10^-3 | 3.23·10^-2 [3.15·10^-2, 3.30·10^-2] |
| 14 dB | 1.76·10^-6 | 8.30·10^-5 | 3.20·10^-3 [2.97·10^-3, 3.44·10^-3] |
| 16 dB | 1.13·10^-9 | 8.97·10^-7 | 9.82·10^-5 [6.49·10^-5, 1.49·10^-4] |
| 18 dB | 9.95·10^-15 | 7.77·10^-10 | 0 [0, 1.72·10^-5] |

### 6.3 Curve 3, our receiver (Monte Carlo)

`scripts/montecarlo-ber.ts` runs the full chain of the app: PN9 frames → `modulate` (16 kHz) →
`applyChannel` with AWGN at γ (A7) → streaming demodulator (adaptive threshold, the app default)
→ `BerCounter`, the counter that 3615 MATHS uses, so live points and curve 3 measure the same
thing. Per Eb/N0 (0 to 18 dB, 1 dB steps): 10 seeds of at least 20 000 compared bits, errors and
bits pooled, 95 % Wilson interval. Output: `public/data/ber-curve3.json` (format of design.md
"Theory API"). The sampling rate does not change the BER at fixed γ (E3b, section 3.6).

Two cautions for the reader of the plot:

- **What is counted.** `BerCounter` counts data-bit errors *and* the 20 to 40 errors that follow a
  lost or misaligned frame before it resynchronises (design.md "Quality", M6 gap). Curve 3 is
  therefore above the receiver's raw bit error rate, by a factor 15 to 30 near 12 dB.
- **The intervals are optimistic.** The Wilson interval assumes independent bits. The errors of
  one framing slip come in a burst, so the true uncertainty is wider than the band shown.
  (`Hypothesis`, not quantified.)

Reading of the measured curve 3 (`public/data/ber-curve3.json`, 10 seeds per point, 16 kHz):

- **At 6 dB and below, curve 3 is above 0.5** (0.55 at 6 dB, 0.70 at 0 dB; regenerated after the
  task 12 initialisation gate, identical from 10 dB up). Most frames then have a framing
  error, the counter counts all 7 of their bits as errors, and it keeps losing its lock. Curve 3
  is the reading of the app's counter, not a bit error probability, in that region.
- **Price of the real receiver.** At 12 dB, curve 3 is 3.2·10⁻² against 1.6·10⁻³ for curve 2: the
  raw bit error rate (2.2·10⁻³, design.md "Quality") is close to curve 2, and the framing slips
  multiply the counted errors by about 15. Curve 3 reaches 10⁻³ near 14.7 dB, about 2.4 dB to the
  right of curve 2 (12.3 dB); both values are log-linear interpolations between 1 dB (curve 3)
  and 2 dB (curve 2) table points.
- The open question of section 3.6 (the reference detector beating curve 2 at 9 dB) concerns the
  raw bit error rate of a detector with known timing, so it is not answered by curve 3.

---

## 7. Vote formulas (review of `videotex/design.md` "Math notes", J9)

Reviewed by Role B against Role A's implementation (`src/ui/hud/voteMetrics.ts`). Status of each
formula, for N receptions of one cell, damaged independently from one reception to the next:

| Formula | Code | Verdict |
|---|---|---|
| Erasures only (every damage detected, probability p): the vote fails only if all N copies are erased, P_fail = pᴺ | `erasureVoteFailureFormula` | Correct (`Identity` under independence). Property V8 is its exact, deterministic form. |
| Undetected damage only (wrong value, probability q): plain majority fails when more than N/2 copies are wrong, P_fail = Σ_{k > N/2} C(N, k) qᵏ (1 − q)ᴺ⁻ᵏ | `majorityVoteFailureFormula` | Correct for odd N (1, 3, 5, 7 in 3615 MATHS). It is an upper bound: it counts any wrong majority as a failure, while the wrong copies must also agree on the same wrong value to win. (`Identity`; V9 is the exact form.) |
| Parity: one even-parity bit over 8 checked bits detects every odd number of bit errors and no even number; P(undetected) ≈ C(8, 2) ε² = 28 ε² for small bit error rate ε | `parityUndetectedApprox` | Correct to first order (`Identity`). The next term, C(8, 4) ε⁴ = 70 ε⁴, is negligible below ε = 10⁻². |

Worked values for the page: p = q = 0.1 and N = 5 give P_fail = 10⁻⁵ (erasures) and 8.6·10⁻³
(majority bound). Erasures are far cheaper to repair than undetected errors, which is why the
parity bit matters.

**Why the measurements sit above the formulas at low Eb/N0 (Hypothesis, see `docs/calibration.md`
"A4").** All three formulas assume that each cell is damaged independently, at a fixed position.
Below about 13 dB, misaligned frames shift the Videotex cursor, so damage spreads over many cells
and repeats differently in each reception; the measured cell error rate after the vote is then much
higher than pᴺ. From 14 dB the independence assumption is close to true and the vote behaves as the
formulas predict (A4: 3 % of damaged cells per reception, 0.01 % after 5 receptions).

Framing errors are counted as erasures too: the app flags a cell as damaged when parity or stop
bit is wrong (`src/workers/line-engine.ts`), which matches the erasure model.

---

## 8. Correlator receiver and curve 4 (task 15)

**What it is.** A second receiver, `createCorrelatorDemodulator` (`src/modem/correlator.ts`,
design.md "Correlator demodulator"). For each tone it correlates the raw input with e^{−j2πft}
over one bit (N = round(fs/1200) samples) and compares the energies:
d = |z_mark|² − |z_space|². This is the per-bit envelope detector that curve 2 describes. It has its
own frame timing: a start edge is the zero crossing of d, and each bit is read at its centre. It is
a test-bench receiver (no carrier detection, no threshold), not a replacement for the app's
demodulator.

**Curve 4** is its Monte Carlo curve: same chain, grid, seeds and counter as curve 3
(`npx tsx scripts/montecarlo-ber.ts --receiver correlator`, `public/data/ber-curve4.json`).

| Eb/N0 | Curve 2 | Curve 3 (discriminator) | Curve 4 (correlator) | Correlator, exact timing, raw bits |
|---|---|---|---|---|
| 8 dB | 3.9·10⁻² | 3.7·10⁻¹ | 2.5·10⁻¹ | |
| 10 dB | 1.1·10⁻² | 1.6·10⁻¹ | 7.8·10⁻² | 1.4·10⁻² |
| 12 dB | 1.6·10⁻³ | 3.2·10⁻² | 1.6·10⁻² | 3.4·10⁻³ |
| 14 dB | 8.3·10⁻⁵ | 3.2·10⁻³ | 1.8·10⁻³ | 4.7·10⁻⁴ |
| 15 dB | | 5.9·10⁻⁴ | 6.0·10⁻⁴ | |
| 16 dB | 9.0·10⁻⁷ | 9.8·10⁻⁵ | 1.8·10⁻⁴ | 6.7·10⁻⁵ (2 errors) |
| 17 dB | | 0 | 5.4·10⁻⁵ | |

The last column is a separate measurement (task 15 probe, 16 kHz, seed 1, 30 000 line bits): the
correlator with the exact bit boundaries of the modulator, raw bit errors, no counter.

Reading:

- **Below 15 dB the correlator wins** (half the counted BER from 8 to 12 dB). The counted BER is
  dominated by framing slips there (section 6.3), and the correlator loses fewer frames than the
  discriminator's UART. At 10⁻³ the gain is small: 14.5 dB against 14.7 dB (log-linear
  interpolation between 1 dB points).
- **From 16 dB the discriminator wins** and reaches 0 counted errors at 17 dB, where the correlator
  still makes isolated bit errors. Its timing comes from one noisy zero crossing per frame, and the
  crossing is biased by the tone phases. Measured spread of the edge against the frame grid, 1st to
  99th percentile over 2 000 frames: about −0.1 T to +0.125 T on a clean signal (8, 16 and
  48 kHz), −0.2 T to +0.28 T at 16 dB. Two better-looking timing schemes were tried and were worse at every Eb/N0 (design.md
  "Correlator demodulator").
- **Even with exact timing, the correlator stays above curve 2** (1.4·10⁻² against 1.1·10⁻² at
  10 dB, 4.7·10⁻⁴ against 8.3·10⁻⁵ at 14 dB). Hypothesis, two causes: (1) the line signal is
  continuous-phase FSK, and a one-bit detector ignores the phase memory from bit to bit, which the
  discriminator partly uses (its phase difference spans bit boundaries); (2) the signal is real, so
  each correlator also sees the image terms at f_mark + f and f_space + f (relative size
  |sinc(2fT)| ≈ 0.07 and |sinc((f_m + f_s)T)| ≈ 0.06), which curve 2 (complex baseband) does not
  include. Not yet separated by measurement.

**For the 3615 MATHS chart** (Role A, display): curve 4 has the same format and the same Eb/N0 grid
as curve 3, so it can be drawn as a second band next to curve 3. Suggested caption: « Corrélateurs :
meilleurs sous 15 dB, moins bons au-dessus ».

---

## 9. Image to mosaic (videotex task 9)

**Problem.** A mosaic cell is 2 × 3 blocks and can show only two colours, the foreground and the
background, chosen among the 8 of the palette. Given the six block colours x₁…x₆ of an image
(after resampling), choose (fg, bg) and the on/off pattern that minimise the squared error
E = Σₖ min(‖xₖ − c_fg‖², ‖xₖ − c_bg‖²).

**Exact solution by enumeration (`Identity`).** For a fixed pair, the best pattern is to give each
block its nearer colour, independently: the error is a sum of terms that each depend on one block.
So the optimum over all patterns is the minimum over the 8 single colours and C(8, 2) = 28 pairs:
36 candidates × 6 blocks × 2 distances per cell, about 430 distance evaluations, 400 000 for a full
40 × 24 page. No heuristic is needed; property V12 checks the optimum against a brute force.

**Limits (`Hypothesis`, not measured).** The distance is squared RGB, not a perceptual distance, and
the default palette is the one the app draws (`COLOUR_PALETTE_RGB`), not a measured Minitel CRT. On a
black-and-white Minitel 1 the same code can be run with `MONOCHROME_PALETTE_RGB` as the palette.

**Error diffusion.** Without diffusion, a flat area halfway between two palette colours becomes one
flat colour. Floyd–Steinberg diffusion carries each block's residual to the blocks of cells not yet
decided (7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right, renormalised over the targets that
remain), so the average colour of an area is kept. Measured on a flat grey 128 with a black and
white palette: 100 % white blocks without diffusion; with it, 53.1 % on 8 × 4 cells and 50.5 % on a
full 40 × 24 page, for 128/245 ≈ 52 % expected (the test accepts 35 % to 65 %).
