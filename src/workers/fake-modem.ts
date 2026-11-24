import {
  CHANNELS,
  createDemodulator,
  modulate,
  type DemodOptions,
  type ModulateOptions,
  type ModemError,
  type Result,
  type StreamingDemodulator,
} from '../modem';

/**
 * Role A helper wrapper around the modem interface so that `src/workers/` can
 * decode pages deterministically before Role B delivers the full DSP demodulator on J3/J4.
 */
export function fakeModulate(
  bytes: Uint8Array,
  options: ModulateOptions,
): Result<Float32Array, ModemError> {
  return modulate(bytes, options);
}

export function createFakeDemodulator(
  options: DemodOptions,
): Result<StreamingDemodulator, ModemError> {
  return createDemodulator({
    ...options,
    channel: options.channel ?? CHANNELS.forward.id,
    threshold: options.threshold ?? 'fixed',
  });
}
