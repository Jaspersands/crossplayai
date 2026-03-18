import { PSM, createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import { LAYOUT_PROFILES, detectProfile, type LayoutProfile } from '../config/layoutProfiles';
import profileThresholds from '../config/profileThresholds.json';
import parserTuning from '../config/parserTuning.json';
import correctionWordStatsRaw from '../data/correctionWordStats.json';
import { LETTER_SCORES, PREMIUM_BOARD } from '../constants/board';
import type { Board, ParsedState, ProfileType, RackTile } from '../types/game';
import { createEmptyBoard, normalizeLetter } from '../lib/boardUtils';
import { resolveOpenAiApiKey } from '../lib/openaiKey';
import { classifyPrototypeLetter, type PrototypeMode } from '../lib/prototypeClassifier';
import { cellRect, cropCanvas, cropImageData, getBlueDominanceRatio, imageDataToBlob } from './imageUtils';
import { loadOpenCv } from './opencv';

type ProfileThresholds = {
  lowConfidence: number;
};

type ParserTuningProfile = {
  boardBlueTileRatioMin: number;
  boardBlueTileRatioMinOnBooster: number;
  boardWhiteInkRatioMin: number;
  rackBlueTileRatioMin: number;
  rackWhiteInkRatioMin: number;
  ocrMinConfidence: number;
  prototypeConfidenceFloor: number;
  prototypeOverrideConfidence: number;
  prototypeConflictDelta: number;
};

const DEFAULT_PARSER_TUNING: ParserTuningProfile = {
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

function getParserTuning(profile: ProfileType): ParserTuningProfile {
  const entry = parserTuning[profile] as Partial<ParserTuningProfile> | undefined;
  return {
    boardBlueTileRatioMin: entry?.boardBlueTileRatioMin ?? DEFAULT_PARSER_TUNING.boardBlueTileRatioMin,
    boardBlueTileRatioMinOnBooster:
      entry?.boardBlueTileRatioMinOnBooster ?? DEFAULT_PARSER_TUNING.boardBlueTileRatioMinOnBooster,
    boardWhiteInkRatioMin: entry?.boardWhiteInkRatioMin ?? DEFAULT_PARSER_TUNING.boardWhiteInkRatioMin,
    rackBlueTileRatioMin: entry?.rackBlueTileRatioMin ?? DEFAULT_PARSER_TUNING.rackBlueTileRatioMin,
    rackWhiteInkRatioMin: entry?.rackWhiteInkRatioMin ?? DEFAULT_PARSER_TUNING.rackWhiteInkRatioMin,
    ocrMinConfidence: entry?.ocrMinConfidence ?? DEFAULT_PARSER_TUNING.ocrMinConfidence,
    prototypeConfidenceFloor: entry?.prototypeConfidenceFloor ?? DEFAULT_PARSER_TUNING.prototypeConfidenceFloor,
    prototypeOverrideConfidence:
      entry?.prototypeOverrideConfidence ?? DEFAULT_PARSER_TUNING.prototypeOverrideConfidence,
    prototypeConflictDelta: entry?.prototypeConflictDelta ?? DEFAULT_PARSER_TUNING.prototypeConflictDelta,
  };
}

const SCORE_HINT_WEIGHT = 0.26;
const SCORE_HINT_MISMATCH_PENALTY = 0.21;
const STRONG_SCORE_HINT_CONFIDENCE = 0.63;
const MEDIUM_SCORE_HINT_CONFIDENCE = 0.45;
const BOARD_BLANK_FROM_SCORE_MIN_CONFIDENCE = 0.4;
const RACK_BLANK_FROM_SCORE_MIN_CONFIDENCE = 0.32;
const MAX_WORD_REFINEMENT_PASSES = 3;
const MAX_WORD_SEARCH_COMBINATIONS = 1500;
const MAX_CANDIDATES_PER_CELL = 4;
const CORRECTION_WORD_BONUS_WEIGHT = 0.05;
const CORRECTION_WORD_VALID_MIN_COUNT = 2;

const LETTERS_BY_SCORE = Object.entries(LETTER_SCORES).reduce<Map<number, string[]>>((acc, [letter, score]) => {
  const list = acc.get(score) ?? [];
  list.push(letter);
  acc.set(score, list);
  return acc;
}, new Map<number, string[]>());

type CandidateGrid = Array<Array<Map<string, number>>>;
type ConfidenceGrid = number[][];
type BooleanGrid = boolean[][];

type WordPlacement = {
  direction: 'across' | 'down';
  text: string;
  cells: Array<{ row: number; col: number }>;
};

type CorrectionWordStats = {
  words?: Record<string, number>;
};

const correctionWordStats = correctionWordStatsRaw as CorrectionWordStats;
const CORRECTION_WORD_COUNTS = new Map<string, number>(
  Object.entries(correctionWordStats.words ?? {})
    .filter(([word, count]) => /^[A-Z]{2,}$/.test(word) && Number.isFinite(count))
    .map(([word, count]) => [word, Number(count)]),
);

let ocrWorkerPromise: Promise<TesseractWorker> | null = null;
let scoreWorkerPromise: Promise<TesseractWorker> | null = null;
let parserLexiconPromise: Promise<Set<string>> | null = null;
let letterWorkerInitialized = false;
let scoreWorkerInitialized = false;

const VISION_MODEL = 'gpt-4.1-mini';

type VisionBoardResult = {
  board: Board;
  rack: RackTile[];
};

async function canvasToBase64Jpeg(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Detect which cells have tiles using blue-ratio analysis.
 * Returns a 15x15 boolean grid (true = cell has a tile).
 */
function detectOccupiedCells(
  boardCanvas: OffscreenCanvas,
): boolean[][] {
  const TILE_THRESHOLD = 0.35;
  /** Inset 15% from each edge so adjacent-tile pixels don't bleed in. */
  const DETECT_INSET = 0.15;
  const ctx = boardCanvas.getContext('2d')!;
  const fullImageData = ctx.getImageData(0, 0, boardCanvas.width, boardCanvas.height);

  const grid: boolean[][] = [];
  for (let r = 0; r < 15; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < 15; c += 1) {
      const rect = cellRect(boardCanvas.width, boardCanvas.height, r, c, 15, 15, DETECT_INSET);
      const cellData = cropImageData(fullImageData, rect);
      // insetRatio=0 because cellRect already handles the inset
      const blueRatio = getBlueDominanceRatio(cellData, { insetRatio: 0 });
      row.push(blueRatio >= TILE_THRESHOLD);
    }
    grid.push(row);
  }
  return grid;
}

type TileRowData = {
  row: number;
  cols: number[];
};

/**
 * Build a composite image with individual tile crops arranged in rows.
 * Each row shows cropped tiles from that row laid out left-to-right with gaps.
 * Row labels are on the left.
 */
function buildTileCropComposite(
  boardCanvas: OffscreenCanvas,
  occupied: boolean[][],
): { composite: OffscreenCanvas; tileRows: TileRowData[] } {
  const w = boardCanvas.width;
  const h = boardCanvas.height;
  const cellW = w / 15;
  const cellH = h / 15;

  // Build per-row data
  const tileRows: TileRowData[] = [];
  for (let r = 0; r < 15; r += 1) {
    const cols: number[] = [];
    for (let c = 0; c < 15; c += 1) {
      if (occupied[r][c]) cols.push(c);
    }
    if (cols.length > 0) {
      tileRows.push({ row: r, cols });
    }
  }

  if (tileRows.length === 0) {
    return { composite: new OffscreenCanvas(1, 1), tileRows };
  }

  const tileSize = Math.floor(cellH * 2); // 2x upscale for sharper letter/point-value readability
  const gap = 4;
  const labelW = 28;
  const rowH = tileSize + gap;
  const maxTiles = Math.max(...tileRows.map((tr) => tr.cols.length));
  const totalW = labelW + maxTiles * (tileSize + gap) + gap;
  const totalH = tileRows.length * rowH + gap;

  const composite = new OffscreenCanvas(totalW, totalH);
  const ctx = composite.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  const fontSize = Math.max(10, Math.min(16, Math.floor(tileSize * 0.35)));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < tileRows.length; i += 1) {
    const { row, cols } = tileRows[i];
    const y = gap + i * rowH;

    // Row label
    ctx.fillStyle = '#000000';
    ctx.fillText(`${row}`, labelW / 2, y + tileSize / 2);

    // Crop inset: 8% keeps letter features (Q tail, I serifs) while avoiding neighbor bleed
    const CROP_INSET = 0.08;
    for (let j = 0; j < cols.length; j += 1) {
      const c = cols[j];
      const inX = cellW * CROP_INSET;
      const inY = cellH * CROP_INSET;
      const sx = Math.floor(c * cellW + inX);
      const sy = Math.floor(row * cellH + inY);
      const sw = Math.max(1, Math.ceil(cellW - 2 * inX));
      const sh = Math.max(1, Math.ceil(cellH - 2 * inY));
      const px = labelW + gap + j * (tileSize + gap);

      ctx.drawImage(boardCanvas, sx, sy, sw, sh, px, y, tileSize, tileSize);
    }
  }

  return { composite, tileRows };
}

async function parseWithVisionApi(
  canvas: OffscreenCanvas,
  apiKey: string,
  profile: LayoutProfile,
): Promise<VisionBoardResult> {
  const boardCanvas = cropCanvas(canvas, profile.boardRect);
  const rackCanvas = cropCanvas(canvas, profile.rackRect);

  // Detect which cells have tiles
  const occupied = detectOccupiedCells(boardCanvas);

  // Build composite with individual tile crops arranged in rows
  const { composite, tileRows } = buildTileCropComposite(boardCanvas, occupied);

  const rowDescriptions = tileRows
    .map((tr) => `Row ${tr.row}: ${tr.cols.length} tile(s)`)
    .join('\n');

  const [compositeBase64, rackBase64] = await Promise.all([
    canvasToBase64Jpeg(composite),
    canvasToBase64Jpeg(rackCanvas),
  ]);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${compositeBase64}`, detail: 'high' },
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${rackBase64}` },
            },
            {
              type: 'text',
              text: `Image 1: Cropped Scrabble tiles arranged in rows. Each row is labeled with its row number on the left. The tiles within each row are shown from left to right, separated by small gaps. Each tile is a blue square with a LARGE white letter and a small point-value number in the top-right corner.

IMPORTANT: Some tiles may appear mostly blue with NO clear letter — these are false detections (blue bleed from adjacent tiles). For those, output "." in the array instead of a letter.

Use the small point-value number to distinguish similar-looking letters:
- Q (10 pts) vs O (1 pt): Q has "10" in corner, O has "1"
- I (1 pt) vs L (1 pt): I is a single vertical stroke, L has a horizontal foot at the bottom
- I vs J: J has a curved bottom/hook
- B vs D: B has two bumps on right, D has one curve

Image 2: The tile rack (up to 7 tiles, left to right).

${rowDescriptions}

Output ONLY valid JSON (no markdown fences):
{"rows":{"7":["F","A","D","E","D"],"8":["A"]},"rack":["X","Y","Z"]}

The "rows" object maps row number (as string) to an array with one entry per tile shown. Use UPPERCASE for letters, lowercase for blank tiles (no point number visible), and "." for blue cells with no visible letter.
The "rack" array has letters from Image 2, left to right.`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';

  // Strip markdown fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Find JSON object in response
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Vision API returned no JSON');
  }

  let parsed: { rows?: Record<string, string[]>; rack?: unknown };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Vision API returned invalid JSON');
  }

  // Build board by mapping row letters to known occupied columns
  // Skip "." entries (model-identified false positives)
  const board = createEmptyBoard();
  const rowsData = parsed.rows ?? {};
  for (const tr of tileRows) {
    const rowLetters = rowsData[String(tr.row)];
    if (!Array.isArray(rowLetters)) continue;

    let colIdx = 0;
    let letterIdx = 0;
    while (letterIdx < rowLetters.length && colIdx < tr.cols.length) {
      const letter = rowLetters[letterIdx];
      if (letter === '.') {
        // Model says this cell is a false positive — skip it
        colIdx += 1;
        letterIdx += 1;
      } else if (typeof letter === 'string' && letter.length === 1 && /[a-zA-Z]/.test(letter)) {
        const isBlank = letter === letter.toLowerCase();
        board[tr.row][tr.cols[colIdx]] = { letter: letter.toUpperCase(), isBlank };
        colIdx += 1;
        letterIdx += 1;
      } else {
        letterIdx += 1;
      }
    }
  }

  // Validate and convert rack
  const rackData = Array.isArray(parsed.rack) ? parsed.rack : [];
  const rack: RackTile[] = [];
  for (let i = 0; i < Math.min(7, rackData.length); i += 1) {
    const tile = rackData[i];
    if (typeof tile === 'string' && tile.length === 1 && /[a-zA-Z]/.test(tile)) {
      const isBlank = tile === tile.toLowerCase();
      rack.push({ letter: tile.toUpperCase(), isBlank });
    } else {
      rack.push({ letter: '', isBlank: false });
    }
  }
  while (rack.length < 7) {
    rack.push({ letter: '', isBlank: false });
  }

  return { board, rack };
}

