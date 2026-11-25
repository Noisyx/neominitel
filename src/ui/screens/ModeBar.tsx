import type { ReactElement } from 'react';

export type LineMode = 'Seul' | 'Ecoute' | 'Serveur' | 'Fichier';

interface ModeOption {
  id: LineMode;
  label: string;
  description: string;
}

export const LINE_MODE_OPTIONS: readonly ModeOption[] = [
  {
    id: 'Seul',
    label: 'Seul',
    description: 'Un seul appareil, ligne V.23 simulée',
  },
  {
    id: 'Ecoute',
    label: 'Écoute',
    description: 'Réception en direct par le microphone',
  },
  {
    id: 'Serveur',
    label: 'Serveur',
    description: 'Émission propre sur le haut-parleur',
  },
  {
    id: 'Fichier',
    label: 'Fichier',
    description: 'Décodage d’un enregistrement WAV',
  },
] as const;

export interface ModeBarProps {
  mode: LineMode;
  onSelectMode: (mode: LineMode) => void;
}

/**
 * Mode selector bar allowing live switching between `Seul`, `Écoute`, `Serveur` and `Fichier`
 * without reloading the page (Requirement 2.5).
 */
export function ModeBar({ mode, onSelectMode }: ModeBarProps): ReactElement {
  return (
    <nav className="nm-modebar" aria-label="Mode de ligne téléphonique">
      {LINE_MODE_OPTIONS.map((opt) => {
        const active = opt.id === mode;
        return (
          <button
            key={opt.id}
            type="button"
            className="nm-mode-btn"
            aria-pressed={active}
            title={opt.description}
            onClick={() => {
              if (opt.id !== mode) {
                onSelectMode(opt.id);
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </nav>
  );
}
