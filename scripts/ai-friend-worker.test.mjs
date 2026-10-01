import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/solarchik-ai-friend.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(replies) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    const next = replies.shift() ?? { content: "", finish: "stop" };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: next.content }, finish_reason: next.finish }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return calls;
}

async function ask(message, language = "en") {
  const req = new Request("https://friend.solardepin.net/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "https://appassets.androidplatform.net" },
    body: JSON.stringify({ message, language, playerId: "p1" }),
  });
  const res = await worker.fetch(req, { FEATHERLESS_API_KEY: "test-key" });
  return res.json();
}

test("system prompt carries the game facts and a token budget that fits Ukrainian", async () => {
  const calls = stub([{ content: "Привіт! Серія росте щодня.", finish: "stop" }]);
  const out = await ask("Привіт, як працює серія?", "en");
  assert.equal(out.reply, "Привіт! Серія росте щодня.");
  const sys = calls[0].body.messages[0].content;
  for (const fact of ["48-hour fee-free", "7-day fee-free", "5% fee", "0.1 SOL", "0.02 SOL", "2 losses in a row", "forecasts, not promises or bets"]) {
    assert.ok(sys.includes(fact), `missing fact: ${fact}`);
  }
  assert.ok(sys.includes("Ukrainian"), "detects the player's language from the message");
  assert.ok(calls[0].body.max_tokens >= 400);
});

test("a reply cut by the token cap keeps whole sentences only", async () => {
  stub([{ content: "Перше речення готове. Друге речення обірва", finish: "length" }]);
  const out = await ask("Розкажи про комісію", "uk");
  assert.equal(out.reply, "Перше речення готове.");
});

test("Spanish message gets a Spanish reply instruction and canned fallback", async () => {
  const calls = stub([]);
  const out = await ask("Hola, ¿cómo funciona Pro?", "en");
  assert.ok(calls[0].body.messages[0].content.includes("Spanish"));
  assert.equal(out.fallback, true);
  assert.equal(out.reply, "Sigo aquí, con el sol en el bolsillo.");
});
