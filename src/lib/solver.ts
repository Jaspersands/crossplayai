import {
  ALPHABET,
  MAX_RACK_SIZE,
} from '../config/solver';
import { evaluateLeaveValue } from './leave';
import type { Board, Direction, MoveCandidate, RackTile, SolveInput } from '../types/game';
import { getLexiconById } from './dictionary';
import {
  buildPerpendicularWordString,
  evaluatePlacement,
  moveTouchesExistingTile,
  validateMoveBoundaries,
  type MoveSpec,
} from './scoring';
import type { Trie, TrieNode } from './trie';

export type SolverLexicon = {
  id: string;
  trie: Trie;
  words: Set<string>;
};

type RackInventory = {
  counts: Map<string, number>;
  blanks: number;
};

type RackUsage = {
  counts: Map<string, number>;
  blanks: number;
};

type Placement = {
  row: number;
  col: number;
  length: number;
  direction: Direction;
  key: string;
};

type SolverMode = 'full' | 'scoreOnly';

type SolverContext = {
  mode: SolverMode;
  lexicon: SolverLexicon;
};

type CandidateContext = {
  candidate: MoveCandidate;
  spec: MoveSpec;
  blankIndices: Set<number>;
  rackUsage: RackUsage;
};

function round(value: number): number {
  return Number(value.toFixed(2));
}

function buildRackInventory(rack: RackTile[]): RackInventory {
  const counts = new Map<string, number>();
  let blanks = 0;

  for (const tile of rack.slice(0, MAX_RACK_SIZE)) {
    if (tile.isBlank) {
      blanks += 1;
      continue;
    }

    const letter = tile.letter.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
    if (!letter) {
      continue;
    }

    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }

  return {
    counts,
    blanks,
  };
}

function rackInventoryCount(rack: RackInventory): number {
  let total = rack.blanks;
  for (const count of rack.counts.values()) {
    total += count;
  }
  return total;
}

function cloneUsage(usage: RackUsage): RackUsage {
  return {
    counts: new Map(usage.counts),
    blanks: usage.blanks,
  };
}

function buildRemainingRackInventory(rack: RackInventory, usage: RackUsage): RackInventory {
  const counts = new Map<string, number>();

  for (const letter of ALPHABET) {
    const remain = (rack.counts.get(letter) ?? 0) - (usage.counts.get(letter) ?? 0);
    if (remain > 0) {
      counts.set(letter, remain);
    }
  }

  return {
    counts,
    blanks: Math.max(0, rack.blanks - usage.blanks),
  };
}

function rackTileCountForPlacement(board: Board, placement: Placement): number {
  const { row, col, length, direction } = placement;
  let emptyCells = 0;

  for (let i = 0; i < length; i += 1) {
    const r = direction === 'across' ? row : row + i;
    const c = direction === 'across' ? col + i : col;
    if (!board[r][c].letter) {
      emptyCells += 1;
    }
  }

  return emptyCells;
}

function hasTileBefore(board: Board, row: number, col: number, direction: Direction): boolean {
  if (direction === 'across') {
    return col > 0 && Boolean(board[row][col - 1].letter);
  }
  return row > 0 && Boolean(board[row - 1][col].letter);
}

function hasTileAfter(board: Board, row: number, col: number, length: number, direction: Direction): boolean {
  if (direction === 'across') {
    const nextCol = col + length;
    return nextCol < 15 && Boolean(board[row][nextCol].letter);
  }
  const nextRow = row + length;
  return nextRow < 15 && Boolean(board[nextRow][col].letter);
}

function generatePlacements(
  board: Board,
  anchors: Array<{ row: number; col: number }>,
  rackSize: number,
): Placement[] {
  const placementMap = new Map<string, Placement>();

  for (const anchor of anchors) {
    for (const direction of ['across', 'down'] as const) {
      for (let startOffset = 0; startOffset <= 14; startOffset += 1) {
        const startRow = direction === 'across' ? anchor.row : anchor.row - startOffset;
        const startCol = direction === 'across' ? anchor.col - startOffset : anchor.col;

        if (startRow < 0 || startCol < 0 || startRow >= 15 || startCol >= 15) {
          continue;
        }

        if (hasTileBefore(board, startRow, startCol, direction)) {
          continue;
        }

        for (let length = 2; length <= 15; length += 1) {
          const endRow = direction === 'across' ? startRow : startRow + (length - 1);
          const endCol = direction === 'across' ? startCol + (length - 1) : startCol;

          if (endRow >= 15 || endCol >= 15) {
            break;
          }

          if (direction === 'across') {
            if (!(anchor.row === startRow && anchor.col >= startCol && anchor.col <= endCol)) {
              continue;
            }
          } else if (!(anchor.col === startCol && anchor.row >= startRow && anchor.row <= endRow)) {
            continue;
          }

          if (hasTileAfter(board, startRow, startCol, length, direction)) {
            continue;
          }

          const placement: Placement = {
            row: startRow,
            col: startCol,
            length,
            direction,
            key: `${startRow}:${startCol}:${direction}:${length}`,
          };

          const rackTilesNeeded = rackTileCountForPlacement(board, placement);
          if (rackTilesNeeded === 0 || rackTilesNeeded > rackSize) {
            continue;
          }

          placementMap.set(placement.key, placement);
        }
      }
    }
  }

  return Array.from(placementMap.values());
}

