import { normalizeLetter } from '../lib/boardUtils';
import { imageDataToBlob } from './imageUtils';

export type ExternalTileInput = {
  id: string;
  imageData: ImageData;
};

export type ExternalTileResult = {
  id: string;
  hasTile: boolean;
  letter: string | null;
  isBlank: boolean;
  confidence: number;
};

type ExternalOcrMode = 'board' | 'rack';
type ExternalOcrProvider = 'openai' | 'ollama';

type ExternalOcrConfig = {
  provider: ExternalOcrProvider;
  endpoint: string;
  model: string;
  apiKey: string | null;
  batchSize: number;
  maxConcurrentBatches: number;
  timeoutMs: number;
};

export type ExternalTileOcrStatus = {
  required: boolean;
  enabled: boolean;
  provider: string | null;
  reason: string | null;
};

const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/api/chat';
const DEFAULT_OLLAMA_MODEL = 'llava:7b';
const DEFAULT_EXTERNAL_BATCH_SIZE = 16;
const DEFAULT_EXTERNAL_MAX_CONCURRENT_BATCHES = 2;
const DEFAULT_EXTERNAL_TIMEOUT_MS = 25_000;

const TILE_OCR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tiles'],
  properties: {
    tiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'has_tile', 'letter', 'is_blank', 'confidence'],
        properties: {
          id: {
            type: 'string',
          },
          has_tile: {
            type: 'boolean',
          },
          letter: {
            type: ['string', 'null'],
          },
          is_blank: {
            type: 'boolean',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
        },
      },
    },
  },
} as const;

let warningLogged = false;
let readinessWarningLogged = false;

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

