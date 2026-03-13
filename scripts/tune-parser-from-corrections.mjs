import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const MANIFEST_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'fixtures', 'corrections', 'manifest.json');
const OUTPUT_TUNING = path.join(ROOT, 'src', 'config', 'parserTuning.json');
const OUTPUT_PROTOTYPES = path.join(ROOT, 'src', 'data', 'letterPrototypes.json');
const OUTPUT_WORD_STATS = path.join(ROOT, 'src', 'data', 'correctionWordStats.json');
const OUTPUT_REPORT = path.join(ROOT, 'fixtures', 'corrections', 'tuning-report.json');

const PROFILE_IDS = ['ios', 'android'];

const LAYOUT_PROFILES = {
  ios: {
    boardRect: { x: 0.01, y: 0.29, width: 0.98, height: 0.47 },
    rackRect: { x: 0.0, y: 0.81, width: 1.0, height: 0.09 },
  },
  android: {
    boardRect: { x: 0.01, y: 0.29, width: 0.98, height: 0.47 },
    rackRect: { x: 0.0, y: 0.8, width: 1.0, height: 0.1 },
  },
};

const DEFAULT_PARSER_TUNING = {
  boardBlueTileRatioMin: 0.11,
  boardBlueTileRatioMinOnBooster: 0.22,
  boardWhiteInkRatioMin: 0.018,
  rackBlueTileRatioMin: 0.24,
  rackWhiteInkRatioMin: 0.018,
  ocrMinConfidence: 0.28,
  prototypeConfidenceFloor: 0.72,
  prototypeOverrideConfidence: 0.62,
  prototypeConflictDelta: 0.08,
};

const BOARD_BLUE_OPTIONS = {
  insetRatio: 0.16,
  blueMin: 100,
  blueOverRed: 26,
  blueOverGreen: 10,
  brightnessMax: 450,
};

const BOARD_WHITE_OPTIONS = {
  insetRatio: 0.2,
  whiteMin: 170,
  channelDeltaMax: 28,
};

const RACK_BLUE_OPTIONS = {
  insetRatio: 0.1,
  blueMin: 96,
  blueOverRed: 20,
  blueOverGreen: 8,
  brightnessMax: 560,
};

const RACK_WHITE_OPTIONS = {
  insetRatio: 0.2,
  whiteMin: 180,
  channelDeltaMax: 30,
};

const BOARD_GLYPH_CROP = { left: 0.16, top: 0.14, width: 0.68, height: 0.74 };
const RACK_GLYPH_CROP = { left: 0.13, top: 0.2, width: 0.74, height: 0.66 };
const GLYPH_GRID = 14;
const GLYPH_DIMENSION = GLYPH_GRID * GLYPH_GRID;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeProfile(input) {
  if (PROFILE_IDS.includes(input)) {
    return input;
  }
  return 'ios';
}

function normalizeLetter(input) {
  if (typeof input !== 'string') {
    return '';
  }
  const value = input.toUpperCase().replace(/[^A-Z]/g, '');
  return value.slice(0, 1);
}

function collectBoardWords(board) {
  const words = [];
  const size = Array.isArray(board) ? board.length : 0;
  if (size === 0) {
    return words;
  }

  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      const letter = normalizeLetter(board?.[row]?.[col]?.letter ?? '');
      if (!letter) {
        col += 1;
        continue;
      }

      const left = col > 0 ? normalizeLetter(board?.[row]?.[col - 1]?.letter ?? '') : '';
      if (left) {
        col += 1;
        continue;
      }

      let text = '';
      let cursor = col;
      while (cursor < size) {
        const nextLetter = normalizeLetter(board?.[row]?.[cursor]?.letter ?? '');
        if (!nextLetter) {
          break;
        }
        text += nextLetter;
        cursor += 1;
      }
      if (text.length >= 2) {
        words.push(text);
      }
      col = cursor;
    }
  }

  for (let col = 0; col < size; col += 1) {
    let row = 0;
    while (row < size) {
      const letter = normalizeLetter(board?.[row]?.[col]?.letter ?? '');
      if (!letter) {
        row += 1;
        continue;
      }

      const above = row > 0 ? normalizeLetter(board?.[row - 1]?.[col]?.letter ?? '') : '';
      if (above) {
        row += 1;
        continue;
      }

      let text = '';
      let cursor = row;
      while (cursor < size) {
        const nextLetter = normalizeLetter(board?.[cursor]?.[col]?.letter ?? '');
        if (!nextLetter) {
          break;
        }
        text += nextLetter;
        cursor += 1;
      }
      if (text.length >= 2) {
        words.push(text);
      }
      row = cursor;
    }
  }

  return words;
}

