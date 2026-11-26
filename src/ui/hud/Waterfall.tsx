import { useEffect, useRef, useState, type MutableRefObject, type ReactElement } from 'react';
import { CHANNELS } from '../../modem';
import {
  hzToSpectrumBin,
  spectrumDbToRgb,
  WATERFALL_HISTORY_ROWS,
  WATERFALL_MAX_HZ,
  type HudSignalBuffer,
} from './hudStore';

export interface WaterfallProps {
  bufferRef: MutableRefObject<HudSignalBuffer>;
}

const CANVAS_W = 480;
const CANVAS_H = WATERFALL_HISTORY_ROWS;

/**
 * Live 0–3 kHz waterfall spectrogram with mark (1300 Hz) and space (2100 Hz) markers
 * and screen-reader text summary (Requirements 8.1 & 8.4).
 */
export function Waterfall({ bufferRef }: WaterfallProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [srSummary, setSrSummary] = useState<string>(
    `Spectre 0 à 3 kHz : repères mark ${CHANNELS.forward.markHz} Hz et space ${CHANNELS.forward.spaceHz} Hz.`,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
    const rgba = imageData.data;
    let lastVersion = -1;
    let lastSrUpdateMs = 0;
    let rafId = 0;

    const draw = (nowMs: number): void => {
      const buf = bufferRef.current;
      if (buf.version !== lastVersion) {
        lastVersion = buf.version;

        // Clear background
        for (let i = 0; i < rgba.length; i += 4) {
          rgba[i] = 10;
          rgba[i + 1] = 13;
          rgba[i + 2] = 12;
          rgba[i + 3] = 255;
        }

        const rows = buf.waterfallRows;
        const rowOffset = CANVAS_H - rows.length;

        for (let r = 0; r < rows.length; r++) {
          const spec = rows[r];
          const y = rowOffset + r;
          if (y < 0 || y >= CANVAS_H) continue;

          for (let x = 0; x < CANVAS_W; x++) {
            const hz = (x / (CANVAS_W - 1)) * WATERFALL_MAX_HZ;
            const binF = hzToSpectrumBin(hz, buf.sampleRate);
            const b0 = Math.floor(binF);
            const b1 = Math.min(spec.length - 1, b0 + 1);
            const frac = binF - b0;
            const db = spec[b0] * (1 - frac) + spec[b1] * frac;
            const [red, green, blue] = spectrumDbToRgb(db);

            const p = (y * CANVAS_W + x) * 4;
            rgba[p] = red;
            rgba[p + 1] = green;
            rgba[p + 2] = blue;
            rgba[p + 3] = 255;
          }
        }

        ctx.putImageData(imageData, 0, 0);

        // Overlay hairline markers for markHz and spaceHz
        const markX = (buf.markHz / WATERFALL_MAX_HZ) * CANVAS_W;
        const spaceX = (buf.spaceHz / WATERFALL_MAX_HZ) * CANVAS_W;
        ctx.strokeStyle = 'rgba(82, 199, 89, 0.72)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(markX, 0);
        ctx.lineTo(markX, CANVAS_H);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(100, 210, 255, 0.72)';
        ctx.beginPath();
        ctx.moveTo(spaceX, 0);
        ctx.lineTo(spaceX, CANVAS_H);
        ctx.stroke();

        if (nowMs - lastSrUpdateMs > 500) {
          lastSrUpdateMs = nowMs;
          setSrSummary(
            `Spectre 0 à 3 kHz : pic à ${buf.peakWaterfallHz} Hz (${buf.peakWaterfallDb.toFixed(0)} dBFS), mark ${buf.markHz} Hz, space ${buf.spaceHz} Hz.`,
          );
        }
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [bufferRef]);

  const markPct = ((CHANNELS.forward.markHz / WATERFALL_MAX_HZ) * 100).toFixed(1);
  const spacePct = ((CHANNELS.forward.spaceHz / WATERFALL_MAX_HZ) * 100).toFixed(1);

  return (
    <div className="nm-hud-card">
      <div className="nm-hud-card-header">
        <span className="nm-hud-card-title">Spectrogramme (0 – 3 kHz)</span>
        <span className="nm-hud-card-meta">
          {`1 : ${CHANNELS.forward.markHz} Hz · 0 : ${CHANNELS.forward.spaceHz} Hz`}
        </span>
      </div>
      <div className="nm-hud-ruler" aria-hidden="true">
        <span>0</span>
        <span className="nm-hud-marker-mark" style={{ left: `${markPct}%` }}>
          {`${CHANNELS.forward.markHz}`}
        </span>
        <span className="nm-hud-marker-space" style={{ left: `${spacePct}%` }}>
          {`${CHANNELS.forward.spaceHz}`}
        </span>
        <span>3 kHz</span>
      </div>
      <canvas
        ref={canvasRef}
        className="nm-hud-canvas"
        width={CANVAS_W}
        height={CANVAS_H}
        role="img"
        aria-label={srSummary}
      />
      <p className="nm-sr-only">{srSummary}</p>
    </div>
  );
}
