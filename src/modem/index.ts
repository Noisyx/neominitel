// Public barrel of the V.23 modem core: the only import point for code outside src/modem/
// (structure.md, dependency rule). Implementations are exported here as they land:
// modulate / connectionSequence (task 3), readWav / writeWav (task 4), createDemodulator (task 7), channel (task 9),
// PN9 / BER / Wilson (task 10), theory (task 11). createDemodulator is the real demodulator from
// task 7: src/workers/modem-bridge.ts switches the app from src/workers/fake-modem.ts to it as soon
// as this export exists. No `quality` events are emitted before task 10.
export * from './types';
export * from './v23';
export { modulate, connectionSequence } from './modulator';
export { readWav, writeWav, WAV_ERROR_REASONS, type WavAudio, type WavErrorReason } from './wav';
export { createDemodulator } from './demodulator';
export {
  createChannel,
  applyChannel,
  channelLatencySamples,
  DEFAULT_HUM,
  DEFAULT_BURSTS,
  type ChannelParams,
  type ChannelUpdate,
  type LineChannel,
  type HumParams,
  type BurstParams,
  type NoiseParams,
} from './channel';
export { pn9Frames, BerCounter, wilsonInterval, wilson95, type BerSnapshot } from './prbs';
