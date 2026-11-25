// UART: frequency estimates -> characters (requirements 6.1 to 6.6, design.md "UART").
// Internal to src/modem (decision T5-6): the streaming demodulator (task 7) wraps it.
import type { Discriminator, DiscriminatorOutput } from './discriminator';
import { lineBitsToByte } from './frame';
import { createThresholdSource, softValue, type ThresholdSource, type ThresholdState } from './threshold';
import { CHANNELS, FRAME } from './v23';

/** One received frame. */
export interface UartChar {
  /** The 7 data bits, least significant first. */
  value: number;
  parityOk: boolean;
  framingOk: boolean;
  /**
   * Time of the mark-to-space edge of the start bit, in input samples since reset, group-delay
   * compensated, located by linear interpolation of the zero crossing of s (fractional). Precision
   * target on a clean signal: 1 decimated estimate, i.e. D input samples (decision T6-6).
   */
  atSample: number;
  /** Smallest |mean of s| over the 10 bit windows, start bit included (decision T6-5). */
  minConfidence: number;
  /** Threshold state right after this frame's decision-directed update (task 8, for diag). */
  threshold: ThresholdState;
}

export interface Uart {
  /** Bit period T = fs / baud, in input samples. */
  readonly bitPeriodSamples: number;
  /** Rejected start bits since reset (requirement 6.4), for tests and the HUD. */
  readonly falseStarts: number;
  push(out: DiscriminatorOutput): UartChar[];
  reset(): void;
}

/** Fraction of the bit period at which a decision window starts and ends (central 50 %). */
const WINDOW_START = 0.25;
const WINDOW_END = 0.75;
/**
 * Where the hunt resumes after a frame, in bit periods after its start edge.
 * - Valid stop bit: the centre of the stop bit, 9.5 T (decision T6-2, revised). With a transmitter
 *   clock fast by 2 % and collated frames, the next start edge comes at about 9.8 T, inside the
 *   filter's transition, so resuming at the end of the stop window (9.75 T) missed the edge under
 *   noise (26 and 27 failures out of 224 cases per clock model); 9.5 T leaves 0.3 T of margin.
 * - Framing error: the end of the stop window, 9.75 T ("current position", requirement 6.5).
 */
const RESUME_AFTER_VALID_STOP = FRAME.bitsPerFrame - 1 + 0.5;
const RESUME_AFTER_FRAMING_ERROR = FRAME.bitsPerFrame - 1 + WINDOW_END;
/** Adaptive threshold: a bit updates its tone estimate when it is the centre of 2 * RUN_HALF + 1 equal bits. */
const RUN_HALF = 2;

type Mode = 'hunt' | 'frame';

/**
 * Creates the UART that reads the estimates of a discriminator, with the fixed threshold.
 *
 * Time is handled on the discriminator's uniform grid: settled estimate m (estimates dated before
 * `settledTimeSamples` still hold the filter's zero history and are ignored) is at
 * tS + m * D input samples. Positions are fractional indices u on that grid; s between two
 * estimates is the linear interpolation (decision T6-1). All arithmetic is in double precision.
 *
 * States (design.md "UART"):
 * - hunt: look for a crossing of s from < 0 to >= 0 preceded by at least one bit period of mark.
 *   The mark run starts at the last space-to-mark crossing, or at the first examined estimate when
 *   the hunt starts inside mark. After a frame with a valid stop bit, the stop bit counts as that
 *   mark (decision T6-2).
 * - frame: once the data reach t_e + 0.75 T, check the start bit (mean s > 0, else false start,
 *   back to hunt from the edge); once they reach t_e + 9.75 T, decide bits 1..9 and emit a char.
 *   The hunt then resumes at t_e + 9.5 T after a valid stop bit, or at t_e + 9.75 T after a
 *   framing error.
 *
 * The threshold comes from `source` (default: a fixed-threshold source). It is read whenever a
 * soft value is computed, and an adaptive source is updated after each decided frame (task 8).
 *
 * The result depends only on the sequence of estimates, never on how they are split into blocks.
 */
