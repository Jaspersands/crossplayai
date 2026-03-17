import tileClassifierModelRaw from '../data/tileClassifierModel.json';

type TileMode = 'board' | 'rack';

type GlyphCrop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type OccupancyModelEntry = {
  featureNames: string[];
  featureMeans: number[];
  featureStds: number[];
  occupiedCentroid: number[];
  emptyCentroid: number[];
  threshold: number;
  occupiedCount: number;
  emptyCount: number;
};

type TileClassifierModel = {
  version: string;
  trainedAt: string;
  sourceCount: number;
  board: {
    regular: OccupancyModelEntry | null;
    booster: OccupancyModelEntry | null;
  };
  rack: {
    default: OccupancyModelEntry | null;
  };
  crops: {
    boardGlyphCrop: GlyphCrop;
    rackGlyphCrop: GlyphCrop;
  };
};

export type TileOccupancyPrediction = {
  occupied: boolean;
  probability: number;
  threshold: number;
  confidence: number;
};

const model = tileClassifierModelRaw as TileClassifierModel;

const BOARD_BLUE_OPTIONS = {
  insetRatio: 0.16,
  blueMin: 100,
  blueOverRed: 26,
  blueOverGreen: 10,
  brightnessMax: 450,
} as const;

const BOARD_WHITE_OPTIONS = {
  insetRatio: 0.2,
  whiteMin: 170,
  channelDeltaMax: 28,
} as const;

const RACK_BLUE_OPTIONS = {
  insetRatio: 0.1,
  blueMin: 96,
  blueOverRed: 20,
  blueOverGreen: 8,
  brightnessMax: 560,
} as const;

const RACK_WHITE_OPTIONS = {
  insetRatio: 0.2,
  whiteMin: 180,
  channelDeltaMax: 30,
} as const;

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

function getBlueDominanceRatio(
  imageData: ImageData,
  options: {
    insetRatio: number;
    blueMin: number;
    blueOverRed: number;
    blueOverGreen: number;
    brightnessMax: number;
  },
): number {
  const startX = Math.floor(imageData.width * options.insetRatio);
  const endX = Math.max(startX + 1, Math.ceil(imageData.width * (1 - options.insetRatio)));
  const startY = Math.floor(imageData.height * options.insetRatio);
  const endY = Math.max(startY + 1, Math.ceil(imageData.height * (1 - options.insetRatio)));

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
        b >= options.blueMin &&
        b - r >= options.blueOverRed &&
        b - g >= options.blueOverGreen &&
        brightness <= options.brightnessMax
      ) {
        bluePixels += 1;
      }
    }
  }

  return total > 0 ? bluePixels / total : 0;
}

function getWhiteInkRatio(
  imageData: ImageData,
  options: {
    insetRatio: number;
    whiteMin: number;
    channelDeltaMax: number;
  },
): number {
  const startX = Math.floor(imageData.width * options.insetRatio);
  const endX = Math.max(startX + 1, Math.ceil(imageData.width * (1 - options.insetRatio)));
  const startY = Math.floor(imageData.height * options.insetRatio);
  const endY = Math.max(startY + 1, Math.ceil(imageData.height * (1 - options.insetRatio)));

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
        r >= options.whiteMin &&
        g >= options.whiteMin &&
        b >= options.whiteMin &&
        Math.abs(r - g) <= options.channelDeltaMax &&
        Math.abs(r - b) <= options.channelDeltaMax
      ) {
        whitePixels += 1;
      }
    }
  }

  return total > 0 ? whitePixels / total : 0;
}

function getGlyphWhiteRatio(imageData: ImageData, crop: GlyphCrop): number {
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

function classifyProbability(
  features: number[],
  entry: OccupancyModelEntry,
): number {
  if (
    entry.featureMeans.length !== entry.featureStds.length ||
    entry.featureMeans.length !== entry.occupiedCentroid.length ||
    entry.featureMeans.length !== entry.emptyCentroid.length ||
    entry.featureMeans.length !== features.length
  ) {
    return 0.5;
  }

  const normalized = features.map((value, index) => {
    const std = entry.featureStds[index] > 1e-4 ? entry.featureStds[index] : 1e-4;
    return (value - entry.featureMeans[index]) / std;
  });

  const occupiedDistance = normalized.reduce(
    (sum, value, index) => sum + ((value - entry.occupiedCentroid[index]) ** 2),
    0,
  );
  const emptyDistance = normalized.reduce(
    (sum, value, index) => sum + ((value - entry.emptyCentroid[index]) ** 2),
    0,
  );

  const occupiedScore = -occupiedDistance;
  const emptyScore = -emptyDistance;
  const delta = Math.max(-16, Math.min(16, occupiedScore - emptyScore));
  return clamp01(1 / (1 + Math.exp(-delta)));
}

function pickEntry(
  mode: TileMode,
  booster: boolean,
): { entry: OccupancyModelEntry; crop: GlyphCrop } | null {
  if (mode === 'board') {
    const entry = booster ? model.board.booster : model.board.regular;
    if (!entry) {
      return null;
    }
    return {
      entry,
      crop: model.crops.boardGlyphCrop,
    };
  }

  const entry = model.rack.default;
  if (!entry) {
    return null;
  }

  return {
    entry,
    crop: model.crops.rackGlyphCrop,
  };
}

export function hasTileOccupancyClassifier(): boolean {
  return Boolean(
    model?.board?.regular ||
    model?.board?.booster ||
    model?.rack?.default,
  );
}

export function classifyTileOccupancy(
  imageData: ImageData,
  mode: TileMode,
  options: { booster?: boolean } = {},
): TileOccupancyPrediction | null {
  const booster = Boolean(options.booster);
  const selected = pickEntry(mode, booster);
  if (!selected) {
    return null;
  }

  const blue = getBlueDominanceRatio(
    imageData,
    mode === 'board' ? BOARD_BLUE_OPTIONS : RACK_BLUE_OPTIONS,
  );
  const white = getWhiteInkRatio(
    imageData,
    mode === 'board' ? BOARD_WHITE_OPTIONS : RACK_WHITE_OPTIONS,
  );
  const glyphWhite = getGlyphWhiteRatio(imageData, selected.crop);

  const probability = classifyProbability([blue, white, glyphWhite], selected.entry);
  const threshold = clamp01(selected.entry.threshold);
  const occupied = probability >= threshold;
  const denominator = Math.max(1e-4, Math.max(threshold, 1 - threshold));
  const confidence = clamp01(Math.abs(probability - threshold) / denominator);

  return {
    occupied,
    probability,
    threshold,
    confidence,
  };
}
