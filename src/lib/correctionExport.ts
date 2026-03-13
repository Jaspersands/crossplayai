import { PREMIUM_BOARD } from '../constants/board';
import type {
  Board,
  ConfidenceCell,
  CorrectionExportPayload,
  ProfileType,
  RackTile,
} from '../types/game';

type BuildCorrectionExportInput = {
  filename: string;
  profile: ProfileType;
  board: Board;
  rack: RackTile[];
  parseConfidence: number;
  lowConfidenceCells: ConfidenceCell[];
  exportedAt?: string;
};

function normalizeLetter(letter: string | null | undefined): string | null {
  const normalized = (letter ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
  return normalized || null;
}

export function buildCorrectionExportPayload(input: BuildCorrectionExportInput): CorrectionExportPayload {
  const exportedAt = input.exportedAt ?? new Date().toISOString();

  const board = input.board.map((row, rowIndex) =>
    row.map((cell, colIndex) => ({
      letter: normalizeLetter(cell.letter),
      isBlank: Boolean(cell.isBlank),
      premium: PREMIUM_BOARD[rowIndex][colIndex],
    })),
  );

  const rack = Array.from({ length: 7 }, (_, index) => {
    const tile = input.rack[index];
    if (!tile) {
      return {
        letter: null,
        isBlank: false,
      };
    }

    return {
      letter: normalizeLetter(tile.letter),
      isBlank: Boolean(tile.isBlank),
    };
  });

  return {
    version: '1.0.0',
    source: {
      filename: input.filename,
      profile: input.profile,
      exportedAt,
    },
    board,
    rack,
    parser: {
      confidence: input.parseConfidence,
      lowConfidenceCells: input.lowConfidenceCells.map((cell) => ({ ...cell })),
    },
  };
}

export function downloadCorrectionJson(payload: CorrectionExportPayload, filename: string): void {
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
