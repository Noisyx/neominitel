import { useEffect, useRef, useState, type MutableRefObject, type ReactElement } from 'react';
import { CHANNELS } from '../../modem';
import type { HudSignalBuffer } from './hudStore';

export interface DiscriminatorTraceProps {
  bufferRef: MutableRefObject<HudSignalBuffer>;
}

const CANVAS_W = 280;
const CANVAS_H = 96;
const MIN_PLOT_HZ = 800;
const MAX_PLOT_HZ = 2600;
const TRACE_SPAN_SEC = 0.025; // 25 ms (~30 forward bits = 3 frames)

function hzToY(hz: number): number {
  const clamped = Math.max(MIN_PLOT_HZ, Math.min(MAX_PLOT_HZ, hz));
  const norm = (clamped - MIN_PLOT_HZ) / (MAX_PLOT_HZ - MIN_PLOT_HZ);
  return CANVAS_H - 6 - norm * (CANVAS_H - 12);
}

/**
 * Instantaneous frequency trace from the complex discriminator, showing the decision
 * threshold line and UART bit sampling windows (Requirements 8.1 & 8.4).
 */
export function DiscriminatorTrace({
  bufferRef,
}: DiscriminatorTraceProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [thresholdReadout, setThresholdReadout] = useState<number>(
    CHANNELS.forward.thresholdHz,
  );
  const [windowCountReadout, setWindowCountReadout] = useState<number>(0);

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

        const spanSamples = TRACE_SPAN_SEC * buf.sampleRate;
        const endT =
          buf.sampleCount > 0 ? buf.samplesT[buf.sampleCount - 1] : spanSamples;
        const startT = endT - spanSamples;

        // 1. Shade UART bit sampling windows (central 50% decision zone)
        let visibleWindows = 0;
        ctx.fillStyle = 'rgba(229, 184, 75, 0.14)';
        for (const [w0, w1] of buf.bitWindows) {
          if (w1 < startT || w0 > endT) continue;
          visibleWindows++;
          const period = w1 - w0;
          const center0 = w0 + 0.25 * period;
          const center1 = w0 + 0.75 * period;
          const x0 = ((center0 - startT) / spanSamples) * CANVAS_W;
          const x1 = ((center1 - startT) / spanSamples) * CANVAS_W;
          ctx.fillRect(x0, 4, Math.max(1, x1 - x0), CANVAS_H - 8);
        }

        // 2. Reference mark & space lines + live threshold line
        const markY = hzToY(buf.markHz);
        const spaceY = hzToY(buf.spaceHz);
        const threshY = hzToY(buf.thresholdHz);

        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(82, 199, 89, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, markY);
        ctx.lineTo(CANVAS_W, markY);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(100, 210, 255, 0.45)';
        ctx.beginPath();
        ctx.moveTo(0, spaceY);
        ctx.lineTo(CANVAS_W, spaceY);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.strokeStyle = '#e5b84b';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(0, threshY);
        ctx.lineTo(CANVAS_W, threshY);
        ctx.stroke();

        // 3. Discriminator instantaneous frequency curve
        if (buf.sampleCount >= 2) {
          ctx.strokeStyle = '#ede7da';
          ctx.lineWidth = 1.35;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < buf.sampleCount; i++) {
            const t = buf.samplesT[i];
            if (t < startT) continue;
            const x = ((t - startT) / spanSamples) * CANVAS_W;
            const y = hzToY(buf.samplesF[i]);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }

        if (nowMs - lastSrMs > 300) {
          lastSrMs = nowMs;
          setThresholdReadout(Math.round(buf.thresholdHz));
          setWindowCountReadout(visibleWindows);
        }
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [bufferRef]);

  const srText = `Sortie du discriminateur : seuil de décision à ${thresholdReadout} Hz, ${windowCountReadout} fenêtres de bits visibles.`;

  return (
    <div className="nm-hud-card">
      <div className="nm-hud-card-header">
        <span className="nm-hud-card-title">Discriminateur & fenêtres bits</span>
        <span className="nm-hud-card-meta">{`Seuil : ${thresholdReadout} Hz`}</span>
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
