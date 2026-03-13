import { BOARD_SIZE, LETTER_SCORES, PREMIUM_BOARD } from '../constants/board';
import type { Board, Direction } from '../types/game';
import { isInBounds, isBoardEmpty } from './boardUtils';

export type PlacementPosition = {
  row: number;
  col: number;
  letter: string;
  isBlank: boolean;
};

export type PlacementEvaluation = {
  score: number;
  placedTiles: PlacementPosition[];
  usedRackTiles: number;
};

export type MoveSpec = {
  word: string;
  row: number;
  col: number;
  direction: Direction;
};

function getStep(direction: Direction): { dr: number; dc: number } {
  return direction === 'across' ? { dr: 0, dc: 1 } : { dr: 1, dc: 0 };
}

function getLetterScore(letter: string, isBlank: boolean): number {
  if (isBlank) {
    return 0;
  }
  return LETTER_SCORES[letter] ?? 0;
}

function getPremium(row: number, col: number): { letterMultiplier: number; wordMultiplier: number } {
  const premium = PREMIUM_BOARD[row][col];
  switch (premium) {
    case 'DL':
      return { letterMultiplier: 2, wordMultiplier: 1 };
    case 'TL':
      return { letterMultiplier: 3, wordMultiplier: 1 };
    case 'DW':
      return { letterMultiplier: 1, wordMultiplier: 2 };
    case 'TW':
      return { letterMultiplier: 1, wordMultiplier: 3 };
    default:
      return { letterMultiplier: 1, wordMultiplier: 1 };
  }
}

function buildPerpendicularWord(
  board: Board,
  row: number,
  col: number,
  direction: Direction,
  placedLetter: string,
): { word: string; cells: Array<{ row: number; col: number; letter: string; isPlaced: boolean }> } {
  const vertical = direction === 'across';
  const dr = vertical ? 1 : 0;
  const dc = vertical ? 0 : 1;

  let startRow = row;
  let startCol = col;
  while (isInBounds(startRow - dr, startCol - dc) && board[startRow - dr][startCol - dc].letter) {
    startRow -= dr;
    startCol -= dc;
  }

  const cells: Array<{ row: number; col: number; letter: string; isPlaced: boolean }> = [];
  let cursorRow = startRow;
  let cursorCol = startCol;

  while (isInBounds(cursorRow, cursorCol)) {
    if (cursorRow === row && cursorCol === col) {
      cells.push({ row: cursorRow, col: cursorCol, letter: placedLetter, isPlaced: true });
    } else {
      const existing = board[cursorRow][cursorCol].letter;
      if (!existing) {
        break;
      }
      cells.push({ row: cursorRow, col: cursorCol, letter: existing, isPlaced: false });
    }

    const nextRow = cursorRow + dr;
    const nextCol = cursorCol + dc;
    if (!isInBounds(nextRow, nextCol)) {
      break;
    }

    if (!(nextRow === row && nextCol === col) && !board[nextRow][nextCol].letter) {
      break;
    }

    cursorRow = nextRow;
    cursorCol = nextCol;
  }

  return {
    word: cells.map((cell) => cell.letter).join(''),
    cells,
  };
}

