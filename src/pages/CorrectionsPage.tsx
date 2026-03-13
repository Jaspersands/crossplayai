import { useMemo } from 'react';
import { BoardEditor } from '../components/BoardEditor';
import { RackEditor } from '../components/RackEditor';
import { StatusBanner } from '../components/StatusBanner';
import { UploadPanel } from '../components/UploadPanel';
import { useCorrectionStore } from '../store/correctionStore';

export function CorrectionsPage(): JSX.Element {
  const status = useCorrectionStore((state) => state.status);
  const error = useCorrectionStore((state) => state.error);
  const parsedState = useCorrectionStore((state) => state.parsedState);
  const parseConfidence = useCorrectionStore((state) => state.parseConfidence);
  const board = useCorrectionStore((state) => state.board);
  const rack = useCorrectionStore((state) => state.rack);
  const confirmed = useCorrectionStore((state) => state.confirmed);
  const selectedProfileHint = useCorrectionStore((state) => state.selectedProfileHint);

  const parseScreenshot = useCorrectionStore((state) => state.parseScreenshot);
  const setProfileHint = useCorrectionStore((state) => state.setProfileHint);
  const updateBoardCell = useCorrectionStore((state) => state.updateBoardCell);
  const clearBoardCell = useCorrectionStore((state) => state.clearBoardCell);
  const updateRackTile = useCorrectionStore((state) => state.updateRackTile);
  const confirmCorrections = useCorrectionStore((state) => state.confirmCorrections);
  const exportCorrections = useCorrectionStore((state) => state.exportCorrections);
  const loadError = useCorrectionStore((state) => state.loadError);
  const reset = useCorrectionStore((state) => state.reset);

  const lowConfidenceSet = useMemo(() => {
    const set = new Set<string>();
    for (const item of parsedState?.lowConfidenceCells ?? []) {
      set.add(`${item.row}:${item.col}`);
    }
    return set;
  }, [parsedState]);

  const canExport = confirmed && parsedState !== null;

  return (
    <main className="app-shell">
      <header>
        <h1>Crossplay Screenshot Corrections</h1>
        <p>
          Upload a screenshot, correct the parsed board and rack, then export JSON labels.
        </p>
      </header>

      <StatusBanner status={status} error={error} parseConfidence={parseConfidence} />

      <UploadPanel
        onUpload={parseScreenshot}
        profileHint={selectedProfileHint}
        onProfileHintChange={setProfileHint}
        disabled={status === 'parsing'}
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
        <h2>4. Confirm and Export</h2>
        <p className="panel-note">
          Confirm your corrections before exporting the label JSON.
        </p>
        <div className="action-buttons">
          <button
            type="button"
            className="btn-secondary"
            onClick={confirmCorrections}
            disabled={status === 'parsing' || !parsedState}
          >
            Confirm corrections
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              try {
                exportCorrections();
              } catch (e) {
                loadError(e instanceof Error ? e.message : 'Unable to export corrections');
              }
            }}
            disabled={!canExport}
          >
            Export JSON
          </button>
          <button type="button" className="btn-danger" onClick={reset}>
            Reset
          </button>
        </div>
      </section>
    </main>
  );
}
