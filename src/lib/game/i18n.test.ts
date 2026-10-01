import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LOCALES, t, type MsgKey } from "./i18n.ts";

const src = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");
const keys = [...src.slice(src.indexOf("const EN = {"), src.indexOf("export type MsgKey")).matchAll(/^\s+"([^"]+)":/gm)].map(
  (m) => m[1] as MsgKey,
);
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every locale fills every key with the same placeholders", () => {
  assert.ok(keys.length > 300);
  const bad: string[] = [];
  for (const loc of LOCALES) {
    for (const k of keys) {
      const en = t("en", k);
      const v = t(loc, k);
      if (!v.trim()) bad.push(`${loc} empty ${k}`);
      if (holes(v) !== holes(en)) bad.push(`${loc} placeholders ${k}`);
      if (loc !== "uk" && /[А-Яа-яІіЇїЄєҐґ]/.test(v)) bad.push(`${loc} Cyrillic ${k}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("game screens have no hard-coded Ukrainian outside the dictionary", () => {
  const dir = new URL("../../components/game/", import.meta.url);
  const hits: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
    const lines = readFileSync(new URL(f, dir), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/[А-Яа-яІіЇїЄєҐґ]{3,}/.test(line) && !line.includes('locale === "uk"')) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("unknown locale falls back to English and fills variables", () => {
  assert.equal(t("xx", "urgency.kept", { n: 3 }), t("en", "urgency.kept", { n: 3 }));
  assert.ok(t("uk", "urgency.kept", { n: 3 }).includes("3"));
});
