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

function extractText(body) {
  const c = body?.choices?.[0];
  const msg = c?.message;
  let raw = "";
  if (typeof msg?.content === "string") raw = msg.content;
  else if (Array.isArray(msg?.content)) raw = msg.content.map((p) => p?.text || p?.content || "").join("");
  else if (typeof c?.text === "string") raw = c.text;
  else if (typeof body?.output_text === "string") raw = body.output_text;
  return clip(raw, 420);
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

function systemPrompt(input) {
  const name = clip(input.name, 16) || "Solarchik";
  const scene = clip(input.scene, 12);
  const lang = clip(input.language, 8) || "en";
  return [
    `You are ${name}, a small navy-and-gold solar robot with a gold visor and cyan eyes.`,
    `You are the player's pocket friend in Solarchik CLOCK IN. Never a battery, egg, Tamagotchi, AI, Gemini, Grok, or chatbot.`,
    `Reply in the same language as the player (fallback ${lang}). 1-2 complete spoken sentences. No markdown, no lists.`,
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

    const language = clip(input.language, 8) || "en";
    const playerId = clip(input.playerId, 80) || crypto.randomUUID();
    const conversationId = clip(input.conversationId, 80) || crypto.randomUUID();
    const historyIn = Array.isArray(input.history) ? input.history.slice(-4) : [];
    const history = [];
    for (const row of historyIn) {
      const role = row?.role === "assistant" || row?.role === "buddy" ? "assistant" : "user";
      const content = clip(row?.content || row?.text, 400);
      if (content) history.push({ role, content });
    }

    const messages = [{ role: "system", content: systemPrompt({ ...input, language }) }, ...history, { role: "user", content: message }];

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
  let r = await callFeatherless(env, messages, PRIMARY, 120, 0);
  if (r.kind === "ok") return { text: r.text, provider: "featherless", fallback: false };

  const retryable = new Set(["no_choice", "empty_content", "length", "http_500", "http_502", "http_503", "http_429", "http_0"]);
  if (retryable.has(r.kind) || r.kind.startsWith("http_5") || r.kind.startsWith("http_429")) {
    await sleep(300);
    r = await callFeatherless(env, slimMessages(messages), PRIMARY, 160, 1);
    if (r.kind === "ok") return { text: r.text, provider: "featherless", fallback: false };
    r = await callFeatherless(env, slimMessages(messages), SECONDARY, 120, 2);
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
    return { kind, text: extractText(body) };
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
        generationConfig: { maxOutputTokens: 140, temperature: 0.7 },
      }),
    });
    const body = await res.json().catch(() => null);
    const parts = body?.candidates?.[0]?.content?.parts || [];
    const text = clip(parts.map((p) => p?.text || "").join(" "), 420);
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
