import { describe, expect, it } from 'vitest';
import { createTrie } from '../../lib/trie';

describe('trie', () => {
  it('finds inserted words and rejects missing words', () => {
    const trie = createTrie(['CAT', 'CATER', 'DOG']);

    expect(trie.hasWord('CAT')).toBe(true);
    expect(trie.hasWord('CATER')).toBe(true);
    expect(trie.hasWord('DOG')).toBe(true);
    expect(trie.hasWord('DO')).toBe(false);
    expect(trie.hasWord('MOUSE')).toBe(false);
  });
});