async function readPngImage(filePath) {
  const buffer = await readFile(filePath);
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    data: png.data,
  };
}

function cropImage(image, rect) {
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(rect.y)));
  const width = Math.max(1, Math.min(image.width - x, Math.floor(rect.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.floor(rect.height)));
  const data = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * image.width + x) * 4;
    const sourceEnd = sourceStart + width * 4;
    const targetStart = row * width * 4;
    data.set(image.data.subarray(sourceStart, sourceEnd), targetStart);
  }

  return { width, height, data };
}

function cropNormalized(image, rect) {
  return cropImage(image, {
    x: image.width * rect.x,
    y: image.height * rect.y,
    width: image.width * rect.width,
    height: image.height * rect.height,
  });
}

function cellRect(totalWidth, totalHeight, row, col, rows, cols) {
  const cellWidth = totalWidth / cols;
  const cellHeight = totalHeight / rows;
  return {
    x: Math.floor(col * cellWidth),
    y: Math.floor(row * cellHeight),
    width: Math.ceil(cellWidth),
    height: Math.ceil(cellHeight),
  };
}

function rackRect(totalWidth, totalHeight, index, count) {
  const tileWidth = totalWidth / count;
  return {
    x: Math.floor(index * tileWidth),
    y: 0,
    width: Math.ceil(tileWidth),
    height: totalHeight,
  };
}

function getBlueDominanceRatio(imageData, options = {}) {
  const {
    insetRatio = 0.12,
    blueMin = 90,
    blueOverRed = 22,
    blueOverGreen = 10,
    brightnessMax = 520,
  } = options;

  const startX = Math.floor(imageData.width * insetRatio);
  const endX = Math.max(startX + 1, Math.ceil(imageData.width * (1 - insetRatio)));
  const startY = Math.floor(imageData.height * insetRatio);
  const endY = Math.max(startY + 1, Math.ceil(imageData.height * (1 - insetRatio)));

  let bluePixels = 0;
  let total = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const idx = (y * imageData.width + x) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const brightness = r + g + b;

      total += 1;
      if (
        b >= blueMin &&
        b - r >= blueOverRed &&
        b - g >= blueOverGreen &&
        brightness <= brightnessMax
      ) {
        bluePixels += 1;
      }
    }
  }

  return total > 0 ? bluePixels / total : 0;
}

function getWhiteInkRatio(imageData, options = {}) {
  const {
    insetRatio = 0.15,
    whiteMin = 180,
    channelDeltaMax = 22,
  } = options;

  const startX = Math.floor(imageData.width * insetRatio);
  const endX = Math.max(startX + 1, Math.ceil(imageData.width * (1 - insetRatio)));
  const startY = Math.floor(imageData.height * insetRatio);
  const endY = Math.max(startY + 1, Math.ceil(imageData.height * (1 - insetRatio)));

  let whitePixels = 0;
  let total = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const idx = (y * imageData.width + x) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];

      total += 1;
      if (
        r >= whiteMin &&
        g >= whiteMin &&
        b >= whiteMin &&
        Math.abs(r - g) <= channelDeltaMax &&
        Math.abs(r - b) <= channelDeltaMax
      ) {
        whitePixels += 1;
      }
    }
  }

  return total > 0 ? whitePixels / total : 0;
}

