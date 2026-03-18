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
  B: 4,
  C: 3,
  D: 2,
  E: 1,
  F: 4,
  G: 4,
  H: 3,
  I: 1,
  J: 10,
  K: 6,
  L: 2,
  M: 3,
  N: 1,
  O: 1,
  P: 3,
  Q: 10,
  R: 1,
  S: 1,
  T: 1,
  U: 2,
  V: 6,
  W: 5,
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
  H: 3,
  I: 8,
  J: 1,
  K: 1,
  L: 4,
  M: 2,
  N: 5,
  O: 8,
  P: 2,
  Q: 1,
  R: 6,
  S: 5,
  T: 6,
  U: 3,
  V: 2,
  W: 2,
  X: 1,
  Y: 2,
  Z: 1,
  '?': 3,
};

export function emptyPremiumBoard(): PremiumType[][] {
  return Array.from({ length: BOARD_SIZE }, () => EMPTY_ROW.slice());
}
