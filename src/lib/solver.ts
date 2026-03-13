import {
  ALPHABET,
  LOOKAHEAD_RACK_SAMPLES,
  LOOKAHEAD_REPLY_WEIGHT,
  LOOKAHEAD_TOP_K,
  MAX_RACK_SIZE,
} from '../config/solver';
import { TILE_DISTRIBUTION } from '../constants/board';
import { evaluateLeaveValue } from './leave';
import type { Board, Direction, MoveCandidate, RackTile, SolveInput } from '../types/game';
import { getLexiconById } from './dictionary';
import { evaluateDefensePenalty } from './defense';
import { assessWordRisk } from './risk';
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
  blocklist: Set<string>;
  applyLookahead: boolean;
};

type CandidateContext = {
  candidate: MoveCandidate;
  spec: MoveSpec;
  blankIndices: Set<number>;
  rackUsage: RackUsage;
};

const SCORE_ONLY_RISK: MoveCandidate['risk'] = {
  label: 'low',
  score: 0,
  reasons: ['Score-only opponent evaluation.'],
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

function applyMoveToBoard(board: Board, move: MoveSpec, blankPositions: Set<number>): Board {
  const nextBoard = board.map((row) => row.map((cell) => ({ ...cell })));
  const dr = move.direction === 'across' ? 0 : 1;
  const dc = move.direction === 'across' ? 1 : 0;

  for (let i = 0; i < move.word.length; i += 1) {
    const row = move.row + dr * i;
    const col = move.col + dc * i;

    if (nextBoard[row][col].letter) {
      continue;
    }

    nextBoard[row][col] = {
      letter: move.word[i],
      isBlank: blankPositions.has(i),
    };
  }

  return nextBoard;
}

type TileBag = Map<string, number>;

function createTileBag(): TileBag {
  const bag = new Map<string, number>();
  for (const [tile, count] of Object.entries(TILE_DISTRIBUTION)) {
    bag.set(tile, count);
  }
  return bag;
}

function removeFromBag(bag: TileBag, tile: string, count = 1): void {
  const current = bag.get(tile) ?? 0;
  if (current <= 0) {
    return;
  }
  bag.set(tile, Math.max(0, current - count));
}

function bagTileCount(bag: TileBag): number {
  let total = 0;
  for (const count of bag.values()) {
    total += count;
  }
  return total;
}

function subtractBoardTilesFromBag(bag: TileBag, board: Board): void {
  for (const row of board) {
    for (const cell of row) {
      if (!cell.letter) {
        continue;
      }
      removeFromBag(bag, cell.isBlank ? '?' : cell.letter, 1);
    }
  }
}

function subtractInventoryFromBag(bag: TileBag, inventory: RackInventory): void {
  for (const [letter, count] of inventory.counts.entries()) {
    removeFromBag(bag, letter, count);
  }
  if (inventory.blanks > 0) {
    removeFromBag(bag, '?', inventory.blanks);
  }
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    return ((state >>> 0) & 0xffffffff) / 0x100000000;
  };
}

