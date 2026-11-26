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
    <div className="nm-vote-strip" role="region" aria-label="État du vote majoritaire">
      <div className="nm-vote-strip-main">
        <span className="nm-hud-card-title">Réparation par vote</span>
        {summary ? (
          <div className="nm-vote-inline-stats">
            <span className="nm-vote-stat-item">
              Réceptions <strong>{summary.receptions}</strong>
            </span>
            <span className="nm-vote-stat-item">
              Non résolues{' '}
              <strong data-error={summary.unresolved > 0 ? 'true' : 'false'}>
                {summary.unresolved}
              </strong>
            </span>
            {summary.receptions >= 2 &&
              summary.lastReceptionErrors > summary.unresolved && (
                <span className="nm-vote-repaired">
                  {`${summary.lastReceptionErrors - summary.unresolved} case(s) réparée(s)`}
                </span>
              )}
          </div>
        ) : (
          <span className="nm-vote-note">
            {voteOn
              ? 'Touche Répétition (Alt+R) pour combiner plusieurs écoutes'
              : 'Vote majoritaire désactivé'}
          </span>
        )}
      </div>
    </div>
  );
}
