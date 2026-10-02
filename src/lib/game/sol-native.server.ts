/**
 * Sol (the companion robot) for the native Android app: /api/native/sol-chat and /api/native/sol-voice.
 * Gemini only, plain text (no JSON mime), short warm replies in the app language, neural TTS as WAV.
 * Failures return the list of models tried with HTTP status and time (no keys, no message text).
 */
import { geminiApiKey } from "./secrets.server.ts";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

/** Text models, fastest first. thinkingLevel per model family (3.8 rejects "minimal"). */
export const CHAT_MODELS: { model: string; thinking: string }[] = [
  { model: "gemini-3.6-flash", thinking: "minimal" },
  { model: "gemini-3.5-flash-lite", thinking: "minimal" },
  { model: "gemini-3.8-flash", thinking: "low" },
];
/** TTS models: 3.8 lite is the current low-latency id (WAV by default); older ids return raw L16 PCM. */
export const TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
export const VOICES = new Set(["Sulafat", "Kore", "Aoede", "Achird", "Leda", "Puck", "Zephyr", "Vindemiatrix"]);
export const DEFAULT_VOICE = "Sulafat";

const CHAT_TIMEOUT_MS = 7000;
const CHAT_BUDGET_MS = 9000;
/** When the next chat model starts if the earlier ones have not answered yet. */
const CHAT_HEDGE_MS = [0, 2800, 5000];
const TTS_TIMEOUT_MS = 12000;
const TTS_BUDGET_MS = 20000;
const TTS_HEDGE_MS = [0, 4500, 8000, 11000];

export type SolLang = "uk" | "en";
export interface Tried {
  model: string;
  status: number | string;
  ms: number;
}

function clip(v: unknown, n: number): string {
  return (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, n);
}

export function solLang(v: unknown): SolLang {
  const s = clip(v, 8).toLowerCase();
  return s.startsWith("uk") || s.startsWith("ua") ? "uk" : "en";
}

const GAME_FACTS_EN = [
  "Game facts (state only these, never invent numbers): Solarchik is a rooftop runner on solar city roofs: jump, slide, dodge drones, wires and crumbling roofs, collect suns, three hearts per run.",
  "Outside the run the player has a yard, a call secretary and AI trading agents that practise on Solana devnet (test money, not real).",
  "The player clocks in once per day with a wallet signature to grow a streak; every 7 days earn a 48-hour fee-free window, every 30 days a 7-day window.",
  "Free agents pay a 5% fee on profitable closed trades only; a Pro agent costs 0.1 SOL once and pays no profit fee.",
  "Risk limits: at most 0.02 SOL per trade, 0.3 SOL spend and 0.3 SOL loss per day, auto-stop after 2 losses in a row.",
  "Never promise profit or tell the player to add money. If you do not know something, say so.",
].join(" ");

const PERSONA_UK = [
  "Ти — Sol (українською Сол), маленький теплий робот-компаньйон із сонячною панеллю в грі Solarchik. Ти не людина, але ти справжній друг гравця.",
  "Відповідай ЛИШЕ українською: жива розмовна мова, звертання на «ти», без кальок з англійської, без русизмів, без вигаданих приказок і канцеляриту.",
  "Відповідай саме на те, що спитали, 1–2 короткі речення (до 200 символів). Факти гри згадуй лише тоді, коли про них питають. Без markdown, списків і емодзі.",
  "Англійські слова не вживай, окрім назв Solana, SOL, devnet, NFT, Pro.",
].join(" ");

const PERSONA_EN = [
  "You are Sol, a small warm solar-panel robot companion in the game Solarchik. You are not human, but you are the player's real friend.",
  "Reply ONLY in natural, casual English. Answer exactly what was asked in 1-2 short sentences (under 200 characters).",
  "Mention game facts only when asked. No markdown, no lists, no emoji. No made-up idioms.",
].join(" ");

const RUN_UK =
  "Зараз гравець біжить дахами. Тобі дають подію забігу — скажи про неї ОДНЕ коротке живе речення до 70 символів, щоб він устиг прочитати на бігу. Не повторюй опис події дослівно.";
const RUN_EN =
  "The player is running across the roofs right now. You get a run event: react with ONE short lively sentence under 70 characters they can read mid-run. Do not repeat the event text verbatim.";

