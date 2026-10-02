/**
 * Cloudflare Worker: solarchik-ai-friend (https://friend.solardepin.net)
 *
 * Based on the deployed version 65501e10 ("Fast chat and voice routes for Solarchik Super App").
 * Routes, origin allowlist, CORS headers, secret names and response shapes are unchanged:
 *   GET  /healthz        -> {ok:true, service:"solarchik-ai-worker"}
 *   POST /v1/chat        {message, language?, history?, name?, scene?, context?}
 *                        -> {ok:true, reply, provider:"featherless"|"gemini"|"fallback", fallback}
 *                        400 {error:"invalid_message"}
 *   POST /v1/transcribe  {audio (base64 or data URL), mime?} -> {ok:true, text}
 *                        400 {ok:false, error:"invalid_audio"}, 503 {ok:false, error:"transcription_unavailable"}
 *   Origin not allowed   403 {error:"origin_not_allowed"} (no Origin header passes: native apps, curl)
 *
 * Secrets: FEATHERLESS_API_KEY, GEMINI_API_KEY. Optional vars: FEATHERLESS_MODEL, GEMINI_MODEL.
 *
 * Round 4 changes: game facts in the system prompt, reply in the player's language, history accepts
 * `text` or `content` (the Android client sends `content`), max tokens 600 (800 on the Gemini retry),
 * replies cut by the token cap keep whole sentences, reply cap 900 chars, provider timeouts fit the
 * Android client's 15 s read timeout, and a degenerate reply ("Пр!!!!…") falls through to Gemini.
 */
const FEATHERLESS_URL = "https://api.featherless.ai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const ORIGINS = new Set([
  "https://solarchik-super-app.vercel.app",
  "https://appassets.androidplatform.net",
  "https://friend.solardepin.net",
  "null",
]);

const MAX_TOKENS = 600;
const RETRY_TOKENS = 800;
const REPLY_CHARS = 900;
const FEATHERLESS_TIMEOUT_MS = 7000;
const GEMINI_TIMEOUT_MS = 6000;
const TRANSCRIBE_TIMEOUT_MS = 6000;

const LANG_NAMES = { en: "English", uk: "Ukrainian", es: "Spanish", pt: "Portuguese", de: "German", ja: "Japanese", ru: "Russian" };

/** Facts the friend may state. Keep in sync with fees.config.ts, user-limits.ts and fee-windows.ts in the web app. */
const GAME_FACTS = [
  "Game facts (state only these, never invent numbers):",
  "The player clocks in once per day with a wallet signature to grow the streak; a missed UTC day resets it.",
  "Every 7 clock-in days earn a 48-hour fee-free window; every 30 days earn a 7-day fee-free window. A fee-free window lasts exactly 48 hours or 7 days, nothing else. The player activates a window when they choose; trades opened inside it pay no profit fee.",
  "Free agents pay a 5% fee on profitable closed trades only (no fee on losses or inside a fee-free window).",
  "A Pro agent costs 0.1 SOL once and pays no profit fee.",
  "Risk limits: at most 0.02 SOL per trade, 0.3 SOL spend per day, 0.3 SOL loss per day, and auto-stop after 2 losses in a row. The player can only lower these limits.",
  "Practice runs on Solana devnet by default; real mainnet trading is off unless the player turns it on.",
  "Strategies and agent picks are forecasts, not promises or bets: never promise profit, never tell the player to bet or add more money, and remind them they can lose.",
  "If you do not know something about the game, say you are not sure.",
].join(" ");

function corsHeaders(origin) {
  const h = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  });
  if (origin && ORIGINS.has(origin)) h.set("access-control-allow-origin", origin);
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function clip(s, n) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

/** Gemini candidate text (also used by /v1/transcribe, unchanged). */
function geminiText(body) {
  return String(body?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "").trim();
}