function isWhiteGlyphPixel(r, g, b) {
  return (
    r >= 164 &&
    g >= 164 &&
    b >= 164 &&
    Math.abs(r - g) <= 34 &&
    Math.abs(r - b) <= 34
  );
}

function extractGlyphVector(imageData, crop) {
  const startX = Math.max(0, Math.floor(imageData.width * crop.left));
  const startY = Math.max(0, Math.floor(imageData.height * crop.top));
  const endX = Math.max(startX + 1, Math.min(imageData.width, Math.ceil(imageData.width * (crop.left + crop.width))));
  const endY = Math.max(startY + 1, Math.min(imageData.height, Math.ceil(imageData.height * (crop.top + crop.height))));

  const vector = new Array(GLYPH_DIMENSION).fill(0);
  const counts = new Array(GLYPH_DIMENSION).fill(0);
  const width = Math.max(1, endX - startX);
  const height = Math.max(1, endY - startY);

  for (let y = startY; y < endY; y += 1) {
    const normalizedY = (y - startY) / height;
    const bucketY = Math.min(GLYPH_GRID - 1, Math.floor(normalizedY * GLYPH_GRID));
    for (let x = startX; x < endX; x += 1) {
      const normalizedX = (x - startX) / width;
      const bucketX = Math.min(GLYPH_GRID - 1, Math.floor(normalizedX * GLYPH_GRID));
      const bucket = bucketY * GLYPH_GRID + bucketX;

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
  for (const value of vector) {
    norm += value * value;
  }

  if (norm <= 1e-8) {
    return vector;
  }

  const invNorm = 1 / Math.sqrt(norm);
  return vector.map((value) => value * invNorm);
}

function dotProduct(lhs, rhs) {
  const len = Math.min(lhs.length, rhs.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += lhs[i] * rhs[i];
  }
  return sum;
}

function computeMetrics(tp, fp, fn, tn) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const fpRate = fp + tn > 0 ? fp / (fp + tn) : 0;
  return { precision, recall, f1, fpRate, tp, fp, fn, tn };
}

function fBeta(precision, recall, beta) {
  const betaSquared = beta * beta;
  if (precision <= 0 || recall <= 0) {
    return 0;
  }
  return ((1 + betaSquared) * precision * recall) / (betaSquared * precision + recall);
}

function tuneBoardThresholds(samples, defaults) {
  let best = {
    boardBlueTileRatioMin: defaults.boardBlueTileRatioMin,
    boardBlueTileRatioMinOnBooster: defaults.boardBlueTileRatioMinOnBooster,
    boardWhiteInkRatioMin: defaults.boardWhiteInkRatioMin,
    objective: -1,
    metrics: null,
  };

  const whiteFloor = Math.max(0.018, defaults.boardWhiteInkRatioMin);
  for (let white = whiteFloor; white <= 0.04; white += 0.001) {
    const boardBlueStart = Math.max(0.09, defaults.boardBlueTileRatioMin - 0.02);
    for (let boardBlue = boardBlueStart; boardBlue <= 0.2; boardBlue += 0.004) {
      const boosterStart = Math.max(
        defaults.boardBlueTileRatioMinOnBooster - 0.02,
        boardBlue + 0.016,
      );
      for (let boosterBlue = boosterStart; boosterBlue <= 0.34; boosterBlue += 0.004) {
        let tp = 0;
        let fp = 0;
        let fn = 0;
        let tn = 0;

        for (const sample of samples) {
          const minBlue = sample.booster ? boosterBlue : boardBlue;
          const predicted = sample.blue >= minBlue && sample.white >= white;
          const actual = sample.occupied;

          if (predicted && actual) {
            tp += 1;
          } else if (predicted && !actual) {
            fp += 1;
          } else if (!predicted && actual) {
            fn += 1;
          } else {
            tn += 1;
          }
        }

        const metrics = computeMetrics(tp, fp, fn, tn);
        const objective = fBeta(metrics.precision, metrics.recall, 0.5) - metrics.fpRate * 0.08;

        const isBetter = objective > best.objective + 1e-9;
        const tieBreak =
          Math.abs(objective - best.objective) <= 1e-9 &&
          best.metrics &&
          (metrics.fp < best.metrics.fp || metrics.f1 > best.metrics.f1);

        if (isBetter || tieBreak) {
          best = {
            boardBlueTileRatioMin: boardBlue,
            boardBlueTileRatioMinOnBooster: boosterBlue,
            boardWhiteInkRatioMin: white,
            objective,
            metrics,
          };
        }
      }
    }
  }

  return best;
}

function tuneRackBlueThreshold(samples, defaults) {
  let best = {
    rackBlueTileRatioMin: defaults.rackBlueTileRatioMin,
    objective: -1,
    metrics: null,
  };

  const rackBlueStart = Math.max(0.2, defaults.rackBlueTileRatioMin - 0.04);
  for (let rackBlue = rackBlueStart; rackBlue <= 0.36; rackBlue += 0.002) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const sample of samples) {
      const predicted = sample.blue >= rackBlue;
      const actual = sample.occupied;
      if (predicted && actual) {
        tp += 1;
      } else if (predicted && !actual) {
        fp += 1;
      } else if (!predicted && actual) {
        fn += 1;
      } else {
        tn += 1;
      }
    }

    const metrics = computeMetrics(tp, fp, fn, tn);
    const objective = fBeta(metrics.precision, metrics.recall, 0.5) - metrics.fpRate * 0.05;

    const isBetter = objective > best.objective + 1e-9;
    const tieBreak =
      Math.abs(objective - best.objective) <= 1e-9 &&
      best.metrics &&
      (metrics.fp < best.metrics.fp || metrics.f1 > best.metrics.f1);

    if (isBetter || tieBreak) {
      best = { rackBlueTileRatioMin: rackBlue, objective, metrics };
    }
  }

  return best;
}

