import { moveToNotation } from '../lib/coordinates';
import type { MoveCandidate } from '../types/game';

type ResultsPanelProps = {
  moves: MoveCandidate[];
  selectedMoveIndex: number;
  onSelect: (index: number) => void;
  hideHighRisk: boolean;
  onToggleHideHighRisk: (hide: boolean) => void;
};

function riskClass(label: MoveCandidate['risk']['label']): string {
  switch (label) {
    case 'low':
      return 'risk-low';
    case 'medium':
      return 'risk-medium';
    case 'high':
      return 'risk-high';
    default:
      return '';
  }
}

export function ResultsPanel({
  moves,
  selectedMoveIndex,
  onSelect,
  hideHighRisk,
  onToggleHideHighRisk,
}: ResultsPanelProps): JSX.Element {
  return (
    <section className="panel">
      <div className="results-header">
        <h2>4. Best Moves</h2>
        <label>
          <input
            type="checkbox"
            checked={hideHighRisk}
            onChange={(event) => onToggleHideHighRisk(event.target.checked)}
          />
          Hide high-risk words
        </label>
      </div>

      {moves.length === 0 ? (
        <p className="panel-note">No moves available yet.</p>
      ) : (
        <ol className="results-list">
          {moves.map((move, index) => {
            const notation = moveToNotation(move.word, move.row, move.col, move.direction);
            return (
              <li
                key={`${move.word}-${move.row}-${move.col}-${move.direction}`}
                className={index === selectedMoveIndex ? 'selected' : ''}
              >
                <button type="button" className="result-row" onClick={() => onSelect(index)}>
                  <span className="move-label">{notation}</span>
                  <span className="score-pill">{move.score} pts</span>
                  <span className={`risk-pill ${riskClass(move.risk.label)}`}>{move.risk.label} risk</span>
                </button>
                <p className="reasoning">
                  Eval {move.totalEval} = score {move.score} + leave {move.leaveValue} - defense {move.defensePenalty}
                  {' '} - lookahead {move.lookaheadPenalty} - risk {(move.risk.score * 1.5).toFixed(2)}
                </p>
                <p className="reasoning">Estimated opponent best reply: {move.opponentReplyScore} pts</p>
                <p className="reasoning">Risk: {move.risk.reasons.join(' ')}</p>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(notation);
                  }}
                >
                  Copy notation
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
