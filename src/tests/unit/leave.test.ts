import { describe, expect, it } from 'vitest';
import { evaluateLeaveValue } from '../../lib/leave';

function inventoryFromText(text: string): { counts: Map<string, number>; blanks: number } {
  const counts = new Map<string, number>();
  let blanks = 0;

  for (const char of text.toUpperCase()) {
    if (char === '?') {
      blanks += 1;
      continue;
    }
    if (!/[A-Z]/.test(char)) {
      continue;
    }
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  return { counts, blanks };
}

describe('leave synergy evaluation', () => {
  it('prefers balanced, synergistic leaves over clunky duplicates', () => {
    const balanced = evaluateLeaveValue(inventoryFromText('AERST'));
    const clunky = evaluateLeaveValue(inventoryFromText('UUVVV'));
    expect(balanced).toBeGreaterThan(clunky);
  });

  it('penalizes Q without U more than Q with U', () => {
    const withoutU = evaluateLeaveValue(inventoryFromText('QAEINR'));
    const withU = evaluateLeaveValue(inventoryFromText('QUAEIN'));
    expect(withoutU).toBeLessThan(withU);
  });

  it('rewards common pair and triple combinations', () => {
    const synergistic = evaluateLeaveValue(inventoryFromText('EINRST'));
    const awkward = evaluateLeaveValue(inventoryFromText('EJNRST'));
    expect(synergistic).toBeGreaterThan(awkward);
  });
});