async function getOcrWorker(): Promise<TesseractWorker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng');
  }

  const worker = await ocrWorkerPromise;
  if (!letterWorkerInitialized) {
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      tessedit_pageseg_mode: PSM.SINGLE_CHAR,
    });
    letterWorkerInitialized = true;
  }
  return worker;
}

async function getScoreWorker(): Promise<TesseractWorker> {
  if (!scoreWorkerPromise) {
    scoreWorkerPromise = createWorker('eng');
  }

  const worker = await scoreWorkerPromise;
  if (!scoreWorkerInitialized) {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: PSM.SINGLE_CHAR,
    });
    scoreWorkerInitialized = true;
  }
  return worker;
}

function normalizeWord(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, '');
}

async function loadParserLexicon(): Promise<Set<string>> {
  if (!parserLexiconPromise) {
    parserLexiconPromise = (async () => {
      try {
        const response = await fetch('/data/twl06.txt');
        if (!response.ok) {
          return new Set<string>();
        }

        const text = await response.text();
        const words = new Set<string>();
        for (const line of text.split(/\r?\n/)) {
          const word = normalizeWord(line);
          if (word.length >= 2) {
            words.add(word);
          }
        }
        return words;
      } catch {
        return new Set<string>();
      }
    })();
  }

  return parserLexiconPromise;
}

