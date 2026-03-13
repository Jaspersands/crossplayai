import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../../lib/boardUtils';
import { solveMovesWithLexicon } from '../../lib/solver';
import { createTrie } from '../../lib/trie';
import { rackFromText } from '../testUtils';

describe('move legality', () => {
  it('first move always covers center', () => {
    const words = new Set(['CAT', 'ACT', 'TAC']);
    const lexicon = {
      id: 'test',
      words,
      trie: createTrie(words),
    };

    const moves = solveMovesWithLexicon(
      {
        board: createEmptyBoard(),
        rack: rackFromText('CAT'),
        lexiconId: 'test',
        topN: 10,
      },
      lexicon,
      new Set(),
    );

    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      const coversCenter = Array.from({ length: move.word.length }, (_, index) => {
        const row = move.direction === 'across' ? move.row : move.row + index;
        const col = move.direction === 'across' ? move.col + index : move.col;
        return row === 7 && col === 7;
      }).some(Boolean);
      expect(coversCenter).toBe(true);
    }
  });
});
