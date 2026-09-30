import { createServerFn } from "@tanstack/react-start";

/** One short Gemini reply. Same path the coach uses when Grok is silent. */
export const pingAgent = createServerFn({ method: "GET" }).handler(async (): Promise<{ ok: true; model: string } | { ok: false }> => {
  const { geminiPing } = await import("./gemini-live.server");
  return geminiPing();
});
