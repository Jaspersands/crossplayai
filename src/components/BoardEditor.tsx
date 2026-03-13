import { PREMIUM_BOARD } from '../constants/board';
import type { Board } from '../types/game';

type BoardEditorProps = {
  board: Board;
  lowConfidenceSet: Set<string>;
  onCellChange: (row: number, col: number, letter: string, isBlank: boolean) => void;
  onCellClear: (row: number, col: number) => void;
};

export function BoardEditor({ board, lowConfidenceSet, onCellChange, onCellClear }: BoardEditorProps): JSX.Element {
  const premiumLabelByType: Record<string, string> = {
    DL: '2L',
    TL: '3L',
    DW: '2W',
    TW: '3W',
  };

  return (
    <section className="panel board-panel">
      <h2>2. Review Board OCR</h2>
      <p className="panel-note">
        Edit any tile before solving. Low-confidence cells are outlined.
      </p>
      <div className="board-legend" aria-hidden="true">
        <span className="legend-chip premium-dl">2L</span>
        <span className="legend-chip premium-tl">3L</span>
        <span className="legend-chip premium-dw">2W</span>
        <span className="legend-chip premium-tw">3W</span>
        <span className="legend-chip filled">Letter tile</span>
        <span className="legend-chip low-confidence">Low confidence</span>
      </div>
      <div className="board-grid-wrap">
        <div className="board-grid" role="grid" aria-label="Scrabble board editor">
          {board.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const key = `${rowIndex}:${colIndex}`;
              const lowConfidence = lowConfidenceSet.has(key);
              const premium = PREMIUM_BOARD[rowIndex][colIndex];
              const premiumClass = premium ? `premium-${premium.toLowerCase()}` : 'premium-none';
              const premiumLabel = premium ? premiumLabelByType[premium] : '';
              return (
                <div
                  key={key}
                  className={`board-cell ${premiumClass} ${lowConfidence ? 'low-confidence' : ''} ${cell.letter ? 'filled' : ''} ${cell.isBlank ? 'blank-tile' : ''}`}
                >
                  {!cell.letter && premiumLabel ? <span className="premium-label">{premiumLabel}</span> : null}
                  <input
                    aria-label={`Cell ${rowIndex + 1}-${colIndex + 1}`}
                    value={cell.letter ?? ''}
                    onChange={(event) =>
                      onCellChange(rowIndex, colIndex, event.target.value, cell.isBlank)
                    }
                    maxLength={1}
                  />
                  <div className="cell-controls">
                    <button
                      type="button"
                      title="Toggle blank tile"
                      onClick={() =>
                        onCellChange(rowIndex, colIndex, cell.letter ?? '', !cell.isBlank)
                      }
                    >
                      {cell.isBlank ? 'Blank' : 'Letter'}
                    </button>
                    <button type="button" title="Clear cell" onClick={() => onCellClear(rowIndex, colIndex)}>
                      Clear
                    </button>
                  </div>
                </div>
              );
            }),
          )}
        </div>
      </div>
    </section>
  );
}