async function preprocessWithOpenCv(imageData: ImageData): Promise<ImageData> {
  try {
    const cv = await loadOpenCv();

    const source = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    const thresholded = new cv.Mat();
    const output = new cv.Mat();

    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.threshold(gray, thresholded, 170, 255, cv.THRESH_BINARY);
    cv.bitwise_not(thresholded, thresholded);
    cv.cvtColor(thresholded, output, cv.COLOR_GRAY2RGBA, 0);

    const processed = new ImageData(new Uint8ClampedArray(output.data), output.cols, output.rows);

    source.delete();
    gray.delete();
    thresholded.delete();
    output.delete();

    return processed;
  } catch {
    return imageData;
  }
}

async function canvasFromFile(file: File): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable while decoding screenshot');
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function getWhiteInkRatio(
  imageData: ImageData,
  options: {
    insetRatio?: number;
    whiteMin?: number;
    channelDeltaMax?: number;
  } = {},
): number {
  const { insetRatio = 0.15, whiteMin = 180, channelDeltaMax = 22 } = options;

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

function getDarkInkRatio(
  imageData: ImageData,
  options: {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    darkMax?: number;
  } = {},
): number {
  const {
    left = 0,
    top = 0,
    width = 1,
    height = 1,
    darkMax = 95,
  } = options;

  const startX = Math.max(0, Math.floor(imageData.width * left));
  const startY = Math.max(0, Math.floor(imageData.height * top));
  const endX = Math.max(startX + 1, Math.min(imageData.width, Math.ceil(imageData.width * (left + width))));
  const endY = Math.max(startY + 1, Math.min(imageData.height, Math.ceil(imageData.height * (top + height))));

  let darkPixels = 0;
  let total = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const idx = (y * imageData.width + x) * 4;
      const intensity = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3;
      total += 1;
      if (intensity <= darkMax) {
        darkPixels += 1;
      }
    }
  }
  return total > 0 ? darkPixels / total : 0;
}

function getLetterShapeMetrics(processed: ImageData): {
  bottomBar: number;
  centerStem: number;
  lowerRightInk: number;
  upperRightInk: number;
} {
  return {
    bottomBar: getDarkInkRatio(processed, { left: 0.2, top: 0.74, width: 0.6, height: 0.2 }),
    centerStem: getDarkInkRatio(processed, { left: 0.42, top: 0.15, width: 0.16, height: 0.7 }),
    lowerRightInk: getDarkInkRatio(processed, { left: 0.56, top: 0.56, width: 0.32, height: 0.32 }),
    upperRightInk: getDarkInkRatio(processed, { left: 0.56, top: 0.16, width: 0.32, height: 0.32 }),
  };
}

function readTopChoice(result: Awaited<ReturnType<TesseractWorker['recognize']>>): {
  letter: string | null;
  confidence: number;
  candidates: Map<string, number>;
} {
  const candidates = new Map<string, number>();
  const normalizedText = normalizeLetter(result.data.text ?? '');
  const textConfidence = Math.max(0, Math.min(1, (result.data.confidence ?? 0) / 100));

  if (normalizedText && /[A-Z0-9]/.test(normalizedText)) {
    candidates.set(normalizedText, textConfidence);
  }

  const pageWithWords = result.data as unknown as {
    words?: Array<{
      choices?: Array<{
        text?: string;
        confidence?: number;
      }>;
    }>;
  };

  for (const word of pageWithWords.words ?? []) {
    for (const choice of word.choices ?? []) {
      const letter = normalizeLetter(choice.text ?? '');
      if (!letter || !/[A-Z0-9]/.test(letter)) {
        continue;
      }
      const confidence = Math.max(0, Math.min(1, (choice.confidence ?? 0) / 100));
      const previous = candidates.get(letter) ?? 0;
      if (confidence > previous) {
        candidates.set(letter, confidence);
      }
    }
  }

  let bestLetter: string | null = null;
  let bestConfidence = 0;
  for (const [letter, confidence] of candidates.entries()) {
    if (confidence > bestConfidence) {
      bestLetter = letter;
      bestConfidence = confidence;
    }
  }

  return {
    letter: bestLetter,
    confidence: bestConfidence,
    candidates,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mergeCandidateScores(
  target: Map<string, number>,
  source: Map<string, number>,
  weight: number,
): void {
  for (const [letter, confidence] of source.entries()) {
    const adjusted = clamp01(confidence * weight);
    const previous = target.get(letter) ?? 0;
    if (adjusted > previous) {
      target.set(letter, adjusted);
    }
  }
}

function pickBestCandidate(candidates: Map<string, number>): { letter: string | null; confidence: number } {
  let bestLetter: string | null = null;
  let bestConfidence = 0;
  for (const [letter, confidence] of candidates.entries()) {
    if (confidence > bestConfidence) {
      bestLetter = letter;
      bestConfidence = confidence;
    }
  }
  return { letter: bestLetter, confidence: bestConfidence };
}

function applyScoreHintToCandidates(
  candidates: Map<string, number>,
  scoreHint: number | null,
  scoreConfidence: number,
): Map<string, number> {
  if (scoreHint === null || Number.isNaN(scoreHint) || scoreHint < 0) {
    return candidates;
  }

  const lettersForScore = LETTERS_BY_SCORE.get(scoreHint) ?? [];
  if (lettersForScore.length === 0) {
    return candidates;
  }

  const adjusted = new Map<string, number>();
  let hasAnyMatch = false;

  for (const [letter, confidence] of candidates.entries()) {
    if (!/^[A-Z]$/.test(letter)) {
      continue;
    }

    if (LETTER_SCORES[letter] === scoreHint) {
      hasAnyMatch = true;
      const confidenceBoost = SCORE_HINT_WEIGHT + Math.max(0, scoreConfidence - 0.5) * 0.15;
      adjusted.set(letter, clamp01(confidence + confidenceBoost));
      continue;
    }

    const penalty = SCORE_HINT_MISMATCH_PENALTY + Math.max(0, scoreConfidence - 0.4) * 0.2;
    adjusted.set(letter, clamp01(confidence - penalty));
  }

  if (scoreConfidence >= STRONG_SCORE_HINT_CONFIDENCE) {
    if (hasAnyMatch) {
      return adjusted;
    }

    const syntheticConfidence = clamp01(0.32 + scoreConfidence * 0.35);
    const synthetic = new Map<string, number>();
    for (const letter of lettersForScore) {
      synthetic.set(letter, syntheticConfidence);
    }
    return synthetic;
  }

  if (hasAnyMatch) {
    return adjusted;
  }

  if (scoreConfidence >= MEDIUM_SCORE_HINT_CONFIDENCE) {
    const seeded = new Map(candidates);
    const seedConfidence = clamp01(0.2 + scoreConfidence * 0.28);
    for (const letter of lettersForScore) {
      const prev = seeded.get(letter) ?? 0;
      if (seedConfidence > prev) {
        seeded.set(letter, seedConfidence);
      }
    }
    return seeded;
  }

  return candidates;
}

function scaleImageData(imageData: ImageData, scale: number): ImageData {
  const targetWidth = Math.max(1, Math.round(imageData.width * scale));
  const targetHeight = Math.max(1, Math.round(imageData.height * scale));

  const sourceCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    return imageData;
  }
  sourceCtx.putImageData(imageData, 0, 0);

  const targetCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const targetCtx = targetCanvas.getContext('2d');
  if (!targetCtx) {
    return imageData;
  }
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  return targetCtx.getImageData(0, 0, targetWidth, targetHeight);
}

function boostContrast(imageData: ImageData, contrast = 1.45): ImageData {
  const copy = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  for (let i = 0; i < copy.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const value = copy.data[i + c];
      const adjusted = (value - 128) * contrast + 128;
      copy.data[i + c] = Math.max(0, Math.min(255, Math.round(adjusted)));
    }
  }
  return copy;
}

