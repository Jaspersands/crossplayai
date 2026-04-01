import { moveToNotation } from '../lib/coordinates';
import { isFunnyWord } from '../lib/funnyWords';
import type { MoveCandidate } from '../types/game';

type ResultsPanelProps = {
  moves: MoveCandidate[];
  selectedMoveIndex: number;
  onSelect: (index: number) => void;
};

type IndexedMove = {
  move: MoveCandidate;
  index: number;
};

const TOP_SCORE_COUNT = 10;
const SECTION_MOVE_COUNT = 8;

function compareByScore(a: IndexedMove, b: IndexedMove): number {
  return (
    b.move.score - a.move.score ||
    b.move.totalEval - a.move.totalEval ||
    b.move.crossWordCount - a.move.crossWordCount ||
    a.move.word.localeCompare(b.move.word)
  );
}

function compareByCrossWords(a: IndexedMove, b: IndexedMove): number {
  return (
    b.move.crossWordCount - a.move.crossWordCount ||
    b.move.crossWordLetters - a.move.crossWordLetters ||
    b.move.maxAdjacentExistingTiles - a.move.maxAdjacentExistingTiles ||
    b.move.threadedTileCount - a.move.threadedTileCount ||
    b.move.adjacentExistingTileCount - a.move.adjacentExistingTileCount ||
    b.move.score - a.move.score ||
    b.move.totalEval - a.move.totalEval ||
    a.move.word.localeCompare(b.move.word)
  );
}

function buildCrossMeta(move: MoveCandidate): string | null {
  const parts: string[] = [];

  if (move.crossWordCount > 0) {
    parts.push(`Creates ${move.crossWordCount} cross word${move.crossWordCount === 1 ? '' : 's'}`);
  }
  if (move.crossWordLetters > 0) {
    parts.push(`${move.crossWordLetters} total cross letters`);
  }
  if (move.maxAdjacentExistingTiles >= 2) {
    parts.push(`best hook touches ${move.maxAdjacentExistingTiles} existing tiles`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function ResultsPanel({
  moves,
  selectedMoveIndex,
  onSelect,
}: ResultsPanelProps): JSX.Element {
  const indexedMoves = moves.map((move, index) => ({ move, index }));
  const topScoringMoves = [...indexedMoves].sort(compareByScore).slice(0, TOP_SCORE_COUNT);
  const crossHeavyMoves = indexedMoves
    .filter(({ move }) => move.crossWordCount > 0 || move.maxAdjacentExistingTiles >= 2)
    .sort(compareByCrossWords)
    .slice(0, SECTION_MOVE_COUNT);
  const funnyMoves = indexedMoves
    .filter(({ move }) => isFunnyWord(move.word))
    .sort(compareByScore)
    .slice(0, SECTION_MOVE_COUNT);

  function renderMoveList(title: string, items: IndexedMove[], emptyMessage: string): JSX.Element {
    return (
      <section className="results-section">
        <div className="result-section-header">
          <h3>{title}</h3>
        </div>
        {items.length === 0 ? (
          <p className="panel-note section-empty">{emptyMessage}</p>
        ) : (
          <ol className="results-list">
            {items.map(({ move, index }) => {
              const notation = moveToNotation(move.word, move.row, move.col, move.direction);
              const crossMeta = buildCrossMeta(move);
              return (
                <li
                  key={`${title}-${move.word}-${move.row}-${move.col}-${move.direction}`}
                  className={index === selectedMoveIndex ? 'selected' : ''}
                >
                  <button
                    type="button"
                    className="result-row"
                    aria-label={`Select ${notation}`}
                    onClick={() => onSelect(index)}
                  >
                    <span className="move-label">{notation}</span>
                    <span className="score-pill">{move.score} pts</span>
                  </button>
                  <p className="reasoning">
                    Equity {move.totalEval} = {move.score} pts + {move.leaveValue} leave
                  </p>
                  {crossMeta ? <p className="result-meta">{crossMeta}</p> : null}
                  <button
                    type="button"
                    className="copy-btn"
                    aria-label={`Copy ${notation}`}
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

  return (
    <section className="panel">
      <div className="results-header">
        <h2>5. Best Moves</h2>
      </div>

      {moves.length === 0 ? (
        <p className="panel-note">No moves available yet.</p>
      ) : (
        <div className="results-sections">
          {renderMoveList('Top 10 Scores', topScoringMoves, 'No scoring moves available yet.')}
          {renderMoveList('Cross-Word Heavy', crossHeavyMoves, 'No cross-word-heavy or threaded plays in the current pool.')}
          {renderMoveList('Funny Words', funnyMoves, 'No funny words in the current move pool.')}
        </div>
      )}
    </section>
  );
}
