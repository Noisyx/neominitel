// Bit decision threshold and soft value (requirement 7.1, design.md "Threshold").
// Task 6: fixed threshold only. The adaptive threshold arrives with task 8.
import type { ChannelSpec } from './v23';

/** Fixed threshold of a channel: the midpoint of the nominal tones (1700 Hz forward). */
export function fixedThresholdHz(spec: ChannelSpec): number {
  return spec.thresholdHz;
}

/**
 * Soft value s = (f - theta) / ((spaceHz - markHz) / 2), in double precision.
 * s < 0 is mark (1), s > 0 is space (0); |s| is the confidence. With theta at the midpoint,
 * the nominal mark tone gives s = -1 and the nominal space tone s = +1.
 */
export function softValue(fHz: number, thresholdHz: number, spec: ChannelSpec): number {
  return (fHz - thresholdHz) / ((spec.spaceHz - spec.markHz) / 2);
}
