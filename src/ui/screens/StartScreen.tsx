import { useEffect, useRef, type ReactElement } from 'react';
import { CHANNELS } from '../../modem';

export interface StartScreenProps {
  onConnect: () => void;
}

/**
 * Zero-friction entry screen seated over the CRT viewport (Requirement 1.1).
 * Invites the user to press *Connexion* with the historical 30 June 2012 switch-off line.
 */
export function StartScreen({ onConnect }: StartScreenProps): ReactElement {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div className="nm-start-overlay" role="region" aria-label="Écran d'accueil NeoMinitel">
      <p className="nm-start-memorial">
        30 juin 2012 : la France débranche le Minitel.
      </p>
      <p className="nm-start-caption">
        Ici, chaque page voyage à nouveau par le son d&apos;un vrai modem V.23 à {CHANNELS.forward.baud} bauds.
      </p>
      <div className="nm-start-actions">
        <button
          ref={buttonRef}
          type="button"
          className="nm-btn nm-btn-connexion"
          onClick={onConnect}
        >
          Connexion
        </button>
        <span className="nm-kbd-hint">Touche Entrée ou Fin</span>
      </div>
    </div>
  );
}
