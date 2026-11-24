import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  blitCellToRgba,
  cellsEqual,
  isFlashVisible,
  renderScreenToRgba,
  rowToText,
  SCREEN_COLS,
  SCREEN_HEIGHT_PX,
  SCREEN_ROWS,
  SCREEN_WIDTH_PX,
  type PaletteMode,
  type Screen,
} from '../../videotex';

export interface ScreenCanvasProps {
  screen: Screen;
  palette?: PaletteMode;
  crt?: boolean;
  /** Optional accessible summary announced via aria-live when complete. */
  ariaSummary?: string;
}

/**
 * Extracts non-empty lines from a `Screen` as a concise plain-text summary for screen readers (Req 9.4).
 */
export function summarizeScreenForAria(screen: Screen): string {
  const lines: string[] = [];
  for (let r = 0; r < SCREEN_ROWS; r++) {
    const trimmed = rowToText(screen, r).replace(/\s+/g, ' ').trim();
    if (trimmed.length > 0) {
      lines.push(trimmed);
    }
  }
  return lines.join(' — ');
}

function screenHasFlashingCells(screen: Screen): boolean {
  for (let r = 0; r < SCREEN_ROWS; r++) {
    for (let c = 0; c < SCREEN_COLS; c++) {
      if (screen.rows[r][c].flash) {
        return true;
      }
    }
  }
  return false;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Renders the 40x25 Videotex `Screen` onto a pixel-exact 320x250 `<canvas>` scaled crisply,
 * updating only changed cells between frames when palette and flash phase stay constant.
 */
export function ScreenCanvas({
  screen,
  palette = 'couleur',
  crt = true,
  ariaSummary,
}: ScreenCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rgbaRef = useRef<Uint8ClampedArray | null>(null);
  const prevScreenRef = useRef<Screen | null>(null);
  const prevPaletteRef = useRef<PaletteMode | null>(null);
  const prevFlashVisRef = useRef<boolean | null>(null);

  const reducedMotion = usePrefersReducedMotion();
  const hasFlash = useMemo(() => screenHasFlashingCells(screen), [screen]);
  const [flashVisible, setFlashVisible] = useState<boolean>(true);

  useEffect(() => {
    if (!hasFlash || reducedMotion) {
      setFlashVisible(true);
      return;
    }
    const update = (): void => {
      setFlashVisible(isFlashVisible(performance.now(), false));
    };
    update();
    const timer = window.setInterval(update, 80);
    return () => window.clearInterval(timer);
  }, [hasFlash, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!rgbaRef.current) {
      rgbaRef.current = new Uint8ClampedArray(SCREEN_WIDTH_PX * SCREEN_HEIGHT_PX * 4);
    }
    const rgba = rgbaRef.current;
    const prevScreen = prevScreenRef.current;
    const fullRedrawNeeded =
      prevScreen === null ||
      prevPaletteRef.current !== palette ||
      prevFlashVisRef.current !== flashVisible;

    if (fullRedrawNeeded) {
      renderScreenToRgba(screen, {
        palette,
        flashVisible,
        target: rgba,
      });
    } else {
      // Incremental dirty-cell update
      for (let r = 0; r < SCREEN_ROWS; r++) {
        for (let c = 0; c < SCREEN_COLS; c++) {
          const prevCursorHere =
            prevScreen.cursor.visible &&
            prevScreen.cursor.row === r &&
            prevScreen.cursor.col === c;
          const nextCursorHere =
            screen.cursor.visible &&
            screen.cursor.row === r &&
            screen.cursor.col === c;
          if (
            prevCursorHere !== nextCursorHere ||
            !cellsEqual(prevScreen.rows[r][c], screen.rows[r][c])
          ) {
            blitCellToRgba(rgba, r, c, screen.rows[r][c], {
              palette,
              flashVisible,
              cursorHere: nextCursorHere,
            });
          }
        }
      }
    }

    const imageData = new ImageData(
      new Uint8ClampedArray(rgba),
      SCREEN_WIDTH_PX,
      SCREEN_HEIGHT_PX,
    );
    ctx.putImageData(imageData, 0, 0);

    prevScreenRef.current = screen;
    prevPaletteRef.current = palette;
    prevFlashVisRef.current = flashVisible;
  }, [screen, palette, flashVisible]);

  const computedSummary = useMemo(
    () => ariaSummary ?? summarizeScreenForAria(screen),
    [ariaSummary, screen],
  );

  return (
    <div className="nm-crt-viewport">
      <canvas
        ref={canvasRef}
        className="nm-screen-canvas"
        width={SCREEN_WIDTH_PX}
        height={SCREEN_HEIGHT_PX}
        role="img"
        aria-label="Écran Vidéotex 40 par 25 caractères"
      />
      {crt && !reducedMotion && <div className="nm-crt-overlay" aria-hidden="true" />}
      <div className="nm-sr-only" aria-live="polite" aria-atomic="true">
        {computedSummary}
      </div>
    </div>
  );
}
