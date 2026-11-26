import {
  cellErrorRate,
  cellsEqual,
  SCREEN_COLS,
  SCREEN_ROWS,
  vote,
  type Screen,
} from '../../videotex';

export const VOTE_CHECKPOINT_RECEPTIONS = [1, 3, 5, 7] as const;

export interface VoteCheckpointRow {
  readonly receptions: (typeof VOTE_CHECKPOINT_RECEPTIONS)[number];
  /** Measured cell error rate against the reference screen (`null` until at least `receptions` copies arrive). */
  readonly measuredCer: number | null;
  /** Theoretical erasure-only failure probability `p^N` (`videotex/design.md` "Math notes"). */
  readonly erasureFormulaCer: number;
  /** Theoretical undetected plain-majority failure `sum_{k > N/2} C(N, k) q^k (1 - q)^(N - k)`. */
  readonly majorityFormulaCer: number;
}

export interface VoteProgressionReport {
  readonly pageId: string;
  readonly totalReceptions: number;
  /** Empirical single-reception erasure rate `p` (`error: true` cells). */
  readonly measuredErasureRate: number;
  /** Empirical single-reception undetected wrong-cell rate `q` (`error: false` but wrong cell). */
  readonly measuredUndetectedRate: number;
  readonly rows: readonly VoteCheckpointRow[];
}

function clampProb(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let coeff = 1;
  for (let i = 1; i <= kk; i++) {
    coeff = (coeff * (n - kk + i)) / i;
  }
  return coeff;
}

/**
 * Erasure-only vote failure formula from `videotex/design.md`: `P_fail = p^N`.
 */
export function erasureVoteFailureFormula(p: number, n: number): number {
  const pc = clampProb(p);
  if (n <= 0) return 1;
  return Math.pow(pc, n);
}

/**
 * Plain majority failure formula for undetected errors with probability `q`:
 * `sum_{k > N/2} C(N, k) * q^k * (1 - q)^(N - k)`.
 */
export function majorityVoteFailureFormula(q: number, n: number): number {
  const qc = clampProb(q);
  if (n <= 0) return 1;
  if (qc === 0) return 0;
  if (qc === 1) return 1;

  const minWrong = Math.floor(n / 2) + 1;
  let sum = 0;
  for (let k = minWrong; k <= n; k++) {
    sum += binomial(n, k) * Math.pow(qc, k) * Math.pow(1 - qc, n - k);
  }
  return clampProb(sum);
}

/**
 * Approximate probability of an undetected double-bit error over the 8 parity-checked bits
 * (`C(8, 2) * eps^2 = 28 * eps^2`, `videotex/design.md` "Math notes").
 */
export function parityUndetectedApprox(bitErrorRate: number): number {
  const eps = clampProb(bitErrorRate);
  return clampProb(28 * eps * eps);
}

/**
 * Computes empirical single-reception erasure (`p`) and undetected (`q`) rates plus
 * measured CER after `1, 3, 5, 7` receptions next to both theoretical vote formulas.
 */
export function computeVoteProgression(
  pageId: string,
  receptions: readonly Screen[],
  reference: Screen,
): VoteProgressionReport {
  let totalCells = 0;
  let erasedCells = 0;
  let undetectedCells = 0;

  for (const rx of receptions) {
    for (let r = 0; r < SCREEN_ROWS; r++) {
      for (let c = 0; c < SCREEN_COLS; c++) {
        totalCells++;
        const cell = rx.rows[r][c];
        const refCell = reference.rows[r][c];
        if (cell.error) {
          erasedCells++;
        } else if (!cellsEqual(cell, refCell, true)) {
          undetectedCells++;
        }
      }
    }
  }

  const p = totalCells > 0 ? erasedCells / totalCells : 0;
  const q = totalCells > 0 ? undetectedCells / totalCells : 0;

  const rows: VoteCheckpointRow[] = VOTE_CHECKPOINT_RECEPTIONS.map((n) => {
    let measuredCer: number | null = null;
    if (receptions.length >= n) {
      const votedScreen =
        n === 1 ? receptions[0] : vote(receptions.slice(0, n)).screen;
      measuredCer = cellErrorRate(votedScreen, reference);
    }
    return {
      receptions: n,
      measuredCer,
      erasureFormulaCer: erasureVoteFailureFormula(p, n),
      majorityFormulaCer: majorityVoteFailureFormula(q, n),
    };
  });

  return {
    pageId,
    totalReceptions: receptions.length,
    measuredErasureRate: p,
    measuredUndetectedRate: q,
    rows,
  };
}