function drawSampleRackFromBag(baseBag: TileBag, targetSize: number, seed: number): RackTile[] {
  const bag = new Map(baseBag);
  const drawCount = Math.min(targetSize, bagTileCount(bag));
  const rng = seededRandom(seed);
  const rack: RackTile[] = [];

  for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
    const total = bagTileCount(bag);
    if (total <= 0) {
      break;
    }

    const target = rng() * total;
    let cumulative = 0;
    let selected: string | null = null;

    for (const [tile, count] of bag.entries()) {
      if (count <= 0) {
        continue;
      }

      cumulative += count;
      if (target < cumulative) {
        selected = tile;
        break;
      }
    }

    if (!selected) {
      break;
    }

    removeFromBag(bag, selected, 1);
    rack.push(
      selected === '?'
        ? { letter: '', isBlank: true }
        : { letter: selected, isBlank: false },
    );
  }

  return rack;
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
      defensePenalty: 0,
      lookaheadPenalty: 0,
      opponentReplyScore: 0,
      risk: SCORE_ONLY_RISK,
      totalEval: placementEval.score,
    };
  }

  const postMoveBoard = applyMoveToBoard(board, spec, blankIndices);
  const remainingRack = buildRemainingRackInventory(rack, rackUsage);
  const leaveValue = evaluateLeaveValue(remainingRack);
  const defensePenalty = evaluateDefensePenalty(postMoveBoard, placementEval.placedTiles, spec.direction);
  const risk = assessWordRisk(spec.word, { blocklist: context.blocklist });

  const totalEval = round(placementEval.score + leaveValue - defensePenalty - risk.score * 1.5);

  return {
    word: spec.word,
    row: spec.row,
    col: spec.col,
    direction: spec.direction,
    score: placementEval.score,
    leaveValue,
    defensePenalty,
    lookaheadPenalty: 0,
    opponentReplyScore: 0,
    risk,
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

function estimateOpponentReplyScore(
  boardAfterMove: Board,
  remainingPlayerRack: RackInventory,
  context: SolverContext,
  seedKey: string,
): number {
  const tileBag = createTileBag();
  subtractBoardTilesFromBag(tileBag, boardAfterMove);
  subtractInventoryFromBag(tileBag, remainingPlayerRack);

  if (bagTileCount(tileBag) <= 0) {
    return 0;
  }

  let bestReplyScore = 0;
  const baseSeed = hashString(seedKey);

  for (let sample = 0; sample < LOOKAHEAD_RACK_SAMPLES; sample += 1) {
    const rack = drawSampleRackFromBag(tileBag, MAX_RACK_SIZE, baseSeed + sample * 811);
    if (rack.length === 0) {
      continue;
    }

    const replyMoves = solveMovesInternal(
      {
        board: boardAfterMove,
        rack,
        lexiconId: context.lexicon.id,
        topN: 1,
      },
      {
        ...context,
        mode: 'scoreOnly',
        applyLookahead: false,
      },
    );

    const replyScore = replyMoves[0]?.score ?? 0;
    if (replyScore > bestReplyScore) {
      bestReplyScore = replyScore;
    }
  }

  return round(bestReplyScore);
}

function applyLookaheadPenalties(
  sortedCandidates: CandidateContext[],
  input: SolveInput,
  context: SolverContext,
): void {
  if (context.mode !== 'full' || !context.applyLookahead || sortedCandidates.length === 0) {
    return;
  }

  const topK = Math.min(LOOKAHEAD_TOP_K, sortedCandidates.length);
  const rack = buildRackInventory(input.rack);

  for (let index = 0; index < topK; index += 1) {
    const entry = sortedCandidates[index];

    const boardAfterMove = applyMoveToBoard(input.board, entry.spec, entry.blankIndices);
    const remainingRack = buildRemainingRackInventory(rack, entry.rackUsage);
    const opponentReplyScore = estimateOpponentReplyScore(
      boardAfterMove,
      remainingRack,
      context,
      moveKey(entry.candidate),
    );

    const lookaheadPenalty = round(opponentReplyScore * LOOKAHEAD_REPLY_WEIGHT);
    entry.candidate.opponentReplyScore = opponentReplyScore;
    entry.candidate.lookaheadPenalty = lookaheadPenalty;
    entry.candidate.totalEval = round(entry.candidate.totalEval - lookaheadPenalty);
  }
}

function solveMovesInternal(input: SolveInput, context: SolverContext): MoveCandidate[] {
  const candidates = enumerateCandidates(input, context);
  applyLookaheadPenalties(candidates, input, context);

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
  blocklist: Set<string> = new Set(),
): MoveCandidate[] {
  return solveMovesInternal(input, {
    mode: 'full',
    lexicon,
    blocklist,
    applyLookahead: true,
  });
}

export function solveMoves(input: SolveInput, blocklist: Set<string> = new Set()): MoveCandidate[] {
  const lexicon = getLexiconById(input.lexiconId);
  return solveMovesWithLexicon(
    input,
    {
      id: lexicon.meta.id,
      trie: lexicon.trie,
      words: lexicon.words,
    },
    blocklist,
  );
}
