import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent, type ReactElement } from 'react';
import {
  LIBRE_GRID_COLS,
  LIBRE_GRID_ROWS,
  LIBRE_MAX_TEXT_LINES,
  applyImageCells,
  createBlankDraft,
  encodeDraft,
  encodeShareFragment,
  setBackground,
  setBlock,
  setTextLines,
  type LibreDraft,
  type LibreTextLine,
} from '../../services/libre-editor';
import { CHANNELS, FRAME } from '../../modem';
import { COLOUR_PALETTE_RGB, imageToMosaic } from '../../videotex';

/** French colour names, indexed by Videotex colour code. */
export const LIBRE_COLOUR_NAMES = ['Noir', 'Rouge', 'Vert', 'Jaune', 'Bleu', 'Magenta', 'Cyan', 'Blanc'] as const;

const BLOCK_PX = 4; // canvas pixels per block: 320 x 288
const CANVAS_W = LIBRE_GRID_COLS * 2 * BLOCK_PX;
const CANVAS_H = LIBRE_GRID_ROWS * 3 * BLOCK_PX;
const CHARS_PER_SECOND = CHANNELS.forward.baud / FRAME.bitsPerFrame;

export interface LibreEditorProps {
  /** Sends the page by sound through the normal transmit path. */
  onSend: (bytes: Uint8Array) => void;
  /** Asks the worker for a WAV export of the page. */
  onExportWav: (bytes: Uint8Array) => void;
  /** Base of the share link (default: the current page URL without its fragment). */
  shareBaseUrl?: string;
}

type Tool = 'pen' | 'eraser';

function rgb(c: number): string {
  const [r, g, b] = COLOUR_PALETTE_RGB[c] ?? [0, 0, 0];
  return `rgb(${r}, ${g}, ${b})`;
}