function disambiguateLetter(
  letter: string | null,
  confidence: number,
  candidates: Map<string, number>,
  metrics: ReturnType<typeof getLetterShapeMetrics>,
  ocrMinConfidence: number,
): { letter: string | null; confidence: number } {
  const candidateI = candidates.get('I') ?? (letter === 'I' ? confidence : 0);
  const candidateL = candidates.get('L') ?? (letter === 'L' ? confidence : 0);
  const candidateR = candidates.get('R') ?? (letter === 'R' ? confidence : 0);
  const candidateP = candidates.get('P') ?? (letter === 'P' ? confidence : 0);

  let resolvedLetter = letter;
  let resolvedConfidence = confidence;

  if (candidateI > 0 || candidateL > 0 || letter === 'I' || letter === 'L') {
    const lScore = candidateL + metrics.bottomBar * 0.45 + Math.max(0, metrics.centerStem - 0.05) * 0.08;
    const iScore = candidateI + metrics.centerStem * 0.24 - metrics.bottomBar * 0.18;

    if (lScore > iScore + 0.04) {
      resolvedLetter = 'L';
      resolvedConfidence = Math.max(resolvedConfidence, Math.min(1, lScore));
    } else if (iScore > lScore + 0.04) {
      resolvedLetter = 'I';
      resolvedConfidence = Math.max(resolvedConfidence, Math.min(1, iScore));
    }
  }

  if (candidateR > 0 || candidateP > 0 || letter === 'R' || letter === 'P') {
    const rScore = candidateR + metrics.lowerRightInk * 0.5 + metrics.upperRightInk * 0.12;
    const pScore = candidateP + metrics.upperRightInk * 0.22 - metrics.lowerRightInk * 0.2;
    if (rScore > pScore + 0.06) {
      resolvedLetter = 'R';
      resolvedConfidence = Math.max(resolvedConfidence, Math.min(1, rScore));
    }
  }

  if (resolvedLetter === 'R' && resolvedConfidence < 0.74 && metrics.lowerRightInk >= 0.1) {
    resolvedConfidence = Math.max(resolvedConfidence, 0.76);
  }

  if (resolvedConfidence < ocrMinConfidence) {
    return { letter: null, confidence: resolvedConfidence * 0.6 };
  }

  return {
    letter: resolvedLetter,
    confidence: resolvedConfidence,
  };
}

function isLikelyBoardTile(
  imageData: ImageData,
  row: number,
  col: number,
  tuning: ParserTuningProfile,
): boolean {
  const boosterCell = PREMIUM_BOARD[row]?.[col] !== null;
  const blueRatio = getBlueDominanceRatio(imageData, {
    insetRatio: 0.16,
    blueMin: 100,
    blueOverRed: 26,
    blueOverGreen: 10,
    brightnessMax: 450,
  });

  const blueMin = boosterCell ? tuning.boardBlueTileRatioMinOnBooster : tuning.boardBlueTileRatioMin;
  if (blueRatio < blueMin) {
    return false;
  }

  const whiteRatio = getWhiteInkRatio(imageData, {
    insetRatio: 0.2,
    whiteMin: 170,
    channelDeltaMax: 28,
  });

  const whiteInkMin = boosterCell ? tuning.boardWhiteInkRatioMin + 0.012 : tuning.boardWhiteInkRatioMin;
  return whiteRatio >= whiteInkMin;
}

function isLikelyRackTile(imageData: ImageData, tuning: ParserTuningProfile): boolean {
  const blueRatio = getBlueDominanceRatio(imageData, {
    insetRatio: 0.1,
    blueMin: 96,
    blueOverRed: 20,
    blueOverGreen: 8,
    brightnessMax: 560,
  });

  return blueRatio >= tuning.rackBlueTileRatioMin;
}

function getEqualRackRects(totalWidth: number, totalHeight: number): Array<{ x: number; y: number; width: number; height: number }> {
  const tileWidth = totalWidth / 7;
  return Array.from({ length: 7 }, (_, index) => ({
    x: Math.floor(index * tileWidth),
    y: 0,
    width: Math.ceil(tileWidth),
    height: totalHeight,
  }));
}