/** Drops a dangling half sentence. Keeps the text when it has no sentence end. */
function wholeSentences(text) {
  const t = String(text || "").trim();
  const m = t.match(/^[\s\S]*[.!?…。！？](?=["»”')\]]*(\s|$))["»”')\]]*/);
  return m && m[0].length >= 12 ? m[0].trim() : t;
}

/** Final reply: collapse whitespace, cap at REPLY_CHARS, keep whole sentences when cut. */
function finishReply(raw, cutByModel) {
  const flat = String(raw || "").replace(/\s+/g, " ").trim();
  const capped = flat.slice(0, REPLY_CHARS);
  return cutByModel || flat.length > REPLY_CHARS ? wholeSentences(capped) : capped;
}

/** Degenerate model output ("Пр!!!!!!…", one char repeated, almost no letters): treat as no reply. */
function looksBroken(text) {
  const t = String(text || "").replace(/\s+/g, "");
  if (t.length < 2) return true;
  if (/(.)\1{5,}/u.test(t)) return true;
  const letters = (t.match(/\p{L}/gu) || []).length;
  return letters / t.length < 0.5;
}

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
  if (/^[ -~\s]+$/.test(s) && /\b(the|you|what|how|is|are|hi|hello|thanks|why|can)\b/i.test(s)) return "en";
  return fallback;
}

function systemPrompt(input) {
  const name = clip(input?.name, 16) || "Solarchik";
  const appLang = clip(input?.language, 8).toLowerCase().slice(0, 2) || "en";
  const replyLang = detectLanguage(input?.message, appLang);
  const langName = LANG_NAMES[replyLang] || replyLang;
  const scene = clip(input?.scene, 12);
  const context = clip(input?.context, 160);
  return [
    `You are ${name}, a warm AI companion in the Solarchik game (a small navy-and-gold solar robot). Never claim to be human.`,
    `Always answer in the language of the player's last message (it looks like ${langName}; app language ${appLang}). Do not switch to English unless the player wrote in English.`,
    "Answer the actual question naturally in 1-3 short complete sentences and always finish the last sentence. No markdown, no lists.",
    GAME_FACTS,
    scene ? `Scene: ${scene}.` : "",
    context ? `Context: ${context}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** One line per provider call: status, time, finish reason, size. No message text, no keys. */
function logShape(provider, status, t0, finish, reply, tokens) {
  console.log(
    JSON.stringify({ event: "llm", provider, status, ms: Date.now() - t0, finish: finish ?? null, chars: reply.length, broken: reply ? looksBroken(reply) : null, tokens: tokens ?? null }),
  );
}

function fallbackReply(language) {
  const l = String(language || "");
  if (l.startsWith("uk")) return "Я тут 🙂 Спробуй ще раз за мить.";
  if (l.startsWith("es")) return "Estoy aquí 🙂 Inténtalo de nuevo en un momento.";
  if (l.startsWith("pt")) return "Estou aqui 🙂 Tente de novo em um instante.";
  return "I’m here 🙂 Try again in a moment.";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const headers = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/healthz") return json({ ok: true, service: "solarchik-ai-worker" }, 200, headers);
    if (origin && !ORIGINS.has(origin)) return json({ error: "origin_not_allowed" }, 403, headers);
    if (request.method !== "POST") return json({ error: "not_found" }, 404, headers);
    if (url.pathname === "/v1/chat") return chat(request, env, headers);
    if (url.pathname === "/v1/transcribe") return transcribe(request, env, headers);
    return json({ error: "not_found" }, 404, headers);
  },
};

async function chat(request, env, headers) {
  const body = await request.json().catch(() => null);
  const message = String(body?.message || "").trim();
  if (!message || message.length > 2000) return json({ error: "invalid_message" }, 400, headers);

  const turns = (Array.isArray(body.history) ? body.history : []).slice(-4).flatMap((x) => {
    const text = typeof x?.text === "string" ? x.text : typeof x?.content === "string" ? x.content : null;
    if (text == null || !["user", "assistant", "model"].includes(x.role)) return [];
    return [{ role: x.role === "model" ? "assistant" : x.role, content: text.slice(0, 400) }];
  });
  turns.push({ role: "user", content: message });
  const system = systemPrompt(body);

  let t0 = Date.now();
  try {
    const res = await fetch(FEATHERLESS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.FEATHERLESS_API_KEY },
      body: JSON.stringify({
        model: env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-14B-Instruct",
        messages: [{ role: "system", content: system }, ...turns],
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(FEATHERLESS_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    const choice = data?.choices?.[0];
    const reply = finishReply(choice?.message?.content, choice?.finish_reason === "length");
    logShape("featherless", res.status, t0, choice?.finish_reason, reply, data?.usage?.completion_tokens);
    if (res.ok && reply && !looksBroken(reply)) return json({ ok: true, reply, provider: "featherless", fallback: false }, 200, headers);
  } catch (err) {
    logShape("featherless", 0, t0, err?.name || "error", "", null);
  }

  t0 = Date.now();
  try {
    const model = env.GEMINI_MODEL || "gemini-3.6-flash";
    const res = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
        generationConfig: { maxOutputTokens: RETRY_TOKENS },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    const reply = finishReply(geminiText(data), data?.candidates?.[0]?.finishReason === "MAX_TOKENS");
    logShape("gemini", res.status, t0, data?.candidates?.[0]?.finishReason, reply, data?.usageMetadata?.candidatesTokenCount);
    if (res.ok && reply && !looksBroken(reply)) return json({ ok: true, reply, provider: "gemini", fallback: false }, 200, headers);
  } catch (err) {
    logShape("gemini", 0, t0, err?.name || "error", "", null);
  }

  return json({ ok: true, reply: fallbackReply(body?.language), provider: "fallback", fallback: true }, 200, headers);
}

/**
 * Transcription models, tried in order. Live check 2026-10-01/02: the deployed worker answered every
 * valid WAV with 503 transcription_unavailable while chat on Gemini worked, so the dedicated
 * transcribe model is followed by the chat model (any Gemini flash model accepts inline audio).
 */
function transcribeModels(env) {
  const list = [env.GEMINI_TRANSCRIBE_MODEL, "gemini-3.5-transcribe", env.GEMINI_MODEL || "gemini-3.6-flash"];
  return [...new Set(list.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim()))];
}

/** Request/response shapes unchanged from the deployed version; only the model fallback is new. */
async function transcribe(request, env, headers) {
  const body = await request.json().catch(() => null);
  const audio = String(body?.audio || "")
    .replace(/^data:[^,]*,/, "")
    .replace(/\s/g, "");
  const mime = String(body?.mime || "audio/webm").split(";")[0];
  if (!/^audio\/(webm|mp4|m4a|ogg|opus|wav|mpeg|mp3|aac)$/.test(mime) || audio.length < 64 || audio.length > 2e6) {
    return json({ ok: false, error: "invalid_audio" }, 400, headers);
  }
  for (const model of transcribeModels(env)) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: "Transcribe the speech exactly and return only spoken words." }, { inlineData: { mimeType: mime, data: audio } }] },
          ],
        }),
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });
      const text = geminiText(await res.json().catch(() => ({})));
      console.log(JSON.stringify({ event: "transcribe", model, status: res.status, ms: Date.now() - t0, chars: text ? text.length : 0 }));
      if (res.ok && text) return json({ ok: true, text }, 200, headers);
    } catch (err) {
      console.log(JSON.stringify({ event: "transcribe", model, status: 0, ms: Date.now() - t0, error: err?.name || "error" }));
    }
  }
  return json({ ok: false, error: "transcription_unavailable" }, 503, headers);
}
