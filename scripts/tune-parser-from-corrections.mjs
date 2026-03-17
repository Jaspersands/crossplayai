import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const DEFAULT_MANIFEST_PATH = path.join(ROOT, 'fixtures', 'corrections', 'manifest.json');
const OUTPUT_TUNING = path.join(ROOT, 'src', 'config', 'parserTuning.json');
const OUTPUT_PROTOTYPES = path.join(ROOT, 'src', 'data', 'letterPrototypes.json');
const OUTPUT_TILE_CLASSIFIER = path.join(ROOT, 'src', 'data', 'tileClassifierModel.json');
const OUTPUT_WORD_STATS = path.join(ROOT, 'src', 'data', 'correctionWordStats.json');
const OUTPUT_REPORT = path.join(ROOT, 'fixtures', 'corrections', 'tuning-report.json');
const DEFAULT_VALIDATION_RATIO = 0.2;
const DEFAULT_SPLIT_SEED = 'crossplayai-v1';

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

function parseCliOptions(argv) {
  const options = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    validationRatio: DEFAULT_VALIDATION_RATIO,
    splitSeed: DEFAULT_SPLIT_SEED,
  };

  for (const arg of argv) {
    if (!arg) {
      continue;
    }
    if (arg.startsWith('--validation-ratio=')) {
      const raw = Number(arg.split('=')[1]);
      if (!Number.isFinite(raw) || raw < 0 || raw > 0.5) {
        throw new Error('--validation-ratio must be between 0 and 0.5');
      }
      options.validationRatio = raw;
      continue;
    }

    if (arg.startsWith('--split-seed=')) {
      const raw = arg.slice('--split-seed='.length).trim();
      options.splitSeed = raw || DEFAULT_SPLIT_SEED;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    options.manifestPath = path.resolve(arg);
  }

  return options;
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableFraction(input) {
  return hashString(input) / 0xffffffff;
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

function getGlyphWhiteRatio(imageData, crop) {
  const startX = Math.max(0, Math.floor(imageData.width * crop.left));
  const startY = Math.max(0, Math.floor(imageData.height * crop.top));
  const endX = Math.max(startX + 1, Math.min(imageData.width, Math.ceil(imageData.width * (crop.left + crop.width))));
  const endY = Math.max(startY + 1, Math.min(imageData.height, Math.ceil(imageData.height * (crop.top + crop.height))));

  let white = 0;
  let total = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const idx = (y * imageData.width + x) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      if (isWhiteGlyphPixel(r, g, b)) {
        white += 1;
      }
      total += 1;
    }
  }

  return total > 0 ? white / total : 0;
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

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values, mean) {
  if (!values.length) {
    return 1;
  }
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function classifyOccupancyProbability(features, model) {
  const normalized = features.map((value, index) => {
    const std = model.featureStds[index] > 1e-4 ? model.featureStds[index] : 1e-4;
    return (value - model.featureMeans[index]) / std;
  });

  const occupiedDistance = normalized.reduce(
    (sum, value, index) => sum + ((value - model.occupiedCentroid[index]) ** 2),
    0,
  );
  const emptyDistance = normalized.reduce(
    (sum, value, index) => sum + ((value - model.emptyCentroid[index]) ** 2),
    0,
  );

  const occupiedScore = -occupiedDistance;
  const emptyScore = -emptyDistance;
  const delta = Math.max(-16, Math.min(16, occupiedScore - emptyScore));
  return 1 / (1 + Math.exp(-delta));
}

function tuneOccupancyThreshold(probabilitySamples) {
  let best = {
    threshold: 0.5,
    objective: -Infinity,
    metrics: null,
  };

  for (let threshold = 0.2; threshold <= 0.88; threshold += 0.01) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const sample of probabilitySamples) {
      const predicted = sample.probability >= threshold;
      if (predicted && sample.occupied) {
        tp += 1;
      } else if (predicted && !sample.occupied) {
        fp += 1;
      } else if (!predicted && sample.occupied) {
        fn += 1;
      } else {
        tn += 1;
      }
    }

    const metrics = computeMetrics(tp, fp, fn, tn);
    const objective = fBeta(metrics.precision, metrics.recall, 0.9) - metrics.fpRate * 0.04;

    if (objective > best.objective + 1e-9) {
      best = {
        threshold,
        objective,
        metrics,
      };
    }
  }

  return best;
}