function detectRackTileRects(
  rackCanvas: OffscreenCanvas,
): Array<{ x: number; y: number; width: number; height: number }> {
  const ctx = rackCanvas.getContext('2d');
  if (!ctx) {
    return getEqualRackRects(rackCanvas.width, rackCanvas.height);
  }

  const imageData = ctx.getImageData(0, 0, rackCanvas.width, rackCanvas.height);
  const yStart = Math.floor(rackCanvas.height * 0.12);
  const yEnd = Math.max(yStart + 1, Math.floor(rackCanvas.height * 0.88));

  const rawScores = Array.from({ length: rackCanvas.width }, () => 0);

  for (let x = 0; x < rackCanvas.width; x += 1) {
    let bluePixels = 0;
    for (let y = yStart; y < yEnd; y += 1) {
      const idx = (y * rackCanvas.width + x) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const brightness = r + g + b;
      if (b >= 95 && b - r >= 18 && b - g >= 8 && brightness <= 560) {
        bluePixels += 1;
      }
    }
    rawScores[x] = bluePixels / (yEnd - yStart);
  }

  const smoothScores = rawScores.map((_, x) => {
    const start = Math.max(0, x - 4);
    const end = Math.min(rawScores.length - 1, x + 4);
    let sum = 0;
    for (let i = start; i <= end; i += 1) {
      sum += rawScores[i];
    }
    return sum / (end - start + 1);
  });

  const runs: Array<{ start: number; end: number }> = [];
  const threshold = 0.18;
  let runStart = -1;

  for (let x = 0; x < smoothScores.length; x += 1) {
    const active = smoothScores[x] >= threshold;
    if (active && runStart < 0) {
      runStart = x;
    }

    const runEnds = runStart >= 0 && (!active || x === smoothScores.length - 1);
    if (runEnds) {
      const end = active && x === smoothScores.length - 1 ? x : x - 1;
      if (end - runStart + 1 >= Math.floor(rackCanvas.width * 0.045)) {
        runs.push({ start: runStart, end });
      }
      runStart = -1;
    }
  }

  if (runs.length === 0) {
    return getEqualRackRects(rackCanvas.width, rackCanvas.height);
  }

  const merged: Array<{ start: number; end: number }> = [];
  const mergeGap = Math.max(2, Math.floor(rackCanvas.width * 0.01));

  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run.start - prev.end <= mergeGap) {
      prev.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }

  let selected = merged;
  if (selected.length > 7) {
    selected = selected
      .map((run) => ({ ...run, width: run.end - run.start + 1 }))
      .sort((a, b) => b.width - a.width)
      .slice(0, 7)
      .sort((a, b) => a.start - b.start)
      .map(({ start, end }) => ({ start, end }));
  }

  if (selected.length !== 7) {
    return getEqualRackRects(rackCanvas.width, rackCanvas.height);
  }

  const padX = Math.max(2, Math.floor(rackCanvas.width * 0.003));

  return selected.map((run) => {
    const x = Math.max(0, run.start - padX);
    const endX = Math.min(rackCanvas.width - 1, run.end + padX);
    return {
      x,
      y: 0,
      width: Math.max(1, endX - x + 1),
      height: rackCanvas.height,
    };
  });
}

async function recognizeLetterFromTile(
  imageData: ImageData,
  mode: PrototypeMode,
  centerCrop: { left: number; top: number; width: number; height: number },
  scoreHint: number | null,
  scoreConfidence: number,
  tuning: ParserTuningProfile,
): Promise<{
  letter: string | null;
  confidence: number;
  prototype: ReturnType<typeof classifyPrototypeLetter>;
  candidates: Map<string, number>;
}> {
  const focused = cropImageData(imageData, {
    x: imageData.width * centerCrop.left,
    y: imageData.height * centerCrop.top,
    width: imageData.width * centerCrop.width,
    height: imageData.height * centerCrop.height,
  });

  const focusedBoosted = boostContrast(focused, 1.55);
  const processed = await preprocessWithOpenCv(focused);
  const processedBoosted = await preprocessWithOpenCv(focusedBoosted);
  const processedUpscaled = scaleImageData(processed, 3);
  const boostedUpscaled = scaleImageData(processedBoosted, 3);
  const rawUpscaled = scaleImageData(focusedBoosted, 3);

  const variants = [
    { image: boostedUpscaled, weight: 1.18 },
    { image: processedUpscaled, weight: 1.1 },
    { image: processedBoosted, weight: 1.02 },
    { image: processed, weight: 0.98 },
    { image: rawUpscaled, weight: 0.86 },
    { image: focusedBoosted, weight: 0.75 },
  ];

  const worker = await getOcrWorker();
  const mergedCandidates = new Map<string, number>();

  for (const variant of variants) {
    const blob = await imageDataToBlob(variant.image);
    const result = await worker.recognize(blob);
    const choice = readTopChoice(result);
    mergeCandidateScores(mergedCandidates, choice.candidates, variant.weight);
  }

  const scoreAdjustedCandidates = applyScoreHintToCandidates(mergedCandidates, scoreHint, scoreConfidence);
  const prototype = classifyPrototypeLetter(imageData, mode, centerCrop);
  if (prototype?.letter && /[A-Z?]/.test(prototype.letter)) {
    const weightedConfidence = clamp01(
      prototype.confidence * (mode === 'rack' ? 0.96 : 0.9),
    );
    const existing = scoreAdjustedCandidates.get(prototype.letter) ?? 0;
    if (weightedConfidence > existing) {
      scoreAdjustedCandidates.set(prototype.letter, weightedConfidence);
    }
  }

  const best = pickBestCandidate(scoreAdjustedCandidates);
  const metrics = getLetterShapeMetrics(processedBoosted);
  const resolved = disambiguateLetter(
    best.letter,
    best.confidence,
    scoreAdjustedCandidates,
    metrics,
    tuning.ocrMinConfidence,
  );

  let finalLetter = resolved.letter;
  let finalConfidence = resolved.confidence;

  if (prototype?.letter && /^[A-Z]$/.test(prototype.letter)) {
    const conflictSensitive =
      finalLetter &&
      finalLetter !== prototype.letter &&
      ['I', 'L', 'R', 'P'].includes(finalLetter) &&
      ['I', 'L', 'R', 'P'].includes(prototype.letter) &&
      prototype.confidence >= finalConfidence + tuning.prototypeConflictDelta;

    const lowConfidenceOverride =
      (!finalLetter || finalConfidence < tuning.prototypeOverrideConfidence) &&
      prototype.confidence >= tuning.prototypeConfidenceFloor;

    if (conflictSensitive || lowConfidenceOverride) {
      finalLetter = prototype.letter;
      finalConfidence = Math.max(finalConfidence, prototype.confidence);
    }
  }

  if (!finalLetter || !/[A-Z]/.test(finalLetter)) {
    const unresolvedCandidates = new Map(scoreAdjustedCandidates);
    return {
      letter: null,
      confidence: finalConfidence * 0.45,
      prototype,
      candidates: unresolvedCandidates,
    };
  }

  const normalizedCandidates = new Map(scoreAdjustedCandidates);
  const finalUpper = finalLetter.toUpperCase();
  const previousFinal = normalizedCandidates.get(finalUpper) ?? 0;
  if (finalConfidence > previousFinal) {
    normalizedCandidates.set(finalUpper, finalConfidence);
  }

  return {
    letter: finalUpper,
    confidence: finalConfidence,
    prototype,
    candidates: normalizedCandidates,
  };
}

