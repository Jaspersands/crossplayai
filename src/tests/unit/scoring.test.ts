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
});
