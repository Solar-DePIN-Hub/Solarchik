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
