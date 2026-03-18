import { useEffect, useMemo } from 'react';
import { BoardEditor } from '../components/BoardEditor';
import { BoardPreview } from '../components/BoardPreview';
import { RackEditor } from '../components/RackEditor';
import { ResultsPanel } from '../components/ResultsPanel';
import { StatusBanner } from '../components/StatusBanner';
import { UploadPanel } from '../components/UploadPanel';
import { useAppStore } from '../store/appStore';

export function MainPage(): JSX.Element {
  const status = useAppStore((state) => state.status);
  const error = useAppStore((state) => state.error);
  const dictionaryMeta = useAppStore((state) => state.dictionaryMeta);
  const parseConfidence = useAppStore((state) => state.parseConfidence);
  const board = useAppStore((state) => state.board);
  const rack = useAppStore((state) => state.rack);
  const parsedState = useAppStore((state) => state.parsedState);
  const moves = useAppStore((state) => state.moves);
  const selectedMoveIndex = useAppStore((state) => state.selectedMoveIndex);
  const confirmed = useAppStore((state) => state.confirmed);
  const selectedProfileHint = useAppStore((state) => state.selectedProfileHint);

  const loadDictionaryAndInitialize = useAppStore((state) => state.loadDictionaryAndInitialize);
  const parseScreenshot = useAppStore((state) => state.parseScreenshot);
  const setProfileHint = useAppStore((state) => state.setProfileHint);
  const updateBoardCell = useAppStore((state) => state.updateBoardCell);
  const clearBoardCell = useAppStore((state) => state.clearBoardCell);
  const updateRackTile = useAppStore((state) => state.updateRackTile);
  const confirmBoardState = useAppStore((state) => state.confirmBoardState);
  const exportCorrections = useAppStore((state) => state.exportCorrections);
  const loadError = useAppStore((state) => state.loadError);
  const solve = useAppStore((state) => state.solve);
  const setSelectedMoveIndex = useAppStore((state) => state.setSelectedMoveIndex);
  const reset = useAppStore((state) => state.reset);

  useEffect(() => {
    void loadDictionaryAndInitialize();
  }, [loadDictionaryAndInitialize]);

  const lowConfidenceSet = useMemo(() => {
    const set = new Set<string>();
    for (const item of parsedState?.lowConfidenceCells ?? []) {
      set.add(`${item.row}:${item.col}`);
    }
    return set;
  }, [parsedState]);

  const visibleMoves = moves;

  useEffect(() => {
    if (selectedMoveIndex >= visibleMoves.length) {
      setSelectedMoveIndex(0);
    }
  }, [selectedMoveIndex, setSelectedMoveIndex, visibleMoves.length]);

  const selectedMove = visibleMoves[selectedMoveIndex];

  const canSolve =
    status !== 'solving' && status !== 'loadingDictionary' && confirmed && dictionaryMeta !== null;
  const canExport = status !== 'parsing' && confirmed && parsedState !== null;

  return (
    <main className="app-shell">
      <header>
        <h1>Crossplay Scrabble Move Finder</h1>
        <p>
          Upload a mobile Crossplay screenshot, correct OCR output, and compute the best candidate moves.
        </p>
      </header>

      <StatusBanner
        status={status}
        error={error}
        parseConfidence={parseConfidence}
        dictionaryWordCount={dictionaryMeta?.wordCount}
      />

      <UploadPanel
        onUpload={parseScreenshot}
        profileHint={selectedProfileHint}
        onProfileHintChange={setProfileHint}
        disabled={status === 'loadingDictionary' || status === 'parsing'}
      />

      <div className="editor-layout">
        <BoardEditor
          board={board}
          lowConfidenceSet={lowConfidenceSet}
          onCellChange={updateBoardCell}
          onCellClear={clearBoardCell}
        />
        <RackEditor rack={rack} onRackChange={updateRackTile} />
      </div>

      <section className="panel actions">
        <h2>4. Confirm, Export, and Solve</h2>
        <p className="panel-note">
          Confirm once after edits, then export corrections JSON and/or run the solver.
        </p>
        <div className="action-buttons">
          <button
            type="button"
            className="btn-secondary"
            onClick={confirmBoardState}
            disabled={status === 'parsing'}
          >
            Confirm board state
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              try {
                exportCorrections();
              } catch (e) {
                loadError(e instanceof Error ? e.message : 'Unable to export corrections');
              }
            }}
            disabled={!canExport}
          >
            Export corrections JSON
          </button>
          <button type="button" className="btn-primary" onClick={() => void solve()} disabled={!canSolve}>
            Solve top moves
          </button>
          <button type="button" className="btn-danger" onClick={reset}>
            Reset
          </button>
        </div>
      </section>

      <div className="results-layout">
        <BoardPreview board={board} selectedMove={selectedMove} />
        <ResultsPanel
          moves={visibleMoves}
          selectedMoveIndex={selectedMoveIndex}
          onSelect={setSelectedMoveIndex}
        />
      </div>
    </main>
  );
}
