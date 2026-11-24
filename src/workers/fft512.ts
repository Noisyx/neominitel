export const FFT_SIZE = 512;
export const SPECTRUM_BINS = FFT_SIZE / 2 + 1; // 257 bins (0 .. fs/2)

const HANN_WINDOW = new Float64Array(FFT_SIZE);
const BIT_REVERSED = new Uint16Array(FFT_SIZE);

for (let n = 0; n < FFT_SIZE; n++) {
  HANN_WINDOW[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (FFT_SIZE - 1)));
  let rev = 0;
  let v = n;
  for (let b = 0; b < 9; b++) {
    rev = (rev << 1) | (v & 1);
    v >>= 1;
  }
  BIT_REVERSED[n] = rev;
}

/**
 * Reusable zero-allocation 512-point Hann-windowed real FFT computing dBFS magnitudes
 * for positive frequencies (`0 .. sampleRate / 2`, 257 bins).
 */
export class SpectrumAnalyzer512 {
  private readonly ring = new Float32Array(FFT_SIZE);
  private readonly re = new Float64Array(FFT_SIZE);
  private readonly im = new Float64Array(FFT_SIZE);
  private writePos = 0;

  pushSamples(samples: Float32Array): void {
    const len = samples.length;
    if (len >= FFT_SIZE) {
      const start = len - FFT_SIZE;
      for (let i = 0; i < FFT_SIZE; i++) {
        const s = samples[start + i];
        this.ring[i] = Number.isFinite(s) ? s : 0;
      }
      this.writePos = 0;
      return;
    }

    for (let i = 0; i < len; i++) {
      const s = samples[i];
      this.ring[this.writePos] = Number.isFinite(s) ? s : 0;
      this.writePos = (this.writePos + 1) & (FFT_SIZE - 1);
    }
  }

  computeSpectrumDb(): Float32Array {
    const re = this.re;
    const im = this.im;

    for (let n = 0; n < FFT_SIZE; n++) {
      const sampleIdx = (this.writePos + n) & (FFT_SIZE - 1);
      const revIdx = BIT_REVERSED[n];
      re[revIdx] = this.ring[sampleIdx] * HANN_WINDOW[n];
      im[revIdx] = 0;
    }

    for (let size = 2; size <= FFT_SIZE; size <<= 1) {
      const half = size >> 1;
      const angleStep = (-2 * Math.PI) / size;
      const wStepRe = Math.cos(angleStep);
      const wStepIm = Math.sin(angleStep);

      for (let base = 0; base < FFT_SIZE; base += size) {
        let wRe = 1;
        let wIm = 0;
        for (let k = 0; k < half; k++) {
          const evenIdx = base + k;
          const oddIdx = evenIdx + half;
          const tRe = wRe * re[oddIdx] - wIm * im[oddIdx];
          const tIm = wRe * im[oddIdx] + wIm * re[oddIdx];

          re[oddIdx] = re[evenIdx] - tRe;
          im[oddIdx] = im[evenIdx] - tIm;
          re[evenIdx] += tRe;
          im[evenIdx] += tIm;

          const nextWRe = wRe * wStepRe - wIm * wStepIm;
          wIm = wRe * wStepIm + wIm * wStepRe;
          wRe = nextWRe;
        }
      }
    }

    // Coherent gain of Hann window of length N is N/2 = 256; full-scale sine peak = 1 => mag/(N/4) = 1 => 0 dBFS
    const norm = FFT_SIZE / 4;
    const out = new Float32Array(SPECTRUM_BINS);
    for (let k = 0; k < SPECTRUM_BINS; k++) {
      const mag = Math.hypot(re[k], im[k]) / norm;
      const db = 20 * Math.log10(Math.max(mag, 1e-6));
      out[k] = Math.max(-120, Math.min(0, db));
    }
    return out;
  }

  reset(): void {
    this.ring.fill(0);
    this.writePos = 0;
  }
}
