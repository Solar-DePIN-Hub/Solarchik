import { geminiApiKey } from "@/lib/game/secrets.server";

/** Models that answered on 2026-09-29. Dead ids (2.0 / 2.5 flash) stay out. */
const MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"] as const;

type Part = { text?: string; thought?: boolean };

export async function geminiTalk(
  system: string,
  user: string,
  maxTokens: number,
): Promise<{ text: string; model: string } | null> {
  const key = geminiApiKey();
  if (!key || !user.trim()) return null;
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.4,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { candidates?: { content?: { parts?: Part[] } }[] };
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const texts = parts
        .filter((p) => p && p.thought !== true && typeof p.text === "string" && p.text.trim())
        .map((p) => p.text!.trim());
      const text = texts[texts.length - 1];
      if (text) return { text, model };
    } catch {
      continue;
    }
  }
  return null;
}

/** Tiny live check. Does not invent a reply if every model stays quiet. */
export async function geminiPing(): Promise<{ ok: true; model: string } | { ok: false }> {
  const alt = await geminiTalk('Return JSON {"ok":true} and nothing else.', "ping", 32);
  if (!alt?.text || !/"ok"\s*:\s*true/.test(alt.text)) return { ok: false };
  return { ok: true, model: alt.model };
}