function tuneRackBlankThreshold(samples, defaultThreshold) {
  const blankSamples = samples.filter((sample) => sample.occupied && sample.isBlank);
  const filledSamples = samples.filter((sample) => sample.occupied && !sample.isBlank);

  if (blankSamples.length < 2 || filledSamples.length < 8) {
    return {
      rackWhiteInkRatioMin: defaultThreshold,
      objective: null,
      metrics: null,
      tuned: false,
    };
  }

  let best = {
    rackWhiteInkRatioMin: defaultThreshold,
    objective: -1,
    metrics: null,
    tuned: true,
  };

  for (let threshold = 0.006; threshold <= 0.06; threshold += 0.001) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const sample of samples) {
      if (!sample.occupied) {
        continue;
      }

      const predictedBlank = sample.white < threshold;
      const actualBlank = sample.isBlank;

      if (predictedBlank && actualBlank) {
        tp += 1;
      } else if (predictedBlank && !actualBlank) {
        fp += 1;
      } else if (!predictedBlank && actualBlank) {
        fn += 1;
      } else {
        tn += 1;
      }
    }

    const metrics = computeMetrics(tp, fp, fn, tn);
    const objective = fBeta(metrics.precision, metrics.recall, 1);
    if (objective > best.objective + 1e-9) {
      best = {
        rackWhiteInkRatioMin: threshold,
        objective,
        metrics,
        tuned: true,
      };
    }
  }

  if (!best.metrics || best.metrics.f1 < 0.4) {
    return {
      rackWhiteInkRatioMin: defaultThreshold,
      objective: best.objective,
      metrics: best.metrics,
      tuned: false,
    };
  }

  return best;
}

