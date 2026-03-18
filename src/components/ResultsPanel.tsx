import { moveToNotation } from '../lib/coordinates';
import type { MoveCandidate } from '../types/game';

type ResultsPanelProps = {
  moves: MoveCandidate[];
  selectedMoveIndex: number;
  onSelect: (index: number) => void;
};

export function ResultsPanel({
  moves,
  selectedMoveIndex,
  onSelect,
}: ResultsPanelProps): JSX.Element {
  return (
    <section className="panel">
      <div className="results-header">
        <h2>4. Best Moves</h2>
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
                </button>
                <p className="reasoning">
                  Equity {move.totalEval} = {move.score} pts + {move.leaveValue} leave
                </p>
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
