import { useRef, type FocusEvent, type KeyboardEvent } from 'react';
import type { RackTile } from '../types/game';

type RackEditorProps = {
  rack: RackTile[];
  onRackChange: (index: number, letter: string, isBlank: boolean) => void;
};

export function RackEditor({ rack, onRackChange }: RackEditorProps): JSX.Element {
  const tiles = Array.from({ length: 7 }, (_, index) => rack[index] ?? { letter: '', isBlank: false });
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  function normalizeTypedValue(raw: string): string {
    return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(-1);
  }

  function focusTile(index: number): void {
    const clampedIndex = Math.max(0, Math.min(tiles.length - 1, index));
    inputRefs.current[clampedIndex]?.focus();
  }

  function selectInputValue(event: FocusEvent<HTMLInputElement>): void {
    event.currentTarget.select();
  }

  function handleRackKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
    tile: RackTile,
  ): void {
    const { key } = event;
    if (/^[a-z]$/i.test(key)) {
      event.preventDefault();
      onRackChange(index, key.toUpperCase(), tile.isBlank);
      focusTile(index + 1);
      return;
    }

    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault();
      onRackChange(index, '', tile.isBlank);
      if (key === 'Backspace' && !tile.letter) {
        focusTile(index - 1);
      }
    }
  }

  return (
    <section className="panel">
      <h2>3. Review Rack OCR</h2>
      <p className="panel-note">
        Verify each tile and check <strong>Blank</strong> for wildcard tiles.
      </p>
      <div className="rack-grid" role="group" aria-label="Rack editor">
        {tiles.map((tile, index) => (
          <div className="rack-tile" key={index}>
            <span className="rack-index">Tile {index + 1}</span>
            <input
              aria-label={`Rack tile ${index + 1}`}
              maxLength={1}
              value={tile.letter}
              onChange={(event) => {
                const nextValue = normalizeTypedValue(event.target.value);
                onRackChange(index, nextValue, tile.isBlank);
                if (nextValue) {
                  focusTile(index + 1);
                }
              }}
              onKeyDown={(event) => handleRackKeyDown(event, index, tile)}
              onFocus={selectInputValue}
              onClick={(event) => event.currentTarget.select()}
              ref={(node) => {
                inputRefs.current[index] = node;
              }}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <label className="rack-blank-toggle">
              <input
                type="checkbox"
                checked={tile.isBlank}
                onChange={(event) => onRackChange(index, tile.letter, event.target.checked)}
              />
              Blank
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
