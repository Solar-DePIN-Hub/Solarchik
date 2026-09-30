import { createServerFn } from "@tanstack/react-start";
import { isLocale, t, type Locale } from "./i18n";
import {
  CHAT_MAX_LEN,
  isPetVibe,
  isPetVoice,
  type PetEmotion,
  type PetStageId,
  type PetVibe,
  type PetVoice,
} from "./pet";
import { geminiApiKey, xaiApiKey } from "./secrets.server";

const GEMINI_VOICE: Record<PetVoice, string> = {
  eve: "Kore",
  ara: "Aoede",
  rex: "Fenrir",
  leo: "Puck",
};

const VIBE_LINE: Record<PetVibe, string> = {
  sunny: "Warm, bright, a little corny. Solar metaphors. Cheers the player on.",
  dry: "Deadpan, short, dry humor. Never mean. Still clearly cares.",
  hype: "Loud, competitive, CLOCK IN energy. Roofs, suns, heat. Caps used sparingly.",
  gentle: "Soft, slow, caring. Small words. Treats the player like a safe pocket.",
};

const CHAT_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.6-flash"] as const;
const TTS_MODELS = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"] as const;
const STT_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"] as const;

type HistoryItem = { role: "user" | "buddy"; text: string };

export type AskBuddyInput = {
  name: string;
  vibe: string;
  stage: string;
  emotion: string;
  locale: string;
  charge: number;
  mood: number;
  rest: number;
  shine: number;
  careDays: number;
  history: HistoryItem[];
  message: string;
  scene?: string;
  context?: string;
  playerId?: string;
};

export type AskBuddyResult =
  | { ok: true; text: string; offline?: boolean }
  | { ok: false; error: "offline" | "bad" | "busy" | "timeout" | "empty" };

function clip(s: unknown, n: number): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "";
}

function fallbackLine(locale: Locale, vibe: PetVibe, name: string): string {
  const key =
    vibe === "dry"
      ? "pet.chat.can.dry"
      : vibe === "hype"
        ? "pet.chat.can.hype"
        : vibe === "gentle"
          ? "pet.chat.can.gentle"
          : "pet.chat.can.sunny";
  return t(locale, key, { name });
}

function validate(input: unknown): AskBuddyInput {
  const d = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const historyIn = Array.isArray(d.history) ? d.history : [];
  const history: HistoryItem[] = [];
  for (const row of historyIn.slice(-10)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { role?: unknown; text?: unknown };
    const role = rec.role === "user" || rec.role === "buddy" ? rec.role : null;
    const text = clip(rec.text, CHAT_MAX_LEN);
    if (!role || !text) continue;
    history.push({ role, text });
  }
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
  };
  return {
    name: clip(d.name, 16) || "Solarchik",
    vibe: clip(d.vibe, 12),
    stage: clip(d.stage, 16),
    emotion: clip(d.emotion, 16),
    locale: clip(d.locale, 8),
    charge: num(d.charge),
    mood: num(d.mood),
    rest: num(d.rest),
    shine: num(d.shine),
    careDays: Math.max(0, Math.min(400, Math.floor(Number(d.careDays) || 0))),
    history,
    message: clip(d.message, CHAT_MAX_LEN),
    scene: clip(d.scene, 12),
    context: clip(d.context, 80),
    playerId: clip(d.playerId, 80),
  };
}

