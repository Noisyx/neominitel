import type { ReactElement } from 'react';
import { DEFAULT_SIM_PARAMS, type SimParams } from '../../workers/protocol';

export interface SimControlsProps {
  sim: SimParams;
  canReplay: boolean;
  onChangeSim: (next: SimParams) => void;
  onReplaySeeded: () => void;
}

const DEFAULT_NOISE_DB = 14;

function formatSigned(val: number, unit: string, decimals = 0): string {
  const fixed = val.toFixed(decimals);
  return val > 0 ? `+${fixed} ${unit}` : `${fixed} ${unit}`;
}

/**
 * Interactive line simulator controls for `Seul` mode: Eb/N0 (0..30 dB + "Propre"),
 * carrier frequency offset (-500..+500 Hz), bit-clock offset (-3%..+3%), 50 Hz mains hum,
 * Poisson noise bursts, and deterministic RNG seed replay (Requirements 3.1–3.3).
 */
export function SimControls({
  sim,
  canReplay,
  onChangeSim,
  onReplaySeeded,
}: SimControlsProps): ReactElement {
  const isCleanNoise = sim.ebN0Db === null;
  const sliderEbN0 = sim.ebN0Db ?? DEFAULT_NOISE_DB;

  const handleResetClean = (): void => {
    onChangeSim({
      ...DEFAULT_SIM_PARAMS,
      seed: sim.seed,
    });
  };

  const handleToggleNoiseClean = (): void => {
    onChangeSim({
      ...sim,
      ebN0Db: isCleanNoise ? DEFAULT_NOISE_DB : null,
    });
  };

  return (
    <section
      className="nm-sim-panel"
      aria-label="Simulateur de ligne téléphonique"
    >
      <div className="nm-sim-header">
        <span className="nm-sim-title">Simulateur de ligne (mode Seul)</span>
        <div className="nm-sim-actions">
          <button
            type="button"
            className="nm-hud-mini-btn"
            onClick={handleResetClean}
          >
            Ligne propre
          </button>
          <button
            type="button"
            className="nm-hud-mini-btn"
            disabled={!canReplay}
            onClick={onReplaySeeded}
          >
            Rejouer la graine
          </button>
        </div>
      </div>

      <div className="nm-sim-sliders">
        {/* Eb/N0: 0..30 dB + clean */}
        <div className="nm-sim-row">
          <div className="nm-sim-row-top">
            <label htmlFor="nm-sim-ebn0" className="nm-sim-label">
              Rapport Eb/N0
            </label>
            <div className="nm-sim-readout-group">
              <span className="nm-sim-value">
                {isCleanNoise ? 'Propre (sans bruit)' : `${sim.ebN0Db?.toFixed(1)} dB`}
              </span>
              <button
                type="button"
                className="nm-hud-mini-btn"
                aria-pressed={!isCleanNoise}
                onClick={handleToggleNoiseClean}
              >
                {isCleanNoise ? 'Activer bruit' : 'Propre'}
              </button>
            </div>
          </div>
          <input
            id="nm-sim-ebn0"
            type="range"
            className="nm-sim-range"
            min={0}
            max={30}
            step={0.5}
            value={sliderEbN0}
            aria-valuetext={
              isCleanNoise ? 'Ligne propre' : `${sliderEbN0.toFixed(1)} dB`
            }
            onChange={(e) =>
              onChangeSim({
                ...sim,
                ebN0Db: Number(e.target.value),
              })
            }
          />
        </div>

        {/* Frequency offset: -500..+500 Hz */}
        <div className="nm-sim-row">
          <div className="nm-sim-row-top">
            <label htmlFor="nm-sim-offset" className="nm-sim-label">
              Décalage de fréquence
            </label>
            <div className="nm-sim-readout-group">
              <span className="nm-sim-value">
                {formatSigned(sim.offsetHz, 'Hz', 0)}
              </span>
              {sim.offsetHz !== 0 && (
                <button
                  type="button"
                  className="nm-hud-mini-btn"
                  onClick={() => onChangeSim({ ...sim, offsetHz: 0 })}
                >
                  0 Hz
                </button>
              )}
            </div>
          </div>
          <input
            id="nm-sim-offset"
            type="range"
            className="nm-sim-range"
            min={-500}
            max={500}
            step={10}
            value={sim.offsetHz}
            onChange={(e) =>
              onChangeSim({
                ...sim,
                offsetHz: Number(e.target.value),
              })
            }
          />
        </div>

        {/* Clock offset: -3%..+3% */}
        <div className="nm-sim-row">
          <div className="nm-sim-row-top">
            <label htmlFor="nm-sim-clock" className="nm-sim-label">
              Décalage d&apos;horloge
            </label>
            <div className="nm-sim-readout-group">
              <span className="nm-sim-value">
                {formatSigned(sim.clockPct, '%', 1)}
              </span>
              {sim.clockPct !== 0 && (
                <button
                  type="button"
                  className="nm-hud-mini-btn"
                  onClick={() => onChangeSim({ ...sim, clockPct: 0 })}
                >
                  0 %
                </button>
              )}
            </div>
          </div>
          <input
            id="nm-sim-clock"
            type="range"
            className="nm-sim-range"
            min={-3}
            max={3}
            step={0.1}
            value={sim.clockPct}
            onChange={(e) =>
              onChangeSim({
                ...sim,
                clockPct: Number(e.target.value),
              })
            }
          />
        </div>
      </div>

      <div className="nm-sim-footer">
        <div className="nm-sim-toggles" role="group" aria-label="Perturbations additionnelles">
          <button
            type="button"
            className="nm-btn nm-sim-chip"
            aria-pressed={sim.hum}
            onClick={() => onChangeSim({ ...sim, hum: !sim.hum })}
          >
            Ronflette 50 Hz
          </button>
          <button
            type="button"
            className="nm-btn nm-sim-chip"
            aria-pressed={sim.bursts}
            onClick={() => onChangeSim({ ...sim, bursts: !sim.bursts })}
          >
            Salves parasites
          </button>
        </div>

        <label className="nm-sim-seed">
          <span>Graine :</span>
          <input
            type="number"
            className="nm-sim-seed-input"
            aria-label="Graine aléatoire du simulateur"
            value={sim.seed}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              onChangeSim({
                ...sim,
                seed: Number.isFinite(parsed) ? parsed >>> 0 : 0,
              });
            }}
          />
        </label>
      </div>
    </section>
  );
}