async function recognizeScoreDigit(
  imageData: ImageData,
  mode: 'board' | 'rack',
): Promise<{ digit: string | null; confidence: number }> {
  const regions =
    mode === 'board'
      ? [
          { left: 0.58, top: 0.0, width: 0.38, height: 0.36 },
          { left: 0.02, top: 0.0, width: 0.36, height: 0.36 },
        ]
      : [
          { left: 0.02, top: 0.0, width: 0.36, height: 0.36 },
          { left: 0.58, top: 0.0, width: 0.38, height: 0.36 },
        ];

  const worker = await getScoreWorker();
  let bestDigit: string | null = null;
  let bestConfidence = 0;

  for (const region of regions) {
    const scoreCrop = cropImageData(imageData, {
      x: imageData.width * region.left,
      y: imageData.height * region.top,
      width: imageData.width * region.width,
      height: imageData.height * region.height,
    });
    const scoreCropBoosted = boostContrast(scoreCrop, 1.65);
    const processed = await preprocessWithOpenCv(scoreCropBoosted);
    const upscaled = scaleImageData(processed, 3);

    for (const candidateImage of [upscaled, processed]) {
      const blob = await imageDataToBlob(candidateImage);
      const result = await worker.recognize(blob);
      const choice = readTopChoice(result);
      if (choice.letter && /[0-9]/.test(choice.letter) && choice.confidence > bestConfidence) {
        bestDigit = choice.letter;
        bestConfidence = choice.confidence;
      }
    }
  }

  if (!bestDigit) {
    return { digit: null, confidence: bestConfidence * 0.5 };
  }

  return {
    digit: bestDigit,
    confidence: bestConfidence,
  };
}

function collectBoardWords(board: Board): WordPlacement[] {
  const words: WordPlacement[] = [];
  const size = board.length;

  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!board[row][col].letter) {
        col += 1;
        continue;
      }
      if (col > 0 && board[row][col - 1].letter) {
        col += 1;
        continue;
      }

      const cells: Array<{ row: number; col: number }> = [];
      let text = '';
      let cursor = col;
      while (cursor < size && board[row][cursor].letter) {
        cells.push({ row, col: cursor });
        text += board[row][cursor].letter ?? '';
        cursor += 1;
      }

      if (text.length >= 2) {
        words.push({ direction: 'across', text, cells });
      }
      col = cursor;
    }
  }

  for (let col = 0; col < size; col += 1) {
    let row = 0;
    while (row < size) {
      if (!board[row][col].letter) {
        row += 1;
        continue;
      }
      if (row > 0 && board[row - 1][col].letter) {
        row += 1;
        continue;
      }

      const cells: Array<{ row: number; col: number }> = [];
      let text = '';
      let cursor = row;
      while (cursor < size && board[cursor][col].letter) {
        cells.push({ row: cursor, col });
        text += board[cursor][col].letter ?? '';
        cursor += 1;
      }

      if (text.length >= 2) {
        words.push({ direction: 'down', text, cells });
      }
      row = cursor;
    }
  }

  return words;
}

function isKnownBoardWord(word: string, lexicon: Set<string>): boolean {
  if (word.length < 2) {
    return true;
  }
  const correctionCount = CORRECTION_WORD_COUNTS.get(word) ?? 0;
  return lexicon.has(word) || correctionCount >= CORRECTION_WORD_VALID_MIN_COUNT;
}

function buildPerpendicularWord(
  board: Board,
  row: number,
  col: number,
  direction: 'across' | 'down',
  replacementLetter: string,
): string {
  const size = board.length;
  if (direction === 'across') {
    let start = row;
    while (start > 0 && board[start - 1][col].letter) {
      start -= 1;
    }

    let word = '';
    for (let cursor = start; cursor < size; cursor += 1) {
      const cellLetter = cursor === row ? replacementLetter : board[cursor][col].letter;
      if (!cellLetter) {
        break;
      }
      word += cellLetter;
    }
    return word;
  }

  let start = col;
  while (start > 0 && board[row][start - 1].letter) {
    start -= 1;
  }

  let word = '';
  for (let cursor = start; cursor < size; cursor += 1) {
    const cellLetter = cursor === col ? replacementLetter : board[row][cursor].letter;
    if (!cellLetter) {
      break;
    }
    word += cellLetter;
  }
  return word;
}

type LetterOption = {
  letter: string;
  confidence: number;
};

function getLetterOptions(
  currentLetter: string,
  currentConfidence: number,
  candidates: Map<string, number>,
): LetterOption[] {
  const normalized = new Map<string, number>();
  normalized.set(currentLetter, Math.max(currentConfidence, candidates.get(currentLetter) ?? 0));

  for (const [letter, confidence] of candidates.entries()) {
    if (!/^[A-Z]$/.test(letter)) {
      continue;
    }
    const previous = normalized.get(letter) ?? 0;
    if (confidence > previous) {
      normalized.set(letter, confidence);
    }
  }

  const sorted = Array.from(normalized.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([letter, confidence]) => ({ letter, confidence }));

  const topConfidence = sorted[0]?.confidence ?? currentConfidence;
  const floor = Math.max(0.2, topConfidence - 0.22);
  let filtered = sorted.filter((option, index) => index === 0 || option.confidence >= floor);

  if (currentConfidence >= 0.93) {
    filtered = filtered.filter((option) => option.letter === currentLetter);
  }

  if (currentConfidence >= 0.86 && filtered.length > 2) {
    filtered = filtered.slice(0, 2);
  } else if (filtered.length > MAX_CANDIDATES_PER_CELL) {
    filtered = filtered.slice(0, MAX_CANDIDATES_PER_CELL);
  }

  return filtered;
}

