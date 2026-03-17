import { afterEach, describe, expect, it, vi } from 'vitest';

type EnvSnapshot = Partial<Record<string, string | boolean | undefined>>;

const ENV_KEYS = [
  'VITE_EXTERNAL_OCR_PROVIDER',
  'VITE_OPENAI_API_KEY',
  'VITE_REQUIRE_EXTERNAL_OCR',
  'VITE_EXTERNAL_OCR_ENDPOINT',
  'VITE_EXTERNAL_OCR_MODEL',
] as const;

function readEnvSnapshot(): EnvSnapshot {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  return ENV_KEYS.reduce<EnvSnapshot>((acc, key) => {
    acc[key] = env[key];
    return acc;
  }, {});
}

function writeEnvSnapshot(snapshot: EnvSnapshot): void {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete env[key];
      continue;
    }
    env[key] = snapshot[key];
  }
}

describe('externalTileOcr readiness', () => {
  const originalEnv = readEnvSnapshot();

  async function loadModule() {
    vi.resetModules();
    return import('../../parser/externalTileOcr');
  }

  afterEach(() => {
    writeEnvSnapshot(originalEnv);
  });

  it('reports unavailable when provider is not set', async () => {
    writeEnvSnapshot({
      ...originalEnv,
      VITE_EXTERNAL_OCR_PROVIDER: undefined,
      VITE_OPENAI_API_KEY: undefined,
      VITE_REQUIRE_EXTERNAL_OCR: undefined,
    });

    const { getExternalTileOcrStatus } = await loadModule();
    expect(getExternalTileOcrStatus()).toEqual({
      required: false,
      enabled: false,
      provider: null,
      reason: 'VITE_EXTERNAL_OCR_PROVIDER is not set',
    });
  });

  it('reports unavailable when openai key is missing', async () => {
    writeEnvSnapshot({
      ...originalEnv,
      VITE_EXTERNAL_OCR_PROVIDER: 'openai',
      VITE_OPENAI_API_KEY: undefined,
      VITE_REQUIRE_EXTERNAL_OCR: undefined,
    });

    const { getExternalTileOcrStatus } = await loadModule();
    expect(getExternalTileOcrStatus()).toEqual({
      required: false,
      enabled: false,
      provider: 'openai',
      reason: 'VITE_OPENAI_API_KEY is missing',
    });
  });

  it('reports enabled for configured openai provider', async () => {
    writeEnvSnapshot({
      ...originalEnv,
      VITE_EXTERNAL_OCR_PROVIDER: 'openai',
      VITE_OPENAI_API_KEY: 'test-key',
      VITE_REQUIRE_EXTERNAL_OCR: undefined,
    });

    const { getExternalTileOcrStatus } = await loadModule();
    expect(getExternalTileOcrStatus()).toEqual({
      required: false,
      enabled: true,
      provider: 'openai',
      reason: null,
    });
  });

  it('reports enabled for configured ollama provider without api key', async () => {
    writeEnvSnapshot({
      ...originalEnv,
      VITE_EXTERNAL_OCR_PROVIDER: 'ollama',
      VITE_OPENAI_API_KEY: undefined,
      VITE_REQUIRE_EXTERNAL_OCR: undefined,
    });

    const { getExternalTileOcrStatus } = await loadModule();
    expect(getExternalTileOcrStatus()).toEqual({
      required: false,
      enabled: true,
      provider: 'ollama',
      reason: null,
    });
  });

  it('throws when strict mode is enabled but external OCR is unavailable', async () => {
    writeEnvSnapshot({
      ...originalEnv,
      VITE_EXTERNAL_OCR_PROVIDER: undefined,
      VITE_OPENAI_API_KEY: undefined,
      VITE_REQUIRE_EXTERNAL_OCR: 'true',
    });

    const { assertExternalTileOcrReadiness } = await loadModule();
    expect(() => assertExternalTileOcrReadiness()).toThrow(
      'External OCR is required but unavailable: VITE_EXTERNAL_OCR_PROVIDER is not set.',
    );
  });

  it('does not throw in strict mode when external OCR is configured', async () => {
    writeEnvSnapshot({
      ...originalEnv,
      VITE_EXTERNAL_OCR_PROVIDER: 'openai',
      VITE_OPENAI_API_KEY: 'test-key',
      VITE_REQUIRE_EXTERNAL_OCR: 'true',
    });

    const { assertExternalTileOcrReadiness } = await loadModule();
    expect(() => assertExternalTileOcrReadiness()).not.toThrow();
  });

  it('does not throw in strict mode when ollama provider is configured', async () => {
    writeEnvSnapshot({
      ...originalEnv,
      VITE_EXTERNAL_OCR_PROVIDER: 'ollama',
      VITE_OPENAI_API_KEY: undefined,
      VITE_REQUIRE_EXTERNAL_OCR: 'true',
    });

    const { assertExternalTileOcrReadiness } = await loadModule();
    expect(() => assertExternalTileOcrReadiness()).not.toThrow();
  });
});
