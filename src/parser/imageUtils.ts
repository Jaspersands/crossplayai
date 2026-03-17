import type { NormalizedRect } from '../config/layoutProfiles';

export function createCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height);
}

export function cropCanvas(source: OffscreenCanvas, rect: NormalizedRect): OffscreenCanvas {
  const x = Math.floor(source.width * rect.x);
  const y = Math.floor(source.height * rect.y);
  const width = Math.floor(source.width * rect.width);
  const height = Math.floor(source.height * rect.height);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable for crop');
  }

  ctx.drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas;
}

export function cellRect(
  totalWidth: number,
  totalHeight: number,
  row: number,
  col: number,
  rows: number,
  cols: number,
  /** Fraction of the cell to trim from each edge (0 = full cell, 0.15 = inner 70%). */
  insetFraction = 0,
): { x: number; y: number; width: number; height: number } {
  const cellWidth = totalWidth / cols;
  const cellHeight = totalHeight / rows;
  const insetX = cellWidth * insetFraction;
  const insetY = cellHeight * insetFraction;
  return {
    x: Math.floor(col * cellWidth + insetX),
    y: Math.floor(row * cellHeight + insetY),
    width: Math.max(1, Math.ceil(cellWidth - 2 * insetX)),
    height: Math.max(1, Math.ceil(cellHeight - 2 * insetY)),
  };
}

export function rackRect(
  totalWidth: number,
  totalHeight: number,
  index: number,
  tiles: number,
): { x: number; y: number; width: number; height: number } {
  const tileWidth = totalWidth / tiles;
  return {
    x: Math.floor(index * tileWidth),
    y: 0,
    width: Math.ceil(tileWidth),
    height: totalHeight,
  };
}

export function getImageDataStats(imageData: ImageData): {
  mean: number;
  variance: number;
  darkRatio: number;
} {
  const { data } = imageData;
  let sum = 0;
  let sumSquared = 0;
  let darkPixels = 0;

  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const intensity = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += intensity;
    sumSquared += intensity * intensity;
    if (intensity < 95) {
      darkPixels += 1;
    }
  }

  const mean = sum / count;
  const variance = sumSquared / count - mean * mean;
  const darkRatio = darkPixels / count;

  return {
    mean,
    variance,
    darkRatio,
  };
}

export function imageDataToBlob(imageData: ImageData): Promise<Blob> {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable for blob conversion');
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export function cropImageData(
  imageData: ImageData,
  region: { x: number; y: number; width: number; height: number },
): ImageData {
  const x = Math.max(0, Math.min(imageData.width - 1, Math.floor(region.x)));
  const y = Math.max(0, Math.min(imageData.height - 1, Math.floor(region.y)));
  const width = Math.max(1, Math.min(imageData.width - x, Math.floor(region.width)));
  const height = Math.max(1, Math.min(imageData.height - y, Math.floor(region.height)));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable for ImageData crop');
  }

  const sourceCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    throw new Error('2d context unavailable for source ImageData crop');
  }

  sourceCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function getBlueDominanceRatio(
  imageData: ImageData,
  options: {
    insetRatio?: number;
    blueMin?: number;
    blueOverRed?: number;
    blueOverGreen?: number;
    brightnessMax?: number;
  } = {},
): number {
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
