import { createServerFn } from "@tanstack/react-start";
import type { ShiftInput, ShiftResult } from "./shift-types";

export type { ShiftInput, ShiftOk, ShiftResult } from "./shift-types";

export type BrainStatus = {
  gemini: boolean;
  openai: boolean;
  grok: boolean;
};

function envOn(name: string): boolean {
  if (import.meta.env.VITE_NATIVE === "1" || typeof process === "undefined") return false;
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export const brainStatus = createServerFn({ method: "GET" }).handler(async (): Promise<BrainStatus> => {
  const gemini = envOn("GEMINI_API_KEY") || envOn("GOOGLE_GENERATIVE_AI_API_KEY");
  const openai = envOn("OPENAI_API_KEY");
  const grok = envOn("XAI_API_KEY") || import.meta.env.VITE_NATIVE === "1";
  return { gemini, openai, grok };
});

export const liveQuotes = createServerFn({ method: "POST" })
  .validator((input: { keywords?: string[]; titanKey?: string; sizeSol?: number; side?: string } | undefined) => ({
    keywords: Array.isArray(input?.keywords) ? input.keywords.slice(0, 4) : [],
    titanKey: typeof input?.titanKey === "string" ? input.titanKey.trim().slice(0, 256) : "",
    sizeSol: typeof input?.sizeSol === "number" && Number.isFinite(input.sizeSol) ? input.sizeSol : 0.1,
    side: input?.side === "buy" || input?.side === "sell" ? input.side : "both",
  }))
  .handler(async ({ data }) => {
    const { fetchQuotes } = await import("./shift.server");
    return fetchQuotes(data.keywords, data.titanKey, data.sizeSol, data.side);
  });

export const runAgentShift = createServerFn({ method: "POST" })
  .validator((input: ShiftInput) => input)
  .handler(async ({ data }): Promise<ShiftResult> => {
    const { executeShift } = await import("./shift.server");
    return executeShift(data);
  });
