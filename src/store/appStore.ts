import { create } from 'zustand';
import { DEFAULT_TOP_N } from '../config/solver';
import { createEmptyBoard } from '../lib/boardUtils';
import { buildCorrectionExportPayload, downloadCorrectionJson } from '../lib/correctionExport';
import {
  getLexiconSnapshot,
  loadCrossplayBlocklist,
  loadDictionary,
  type LexiconSnapshot,
} from '../lib/dictionary';
import type {
  Board,
  CorrectionExportPayload,
  DictionaryMeta,
  MoveCandidate,
  ParsedState,
  ProfileType,
  RackTile,
} from '../types/game';
import { initSolverLexicon, parseWithWorker, solveWithWorker } from '../workers/client';

type AppStatus = 'idle' | 'loadingDictionary' | 'parsing' | 'readyToConfirm' | 'solving' | 'done' | 'error';

type AppStore = {
  status: AppStatus;
  error: string | null;
  dictionaryMeta: DictionaryMeta | null;
  blocklist: Set<string>;
  lexiconSnapshot: LexiconSnapshot | null;
  parsedState: ParsedState | null;
  board: Board;
  rack: RackTile[];
  sourceFilename: string | null;
  selectedProfileHint?: ProfileType;
  confirmed: boolean;
  moves: MoveCandidate[];
  selectedMoveIndex: number;
  hideHighRisk: boolean;
  parseConfidence: number;
  loadError: (message: string) => void;
  loadDictionaryAndInitialize: () => Promise<void>;
  parseScreenshot: (file: File) => Promise<void>;
  setProfileHint: (hint?: ProfileType) => void;
  updateBoardCell: (row: number, col: number, letter: string, isBlank: boolean) => void;
  clearBoardCell: (row: number, col: number) => void;
  updateRackTile: (index: number, letter: string, isBlank: boolean) => void;
  confirmBoardState: () => void;
  exportCorrections: () => CorrectionExportPayload;
  solve: () => Promise<void>;
  setSelectedMoveIndex: (index: number) => void;
  setHideHighRisk: (hidden: boolean) => void;
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
    normalized.push({
      letter: '',
      isBlank: false,
    });
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

export const useAppStore = create<AppStore>((set, get) => ({
  status: 'idle',
  error: null,
  dictionaryMeta: null,
  blocklist: new Set(),
  lexiconSnapshot: null,
  parsedState: null,
  board: createEmptyBoard(),
  rack: normalizeRack([]),
  sourceFilename: null,
  selectedProfileHint: undefined,
  confirmed: false,
  moves: [],
  selectedMoveIndex: 0,
  hideHighRisk: false,
  parseConfidence: 0,

  loadError: (message) => {
    set({
      status: 'error',
      error: message,
    });
  },

  loadDictionaryAndInitialize: async () => {
    set({ status: 'loadingDictionary', error: null });
    try {
      const dictionaryMeta = await loadDictionary();
      const snapshot = getLexiconSnapshot(dictionaryMeta.id);
      const blocklist = await loadCrossplayBlocklist();
      await initSolverLexicon(snapshot, Array.from(blocklist));

      set({
        status: 'idle',
        dictionaryMeta,
        lexiconSnapshot: snapshot,
        blocklist,
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unable to load dictionary',
      });
    }
  },

  parseScreenshot: async (file: File) => {
    set({ status: 'parsing', error: null, confirmed: false, moves: [], selectedMoveIndex: 0 });
    try {
      const parsed = await parseWithWorker(file, get().selectedProfileHint);
      set({
        status: 'readyToConfirm',
        parsedState: parsed,
        board: parsed.board,
        rack: normalizeRack(parsed.rack),
        sourceFilename: file.name,
        parseConfidence: parsed.confidence,
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
      const nextRack = [...state.rack];
      if (normalized || isBlank) {
        nextRack[index] = {
          letter: normalized,
          isBlank,
        };
      } else {
        nextRack[index] = {
          letter: '',
          isBlank: false,
        };
      }

      return {
        rack: nextRack.filter((_, i) => i <= 6),
        confirmed: false,
      };
    });
  },

  confirmBoardState: () => {
    set({ confirmed: true, status: 'idle' });
  },

  exportCorrections: () => {
    const state = get();

    if (!state.parsedState) {
      throw new Error('No parsed screenshot available for export.');
    }
    if (!state.confirmed) {
      throw new Error('Confirm board state before exporting JSON.');
    }

    const payload = buildCorrectionExportPayload({
      filename: state.sourceFilename ?? 'screenshot.png',
      profile: state.parsedState.profile,
      board: state.board,
      rack: normalizeRack(state.rack),
      parseConfidence: state.parseConfidence,
      lowConfidenceCells: state.parsedState.lowConfidenceCells,
    });

    const filename = makeExportFilename(state.sourceFilename);
    downloadCorrectionJson(payload, filename);
    return payload;
  },

  solve: async () => {
    const state = get();
    if (!state.dictionaryMeta || !state.lexiconSnapshot) {
      set({ status: 'error', error: 'Dictionary is not loaded yet.' });
      return;
    }

    if (!state.confirmed) {
      set({ status: 'error', error: 'Please confirm the board and rack before solving.' });
      return;
    }

    set({ status: 'solving', error: null });
    try {
      const moves = await solveWithWorker({
        board: state.board,
        rack: state.rack,
        lexiconId: state.dictionaryMeta.id,
        topN: DEFAULT_TOP_N,
      });

      set({
        moves,
        selectedMoveIndex: 0,
        status: 'done',
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Solver failed',
      });
    }
  },

  setSelectedMoveIndex: (index) => {
    set({ selectedMoveIndex: index });
  },

  setHideHighRisk: (hideHighRisk) => {
    set({ hideHighRisk });
  },

  reset: () => {
    set({
      status: 'idle',
      error: null,
      parsedState: null,
      board: createEmptyBoard(),
      rack: normalizeRack([]),
      sourceFilename: null,
      confirmed: false,
      moves: [],
      selectedMoveIndex: 0,
      parseConfidence: 0,
    });
  },
}));