function buildCrossWord(
  board: Board,
  row: number,
  col: number,
  direction: Direction,
  letter: string,
): string {
  return buildPerpendicularWordString(board, row, col, direction, letter);
}

function canPlaceLetterFromRack(
  rack: RackInventory,
  usage: RackUsage,
  letter: string,
): { ok: boolean; usesBlank: boolean } {
  const available = (rack.counts.get(letter) ?? 0) - (usage.counts.get(letter) ?? 0);
  if (available > 0) {
    return { ok: true, usesBlank: false };
  }

  const blankAvailable = rack.blanks - usage.blanks;
  if (blankAvailable > 0) {
    return { ok: true, usesBlank: true };
  }

  return { ok: false, usesBlank: false };
}

function recordRackUsage(usage: RackUsage, letter: string, usesBlank: boolean): RackUsage {
  const next = cloneUsage(usage);
  if (usesBlank) {
    next.blanks += 1;
  } else {
    next.counts.set(letter, (next.counts.get(letter) ?? 0) + 1);
  }
  return next;
}

function rackUsageCount(usage: RackUsage): number {
  let count = usage.blanks;
  for (const value of usage.counts.values()) {
    count += value;
  }
  return count;
}

function explorePlacement(
  board: Board,
  placement: Placement,
  node: TrieNode,
  index: number,
  builtWord: string,
  blankIndices: Set<number>,
  rack: RackInventory,
  usage: RackUsage,
  hasBoardContact: boolean,
  requireBoardContact: boolean,
  lexiconHasWord: (word: string) => boolean,
  acceptCandidate: (word: string, blankIndices: Set<number>, usage: RackUsage) => void,
  trieGetChild: (trieNode: TrieNode, letter: string) => TrieNode | undefined,
): void {
  if (index === placement.length) {
    if (!node.isWord) {
      return;
    }
    if (rackUsageCount(usage) === 0) {
      return;
    }
    if (requireBoardContact && !hasBoardContact) {
      return;
    }
    acceptCandidate(builtWord, blankIndices, usage);
    return;
  }

  const row = placement.direction === 'across' ? placement.row : placement.row + index;
  const col = placement.direction === 'across' ? placement.col + index : placement.col;

  const existingCell = board[row][col];

  if (existingCell.letter) {
    const child = trieGetChild(node, existingCell.letter);
    if (!child) {
      return;
    }

    explorePlacement(
      board,
      placement,
      child,
      index + 1,
      `${builtWord}${existingCell.letter}`,
      blankIndices,
      rack,
      usage,
      true,
      requireBoardContact,
      lexiconHasWord,
      acceptCandidate,
      trieGetChild,
    );
    return;
  }

  for (const [letter, child] of node.children.entries()) {
    const fromRack = canPlaceLetterFromRack(rack, usage, letter);
    if (!fromRack.ok) {
      continue;
    }

    const crossWord = buildCrossWord(board, row, col, placement.direction, letter);
    if (crossWord.length > 1 && !lexiconHasWord(crossWord)) {
      continue;
    }

    const nextUsage = recordRackUsage(usage, letter, fromRack.usesBlank);
    const nextBlankIndices = new Set(blankIndices);
    if (fromRack.usesBlank) {
      nextBlankIndices.add(index);
    }

    explorePlacement(
      board,
      placement,
      child,
      index + 1,
      `${builtWord}${letter}`,
      nextBlankIndices,
      rack,
      nextUsage,
      hasBoardContact || crossWord.length > 1,
      requireBoardContact,
      lexiconHasWord,
      acceptCandidate,
      trieGetChild,
    );
  }
}

function moveKey(candidate: MoveCandidate): string {
  return `${candidate.word}:${candidate.row}:${candidate.col}:${candidate.direction}`;
}

function isCandidateBetter(next: MoveCandidate, previous: MoveCandidate): boolean {
  if (next.totalEval !== previous.totalEval) {
    return next.totalEval > previous.totalEval;
  }
  if (next.score !== previous.score) {
    return next.score > previous.score;
  }
  return next.word.localeCompare(previous.word) < 0;
}

