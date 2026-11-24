import * as modemBarrel from '../modem';
import {
  CHANNELS,
  type ConnectionSequenceOptions,
  type DemodOptions,
  type ModemError,
  type ModulateOptions,
  type Result,
  type StreamingDemodulator,
} from '../modem';
import {
  createFakeDemodulator,
  fakeConnectionSequence,
  fakeModulate,
} from './fake-modem';
import type { SimParams } from './protocol';

export interface StreamingSimulator {
  process(chunk: Float32Array): Float32Array;
  setSim(sim: SimParams): void;
  reset(): void;
}

export interface ModemProvider {
  readonly kind: 'real' | 'fake';
  modulate(bytes: Uint8Array, o: ModulateOptions): Result<Float32Array, ModemError>;
  connectionSequence(o: ConnectionSequenceOptions): Float32Array;
  createDemodulator(o: DemodOptions): Result<StreamingDemodulator, ModemError>;
  createSimulator(sampleRate: number, initialSim: SimParams): StreamingSimulator;
}

interface OptionalRealModemExports {
  modulate?: (bytes: Uint8Array, o: ModulateOptions) => Result<Float32Array, ModemError>;
  connectionSequence?: (o: ConnectionSequenceOptions) => Float32Array;
  createDemodulator?: (o: DemodOptions) => Result<StreamingDemodulator, ModemError>;
  createChannel?: (p: Record<string, unknown>) => Result<
    {
      process(chunk: Float32Array): Float32Array;
      flush(): Float32Array;
      setParams(p: Record<string, unknown>): void;
      reset(): void;
    },
    ModemError
  >;
  DEFAULT_HUM?: unknown;
  DEFAULT_BURSTS?: unknown;
}

/**
 * Deterministic mulberry32 + Box-Muller AWGN fallback used only until Role B's
 * `createChannel` lands in `src/modem/index.ts` (task 9).
 */
function createFallbackSimulator(
  sampleRate: number,
  initialSim: SimParams,
  isFakeModem: boolean,
): StreamingSimulator {
  let sim: SimParams = { ...initialSim };
  let state = sim.seed >>> 0;
  let spareGaussian: number | null = null;
  let humPhase = 0;

  function nextUniform(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextGaussian(): number {
    if (spareGaussian !== null) {
      const g = spareGaussian;
      spareGaussian = null;
      return g;
    }
    const u1 = Math.max(1e-12, nextUniform());
    const u2 = nextUniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    spareGaussian = r * Math.sin(theta);
    return r * Math.cos(theta);
  }

  return {
    process(chunk: Float32Array): Float32Array {
      const out = chunk.slice();
      // When the fake demodulator is active, audio is only for speaker playback; keep clean unless Eb/N0 is set
      if (sim.ebN0Db === null && !sim.hum) {
        return out;
      }
      const amp = 0.5;
      // Relation R1 from docs/math.md: sigma^2 = A^2 * fs / (4 * R * 10^(EbN0/10))
      const sigma =
        sim.ebN0Db !== null
          ? Math.sqrt(
              (amp * amp * sampleRate) /
                (4 * CHANNELS.forward.baud * Math.pow(10, sim.ebN0Db / 10)),
            )
          : 0;
      const humAmp = sim.hum ? amp * Math.pow(10, -20 / 20) : 0;
      const humStep = (2 * Math.PI * 50) / sampleRate;

      for (let i = 0; i < out.length; i++) {
        let sample = out[i];
        if (humAmp > 0) {
          humPhase += humStep;
          if (humPhase > 2 * Math.PI) humPhase -= 2 * Math.PI;
          sample += humAmp * Math.sin(humPhase);
        }
        if (sigma > 0) {
          sample += sigma * nextGaussian();
        }
        // Soft clamp for audio playback comfort when fake modem is playing through speakers
        out[i] = isFakeModem ? Math.max(-1, Math.min(1, sample)) : sample;
      }
      return out;
    },
    setSim(next: SimParams): void {
      sim = { ...next };
    },
    reset(): void {
      state = sim.seed >>> 0;
      spareGaussian = null;
      humPhase = 0;
    },
  };
}

/**
 * Resolves the active V.23 modem provider:
 * - Automatically uses Role B's real `modulate` + `createDemodulator` from `src/modem/index.ts`
 *   as soon as both are exported there.
 * - Falls back seamlessly to `src/workers/fake-modem.ts` before Role B's tasks 3–7 land.
 */
export function resolveModemProvider(): ModemProvider {
  const real = modemBarrel as unknown as OptionalRealModemExports;
  const hasRealModem =
    typeof real.modulate === 'function' && typeof real.createDemodulator === 'function';

  const modulateFn = hasRealModem && real.modulate ? real.modulate : fakeModulate;
  const connSeqFn =
    typeof real.connectionSequence === 'function'
      ? real.connectionSequence
      : fakeConnectionSequence;
  const createDemodFn =
    hasRealModem && real.createDemodulator
      ? real.createDemodulator
      : createFakeDemodulator;

  return {
    kind: hasRealModem ? 'real' : 'fake',
    modulate: modulateFn,
    connectionSequence: connSeqFn,
    createDemodulator: createDemodFn,
    createSimulator(sampleRate: number, initialSim: SimParams): StreamingSimulator {
      if (typeof real.createChannel === 'function') {
        const toChannelUpdates = (s: SimParams): Record<string, unknown> => ({
          channel: 'forward',
          signalAmplitude: 0.5,
          noise: s.ebN0Db !== null ? { kind: 'ebN0', db: s.ebN0Db } : undefined,
          offsetHz: s.offsetHz,
          clockPpm: s.clockPct * 10_000,
          hum: s.hum ? (real.DEFAULT_HUM ?? { levelDb: -20 }) : undefined,
          bursts: s.bursts
            ? (real.DEFAULT_BURSTS ?? {
                ratePerS: 0.5,
                durationMs: [5, 25],
                levelDb: -6,
              })
            : undefined,
        });

        const created = real.createChannel({
          sampleRate,
          seed: initialSim.seed >>> 0,
          ...toChannelUpdates(initialSim),
        });
        if (created.ok) {
          const ch = created.value;
          return {
            process(chunk: Float32Array): Float32Array {
              return ch.process(chunk);
            },
            setSim(next: SimParams): void {
              ch.setParams(toChannelUpdates(next));
            },
            reset(): void {
              ch.reset();
            },
          };
        }
      }
      return createFallbackSimulator(sampleRate, initialSim, !hasRealModem);
    },
  };
}
