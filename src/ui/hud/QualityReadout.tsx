import type { ReactElement } from 'react';
import type { QualityEvent } from '../../modem';

export interface QualityReadoutProps {
  quality?: QualityEvent;
  cps: number;
  parityErrors: number;
  framingErrors: number;
}

function formatDb(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return '—';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? '> 40 dB' : '< -10 dB';
  }
  return `${value.toFixed(1)} dB`;
}

function formatSignedHz(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '0 Hz';
  }
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded} Hz` : `${rounded} Hz`;
}

/**
 * Numeric readout of M2M4 SNR, Eb/N0, carrier frequency offset, characters/s, and UART errors
 * (Requirements 8.1 & 8.4).
 */
export function QualityReadout({
  quality,
  cps,
  parityErrors,
  framingErrors,
}: QualityReadoutProps): ReactElement {
  return (
    <div className="nm-hud-stats" role="region" aria-label="Mesures de qualité du signal">
      <div className="nm-stat-cell">
        <span className="nm-stat-label">SNR (3 kHz)</span>
        <span className="nm-stat-value">{formatDb(quality?.snr3kDb)}</span>
      </div>
      <div className="nm-stat-cell">
        <span className="nm-stat-label">Eb/N0 reçu</span>
        <span className="nm-stat-value">{formatDb(quality?.ebN0Db)}</span>
      </div>
      <div className="nm-stat-cell">
        <span className="nm-stat-label">Décalage fréq.</span>
        <span className="nm-stat-value">{formatSignedHz(quality?.offsetHz)}</span>
      </div>
      <div className="nm-stat-cell">
        <span className="nm-stat-label">Débit reçu</span>
        <span className="nm-stat-value">{`${cps.toFixed(0)} car/s`}</span>
      </div>
      <div className="nm-stat-cell">
        <span className="nm-stat-label">Err. parité</span>
        <span
          className="nm-stat-value"
          data-error={parityErrors > 0 ? 'true' : 'false'}
        >
          {parityErrors}
        </span>
      </div>
      <div className="nm-stat-cell">
        <span className="nm-stat-label">Err. cadrage</span>
        <span
          className="nm-stat-value"
          data-error={framingErrors > 0 ? 'true' : 'false'}
        >
          {framingErrors}
        </span>
      </div>
    </div>
  );
}
