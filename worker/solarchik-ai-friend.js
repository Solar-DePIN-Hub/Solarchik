/**
 * Cloudflare Worker: solarchik-ai-friend
 * Paste this as the entire Worker script, keep secrets:
 *   FEATHERLESS_API_KEY
 *   GEMINI_API_KEY
 *
 * Route: POST /v1/chat
 * Domain: https://friend.solardepin.net
 */
const FEATHERLESS_URL = "https://api.featherless.ai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const PRIMARY = "Qwen/Qwen2.5-14B-Instruct";
const SECONDARY = "Qwen/Qwen2.5-32B-Instruct";
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const ALLOW = new Set([
  "https://appassets.androidplatform.net",
  "https://friend.solardepin.net",
]);

const locks = new Map();
/** Cyrillic needs ~2-3x the tokens of English; 120 cut Ukrainian replies mid-sentence. */
const MAX_TOKENS = 600;
const RETRY_TOKENS = 800;
const REPLY_CHARS = 900;

function cors(origin) {
  const allow = ALLOW.has(origin) ? origin : "https://appassets.androidplatform.net";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

function json(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

function clip(s, n) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

/** Drops a dangling half sentence (model hit the token cap). Keeps the text when no sentence end exists. */
function wholeSentences(text) {
  const t = String(text || "").trim();
  const m = t.match(/^[\s\S]*[.!?…。！？](?=\s|$)/);
  return m && m[0].length >= 12 ? m[0].trim() : t;
}

function extractText(body) {
  const c = body?.choices?.[0];
  const msg = c?.message;
  let raw = "";
  if (typeof msg?.content === "string") raw = msg.content;
  else if (Array.isArray(msg?.content)) raw = msg.content.map((p) => p?.text || p?.content || "").join("");
  else if (typeof c?.text === "string") raw = c.text;
  else if (typeof body?.output_text === "string") raw = body.output_text;
  return clip(raw, REPLY_CHARS);
}

function classify(body, http) {
  if (http !== 200) return `http_${http}`;
  const c = body?.choices?.[0];
  if (!c) return "no_choice";
  const reason = c.finish_reason || "";
  const text = extractText(body);
  if (text) return "ok";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "filtered";
  return "empty_content";
}

function shapeLog(body, http, ms, model, attempt) {
  const c = body?.choices?.[0];
  const content = c?.message?.content;
  return {
    event: "llm_shape",
    model,
    attempt,
    http,
    ms,
    keys: body && typeof body === "object" ? Object.keys(body).sort() : [],
    choices: Array.isArray(body?.choices) ? body.choices.length : -1,
    finish: c?.finish_reason ?? null,
    contentType: content == null ? "null" : Array.isArray(content) ? "array" : typeof content,
    contentChars: typeof content === "string" ? content.length : 0,
    hasText: Boolean(extractText(body)),
    usage: body?.usage
      ? {
          prompt: body.usage.prompt_tokens ?? body.usage.input_tokens ?? null,
          completion: body.usage.completion_tokens ?? body.usage.output_tokens ?? null,
        }
      : null,
    id: body?.id ?? null,
  };
}

const LANG_NAMES = { en: "English", uk: "Ukrainian", es: "Spanish", pt: "Portuguese", de: "German", ja: "Japanese", ru: "Russian" };

/** Best guess of the language of the player's own message. Falls back to the app language. */
function detectLanguage(message, fallback) {
  const s = String(message || "");
  if (/[\u0400-\u04FF]/.test(s)) {
    if (/[іїєґІЇЄҐ]/.test(s)) return "uk";
    if (/[ыэъЫЭЪё]/.test(s)) return "ru";
    return fallback === "ru" ? "ru" : "uk";
  }
  if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(s)) return "ja";
  if (/[ãõç]|\b(você|voce|não|nao|obrigad[oa]|tá|está bem)\b/i.test(s)) return "pt";
  if (/[ñ¿¡]|\b(hola|gracias|qué|cómo|por favor|estoy)\b/i.test(s)) return "es";
  if (/[äöüß]|\b(hallo|danke|bitte|ich bin)\b/i.test(s)) return "de";
  if (/^[\x00-\x7F]+$/.test(s) && /\b(the|you|what|how|is|are|hi|hello|thanks)\b/i.test(s)) return "en";
  return fallback;
}

/** Facts the friend may state. Keep in sync with fees.config.ts, user-limits.ts and fee-windows.ts. */
const GAME_FACTS = [
  "Game facts (state only these, never invent numbers):",
  "Clock in once per day to grow the streak; a missed day resets it.",
  "Every 7 clock-in days earn a 48-hour fee-free window; every 30 days earn a 7-day fee-free window. The player activates a window when they choose; trades opened inside it pay no fee.",
  "Free agents pay a 5% fee on profitable closed trades only (no fee on losses or inside a fee-free window).",
  "Pro agent costs 0.1 SOL once and pays no profit fee.",
  "Risk limits: at most 0.02 SOL per trade, 0.3 SOL spend per day, 0.3 SOL loss per day, and auto-stop after 2 losses in a row. The player can only lower these limits.",
  "Practice runs on Solana devnet by default; real mainnet trading is off unless the player turns it on.",
  "Strategies and agent picks are forecasts, not promises or bets: never promise profit, never tell the player to bet or to put in more money, and remind them they can lose.",
  "If asked something you do not know about the game, say you are not sure.",
].join(" ");

function systemPrompt(input) {
  const name = clip(input.name, 16) || "Solarchik";
  const scene = clip(input.scene, 12);
  const lang = clip(input.language, 8) || "en";
  const replyLang = clip(input.replyLanguage, 8) || lang;
  const langName = LANG_NAMES[replyLang] || replyLang;
  return [
    `You are ${name}, a small navy-and-gold solar robot with a gold visor and cyan eyes.`,
    `You are the player's pocket friend in Solarchik CLOCK IN. Never a battery, egg, Tamagotchi, AI, Gemini, Grok, or chatbot.`,
    `Always answer in the language the player wrote their last message in (looks like ${langName}; app language ${lang}). Never switch to English unless the player wrote English.`,
    `1-3 short complete spoken sentences, always finish the last sentence. No markdown, no lists.`,
    GAME_FACTS,
    scene === "run" ? `You are IN a roof run (${clip(input.context, 80) || "running"}). One clear spoken sentence.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function canned(lang) {
  if (lang === "uk") return "Тримаю сонце в кишені. Ще раз — я тут.";
  if (lang === "es") return "Sigo aquí, con el sol en el bolsillo.";
  if (lang === "pt") return "Tô aqui, com o sol no bolso.";
  if (lang === "de") return "Ich bin da, Sonne in der Tasche.";
  if (lang === "ja") return "ここにいるよ。ポケットに太陽。";
  return "Still here. Sun in my pocket.";
}

function slimMessages(messages) {
  const sys = messages.filter((m) => m.role === "system").slice(0, 1);
  const rest = messages.filter((m) => m.role !== "system").slice(-2);
  return [...sys, ...rest];
}

async function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  let release = () => {};
  const gate = new Promise((ok) => {
    release = ok;
  });
  const next = prev.then(() => gate);
  locks.set(id, next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === next) locks.delete(id);
  }
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/v1/chat") {
      return json({ error: "not_found" }, origin, 404);
    }

    let input;
    try {
      input = await req.json();
    } catch {
      return json({ error: "bad_json" }, origin, 400);
    }

    const message = clip(input.message, 2000);
    if (message.length < 1) return json({ error: "message_must_be_1_to_2000_characters" }, origin, 400);

    const appLanguage = clip(input.language, 8) || "en";
    const language = detectLanguage(message, appLanguage);
    const playerId = clip(input.playerId, 80) || crypto.randomUUID();
    const conversationId = clip(input.conversationId, 80) || crypto.randomUUID();
    const historyIn = Array.isArray(input.history) ? input.history.slice(-4) : [];
    const history = [];
    for (const row of historyIn) {
      const role = row?.role === "assistant" || row?.role === "buddy" ? "assistant" : "user";
      const content = clip(row?.content || row?.text, 400);
      if (content) history.push({ role, content });
    }

    const messages = [{ role: "system", content: systemPrompt({ ...input, language: appLanguage, replyLanguage: language }) }, ...history, { role: "user", content: message }];

    return withLock(playerId, async () => {
      const out = await chat(env, messages, language);
      return json(
        {
          reply: out.text,
          playerId,
          conversationId,
          provider: out.provider,
          fallback: out.fallback,
        },
        origin,
      );
    });
  },
};

async function chat(env, messages, language) {
  let r = await callFeatherless(env, messages, PRIMARY, MAX_TOKENS, 0);
  if (r.kind === "ok") return { text: r.text, provider: "featherless", fallback: false };

  const retryable = new Set(["no_choice", "empty_content", "length", "http_500", "http_502", "http_503", "http_429", "http_0"]);
  if (retryable.has(r.kind) || r.kind.startsWith("http_5") || r.kind.startsWith("http_429")) {
    await sleep(300);
    r = await callFeatherless(env, slimMessages(messages), PRIMARY, RETRY_TOKENS, 1);
    if (r.kind === "ok") return { text: r.text, provider: "featherless", fallback: false };
    r = await callFeatherless(env, slimMessages(messages), SECONDARY, RETRY_TOKENS, 2);
    if (r.kind === "ok") return { text: r.text, provider: "featherless", fallback: false };
  }

  const g = await callGemini(env, messages, language);
  if (g) return { text: g, provider: "gemini", fallback: false };
  return { text: canned(language), provider: "local", fallback: true };
}

async function callFeatherless(env, messages, model, maxTokens, attempt) {
  const key = env.FEATHERLESS_API_KEY;
  if (!key) return { kind: "http_0", text: "" };
  const t0 = Date.now();
  try {
    const res = await fetch(FEATHERLESS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
        top_p: 0.9,
        stream: false,
      }),
    });
    const body = await res.json().catch(() => null);
    const ms = Date.now() - t0;
    const kind = classify(body, res.status);
    console.log(JSON.stringify(shapeLog(body, res.status, ms, model, attempt)));
    const raw = extractText(body);
    const cut = body?.choices?.[0]?.finish_reason === "length" || raw.length >= REPLY_CHARS;
    return { kind, text: cut ? wholeSentences(raw) : raw };
  } catch (err) {
    console.log(JSON.stringify({ event: "llm_shape", model, attempt, http: 0, ms: Date.now() - t0, hasText: false, error: "network" }));
    return { kind: "http_0", text: "" };
  }
}

async function callGemini(env, messages, language) {
  const key = env.GEMINI_API_KEY;
  if (!key) return "";
  const sys = messages.find((m) => m.role === "system")?.content || "";
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const t0 = Date.now();
  try {
    const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents,
        generationConfig: { maxOutputTokens: RETRY_TOKENS, temperature: 0.7 },
      }),
    });
    const body = await res.json().catch(() => null);
    const parts = body?.candidates?.[0]?.content?.parts || [];
    const joined = clip(parts.map((p) => p?.text || "").join(" "), REPLY_CHARS);
    const cut = body?.candidates?.[0]?.finishReason === "MAX_TOKENS" || joined.length >= REPLY_CHARS;
    const text = cut ? wholeSentences(joined) : joined;
    console.log(
      JSON.stringify({
        event: "llm_shape",
        model: GEMINI_MODEL,
        attempt: 9,
        http: res.status,
        ms: Date.now() - t0,
        hasText: Boolean(text),
        keys: body && typeof body === "object" ? Object.keys(body).sort() : [],
      }),
    );
    return text;
  } catch {
    console.log(JSON.stringify({ event: "llm_shape", model: GEMINI_MODEL, attempt: 9, http: 0, ms: Date.now() - t0, hasText: false }));
    return "";
  }
}

function sleep(ms) {
  return new Promise((ok) => setTimeout(ok, ms));
}
