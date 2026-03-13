import type { RackTile } from '../types/game';

type RackEditorProps = {
  rack: RackTile[];
  onRackChange: (index: number, letter: string, isBlank: boolean) => void;
};

export function RackEditor({ rack, onRackChange }: RackEditorProps): JSX.Element {
  const tiles = Array.from({ length: 7 }, (_, index) => rack[index] ?? { letter: '', isBlank: false });

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
              onChange={(event) => onRackChange(index, event.target.value, tile.isBlank)}
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
