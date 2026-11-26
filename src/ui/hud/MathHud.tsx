import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
} from 'react';
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

export type HudBenchTab = 'signal' | 'sim' | 'maths';

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
  simSlot?: ReactNode;
}

/**
 * Side instrument rack displaying live V.23 DSP oscilloscopes, docked line simulator,
 * 3615 MATHS BER & Vote panels, and receiver toggles without vertical page overflow
 * (Requirements 6.2–6.4 & 8.1–8.4).
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
  simSlot,
}: MathHudProps): ReactElement {
  const hasMathsPanels =
    showBerChart || berPoints.length > 0 || showVoteCerPanel;
  const hasSimTab = Boolean(simSlot);
  const [activeTab, setActiveTab] = useState<HudBenchTab>(
    showBerChart ? 'maths' : 'signal',
  );
  const prevShowBerChartRef = useRef(showBerChart);

  // Jump to the BER tab only when 3615 MATHS opens (false -> true), so the user
  // can still pick another tab afterwards. Unavailable tabs fall back to 'signal'
  // through `resolvedTab` below.
  useEffect(() => {
    if (showBerChart && !prevShowBerChartRef.current) {
      setActiveTab('maths');
    }
    prevShowBerChartRef.current = showBerChart;
  }, [showBerChart]);

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

  const resolvedTab: HudBenchTab =
    activeTab === 'maths' && hasMathsPanels
      ? 'maths'
      : activeTab === 'sim' && hasSimTab
        ? 'sim'
        : 'signal';

  return (
    <aside className="nm-hud" aria-label="Tableau de bord mathématique du modem V.23">
      <div className="nm-hud-header">
        <div className="nm-hud-header-left">
          <h2 className="nm-hud-title">Sous le capot · Signal V.23</h2>
          {(hasSimTab || hasMathsPanels) && (
            <div className="nm-hud-tabs" role="tablist" aria-label="Vues du laboratoire">
              <button
                type="button"
                role="tab"
                aria-selected={resolvedTab === 'signal'}
                className="nm-hud-tab"
                onClick={() => setActiveTab('signal')}
              >
                Signal
              </button>
              {hasSimTab && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={resolvedTab === 'sim'}
                  className="nm-hud-tab"
                  onClick={() => setActiveTab('sim')}
                >
                  Perturber la ligne
                </button>
              )}
              {hasMathsPanels && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={resolvedTab === 'maths'}
                  className="nm-hud-tab"
                  onClick={() => setActiveTab('maths')}
                >
                  Courbes BER & Vote
                </button>
              )}
            </div>
          )}
        </div>

        <div className="nm-hud-toggles" role="group" aria-label="Traitements du récepteur">
          <button
            type="button"
            className="nm-btn nm-hud-toggle"
            aria-pressed={thresholdMode === 'adaptive'}
            onClick={onToggleThreshold}
          >
            <span
              className="nm-status-dot"
              data-active={thresholdMode === 'adaptive' ? 'true' : 'false'}
              aria-hidden="true"
            />
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
            <span
              className="nm-status-dot"
              data-active={voteOn ? 'true' : 'false'}
              aria-hidden="true"
            />
            <span>Vote</span>
            <span className="nm-toggle-state">
              {voteOn ? 'Activé' : 'Arrêt'}
            </span>
          </button>

          <button
            type="button"
            className="nm-btn nm-hud-hide-btn"
            onClick={onToggleVisible}
          >
            Masquer
          </button>
        </div>
      </div>

      <QualityReadout
        quality={quality}
        cps={cps}
        parityErrors={parityErrors}
        framingErrors={framingErrors}
      />

      <VotePanel voteOn={voteOn} summary={voteSummary} />

      {resolvedTab === 'sim' && (
        <div className="nm-hud-scopes">
          {simSlot}
          <DiscriminatorTrace bufferRef={bufferRef} />
        </div>
      )}

      {resolvedTab === 'maths' && (
        <div className="nm-hud-scopes">
          <div
            className="nm-hud-maths-grid"
            data-two-col={
              (showBerChart || berPoints.length > 0) && showVoteCerPanel
                ? 'true'
                : 'false'
            }
          >
            {(showBerChart || berPoints.length > 0) && (
              <BerChart points={berPoints} onClearPoints={onClearBerPoints} />
            )}
            {showVoteCerPanel && (
              <VoteCerPanel
                progression={voteProgression}
                canAutoRepeat={canAutoRepeatVote}
                autoRepeating={autoRepeatingVote}
                onRunSevenReceptions={onRunSevenReceptions}
              />
            )}
          </div>
        </div>
      )}

      {resolvedTab === 'signal' && (
        <div className="nm-hud-scopes">
          <Waterfall bufferRef={bufferRef} />
          <div className="nm-hud-scopes-pair">
            <DiscriminatorTrace bufferRef={bufferRef} />
            <EyeDiagram bufferRef={bufferRef} />
          </div>
        </div>
      )}
    </aside>
  );
}
