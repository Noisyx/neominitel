// Public barrel of the V.23 modem core: the only import point for code outside src/modem/
// (structure.md, dependency rule). Implementations are exported here as they land:
// modulate / connectionSequence (task 3), createDemodulator (task 7), channel (task 9),
// PN9 / BER / Wilson (task 10), theory (task 11). Until then the app uses
// src/workers/fake-modem.ts, which has the same signatures.
export * from './types';
export * from './v23';