function trimOptionBundles(
  optionBundles: LetterOption[][],
  word: WordPlacement,
  confidenceGrid: ConfidenceGrid,
): LetterOption[][] {
  const cloned = optionBundles.map((options) => options.slice());
  const reducers = word.cells
    .map(({ row, col }, index) => ({
      index,
      certainty: confidenceGrid[row][col],
    }))
    .sort((a, b) => b.certainty - a.certainty);

  let combinations = cloned.reduce((product, options) => product * Math.max(1, options.length), 1);
  while (combinations > MAX_WORD_SEARCH_COMBINATIONS) {
    let changed = false;
    for (const reducer of reducers) {
      const options = cloned[reducer.index];
      if (options.length > 1) {
        options.pop();
        combinations = cloned.reduce((product, next) => product * Math.max(1, next.length), 1);
        changed = true;
        if (combinations <= MAX_WORD_SEARCH_COMBINATIONS) {
          break;
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  return cloned;
}

type ReplacementCandidate = {
  letters: string[];
  confidences: number[];
};

function findBestWordReplacement(
  board: Board,
  word: WordPlacement,
  candidateGrid: CandidateGrid,
  confidenceGrid: ConfidenceGrid,
  lexicon: Set<string>,
): ReplacementCandidate | null {
  const originalLetters = word.text.split('');
  const optionBundles = word.cells.map(({ row, col }, index) =>
    getLetterOptions(originalLetters[index], confidenceGrid[row][col], candidateGrid[row][col]),
  );

  const mutableCells = optionBundles.filter((options) => options.length > 1).length;
  if (mutableCells === 0) {
    return null;
  }

  const trimmedBundles = trimOptionBundles(optionBundles, word, confidenceGrid);
  const currentLetters = Array.from({ length: word.cells.length }, () => '');
  const currentConfidences = Array.from({ length: word.cells.length }, () => 0);

  let best: ReplacementCandidate | null = null;
  let bestScore = -Infinity;

  function dfs(index: number, runningScore: number): void {
    if (index === trimmedBundles.length) {
      const candidateWord = currentLetters.join('');
      if (candidateWord === word.text || !isKnownBoardWord(candidateWord, lexicon)) {
        return;
      }

      for (let i = 0; i < word.cells.length; i += 1) {
        if (currentLetters[i] === originalLetters[i]) {
          continue;
        }
        const { row, col } = word.cells[i];
        const perpendicular = buildPerpendicularWord(board, row, col, word.direction, currentLetters[i]);
        if (perpendicular.length > 1 && !isKnownBoardWord(perpendicular, lexicon)) {
          return;
        }
      }

      const changePenalty = currentLetters.reduce(
        (total, letter, i) => total + (letter === originalLetters[i] ? 0 : 0.04),
        0,
      );
      const correctionWordCount = CORRECTION_WORD_COUNTS.get(candidateWord) ?? 0;
      const correctionWordBonus = Math.min(
        0.2,
        Math.log2(correctionWordCount + 1) * CORRECTION_WORD_BONUS_WEIGHT,
      );
      const score = runningScore - changePenalty + correctionWordBonus;

      if (score > bestScore) {
        bestScore = score;
        best = {
          letters: currentLetters.slice(),
          confidences: currentConfidences.slice(),
        };
      }
      return;
    }

    for (const option of trimmedBundles[index]) {
      currentLetters[index] = option.letter;
      currentConfidences[index] = option.confidence;
      dfs(index + 1, runningScore + option.confidence);
    }
  }

  dfs(0, 0);
  return best;
}

async function refineBoardWithLexicon(
  board: Board,
  candidateGrid: CandidateGrid,
  confidenceGrid: ConfidenceGrid,
): Promise<void> {
  const lexicon = await loadParserLexicon();
  if (lexicon.size === 0) {
    return;
  }

  for (let pass = 0; pass < MAX_WORD_REFINEMENT_PASSES; pass += 1) {
    const invalidWords = collectBoardWords(board)
      .filter((word) => !isKnownBoardWord(word.text, lexicon))
      .sort((a, b) => b.cells.length - a.cells.length);

    if (invalidWords.length === 0) {
      return;
    }

    let changed = false;
    for (const word of invalidWords) {
      const currentText = word.cells.map(({ row, col }) => board[row][col].letter ?? '').join('');
      if (currentText.length < 2 || isKnownBoardWord(currentText, lexicon)) {
        continue;
      }

      const refreshedWord: WordPlacement = {
        ...word,
        text: currentText,
      };

      const replacement = findBestWordReplacement(
        board,
        refreshedWord,
        candidateGrid,
        confidenceGrid,
        lexicon,
      );
      if (!replacement) {
        continue;
      }

      for (let i = 0; i < refreshedWord.cells.length; i += 1) {
        const nextLetter = replacement.letters[i];
        const nextConfidence = replacement.confidences[i];
        const { row, col } = refreshedWord.cells[i];

        if (board[row][col].letter !== nextLetter) {
          board[row][col] = {
            ...board[row][col],
            letter: nextLetter,
          };
          changed = true;
        }

        const prevCandidate = candidateGrid[row][col].get(nextLetter) ?? 0;
        if (nextConfidence > prevCandidate) {
          candidateGrid[row][col].set(nextLetter, nextConfidence);
        }
        confidenceGrid[row][col] = Math.max(confidenceGrid[row][col], nextConfidence * 0.96);
      }
    }

    if (!changed) {
      return;
    }
  }
}

async function parseBoard(
  boardCanvas: OffscreenCanvas,
  thresholds: ProfileThresholds,
  tuning: ParserTuningProfile,
): Promise<{ board: ParsedState['board']; lowConfidenceCells: ParsedState['lowConfidenceCells']; confidence: number }> {
  const ctx = boardCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to read board pixels');
  }

  const board = createEmptyBoard();
  const candidateGrid: CandidateGrid = Array.from({ length: 15 }, () =>
    Array.from({ length: 15 }, () => new Map<string, number>()),
  );
  const confidenceGrid: ConfidenceGrid = Array.from({ length: 15 }, () =>
    Array.from({ length: 15 }, () => 1),
  );
  const tileDetectedGrid: BooleanGrid = Array.from({ length: 15 }, () =>
    Array.from({ length: 15 }, () => false),
  );

  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const rect = cellRect(boardCanvas.width, boardCanvas.height, row, col, 15, 15);
      const cellImageData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);

      if (!isLikelyBoardTile(cellImageData, row, col, tuning)) {
        board[row][col] = { letter: null, isBlank: false };
        confidenceGrid[row][col] = 1;
        continue;
      }

      tileDetectedGrid[row][col] = true;
      const score = await recognizeScoreDigit(cellImageData, 'board');
      const scoreHint = score.digit && score.digit !== '0' && score.confidence >= 0.33
        ? Number(score.digit)
        : null;
      const blankFromScore =
        score.digit === '0' && score.confidence >= BOARD_BLANK_FROM_SCORE_MIN_CONFIDENCE;

      const recognition = await recognizeLetterFromTile(
        cellImageData,
        'board',
        {
          left: 0.16,
          top: 0.14,
          width: 0.68,
          height: 0.74,
        },
        scoreHint,
        score.confidence,
        tuning,
      );

      const premiumCell = PREMIUM_BOARD[row][col] !== null;
      const hasStrongScoreSignal = Boolean(score.digit && score.confidence >= 0.3);
      const likelyBoosterFalsePositive =
        premiumCell &&
        !blankFromScore &&
        !hasStrongScoreSignal &&
        recognition.confidence < 0.7;

      if (likelyBoosterFalsePositive) {
        board[row][col] = { letter: null, isBlank: false };
        tileDetectedGrid[row][col] = false;
        confidenceGrid[row][col] = 0.95;
        candidateGrid[row][col].clear();
        continue;
      }

      let combinedConfidence = recognition.confidence;
      if (blankFromScore) {
        combinedConfidence = Math.max(combinedConfidence, score.confidence);
      } else if (
        scoreHint !== null &&
        recognition.letter &&
        LETTER_SCORES[recognition.letter] === scoreHint
      ) {
        combinedConfidence = clamp01((combinedConfidence + score.confidence) / 2 + 0.08);
      } else if (
        scoreHint !== null &&
        recognition.letter &&
        score.confidence >= MEDIUM_SCORE_HINT_CONFIDENCE &&
        LETTER_SCORES[recognition.letter] !== scoreHint
      ) {
        combinedConfidence = clamp01(combinedConfidence - 0.24);
      }

      board[row][col] = {
        letter: recognition.letter,
        isBlank: blankFromScore,
      };

      const normalizedConfidence = clamp01(combinedConfidence);
      confidenceGrid[row][col] = normalizedConfidence;
      candidateGrid[row][col] = new Map(recognition.candidates);
      if (recognition.letter) {
        const previous = candidateGrid[row][col].get(recognition.letter) ?? 0;
        if (normalizedConfidence > previous) {
          candidateGrid[row][col].set(recognition.letter, normalizedConfidence);
        }
      }
    }
  }

  await refineBoardWithLexicon(board, candidateGrid, confidenceGrid);

  const lowConfidenceCells: ParsedState['lowConfidenceCells'] = [];
  let confidenceSum = 0;
  let confidenceCount = 0;
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const cellConfidence = confidenceGrid[row][col];
      confidenceSum += cellConfidence;
      confidenceCount += 1;

      if (tileDetectedGrid[row][col] && cellConfidence < thresholds.lowConfidence) {
        lowConfidenceCells.push({ row, col, confidence: cellConfidence });
      }
    }
  }

  return {
    board,
    lowConfidenceCells,
    confidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
  };
}

