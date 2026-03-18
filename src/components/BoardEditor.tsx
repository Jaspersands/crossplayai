import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { PREMIUM_BOARD } from '../constants/board';
import type { Board } from '../types/game';

type BoardEditorProps = {
  board: Board;
  lowConfidenceSet: Set<string>;
  onCellChange: (row: number, col: number, letter: string, isBlank: boolean) => void;
  onCellClear: (row: number, col: number) => void;
};

export function BoardEditor({ board, lowConfidenceSet, onCellChange, onCellClear }: BoardEditorProps): JSX.Element {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const inputRefs = useRef<Array<Array<HTMLInputElement | null>>>([]);

  const premiumLabelByType: Record<string, string> = {
    DL: '2L',
    TL: '3L',
    DW: '2W',
    TW: '3W',
  };

  function focusCell(row: number, col: number): void {
    const clampedRow = Math.max(0, Math.min(14, row));
    const clampedCol = Math.max(0, Math.min(14, col));
    inputRefs.current[clampedRow]?.[clampedCol]?.focus();
  }

  function normalizeTypedValue(raw: string): string {
    const normalized = raw.toUpperCase().replace(/[^A-Z]/g, '');
    return normalized.slice(-1);
  }

  function selectInputValue(event: FocusEvent<HTMLInputElement>): void {
    event.currentTarget.select();
  }

  function handleCellKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    colIndex: number,
    isBlank: boolean,
  ): void {
    const { key } = event;
    if (/^[a-z]$/i.test(key)) {
      event.preventDefault();
      onCellChange(rowIndex, colIndex, key.toUpperCase(), isBlank);
      return;
    }

    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault();
      onCellChange(rowIndex, colIndex, '', isBlank);
      return;
    }

    if (key === 'ArrowUp') {
      event.preventDefault();
      focusCell(rowIndex - 1, colIndex);
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      focusCell(rowIndex + 1, colIndex);
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      focusCell(rowIndex, colIndex - 1);
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      focusCell(rowIndex, colIndex + 1);
    }
  }

  return (
    <section className="panel board-panel">
      <h2>2. Review Board OCR</h2>
      <p className="panel-note">
        Edit any tile before solving. Low-confidence cells are outlined. Delete clears only the letter; Clear resets letter and blank state.
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
                  className={`board-cell ${premiumClass} ${lowConfidence ? 'low-confidence' : ''} ${cell.letter ? 'filled' : ''} ${cell.isBlank ? 'blank-tile' : ''} ${focusedKey === key ? 'is-focused' : ''}`}
                  onFocusCapture={() => setFocusedKey(key)}
                  onBlurCapture={(event) => {
                    const next = event.relatedTarget as Node | null;
                    if (!event.currentTarget.contains(next)) {
                      setFocusedKey((current) => (current === key ? null : current));
                    }
                  }}
                >
                  {!cell.letter && premiumLabel ? <span className="premium-label">{premiumLabel}</span> : null}
                  <input
                    aria-label={`Cell ${rowIndex + 1}-${colIndex + 1}`}
                    value={cell.letter ?? ''}
                    onChange={(event) => onCellChange(rowIndex, colIndex, normalizeTypedValue(event.target.value), cell.isBlank)}
                    onKeyDown={(event) => handleCellKeyDown(event, rowIndex, colIndex, cell.isBlank)}
                    onFocus={selectInputValue}
                    onClick={(event) => event.currentTarget.select()}
                    ref={(node) => {
                      if (!inputRefs.current[rowIndex]) {
                        inputRefs.current[rowIndex] = [];
                      }
                      inputRefs.current[rowIndex][colIndex] = node;
                    }}
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
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
                    <button type="button" title="Clear cell and blank flag" onClick={() => onCellClear(rowIndex, colIndex)}>
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
