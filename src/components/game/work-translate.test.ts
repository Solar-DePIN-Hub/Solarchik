import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { translateText } from "./work-translate.ts";

const CYR = /[А-Яа-яІіЇїЄєҐґ]/;
const root = new URL("../../../", import.meta.url);
const workDir = new URL("src/components/work/", root);
const files = [
  ...readdirSync(workDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => new URL(f, workDir)),
  ...["store.ts", "chain.ts", "arb-guard.server.ts", "mint.server.ts", "payments.server.ts", "mint-rules.ts", "payment-rules.ts", "positions.server.ts", "positions-ledger.server.ts", "position-rules.ts", "strategy-spec.ts", "strategy.server.ts", "strategy-client.ts", "strategy-chain.server.ts", "faucet.server.ts"].map(
    (f) => new URL(`src/lib/agents/${f}`, root),
  ),
];

/** Ukrainian literals and JSX text the Work desk can show (template holes split out). */
function phrases(src: string): string[] {
  const out: string[] = [];
  const re = /"([^"\n]*[А-Яа-яІіЇїЄєҐґ][^"\n]*)"|`([^`\n]*[А-Яа-яІіЇїЄєҐґ][^`\n]*)`|>([^<>{}]*[А-Яа-яІіЇїЄєҐґ][^<>{}]*)[<{]/g;
  for (const m of src.matchAll(re)) {
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
    for (const p of phrases(readFileSync(f, "utf8"))) {
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
