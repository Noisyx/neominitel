// Full-chain BER measurement shared by the M6 and M15 tests, scripts/calibrate-modem.ts and
// scripts/montecarlo-ber.ts: PN9 frames -> modulate -> applyChannel (AWGN at Eb/N0, A7) ->
// streaming demodulator or correlator receiver -> BerCounter (design.md "PN9 and BER"). Deterministic for a given seed.
import { BerCounter, applyChannel, createCorrelatorDemodulator, createDemodulator, modulate, pn9Frames, type BerSnapshot } from '../../src/modem';

export interface ChainBerOptions {
  sampleRate: number;
  ebN0Db: number;
  seed: number;
  frames: number;
  threshold?: 'fixed' | 'adaptive';
  /** Default 'discriminator' (the app receiver); 'correlator' is the task 15 receiver (curve 4). */
  receiver?: 'discriminator' | 'correlator';
}

const cleanCache = new Map<string, Float32Array>();

function cleanSignal(sampleRate: number, frames: number): Float32Array {
  const key = `${sampleRate}/${frames}`;
  let x = cleanCache.get(key);
  if (!x) {
    const m = modulate(pn9Frames(frames), { sampleRate });
    if (!m.ok) throw new Error(`modulate: ${JSON.stringify(m.error)}`);
    x = m.value;
    cleanCache.set(key, x);
  }
  return x;
}

/** BER of the specified counter on one noisy PN9 transmission. */
export function chainBer(o: ChainBerOptions): BerSnapshot {
  const y = applyChannel(cleanSignal(o.sampleRate, o.frames), {
    sampleRate: o.sampleRate,
    seed: o.seed,
    noise: { kind: 'ebN0', db: o.ebN0Db },
  });
  if (!y.ok) throw new Error(`applyChannel: ${JSON.stringify(y.error)}`);
  if (o.receiver === 'correlator') {
    const c = createCorrelatorDemodulator({ sampleRate: o.sampleRate });
    if (!c.ok) throw new Error(`createCorrelatorDemodulator: ${JSON.stringify(c.error)}`);
    const counter = new BerCounter();
    for (const ch of [...c.value.push(y.value), ...c.value.flush()]) counter.pushFrame(ch.value, ch.framingOk);
    return counter.snapshot();
  }
  const d = createDemodulator({ sampleRate: o.sampleRate, threshold: o.threshold });
  if (!d.ok) throw new Error(`createDemodulator: ${JSON.stringify(d.error)}`);
  const counter = new BerCounter();
  for (const e of [...d.value.push(y.value), ...d.value.flush()]) {
    if (e.type === 'char') counter.pushFrame(e.value, e.framingOk);
  }
  return counter.snapshot();
}

/** Frames for at least `bits` compared bits, with margin for frames lost to noise. */
export function framesForBits(bits: number): number {
  return Math.ceil((bits * 1.12) / 7);
}
