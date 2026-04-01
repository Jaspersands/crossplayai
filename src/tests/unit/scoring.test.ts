import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../../lib/boardUtils';
import { evaluatePlacement } from '../../lib/scoring';

describe('scoring', () => {
  it('scores center opening word using Crossplay premium layout', () => {
    const board = createEmptyBoard();
    const score = evaluatePlacement(
      board,
      {
        word: 'QUIZ',
        row: 7,
        col: 7,
        direction: 'across',
      },
      new Set(),
    );

    expect(score.score).toBe(24);
  });

  it('uses Crossplay tile values for H instead of Scrabble values', () => {
    const board = createEmptyBoard();
    const score = evaluatePlacement(
      board,
      {
        word: 'HE',
        row: 7,
        col: 7,
        direction: 'across',
      },
      new Set(),
    );

    expect(score.score).toBe(4);
  });

  it('adds the Crossplay 40-point sweep bonus when all seven rack tiles are used', () => {
    const board = createEmptyBoard();
    const score = evaluatePlacement(
      board,
      {
        word: 'AEINRST',
        row: 7,
        col: 4,
        direction: 'across',
      },
      new Set(),
    );

    expect(score.usedRackTiles).toBe(7);
    expect(score.score).toBe(49);
  });

  it('counts blank tile as zero letter score', () => {
    const board = createEmptyBoard();
    const score = evaluatePlacement(
      board,
      {
        word: 'CAT',
        row: 7,
        col: 7,
        direction: 'across',
      },
      new Set([0]),
    );

    expect(score.score).toBe(3);
  });

  it('tracks cross-word density and clustered hook placements', () => {
    const board = createEmptyBoard();
    board[7][6] = { letter: 'A', isBlank: false };
    board[7][8] = { letter: 'A', isBlank: false };
    board[6][7] = { letter: 'N', isBlank: false };
    board[8][7] = { letter: 'T', isBlank: false };

    const score = evaluatePlacement(
      board,
      {
        word: 'ABA',
        row: 7,
        col: 6,
        direction: 'across',
      },
      new Set(),
    );

    expect(score.crossWordCount).toBe(1);
    expect(score.crossWordLetters).toBe(3);
    expect(score.adjacentExistingTileCount).toBe(4);
    expect(score.maxAdjacentExistingTiles).toBe(4);
    expect(score.threadedTileCount).toBe(1);
  });
});
