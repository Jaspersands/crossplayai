import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../../lib/boardUtils';
import { solveMovesWithLexicon } from '../../lib/solver';
import { evaluateDefensePenalty } from '../../lib/defense';
import { createTrie } from '../../lib/trie';
import type { Board, MoveCandidate } from '../../types/game';
import { rackFromText } from '../testUtils';

function applyMove(board: Board, move: MoveCandidate): {
  boardAfter: Board;
  placedTiles: Array<{ row: number; col: number; letter: string; isBlank: boolean }>;
} {
  const boardAfter = board.map((row) => row.map((cell) => ({ ...cell })));
  const placedTiles: Array<{ row: number; col: number; letter: string; isBlank: boolean }> = [];
  const dr = move.direction === 'across' ? 0 : 1;
  const dc = move.direction === 'across' ? 1 : 0;

  for (let i = 0; i < move.word.length; i += 1) {
    const row = move.row + dr * i;
    const col = move.col + dc * i;
    if (boardAfter[row][col].letter) {
      continue;
    }

    boardAfter[row][col] = {
      letter: move.word[i],
      isBlank: false,
    };
    placedTiles.push({
      row,
      col,
      letter: move.word[i],
      isBlank: false,
    });
  }

  return { boardAfter, placedTiles };
}

describe('solver enhancements', () => {
  it('computes defense penalty against post-move board occupancy', () => {
    const board = createEmptyBoard();
    board[7][2] = { letter: 'I', isBlank: false };

    const words = new Set(['ION', 'IONS', 'IN', 'ON', 'NO', 'SO', 'SON', 'SONE', 'ONE']);
    const lexicon = {
      id: 'defense-post-board',
      words,
      trie: createTrie(words),
    };

    const moves = solveMovesWithLexicon(
      {
        board,
        rack: rackFromText('ONSEAAA'),
        lexiconId: 'defense-post-board',
        topN: 8,
      },
      lexicon,
      new Set(),
    );

    expect(moves.length).toBeGreaterThan(0);

    let changedIfPreBoard = 0;

    for (const move of moves) {
      const { boardAfter, placedTiles } = applyMove(board, move);
      const postPenalty = evaluateDefensePenalty(boardAfter, placedTiles, move.direction);
      const prePenalty = evaluateDefensePenalty(board, placedTiles, move.direction);

      expect(move.defensePenalty).toBe(postPenalty);
      if (postPenalty !== prePenalty) {
        changedIfPreBoard += 1;
      }
    }

    expect(changedIfPreBoard).toBeGreaterThan(0);
  });

  it('adds two-ply lookahead metrics to ranked moves', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const words = new Set<string>(['QUIZ', 'QUIT', 'QI', 'ZA']);
    for (const a of alphabet) {
      for (const b of alphabet) {
        words.add(`${a}${b}`);
      }
    }

    const lexicon = {
      id: 'lookahead-metrics',
      words,
      trie: createTrie(words),
    };

    const moves = solveMovesWithLexicon(
      {
        board: createEmptyBoard(),
        rack: rackFromText('QUIZAET'),
        lexiconId: 'lookahead-metrics',
        topN: 5,
      },
      lexicon,
      new Set(),
    );

    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(move.lookaheadPenalty).toBeGreaterThanOrEqual(0);
      expect(move.opponentReplyScore).toBeGreaterThanOrEqual(0);
    }
    expect(moves.some((move) => move.lookaheadPenalty > 0)).toBe(true);
  });
});
