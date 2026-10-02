import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { translateText } from "./work-translate.ts";

const CYR = /[А-Яа-яІіЇїЄєҐґ]/;
const root = new URL("../../../", import.meta.url);
const workDir = new URL("src/components/work/", root);
const agentsDir = new URL("src/lib/agents/", root);
/** Files whose Ukrainian is mostly model prompts: only lines that hand text back to the player are checked. */
const PROMPT_FILES = new Set(["decide.server.ts", "coach.server.ts", "weex.server.ts", "shift.server.ts"]);
const files = [
  ...readdirSync(workDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => new URL(f, workDir)),
  // Every agent module: its notices, refusals and log lines reach the desk.
  ...readdirSync(agentsDir)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .map((f) => new URL(f, agentsDir)),
];

function playerLines(src: string, file: string): string {
  if (!PROMPT_FILES.has(file)) return src;
  return src
    .split("\n")
    .filter((line) => /error:|why:|reply:|return |reason:|notice:/.test(line))
    .join("\n");
}

/** Ukrainian literals and JSX text the Work desk can show (template holes split out). */
function phrases(src: string, jsx = true): string[] {
  const out: string[] = [];
  const re = /"([^"\n]*[А-Яа-яІіЇїЄєҐґ][^"\n]*)"|`([^`\n]*[А-Яа-яІіЇїЄєҐґ][^`\n]*)`|[>}]([^<>{}"`;=]*[А-Яа-яІіЇїЄєҐґ][^<>{}"`;=]*)[<{]/g;
  for (const m of src.matchAll(re)) {
    if (!jsx && m[3] != null) continue;
    const lit = (m[1] ?? m[2] ?? m[3]).replace(/\s+/g, " ").trim();
    if (/\.includes\(/.test(lit)) continue;
    for (const part of lit.split(/\$\{[^}]*\}/)) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

test("every Ukrainian Work desk phrase has an English swap (es/pt/de/ja/en players)", () => {
  const missing: string[] = [];
  for (const f of files) {
    const name = f.pathname.split("/").pop() ?? "";
    for (const p of phrases(playerLines(readFileSync(f, "utf8"), name), name.endsWith(".tsx"))) {
      if (CYR.test(translateText(p))) missing.push(`${f.pathname.split("/src/")[1]}: ${p}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("swaps whole words only and keeps surrounding text", () => {
  assert.equal(translateText("Кредит арбу 0.003 SOL. Треба від 0.005 SOL."), "Arb credit 0.003 SOL. Needs at least 0.005 SOL.");
  assert.equal(translateText("  Перенести в колекцію сервера "), "  Move to server collection ");
  assert.equal(translateText("с"), "s");
  assert.equal(translateText("Кредитор"), "Кредитор");
});

test("composed desk lines come out fully English (arb, listing lock, judges steps, verify)", () => {
  const lines = [
    "SOL/USDC 119.6000/119.6100 · Jupiter 119.6082/119.5969 · 5 пар. Чистий край -14.7 bps, поріг 50. Край замалий.",
    "СИМУЛЯЦІЯ · SOL/USDC 1/2 · Titan 1/2 · 24 пар. B: купити SOL через Titan, продати на Backpack. Чистий край 61.0 bps. Нога 0.005000 SOL.",
    "Виставити можна після 480 год живої зміни. Зараз 0 / 480.",
    " год стартує знову).",
    "перераховано в браузері з ",
    "Events 2д on",
    "ШІ не відповів (Grok 503, Gemini теж). Ставку не відкриваю.",
    "Gemini · Up looks stronger · ставка 0.01",
    "Не беру: впевненість 40%. Gemini sees no edge.",
  ];
  for (const l of lines) assert.doesNotMatch(translateText(l), CYR, `${l} -> ${translateText(l)}`);
  assert.equal(translateText("Events 2д on"), "Events 2d on");
});
