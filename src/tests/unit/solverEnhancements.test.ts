import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../../lib/boardUtils';
import { solveMovesWithLexicon } from '../../lib/solver';
import { createTrie } from '../../lib/trie';
import { rackFromText } from '../testUtils';

describe('solver equity ranking', () => {
  it('ranks moves by score + leave value', () => {
    const words = new Set(['QUIZ', 'QUIT', 'QI', 'ZA']);
    const lexicon = {
      id: 'equity-test',
      words,
      trie: createTrie(words),
    };

    const moves = solveMovesWithLexicon(
      {
        board: createEmptyBoard(),
        rack: rackFromText('QUIZAET'),
        lexiconId: 'equity-test',
        topN: 5,
      },
      lexicon,
    );

    expect(moves.length).toBeGreaterThan(0);

    // Moves should be sorted by totalEval descending
    for (let i = 1; i < moves.length; i += 1) {
      expect(moves[i - 1].totalEval).toBeGreaterThanOrEqual(moves[i].totalEval);
    }

    // totalEval should equal score + leaveValue
    for (const move of moves) {
      const expected = Number((move.score + move.leaveValue).toFixed(2));
      expect(move.totalEval).toBe(expected);
    }
  });
});
