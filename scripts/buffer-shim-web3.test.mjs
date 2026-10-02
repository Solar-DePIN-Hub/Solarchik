// Live bugs (Oct 2026): with the browser Buffer shim, "Take and work" failed first with
// "writeUIntLE is not a function", then with "VersionedTransaction too large" (Buffer.from(arrayBuffer, off, len)
// copied the whole buffer instead of returning a shared view). This bundles the real web3.js browser build with
// `buffer` -> src/polyfill.ts (as vite.config.ts does) and runs a transaction round trip with Node's Buffer removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

test("web3.js browser bundle serializes and re-signs transactions with the Buffer shim", async () => {
  const out = mkdtempSync(join(tmpdir(), "shim-web3-"));
  try {
    await build({
      root,
      configFile: false,
      publicDir: false,
      logLevel: "error",
      resolve: { alias: { buffer: join(root, "src/polyfill.ts") }, conditions: ["browser"], mainFields: ["browser", "module", "main"] },
      build: { outDir: out, emptyOutDir: true, minify: false, lib: { entry: join(root, "scripts/fixtures/shim-web3-entry.js"), formats: ["es"], fileName: "bundle" } },
    });
    const code = `delete globalThis.Buffer; const m = await import(${JSON.stringify(join(out, "bundle.js"))}); console.log(JSON.stringify(m.run()));`;
    const res = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" }).trim().split("\n").pop());
    assert.equal(res.shim, true, "ran on the shim, not Node Buffer");
    assert.equal(res.payerKept, true);
    assert.equal(res.signed, true);
    assert.equal(res.afterSign, res.first, "re-signing must not change the size");
    assert.ok(res.first > 300 && res.first <= 1232, `fits a packet (${res.first})`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
