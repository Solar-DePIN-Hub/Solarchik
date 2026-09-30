/** Server-only keys. Never import from client. */

export function xaiApiKey(): string | undefined {
  const k = process.env.XAI_API_KEY?.trim();
  return k || undefined;
}

export function geminiApiKey(): string | undefined {
  const env = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  return env || undefined;
}