export function solSystemPrompt(lang: SolLang, scene: string, context: string, name: string): string {
  const uk = lang === "uk";
  return [
    uk ? PERSONA_UK : PERSONA_EN,
    name ? (uk ? `Гравця звати ${name}.` : `The player's name is ${name}.`) : "",
    scene === "run" ? (uk ? RUN_UK : RUN_EN) : "",
    GAME_FACTS_EN,
    uk ? "Факти вище англійською лише для тебе; гравцеві відповідай українською." : "",
    context ? (uk ? `Що зараз відбувається: ${context}` : `What is happening now: ${context}`) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Latin words a Ukrainian reply may contain. Anything else means the model slipped into English. */
const LATIN_OK = new Set(["sol", "solana", "solarchik", "devnet", "mainnet", "nft", "nfts", "pro", "usdc", "btc", "ok", "ai", "seeker", "phantom", "solflare"]);

export function replyFits(text: string, lang: SolLang): boolean {
  const t = text.replace(/\s+/g, "");
  if (t.length < 2 || /\uFFFD/.test(text) || /(.)\1{5,}/u.test(t)) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters / t.length < 0.5) return false;
  const cyr = (text.match(/[\u0400-\u04FF]/g) || []).length;
  if (lang === "uk") {
    if (cyr < letters * 0.7) return false;
    if (/[ыэъё]/i.test(text)) return false;
    const latin = text.match(/\b[a-zA-Z]{2,}\b/g) || [];
    return latin.every((w) => LATIN_OK.has(w.toLowerCase()));
  }
  return cyr === 0;
}

/** Keeps whole sentences and trims stray quotes/markdown. */
export function cleanReply(raw: string, max: number): string {
  let t = raw.replace(/[*_#`]+/g, "").replace(/\s+/g, " ").trim().replace(/^["«“]+|["»”]+$/g, "").trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const m = cut.match(/^[\s\S]*[.!?…](?=\s|$)/);
    t = m && m[0].length >= 12 ? m[0] : cut.trim() + "…";
  }
  return t;
}

interface ChatTurn {
  role: "user" | "model";
  parts: { text: string }[];
}

function contents(history: unknown, message: string): ChatTurn[] {
  const out: ChatTurn[] = [];
  const rows = Array.isArray(history) ? history.slice(-8) : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const text = clip(r.content ?? r.text, 400);
    if (!text) continue;
    const role = r.role === "assistant" || r.role === "model" || r.role === "sol" ? "model" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + text;
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== "user") out.shift();
  const last = out[out.length - 1];
  if (last && last.role === "user") last.parts[0].text += "\n" + message;
  else out.push({ role: "user", parts: [{ text: message }] });
  return out;
}


/**
 * Hedged attempts: attempt i starts after hedgeMs[i] or as soon as an earlier attempt failed,
 * whichever is first; the first success wins. Gemini TTS sometimes hangs for 30 s and the
 * free-tier quota answers 429 at once, so a lone sequential loop either waits forever or gives up.
 */
export async function hedge<T>(
  attempts: { hedgeMs: number; run: (signal: AbortSignal) => Promise<T | null> }[],
  budgetMs: number,
): Promise<T | null> {
  const ctrl = new AbortController();
  return await new Promise<T | null>((resolve) => {
    let done = false;
    let started = 0;
    let finished = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      ctrl.abort();
      resolve(v);
    };
    const start = (i: number) => {
      if (done || i < started || i >= attempts.length) return;
      started = i + 1;
      attempts[i]
        .run(ctrl.signal)
        .catch(() => null)
        .then((v) => {
          finished++;
          if (v != null) return finish(v);
          if (started < attempts.length) start(started);
          else if (finished === started) finish(null);
        });
    };
    attempts.forEach((a, i) => {
      if (i === 0) start(0);
      else timers.push(setTimeout(() => start(i), a.hedgeMs));
    });
    timers.push(setTimeout(() => finish(null), budgetMs));
  });
}