function buildOccupancyClassifier(samples) {
  const occupiedSamples = samples.filter((sample) => sample.occupied);
  const emptySamples = samples.filter((sample) => !sample.occupied);
  if (occupiedSamples.length < 12 || emptySamples.length < 20) {
    return null;
  }

  const featureNames = ['blue', 'white', 'glyphWhite'];
  const featureMeans = featureNames.map((name) => average(samples.map((sample) => sample[name])));
  const featureStds = featureNames.map((name, index) => {
    const std = standardDeviation(samples.map((sample) => sample[name]), featureMeans[index]);
    return std > 1e-4 ? std : 1e-4;
  });

  const toNormalized = (sample) => featureNames.map((name, index) => (
    (sample[name] - featureMeans[index]) / featureStds[index]
  ));

  const occupiedCentroid = featureNames.map((_, index) => average(
    occupiedSamples.map((sample) => toNormalized(sample)[index]),
  ));
  const emptyCentroid = featureNames.map((_, index) => average(
    emptySamples.map((sample) => toNormalized(sample)[index]),
  ));

  const model = {
    featureNames,
    featureMeans: featureMeans.map((value) => round(value, 6)),
    featureStds: featureStds.map((value) => round(value, 6)),
    occupiedCentroid: occupiedCentroid.map((value) => round(value, 6)),
    emptyCentroid: emptyCentroid.map((value) => round(value, 6)),
    threshold: 0.5,
    occupiedCount: occupiedSamples.length,
    emptyCount: emptySamples.length,
  };

  const probabilitySamples = samples.map((sample) => ({
    occupied: sample.occupied,
    probability: classifyOccupancyProbability([sample.blue, sample.white, sample.glyphWhite], model),
  }));

  const tuned = tuneOccupancyThreshold(probabilitySamples);
  model.threshold = round(tuned.threshold, 4);

  const occupiedProbs = probabilitySamples
    .filter((sample) => sample.occupied)
    .map((sample) => sample.probability);
  const emptyProbs = probabilitySamples
    .filter((sample) => !sample.occupied)
    .map((sample) => sample.probability);

  return {
    model,
    metrics: tuned.metrics
      ? {
          precision: round(tuned.metrics.precision, 4),
          recall: round(tuned.metrics.recall, 4),
          f1: round(tuned.metrics.f1, 4),
          fpRate: round(tuned.metrics.fpRate, 4),
          threshold: round(tuned.threshold, 4),
        }
      : null,
    probabilitySummary: {
      occupiedP25: round(percentile(occupiedProbs, 0.25), 4),
      occupiedMedian: round(percentile(occupiedProbs, 0.5), 4),
      occupiedP75: round(percentile(occupiedProbs, 0.75), 4),
      emptyP25: round(percentile(emptyProbs, 0.25), 4),
      emptyMedian: round(percentile(emptyProbs, 0.5), 4),
      emptyP75: round(percentile(emptyProbs, 0.75), 4),
    },
  };
}

