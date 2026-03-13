import { sanitizeWord } from './boardUtils';

export type TrieNode = {
  children: Map<string, TrieNode>;
  isWord: boolean;
};

export type Trie = {
  root: TrieNode;
  wordCount: number;
  hasWord: (word: string) => boolean;
  getChild: (node: TrieNode, letter: string) => TrieNode | undefined;
};

function createNode(): TrieNode {
  return {
    children: new Map<string, TrieNode>(),
    isWord: false,
  };
}

export function createTrie(words: Iterable<string>): Trie {
  const root = createNode();
  let wordCount = 0;

  for (const rawWord of words) {
    const word = sanitizeWord(rawWord);
    if (!word || word.length > 15) {
      continue;
    }

    let cursor = root;
    for (const letter of word) {
      let next = cursor.children.get(letter);
      if (!next) {
        next = createNode();
        cursor.children.set(letter, next);
      }
      cursor = next;
    }

    if (!cursor.isWord) {
      cursor.isWord = true;
      wordCount += 1;
    }
  }

  const hasWord = (wordInput: string): boolean => {
    const word = sanitizeWord(wordInput);
    if (!word) {
      return false;
    }

    let cursor = root;
    for (const letter of word) {
      const next = cursor.children.get(letter);
      if (!next) {
        return false;
      }
      cursor = next;
    }
    return cursor.isWord;
  };

  return {
    root,
    wordCount,
    hasWord,
    getChild: (node: TrieNode, letter: string) => node.children.get(letter),
  };
}
