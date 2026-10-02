import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { struct, u32, ns64, u8, s32 } from "@solana/buffer-layout";
import { SolBuffer } from "./polyfill.ts";

// Live bug (Oct 2026): in the browser "Take and work" failed with "writeUIntLE is not a function"
// because the Buffer shim lacked the Node integer API that @solana/buffer-layout uses.
describe("browser Buffer shim", () => {
  it("encodes the SystemProgram.transfer layout byte-for-byte like Node Buffer", () => {
    const layout = struct<{ instruction: number; lamports: number }>([u32("instruction"), ns64("lamports")]);
    const a = SolBuffer.alloc(layout.span);
    const b = Buffer.alloc(layout.span);
    layout.encode({ instruction: 2, lamports: 123456789012 } as never, a as never);
    layout.encode({ instruction: 2, lamports: 123456789012 } as never, b);
    assert.deepEqual([...a], [...b]);
    assert.equal((layout.decode(a as never) as { instruction: number }).instruction, 2);
  });

  it("matches Node for variable-width and signed integers", () => {
    for (const [v, n] of [[0, 1], [255, 1], [65535, 2], [16777215, 3], [4294967295, 4], [2 ** 40 + 7, 6]] as const) {
      const a = SolBuffer.alloc(8);
      const b = Buffer.alloc(8);
      a.writeUIntLE(v, 1, n);
      b.writeUIntLE(v, 1, n);
      assert.deepEqual([...a], [...b]);
      assert.equal(a.readUIntLE(1, n), b.readUIntLE(1, n));
      a.writeUIntBE(v, 1, n);
      b.writeUIntBE(v, 1, n);
      assert.deepEqual([...a], [...b]);
      assert.equal(a.readUIntBE(1, n), b.readUIntBE(1, n));
    }
    for (const [v, n] of [[-1, 1], [-128, 1], [-300, 2], [-8388608, 3], [-5, 4], [-(2 ** 40), 6]] as const) {
      const a = SolBuffer.alloc(8);
      const b = Buffer.alloc(8);
      a.writeIntLE(v, 0, n);
      b.writeIntLE(v, 0, n);
      assert.deepEqual([...a], [...b]);
      assert.equal(a.readIntLE(0, n), v);
    }
    const layout = struct<{ x: number; y: number }>([u8("x"), s32("y")]);
    const c = SolBuffer.alloc(layout.span);
    layout.encode({ x: 9, y: -42 }, c as never);
    assert.deepEqual(layout.decode(c as never), { x: 9, y: -42 });
  });

  it("supports 64-bit, float and helper methods", () => {
    const a = SolBuffer.alloc(16);
    a.writeBigUInt64LE(2n ** 63n + 5n, 0);
    a.writeDoubleLE(1.5, 8);
    assert.equal(a.readBigUInt64LE(0), 2n ** 63n + 5n);
    assert.equal(a.readDoubleLE(8), 1.5);
    assert.ok(a.slice(0, 8) instanceof SolBuffer);
    assert.ok(SolBuffer.from([1, 2]).equals(Uint8Array.from([1, 2])));
    assert.deepEqual(SolBuffer.from([3]).toJSON(), { type: "Buffer", data: [3] });
  });
});

describe("browser Buffer shim covers every method @solana/buffer-layout calls", () => {
  it("has each read/write method referenced by Layout.js", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../node_modules/@solana/buffer-layout/lib/Layout.js", import.meta.url), "utf8");
    const used = new Set([...src.matchAll(/\.((?:read|write)(?:U?Int|Float|Double)[A-Za-z0-9]*)\(/g)].map((m) => m[1]));
    assert.ok(used.size > 10);
    for (const name of used) assert.equal(typeof (SolBuffer.prototype as never)[name], "function", name);
  });
});

describe("browser Buffer shim: Buffer.from(arrayBuffer, offset, length)", () => {
  // Live bug (Oct 2026): the co-signed mint (1057 bytes) became 1585 bytes after the browser signed it,
  // "VersionedTransaction too large", because web3.js toBuffer() passes (arr.buffer, byteOffset, byteLength).
  it("returns only the window, like Node", () => {
    const backing = new Uint8Array(64).map((_, i) => i);
    const view = backing.subarray(10, 20);
    const a = SolBuffer.from(view.buffer, view.byteOffset, view.byteLength);
    const b = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    assert.equal(a.length, 10);
    assert.deepEqual([...a], [...b]);
    assert.deepEqual([...SolBuffer.from(view.buffer, 60)], [...Buffer.from(view.buffer, 60)]);
    assert.equal(SolBuffer.from(view.buffer).length, 64);
  });

  it("keeps a web3.js toBuffer() round trip the same size", () => {
    const toBuffer = (arr: Uint8Array) => SolBuffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const big = new Uint8Array(2048);
    big.set([1, 2, 3, 4], 0);
    const serialized = big.slice(0, 1057);
    assert.equal(toBuffer(big.subarray(0, 1057)).length, 1057);
    assert.equal(toBuffer(serialized).length, 1057);
  });
});

describe("browser Buffer shim: from(arrayBuffer) shares memory like Node", () => {
  it("writes through the view land in the original array (buffer-layout Blob.encode)", () => {
    const target = new Uint8Array(16);
    const view = SolBuffer.from(target.buffer, target.byteOffset, target.length);
    view.write("0a0b0c", 2, 3, "hex");
    assert.deepEqual([...target.subarray(0, 6)], [0, 0, 10, 11, 12, 0]);
  });
});

describe("browser Buffer shim: isBuffer", () => {
  it("is true only for shim Buffers, so web3.js toBuffer() converts plain Uint8Arrays", () => {
    assert.equal(SolBuffer.isBuffer(new Uint8Array(4)), false);
    assert.equal(SolBuffer.isBuffer(SolBuffer.alloc(4)), true);
    const u = Uint8Array.from([3, 125, 251]);
    const asBuf = SolBuffer.isBuffer(u) ? u : SolBuffer.from(u.buffer, u.byteOffset, u.byteLength);
    assert.equal(asBuf.toString("base64"), Buffer.from(u).toString("base64"));
  });
});
