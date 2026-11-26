import type { MutableRefObject, ReactElement } from 'react';
import type { QualityEvent } from '../../modem';
import { BerChart, type BerPoint } from './BerChart';
import { DiscriminatorTrace } from './DiscriminatorTrace';
import { EyeDiagram } from './EyeDiagram';
import type { HudSignalBuffer } from './hudStore';
import { QualityReadout } from './QualityReadout';
import { VoteCerPanel } from './VoteCerPanel';
import type { VoteProgressionReport } from './voteMetrics';
import { VotePanel, type ActiveVoteSummary } from './VotePanel';
import { Waterfall } from './Waterfall';

export interface MathHudProps {
  visible: boolean;
  onToggleVisible: () => void;
  thresholdMode: 'fixed' | 'adaptive';
  onToggleThreshold: () => void;
  voteOn: boolean;
  onToggleVote: () => void;
  bufferRef: MutableRefObject<HudSignalBuffer>;
  quality?: QualityEvent;
  cps: number;
  parityErrors: number;
  framingErrors: number;
  voteSummary: ActiveVoteSummary | null;
  berPoints?: readonly BerPoint[];
  onClearBerPoints?: () => void;
  showBerChart?: boolean;
  voteProgression?: VoteProgressionReport | null;
  showVoteCerPanel?: boolean;
  canAutoRepeatVote?: boolean;
  autoRepeatingVote?: boolean;
  onRunSevenReceptions?: () => void;
}

/**
 * Side panel displaying live V.23 DSP internals, 3615 MATHS BER & Vote panels,
 * and controls for adaptive tuning & majority vote (Requirements 6.2–6.4 & 8.1–8.4).
 */
export function MathHud({
  visible,
  onToggleVisible,
  thresholdMode,
  onToggleThreshold,
  voteOn,
  onToggleVote,
  bufferRef,
  quality,
  cps,
  parityErrors,
  framingErrors,
  voteSummary,
  berPoints = [],
  onClearBerPoints,
  showBerChart = false,
  voteProgression = null,
  showVoteCerPanel = false,
  canAutoRepeatVote = false,
  autoRepeatingVote = false,
  onRunSevenReceptions,
}: MathHudProps): ReactElement {
  if (!visible) {
    return (
      <aside className="nm-hud-collapsed" aria-label="Tableau de bord mathématique replié">
        <button
          type="button"
          className="nm-btn"
          onClick={onToggleVisible}
        >
          Afficher le HUD mathématique
        </button>
      </aside>
    );
  }

  return (
    <aside className="nm-hud" aria-label="Tableau de bord mathématique du modem V.23">
      <div className="nm-hud-header">
        <h2 className="nm-hud-title">Math HUD · Signal V.23</h2>
        <button
          type="button"
          className="nm-btn"
          onClick={onToggleVisible}
        >
          Masquer
        </button>
      </div>

      <div className="nm-hud-toggles" role="group" aria-label="Traitements du récepteur">
        <button
          type="button"
          className="nm-btn nm-hud-toggle"
          aria-pressed={thresholdMode === 'adaptive'}
          onClick={onToggleThreshold}
        >
          <span>Accord automatique</span>
          <span className="nm-toggle-state">
            {thresholdMode === 'adaptive' ? 'Activé' : 'Fixe'}
          </span>
        </button>

        <button
          type="button"
          className="nm-btn nm-hud-toggle"
          aria-pressed={voteOn}
          onClick={onToggleVote}
        >
          <span>Vote</span>
          <span className="nm-toggle-state">
            {voteOn ? 'Activé' : 'Arrêt'}
          </span>
        </button>
      </div>

      <QualityReadout
        quality={quality}
        cps={cps}
        parityErrors={parityErrors}
        framingErrors={framingErrors}
      />

      {(showBerChart || berPoints.length > 0) && (
        <BerChart points={berPoints} onClearPoints={onClearBerPoints} />
      )}

      <VotePanel voteOn={voteOn} summary={voteSummary} />

      {showVoteCerPanel && (
        <VoteCerPanel
          progression={voteProgression}
          canAutoRepeat={canAutoRepeatVote}
          autoRepeating={autoRepeatingVote}
          onRunSevenReceptions={onRunSevenReceptions}
        />
      )}

      <Waterfall bufferRef={bufferRef} />
      <DiscriminatorTrace bufferRef={bufferRef} />
      <EyeDiagram bufferRef={bufferRef} />
    </aside>
  );
}
