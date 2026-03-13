import { PREMIUM_BOARD } from '../constants/board';
import type { Board, Direction } from '../types/game';
import { isInBounds } from './boardUtils';
import type { PlacementPosition } from './scoring';

const PREMIUM_WEIGHTS: Record<string, number> = {
  TW: 8,
  DW: 4,
  TL: 3,
  DL: 1.5,
};

function premiumWeight(row: number, col: number): number {
  const premium = PREMIUM_BOARD[row][col];
  if (!premium) {
    return 0;
  }
  return PREMIUM_WEIGHTS[premium] ?? 0;
}

function isOpenLane(board: Board, row: number, col: number, direction: Direction): boolean {
  const mainAxis = direction === 'across' ? [
    [0, -1],
    [0, 1],
  ] : [
    [-1, 0],
    [1, 0],
  ];

  return mainAxis.some(([dr, dc]) => {
    const nr = row + dr;
    const nc = col + dc;
    return isInBounds(nr, nc) && !board[nr][nc].letter;
  });
}

export function evaluateDefensePenalty(
  board: Board,
  placedTiles: PlacementPosition[],
  direction: Direction,
): number {
  let penalty = 0;

  for (const tile of placedTiles) {
    const occupiedPremium = premiumWeight(tile.row, tile.col);
    penalty -= occupiedPremium * 0.35;

    const neighborhood = [
      [tile.row - 1, tile.col],
      [tile.row + 1, tile.col],
      [tile.row, tile.col - 1],
      [tile.row, tile.col + 1],
    ];

    for (const [nr, nc] of neighborhood) {
      if (!isInBounds(nr, nc) || board[nr][nc].letter) {
        continue;
      }
      penalty += premiumWeight(nr, nc) * 0.15;
    }

    if (isOpenLane(board, tile.row, tile.col, direction)) {
      penalty += 0.2;
    }
  }

  return Number(Math.max(0, penalty).toFixed(2));
}
