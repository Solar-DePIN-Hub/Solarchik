import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/solarchik-ai-friend.js";

const ENV = { FEATHERLESS_API_KEY: "test-f", GEMINI_API_KEY: "test-g" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Mocks upstream calls. `plan` items: {status, body} or "throw". Records every call. */
function upstream(plan) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const next = plan.shift() ?? "throw";
    if (next === "throw") throw new Error("network");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}

const featherless = (content, finish = "stop") => ({ body: { choices: [{ message: { content }, finish_reason: finish }] } });
const gemini = (text, finishReason = "STOP") => ({ body: { candidates: [{ content: { parts: [{ text }] }, finishReason }] } });

function req(path, { method = "POST", origin, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin) headers.Origin = origin;
  return new Request(`https://friend.solardepin.net${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function call(path, opts) {
  const res = await worker.fetch(req(path, opts), ENV);
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

test("healthz answers for any origin with the same body", async () => {
  const r = await call("/healthz", { method: "GET" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, service: "solarchik-ai-worker" });
  assert.equal((await call("/healthz", { method: "GET", origin: "https://evil.example" })).status, 200);
});

test("origins: allowlist echoes the origin, others 403, no Origin passes, preflight 204", async () => {
  upstream([featherless("Привіт! Я тут.")]);
  const ok = await call("/v1/chat", { origin: "https://solarchik-super-app.vercel.app", body: { message: "Привіт" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://solarchik-super-app.vercel.app");
  assert.equal(ok.headers.get("access-control-allow-methods"), "POST,OPTIONS");
  assert.equal(ok.headers.get("access-control-allow-headers"), "content-type");
  assert.equal(ok.headers.get("cache-control"), "no-store");

  const bad = await call("/v1/chat", { origin: "https://evil.example", body: { message: "hi" } });
  assert.equal(bad.status, 403);
  assert.deepEqual(bad.json, { error: "origin_not_allowed" });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);

  upstream([featherless("Hi there, friend.")]);
  assert.equal((await call("/v1/chat", { body: { message: "hi" } })).status, 200);
  upstream([featherless("Hi there, friend.")]);
  assert.equal((await call("/v1/chat", { origin: "https://appassets.androidplatform.net", body: { message: "hi" } })).status, 200);
  upstream([featherless("Hi there, friend.")]);
  assert.equal((await call("/v1/chat", { origin: "null", body: { message: "hi" } })).status, 200);

  const pre = await worker.fetch(req("/v1/chat", { method: "OPTIONS", origin: "https://friend.solardepin.net" }), ENV);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://friend.solardepin.net");
  assert.equal((await call("/v1/chat", { method: "GET" })).status, 404);
  assert.deepEqual((await call("/nope", { body: {} })).json, { error: "not_found" });
});

test("chat: game facts, language, 600 tokens, history with text or content", async () => {
  const calls = upstream([featherless("Серія росте щодня. Кожні 7 днів дають 48 годин без комісії.")]);
  const r = await call("/v1/chat", {
    body: {
      message: "Як працює серія?",
      language: "en",
      name: "Sol",
      history: [
        { role: "user", content: "Привіт" },
        { role: "assistant", text: "Привіт!" },
        { role: "system", text: "ignored" },
      ],
    },
  });
  assert.deepEqual(r.json, {
    ok: true,
    reply: "Серія росте щодня. Кожні 7 днів дають 48 годин без комісії.",
    provider: "featherless",
    fallback: false,
  });
  const sent = calls[0].body;
  assert.equal(sent.max_tokens, 600);
  assert.equal(sent.model, "Qwen/Qwen2.5-14B-Instruct");
  const sys = sent.messages[0].content;
  for (const fact of ["48-hour fee-free", "7-day fee-free", "5% fee", "0.1 SOL", "0.02 SOL", "2 losses in a row", "forecasts, not promises or bets", "Ukrainian", "You are Sol,"]) {
    assert.ok(sys.includes(fact), `missing: ${fact}`);
  }
  assert.deepEqual(
    sent.messages.slice(1).map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.equal(sent.messages[1].content, "Привіт");
});

test("chat: a reply cut by the token cap keeps whole sentences; cap 900 chars", async () => {
  upstream([featherless("Перше речення готове. Друге речення обірва", "length")]);
  assert.equal((await call("/v1/chat", { body: { message: "Розкажи" } })).json.reply, "Перше речення готове.");

  const long = "Це дуже довге речення про сонце і серію. ".repeat(40);
  upstream([featherless(long)]);
  const r = (await call("/v1/chat", { body: { message: "Розкажи" } })).json.reply;
  assert.ok(r.length <= 900);
  assert.ok(r.endsWith("."));
});

test("chat: Featherless fails -> Gemini with 800 tokens; both fail -> fallback line", async () => {
  const calls = upstream([{ status: 500, body: {} }, gemini("Pro costs 0.1 SOL once and pays no profit fee.")]);
  const r = await call("/v1/chat", { body: { message: "How much is Pro?", language: "en" } });
  assert.deepEqual(r.json, { ok: true, reply: "Pro costs 0.1 SOL once and pays no profit fee.", provider: "gemini", fallback: false });
  assert.equal(calls[1].body.generationConfig.maxOutputTokens, 800);
  assert.ok(calls[1].url.includes("/gemini-3.6-flash:generateContent?key=test-g"));

  upstream(["throw", "throw"]);
  const uk = await call("/v1/chat", { body: { message: "Привіт", language: "uk" } });
  assert.deepEqual(uk.json, { ok: true, reply: "Я тут 🙂 Спробуй ще раз за мить.", provider: "fallback", fallback: true });
  upstream(["throw", "throw"]);
  assert.equal((await call("/v1/chat", { body: { message: "hi" } })).json.reply, "I’m here 🙂 Try again in a moment.");
});

test("chat: degenerate Featherless output falls through to Gemini", async () => {
  upstream([featherless("Пр" + "!".repeat(80)), gemini("Pro коштує 0.1 SOL один раз.")]);
  const r = await call("/v1/chat", { body: { message: "Скільки коштує Pro?", language: "uk" } });
  assert.equal(r.json.provider, "gemini");
  assert.equal(r.json.reply, "Pro коштує 0.1 SOL один раз.");
  upstream([featherless("ааааааааааа"), gemini("!!!!!!!!")]);
  assert.equal((await call("/v1/chat", { body: { message: "Привіт", language: "uk" } })).json.provider, "fallback");
});

test("chat: invalid message is 400 invalid_message", async () => {
  assert.deepEqual((await call("/v1/chat", { body: { message: "  " } })).json, { error: "invalid_message" });
  assert.equal((await call("/v1/chat", { body: "not json" })).status, 400);
  assert.equal((await call("/v1/chat", { body: { message: "x".repeat(2001) } })).status, 400);
});

test("transcribe: same shapes as the deployed worker", async () => {
  const bad = await call("/v1/transcribe", { body: {} });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json, { ok: false, error: "invalid_audio" });
  assert.equal((await call("/v1/transcribe", { body: { audio: "A".repeat(100), mime: "video/mp4" } })).status, 400);

  const calls = upstream([gemini("hello sol")]);
  const ok = await call("/v1/transcribe", { body: { audio: "data:audio/webm;base64," + "A".repeat(100), mime: "audio/webm;codecs=opus" } });
  assert.deepEqual(ok.json, { ok: true, text: "hello sol" });
  assert.ok(calls[0].url.includes("/gemini-3.5-transcribe:generateContent"));
  assert.equal(calls[0].body.contents[0].parts[1].inlineData.mimeType, "audio/webm");

  // dedicated model fails (404 / empty) -> the chat model transcribes
  const fb = upstream([{ status: 404, body: { error: { code: 404 } } }, gemini("fallback words")]);
  const ok2 = await call("/v1/transcribe", { body: { audio: "A".repeat(100), mime: "audio/wav" } });
  assert.deepEqual(ok2.json, { ok: true, text: "fallback words" });
  assert.equal(fb.length, 2);
  assert.ok(fb[0].url.includes("/gemini-3.5-transcribe:generateContent"));
  assert.ok(fb[1].url.includes("/gemini-3.6-flash:generateContent"));

  upstream(["throw", "throw"]);
  const down = await call("/v1/transcribe", { body: { audio: "A".repeat(100) } });
  assert.equal(down.status, 503);
  assert.deepEqual(down.json, { ok: false, error: "transcription_unavailable" });
});
