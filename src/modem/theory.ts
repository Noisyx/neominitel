// Theoretical BER curves (requirement 10.4, design.md "Theory API" and "Math notes"; derivations in
// docs/math.md section 6). Pure. Eb/N0 is per line bit (docs/math.md section 2.2).
import { CHANNELS } from './v23';

const fwd = CHANNELS.forward;
/** Modulation index of the forward channel: h = (spaceHz - markHz) / baud = 2/3. */
export const FORWARD_H = (fwd.spaceHz - fwd.markHz) / fwd.baud;
/** |rho| = |sin(pi h) / (pi h)| of the two forward tones over one bit (0.4135). */
export const FORWARD_RHO = Math.abs(Math.sin(Math.PI * FORWARD_H) / (Math.PI * FORWARD_H));

const dbToLinear = (db: number): number => Math.pow(10, db / 10);

/** Curve 1, orthogonal non-coherent BFSK: P_b = 1/2 exp(-Eb / 2 N0). */
export function berOrthogonalNoncoherent(ebN0Db: number): number {
  if (Number.isNaN(ebN0Db)) return NaN;
  return 0.5 * Math.exp(-dbToLinear(ebN0Db) / 2);
}

/** Above this x, e^-x I0(x) uses the asymptotic expansion (the power series would overflow). */
const I0_ASYMPTOTIC_X = 25;

/**
 * e^-x I0(x) for x >= 0. Power series (all terms positive) below I0_ASYMPTOTIC_X; above it, the
 * asymptotic expansion e^-x I0(x) = (2 pi x)^-1/2 sum_k [(2k - 1)!!]^2 / (k! (8x)^k), summed while
 * its terms decrease (they do up to k ~ 2x; at x = 25 the smallest term is far below 1e-17).
 */
function i0Scaled(x: number): number {
  if (x > I0_ASYMPTOTIC_X) {
    let term = 1;
    let sum = 1;
    for (let k = 1; k < 200; k++) {
      const next = (term * (2 * k - 1) * (2 * k - 1)) / (8 * k * x);
      if (next >= term || next < sum * 1e-17) break;
      term = next;
      sum += term;
    }
    return sum / Math.sqrt(2 * Math.PI * x);
  }
  const y = (x * x) / 4;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 2000; k++) {
    term *= y / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum * Math.exp(-x);
}

/**
 * S(t, x) = sum_{k >= 1} t^k I_k(x) / I0(x) for 0 <= t <= 1, x > 0, with the ratios I_k / I0
 * from Miller's backward recurrence I_{k-1} = I_{k+1} + (2k / x) I_k (stable downwards).
 */
function besselRatioSeries(t: number, x: number): number {
  const n = Math.ceil(x + 40 + 12 * Math.sqrt(x));
  let ip1 = 0; // I_{k+1}, arbitrary scale
  let ik = 1e-300; // I_k
  let weighted = 0; // sum_{k >= 1} t^k I_k, same scale
  const tPow: number[] = new Array(n + 1);
  tPow[0] = 1;
  for (let k = 1; k <= n; k++) tPow[k] = tPow[k - 1] * t;
  for (let k = n; k >= 1; k--) {
    weighted += tPow[k] * ik;
    const im1 = ip1 + ((2 * k) / x) * ik;
    ip1 = ik;
    ik = im1;
    if (ik > 1e250) {
      // Rescale to stay in range; only ratios matter.
      ip1 *= 1e-250;
      ik *= 1e-250;
      weighted *= 1e-250;
    }
  }
  return weighted / ik; // ik is now I_0 on the same scale
}

/**
 * Curve 2, non-coherent binary signals with correlation |rho| (envelope detection):
 *   P_b = Q1(a, b) - 1/2 exp(-(a^2 + b^2) / 2) I0(a b),
 *   a, b = sqrt(Eb/2N0 (1 -+ sqrt(1 - |rho|^2))).
 * Evaluated without cancellation through Q1(a, b) = e^{-(a^2+b^2)/2} sum_{k >= 0} (a/b)^k I_k(ab):
 *   P_b = e^{-(b-a)^2/2} [e^{-ab} I0(ab)] (1/2 + sum_{k >= 1} (a/b)^k I_k(ab) / I0(ab)).
 * rho = 0 gives curve 1 exactly. NaN for a NaN argument or |rho| > 1.
 */
export function berNoncoherentCorrelated(ebN0Db: number, rho: number): number {
  const r = Math.abs(rho);
  if (Number.isNaN(ebN0Db) || !(r <= 1)) return NaN;
  const g = dbToLinear(ebN0Db);
  if (g === 0) return 0.5;
  if (!Number.isFinite(g)) return r === 1 ? 0.5 : 0;
  const s = Math.sqrt(1 - r * r);
  const a = Math.sqrt((g / 2) * (1 - s));
  const b = Math.sqrt((g / 2) * (1 + s));
  const x = a * b;
  const lead = Math.exp(-((b - a) * (b - a)) / 2);
  if (x === 0) return 0.5 * lead;
  return lead * i0Scaled(x) * (0.5 + besselRatioSeries(a / b, x));
}

/**
 * Marcum Q function of order 1, Q1(a, b) = int_b^inf x exp(-(x^2 + a^2)/2) I0(a x) dx, as a
 * Poisson mixture of Gamma tails (all terms positive; the form validated by prototype E3c).
 * NaN for negative or NaN arguments.
 */
export function marcumQ1(a: number, b: number): number {
  if (!(a >= 0) || !(b >= 0)) return NaN;
  const lam = (a * a) / 2;
  const x = (b * b) / 2;
  const kMax = Math.ceil(lam + 40 * Math.sqrt(lam) + 60);
  let pois = Math.exp(-lam);
  let gamTerm = Math.exp(-x);
  let gamTail = gamTerm;
  let sum = pois * gamTail;
  for (let k = 1; k <= kMax; k++) {
    pois *= lam / k;
    gamTerm *= x / k;
    gamTail += gamTerm;
    sum += pois * Math.min(1, gamTail);
  }
  return Math.min(1, sum);
}