function buildPrototypeCorpus(samples) {
  const MAX_PROTOTYPES_PER_LABEL = {
    board: 8,
    rack: 4,
  };

  function choosePrototypeIndices(vectors, limit) {
    if (vectors.length <= limit) {
      return vectors.map((_, index) => index);
    }

    const chosen = [0];
    const minDistances = new Array(vectors.length).fill(Number.POSITIVE_INFINITY);

    while (chosen.length < limit) {
      const last = vectors[chosen[chosen.length - 1]];
      for (let index = 0; index < vectors.length; index += 1) {
        const distance = 1 - dotProduct(vectors[index], last);
        if (distance < minDistances[index]) {
          minDistances[index] = distance;
        }
      }

      let nextIndex = -1;
      let nextDistance = -1;
      for (let index = 0; index < vectors.length; index += 1) {
        if (chosen.includes(index)) {
          continue;
        }
        if (minDistances[index] > nextDistance) {
          nextDistance = minDistances[index];
          nextIndex = index;
        }
      }

      if (nextIndex < 0) {
        break;
      }
      chosen.push(nextIndex);
    }

    return chosen;
  }

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

  const prototypes = {
    board: [],
    rack: [],
  };

  for (const mode of ['board', 'rack']) {
    const byLabel = [...buckets[mode].values()]
      .sort((a, b) => a.label.localeCompare(b.label));

    for (const entry of byLabel) {
      const limit = Math.max(1, Math.min(MAX_PROTOTYPES_PER_LABEL[mode], entry.vectors.length));
      const selected = choosePrototypeIndices(entry.vectors, limit);
      const rawPrototypes = selected.map((index) => ({
        vector: entry.vectors[index],
        count: 0,
        similaritySum: 0,
      }));

      for (const vector of entry.vectors) {
        let bestIndex = 0;
        let bestSimilarity = -1;
        for (let index = 0; index < rawPrototypes.length; index += 1) {
          const similarity = dotProduct(vector, rawPrototypes[index].vector);
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestIndex = index;
          }
        }
        rawPrototypes[bestIndex].count += 1;
        rawPrototypes[bestIndex].similaritySum += bestSimilarity;
      }

      const payload = rawPrototypes
        .filter((prototype) => prototype.count > 0)
        .sort((lhs, rhs) => rhs.count - lhs.count)
        .map((prototype) => ({
          vector: prototype.vector.map((value) => round(value, 6)),
          count: prototype.count,
          meanSimilarity: round(prototype.similaritySum / prototype.count, 4),
        }));

      corpus[mode][entry.label] = payload;
      for (const prototype of payload) {
        prototypes[mode].push({
          label: entry.label,
          vector: prototype.vector,
        });
      }
    }
  }

  let correct = 0;
  for (const sample of samples) {
    const modePrototypes = prototypes[sample.mode];
    let bestLabel = null;
    let bestSimilarity = -1;
    for (const prototype of modePrototypes) {
      const similarity = dotProduct(sample.vector, prototype.vector);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestLabel = prototype.label;
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

async function loadCorrectionFixtures(manifestPath) {
  const manifest = await readJson(manifestPath, null);
  if (!manifest || !Array.isArray(manifest.items) || manifest.items.length === 0) {
    throw new Error(`No correction items found in ${manifestPath}`);
  }

  const correctionsRoot = path.dirname(manifestPath);
  const fixtures = [];
  let skipped = 0;
  let correctionLabelsUsed = 0;

  for (let index = 0; index < manifest.items.length; index += 1) {
    const item = manifest.items[index];
    if (!item?.labelFile || !item?.imageFile) {
      skipped += 1;
      continue;
    }

    const labelPath = path.resolve(correctionsRoot, item.labelFile);
    const imagePath = path.resolve(correctionsRoot, item.imageFile);
    const correction = await readJson(labelPath, null);
    if (!correction || !Array.isArray(correction.board) || !Array.isArray(correction.rack)) {
      skipped += 1;
      continue;
    }

    correctionLabelsUsed += 1;
    const profile = safeProfile(correction?.source?.profile ?? item?.profile);
    const fixtureId = item?.sourceFilename
      ? String(item.sourceFilename)
      : `${profile}:${index}`;

    fixtures.push({
      id: fixtureId,
      profile,
      labelPath,
      imagePath,
      correction,
      sourceFilename: item?.sourceFilename ?? path.basename(imagePath),
      exportedAt: item?.exportedAt ?? null,
    });
  }

  return {
    manifest,
    fixtures,
    skipped,
    correctionLabelsUsed,
  };
}

function splitFixtures(fixtures, options = {}) {
  const ratio = Math.max(0, Math.min(0.5, Number(options.validationRatio ?? DEFAULT_VALIDATION_RATIO)));
  const seed = String(options.splitSeed ?? DEFAULT_SPLIT_SEED);
  const grouped = {
    ios: [],
    android: [],
  };

  for (const fixture of fixtures) {
    grouped[safeProfile(fixture.profile)].push(fixture);
  }

  const trainFixtures = [];
  const validationFixtures = [];

  for (const profile of PROFILE_IDS) {
    const group = grouped[profile]
      .slice()
      .sort((lhs, rhs) => String(lhs.sourceFilename).localeCompare(String(rhs.sourceFilename)));
    if (group.length === 0) {
      continue;
    }

    if (ratio <= 0) {
      trainFixtures.push(...group);
      continue;
    }

    const scored = group
      .map((fixture) => ({
        fixture,
        score: stableFraction(`${seed}|${profile}|${fixture.sourceFilename}`),
      }))
      .sort((lhs, rhs) => lhs.score - rhs.score);

    let validationCount = Math.round(group.length * ratio);
    if (group.length > 1) {
      validationCount = Math.max(1, Math.min(group.length - 1, validationCount));
    } else {
      validationCount = 0;
    }

    for (let i = 0; i < scored.length; i += 1) {
      if (i < validationCount) {
        validationFixtures.push(scored[i].fixture);
      } else {
        trainFixtures.push(scored[i].fixture);
      }
    }
  }

  return {
    ratio,
    seed,
    trainFixtures,
    validationFixtures,
    trainFixtureIds: new Set(trainFixtures.map((fixture) => fixture.id)),
    validationFixtureIds: new Set(validationFixtures.map((fixture) => fixture.id)),
  };
}

function createEmptySampleSet() {
  return {
    boardSamples: { ios: [], android: [] },
    rackSamples: { ios: [], android: [] },
    glyphSamples: [],
    correctionWordCountsByFixture: new Map(),
    fixturesUsed: 0,
    fixturesSkipped: 0,
  };
}

async function extractSamples(fixtures) {
  const out = createEmptySampleSet();

  for (const fixture of fixtures) {
    let image;
    try {
      image = await readPngImage(fixture.imagePath);
    } catch {
      out.fixturesSkipped += 1;
      continue;
    }

    const layout = LAYOUT_PROFILES[safeProfile(fixture.profile)];
    const boardImage = cropNormalized(image, layout.boardRect);
    const rackImage = cropNormalized(image, layout.rackRect);
    const fixtureWords = new Map();
    for (const word of collectBoardWords(fixture.correction.board)) {
      fixtureWords.set(word, (fixtureWords.get(word) ?? 0) + 1);
    }
    out.correctionWordCountsByFixture.set(fixture.id, fixtureWords);
    out.fixturesUsed += 1;

    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        const rect = cellRect(boardImage.width, boardImage.height, row, col, 15, 15);
        const tileImage = cropImage(boardImage, rect);
        const cell = fixture.correction.board?.[row]?.[col] ?? null;
        const letter = normalizeLetter(cell?.letter ?? '');
        const isBlank = Boolean(cell?.isBlank);
        const occupied = isBlank || Boolean(letter);
        const booster = cell?.premium !== null;

        out.boardSamples[fixture.profile].push({
          fixtureId: fixture.id,
          profile: fixture.profile,
          blue: getBlueDominanceRatio(tileImage, BOARD_BLUE_OPTIONS),
          white: getWhiteInkRatio(tileImage, BOARD_WHITE_OPTIONS),
          glyphWhite: getGlyphWhiteRatio(tileImage, BOARD_GLYPH_CROP),
          occupied,
          booster,
        });

        if (occupied && letter) {
          out.glyphSamples.push({
            fixtureId: fixture.id,
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
      const rackTile = fixture.correction.rack?.[index] ?? null;
      const letter = normalizeLetter(rackTile?.letter ?? '');
      const isBlank = Boolean(rackTile?.isBlank);
      const occupied = isBlank || Boolean(letter);

      out.rackSamples[fixture.profile].push({
        fixtureId: fixture.id,
        profile: fixture.profile,
        blue: getBlueDominanceRatio(tileImage, RACK_BLUE_OPTIONS),
        white: getWhiteInkRatio(tileImage, RACK_WHITE_OPTIONS),
        glyphWhite: getGlyphWhiteRatio(tileImage, RACK_GLYPH_CROP),
        occupied,
        isBlank,
      });

      if (occupied) {
        out.glyphSamples.push({
          fixtureId: fixture.id,
          mode: 'rack',
          label: isBlank ? '?' : letter,
          vector: extractGlyphVector(tileImage, RACK_GLYPH_CROP),
        });
      }
    }
  }

  return out;
}

function pickSamplesByFixtureIds(samples, fixtureIds) {
  const board = { ios: [], android: [] };
  const rack = { ios: [], android: [] };
  for (const profile of PROFILE_IDS) {
    board[profile] = samples.boardSamples[profile].filter((sample) => fixtureIds.has(sample.fixtureId));
    rack[profile] = samples.rackSamples[profile].filter((sample) => fixtureIds.has(sample.fixtureId));
  }
  const glyph = samples.glyphSamples.filter((sample) => fixtureIds.has(sample.fixtureId));
  return { board, rack, glyph };
}

function aggregateWordCountsByFixture(wordCountsByFixture, fixtureIds) {
  const counts = new Map();
  for (const fixtureId of fixtureIds) {
    const words = wordCountsByFixture.get(fixtureId);
    if (!words) {
      continue;
    }
    for (const [word, count] of words.entries()) {
      counts.set(word, (counts.get(word) ?? 0) + count);
    }
  }
  return counts;
}

function toSortedWordStats(wordCounts, sourceCount) {
  const sortedEntries = [...wordCounts.entries()].sort((lhs, rhs) => {
    if (rhs[1] !== lhs[1]) {
      return rhs[1] - lhs[1];
    }
    return lhs[0].localeCompare(rhs[0]);
  });

  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    sourceCount,
    uniqueWords: wordCounts.size,
    words: Object.fromEntries(sortedEntries),
  };
}

function fitModels(trainSamples, existingTuning, trainFixtureCount, correctionWordCounts, correctionLabelsUsed) {
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

  const profileReport = {};
  for (const profile of PROFILE_IDS) {
    const board = trainSamples.board[profile];
    const rack = trainSamples.rack[profile];

    if (board.length === 0 || rack.length === 0) {
      profileReport[profile] = {
        skipped: true,
        reason: 'No train fixtures for profile',
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

    profileReport[profile] = {
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

  const prototypeOutput = buildPrototypeCorpus(trainSamples.glyph);
  prototypeOutput.corpus.sourceCount = trainFixtureCount;

  const boardOccupancyAll = [...trainSamples.board.ios, ...trainSamples.board.android];
  const boardRegular = boardOccupancyAll.filter((sample) => !sample.booster);
  const boardBooster = boardOccupancyAll.filter((sample) => sample.booster);
  const rackOccupancyAll = [...trainSamples.rack.ios, ...trainSamples.rack.android];

  const boardRegularModel = buildOccupancyClassifier(boardRegular);
  const boardBoosterModel = buildOccupancyClassifier(boardBooster);
  const rackModel = buildOccupancyClassifier(rackOccupancyAll);

  const occupancyClassifier = {
    version: '1',
    trainedAt: new Date().toISOString(),
    sourceCount: trainFixtureCount,
    board: {
      regular: boardRegularModel?.model ?? null,
      booster: boardBoosterModel?.model ?? null,
    },
    rack: {
      default: rackModel?.model ?? null,
    },
    crops: {
      boardGlyphCrop: BOARD_GLYPH_CROP,
      rackGlyphCrop: RACK_GLYPH_CROP,
    },
  };

  const reportPrototypes = {
    sampleCount: trainSamples.glyph.length,
    trainAccuracy: round(prototypeOutput.trainAccuracy, 4),
    boardLabels: Object.keys(prototypeOutput.corpus.board).length,
    rackLabels: Object.keys(prototypeOutput.corpus.rack).length,
  };

  const reportOccupancyClassifier = {
    boardRegular: boardRegularModel
      ? {
          metrics: boardRegularModel.metrics,
          probabilitySummary: boardRegularModel.probabilitySummary,
        }
      : { skipped: true },
    boardBooster: boardBoosterModel
      ? {
          metrics: boardBoosterModel.metrics,
          probabilitySummary: boardBoosterModel.probabilitySummary,
        }
      : { skipped: true },
    rack: rackModel
      ? {
          metrics: rackModel.metrics,
          probabilitySummary: rackModel.probabilitySummary,
        }
      : { skipped: true },
  };

  const correctionWordStats = toSortedWordStats(correctionWordCounts, correctionLabelsUsed);

  return {
    nextTuning,
    profileReport,
    prototypeOutput,
    occupancyClassifier,
    reportPrototypes,
    reportOccupancyClassifier,
    correctionWordStats,
  };
}

function classifyPrototypeLabel(vector, corpus, mode) {
  const entries = corpus[mode] ?? {};
  let bestLabel = null;
  let bestSimilarity = -1;
  for (const [label, raw] of Object.entries(entries)) {
    const variants = Array.isArray(raw) ? raw : [raw];
    for (const variant of variants) {
      if (!variant || !Array.isArray(variant.vector)) {
        continue;
      }
      const similarity = dotProduct(vector, variant.vector);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestLabel = label;
      }
    }
  }
  return bestLabel;
}

function evaluateValidationMetrics(validationSamples, fitted) {
  const boardValidation = [...validationSamples.board.ios, ...validationSamples.board.android];
  const rackValidation = [...validationSamples.rack.ios, ...validationSamples.rack.android];
  const hasValidation = boardValidation.length > 0 || rackValidation.length > 0 || validationSamples.glyph.length > 0;
  if (!hasValidation) {
    return {
      skipped: true,
      reason: 'No validation fixtures selected',
    };
  }

  let boardTp = 0;
  let boardFp = 0;
  let boardFn = 0;
  let boardTn = 0;

  for (const sample of boardValidation) {
    const tuning = fitted.nextTuning[sample.profile];
    const blueMin = sample.booster ? tuning.boardBlueTileRatioMinOnBooster : tuning.boardBlueTileRatioMin;
    const whiteMin = sample.booster ? tuning.boardWhiteInkRatioMin + 0.012 : tuning.boardWhiteInkRatioMin;
    const localLikely = sample.blue >= blueMin && sample.white >= whiteMin;

    let predicted = localLikely;
    if (!predicted && !sample.booster) {
      const model = fitted.occupancyClassifier.board.regular;
      if (model) {
        const probability = classifyOccupancyProbability(
          [sample.blue, sample.white, sample.glyphWhite],
          model,
        );
        predicted = probability >= clamp01(model.threshold + 0.02);
      }
    }

    if (predicted && sample.occupied) {
      boardTp += 1;
    } else if (predicted && !sample.occupied) {
      boardFp += 1;
    } else if (!predicted && sample.occupied) {
      boardFn += 1;
    } else {
      boardTn += 1;
    }
  }

  const boardOccupancy = computeMetrics(boardTp, boardFp, boardFn, boardTn);

  const boardGlyphValidation = validationSamples.glyph.filter((sample) => sample.mode === 'board');
  let boardLetterCorrect = 0;
  for (const sample of boardGlyphValidation) {
    const predicted = classifyPrototypeLabel(sample.vector, fitted.prototypeOutput.corpus, 'board');
    if (predicted === sample.label) {
      boardLetterCorrect += 1;
    }
  }

  const rackGlyphValidation = validationSamples.glyph.filter((sample) => sample.mode === 'rack');
  let rackCorrect = 0;
  for (const sample of rackGlyphValidation) {
    const predicted = classifyPrototypeLabel(sample.vector, fitted.prototypeOutput.corpus, 'rack');
    if (predicted === sample.label) {
      rackCorrect += 1;
    }
  }

  return {
    skipped: false,
    boardOccupancy: {
      precision: round(boardOccupancy.precision, 4),
      recall: round(boardOccupancy.recall, 4),
      f1: round(boardOccupancy.f1, 4),
      fpRate: round(boardOccupancy.fpRate, 4),
      tp: boardTp,
      fp: boardFp,
      fn: boardFn,
      tn: boardTn,
      sampleCount: boardValidation.length,
    },
    boardLetter: {
      correct: boardLetterCorrect,
      total: boardGlyphValidation.length,
      accuracy: boardGlyphValidation.length > 0 ? round(boardLetterCorrect / boardGlyphValidation.length, 4) : 0,
    },
    rackAccuracy: {
      correct: rackCorrect,
      total: rackGlyphValidation.length,
      accuracy: rackGlyphValidation.length > 0 ? round(rackCorrect / rackGlyphValidation.length, 4) : 0,
    },
  };
}

async function main() {
  const cli = parseCliOptions(process.argv.slice(2));
  const fixtureLoad = await loadCorrectionFixtures(cli.manifestPath);
  const split = splitFixtures(fixtureLoad.fixtures, {
    validationRatio: cli.validationRatio,
    splitSeed: cli.splitSeed,
  });
  const samples = await extractSamples(fixtureLoad.fixtures);

  const existingTuning = await readJson(OUTPUT_TUNING, {
    ios: { ...DEFAULT_PARSER_TUNING },
    android: { ...DEFAULT_PARSER_TUNING },
  });

  const trainSamples = pickSamplesByFixtureIds(samples, split.trainFixtureIds);
  const validationSamples = pickSamplesByFixtureIds(samples, split.validationFixtureIds);
  const trainWordCounts = aggregateWordCountsByFixture(
    samples.correctionWordCountsByFixture,
    split.trainFixtureIds,
  );

  const fitted = fitModels(
    trainSamples,
    existingTuning,
    split.trainFixtures.length,
    trainWordCounts,
    split.trainFixtures.length,
  );
  const validationMetrics = evaluateValidationMetrics(validationSamples, fitted);

  const report = {
    manifestPath: cli.manifestPath,
    generatedAt: new Date().toISOString(),
    fixturesUsed: samples.fixturesUsed,
    fixturesSkipped: fixtureLoad.skipped + samples.fixturesSkipped,
    correctionLabelsUsed: fixtureLoad.correctionLabelsUsed,
    correctionWordCount: fitted.correctionWordStats.uniqueWords,
    split: {
      ratio: round(split.ratio, 4),
      seed: split.seed,
      trainFixtureCount: split.trainFixtures.length,
      validationFixtureCount: split.validationFixtures.length,
    },
    validationMetrics,
    profiles: fitted.profileReport,
    prototypes: fitted.reportPrototypes,
    occupancyClassifier: fitted.reportOccupancyClassifier,
  };

  await writeFile(OUTPUT_TUNING, `${JSON.stringify(fitted.nextTuning, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_PROTOTYPES, `${JSON.stringify(fitted.prototypeOutput.corpus, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_TILE_CLASSIFIER, `${JSON.stringify(fitted.occupancyClassifier, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_WORD_STATS, `${JSON.stringify(fitted.correctionWordStats, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `Tuned parser from ${samples.fixturesUsed} extracted fixtures (${fixtureLoad.skipped + samples.fixturesSkipped} skipped).`,
  );
  console.log(
    `Split: train=${split.trainFixtures.length}, validation=${split.validationFixtures.length}, ratio=${round(split.ratio, 4)}, seed=${split.seed}`,
  );
  console.log(`Wrote ${OUTPUT_TUNING}`);
  console.log(`Wrote ${OUTPUT_PROTOTYPES}`);
  console.log(`Wrote ${OUTPUT_TILE_CLASSIFIER}`);
  console.log(`Wrote ${OUTPUT_WORD_STATS}`);
  console.log(`Wrote ${OUTPUT_REPORT}`);
  console.log(`Prototype train accuracy: ${round(fitted.prototypeOutput.trainAccuracy, 4)}`);
  if (!validationMetrics.skipped) {
    console.log(
      `Validation: board occupancy f1=${validationMetrics.boardOccupancy.f1}, board letter=${validationMetrics.boardLetter.accuracy}, rack=${validationMetrics.rackAccuracy.accuracy}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