function readEnvString(name: string): string | null {
  const value = import.meta.env[name];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEnvNumber(name: string, fallback: number): number {
  const value = readEnvString(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvBool(name: string): boolean {
  const value = readEnvString(name);
  if (!value) {
    return false;
  }
  return TRUTHY_VALUES.has(value.toLowerCase());
}

export function getExternalTileOcrStatus(): ExternalTileOcrStatus {
  const providerRaw = readEnvString('VITE_EXTERNAL_OCR_PROVIDER');
  const provider = providerRaw ? providerRaw.toLowerCase() : null;
  const required = readEnvBool('VITE_REQUIRE_EXTERNAL_OCR');

  if (!provider) {
    return {
      required,
      enabled: false,
      provider: null,
      reason: 'VITE_EXTERNAL_OCR_PROVIDER is not set',
    };
  }

  if (provider !== 'openai' && provider !== 'ollama') {
    return {
      required,
      enabled: false,
      provider,
      reason: `Unsupported external OCR provider: ${provider}`,
    };
  }

  if (provider === 'openai') {
    const apiKey = readEnvString('VITE_OPENAI_API_KEY');
    if (!apiKey) {
      return {
        required,
        enabled: false,
        provider,
        reason: 'VITE_OPENAI_API_KEY is missing',
      };
    }
  }

  return {
    required,
    enabled: true,
    provider,
    reason: null,
  };
}

function setupHintForProvider(provider: string | null): string {
  if (provider === 'openai') {
    return 'Set VITE_EXTERNAL_OCR_PROVIDER=openai and VITE_OPENAI_API_KEY in .env.local.';
  }

  if (provider === 'ollama') {
    return 'Set VITE_EXTERNAL_OCR_PROVIDER=ollama and ensure Ollama is running at VITE_EXTERNAL_OCR_ENDPOINT.';
  }

  return 'Set VITE_EXTERNAL_OCR_PROVIDER=ollama (local) or openai (API) in .env.local.';
}

export function assertExternalTileOcrReadiness(): void {
  const status = getExternalTileOcrStatus();
  if (status.required && !status.enabled) {
    throw new Error(
      `External OCR is required but unavailable: ${status.reason}. ` +
      setupHintForProvider(status.provider),
    );
  }

  if (!status.enabled && status.provider && !readinessWarningLogged) {
    readinessWarningLogged = true;
    console.warn(`External OCR requested (${status.provider}) but unavailable: ${status.reason}. Using local OCR fallback.`);
  }
}

function resolveConfig(): ExternalOcrConfig | null {
  const status = getExternalTileOcrStatus();
  if (!status.enabled || !status.provider) {
    return null;
  }

  if (status.provider === 'openai') {
    const apiKey = readEnvString('VITE_OPENAI_API_KEY');
    if (!apiKey) {
      return null;
    }

    return {
      provider: 'openai',
      endpoint: readEnvString('VITE_EXTERNAL_OCR_ENDPOINT') ?? DEFAULT_OPENAI_ENDPOINT,
      model: readEnvString('VITE_EXTERNAL_OCR_MODEL') ?? DEFAULT_OPENAI_MODEL,
      apiKey,
      batchSize: Math.max(1, Math.floor(readEnvNumber('VITE_EXTERNAL_OCR_BATCH_SIZE', DEFAULT_EXTERNAL_BATCH_SIZE))),
      maxConcurrentBatches: Math.max(
        1,
        Math.floor(readEnvNumber('VITE_EXTERNAL_OCR_MAX_CONCURRENT_BATCHES', DEFAULT_EXTERNAL_MAX_CONCURRENT_BATCHES)),
      ),
      timeoutMs: Math.max(2_000, Math.floor(readEnvNumber('VITE_EXTERNAL_OCR_TIMEOUT_MS', DEFAULT_EXTERNAL_TIMEOUT_MS))),
    };
  }

  return {
    provider: 'ollama',
    endpoint: readEnvString('VITE_EXTERNAL_OCR_ENDPOINT') ?? DEFAULT_OLLAMA_ENDPOINT,
    model: readEnvString('VITE_EXTERNAL_OCR_MODEL') ?? DEFAULT_OLLAMA_MODEL,
    apiKey: null,
    batchSize: Math.max(1, Math.floor(readEnvNumber('VITE_EXTERNAL_OCR_BATCH_SIZE', DEFAULT_EXTERNAL_BATCH_SIZE))),
    maxConcurrentBatches: Math.max(
      1,
      Math.floor(readEnvNumber('VITE_EXTERNAL_OCR_MAX_CONCURRENT_BATCHES', DEFAULT_EXTERNAL_MAX_CONCURRENT_BATCHES)),
    ),
    timeoutMs: Math.max(2_000, Math.floor(readEnvNumber('VITE_EXTERNAL_OCR_TIMEOUT_MS', DEFAULT_EXTERNAL_TIMEOUT_MS))),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function imageDataToBase64(imageData: ImageData): Promise<string> {
  const blob = await imageDataToBlob(imageData);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return toBase64(bytes);
}

async function imageDataToDataUrl(imageData: ImageData): Promise<string> {
  const base64 = await imageDataToBase64(imageData);
  return `data:image/png;base64,${base64}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeExternalLetter(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = normalizeLetter(value);
  return /^[A-Z]$/.test(normalized) ? normalized : null;
}

function parseResponseText(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }

  const directMessage = payload.message;
  if (isObject(directMessage) && typeof directMessage.content === 'string' && directMessage.content.trim().length > 0) {
    return directMessage.content;
  }

  if (typeof payload.response === 'string' && payload.response.trim().length > 0) {
    return payload.response;
  }

  if (typeof payload.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0];
  if (!isObject(first)) {
    return null;
  }

  const message = first.message;
  if (!isObject(message)) {
    return null;
  }

  const content = message.content;
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const entry of content) {
    if (!isObject(entry)) {
      continue;
    }
    if (entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim().length > 0) {
      return entry.text;
    }
  }

  return null;
}

function parseTileArray(jsonText: string): ExternalTileResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(jsonText.slice(start, end + 1));
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  if (!isObject(parsed) || !Array.isArray(parsed.tiles)) {
    return [];
  }

  const normalized: ExternalTileResult[] = [];

  for (const rawTile of parsed.tiles) {
    if (!isObject(rawTile)) {
      continue;
    }

    const id = typeof rawTile.id === 'string'
      ? rawTile.id
      : (typeof rawTile.tile_id === 'string' ? rawTile.tile_id : '');
    if (!id) {
      continue;
    }

    const hasTileValue = rawTile.has_tile ?? rawTile.hasTile;
    const isBlankValue = rawTile.is_blank ?? rawTile.isBlank;
    const confidenceValue = typeof rawTile.confidence === 'number'
      ? rawTile.confidence
      : Number(rawTile.confidence);
    const letterValue = rawTile.letter ?? rawTile.tile;

    const hasTile = Boolean(hasTileValue);
    const isBlank = hasTile && Boolean(isBlankValue);
    const confidence = clamp01(Number.isFinite(confidenceValue) ? confidenceValue : 0);
    const rawLetter = normalizeExternalLetter(letterValue);
    const letter = hasTile && !isBlank ? rawLetter : null;

    normalized.push({
      id,
      hasTile,
      letter,
      isBlank,
      confidence,
    });
  }

  return normalized;
}

function getPromptForMode(mode: ExternalOcrMode): string {
  if (mode === 'rack') {
    return [
      'Each image is one Crossplay rack slot.',
      'Return one entry per tile id.',
      'Set has_tile=true when a rack tile exists in that slot.',
      'If the tile is blank with no readable letter, set is_blank=true and letter=null.',
      'Otherwise set letter to a single uppercase A-Z.',
    ].join(' ');
  }

  return [
    'Each image is one fixed Crossplay board cell.',
    'Return one entry per tile id.',
    'Set has_tile=true only when a placed tile exists in the cell.',
    'For blank tiles with no readable letter, set is_blank=true and letter=null.',
    'Otherwise set letter to a single uppercase A-Z.',
  ].join(' ');
}

async function requestBatch(
  batch: ExternalTileInput[],
  mode: ExternalOcrMode,
  config: ExternalOcrConfig,
): Promise<ExternalTileResult[]> {
  if (config.provider === 'ollama') {
    const images = await Promise.all(batch.map(async (tile) => imageDataToBase64(tile.imageData)));
    const orderedTileIds = batch.map((tile, index) => `${index + 1}. ${tile.id}`).join('\n');
    const prompt = [
      'Read each tile image independently and output valid JSON only.',
      getPromptForMode(mode),
      'Return exactly this object shape: {"tiles":[{"id":"...", "has_tile":true|false, "letter":"A"|null, "is_blank":true|false, "confidence":0.0}]}',
      'Map image order to tile ids in this exact order:',
      orderedTileIds,
      'Do not include markdown or explanation.',
    ].join('\n');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          format: 'json',
          options: {
            temperature: 0,
          },
          messages: [
            {
              role: 'system',
              content:
                'You are a strict OCR parser for Scrabble-like tile screenshots. Return JSON only with no extra text.',
            },
            {
              role: 'user',
              content: prompt,
              images,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let responseText = '';
        try {
          responseText = (await response.text()).trim();
        } catch {
          responseText = '';
        }
        throw new Error(
          `Ollama request failed (${response.status}): ${(responseText || response.statusText || 'empty response').slice(0, 220)}`,
        );
      }

      const payload = (await response.json()) as unknown;
      const jsonText = parseResponseText(payload);
      if (!jsonText) {
        throw new Error('Ollama response did not contain OCR JSON content.');
      }

      const parsed = parseTileArray(jsonText);
      if (parsed.length === 0) {
        throw new Error('Ollama OCR JSON could not be parsed into tile results.');
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  if (!config.apiKey) {
    return [];
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: [
        'Read each tile image independently and output valid JSON.',
        getPromptForMode(mode),
        'Confidence must be a number from 0 to 1.',
      ].join(' '),
    },
  ];

  for (const tile of batch) {
    const dataUrl = await imageDataToDataUrl(tile.imageData);
    content.push({
      type: 'text',
      text: `tile_id=${tile.id}`,
    });
    content.push({
      type: 'image_url',
      image_url: {
        url: dataUrl,
        detail: 'low',
      },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict OCR parser for Scrabble-like tile screenshots. Return JSON only with no extra text.',
          },
          {
            role: 'user',
            content,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'tile_ocr_batch',
            strict: true,
            schema: TILE_OCR_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let responseText = '';
      try {
        responseText = (await response.text()).trim();
      } catch {
        responseText = '';
      }
      throw new Error(
        `OpenAI request failed (${response.status}): ${(responseText || response.statusText || 'empty response').slice(0, 220)}`,
      );
    }

    const payload = (await response.json()) as unknown;
    const jsonText = parseResponseText(payload);
    if (!jsonText) {
      throw new Error('OpenAI response did not contain OCR JSON content.');
    }

    const parsed = parseTileArray(jsonText);
    if (parsed.length === 0) {
      throw new Error('OpenAI OCR JSON could not be parsed into tile results.');
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function shouldLogWarning(): boolean {
  if (warningLogged) {
    return false;
  }
  warningLogged = true;
  return true;
}

export function hasExternalTileOcr(): boolean {
  return getExternalTileOcrStatus().enabled;
}

export async function recognizeTilesWithExternalOcr(
  tiles: ExternalTileInput[],
  mode: ExternalOcrMode,
): Promise<Map<string, ExternalTileResult>> {
  const config = resolveConfig();
  if (!config || tiles.length === 0) {
    return new Map();
  }

  const batchErrors: string[] = [];
  const map = new Map<string, ExternalTileResult>();
  const batches = chunkArray(tiles, config.batchSize);

  for (let i = 0; i < batches.length; i += config.maxConcurrentBatches) {
    const window = batches.slice(i, i + config.maxConcurrentBatches);
    const windowResults = await Promise.all(
      window.map(async (batch) => {
        try {
          return await requestBatch(batch, mode, config);
        } catch (error) {
          batchErrors.push(error instanceof Error ? error.message : 'Unknown external OCR batch failure.');
          return [];
        }
      }),
    );

    for (const batchResults of windowResults) {
      for (const result of batchResults) {
        map.set(result.id, result);
      }
    }
  }

  const status = getExternalTileOcrStatus();
  if (status.required) {
    const missing = tiles.filter((tile) => !map.has(tile.id));
    if (missing.length > 0) {
      const errorDetail = batchErrors[0] ? ` Detail: ${batchErrors[0]}` : '';
      throw new Error(
        `External OCR is required but returned ${map.size}/${tiles.length} tile results from ${config.provider}.${errorDetail}`,
      );
    }
  }

  if (map.size === 0 && shouldLogWarning()) {
    const detail = batchErrors[0] ? ` Detail: ${batchErrors[0]}` : '';
    console.warn(`External OCR is configured but returned no tile results. Falling back to local OCR.${detail}`);
  }

  return map;
}
