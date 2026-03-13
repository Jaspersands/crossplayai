import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../../lib/boardUtils';
import { solveMovesWithLexicon } from '../../lib/solver';
import { createTrie } from '../../lib/trie';
import { rackFromText } from '../testUtils';

describe('solver integration', () => {
  it('produces deterministic top move from corrected state', () => {
    const words = new Set(['QUIZ', 'QUIT', 'QUITE', 'QI', 'ZA']);
    const lexicon = {
      id: 'integration',
      words,
      trie: createTrie(words),
    };

    const correctedState = {
      board: createEmptyBoard(),
      rack: rackFromText('QUIZAET'),
    };

    const moves = solveMovesWithLexicon(
      {
        board: correctedState.board,
        rack: correctedState.rack,
        lexiconId: 'integration',
        topN: 5,
      },
      lexicon,
      new Set(),
    );

    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0].word).toBe('QUITE');
    expect(moves[0].totalEval).toBeGreaterThanOrEqual(moves.at(1)?.totalEval ?? 0);
  });
});