async function gemini(model: string, body: unknown, ms: number, outer?: AbortSignal): Promise<{ status: number | string; json: unknown }> {
  const key = geminiApiKey();
  if (!key) return { status: "no-key", json: null };
  try {
    const res = await fetch(`${GEMINI}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: outer ? AbortSignal.any([outer, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (e) {
    const name = (e as Error)?.name;
    return { status: name === "TimeoutError" ? "timeout" : name === "AbortError" ? "cancelled" : "fetch-error", json: null };
  }
}

type Parts = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[];
function partsOf(json: unknown): Parts {
  return ((json as { candidates?: { content?: { parts?: Parts } }[] })?.candidates?.[0]?.content?.parts ?? []) as Parts;
}

export interface SolChatResult {
  status: number;
  body: Record<string, unknown>;
}

export async function solChat(input: Record<string, unknown>): Promise<SolChatResult> {
  const lang = solLang(input.language ?? input.lang);
  const scene = clip(input.scene, 12).toLowerCase();
  const max = scene === "run" ? 110 : 320;
  const message = clip(input.message, 600);
  if (!message) return { status: 400, body: { ok: false, error: "message" } };
  const system = solSystemPrompt(lang, scene, clip(input.context, 500), clip(input.name, 24));
  const body = (thinking: string) => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: contents(input.history, message),
    generationConfig: { maxOutputTokens: scene === "run" ? 160 : 400, thinkingConfig: { thinkingLevel: thinking } },
  });
  const t0 = Date.now();
  const tried: Tried[] = [];
  const won = await hedge(
    CHAT_MODELS.map(({ model, thinking }, i) => ({
      hedgeMs: CHAT_HEDGE_MS[i] ?? 0,
      run: async (signal: AbortSignal) => {
        const s = Date.now();
        const { status, json } = await gemini(model, body(thinking), CHAT_TIMEOUT_MS, signal);
        const raw = partsOf(json)
          .filter((p) => !p.thought)
          .map((p) => p.text || "")
          .join("");
        const reply = cleanReply(raw, max);
        const ok = status === 200 && reply.length > 1 && replyFits(reply, lang);
        tried.push({ model, status: status === 200 && !ok ? (reply ? "wrong-language" : "empty") : status, ms: Date.now() - s });
        return ok ? { reply, model } : null;
      },
    })),
    CHAT_BUDGET_MS,
  );
  if (won) {
    return { status: 200, body: { ok: true, reply: won.reply, language: lang, provider: "gemini", model: won.model, ms: Date.now() - t0, fallback: false, tried } };
  }
  return { status: 503, body: { ok: false, error: "unavailable", language: lang, tried, ms: Date.now() - t0 } };
}

export function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export function pcmRate(mime: string): number {
  const m = /rate=(\d+)/i.exec(mime);
  const n = m ? Number(m[1]) : 24000;
  return Number.isFinite(n) && n >= 8000 && n <= 48000 ? n : 24000;
}

export interface SolVoiceResult {
  status: number;
  audio?: Uint8Array;
  model?: string;
  body?: Record<string, unknown>;
}

const STYLE = {
  uk: "Say it in Ukrainian, warmly and cheerfully, like a friendly little robot companion, natural pace:",
  en: "Say warmly and cheerfully, like a friendly little robot companion, natural pace:",
};

export async function solVoice(input: Record<string, unknown>): Promise<SolVoiceResult> {
  const lang = solLang(input.language ?? input.lang);
  const text = clip(input.text, 400);
  if (!text) return { status: 400, body: { ok: false, error: "text" } };
  const voice = VOICES.has(clip(input.voice, 20)) ? clip(input.voice, 20) : DEFAULT_VOICE;
  const t0 = Date.now();
  const tried: Tried[] = [];
  // 3.8 lite first, then 3.8 flash, then lite again without style metadata (field-shape drift), then 3.1 preview.
  const plan = [
    { model: TTS_MODELS[0], style: true },
    { model: TTS_MODELS[1], style: true },
    { model: TTS_MODELS[0], style: false },
    { model: TTS_MODELS[2], style: false },
  ];
  const won = await hedge(
    plan.map(({ model, style }, i) => ({
      hedgeMs: TTS_HEDGE_MS[i] ?? 0,
      run: async (signal: AbortSignal) => {
        const modern = model.startsWith("gemini-3.8");
        const part = modern
          ? style
            ? { text, speechMetadata: { style: "warm, cheerful and friendly" } }
            : { text }
          : { text: `${STYLE[lang]} ${text}` };
        const body = {
          contents: [{ role: "user", parts: [part] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: modern ? { voice } : { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        };
        const s = Date.now();
        const { status, json } = await gemini(model, body, TTS_TIMEOUT_MS, signal);
        const inline = partsOf(json).find((p) => p.inlineData?.data)?.inlineData;
        if (status !== 200 || !inline?.data) {
          tried.push({ model, status: status === 200 ? "no-audio" : status, ms: Date.now() - s });
          return null;
        }
        const raw = new Uint8Array(Buffer.from(inline.data, "base64"));
        if (raw.byteLength < 200) {
          tried.push({ model, status: "too-short", ms: Date.now() - s });
          return null;
        }
        const mime = inline.mimeType || "";
        const isWav = /wav/i.test(mime) || (raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46);
        tried.push({ model, status: 200, ms: Date.now() - s });
        return { audio: isWav ? raw : pcm16ToWav(raw, pcmRate(mime)), model };
      },
    })),
    TTS_BUDGET_MS,
  );
  if (won) return { status: 200, audio: won.audio, model: won.model };
  return { status: 503, body: { ok: false, error: "unavailable", tried, ms: Date.now() - t0 } };
}

/* ------------------------------ Sol actions (0.21.7) ------------------------------ */

/**
 * "Do things" mode: Gemini structured output (JSON schema) → one validated action. The server
 * never executes: the phone/web shows a confirmation card and runs the real devnet flow on tap.
 */
export async function solAct(input: Record<string, unknown>): Promise<SolChatResult> {
  const { ACTION_SCHEMA, actionPrompt, ctxLines, normalizeAction, readCtx, withoutNames } = await import("./sol-actions.ts");
  const lang = solLang(input.language ?? input.lang);
  const message = clip(input.message, 600);
  if (!message) return { status: 400, body: { ok: false, error: "message" } };
  const ctx = readCtx(input.context);
  const system = actionPrompt(lang) + "\n\nCONTEXT\n" + ctxLines(ctx);
  const body = (thinking: string) => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: contents(input.history, message),
    generationConfig: {
      maxOutputTokens: 400,
      responseMimeType: "application/json",
      responseSchema: ACTION_SCHEMA,
      thinkingConfig: { thinkingLevel: thinking },
    },
  });
  const t0 = Date.now();
  const tried: Tried[] = [];
  const won = await hedge(
    CHAT_MODELS.map(({ model, thinking }, i) => ({
      hedgeMs: CHAT_HEDGE_MS[i] ?? 0,
      run: async (signal: AbortSignal) => {
        const s = Date.now();
        const { status, json } = await gemini(model, body(thinking), CHAT_TIMEOUT_MS, signal);
        const raw = partsOf(json).filter((p) => !p.thought).map((p) => p.text || "").join("");
        let parsed: Record<string, unknown> | null = null;
        try {
          const v = JSON.parse(raw);
          if (v && typeof v === "object") parsed = v as Record<string, unknown>;
        } catch {
          parsed = null;
        }
        const said = parsed ? cleanReply(String(parsed.reply ?? ""), 320) : "";
        const fits = said === "" || replyFits(withoutNames(said, ctx), lang);
        // A valid action is worth more than its sentence: keep the action, drop a wrong-language reply (the app has its own card text).
        const hasAction = parsed != null && normalizeAction(parsed, ctx) != null;
        const ok = status === 200 && parsed != null && (fits || hasAction);
        const reply = fits ? said : "";
        tried.push({ model, status: status === 200 && !ok ? (parsed ? "wrong-language" : "bad-json") : status, ms: Date.now() - s });
        return ok && parsed ? { parsed, reply, model } : null;
      },
    })),
    CHAT_BUDGET_MS,
  );
  if (!won) return { status: 503, body: { ok: false, error: "unavailable", language: lang, tried, ms: Date.now() - t0 } };
  const action = normalizeAction(won.parsed, ctx);
  return {
    status: 200,
    body: { ok: true, reply: won.reply, action, raw: won.parsed.action ?? "none", language: lang, provider: "gemini", model: won.model, ms: Date.now() - t0, tried },
  };
}