function buildAnchors(board: Board): Array<{ row: number; col: number }> {
  const boardHasTiles = board.some((boardRow) => boardRow.some((boardCell) => Boolean(boardCell.letter)));

  if (!boardHasTiles) {
    return [{ row: 7, col: 7 }];
  }

  return board.flatMap((row, rowIndex) =>
    row.flatMap((cell, colIndex) => {
      if (cell.letter) {
        return [] as Array<{ row: number; col: number }>;
      }

      const neighbors = [
        [rowIndex - 1, colIndex],
        [rowIndex + 1, colIndex],
        [rowIndex, colIndex - 1],
        [rowIndex, colIndex + 1],
      ];

      const hasNeighbor = neighbors.some(
        ([r, c]) => r >= 0 && r < 15 && c >= 0 && c < 15 && Boolean(board[r][c].letter),
      );

      return hasNeighbor ? [{ row: rowIndex, col: colIndex }] : [];
    }),
  );
}

function evaluateCandidate(
  board: Board,
  spec: MoveSpec,
  blankIndices: Set<number>,
  rack: RackInventory,
  rackUsage: RackUsage,
  context: SolverContext,
): MoveCandidate {
  const placementEval = evaluatePlacement(board, spec, blankIndices);

  if (context.mode === 'scoreOnly') {
    return {
      word: spec.word,
      row: spec.row,
      col: spec.col,
      direction: spec.direction,
      score: placementEval.score,
      leaveValue: 0,
      totalEval: placementEval.score,
    };
  }

  const remainingRack = buildRemainingRackInventory(rack, rackUsage);
  const leaveValue = evaluateLeaveValue(remainingRack);

  // Equity = Score + Leave Value (standard competitive Scrabble ranking)
  const totalEval = round(placementEval.score + leaveValue);

  return {
    word: spec.word,
    row: spec.row,
    col: spec.col,
    direction: spec.direction,
    score: placementEval.score,
    leaveValue,
    totalEval,
  };
}

function enumerateCandidates(
  input: SolveInput,
  context: SolverContext,
): CandidateContext[] {
  const rack = buildRackInventory(input.rack);
  const rackSize = Math.min(MAX_RACK_SIZE, rackInventoryCount(rack));
  if (rackSize <= 0) {
    return [];
  }

  const anchors = buildAnchors(input.board);
  const placements = generatePlacements(input.board, anchors, rackSize);
  const accepted = new Map<string, CandidateContext>();
  const boardHasTiles = input.board.some((boardRow) => boardRow.some((boardCell) => Boolean(boardCell.letter)));

  for (const placement of placements) {
    const usage: RackUsage = {
      counts: new Map(),
      blanks: 0,
    };

    explorePlacement(
      input.board,
      placement,
      context.lexicon.trie.root,
      0,
      '',
      new Set<number>(),
      rack,
      usage,
      false,
      boardHasTiles,
      context.lexicon.words.has.bind(context.lexicon.words),
      (word, blankIndices, candidateRackUsage) => {
        const spec: MoveSpec = {
          word,
          row: placement.row,
          col: placement.col,
          direction: placement.direction,
        };

        if (!validateMoveBoundaries(input.board, spec)) {
          return;
        }

        if (!moveTouchesExistingTile(input.board, spec)) {
          return;
        }

        const candidate = evaluateCandidate(
          input.board,
          spec,
          blankIndices,
          rack,
          candidateRackUsage,
          context,
        );

        const candidateContext: CandidateContext = {
          candidate,
          spec,
          blankIndices: new Set(blankIndices),
          rackUsage: cloneUsage(candidateRackUsage),
        };

        const key = moveKey(candidate);
        const previous = accepted.get(key);
        if (!previous || isCandidateBetter(candidateContext.candidate, previous.candidate)) {
          accepted.set(key, candidateContext);
        }
      },
      context.lexicon.trie.getChild,
    );
  }

  return Array.from(accepted.values())
    .sort(
      (a, b) =>
        b.candidate.totalEval - a.candidate.totalEval ||
        b.candidate.score - a.candidate.score ||
        a.candidate.word.localeCompare(b.candidate.word),
    );
}

function solveMovesInternal(input: SolveInput, context: SolverContext): MoveCandidate[] {
  const candidates = enumerateCandidates(input, context);

  return candidates
    .sort(
      (a, b) =>
        b.candidate.totalEval - a.candidate.totalEval ||
        b.candidate.score - a.candidate.score ||
        a.candidate.word.localeCompare(b.candidate.word),
    )
    .slice(0, Math.max(1, input.topN))
    .map((entry) => entry.candidate);
}

export function solveMovesWithLexicon(
  input: SolveInput,
  lexicon: SolverLexicon,
): MoveCandidate[] {
  return solveMovesInternal(input, {
    mode: 'full',
    lexicon,
  });
}

export function solveMoves(input: SolveInput): MoveCandidate[] {
  const lexicon = getLexiconById(input.lexiconId);
  return solveMovesWithLexicon(input, {
    id: lexicon.meta.id,
    trie: lexicon.trie,
    words: lexicon.words,
  });
}
