import { PREMIUM_BOARD } from '../constants/board';
import type { Board, MoveCandidate } from '../types/game';

type BoardPreviewProps = {
  board: Board;
  selectedMove?: MoveCandidate;
};

function isMoveCell(move: MoveCandidate | undefined, row: number, col: number): boolean {
  if (!move) {
    return false;
  }

  for (let i = 0; i < move.word.length; i += 1) {
    const r = move.direction === 'across' ? move.row : move.row + i;
    const c = move.direction === 'across' ? move.col + i : move.col;
    if (r === row && c === col) {
      return true;
    }
  }
  return false;
}

export function BoardPreview({ board, selectedMove }: BoardPreviewProps): JSX.Element {
  const premiumLabelByType: Record<string, string> = {
    DL: '2L',
    TL: '3L',
    DW: '2W',
    TW: '3W',
  };

  return (
    <section className="panel">
      <h2>Board Preview</h2>
      <div className="preview-grid" aria-label="Board preview">
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const overlay = isMoveCell(selectedMove, rowIndex, colIndex);
            const premium = PREMIUM_BOARD[rowIndex][colIndex];
            const premiumClass = premium ? `premium-${premium.toLowerCase()}` : 'premium-none';
            const premiumLabel = premium ? premiumLabelByType[premium] : '';
            return (
              <div
                key={`${rowIndex}:${colIndex}`}
                className={`preview-cell ${premiumClass} ${cell.letter ? 'filled' : ''} ${overlay ? 'overlay' : ''} ${cell.isBlank ? 'blank-tile' : ''}`}
              >
                {cell.letter ? <span className="tile-letter">{cell.letter}</span> : null}
                {!cell.letter && premiumLabel ? <span className="premium-label">{premiumLabel}</span> : null}
              </div>
            );
          }),
        )}
      </div>
    </section>
  );
}
