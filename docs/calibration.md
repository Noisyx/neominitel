# Modem calibration

Measured thresholds of the `v23-modem` properties (tech.md: a numeric threshold changes only through a
calibration, with its reason recorded here). All figures are simulations (line simulator of task 9,
A7 noise convention of `docs/math.md` section 2), never hardware measurements. Reproduce with
`npx tsx scripts/calibrate-modem.ts` (deterministic, fixed seeds).

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
