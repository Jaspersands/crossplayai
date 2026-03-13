import { describe, expect, it } from 'vitest';
import { PREMIUM_BOARD } from '../../constants/board';
import { createEmptyBoard } from '../../lib/boardUtils';
import { buildCorrectionExportPayload } from '../../lib/correctionExport';

describe('correction export payload', () => {
  it('normalizes letters, preserves blanks, and includes premium map', () => {
    const board = createEmptyBoard();
    board[0][0] = { letter: 'a', isBlank: false };
    board[7][7] = { letter: 'e', isBlank: true };

    const payload = buildCorrectionExportPayload({
      filename: 'shot.png',
      profile: 'ios',
      board,
      rack: [
        { letter: 'q', isBlank: false },
        { letter: '', isBlank: true },
      ],
      parseConfidence: 0.83,
      lowConfidenceCells: [{ row: 7, col: 7, confidence: 0.31 }],
      exportedAt: '2026-03-06T12:00:00.000Z',
    });

    expect(payload.version).toBe('1.0.0');
    expect(payload.source.filename).toBe('shot.png');
    expect(payload.source.profile).toBe('ios');
    expect(payload.source.exportedAt).toBe('2026-03-06T12:00:00.000Z');

    expect(payload.board[0][0]).toEqual({
      letter: 'A',
      isBlank: false,
      premium: PREMIUM_BOARD[0][0],
    });
    expect(payload.board[7][7]).toEqual({
      letter: 'E',
      isBlank: true,
      premium: PREMIUM_BOARD[7][7],
    });

    expect(payload.rack).toHaveLength(7);
    expect(payload.rack[0]).toEqual({ letter: 'Q', isBlank: false });
    expect(payload.rack[1]).toEqual({ letter: null, isBlank: true });
    expect(payload.rack[6]).toEqual({ letter: null, isBlank: false });

    expect(payload.parser.confidence).toBe(0.83);
    expect(payload.parser.lowConfidenceCells).toEqual([{ row: 7, col: 7, confidence: 0.31 }]);
  });
});
