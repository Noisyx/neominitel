import { useEffect, useRef, useState, type MutableRefObject, type ReactElement } from 'react';
import { extractEyeTraces, type HudSignalBuffer } from './hudStore';

export interface EyeDiagramProps {
  bufferRef: MutableRefObject<HudSignalBuffer>;
}

const CANVAS_W = 280;
const CANVAS_H = 92;
const MIN_HZ = 800;
const MAX_HZ = 2600;

function hzToY(hz: number): number {
  const clamped = Math.max(MIN_HZ, Math.min(MAX_HZ, hz));
  const norm = (clamped - MIN_HZ) / (MAX_HZ - MIN_HZ);
  return CANVAS_H - 6 - norm * (CANVAS_H - 12);
}

/**
 * Eye diagram overlaying recent 2-bit frequency trajectories around the central bit sampling
 * window (`[0.25 T, 0.75 T]`) and threshold line (Requirements 8.1 & 8.4).
 */
export function EyeDiagram({ bufferRef }: EyeDiagramProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [traceCount, setTraceCount] = useState<number>(0);
  const [openingHz, setOpeningHz] = useState<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastVersion = -1;
    let lastSrMs = 0;
    let rafId = 0;

    const draw = (nowMs: number): void => {
      const buf = bufferRef.current;
      if (buf.version !== lastVersion) {
        lastVersion = buf.version;

        ctx.fillStyle = '#0a0d0c';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // Central bit [0.5, 1.5] and its central half-bit sampling aperture [0.75, 1.25]
        const sampleX0 = (0.75 / 2) * CANVAS_W;
        const sampleX1 = (1.25 / 2) * CANVAS_W;
        ctx.fillStyle = 'rgba(229, 184, 75, 0.10)';
        ctx.fillRect(sampleX0, 0, sampleX1 - sampleX0, CANVAS_H);

        ctx.strokeStyle = 'rgba(235, 228, 214, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo((0.5 / 2) * CANVAS_W, 0);
        ctx.lineTo((0.5 / 2) * CANVAS_W, CANVAS_H);
        ctx.moveTo((1.5 / 2) * CANVAS_W, 0);
        ctx.lineTo((1.5 / 2) * CANVAS_W, CANVAS_H);
        ctx.stroke();

        // Decision threshold horizontal line
        const threshY = hzToY(buf.thresholdHz);
        ctx.strokeStyle = '#e5b84b';
        ctx.beginPath();
        ctx.moveTo(0, threshY);
        ctx.lineTo(CANVAS_W, threshY);
        ctx.stroke();

        const traces = extractEyeTraces(buf, 28);
        let minMargin = Infinity;

        ctx.strokeStyle = 'rgba(100, 210, 255, 0.38)';
        ctx.lineWidth = 1.15;
        for (const tr of traces) {
          ctx.beginPath();
          let sumMid = 0;
          let countMid = 0;
          for (let i = 0; i < tr.xNorm.length; i++) {
            const xn = tr.xNorm[i];
            const f = tr.freqHz[i];
            const x = (xn / 2) * CANVAS_W;
            const y = hzToY(f);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            if (xn >= 0.75 && xn <= 1.25) {
              sumMid += f;
              countMid++;
            }
          }
          ctx.stroke();
          if (countMid > 0) {
            const margin = Math.abs(sumMid / countMid - buf.thresholdHz);
            if (margin < minMargin) {
              minMargin = margin;
            }
          }
        }

        if (nowMs - lastSrMs > 300) {
          lastSrMs = nowMs;
          setTraceCount(traces.length);
          setOpeningHz(
            Number.isFinite(minMargin) ? Math.round(minMargin * 2) : 0,
          );
        }
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [bufferRef]);

  const srText = `Diagramme de l’œil : ${traceCount} périodes superposées, ouverture minimale ${openingHz} Hz autour du seuil.`;

  return (
    <div className="nm-hud-card">
      <div className="nm-hud-card-header">
        <span className="nm-hud-card-title">Diagramme de l&apos;œil</span>
        <span className="nm-hud-card-meta">
          {traceCount > 0 ? `Ouverture : ${openingHz} Hz` : 'En attente de trames'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="nm-hud-canvas"
        width={CANVAS_W}
        height={CANVAS_H}
        role="img"
        aria-label={srText}
      />
      <p className="nm-sr-only">{srText}</p>
    </div>
  );
}
