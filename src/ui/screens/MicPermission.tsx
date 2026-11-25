import type { ReactElement } from 'react';

export type MicState = 'off' | 'asking' | 'on' | 'denied';

export interface MicPermissionProps {
  micState: Exclude<MicState, 'on'>;
  errorMessage?: string;
  onRequestMic: () => void;
  onFallbackSeul: () => void;
}

/**
 * Microphone onboarding and permission-recovery overlay for `Écoute` mode (Requirement 10.1).
 */
export function MicPermission({
  micState,
  errorMessage,
  onRequestMic,
  onFallbackSeul,
}: MicPermissionProps): ReactElement {
  if (micState === 'asking') {
    return (
      <div className="nm-start-overlay" role="status" aria-live="polite">
        <p className="nm-start-memorial">Autorisation du microphone en attente</p>
        <p className="nm-start-caption">
          Acceptez la demande du navigateur pour écouter les tonalités V.23 en direct.
          Aucun son ne quitte votre appareil.
        </p>
      </div>
    );
  }

  if (micState === 'denied') {
    return (
      <div
        className="nm-start-overlay"
        role="alert"
        aria-label="Accès au microphone refusé"
      >
        <p className="nm-start-memorial">
          {errorMessage ?? 'Accès au microphone refusé'}
        </p>
        <p className="nm-start-caption">
          Pour activer l&apos;écoute acoustique : cliquez sur l&apos;icône de cadenas ou de
          microphone dans la barre d&apos;adresse (Chrome, Safari ou Firefox), autorisez le
          microphone pour ce site (servi en HTTPS ou localhost), puis réessayez.
        </p>
        <div className="nm-permission-actions">
          <button
            type="button"
            className="nm-btn nm-btn-connexion"
            onClick={onFallbackSeul}
          >
            Passer en mode Seul
          </button>
          <button
            type="button"
            className="nm-btn"
            onClick={onRequestMic}
          >
            Réessayer le microphone
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="nm-start-overlay"
      role="region"
      aria-label="Activation du mode Écoute"
    >
      <p className="nm-start-memorial">Mode Écoute acoustique (1200 bauds)</p>
      <p className="nm-start-caption">
        Ce terminal écoute le microphone brut et décode en direct les pages jouées par un
        autre appareil en mode Serveur.
      </p>
      <div className="nm-permission-actions">
        <button
          type="button"
          className="nm-btn nm-btn-connexion"
          onClick={onRequestMic}
        >
          Activer le microphone
        </button>
        <button
          type="button"
          className="nm-btn"
          onClick={onFallbackSeul}
        >
          Mode Seul
        </button>
      </div>
    </div>
  );
}
