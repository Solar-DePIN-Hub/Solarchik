/** Server-only keys. Never import from client. */

import { readFileSync } from "node:fs";

export function xaiApiKey(): string | undefined {
  const k = process.env.XAI_API_KEY?.trim();
  return k || undefined;
}

export function geminiApiKey(): string | undefined {
  const env = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (env) return env;
  try {
    const file = readFileSync(new URL("../../../server/gemini.secret", import.meta.url), "utf8").trim();
    return file || undefined;
  } catch {
    return undefined;
  }
}
