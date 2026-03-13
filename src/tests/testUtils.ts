import { createEmptyBoard } from '../lib/boardUtils';
import type { Board, RackTile } from '../types/game';

export function boardFromRows(rows: string[]): Board {
  const board = createEmptyBoard();
  rows.forEach((rowText, row) => {
    rowText.split('').forEach((char, col) => {
      if (/[A-Z]/.test(char)) {
        board[row][col] = {
          letter: char,
          isBlank: false,
        };
      }
    });
  });
  return board;
}

export function rackFromText(text: string): RackTile[] {
  return text
    .toUpperCase()
    .split('')
    .map((char) => ({
      letter: char === '?' ? '' : char,
      isBlank: char === '?',
    }));
}
