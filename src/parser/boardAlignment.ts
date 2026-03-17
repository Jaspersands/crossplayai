import type { NormalizedRect } from '../config/layoutProfiles';
import { PREMIUM_BOARD } from '../constants/board';
import type { ProfileType } from '../types/game';
import { getBlueDominanceRatio } from './imageUtils';
import { classifyTileOccupancy } from '../lib/tileClassifier';

type AlignmentTuning = {
  boardBlueTileRatioMin: number;
  boardBlueTileRatioMinOnBooster: number;
  boardWhiteInkRatioMin: number;
};

const WHITE_OPTIONS = {
  insetRatio: 0.2,
  whiteMin: 170,
  channelDeltaMax: 28,
} as const;

const SEARCH_DELTAS = {
  xy: [-0.008, -0.004, 0, 0.004, 0.008],
  wh: [-0.012, -0.006, 0, 0.006, 0.012],
} as const;

const SAMPLE_ROWS = [0, 1, 2, 4, 5, 7, 9, 10, 12, 13, 14] as const;
const SAMPLE_COLS = [0, 1, 2, 4, 5, 7, 9, 10, 12, 13, 14] as const;

const MIN_RECT_SCORE_DELTA = 0.32;

function isRectValid(rect: NormalizedRect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1 &&
    rect.y + rect.height <= 1
  );
}

function clampRect(rect: NormalizedRect): NormalizedRect {
  const width = Math.min(1, Math.max(0.4, rect.width));
  const height = Math.min(1, Math.max(0.35, rect.height));
  const x = Math.min(1 - width, Math.max(0, rect.x));
  const y = Math.min(1 - height, Math.max(0, rect.y));
  return { x, y, width, height };
}

function getWhiteInkRatio(imageData: ImageData): number {
  const startX = Math.floor(imageData.width * WHITE_OPTIONS.insetRatio);
  const endX = Math.max(startX + 1, Math.ceil(imageData.width * (1 - WHITE_OPTIONS.insetRatio)));
  const startY = Math.floor(imageData.height * WHITE_OPTIONS.insetRatio);
  const endY = Math.max(startY + 1, Math.ceil(imageData.height * (1 - WHITE_OPTIONS.insetRatio)));

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
        r >= WHITE_OPTIONS.whiteMin &&
        g >= WHITE_OPTIONS.whiteMin &&
        b >= WHITE_OPTIONS.whiteMin &&
        Math.abs(r - g) <= WHITE_OPTIONS.channelDeltaMax &&
        Math.abs(r - b) <= WHITE_OPTIONS.channelDeltaMax
      ) {
        whitePixels += 1;
      }
    }
  }

  return total > 0 ? whitePixels / total : 0;
}

function sampleBoardRectScore(
  canvas: OffscreenCanvas,
  rect: NormalizedRect,
  tuning: AlignmentTuning,
): number {
  const px = Math.floor(canvas.width * rect.x);
  const py = Math.floor(canvas.height * rect.y);
  const pw = Math.max(1, Math.floor(canvas.width * rect.width));
  const ph = Math.max(1, Math.floor(canvas.height * rect.height));

  const boardCanvas = new OffscreenCanvas(pw, ph);
  const boardCtx = boardCanvas.getContext('2d');
  if (!boardCtx) {
    return -Infinity;
  }

  boardCtx.drawImage(canvas, px, py, pw, ph, 0, 0, pw, ph);
  const cellWidth = pw / 15;
  const cellHeight = ph / 15;

  let score = 0;

  for (const row of SAMPLE_ROWS) {
    for (const col of SAMPLE_COLS) {
      const cellX = Math.floor(col * cellWidth);
      const cellY = Math.floor(row * cellHeight);
      const cellW = Math.max(1, Math.ceil(cellWidth));
      const cellH = Math.max(1, Math.ceil(cellHeight));
      const imageData = boardCtx.getImageData(cellX, cellY, cellW, cellH);

      const booster = PREMIUM_BOARD[row]?.[col] !== null;
      const blue = getBlueDominanceRatio(imageData, {
        insetRatio: 0.16,
        blueMin: 100,
        blueOverRed: 26,
        blueOverGreen: 10,
        brightnessMax: 450,
      });
      const white = getWhiteInkRatio(imageData);

      const blueMin = booster ? tuning.boardBlueTileRatioMinOnBooster : tuning.boardBlueTileRatioMin;
      const whiteMin = booster ? tuning.boardWhiteInkRatioMin + 0.012 : tuning.boardWhiteInkRatioMin;

      const blueMargin = blue - blueMin;
      const whiteMargin = white - whiteMin;
      const localLikely = blueMargin >= 0 && whiteMargin >= 0;

      const occupancy = classifyTileOccupancy(imageData, 'board', { booster });
      const occupancyMargin = occupancy ? occupancy.probability - occupancy.threshold : 0;

      let cellScore = 0;
      if (localLikely) {
        cellScore += 1.6;
      }

      cellScore += blueMargin * 2.2;
      cellScore += whiteMargin * 1.1;
      cellScore += occupancyMargin * 0.8;

      if (blue <= 0.03 && white >= 0.58) {
        cellScore -= 0.35;
      }

      score += cellScore;
    }
  }

  return score;
}

export function refineBoardRect(
  canvas: OffscreenCanvas,
  baseRect: NormalizedRect,
  _profile: ProfileType,
  tuning: AlignmentTuning,
): NormalizedRect {
  const normalizedBase = clampRect(baseRect);
  const baseScore = sampleBoardRectScore(canvas, normalizedBase, tuning);

  let bestRect = normalizedBase;
  let bestScore = baseScore;

  for (const dx of SEARCH_DELTAS.xy) {
    for (const dy of SEARCH_DELTAS.xy) {
      for (const dw of SEARCH_DELTAS.wh) {
        for (const dh of SEARCH_DELTAS.wh) {
          if (dx === 0 && dy === 0 && dw === 0 && dh === 0) {
            continue;
          }

          const candidate = clampRect({
            x: normalizedBase.x + dx,
            y: normalizedBase.y + dy,
            width: normalizedBase.width + dw,
            height: normalizedBase.height + dh,
          });
          if (!isRectValid(candidate)) {
            continue;
          }

          const candidateScore = sampleBoardRectScore(canvas, candidate, tuning);
          if (candidateScore > bestScore) {
            bestScore = candidateScore;
            bestRect = candidate;
          }
        }
      }
    }
  }

  if (!Number.isFinite(baseScore) || !Number.isFinite(bestScore)) {
    return normalizedBase;
  }

  if (bestScore - baseScore < MIN_RECT_SCORE_DELTA) {
    return normalizedBase;
  }

  return bestRect;
}
