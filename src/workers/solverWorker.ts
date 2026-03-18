/// <reference lib="webworker" />

import { solveMovesWithLexicon, type SolverLexicon } from '../lib/solver';
import { createTrie } from '../lib/trie';
import type { SolveWorkerRequest, SolveWorkerResponse } from '../types/game';

let lexicon: SolverLexicon | null = null;

self.onmessage = async (event: MessageEvent<SolveWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'initLexicon') {
    try {
      const words = new Set(
        message.payload.words
          .map((word) => word.toUpperCase().replace(/[^A-Z]/g, ''))
          .filter((word) => word.length >= 2 && word.length <= 15),
      );

      lexicon = {
        id: message.payload.id,
        words,
        trie: createTrie(words),
      };

      const response: SolveWorkerResponse = {
        id: message.id,
        type: 'lexiconReady',
        payload: [],
      };
      self.postMessage(response);
    } catch (error) {
      const response: SolveWorkerResponse = {
        id: message.id,
        type: 'error',
        payload: {
          message: error instanceof Error ? error.message : 'Failed to initialize lexicon',
        },
      };
      self.postMessage(response);
    }
    return;
  }

  if (message.type !== 'solve') {
    return;
  }

  try {
    if (!lexicon || lexicon.id !== message.payload.lexiconId) {
      throw new Error('Solver lexicon is not initialized.');
    }

    const moves = solveMovesWithLexicon(message.payload, lexicon);
    const response: SolveWorkerResponse = {
      id: message.id,
      type: 'solveResult',
      payload: moves,
    };
    self.postMessage(response);
  } catch (error) {
    const response: SolveWorkerResponse = {
      id: message.id,
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Solving failed',
      },
    };
    self.postMessage(response);
  }
};

export {};
