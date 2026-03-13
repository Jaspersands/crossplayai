import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBoard } from '../../lib/boardUtils';
import { useCorrectionStore } from '../../store/correctionStore';

vi.mock('../../workers/client', () => ({
  parseWithWorker: vi.fn(),
}));

const { parseWithWorker } = await import('../../workers/client');

describe('correction store', () => {
  beforeEach(() => {
    useCorrectionStore.getState().reset();
    vi.clearAllMocks();
  });

  it('maps parser response to store state and normalizes rack length', async () => {
    const board = createEmptyBoard();
    board[1][2] = { letter: 'R', isBlank: false };

    vi.mocked(parseWithWorker).mockResolvedValue({
      profile: 'ios',
      board,
      rack: [
        { letter: 'a', isBlank: false },
        { letter: '', isBlank: true },
      ],
      confidence: 0.91,
      lowConfidenceCells: [{ row: 1, col: 2, confidence: 0.42 }],
    });

    const file = new File(['x'], 'sample.png', { type: 'image/png' });
    await useCorrectionStore.getState().parseScreenshot(file);

    const state = useCorrectionStore.getState();
    expect(state.status).toBe('readyToConfirm');
    expect(state.sourceFilename).toBe('sample.png');
    expect(state.parseConfidence).toBe(0.91);
    expect(state.parsedState?.lowConfidenceCells).toEqual([{ row: 1, col: 2, confidence: 0.42 }]);
    expect(state.rack).toHaveLength(7);
    expect(state.rack[0]).toEqual({ letter: 'A', isBlank: false });
    expect(state.rack[1]).toEqual({ letter: '', isBlank: true });
    expect(state.rack[6]).toEqual({ letter: '', isBlank: false });
  });

  it('requires confirmation before export', async () => {
    const state = useCorrectionStore.getState();
    expect(() => state.exportCorrections()).toThrow('No parsed screenshot available for export.');
  });
});
