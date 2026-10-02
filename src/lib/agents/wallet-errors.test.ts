import { test } from "node:test";
import assert from "node:assert/strict";
import { declined, reasonOf } from "./wallet-errors.ts";

test("declined spots wallet refusals", () => {
  assert.equal(declined({ code: 4001, message: "x" }), true);
  assert.equal(declined(new Error("User rejected the request.")), true);
  assert.equal(declined("Transaction cancelled"), true);
  assert.equal(declined(new Error("fetch failed")), false);
  assert.equal(declined(undefined), false);
});

test("reasonOf trims any thrown value", () => {
  assert.equal(reasonOf(new Error("  RPC\n down ")), "RPC down");
  assert.equal(reasonOf(null), "");
  assert.equal(reasonOf("x".repeat(300)).length, 160);
});

test("chain errors become one actionable line (no raw web3 text)", async () => {
  const { chainErrorText, NO_SOL_REASON } = await import("./wallet-errors.ts");
  assert.equal(chainErrorText(new Error("Simulation failed. Message: Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.. Logs: []")), NO_SOL_REASON);
  assert.equal(chainErrorText(new Error("custom program error: 0x1")), NO_SOL_REASON);
  assert.match(chainErrorText(new Error("429 Too Many Requests")), /перевантажений/);
  assert.match(chainErrorText(new Error("Blockhash not found")), /не встигла/);
  assert.match(chainErrorText(new Error("User rejected the request")), /відхилено/);
  assert.equal(chainErrorText(new Error("weird")), "Транзакція не пройшла на Devnet.");
});
