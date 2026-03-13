import { BOARD_SIZE, CENTER_INDEX } from '../constants/board';
import type { Board, Cell, Direction, RackTile } from '../types/game';

export function createEmptyCell(): Cell {
  return { letter: null, isBlank: false };
}

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => createEmptyCell()),
  );
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => ({ ...cell })));
}

export function normalizeLetter(input: string): string {
  const trimmed = input.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed[0] : '';
}

export function sanitizeWord(word: string): string {
  return word.toUpperCase().replace(/[^A-Z]/g, '');
}

export function isInBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function isBoardEmpty(board: Board): boolean {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col].letter) {
        return false;
      }
    }
  }
  return true;
}

export function touchesExistingTile(board: Board, row: number, col: number): boolean {
  const neighbors = [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ];

  return neighbors.some(([r, c]) => isInBounds(r, c) && Boolean(board[r][c].letter));
}

export function getAnchors(board: Board): Array<{ row: number; col: number }> {
  if (isBoardEmpty(board)) {
    return [{ row: CENTER_INDEX, col: CENTER_INDEX }];
  }

  const anchors: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col].letter) {
        continue;
      }

      if (touchesExistingTile(board, row, col)) {
        anchors.push({ row, col });
      }
    }
  }

  return anchors;
}

export function hasMainAxisAdjacentTile(
  board: Board,
  row: number,
  col: number,
  direction: Direction,
): boolean {
  const checks =
    direction === 'across'
      ? [
          [row, col - 1],
          [row, col + 1],
        ]
      : [
          [row - 1, col],
          [row + 1, col],
        ];

  return checks.some(([r, c]) => isInBounds(r, c) && Boolean(board[r][c].letter));
}

export function formatRack(rack: RackTile[]): string {
  return rack
    .map((tile) => (tile.isBlank ? '?' : sanitizeWord(tile.letter)))
    .join('')
    .slice(0, 7);
}

export function parseRackString(rackText: string): RackTile[] {
  return rackText
    .toUpperCase()
    .slice(0, 7)
    .split('')
    .filter((char) => /[A-Z?]/.test(char))
    .map((letter) => ({
      letter: letter === '?' ? '' : letter,
      isBlank: letter === '?',
    }));
}

export function getCellLetter(board: Board, row: number, col: number): string | null {
  if (!isInBounds(row, col)) {
    return null;
  }
  return board[row][col].letter;
}
