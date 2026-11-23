import fc from 'fast-check';

export const STANDARD_SAMPLE_RATES = [
  8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000,
] as const;

/**
 * Arbitrary 7-bit byte (0..127).
 */
export function arbByte7(): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: 127 });
}

/**
 * Arbitrary `Uint8Array` holding 7-bit values (0..127).
 */
export function arbBytes7(
  minLength = 0,
  maxLength = 500,
): fc.Arbitrary<Uint8Array> {
  return fc
    .array(arbByte7(), { minLength, maxLength })
    .map((arr) => Uint8Array.from(arr));
}

/**
 * Arbitrary sample rate from the M1 test set.
 */
export function arbStandardSampleRate(): fc.Arbitrary<number> {
  return fc.constantFrom(...STANDARD_SAMPLE_RATES);
}

/**
 * Arbitrary valid sample rate in [8000, 96000].
 */
export function arbAnySampleRate(): fc.Arbitrary<number> {
  return fc.integer({ min: 8000, max: 96000 });
}

/**
 * Returns true when `npm run test:slow` (`SLOW_TESTS=1`) is active.
 */
export function isSlowTestsEnabled(): boolean {
  return process.env.SLOW_TESTS === '1' || process.env.SLOW_TESTS === 'true';
}