async function parseRack(
  rackCanvas: OffscreenCanvas,
  tuning: ParserTuningProfile,
): Promise<{ rack: RackTile[]; confidence: number }> {
  const ctx = rackCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to read rack pixels');
  }

  const rack: RackTile[] = [];
  let confidenceSum = 0;
  let confidenceCount = 0;

  const rects = detectRackTileRects(rackCanvas);

  for (const rect of rects) {
    const tileData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);

    if (!isLikelyRackTile(tileData, tuning)) {
      rack.push({
        letter: '',
        isBlank: false,
      });
      confidenceSum += 0.4;
      confidenceCount += 1;
      continue;
    }

    const score = await recognizeScoreDigit(tileData, 'rack');
    const scoreHint = score.digit && score.digit !== '0' && score.confidence >= 0.33
      ? Number(score.digit)
      : null;

    const recognition = await recognizeLetterFromTile(
      tileData,
      'rack',
      {
        left: 0.13,
        top: 0.2,
        width: 0.74,
        height: 0.66,
      },
      scoreHint,
      score.confidence,
      tuning,
    );

    const whiteRatio = getWhiteInkRatio(tileData, {
      insetRatio: 0.2,
      whiteMin: 180,
      channelDeltaMax: 30,
    });

    const blankFromScore = score.digit === '0' && score.confidence >= RACK_BLANK_FROM_SCORE_MIN_CONFIDENCE;
    const blankFromPrototype = recognition.prototype?.letter === '?' &&
      recognition.prototype.confidence >= tuning.prototypeConfidenceFloor;
    const blankFromLetterAbsence =
      !recognition.letter &&
      (whiteRatio < tuning.rackWhiteInkRatioMin || blankFromPrototype);

    if (blankFromScore || blankFromLetterAbsence) {
      rack.push({
        letter: '',
        isBlank: true,
      });
      confidenceSum += Math.max(
        recognition.confidence * 0.7,
        score.confidence,
        blankFromPrototype ? recognition.prototype?.confidence ?? 0 : 0,
      );
      confidenceCount += 1;
      continue;
    }

    if (recognition.letter) {
      const scoreMatchBoost =
        scoreHint !== null && LETTER_SCORES[recognition.letter] === scoreHint
          ? 0.08
          : 0;
      rack.push({
        letter: recognition.letter.toUpperCase(),
        isBlank: false,
      });
      confidenceSum += clamp01(recognition.confidence + scoreMatchBoost);
      confidenceCount += 1;
      continue;
    }

    rack.push({
      letter: '',
      isBlank: whiteRatio < tuning.rackWhiteInkRatioMin,
    });

    confidenceSum += recognition.confidence * 0.8;
    confidenceCount += 1;
  }

  return {
    rack,
    confidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
  };
}

function cropRegions(canvas: OffscreenCanvas, profile: LayoutProfile): {
  boardCanvas: OffscreenCanvas;
  rackCanvas: OffscreenCanvas;
} {
  return {
    boardCanvas: cropCanvas(canvas, profile.boardRect),
    rackCanvas: cropCanvas(canvas, profile.rackRect),
  };
}

export async function parseScreenshot(file: File, hint?: ProfileType, openaiApiKey?: string): Promise<ParsedState> {
  const canvas = await canvasFromFile(file);
  const profileType = detectProfile(canvas.width, canvas.height, hint);
  const profile = LAYOUT_PROFILES[profileType];

  // Try OpenAI Vision API first if an API key is available
  const apiKey = resolveOpenAiApiKey(openaiApiKey);
  if (apiKey) {
    try {
      const visionResult = await parseWithVisionApi(canvas, apiKey, profile);
      return {
        profile: profileType,
        board: visionResult.board,
        rack: visionResult.rack,
        confidence: 0.95,
        lowConfidenceCells: [],
      };
    } catch (error) {
      console.warn(
        'Vision API failed, falling back to Tesseract:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Fallback: existing Tesseract OCR pipeline
  const thresholds = profileThresholds[profileType] as ProfileThresholds;
  const tuning = getParserTuning(profileType);

  const { boardCanvas, rackCanvas } = cropRegions(canvas, profile);
  const boardResult = await parseBoard(boardCanvas, thresholds, tuning);
  const rackResult = await parseRack(rackCanvas, tuning);

  const confidence = Number(((boardResult.confidence + rackResult.confidence) / 2).toFixed(3));

  return {
    profile: profileType,
    board: boardResult.board,
    rack: rackResult.rack,
    confidence,
    lowConfidenceCells: boardResult.lowConfidenceCells,
  };
}