function systemPrompt(data: AskBuddyInput, locale: Locale, vibe: PetVibe, _stage: PetStageId, emotion: PetEmotion): string {
  return [
    `You are ${data.name}, a small navy-and-gold solar robot with a gold visor and cyan eyes.`,
    `You are the player's pocket friend in Solarchik CLOCK IN. Never a battery, egg, Tamagotchi, AI, Gemini, Grok, or chatbot.`,
    `Personality: ${VIBE_LINE[vibe]} Right now you feel ${emotion}. Together ${data.careDays} days.`,
    `Reply in the same language as the player. 1-2 complete spoken sentences. No markdown, no lists.`,
    data.scene === "run" ? `You are IN a roof run (${data.context || "running"}). One clear spoken sentence.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function partsText(json: unknown): string {
  const cands = (json as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })?.candidates;
  const parts = cands?.[0]?.content?.parts ?? [];
  const texts = parts
    .filter((p) => p.thought !== true)
    .map((p) => (p.text || "").trim())
    .filter(Boolean);
  if (!texts.length) return "";
  const uniq = [...new Set(texts)];
  return (uniq.length === 1 ? uniq[0] : uniq[uniq.length - 1]).slice(0, 420);
}

function tidyReply(raw: string): string {
  const s = raw
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, 420);
}

async function geminiGenerate(model: string, body: unknown, ms = 8000): Promise<{ ok: boolean; status: number; json: unknown }> {
  const key = geminiApiKey();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key || "",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

function chatContents(history: HistoryItem[], message: string): { role: string; parts: { text: string }[] }[] {
  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const turn of history) {
    const role = turn.role === "buddy" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + turn.text;
    else contents.push({ role, parts: [{ text: turn.text }] });
  }
  if (contents[0]?.role === "model") contents.unshift({ role: "user", parts: [{ text: "Hi." }] });
  const last = contents[contents.length - 1];
  if (last?.role === "user") last.parts[0].text += (last.parts[0].text ? "\n" : "") + message;
  else contents.push({ role: "user", parts: [{ text: message }] });
  return contents;
}

async function callGrokChat(
  system: string,
  history: HistoryItem[],
  message: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string | null> {
  const key = xaiApiKey();
  if (!key) return null;
  const messages: { role: string; content: string }[] = [{ role: "system", content: system }];
  for (const turn of history) {
    messages.push({ role: turn.role === "buddy" ? "assistant" : "user", content: turn.text });
  }
  const last = messages[messages.length - 1];
  if (!(last?.role === "user" && last.content === message)) {
    messages.push({ role: "user", content: message });
  }
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = tidyReply(json.choices?.[0]?.message?.content || "");
    return text || null;
  } catch {
    return null;
  }
}

function firstLive(a: Promise<string | null>, b: Promise<string | null>): Promise<string | null> {
  return new Promise((resolve) => {
    let left = 2;
    let done = false;
    const one = (t: string | null) => {
      if (done) return;
      if (t) {
        done = true;
        resolve(t);
        return;
      }
      left -= 1;
      if (left <= 0) resolve(null);
    };
    a.then(one, () => one(null));
    b.then(one, () => one(null));
  });
}

async function speakXai(text: string, voice: PetVoice, locale: string): Promise<{ audio: string; mime: string } | null> {
  const key = xaiApiKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        text,
        voice_id: voice,
        language: locale || "en",
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 80 || buf.byteLength > 1_200_000) return null;
    const mime = (res.headers.get("content-type") || "audio/mpeg").split(";")[0] || "audio/mpeg";
    return { audio: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

async function callGeminiChat(
  system: string,
  history: HistoryItem[],
  message: string,
  maxTokens: number,
): Promise<string | null> {
  const contents = chatContents(history, message);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.75,
    },
  };
  for (const model of CHAT_MODELS) {
    try {
      let { ok, status, json } = await geminiGenerate(model, body);
      if (status === 429 || status === 503) {
        await new Promise((r) => setTimeout(r, 450));
        ({ ok, status, json } = await geminiGenerate(model, body));
      }
      if (!ok) continue;
      const text = tidyReply(partsText(json));
      if (text) return text;
    } catch {
      continue;
    }
  }
  return null;
}

function parsePcmRate(mime: string): number {
  const m = /rate=(\d+)/i.exec(mime);
  const n = m ? Number(m[1]) : 24000;
  return Number.isFinite(n) && n > 8000 ? n : 24000;
}

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function speakGemini(text: string, voice: PetVoice): Promise<{ audio: string; mime: string } | null> {
  const voiceName = GEMINI_VOICE[voice] || "Kore";
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      },
    },
  };
  for (const model of TTS_MODELS) {
    try {
      const { ok, json } = await geminiGenerate(model, body, 18_000);
      if (!ok) continue;
      const parts = (json as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] })
        ?.candidates?.[0]?.content?.parts;
      const inline = parts?.find((p) => p.inlineData?.data)?.inlineData;
      const b64 = inline?.data;
      const mime = inline?.mimeType || "";
      if (!b64) continue;
      const raw = Buffer.from(b64, "base64");
      if (raw.byteLength < 80 || raw.byteLength > 1_200_000) continue;
      if (/wav|mpeg|mp3|ogg|webm/i.test(mime)) {
        return { audio: raw.toString("base64"), mime: mime.split(";")[0] || "audio/wav" };
      }
      return { audio: pcm16ToWav(raw, parsePcmRate(mime)).toString("base64"), mime: "audio/wav" };
    } catch {
      continue;
    }
  }
  return null;
}

async function hearGemini(audio: string, mime: string): Promise<string | null> {
  const cleanMime = mime.split(";")[0] || "audio/webm";
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: cleanMime, data: audio } },
          { text: "Transcribe the speech. Return only the spoken words. No quotes, labels, or extra text." },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 180,
      temperature: 0,
    },
  };
  for (const model of STT_MODELS) {
    try {
      const { ok, json } = await geminiGenerate(model, body);
      if (!ok) continue;
      const text = clip(partsText(json), CHAT_MAX_LEN);
      if (text) return text;
    } catch {
      continue;
    }
  }
  return null;
}

export const askBuddy = createServerFn({ method: "POST" })
  .validator((input: unknown) => validate(input))
  .handler(async ({ data }): Promise<AskBuddyResult> => {
    if (!data.message) return { ok: false, error: "bad" };
    const locale: Locale = isLocale(data.locale) ? data.locale : "en";
    const vibe: PetVibe = isPetVibe(data.vibe) ? data.vibe : "sunny";
    const stage = (data.stage || "battery") as PetStageId;
    const emotion = (data.emotion || "curious") as PetEmotion;
    const canned = fallbackLine(locale, vibe, data.name);
    const system = systemPrompt(data, locale, vibe, stage, emotion);
    const fast = data.scene === "run";
    const tokens = fast ? 70 : 140;
    const wait = fast ? 4500 : 8000;
    try {
      const text =
        (await callGeminiChat(system, data.history, data.message, tokens)) ||
        (await callGrokChat(system, data.history, data.message, tokens, wait));
      if (text) return { ok: true, text };
      return { ok: true, text: canned, offline: true };
    } catch {
      return { ok: true, text: canned, offline: true };
    }
  });

export const speakBuddy = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const d = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return {
      text: clip(d.text, 280),
      voice: clip(d.voice, 12),
      locale: clip(d.locale, 8),
    };
  })
  .handler(async ({ data }): Promise<{ ok: true; audio: string; mime: string } | { ok: false }> => {
    if (!data.text) return { ok: false };
    const voice: PetVoice = isPetVoice(data.voice) ? data.voice : "eve";
    const locale = isLocale(data.locale) ? data.locale : "en";
    try {
      const out = (await speakGemini(data.text, voice)) || (await speakXai(data.text, voice, locale));
      if (!out) return { ok: false };
      return { ok: true, audio: out.audio, mime: out.mime };
    } catch {
      return { ok: false };
    }
  });

export const hearBuddy = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const d = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const audio = typeof d.audio === "string" ? d.audio.replace(/\s/g, "") : "";
    const mime = clip(d.mime, 40) || "audio/webm";
    return { audio: audio.slice(0, 1_200_000), mime };
  })
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false }> => {
    if (!data.audio) return { ok: false };
    try {
      const bin = Buffer.from(data.audio, "base64");
      if (bin.byteLength < 200 || bin.byteLength > 900_000) return { ok: false };
      const text = await hearGemini(data.audio, data.mime);
      if (!text) return { ok: false };
      return { ok: true, text };
    } catch {
      return { ok: false };
    }
  });
