function readEnvString(name: string): string | null {
  const value = import.meta.env[name];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveOpenAiApiKey(runtimeKey?: string | null): string | null {
  const envKey = readEnvString('VITE_OPENAI_API_KEY');
  if (envKey) {
    return envKey;
  }

  if (typeof runtimeKey === 'string') {
    const trimmed = runtimeKey.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}
