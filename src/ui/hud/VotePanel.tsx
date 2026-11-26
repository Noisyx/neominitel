import type { ReactElement } from 'react';

export interface ActiveVoteSummary {
  pageId: string;
  receptions: number;
  unresolved: number;
  lastReceptionErrors: number;
}

export interface VotePanelProps {
  voteOn: boolean;
  summary: ActiveVoteSummary | null;
}

/**
 * Displays per-page majority vote reception count and remaining unresolved cells (Req 7.3).
 */
export function VotePanel({ voteOn, summary }: VotePanelProps): ReactElement {
  return (
    <div className="nm-hud-card nm-vote-panel" role="region" aria-label="État du vote majoritaire">
      <div className="nm-hud-card-header">
        <span className="nm-hud-card-title">Réparation par vote</span>
        <span className="nm-hud-card-meta">
          {voteOn ? 'Actif' : 'Désactivé'}
        </span>
      </div>

      {summary ? (
        <div className="nm-vote-metrics">
          <div className="nm-vote-row">
            <span>Réceptions cumulées</span>
            <strong>{summary.receptions}</strong>
          </div>
          <div className="nm-vote-row">
            <span>Cases non résolues</span>
            <strong data-error={summary.unresolved > 0 ? 'true' : 'false'}>
              {summary.unresolved}
            </strong>
          </div>
          {summary.receptions >= 2 &&
            summary.lastReceptionErrors > summary.unresolved && (
              <p className="nm-vote-note">
                {`${summary.lastReceptionErrors - summary.unresolved} case(s) réparée(s) grâce aux réceptions multiples.`}
              </p>
            )}
        </div>
      ) : (
        <p className="nm-vote-note">
          Appuyez sur Répétition (Alt+R) après une page bruitée pour combiner plusieurs écoutes.
        </p>
      )}
    </div>
  );
}