export function createUart(
  d: Pick<Discriminator, 'sampleRate' | 'channel' | 'decimation' | 'settledTimeSamples'>,
  source: ThresholdSource = createThresholdSource(CHANNELS[d.channel], 'fixed'),
): Uart {
  const spec = CHANNELS[d.channel];
  const bitPeriod = d.sampleRate / spec.baud; // input samples
  const D = d.decimation;
  const Tb = bitPeriod / D; // bit period in estimates
  const frameBits = FRAME.bitsPerFrame;
  const lastWindowEnd = (frameBits - 1 + WINDOW_END) * Tb; // 9.75 T, relative to the edge
  // Ring buffer of settled frequencies, indexed by the global settled index m. It holds at least
  // one frame plus margins: in hunt mode only the previous estimate is needed, and in frame mode
  // everything from the edge to the end of the stop window.
  const cap = Math.ceil(frameBits * Tb) + 2 * Math.ceil(Tb) + 16;
  const ring = new Float64Array(cap);
  const bits = new Uint8Array(frameBits);
  const means = new Float64Array(frameBits);
  const halfGap = (spec.spaceHz - spec.markHz) / 2;

  let tS = NaN; // time of settled estimate 0, input samples
  let count = 0; // number of settled estimates received
  let mode: Mode = 'hunt';
  let cursor = 1; // hunt: next estimate k examined with k - 1
  let markStart = NaN; // start of the current mark run (index units); NaN = not in mark
  let edge = 0; // frame: fractional index of the start edge
  let edgeK = 0; // frame: estimate index just after the edge
  let startChecked = false;
  let falseStarts = 0;

  // The ring holds frequencies; the soft value uses the threshold in force when it is read, so an
  // adaptive threshold updated after a frame applies to the following decisions. With the fixed
  // threshold this is exactly softValue(f, 1700) per sample, as before (task 8 non-regression).
  const s = (m: number): number => softValue(ring[m % cap], source.thresholdHz(), spec);

  /** Exact mean of the piecewise-linear s over [ua, ub] (indices, ub <= count - 1). */
  function windowMean(ua: number, ub: number): number {
    let total = 0;
    let x0 = ua;
    while (x0 < ub) {
      const k = Math.floor(x0);
      const x1 = Math.min(ub, k + 1);
      const sk = s(k);
      const slope = s(k + 1) - sk;
      total += (x1 - x0) * (sk + slope * ((x0 + x1) / 2 - k));
      x0 = x1;
    }
    return total / (ub - ua);
  }

  /** Decides the 10 line bits (start included) and checks parity and framing with lineBitsToByte. */
  function emitFrame(out: UartChar[]): void {
    let minConfidence = Infinity;
    const theta = source.thresholdHz();
    for (let i = 0; i < frameBits; i++) {
      const mean = windowMean(edge + (i + WINDOW_START) * Tb, edge + (i + WINDOW_END) * Tb);
      minConfidence = Math.min(minConfidence, Math.abs(mean));
      bits[i] = mean < 0 ? 1 : 0;
      means[i] = mean;
    }
    // Decision-directed update (adaptive mode only), after the whole frame is decided: the mean
    // frequency over a bit's window updates the estimate of the tone it was decided as, but only
    // for the centre bit of a run of 2 * RUN_HALF + 1 = 5 equal bits inside the frame. Through the filter, a bit of
    // the other tone pulls the window mean towards it (inter-symbol interference): updating on
    // every bit biased the estimates by up to 66 Hz at +-400 Hz offset, and on runs of 3 by up to
    // 22 Hz (task 8 measurements, design.md "Threshold").
    for (let i = RUN_HALF; i < frameBits - RUN_HALF; i++) {
      let run = true;
      for (let k = i - RUN_HALF; k <= i + RUN_HALF && run; k++) run = bits[k] === bits[i];
      if (run) source.observeBit(bits[i], theta + means[i] * halfGap);
    }
    const f = lineBitsToByte(bits);
    out.push({
      value: f.value,
      parityOk: f.parityOk,
      framingOk: f.framingOk,
      atSample: tS + edge * D,
      minConfidence,
      threshold: source.state(),
    });
    // Resume point (see RESUME_AFTER_*): the pair (k - 1, k) examined first contains that instant.
    const resume = f.framingOk ? RESUME_AFTER_VALID_STOP : RESUME_AFTER_FRAMING_ERROR;
    cursor = Math.floor(edge + resume * Tb) + 1;
    markStart = f.framingOk ? -Infinity : NaN; // T6-2: valid stop counts as mark; else measure 1 T
    mode = 'hunt';
  }

  /** Advances the state machine as far as the received estimates allow. */
  function run(out: UartChar[]): void {
    const last = count - 1;
    for (;;) {
      if (mode === 'hunt') {
        if (cursor > last) return;
        const k = cursor;
        const a = s(k - 1);
        const b = s(k);
        if (a < 0 && b >= 0) {
          if (Number.isNaN(markStart)) markStart = k - 1;
          const xe = k - 1 + a / (a - b);
          if (xe - markStart >= Tb) {
            mode = 'frame';
            edge = xe;
            edgeK = k;
            startChecked = false;
            continue;
          }
          markStart = NaN; // entered space without enough mark before it
        } else if (a >= 0 && b < 0) {
          markStart = k - 1 + a / (a - b);
        } else if (a < 0) {
          if (Number.isNaN(markStart)) markStart = k - 1;
        } else {
          markStart = NaN;
        }
        cursor = k + 1;
      } else {
        if (!startChecked) {
          const ub = edge + WINDOW_END * Tb;
          if (Math.ceil(ub) > last) return;
          if (!(windowMean(edge + WINDOW_START * Tb, ub) > 0)) {
            falseStarts++;
            mode = 'hunt';
            cursor = edgeK + 1; // keep searching after the false edge
            markStart = NaN;
            continue;
          }
          startChecked = true;
        }
        if (Math.ceil(edge + lastWindowEnd) > last) return;
        emitFrame(out);
      }
    }
  }

  return {
    bitPeriodSamples: bitPeriod,
    get falseStarts() {
      return falseStarts;
    },
    push(o: DiscriminatorOutput): UartChar[] {
      const out: UartChar[] = [];
      for (let j = 0; j < o.count; j++) {
        const t = o.firstTimeSamples + j * D;
        if (t < d.settledTimeSamples) continue;
        if (count === 0) tS = t;
        ring[count % cap] = o.freqHz[j];
        count++;
        run(out);
      }
      return out;
    },
    reset(): void {
      tS = NaN;
      count = 0;
      mode = 'hunt';
      cursor = 1;
      markStart = NaN;
      edge = 0;
      edgeK = 0;
      startChecked = false;
      falseStarts = 0;
      ring.fill(0);
    },
  };
}
