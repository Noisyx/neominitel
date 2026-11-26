import type { ReactElement } from 'react';
import type { VoteProgressionReport } from './voteMetrics';

export interface VoteCerPanelProps {
  progression: VoteProgressionReport | null;
  canAutoRepeat: boolean;
  autoRepeating: boolean;
  onRunSevenReceptions?: () => void;
}

function formatPct(rate: number | null): string {
  if (rate === null) return '—';
  if (rate === 0) return '0,00 %';
  if (rate < 0.0001) return '< 0,01 %';
  return `${(rate * 100).toFixed(2).replace('.', ',')} %`;
}

/**
 * Displays measured cell error rate (CER) after 1, 3, 5 and 7 receptions side by side with
 * the erasure (`p^N`) and plain-majority (`sum C(N,k) q^k (1-q)^(N-k)`) formulas from
 * `videotex/design.md` (Requirement 6.4 & 8.4).
 */
export function VoteCerPanel({
  progression,
  canAutoRepeat,
  autoRepeating,
  onRunSevenReceptions,
}: VoteCerPanelProps): ReactElement {
  const srSummary = progression
    ? `Comparaison Vote 1/3/5/7 (${progression.totalReceptions} réception(s)) : taux d'effacement mesuré p = ${formatPct(progression.measuredErasureRate)}, erreurs non détectées q = ${formatPct(progression.measuredUndetectedRate)}. ` +
      progression.rows
        .map(
          (r) =>
            `N=${r.receptions} : mesuré ${formatPct(r.measuredCer)}, formule p^N ${formatPct(r.erasureFormulaCer)}, majorité ${formatPct(r.majorityFormulaCer)}.`,
        )
        .join(' ')
    : 'Comparaison théorique du vote majoritaire sur 1, 3, 5 et 7 réceptions : en attente de réceptions.';

  return (
    <div
      className="nm-hud-card nm-vote-cer-card"
      role="region"
      aria-label="Taux d'erreur cellule sur 1, 3, 5 et 7 réceptions face aux formules"
    >
      <div className="nm-hud-card-header">
        <span className="nm-hud-card-title">Vote 1 / 3 / 5 / 7 vs formules</span>
        {canAutoRepeat && onRunSevenReceptions && (
          <button
            type="button"
            className="nm-hud-mini-btn"
            disabled={autoRepeating}
            onClick={onRunSevenReceptions}
          >
            {autoRepeating ? 'Série en cours…' : 'Mesurer 7 reçus'}
          </button>
        )}
      </div>

      {progression ? (
        <>
          <div className="nm-vote-rates">
            <span>{`Effacements p = ${formatPct(progression.measuredErasureRate)}`}</span>
            <span>{`Non détectées q = ${formatPct(progression.measuredUndetectedRate)}`}</span>
          </div>

          <table className="nm-cer-table">
            <thead>
              <tr>
                <th scope="col">N</th>
                <th scope="col">CER mesuré</th>
                <th scope="col">{'Effac. p^N'}</th>
                <th scope="col">Majorité q</th>
              </tr>
            </thead>
            <tbody>
              {progression.rows.map((row) => (
                <tr key={row.receptions}>
                  <td>{row.receptions}</td>
                  <td data-ready={row.measuredCer !== null ? 'true' : 'false'}>
                    {formatPct(row.measuredCer)}
                  </td>
                  <td>{formatPct(row.erasureFormulaCer)}</td>
                  <td>{formatPct(row.majorityFormulaCer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="nm-vote-note">
            {'Parité 7E1 : 1 bit détecte toute erreur simple ; P(non détectée) ≈ C(8,2)·ε² = 28·ε².'}
          </p>
        </>
      ) : (
        <p className="nm-vote-note">
          Cumulez plusieurs réceptions en mode Seul (avec bruit Eb/N0) pour comparer le taux mesuré aux formules p^N et majorité.
        </p>
      )}

      <p className="nm-sr-only">{srSummary}</p>
    </div>
  );
}