function buildPrototypeCorpus(samples) {
  const buckets = {
    board: new Map(),
    rack: new Map(),
  };

  for (const sample of samples) {
    const key = `${sample.mode}:${sample.label}`;
    if (!buckets[sample.mode].has(key)) {
      buckets[sample.mode].set(key, {
        mode: sample.mode,
        label: sample.label,
        vectors: [],
      });
    }
    buckets[sample.mode].get(key).vectors.push(sample.vector);
  }

  const corpus = {
    version: '1',
    trainedAt: new Date().toISOString(),
    sourceCount: 0,
    dimension: GLYPH_DIMENSION,
    board: {},
    rack: {},
  };

  const centroids = {
    board: new Map(),
    rack: new Map(),
  };

  for (const mode of ['board', 'rack']) {
    const byLabel = [...buckets[mode].values()]
      .sort((a, b) => a.label.localeCompare(b.label));

    for (const entry of byLabel) {
      const sum = new Array(GLYPH_DIMENSION).fill(0);
      for (const vector of entry.vectors) {
        for (let i = 0; i < GLYPH_DIMENSION; i += 1) {
          sum[i] += vector[i];
        }
      }

      const centroid = sum.map((value) => value / entry.vectors.length);
      let norm = 0;
      for (const value of centroid) {
        norm += value * value;
      }
      if (norm > 1e-8) {
        const invNorm = 1 / Math.sqrt(norm);
        for (let i = 0; i < centroid.length; i += 1) {
          centroid[i] *= invNorm;
        }
      }

      let similaritySum = 0;
      for (const vector of entry.vectors) {
        similaritySum += dotProduct(vector, centroid);
      }

      const payload = {
        vector: centroid.map((value) => round(value, 6)),
        count: entry.vectors.length,
        meanSimilarity: round(similaritySum / entry.vectors.length, 4),
      };

      corpus[mode][entry.label] = payload;
      centroids[mode].set(entry.label, centroid);
    }
  }

  let correct = 0;
  for (const sample of samples) {
    const modeCentroids = centroids[sample.mode];
    let bestLabel = null;
    let bestSimilarity = -1;
    for (const [label, centroid] of modeCentroids.entries()) {
      const similarity = dotProduct(sample.vector, centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestLabel = label;
      }
    }
    if (bestLabel === sample.label) {
      correct += 1;
    }
  }

  return {
    corpus,
    trainAccuracy: samples.length > 0 ? correct / samples.length : 0,
  };
}

