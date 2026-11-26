# Modem calibration

Measured thresholds of the `v23-modem` properties (tech.md: a numeric threshold changes only through a
calibration, with its reason recorded here). All figures are simulations (line simulator of task 9,
A7 noise convention of `docs/math.md` section 2), never hardware measurements. Reproduce with
`npx tsx scripts/calibrate-modem.ts` (deterministic, fixed seeds). `CAL_SECTIONS=connection,snr,ber,m6`
selects the sections; M6 takes about 40 minutes, the other sections a few minutes. Task 12 ran every
section on commit `d228387` plus the task 12 changes; M6 was run in task 11 and re-checked by the
slow M6 test after the task 12 change.

## Connection sequence (requirement 3.2)

**Defaults kept:** answer tone 700 ms, silence 150 ms, mark carrier 300 ms (`CONNECTION_DEFAULTS` in
`src/modem/modulator.ts`, also used by Role A's line engine).

**Reference recording: not available.** Requirement 3.2 asks for the defaults to be checked against a
reference recording. The project has no license-checked V.23 recording yet (`docs/licenses.md`: none
bundled; `tests/fixtures/` is empty). This part of requirement 3.2 stays open and moves to task 16
(interoperability), which adds the first license-checked recording. What follows checks the defaults
against the receiver only.

**Normative context, not checked in this session.** ITU-T V.25 specifies the 2100 Hz answer tone
(2.6 to 4.0 s) and a short silence of about 75 ms before the data carrier
([ITU-T V.25](https://www.itu.int/rec/T-REC-V.25)). These values are quoted from memory; the PDF could
not be read here. The NeoMinitel defaults are shorter on purpose (the demo plays the whole sequence,
product.md), so they are a documented simplification, not V.25 values.

**Measured against the receiver** (`CAL_SECTIONS=connection`; 8 standard rates; noise γ_3k = 20 dB
over the whole line, silence included):

| Check | Result | Default | Margin |
|---|---|---|---|
| Sequence + page, clean, both modes | page decoded, 1 `connect`, at every rate | | |
| Sequence + page, 20 dB noise, both modes, 5 seeds | 40/40 per mode (page is the exact end of the characters) | | |
| Shortest answer tone giving `connect` | 493 ms | 700 ms | 207 ms |
| Shortest silence for which the page decodes (clean, and 20 dB) | 0 ms | 150 ms | the silence only has to exist |
| Shortest mark carrier giving `carrier` on after the silence | 20 ms | 300 ms | 280 ms |

- **`connect` at 493 ms.** The detector needs 25 consecutive 20 ms blocks with at least half their
  power at 2100 Hz. A tone ending inside the 25th block still fills more than half of it, so tones
  from 493 ms give `connect` (450 ms gives none, task 7 test). Requirement 3.3 ("at least 500 ms
  gives `connect`") holds.
- **Noise characters.** With noise, the carrier stays on in the silence (noise at γ_3k = 20 dB reads
  about −28 dBFS, above −45 dBFS), so noise frames are decoded before the page: about 65 per run in
  fixed mode, 2 to 5 in adaptive mode (the UART waits for the steady-window initialisation below).

### Adaptive initialisation (defect found by this calibration, fixed)

With the 20 dB line, the first version of this check failed in adaptive mode at every rate. The
carrier went on with the noise at 20 ms, the 20 ms initialisation window averaged noise, and μ_mark
was learnt at 1 713 to 1 993 Hz (probe at 8 and 48 kHz, seeds 1 and 2). The threshold then sat
above both tones and the page was not decoded (4 of 4 cases; the fixed mode decoded it).

Fix (design.md "Threshold", steady-window gate): a 20 ms window initialises μ_mark only if the
standard deviation of its estimates is ≤ 500 Hz and its mean is within 500 Hz of 1300 Hz; otherwise
the next window is tried, for up to 1 s after carrier on, then the UART runs on the nominal threshold.

Statistics of 20 ms windows of discriminator estimates (5 seeds of 2 s per case; a mark tone of
amplitude 0.5, noise at the matching level):

| Window content | 8 kHz | 16 kHz | 48 kHz |
|---|---|---|---|
| mark, Eb/N0 8 dB: std median / max | 360 / 623 Hz | 391 / 737 Hz | 389 / 757 Hz |
| mark, Eb/N0 10 dB: std median / max | 256 / 476 Hz | 265 / 658 Hz | 268 / 570 Hz |
| mark, Eb/N0 12 dB: std median / max | 192 / 430 Hz | 197 / 401 Hz | 199 / 420 Hz |
| mark, Eb/N0 20 dB: std max; \|mean − 1300\| max | 95 Hz; 3 Hz | 107 Hz; 4 Hz | 103 Hz; 4 Hz |
| noise alone: std min | 633 Hz | 670 Hz | 664 Hz |
| answer tone: mean, std | 2100 Hz, 0.8 Hz | 2100 Hz, 0.7 Hz | 2100 Hz, 0.6 Hz |

500 Hz separates a mark carrier from noise from Eb/N0 12 dB (where decoding starts to work, curve 3)
and rejects the answer tone by its mean. After the fix, the same check passes 40/40 in both modes,
and the golden digests, M5 and M7 are unchanged.

## SNR estimator bias (requirement 9.3)

`CAL_SECTIONS=snr`: mean of the `quality` band SNR (estimates with 1 s of moments) minus the true band
SNR, PN9 traffic of 300 frames, 10 seeds. Target ±1 dB.

| fs | 0 dB | 5 dB | 10 dB | 15 dB | 20 dB | 25 dB | 30 dB |
|---|---|---|---|---|---|---|---|
| 8 000 | −0.04 | −0.03 | −0.04 | −0.05 | −0.09 | −0.20 | −0.54 |
| 16 000 | −0.29 | −0.16 | −0.12 | −0.09 | −0.06 | −0.01 | +0.13 |
| 44 100 | +0.03 | −0.01 | −0.02 | −0.02 | +0.00 | +0.06 | +0.23 |
| 48 000 | −0.11 | −0.06 | −0.06 | −0.06 | −0.06 | −0.05 | +0.01 |

Worst bias 0.54 dB (8 kHz, 30 dB): requirement 9.3 holds with 0.46 dB of margin. The bias depends on the
traffic through the envelope kurtosis (design.md "Quality"); this table is for PN9 traffic.

## BER against Eb/N0, both threshold modes

`CAL_SECTIONS=ber`: 16 kHz, 5 seeds of at least 20 000 compared bits, errors pooled, `BerCounter`
(framing slips included, like curve 3 and 3615 MATHS).

| Eb/N0 (dB) | adaptive | fixed |
|---|---|---|
| 8 | 3.66·10⁻¹ | 3.60·10⁻¹ |
| 9 | 2.62·10⁻¹ | 2.56·10⁻¹ |
| 10 | 1.60·10⁻¹ | 1.50·10⁻¹ |
| 11 | 8.19·10⁻² | 7.89·10⁻² |
| 12 | 3.52·10⁻² | 3.56·10⁻² |
| 13 | 1.10·10⁻² | 1.17·10⁻² |
| 14 | 3.55·10⁻³ | 3.75·10⁻³ |
| 15 | 5.98·10⁻⁴ | 7.77·10⁻⁴ |
| 16 | 8.9·10⁻⁶ | 0 |
| 17 | 0 | 0 |
| 18 | 0 | 0 |

Without an offset, both modes are equivalent within the spread of 5 seeds (the adaptive mode is
slightly worse below 11 dB, where some decision-directed updates use wrong decisions). The adaptive
mode is the default because it also tracks offsets (M7). Curve 3 was regenerated after the task 12
change: identical from 10 dB up, within 0.2 % at 8 and 9 dB; below that the UART often starts only
after the 1 s timeout, so fewer bits are compared (66 465 instead of 80 645 at 0 dB) and the counter
reads 0.70 instead of 0.68 at 0 dB.

## Performance (task 13, requirements 13.1 and 13.2)

`npx tsx scripts/bench-modem.ts` (exit code 1 if a budget is missed). Developer machine: Intel Core
i5-8350U laptop, Windows, Node v24.20.0, one thread. This is not the spec's "mid-range laptop" and
its timings are noisy (`docs/math.md` 3.4: up to a factor 3 between runs at 96 kHz), so two complete
runs are reported. Signal: 60 s of PN9 traffic with noise at γ_3k = 20 dB, default (adaptive)
demodulator, pushed in 100 ms chunks (the line engine's block) and in 128-sample chunks (one
AudioWorklet quantum). "+ Videotex" adds Role A's decoder (`createVideotexDecoder`) on every
character, which is the receive pipeline of tech.md. Median of 5 runs after a warm-up.

ms of CPU per second of audio (run 1 / run 2; run 1 was stopped before its last row and the
modulator line):

| fs | chunk | demodulator | x real time | demodulator + Videotex | budget |
|---|---|---|---|---|---|
| 48 000 | 4 800 | 26.9 / 31.9 | 37 / 31 | 27.2 / 30.3 | 60 (demod), 100 (pipeline): **pass** |
| 48 000 | 128 | 28.1 / 29.9 | 36 / 33 | 33.0 / 29.8 | **pass** |
| 44 100 | 4 410 | 39.7 / 47.0 | 25 / 21 | 36.3 / 39.9 | (no budget) |
| 44 100 | 128 | 38.3 / 52.2 | 26 / 19 | 39.8 / 41.5 | (no budget) |
| 96 000 | 9 600 | 46.0 / 42.4 | 22 / 24 | 55.0 / 42.0 | (no budget) |
| 96 000 | 128 | — / 52.9 | — / 19 | — / 56.3 | (no budget) |

- **Requirement 13.1 met.** At 48 kHz the demodulator needs at most 31.9 ms per second of audio:
  60 s in about 1.9 s (budget 3.6 s), 31 to 37 times real time. With Videotex decoding, at most
  33.0 ms per second (tech.md budget 100 ms). The FIR did not need profiling (tasks.md).
- **Requirement 13.2 met.** The modulator renders 1 000 characters (8.48 s of audio at 48 kHz) in
  24.5 ms (median of 20, run 2; budget 50 ms).
- 44.1 kHz costs more than 48 kHz, as in E7: D = 2 instead of 3 gives more filter outputs per second.
  96 kHz (D = 6) stays under 60 ms per second here, but it is outside the budget and at most 19
  times real time; E7 measured up to 105 ms per second at 96 kHz on the same machine, so it should be
  re-measured on the target devices (phones) before relying on it.
- The 128-sample chunks cost little more than 100 ms chunks: the per-call overhead of `push` is small
  next to the FIR.
- Videotex decoding is not measurable above the run-to-run noise at 48 kHz (pipeline minus
  demodulator: −1.6 to +4.9 ms per second).

## M6: BER under noise

**Property (design.md):** at Eb/N0 ≥ X dB, the BER on 20 000 PN9 bits is ≤ 10⁻³ for 20 seeds.
Design target before calibration: X = 12 dB, marked "target, to calibrate" (decision U6).

**Chain measured.** PN9 frames → `modulate` → `applyChannel` (AWGN at Eb/N0 per line bit) →
streaming demodulator → `BerCounter`, exactly as specified (design.md "PN9 and BER"). The counter
counts the 7 bits of a framing-error frame as errors and needs more than 20 errors among 100 bits to
resynchronise, so one lost or misaligned frame costs about 21 errors: **9.4·10⁻⁴ on 22 400 bits**. On
20 000 bits, BER ≤ 10⁻³ therefore means "no more than one framing slip".

**Why 12 dB cannot be met** (task 10, design.md "Quality", M6 gap): at 12 dB the receiver's raw bit
error rate is already 2.2·10⁻³, and 3.9 % of the frames are lost or misaligned, so the counter reads
3.2·10⁻² (16 kHz, 20 seeds). No change of the receiver is made here: the fixed-threshold path must
stay identical to task 7 (golden digests), and the counting rule is the one the app shows in
3615 MATHS.

### Sweep (16 kHz, adaptive threshold, seeds 1 to 20, 3 200 frames per seed)

| Eb/N0 (dB) | mean BER | worst BER | seeds > 10⁻³ | min compared bits |
|---|---|---|---|---|
| 12.0 | 3.22·10⁻² | 4.25·10⁻² | 20/20 | 21 571 |
| 12.5 | 2.06·10⁻² | 2.60·10⁻² | 20/20 | 21 854 |
| 13.0 | 1.12·10⁻² | 1.54·10⁻² | 20/20 | 22 110 |
| 13.5 | 6.11·10⁻³ | 1.15·10⁻² | 20/20 | 22 181 |
| 14.0 | 2.98·10⁻³ | 6.64·10⁻³ | 19/20 | 22 286 |
| 14.5 | 1.45·10⁻³ | 4.89·10⁻³ | 10/20 | 22 306 |
| 15.0 | 6.73·10⁻⁴ | 1.97·10⁻³ | 3/20 | 22 366 |
| 15.5 | 2.84·10⁻⁴ | 9.38·10⁻⁴ | 0/20 | 22 378 |
| 16.0 | 1.43·10⁻⁴ | 9.38·10⁻⁴ | 0/20 | 22 378 |
| 16.5 | 4.69·10⁻⁵ | 9.38·10⁻⁴ | 0/20 | 22 378 |
| 17.0 | 0 | 0 | 0/20 | 22 398 |

15.5 dB passes the 20 seeds of the property, but only just: the worst seed has exactly one slip.

### Robustness (seeds 1 to 40; 8, 16 and 48 kHz; both threshold modes)

A threshold that holds only for the 20 seeds of the test would be tuned to them. The calibrated
value is the first level of the 0.5 dB grid at which all 6 configurations pass on 40 seeds.

| Eb/N0 (dB) | fs | mode | mean BER | worst BER | seeds > 10⁻³ |
|---|---|---|---|---|---|
| 15.5 | 8 000 | adaptive | 2.84·10⁻⁴ | 1.88·10⁻³ | 2/40 |
| 15.5 | 8 000 | fixed | 2.86·10⁻⁴ | 1.88·10⁻³ | 1/40 |
| 15.5 | 16 000 | adaptive | 3.30·10⁻⁴ | 1.88·10⁻³ | 3/40 |
| 15.5 | 16 000 | fixed | 3.31·10⁻⁴ | 2.82·10⁻³ | 3/40 |
| 15.5 | 48 000 | adaptive | 2.40·10⁻⁴ | 1.88·10⁻³ | 1/40 |
| 15.5 | 48 000 | fixed | 1.91·10⁻⁴ | 9.39·10⁻⁴ | 0/40 |
| 16.0 | 8 000 | adaptive | 1.65·10⁻⁴ | 1.88·10⁻³ | 1/40 |
| 16.0 | 8 000 | fixed | 1.43·10⁻⁴ | 9.39·10⁻⁴ | 0/40 |
| 16.0 | 16 000 | adaptive | 1.65·10⁻⁴ | 1.88·10⁻³ | 1/40 |
| 16.0 | 16 000 | fixed | 1.17·10⁻⁴ | 9.39·10⁻⁴ | 0/40 |
| 16.0 | 48 000 | adaptive | 4.69·10⁻⁵ | 9.39·10⁻⁴ | 0/40 |
| 16.0 | 48 000 | fixed | 4.69·10⁻⁵ | 9.39·10⁻⁴ | 0/40 |
| **16.5** | 8 000 | adaptive | 0 | 0 | 0/40 |
| **16.5** | 8 000 | fixed | 0 | 0 | 0/40 |
| **16.5** | 16 000 | adaptive | 2.35·10⁻⁵ | 9.38·10⁻⁴ | 0/40 |
| **16.5** | 16 000 | fixed | 2.35·10⁻⁵ | 9.38·10⁻⁴ | 0/40 |
| **16.5** | 48 000 | adaptive | 2.35·10⁻⁵ | 9.38·10⁻⁴ | 0/40 |
| **16.5** | 48 000 | fixed | 0 | 0 | 0/40 |
| 17.0 | all six | both | 0 | 0 | 0/40 each |

(The 17 dB line was measured with `M6_FROM_DB=17`, run in parallel; same code and seeds.)

### Decision

**M6 is calibrated to Eb/N0 = 16.5 dB** (`M6_EBN0_DB` in `tests/properties/v23-modem.test.ts`;
design.md property table). It is the first level of the grid at which every configuration passes
on 40 seeds; 17 dB gives no error at all, so the test has 0.5 dB of margin to the error-free level.

- **Cost against the design target: 4.5 dB.** About 2.4 dB of it is the receiver itself (curve 3
  against curve 2 at 10⁻³, `docs/math.md` 6.3); the rest is the "at most one framing slip in
  20 000 bits" condition that the specified counter imposes.
- **Not changed:** the receiver, the counting rule, the 10⁻³ target, the 20 000 bits and the
  20 seeds. A slip-tolerant counter (resynchronising at once on a 7-bit shift) or a better framing
  recovery could bring M6 closer to 12 dB; both change behaviour the app shows and need a spec
  decision first.
- 3615 MATHS should present 10⁻³ near 15 dB (curve 3), not 12 dB.

## A4: noisy loopback with majority vote (Role A property, recorded here per tech.md)

**Property (`neominitel-app/design.md`, table A4):** at Eb/N0 = X dB and 5 repetitions, the voted
screen matches the reference on ≥ 99 % of cells, for 10 seeds. Design target before calibration:
X = 8 dB.

**Measured by Role A** (neominitel-app task 10.2; method and table in `neominitel-app/design.md`,
"Vote"). Page `sommaire/accueil`; chain `modulate` → `createChannel` (AWGN at Eb/N0) →
`StreamingDemodulator` → `VideotexDecoder` → `IncrementalVote`; seeds `0x3615_0001` to
`0x3615_0014`. CER = cell error rate.

| Eb/N0 (dB) | fs (Hz) | seeds with CER ≤ 1 % | mean CER, 1 reception | mean CER, 5-vote | worst CER, 5-vote |
|---|---|---|---|---|---|
| 8.0 | 16 000 | 0/20 | 84.92 % | 79.60 % | 79.60 % |
| 12.0 | 16 000 | 0/20 | 26.76 % | 12.50 % | 24.10 % |
| 13.0 | 16 000 | 14/20 | 11.02 % | 0.83 % | 2.70 % |
| 13.5 | 8 000 | 19/20 | 5.61 % | 0.09 % | 1.20 % |
| 13.5 | 16 000 | 20/20 | 5.99 % | 0.09 % | 0.80 % |
| 13.5 | 48 000 | 9/10 | 5.15 % | 0.15 % | 1.10 % |
| **14.0** | 8 000 | **20/20** | 2.90 % | 0.01 % | 0.10 % |
| **14.0** | 16 000 | **20/20** | 3.39 % | 0.01 % | 0.20 % |
| **14.0** | 48 000 | **10/10** | 2.65 % | 0.00 % | 0.00 % |

**Decision: A4 is calibrated to Eb/N0 = 14.0 dB**, the first 0.5 dB level at which every sample
rate passes. Role B agrees with the value.

**Why 8 dB cannot be met: the same receiver limit as M6.**
- At 8 dB the receiver itself is far from error-free: curve 3 reads 0.37 (`public/data/ber-curve3.json`)
  and about 16 % of the frames are lost or misaligned already at 10 dB (section "M6", task 10
  measurement in `v23-modem/design.md` "Quality"). Each character then has a large chance of being
  wrong, in every reception.
- **Why the vote cannot repair it (Hypothesis, not measured here):** when the UART misses a start
  bit, it can lock onto a later edge and decode misaligned characters with valid parity and stop
  bit (characterization test "inverting the start bit loses that frame", task 6). A misaligned
  character that lands on a Videotex control code (cursor move, row change) shifts the rest of the
  page, so the errors are not confined to one cell and differ from one reception to the next. A
  cell-by-cell vote cannot repair a shifted page. This matches Role A's observation (79.6 % CER
  after 5 votes at 8 dB, against 84.9 % for one reception).
- From 13 dB the receptions are mostly aligned, and the vote works as designed: 5 votes bring the
  CER from about 3 % to ≤ 0.2 % at 14 dB.

**What could lower A4 (not done, needs a spec decision):** a stricter UART resynchronisation that
drops doubtful frames (marked as errors, so the vote and the decoder skip them) instead of decoding
them misaligned. It changes the modem output and the M4 characterisation tests, so it would be a
new modem task, measured against both M6 and A4.

For the demo, the noise slider of 3615 MATHS and the vote demonstration should stay at or above
14 dB for a page that the vote repairs, and around 12 dB to show damage the vote only partly repairs.

---

## FANTOME levels: simulated acoustic margin (fantome task 5, pre-calibration)

**Status: pre-calibration only.** Task 5 asks for acoustic tests with two devices; those are not
done, and the task stays open. This section measures, in simulation, how much an acoustic path
can change the outcome of each committed level, and recommends values for the two-device test.

**Method.** `npx tsx prototypes/fantome-acoustic-margin.ts` and
`npx tsx prototypes/fantome-ebn0-sweep.ts` (deterministic). Each WAV goes through an "acoustic
path" and then through the generator's own check, `verifyLevelWav` (the app pipeline): feature on
→ code row CER = 0 (plus ≥ 3 error cells for L2, ≥ 4 grouped receptions for L4), feature off →
code row CER ≥ 50 % (L3, L4). Acoustic path: extra AWGN at γ_3k relative to the tone of the WAV
(tone amplitude estimated from the first 50 ms, which includes the WAV's own noise: the extra
noise is at most 0.7 dB stronger than stated), optionally a clock mismatch (`clockPpm`) or one or
two room reflections. 3 seeds per condition (margin script), 5 generation seeds × 5 perturbations
(sweep).

**Committed levels (`levels.json` as of this commit).**

| Level | Extra noise 40 dB | 30 dB | 25 dB | 20 dB | 15 dB | clock ±1000 ppm (+30 dB) | echo −10 dB @7 ms, −16 dB @19 ms (+30 dB) | echo −6 dB @5 ms (+30 dB) |
|---|---|---|---|---|---|---|---|---|
| L1 clean | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3, 3/3 | 3/3 | 3/3 |
| L2 noise 12.5 dB | 3/3 | 2/3 | 2/3 | 1/3 | 0/3 | 3/3, 0/3 | 0/3 | 0/3 |
| L3 offset +380 Hz, 18 dB | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3, 3/3 | 3/3 | 0/3 |
| L4 whisper 11.5 dB, 7 repeats | 3/3 | 1/3 | 0/3 | 0/3 | 0/3 | 1/3, 2/3 | 0/3 | 0/3 |

(Solved seeds with the feature on. L3 and L4 stayed at 100 % code-row CER with the feature off
whenever measured.)

**Reading.** Extra noise at 30 dB lowers the Eb/N0 of L2 and L4 by about 0.02 dB, yet it breaks
them on 1 or 2 seeds out of 3. The cause is not the level of the noise but its realisation: the
generator tries seeds until the checks pass for **that** noise, and L2 and L4 sit at the edge, so
any new noise (every acoustic playback) redraws the outcome. L1 and L3 have a wide margin; only a
strong early reflection (−6 dB at 5 ms) breaks L3.

**Sweep of L2 and L4 (5 generation seeds; the accepted WAVs each replayed through extra noise
30 dB × 3, clock −1000 ppm and an echo −16 dB at 7 ms).**

| Level | Eb/N0 | WAVs the generator accepts | Solved after perturbation | Error cells on the page | Feature off, code-row CER (min) |
|---|---|---|---|---|---|
| L2 | 12.5 dB (current) | 3/5 | 8/15 | 15-22 | – |
| L2 | **13.5 dB** | 4/5 | 17/20 (18/20 with the code row intact; one failure is "2 error cells") | 3-10 | – |
| L2 | 14.5 dB | 2/5 | 9/10 | 4-5 | – |
| L2 | 15.5 dB, 16.5 dB | 0/5 | – (too few error cells) | 0-2 | – |
| L4 | 11.5 dB (current) | 1/5 | 1/5 | – | 100 % |
| L4 | 12.5 dB | 2/5 | 6/10 | – | 90 % |
| L4 | 13.5 dB | 1/5 | 5/5 | – | 0 % (fails requirement 4.4) |
| L4 | 14.5 dB | 0/5 | – | – | 0 % |

**Recommendations (not applied; to confirm with the two-device test).**
- **L2: 13.5 dB.** The code row survives the perturbations in 90 % of the trials instead of 53 %,
  and the page still shows 3 to 10 hatched cells. Above 14.5 dB the parity errors become too rare
  to be seen.
- **L4: no Eb/N0 works with uniform noise.** The window between "a single pass fails" (≤ 12.5 dB)
  and "the vote succeeds robustly" (≥ 13.5 dB) is closed: at 13.5 dB a single pass already reads
  the code. A design change is needed (fantome design, with Role A), for example noise bursts
  (`bursts` of the line simulator) instead of AWGN, so that each pass is damaged at different
  places and the vote has erasures to repair, or more repetitions. To be measured with the same
  sweep before the change.
- **Two-device test protocol.** Phone (speaker) 20 to 30 cm from the laptop (microphone), quiet
  room, volume at about two thirds, Écoute mode. For each level: 5 plays, record whether the code
  can be read with the feature on and not with it off, and the SNR shown in the HUD. Record the
  results here, next to this table.