export function evaluatePlacement(
  board: Board,
  move: MoveSpec,
  blankPositions: Set<number>,
): PlacementEvaluation {
  const { dr, dc } = getStep(move.direction);

  let mainWordScore = 0;
  let mainWordMultiplier = 1;
  let crossWordScore = 0;

  const placedTiles: PlacementPosition[] = [];

  for (let i = 0; i < move.word.length; i += 1) {
    const row = move.row + dr * i;
    const col = move.col + dc * i;

    if (!isInBounds(row, col) || row >= BOARD_SIZE || col >= BOARD_SIZE) {
      throw new Error('Move exceeds board bounds');
    }

    const letter = move.word[i];
    const existing = board[row][col];

    if (existing.letter) {
      mainWordScore += getLetterScore(existing.letter, existing.isBlank);
      continue;
    }

    const isBlank = blankPositions.has(i);
    const baseScore = getLetterScore(letter, isBlank);
    const premium = getPremium(row, col);

    mainWordScore += baseScore * premium.letterMultiplier;
    mainWordMultiplier *= premium.wordMultiplier;

    placedTiles.push({ row, col, letter, isBlank });

    const perpendicular = buildPerpendicularWord(board, row, col, move.direction, letter);
    if (perpendicular.word.length > 1) {
      let perpendicularScore = 0;
      let perpendicularMultiplier = 1;
      for (const cell of perpendicular.cells) {
        const cellScore = getLetterScore(
          cell.letter,
          cell.isPlaced ? isBlank : board[cell.row][cell.col].isBlank,
        );
        if (cell.isPlaced) {
          const cellPremium = getPremium(cell.row, cell.col);
          perpendicularScore += cellScore * cellPremium.letterMultiplier;
          perpendicularMultiplier *= cellPremium.wordMultiplier;
        } else {
          perpendicularScore += cellScore;
        }
      }
      crossWordScore += perpendicularScore * perpendicularMultiplier;
    }
  }

  const usedRackTiles = placedTiles.length;
  const bingoBonus = usedRackTiles === 7 ? 50 : 0;
  const score = mainWordScore * mainWordMultiplier + crossWordScore + bingoBonus;

  return {
    score,
    placedTiles,
    usedRackTiles,
  };
}

export function validateMoveBoundaries(board: Board, move: MoveSpec): boolean {
  const { dr, dc } = getStep(move.direction);
  const beforeRow = move.row - dr;
  const beforeCol = move.col - dc;
  const afterRow = move.row + dr * move.word.length;
  const afterCol = move.col + dc * move.word.length;

  const hasBefore = isInBounds(beforeRow, beforeCol) && Boolean(board[beforeRow][beforeCol].letter);
  const hasAfter = isInBounds(afterRow, afterCol) && Boolean(board[afterRow][afterCol].letter);

  return !hasBefore && !hasAfter;
}

export function moveTouchesCenter(move: MoveSpec): boolean {
  const { dr, dc } = getStep(move.direction);
  for (let i = 0; i < move.word.length; i += 1) {
    const row = move.row + dr * i;
    const col = move.col + dc * i;
    if (row === 7 && col === 7) {
      return true;
    }
  }
  return false;
}

export function moveTouchesExistingTile(board: Board, move: MoveSpec): boolean {
  if (isBoardEmpty(board)) {
    return moveTouchesCenter(move);
  }

  const { dr, dc } = getStep(move.direction);
  for (let i = 0; i < move.word.length; i += 1) {
    const row = move.row + dr * i;
    const col = move.col + dc * i;

    if (board[row][col].letter) {
      return true;
    }

    const neighbors = [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ];

    if (neighbors.some(([nr, nc]) => isInBounds(nr, nc) && Boolean(board[nr][nc].letter))) {
      return true;
    }
  }

  return false;
}

export function buildMainWordFromBoard(
  board: Board,
  move: MoveSpec,
  indexToLetter: Map<number, string>,
): string {
  const { dr, dc } = getStep(move.direction);
  const letters: string[] = [];
  for (let i = 0; i < move.word.length; i += 1) {
    const row = move.row + dr * i;
    const col = move.col + dc * i;
    const existing = board[row][col].letter;
    if (existing) {
      letters.push(existing);
    } else {
      letters.push(indexToLetter.get(i) ?? move.word[i]);
    }
  }
  return letters.join('');
}

export function buildPerpendicularWordString(
  board: Board,
  row: number,
  col: number,
  direction: Direction,
  letter: string,
): string {
  const perpendicular = buildPerpendicularWord(board, row, col, direction, letter);
  return perpendicular.word;
}
