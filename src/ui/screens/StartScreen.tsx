import { useEffect, useRef, type ReactElement } from 'react';
import type { LineMode } from './ModeBar';

export interface StartScreenProps {
  mode?: Extract<LineMode, 'Seul' | 'Serveur'>;
  onConnect: () => void;
}

/**
 * Zero-friction entry screen seated over the CRT viewport (Requirement 1.1 & 2.3).
 * Invites the user to press *Connexion* with the historical 30 June 2012 switch-off line.
 */
export function StartScreen({
  mode = 'Seul',
  onConnect,
}: StartScreenProps): ReactElement {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, [mode]);

  const isServer = mode === 'Serveur';

  return (
    <div className="nm-start-overlay" role="region" aria-label="Écran d'accueil NeoMinitel">
      <p className="nm-start-memorial">
        30 juin 2012 : la France débranche le Minitel.
      </p>
      <p className="nm-start-caption">
        {isServer
          ? 'Mode Serveur : cet appareil diffuse un signal V.23 pur sur son haut-parleur pour un terminal voisin placé en mode Écoute.'
          : 'Ici, chaque page voyage à nouveau par le son d’un vrai modem V.23 à 1200 bauds.'}
      </p>
      <div className="nm-start-actions">
        <button
          ref={buttonRef}
          type="button"
          className="nm-btn nm-btn-connexion"
          onClick={onConnect}
        >
          {isServer ? 'Connexion (Diffuser)' : 'Connexion'}
        </button>
        <span className="nm-kbd-hint">Touche Entrée ou Fin</span>
      </div>
    </div>
  );
}
