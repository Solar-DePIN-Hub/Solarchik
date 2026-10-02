import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseUrl } from "./database-url.mjs";

test("DATABASE_URL wins over the Neon integration names", () => {
  assert.deepEqual(resolveDatabaseUrl({ DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" }), { url: "postgres://a", key: "DATABASE_URL" });
});

test("falls back to POSTGRES_URL (Vercel Neon integration) and skips blanks", () => {
  assert.deepEqual(resolveDatabaseUrl({ DATABASE_URL: "  ", POSTGRES_URL: " postgres://b " }), { url: "postgres://b", key: "POSTGRES_URL" });
  assert.deepEqual(resolveDatabaseUrl({ NEON_DATABASE_URL: "postgres://c" }), { url: "postgres://c", key: "NEON_DATABASE_URL" });
});

test("nothing set means no database", () => {
  assert.equal(resolveDatabaseUrl({}), undefined);
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "" }), undefined);
});