function drawDraft(ctx: CanvasRenderingContext2D, d: LibreDraft): void {
  const textRows = new Map(d.lines.map((l) => [l.row, l]));
  for (let r = 0; r < LIBRE_GRID_ROWS; r++) {
    const line = textRows.get(r + 1);
    const y0 = r * 3 * BLOCK_PX;
    if (line) {
      ctx.fillStyle = 'rgb(20, 20, 20)';
      ctx.fillRect(0, y0, CANVAS_W, 3 * BLOCK_PX);
      ctx.fillStyle = rgb(line.fg);
      ctx.font = `${3 * BLOCK_PX - 1}px ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      ctx.fillText(line.text, 1, y0 + 1, CANVAS_W - 2);
      continue;
    }
    for (let c = 0; c < LIBRE_GRID_COLS; c++) {
      const cell = d.cells[r][c];
      const x0 = c * 2 * BLOCK_PX;
      ctx.fillStyle = rgb(cell.bg);
      ctx.fillRect(x0, y0, 2 * BLOCK_PX, 3 * BLOCK_PX);
      ctx.fillStyle = rgb(cell.fg);
      for (let k = 0; k < 6; k++) {
        if (cell.blocks[k]) ctx.fillRect(x0 + (k % 2) * BLOCK_PX, y0 + Math.floor(k / 2) * BLOCK_PX, BLOCK_PX, BLOCK_PX);
      }
    }
  }
}

/**
 * 3615 LIBRE editor (neominitel-app task 16, requirement 11): a 80 x 72 block mosaic drawn with the
 * pointer or imported from an image, text lines that replace the drawing on their row, and three
 * ways out: by sound, as a WAV file, or as a link holding the bytes in the URL fragment.
 */
export function LibreEditor({ onSend, onExportWav, shareBaseUrl }: LibreEditorProps): ReactElement {
  const [draft, setDraft] = useState<LibreDraft>(() =>
    setTextLines(createBlankDraft(), [{ row: 1, text: ' MA PAGE 3615 LIBRE', fg: 6 }]),
  );
  const [lines, setLines] = useState<LibreTextLine[]>([{ row: 1, text: ' MA PAGE 3615 LIBRE', fg: 6 }]);
  const [pen, setPen] = useState(7);
  const [tool, setTool] = useState<Tool>('pen');
  const [diffusion, setDiffusion] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const bytes = useMemo(() => encodeDraft(draft), [draft]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawDraft(ctx, draft);
  }, [draft]);

  function paintAt(e: PointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const bx = Math.floor(((e.clientX - rect.left) / rect.width) * LIBRE_GRID_COLS * 2);
    const by = Math.floor(((e.clientY - rect.top) / rect.height) * LIBRE_GRID_ROWS * 3);
    setDraft((d) => setBlock(d, bx, by, tool === 'pen', pen));
  }

  function updateLine(i: number, patch: Partial<LibreTextLine>): void {
    const next = lines.map((l, k) => (k === i ? { ...l, ...patch } : l));
    setLines(next);
    setDraft((d) => setTextLines(d, next));
  }

  function addLine(): void {
    if (lines.length >= LIBRE_MAX_TEXT_LINES) return;
    const used = new Set(lines.map((l) => l.row));
    let row = 24;
    while (row > 1 && used.has(row)) row--;
    setLines([...lines, { row, text: '', fg: 7 }]);
  }

  function removeLine(i: number): void {
    const next = lines.filter((_, k) => k !== i);
    setLines(next);
    setDraft((d) => setTextLines(d, next));
  }

  async function importImage(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(bitmap, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const res = imageToMosaic({ width: w, height: h, data: data.data, channels: 4 }, LIBRE_GRID_COLS, LIBRE_GRID_ROWS, { diffusion });
      if (!res.ok) throw new Error(res.error.reason);
      setDraft((d) => applyImageCells(d, res.value.cells));
      setNotice('Image convertie en mosaïque : 2 couleurs par case, meilleur choix sur 36.');
    } catch {
      setNotice('Impossible de lire cette image.');
    }
  }

  function share(): void {
    if (!bytes) return;
    const base = shareBaseUrl ?? (typeof window !== 'undefined' ? window.location.href.split('#')[0] : '');
    const url = `${base}#${encodeShareFragment(bytes)}`;
    setShareUrl(url);
    void navigator.clipboard?.writeText(url).then(
      () => setNotice('Lien copié : la page voyage dans l’adresse, sans serveur.'),
      () => setNotice('Copiez le lien ci-dessous.'),
    );
  }

  const seconds = bytes ? bytes.length / CHARS_PER_SECOND : 0;

  return (
    <section className="nm-libre" aria-label="Atelier 3615 LIBRE">
      <div className="nm-libre-head">
        <h2 className="nm-hud-title">3615 LIBRE · Atelier de page</h2>
        <span className="nm-hud-card-meta">
          {bytes ? `${bytes.length} octets · ${seconds.toFixed(1)} s à ${CHANNELS.forward.baud} bauds` : 'Page invalide'}
        </span>
      </div>

      <div className="nm-libre-body">
        <canvas
          ref={canvasRef}
          className="nm-libre-canvas"
          width={CANVAS_W}
          height={CANVAS_H}
          role="img"
          aria-label="Grille mosaïque 80 × 72 blocs : cliquez ou glissez pour dessiner"
          onPointerDown={(e) => {
            drawingRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            paintAt(e);
          }}
          onPointerMove={(e) => {
            if (drawingRef.current) paintAt(e);
          }}
          onPointerUp={() => {
            drawingRef.current = false;
          }}
          onPointerLeave={() => {
            drawingRef.current = false;
          }}
        />

        <div className="nm-libre-tools">
          <div role="group" aria-label="Outil de dessin" className="nm-libre-row">
            <button type="button" className="nm-btn" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>
              Crayon
            </button>
            <button type="button" className="nm-btn" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>
              Gomme
            </button>
            <label>
              Couleur{' '}
              <select value={pen} onChange={(e) => setPen(Number(e.target.value))}>
                {LIBRE_COLOUR_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="nm-btn" onClick={() => setDraft((d) => setBackground(d, pen))}>
              Fond de cette couleur
            </button>
            <button type="button" className="nm-btn" onClick={() => setDraft((d) => setTextLines(createBlankDraft(), d.lines))}>
              Effacer le dessin
            </button>
          </div>

          <div className="nm-libre-row">
            <label className="nm-btn">
              Importer une image
              <input type="file" accept="image/*" className="nm-sr-only" onChange={(e) => void importImage(e)} />
            </label>
            <label>
              <input type="checkbox" checked={diffusion} onChange={(e) => setDiffusion(e.target.checked)} /> Diffusion d’erreur
            </label>
          </div>

          <fieldset className="nm-libre-lines">
            <legend>Lignes de texte (elles remplacent le dessin sur leur rangée)</legend>
            {lines.map((l, i) => (
              <div key={i} className="nm-libre-row">
                <label>
                  Rangée{' '}
                  <input
                    type="number"
                    min={1}
                    max={LIBRE_GRID_ROWS}
                    value={l.row}
                    onChange={(e) => updateLine(i, { row: Number(e.target.value) })}
                  />
                </label>
                <input
                  type="text"
                  maxLength={LIBRE_GRID_COLS}
                  value={l.text}
                  aria-label={`Texte de la ligne ${i + 1}`}
                  onChange={(e) => updateLine(i, { text: e.target.value })}
                />
                <select value={l.fg} aria-label={`Couleur de la ligne ${i + 1}`} onChange={(e) => updateLine(i, { fg: Number(e.target.value) })}>
                  {LIBRE_COLOUR_NAMES.map((n, k) => (
                    <option key={n} value={k}>
                      {n}
                    </option>
                  ))}
                </select>
                <button type="button" className="nm-btn" onClick={() => removeLine(i)}>
                  Retirer
                </button>
              </div>
            ))}
            {lines.length < LIBRE_MAX_TEXT_LINES && (
              <button type="button" className="nm-btn" onClick={addLine}>
                Ajouter une ligne
              </button>
            )}
          </fieldset>

          <div className="nm-libre-row" role="group" aria-label="Envoyer la page">
            <button type="button" className="nm-btn" disabled={!bytes} onClick={() => bytes && onSend(bytes)}>
              Envoyer par le son
            </button>
            <button type="button" className="nm-btn" disabled={!bytes} onClick={() => bytes && onExportWav(bytes)}>
              Exporter en WAV
            </button>
            <button type="button" className="nm-btn" disabled={!bytes} onClick={share}>
              Copier le lien de partage
            </button>
          </div>
          {shareUrl && <input type="text" readOnly className="nm-libre-link" value={shareUrl} aria-label="Lien de partage" />}
          {notice && (
            <p className="nm-vote-note" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
