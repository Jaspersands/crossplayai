import type { PremiumType } from '../types/game';

export const BOARD_SIZE = 15;
export const CENTER_INDEX = 7;

const EMPTY_ROW: PremiumType[] = Array<PremiumType>(BOARD_SIZE).fill(null);

export const PREMIUM_BOARD: PremiumType[][] = [
  ['TL', null, null, 'TW', null, null, null, 'DL', null, null, null, 'TW', null, null, 'TL'],
  [null, 'DW', null, null, null, null, 'TL', null, 'TL', null, null, null, null, 'DW', null],
  [null, null, null, null, 'DL', null, null, null, null, null, 'DL', null, null, null, null],
  ['TW', null, null, 'DL', null, null, null, 'DW', null, null, null, 'DL', null, null, 'TW'],
  [null, null, 'DL', null, null, 'TL', null, null, null, 'TL', null, null, 'DL', null, null],
  [null, null, null, null, 'TL', null, null, 'DL', null, null, 'TL', null, null, null, null],
  [null, 'TL', null, null, null, null, null, null, null, null, null, null, null, 'TL', null],
  ['DL', null, null, 'DW', null, 'DL', null, null, null, 'DL', null, 'DW', null, null, 'DL'],
  [null, 'TL', null, null, null, null, null, null, null, null, null, null, null, 'TL', null],
  [null, null, null, null, 'TL', null, null, 'DL', null, null, 'TL', null, null, null, null],
  [null, null, 'DL', null, null, 'TL', null, null, null, 'TL', null, null, 'DL', null, null],
  ['TW', null, null, 'DL', null, null, null, 'DW', null, null, null, 'DL', null, null, 'TW'],
  [null, null, null, null, 'DL', null, null, null, null, null, 'DL', null, null, null, null],
  [null, 'DW', null, null, null, null, 'TL', null, 'TL', null, null, null, null, 'DW', null],
  ['TL', null, null, 'TW', null, null, null, 'DL', null, null, null, 'TW', null, null, 'TL'],
] as PremiumType[][];

export const LETTER_SCORES: Record<string, number> = {
  A: 1,
  B: 3,
  C: 3,
  D: 2,
  E: 1,
  F: 4,
  G: 2,
  H: 4,
  I: 1,
  J: 8,
  K: 5,
  L: 1,
  M: 3,
  N: 1,
  O: 1,
  P: 3,
  Q: 10,
  R: 1,
  S: 1,
  T: 1,
  U: 1,
  V: 4,
  W: 4,
  X: 8,
  Y: 4,
  Z: 10,
};

export const TILE_DISTRIBUTION: Record<string, number> = {
  A: 9,
  B: 2,
  C: 2,
  D: 4,
  E: 12,
  F: 2,
  G: 3,
  H: 2,
  I: 9,
  J: 1,
  K: 1,
  L: 4,
  M: 2,
  N: 6,
  O: 8,
  P: 2,
  Q: 1,
  R: 6,
  S: 4,
  T: 6,
  U: 4,
  V: 2,
  W: 2,
  X: 1,
  Y: 2,
  Z: 1,
  '?': 2,
};

export function emptyPremiumBoard(): PremiumType[][] {
  return Array.from({ length: BOARD_SIZE }, () => EMPTY_ROW.slice());
}
