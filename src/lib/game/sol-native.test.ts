import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanReply, pcm16ToWav, pcmRate, replyFits, solLang, solSystemPrompt } from "./sol-native.server.ts";

test("language: uk/ua → uk, anything else → en", () => {
  assert.equal(solLang("uk"), "uk");
  assert.equal(solLang("uk-UA"), "uk");
  assert.equal(solLang("ua"), "uk");
  assert.equal(solLang("ru"), "en");
  assert.equal(solLang("de"), "en");
  assert.equal(solLang(undefined), "en");
});

test("a Ukrainian reply must be Cyrillic without stray English words", () => {
  assert.ok(replyFits("Привіт! Я тут, біжімо далі 🙂", "uk"));
  assert.ok(replyFits("Pro-агент коштує 0.1 SOL один раз.", "uk"));
  assert.ok(!replyFits("Let us soar! Один заряд лишився.", "uk"));
  assert.ok(!replyFits("Let us soar!", "uk"));
  assert.ok(!replyFits("Привет, как дела? Это ты?", "uk"));
  assert.ok(replyFits("Let's go, roof runner!", "en"));
  assert.ok(!replyFits("Привіт!", "en"));
  assert.ok(!replyFits("!!!!!!!!", "en"));
});

test("cleanReply strips markdown/quotes and keeps whole sentences", () => {
  assert.equal(cleanReply('"**Гей!** Тримайся."', 100), "Гей! Тримайся.");
  assert.equal(cleanReply("Перше речення тут. Друге речення дуже довге і не влізе", 30), "Перше речення тут.");
});

test("run scene prompt asks for one short line; the reply language is fixed", () => {
  const p = solSystemPrompt("uk", "run", "", "");
  assert.match(p, /ЛИШЕ українською/);
  assert.match(p, /ОДНЕ коротке/);
  assert.match(solSystemPrompt("en", "chat", "", ""), /ONLY in natural/);
});

test("PCM16 → WAV header", () => {
  const wav = pcm16ToWav(new Uint8Array(480), pcmRate("audio/L16;codec=pcm;rate=24000"));
  assert.equal(wav.length, 524);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 24000);
});

test("hedge: a hung first attempt is overtaken; early failures start the next attempt at once", async () => {
  const { hedge } = await import("./sol-native.server.ts");
  const order: string[] = [];
  const hang = (signal: AbortSignal) => new Promise<string | null>((r) => signal.addEventListener("abort", () => r(null)));
  const t0 = Date.now();
  const v = await hedge(
    [
      { hedgeMs: 0, run: (s) => (order.push("a"), hang(s)) },
      { hedgeMs: 50, run: async () => (order.push("b"), null) },
      { hedgeMs: 5000, run: async () => (order.push("c"), "ok") },
    ],
    2000,
  );
  assert.equal(v, "ok");
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(await hedge([{ hedgeMs: 0, run: async () => null }], 500), null);
});
