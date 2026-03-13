import {
  DEFAULT_DICTIONARY_URL,
  FALLBACK_DICTIONARY_URL,
  LOCAL_STORAGE_BLOCKLIST_KEY,
  LOCAL_STORAGE_DICTIONARY_KEY,
} from '../config/solver';
import type { DictionaryMeta, DictionarySource } from '../types/game';
import { sanitizeWord } from './boardUtils';
import { createTrie, type Trie } from './trie';

export type Lexicon = {
  meta: DictionaryMeta;
  trie: Trie;
  words: Set<string>;
};

export type LexiconSnapshot = {
  id: string;
  words: string[];
};

type CachedDictionary = {
  id: string;
  name: string;
  source: string;
  payload: string;
  createdAt: string;
};

const lexiconRegistry = new Map<string, Lexicon>();
const blocklistRegistry = new Set<string>();

function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0).toString(16);
}

function parseWordList(payload: string): string[] {
  return payload
    .split(/\r?\n/)
    .map((line) => sanitizeWord(line))
    .filter((word) => word.length >= 2 && word.length <= 15);
}

function getCache(): CachedDictionary | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DICTIONARY_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedDictionary;
    if (!parsed.payload || !parsed.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setCache(data: CachedDictionary): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_DICTIONARY_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors in private browsing mode.
  }
}

async function fetchDictionaryText(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Failed to fetch dictionary from ${url}: ${response.status}`);
  }
  return response.text();
}

async function resolveDictionaryPayload(source: DictionarySource): Promise<{ payload: string; source: string }> {
  if (source.type === 'text') {
    return {
      payload: source.text,
      source: source.name ?? 'inline-text',
    };
  }

  try {
    const payload = await fetchDictionaryText(source.url);
    return {
      payload,
      source: source.url,
    };
  } catch {
    if (source.url !== DEFAULT_DICTIONARY_URL) {
      throw new Error(`Unable to download dictionary from ${source.url}`);
    }

    const payload = await fetchDictionaryText(FALLBACK_DICTIONARY_URL);
    return {
      payload,
      source: FALLBACK_DICTIONARY_URL,
    };
  }
}

function registerLexicon(words: string[], sourceName: string, loadedFromCache: boolean): Lexicon {
  const payloadFingerprint = hash(words.join(','));
  const id = `lexicon-${payloadFingerprint}`;

  const existing = lexiconRegistry.get(id);
  if (existing) {
    return existing;
  }

  const wordSet = new Set(words);
  const trie = createTrie(wordSet);

  const meta: DictionaryMeta = {
    id,
    name: sourceName,
    wordCount: trie.wordCount,
    loadedFromCache,
    source: sourceName,
  };

  const lexicon: Lexicon = {
    meta,
    words: wordSet,
    trie,
  };

  lexiconRegistry.set(id, lexicon);
  return lexicon;
}

export async function loadDictionary(
  source: DictionarySource = { type: 'url', url: DEFAULT_DICTIONARY_URL, name: 'TWL06' },
): Promise<DictionaryMeta> {
  if (source.type === 'url' && source.url === DEFAULT_DICTIONARY_URL) {
    const cached = getCache();
    if (cached) {
      const words = parseWordList(cached.payload);
      const lexicon = registerLexicon(words, cached.name || 'TWL06 (cached)', true);
      return lexicon.meta;
    }
  }

  const { payload, source: resolvedSource } = await resolveDictionaryPayload(source);
  const words = parseWordList(payload);
  const sourceName = source.name ?? (source.type === 'url' ? source.url : 'custom');
  const lexicon = registerLexicon(words, sourceName, false);

  if (source.type === 'url' && source.url === DEFAULT_DICTIONARY_URL) {
    const cachePayload: CachedDictionary = {
      id: lexicon.meta.id,
      name: sourceName,
      source: resolvedSource,
      payload,
      createdAt: new Date().toISOString(),
    };
    setCache(cachePayload);
  }

  return lexicon.meta;
}

export function getLexiconById(id: string): Lexicon {
  const lexicon = lexiconRegistry.get(id);
  if (!lexicon) {
    throw new Error(`Lexicon ${id} not loaded`);
  }
  return lexicon;
}

export function getLexiconSnapshot(id: string): LexiconSnapshot {
  const lexicon = getLexiconById(id);
  return {
    id: lexicon.meta.id,
    words: Array.from(lexicon.words),
  };
}

export function getAnyLoadedLexicon(): Lexicon | null {
  const values = Array.from(lexiconRegistry.values());
  return values[0] ?? null;
}

export async function loadCrossplayBlocklist(): Promise<Set<string>> {
  if (blocklistRegistry.size > 0) {
    return blocklistRegistry;
  }

  try {
    const cached = localStorage.getItem(LOCAL_STORAGE_BLOCKLIST_KEY);
    if (cached) {
      for (const line of cached.split(/\r?\n/)) {
        const word = sanitizeWord(line);
        if (word) {
          blocklistRegistry.add(word);
        }
      }
      if (blocklistRegistry.size > 0) {
        return blocklistRegistry;
      }
    }
  } catch {
    // Ignore cache misses.
  }

  const response = await fetch('/data/crossplay_blocklist.txt', { cache: 'force-cache' });
  if (!response.ok) {
    return blocklistRegistry;
  }

  const text = await response.text();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const word = sanitizeWord(line);
    if (word) {
      blocklistRegistry.add(word);
    }
  }

  try {
    localStorage.setItem(LOCAL_STORAGE_BLOCKLIST_KEY, text);
  } catch {
    // Ignore storage errors.
  }

  return blocklistRegistry;
}
