import { afterEach, describe, expect, it } from 'vitest';

type EnvSnapshot = Partial<Record<'VITE_OPENAI_API_KEY', string | undefined>>;

function readEnvSnapshot(): EnvSnapshot {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    VITE_OPENAI_API_KEY: env.VITE_OPENAI_API_KEY,
  };
}

function writeEnvSnapshot(snapshot: EnvSnapshot): void {
  const env = import.meta.env as Record<string, string | undefined>;
  if (snapshot.VITE_OPENAI_API_KEY === undefined) {
    delete env.VITE_OPENAI_API_KEY;
    return;
  }

  env.VITE_OPENAI_API_KEY = snapshot.VITE_OPENAI_API_KEY;
}

describe('resolveOpenAiApiKey', () => {
  const originalEnv = readEnvSnapshot();

  afterEach(() => {
    writeEnvSnapshot(originalEnv);
  });

  it('prefers VITE_OPENAI_API_KEY over a runtime key', async () => {
    writeEnvSnapshot({
      VITE_OPENAI_API_KEY: 'env-key',
    });

    const { resolveOpenAiApiKey } = await import('../../lib/openaiKey');
    expect(resolveOpenAiApiKey('runtime-key')).toBe('env-key');
  });

  it('falls back to the runtime key when env key is absent', async () => {
    writeEnvSnapshot({
      VITE_OPENAI_API_KEY: undefined,
    });

    const { resolveOpenAiApiKey } = await import('../../lib/openaiKey');
    expect(resolveOpenAiApiKey('runtime-key')).toBe('runtime-key');
  });

  it('treats blank runtime and env values as missing', async () => {
    writeEnvSnapshot({
      VITE_OPENAI_API_KEY: '   ',
    });

    const { resolveOpenAiApiKey } = await import('../../lib/openaiKey');
    expect(resolveOpenAiApiKey('   ')).toBeNull();
  });
});
