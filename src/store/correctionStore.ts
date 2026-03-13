import { create } from 'zustand';
import { createEmptyBoard } from '../lib/boardUtils';
import { buildCorrectionExportPayload, downloadCorrectionJson } from '../lib/correctionExport';
import type {
  Board,
  CorrectionExportPayload,
  ParsedState,
  ProfileType,
  RackTile,
} from '../types/game';
import { parseWithWorker } from '../workers/client';

type CorrectionStatus = 'idle' | 'parsing' | 'readyToConfirm' | 'error';

type CorrectionStore = {
  status: CorrectionStatus;
  error: string | null;
  parsedState: ParsedState | null;
  board: Board;
  rack: RackTile[];
  selectedProfileHint?: ProfileType;
  confirmed: boolean;
  parseConfidence: number;
  sourceFilename: string | null;
  loadError: (message: string) => void;
  parseScreenshot: (file: File) => Promise<void>;
  setProfileHint: (hint?: ProfileType) => void;
  updateBoardCell: (row: number, col: number, letter: string, isBlank: boolean) => void;
  clearBoardCell: (row: number, col: number) => void;
  updateRackTile: (index: number, letter: string, isBlank: boolean) => void;
  confirmCorrections: () => void;
  exportCorrections: () => CorrectionExportPayload;
  reset: () => void;
};

function normalizeRack(rack: RackTile[]): RackTile[] {
  const normalized = rack
    .map((tile) => ({
      letter: tile.letter.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1),
      isBlank: tile.isBlank,
    }))
    .slice(0, 7);

  while (normalized.length < 7) {
    normalized.push({ letter: '', isBlank: false });
  }

  return normalized;
}

function updateBoardImmutable(
  board: Board,
  row: number,
  col: number,
  next: { letter: string | null; isBlank: boolean },
): Board {
  return board.map((rowCells, rowIndex) => {
    if (rowIndex !== row) {
      return rowCells;
    }

    return rowCells.map((cell, colIndex) => {
      if (colIndex !== col) {
        return cell;
      }
      return {
        letter: next.letter,
        isBlank: next.isBlank,
      };
    });
  });
}

function makeExportFilename(originalFilename: string | null): string {
  const base = (originalFilename ?? 'screenshot').replace(/\.[^.]+$/, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base}.${timestamp}.corrections.json`;
}

export const useCorrectionStore = create<CorrectionStore>((set, get) => ({
  status: 'idle',
  error: null,
  parsedState: null,
  board: createEmptyBoard(),
  rack: normalizeRack([]),
  selectedProfileHint: undefined,
  confirmed: false,
  parseConfidence: 0,
  sourceFilename: null,

  loadError: (message) => {
    set({ status: 'error', error: message });
  },

  parseScreenshot: async (file: File) => {
    set({ status: 'parsing', error: null, confirmed: false });
    try {
      const parsed = await parseWithWorker(file, get().selectedProfileHint);
      set({
        status: 'readyToConfirm',
        parsedState: parsed,
        board: parsed.board,
        rack: normalizeRack(parsed.rack),
        parseConfidence: parsed.confidence,
        sourceFilename: file.name,
        confirmed: false,
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to parse screenshot',
      });
    }
  },

  setProfileHint: (hint) => {
    set({ selectedProfileHint: hint });
  },

  updateBoardCell: (row, col, letter, isBlank) => {
    const normalized = letter.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
    set((state) => ({
      confirmed: false,
      board: updateBoardImmutable(state.board, row, col, {
        letter: normalized || null,
        isBlank,
      }),
    }));
  },

  clearBoardCell: (row, col) => {
    set((state) => ({
      confirmed: false,
      board: updateBoardImmutable(state.board, row, col, {
        letter: null,
        isBlank: false,
      }),
    }));
  },

  updateRackTile: (index, letter, isBlank) => {
    const normalized = letter.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
    set((state) => {
      const nextRack = normalizeRack(state.rack);
      nextRack[index] = {
        letter: normalized,
        isBlank,
      };

      return {
        rack: nextRack,
        confirmed: false,
      };
    });
  },

  confirmCorrections: () => {
    const state = get();
    if (!state.parsedState) {
      set({ status: 'error', error: 'Upload and parse a screenshot first.' });
      return;
    }

    set({ confirmed: true, status: 'idle', error: null });
  },

  exportCorrections: () => {
    const state = get();

    if (!state.parsedState) {
      throw new Error('No parsed screenshot available for export.');
    }
    if (!state.confirmed) {
      throw new Error('Confirm corrections before exporting JSON.');
    }

    const payload = buildCorrectionExportPayload({
      filename: state.sourceFilename ?? 'screenshot.png',
      profile: state.parsedState.profile,
      board: state.board,
      rack: state.rack,
      parseConfidence: state.parseConfidence,
      lowConfidenceCells: state.parsedState.lowConfidenceCells,
    });

    const filename = makeExportFilename(state.sourceFilename);
    downloadCorrectionJson(payload, filename);

    return payload;
  },

  reset: () => {
    set({
      status: 'idle',
      error: null,
      parsedState: null,
      board: createEmptyBoard(),
      rack: normalizeRack([]),
      confirmed: false,
      parseConfidence: 0,
      sourceFilename: null,
    });
  },
}));
