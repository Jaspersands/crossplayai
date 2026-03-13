import { ALPHABET } from '../config/solver';
import { LETTER_LEAVE_VALUES } from '../data/leaveValues';

export type LeaveInventory = {
  counts: Map<string, number>;
  blanks: number;
};

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

const PAIR_BONUS: Record<string, number> = {
  ER: 0.55,
  IN: 0.5,
  ES: 0.5,
  EN: 0.45,
  ST: 0.45,
  AN: 0.42,
  ON: 0.42,
  OR: 0.4,
  RT: 0.35,
  IS: 0.35,
  AR: 0.35,
  ED: 0.35,
  AL: 0.3,
  AT: 0.3,
  TI: 0.24,
  QU: 0.75,
  AE: 0.15,
  EI: 0.15,
};

const PAIR_PENALTY: Record<string, number> = {
  UU: 1.25,
  II: 0.95,
  VV: 0.95,
  WW: 0.85,
  YY: 0.7,
  JQ: 2.4,
  QZ: 2.1,
  QX: 1.8,
  QK: 1.6,
  QV: 1.6,
};

const TRIPLE_BONUS: Record<string, number> = {
  EIN: 0.8,
  ERT: 0.76,
  AIN: 0.72,
  AER: 0.7,
  ENT: 0.68,
  ENS: 0.65,
  EST: 0.85,
  ERS: 0.95,
  GIN: 1.1,
  ION: 0.72,
  ORT: 0.6,
};

const DUPLICATE_PENALTY_PER_EXTRA: Record<string, number> = {
  S: 0.06,
  E: 0.12,
  R: 0.15,
  T: 0.15,
  N: 0.15,
  A: 0.2,
  L: 0.2,
  O: 0.24,
  I: 0.26,
  U: 0.35,
};

function round(value: number): number {
  return Number(value.toFixed(2));
}

function sortedKey(letters: string[]): string {
  return [...letters].sort().join('');
}

function getCount(counts: Map<string, number>, letter: string): number {
  return counts.get(letter) ?? 0;
}

function combinationCount(counts: Map<string, number>, token: string): number {
  const frequency = new Map<string, number>();
  for (const letter of token) {
    frequency.set(letter, (frequency.get(letter) ?? 0) + 1);
  }

  let count = Infinity;
  for (const [letter, required] of frequency.entries()) {
    count = Math.min(count, Math.floor(getCount(counts, letter) / required));
  }

  return Number.isFinite(count) ? count : 0;
}

function inventoryLetters(counts: Map<string, number>): string[] {
  const letters: string[] = [];
  for (const letter of ALPHABET) {
    const count = counts.get(letter) ?? 0;
    for (let i = 0; i < count; i += 1) {
      letters.push(letter);
    }
  }
  return letters;
}

export function evaluateLeaveValue(inventory: LeaveInventory): number {
  const counts = inventory.counts;
  let value = 0;

  for (const letter of ALPHABET) {
    const count = counts.get(letter) ?? 0;
    if (count > 0) {
      value += count * (LETTER_LEAVE_VALUES[letter] ?? 0);
    }
  }

  if (inventory.blanks > 0) {
    value += inventory.blanks * (LETTER_LEAVE_VALUES['?'] ?? 0);
  }

  for (const [token, bonus] of Object.entries(PAIR_BONUS)) {
    const matches = combinationCount(counts, token);
    if (matches > 0) {
      value += matches * bonus;
    }
  }

  for (const [token, penalty] of Object.entries(PAIR_PENALTY)) {
    const matches = combinationCount(counts, token);
    if (matches > 0) {
      value -= matches * penalty;
    }
  }

  for (const [token, bonus] of Object.entries(TRIPLE_BONUS)) {
    const matches = combinationCount(counts, token);
    if (matches > 0) {
      value += matches * bonus;
    }
  }

  for (const letter of ALPHABET) {
    const count = counts.get(letter) ?? 0;
    if (count <= 1) {
      continue;
    }

    const penaltyPerExtra = DUPLICATE_PENALTY_PER_EXTRA[letter] ?? 0.34;
    for (let extra = 1; extra < count; extra += 1) {
      value -= penaltyPerExtra * (1 + extra * 0.22);
    }
  }

  const letters = inventoryLetters(counts);
  const total = letters.length;
  if (total > 0) {
    let vowels = 0;
    for (const letter of letters) {
      if (VOWELS.has(letter)) {
        vowels += 1;
      }
    }
    const consonants = total - vowels;
    const ratio = vowels / total;
    const targetRatio = total >= 5 ? 0.4 : 0.45;
    value -= Math.abs(ratio - targetRatio) * total * 1.7;

    if (vowels === 0 || consonants === 0) {
      value -= 2.1;
    } else if (vowels >= 5 || consonants >= 6) {
      value -= 1.15;
    }
  }

  const qCount = getCount(counts, 'Q');
  if (qCount > 0) {
    const uCount = getCount(counts, 'U');
    if (uCount === 0) {
      value -= qCount * 6.2;
    } else {
      value -= Math.max(0, qCount - uCount) * 2.2;
      value -= Math.min(qCount, uCount) * 0.45;
    }
  }

  if (inventory.blanks > 0) {
    const sCount = getCount(counts, 'S');
    const eCount = getCount(counts, 'E');
    value += Math.min(inventory.blanks, sCount) * 0.45;
    value += Math.min(inventory.blanks, eCount) * 0.25;
  }

  const sortedRackKey = sortedKey(letters);
  if (sortedRackKey === 'AEIRST') {
    value += 0.9;
  }

  return round(value);
}
