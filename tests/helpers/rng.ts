export interface SeededRng {
  /** Uniform float in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [minInclusive, maxInclusive]. */
  nextInt(minInclusive: number, maxInclusive: number): number;
  /** Standard normal N(0, 1) sample via Box-Muller transform. */
  nextGaussian(): number;
}

/**
 * Deterministic Mulberry32 PRNG with Box-Muller Gaussian generator.
 */
export function createRng(seed: number): SeededRng {
  let state = seed | 0;
  let spareGaussian: number | null = null;

  function nextFloat(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(minInclusive: number, maxInclusive: number): number {
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(nextFloat() * span);
  }

  function nextGaussian(): number {
    if (spareGaussian !== null) {
      const val = spareGaussian;
      spareGaussian = null;
      return val;
    }
    let u1 = 0;
    while (u1 <= 1e-12) {
      u1 = nextFloat();
    }
    const u2 = nextFloat();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const angle = 2.0 * Math.PI * u2;
    spareGaussian = mag * Math.sin(angle);
    return mag * Math.cos(angle);
  }

  return {
    nextFloat,
    nextInt,
    nextGaussian,
  };
}
