import letterPrototypesRaw from '../data/letterPrototypes.json';

export type PrototypeMode = 'board' | 'rack';

export type GlyphCrop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RawPrototypeEntry = {
  vector: number[];
  count: number;
  meanSimilarity?: number;
};

type RawPrototypeCorpus = {
  dimension: number;
  board: Record<string, RawPrototypeEntry>;
  rack: Record<string, RawPrototypeEntry>;
};

type CompiledPrototypeEntry = {
  letter: string;
  vector: Float32Array;
  count: number;
  meanSimilarity: number;
};

type PrototypeMatch = {
  letter: string;
  confidence: number;
  similarity: number;
  margin: number;
};

const corpus = letterPrototypesRaw as RawPrototypeCorpus;
const glyphDimension = Number.isFinite(corpus.dimension) && corpus.dimension > 0 ? corpus.dimension : 196;
const glyphGrid = Math.max(1, Math.round(Math.sqrt(glyphDimension)));

const compiledPrototypes: Record<PrototypeMode, CompiledPrototypeEntry[]> = {
  board: [],
  rack: [],
};

function normalizeVector(values: number[]): Float32Array {
  const vector = Float32Array.from(values);
  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) {
    norm += vector[i] * vector[i];
  }
  if (norm <= 1e-8) {
    return vector;
  }
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] *= inv;
  }
  return vector;
}

function compileMode(mode: PrototypeMode): CompiledPrototypeEntry[] {
  const entries = corpus[mode] ?? {};
  return Object.entries(entries)
    .filter(([letter, value]) => /^[A-Z?]$/.test(letter) && Array.isArray(value.vector) && value.vector.length === glyphDimension)
    .map(([letter, value]) => ({
      letter,
      vector: normalizeVector(value.vector),
      count: value.count,
      meanSimilarity: value.meanSimilarity ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

compiledPrototypes.board = compileMode('board');
compiledPrototypes.rack = compileMode('rack');

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isWhiteGlyphPixel(r: number, g: number, b: number): boolean {
  return (
    r >= 164 &&
    g >= 164 &&
    b >= 164 &&
    Math.abs(r - g) <= 34 &&
    Math.abs(r - b) <= 34
  );
}

function extractGlyphVector(imageData: ImageData, crop: GlyphCrop): Float32Array {
  const startX = Math.max(0, Math.floor(imageData.width * crop.left));
  const startY = Math.max(0, Math.floor(imageData.height * crop.top));
  const endX = Math.max(startX + 1, Math.min(imageData.width, Math.ceil(imageData.width * (crop.left + crop.width))));
  const endY = Math.max(startY + 1, Math.min(imageData.height, Math.ceil(imageData.height * (crop.top + crop.height))));

  const vector = new Float32Array(glyphGrid * glyphGrid);
  const counts = new Float32Array(glyphGrid * glyphGrid);

  const width = Math.max(1, endX - startX);
  const height = Math.max(1, endY - startY);

  for (let y = startY; y < endY; y += 1) {
    const normalizedY = (y - startY) / height;
    const bucketY = Math.min(glyphGrid - 1, Math.floor(normalizedY * glyphGrid));
    for (let x = startX; x < endX; x += 1) {
      const normalizedX = (x - startX) / width;
      const bucketX = Math.min(glyphGrid - 1, Math.floor(normalizedX * glyphGrid));
      const bucket = bucketY * glyphGrid + bucketX;

      const idx = (y * imageData.width + x) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];

      if (isWhiteGlyphPixel(r, g, b)) {
        vector[bucket] += 1;
      }
      counts[bucket] += 1;
    }
  }

  for (let i = 0; i < vector.length; i += 1) {
    if (counts[i] > 0) {
      vector[i] /= counts[i];
    }
  }

  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) {
    norm += vector[i] * vector[i];
  }
  if (norm <= 1e-8) {
    return vector;
  }
  const invNorm = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] *= invNorm;
  }

  return vector;
}

function cosineSimilarity(lhs: Float32Array, rhs: Float32Array): number {
  const len = Math.min(lhs.length, rhs.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += lhs[i] * rhs[i];
  }
  return dot;
}

export function classifyPrototypeLetter(
  imageData: ImageData,
  mode: PrototypeMode,
  crop: GlyphCrop,
): PrototypeMatch | null {
  const entries = compiledPrototypes[mode];
  if (entries.length === 0) {
    return null;
  }

  const vector = extractGlyphVector(imageData, crop);
  let best: { entry: CompiledPrototypeEntry; similarity: number } | null = null;
  let secondBestSimilarity = 0;

  for (const entry of entries) {
    const similarity = cosineSimilarity(vector, entry.vector);
    if (!best || similarity > best.similarity) {
      secondBestSimilarity = best?.similarity ?? 0;
      best = { entry, similarity };
    } else if (similarity > secondBestSimilarity) {
      secondBestSimilarity = similarity;
    }
  }

  if (!best) {
    return null;
  }

  const margin = best.similarity - secondBestSimilarity;
  const baseConfidence = clamp01((best.similarity - 0.52) / 0.45);
  const marginConfidence = clamp01(margin / 0.22);
  const confidence = clamp01(baseConfidence * 0.65 + marginConfidence * 0.35);

  return {
    letter: best.entry.letter,
    confidence,
    similarity: best.similarity,
    margin,
  };
}