async function main() {
  const manifest = await readJson(MANIFEST_PATH, null);
  if (!manifest || !Array.isArray(manifest.items) || manifest.items.length === 0) {
    throw new Error(`No correction items found in ${MANIFEST_PATH}`);
  }

  const existingTuning = await readJson(OUTPUT_TUNING, {
    ios: { ...DEFAULT_PARSER_TUNING },
    android: { ...DEFAULT_PARSER_TUNING },
  });

  const correctionsRoot = path.dirname(MANIFEST_PATH);
  const boardSamples = { ios: [], android: [] };
  const rackSamples = { ios: [], android: [] };
  const glyphSamples = [];
  const correctionWordCounts = new Map();
  let correctionLabelsUsed = 0;

  let fixturesUsed = 0;
  let fixturesSkipped = 0;

  for (const item of manifest.items) {
    if (!item?.labelFile) {
      fixturesSkipped += 1;
      continue;
    }

    const labelPath = path.resolve(correctionsRoot, item.labelFile);

    let correction;
    try {
      correction = await readJson(labelPath, null);
    } catch {
      fixturesSkipped += 1;
      continue;
    }

    if (correction && Array.isArray(correction.board) && Array.isArray(correction.rack)) {
      correctionLabelsUsed += 1;
      for (const word of collectBoardWords(correction.board)) {
        const previous = correctionWordCounts.get(word) ?? 0;
        correctionWordCounts.set(word, previous + 1);
      }
    }

    if (!item?.imageFile) {
      fixturesSkipped += 1;
      continue;
    }

    const imagePath = path.resolve(correctionsRoot, item.imageFile);
    let image;
    try {
      image = await readPngImage(imagePath);
    } catch {
      fixturesSkipped += 1;
      continue;
    }

    if (!correction || !Array.isArray(correction.board) || !Array.isArray(correction.rack)) {
      fixturesSkipped += 1;
      continue;
    }

    const profile = safeProfile(correction?.source?.profile ?? item?.profile);
    const layout = LAYOUT_PROFILES[profile];

    const boardImage = cropNormalized(image, layout.boardRect);
    const rackImage = cropNormalized(image, layout.rackRect);
    fixturesUsed += 1;

    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        const rect = cellRect(boardImage.width, boardImage.height, row, col, 15, 15);
        const tileImage = cropImage(boardImage, rect);
        const cell = correction.board?.[row]?.[col] ?? null;
        const letter = normalizeLetter(cell?.letter ?? '');
        const occupied = Boolean(letter);
        const booster = cell?.premium !== null;

        boardSamples[profile].push({
          blue: getBlueDominanceRatio(tileImage, BOARD_BLUE_OPTIONS),
          white: getWhiteInkRatio(tileImage, BOARD_WHITE_OPTIONS),
          occupied,
          booster,
        });

        if (occupied) {
          glyphSamples.push({
            mode: 'board',
            label: letter,
            vector: extractGlyphVector(tileImage, BOARD_GLYPH_CROP),
          });
        }
      }
    }

    for (let index = 0; index < 7; index += 1) {
      const rect = rackRect(rackImage.width, rackImage.height, index, 7);
      const tileImage = cropImage(rackImage, rect);
      const rackTile = correction.rack?.[index] ?? null;
      const letter = normalizeLetter(rackTile?.letter ?? '');
      const isBlank = Boolean(rackTile?.isBlank);
      const occupied = isBlank || Boolean(letter);

      rackSamples[profile].push({
        blue: getBlueDominanceRatio(tileImage, RACK_BLUE_OPTIONS),
        white: getWhiteInkRatio(tileImage, RACK_WHITE_OPTIONS),
        occupied,
        isBlank,
      });

      if (occupied) {
        glyphSamples.push({
          mode: 'rack',
          label: isBlank ? '?' : letter,
          vector: extractGlyphVector(tileImage, RACK_GLYPH_CROP),
        });
      }
    }
  }

  const nextTuning = {
    ios: {
      ...DEFAULT_PARSER_TUNING,
      ...(existingTuning.ios ?? {}),
    },
    android: {
      ...DEFAULT_PARSER_TUNING,
      ...(existingTuning.android ?? {}),
    },
  };

  const report = {
    manifestPath: MANIFEST_PATH,
    generatedAt: new Date().toISOString(),
    fixturesUsed,
    fixturesSkipped,
    correctionLabelsUsed,
    correctionWordCount: correctionWordCounts.size,
    profiles: {},
    prototypes: null,
  };

  for (const profile of PROFILE_IDS) {
    const board = boardSamples[profile];
    const rack = rackSamples[profile];

    if (board.length === 0 || rack.length === 0) {
      report.profiles[profile] = {
        skipped: true,
        reason: 'No fixtures for profile',
      };
      continue;
    }

    const boardTuned = tuneBoardThresholds(board, nextTuning[profile]);
    const rackBlueTuned = tuneRackBlueThreshold(rack, nextTuning[profile]);
    const rackBlankTuned = tuneRackBlankThreshold(rack, nextTuning[profile].rackWhiteInkRatioMin);

    nextTuning[profile].boardBlueTileRatioMin = round(boardTuned.boardBlueTileRatioMin, 4);
    nextTuning[profile].boardBlueTileRatioMinOnBooster = round(boardTuned.boardBlueTileRatioMinOnBooster, 4);
    nextTuning[profile].boardWhiteInkRatioMin = round(boardTuned.boardWhiteInkRatioMin, 4);
    nextTuning[profile].rackBlueTileRatioMin = round(rackBlueTuned.rackBlueTileRatioMin, 4);
    if (rackBlankTuned.tuned) {
      nextTuning[profile].rackWhiteInkRatioMin = round(rackBlankTuned.rackWhiteInkRatioMin, 4);
    } else {
      nextTuning[profile].rackWhiteInkRatioMin = DEFAULT_PARSER_TUNING.rackWhiteInkRatioMin;
    }

    report.profiles[profile] = {
      boardSamples: board.length,
      rackSamples: rack.length,
      board: {
        thresholds: {
          boardBlueTileRatioMin: round(boardTuned.boardBlueTileRatioMin, 4),
          boardBlueTileRatioMinOnBooster: round(boardTuned.boardBlueTileRatioMinOnBooster, 4),
          boardWhiteInkRatioMin: round(boardTuned.boardWhiteInkRatioMin, 4),
        },
        metrics: boardTuned.metrics
          ? {
              precision: round(boardTuned.metrics.precision, 4),
              recall: round(boardTuned.metrics.recall, 4),
              f1: round(boardTuned.metrics.f1, 4),
              fpRate: round(boardTuned.metrics.fpRate, 4),
            }
          : null,
      },
      rack: {
        thresholds: {
          rackBlueTileRatioMin: round(rackBlueTuned.rackBlueTileRatioMin, 4),
          rackWhiteInkRatioMin: round(nextTuning[profile].rackWhiteInkRatioMin, 4),
        },
        blueMetrics: rackBlueTuned.metrics
          ? {
              precision: round(rackBlueTuned.metrics.precision, 4),
              recall: round(rackBlueTuned.metrics.recall, 4),
              f1: round(rackBlueTuned.metrics.f1, 4),
              fpRate: round(rackBlueTuned.metrics.fpRate, 4),
            }
          : null,
        blankMetrics: rackBlankTuned.metrics
          ? {
              precision: round(rackBlankTuned.metrics.precision, 4),
              recall: round(rackBlankTuned.metrics.recall, 4),
              f1: round(rackBlankTuned.metrics.f1, 4),
              tuned: rackBlankTuned.tuned,
            }
          : {
              tuned: false,
            },
      },
    };
  }

  const prototypeOutput = buildPrototypeCorpus(glyphSamples);
  prototypeOutput.corpus.sourceCount = fixturesUsed;

  report.prototypes = {
    sampleCount: glyphSamples.length,
    trainAccuracy: round(prototypeOutput.trainAccuracy, 4),
    boardLabels: Object.keys(prototypeOutput.corpus.board).length,
    rackLabels: Object.keys(prototypeOutput.corpus.rack).length,
  };

  const sortedCorrectionWords = Object.entries(
    Object.fromEntries(correctionWordCounts.entries()),
  ).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });

  const correctionWordStats = {
    version: '1',
    generatedAt: new Date().toISOString(),
    sourceCount: correctionLabelsUsed,
    uniqueWords: correctionWordCounts.size,
    words: Object.fromEntries(sortedCorrectionWords),
  };

  await writeFile(OUTPUT_TUNING, `${JSON.stringify(nextTuning, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_PROTOTYPES, `${JSON.stringify(prototypeOutput.corpus, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_WORD_STATS, `${JSON.stringify(correctionWordStats, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Tuned parser thresholds from ${fixturesUsed} fixtures (${fixturesSkipped} skipped).`);
  console.log(`Wrote ${OUTPUT_TUNING}`);
  console.log(`Wrote ${OUTPUT_PROTOTYPES}`);
  console.log(`Wrote ${OUTPUT_WORD_STATS}`);
  console.log(`Wrote ${OUTPUT_REPORT}`);
  console.log(`Prototype train accuracy: ${round(prototypeOutput.trainAccuracy, 4)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
