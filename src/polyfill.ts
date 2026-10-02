/* eslint-disable @typescript-eslint/ban-ts-comment -- untyped Buffer shim kept as plain JS */
// @ts-nocheck
// Browser Buffer shim. On Node the real Buffer is already present.

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function asBytes(input: unknown, encoding?: string): Uint8Array {
  if (typeof input === "string") {
    if (encoding === "hex") {
      const clean = input.length % 2 ? `0${input}` : input;
      const out = new Uint8Array(clean.length / 2);
      for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    if (encoding === "base64") {
      const bin = atob(input);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    }
    return textEncoder.encode(input);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Uint8Array.from(input as number[]);
  return new Uint8Array();
}

class SolBuffer extends Uint8Array {
  static poolSize = 8192;
  static isBuffer(value: unknown): boolean {
    // Only real shim Buffers. web3.js toBuffer() returns "Buffers" as-is and then calls .toString("base64");
    // a plain Uint8Array there serialized as "3,125,251,..." (sendTransaction: "too large").
    return value instanceof SolBuffer;
  }
  static isEncoding(): boolean {
    return true;
  }
  static byteLength(input: unknown, encoding?: string): number {
    return asBytes(input, encoding).length;
  }
  static alloc(size: number, fill = 0): SolBuffer {
    const out = new SolBuffer(size);
    out.fill(fill);
    return out;
  }
  static allocUnsafe(size: number): SolBuffer {
    return new SolBuffer(size);
  }
  static allocUnsafeSlow(size: number): SolBuffer {
    return new SolBuffer(size);
  }
  static compare(a: Uint8Array, b: Uint8Array): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
    }
    return a.length - b.length;
  }
  static concat(list: Uint8Array[], total?: number): SolBuffer {
    const size = total ?? list.reduce((sum, item) => sum + item.length, 0);
    const out = new SolBuffer(size);
    let offset = 0;
    for (const item of list) {
      out.set(item.subarray(0, Math.max(0, size - offset)), offset);
      offset += item.length;
      if (offset >= size) break;
    }
    return out;
  }
  static from(input: unknown, encodingOrOffset?: string | number, length?: number): SolBuffer {
    // Node: Buffer.from(arrayBuffer[, byteOffset[, length]]) is a VIEW sharing that memory, not a copy.
    // web3.js toBuffer() and @solana/buffer-layout (Blob.encode writes through it) rely on both the
    // window and the sharing; a copy bloated or zeroed every serialized transaction in the browser.
    if (input instanceof ArrayBuffer) {
      const start = typeof encodingOrOffset === "number" ? encodingOrOffset : 0;
      const len = length === undefined ? input.byteLength - start : length;
      return new SolBuffer(input, start, len);
    }
    const bytes = asBytes(input, typeof encodingOrOffset === "string" ? encodingOrOffset : undefined);
    const out = new SolBuffer(bytes.length);
    out.set(bytes);
    return out;
  }

  toString(encoding?: string): string {
    if (encoding === "hex") return [...this].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (encoding === "base64") {
      let raw = "";
      this.forEach((b) => {
        raw += String.fromCharCode(b);
      });
      return btoa(raw);
    }
    return textDecoder.decode(this);
  }

  copy(target: Uint8Array, targetStart = 0, start = 0, end = this.length): number {
    const slice = this.subarray(start, end);
    target.set(slice, targetStart);
    return slice.length;
  }

  write(value: string, offset = 0, length?: number, encoding?: string): number {
    const bytes = asBytes(value, encoding);
    const n = Math.min(length ?? bytes.length, bytes.length, this.length - offset);
    this.set(bytes.subarray(0, n), offset);
    return n;
  }

  private view(): DataView {
    return new DataView(this.buffer, this.byteOffset, this.byteLength);
  }
  readUInt8(offset = 0): number {
    return this.view().getUint8(offset);
  }
  readUInt16LE(offset = 0): number {
    return this.view().getUint16(offset, true);
  }
  readUInt32LE(offset = 0): number {
    return this.view().getUint32(offset, true);
  }
  writeUInt8(value: number, offset = 0): number {
    this.view().setUint8(offset, value);
    return offset + 1;
  }
  writeUInt16LE(value: number, offset = 0): number {
    this.view().setUint16(offset, value, true);
    return offset + 2;
  }
  writeUInt32LE(value: number, offset = 0): number {
    this.view().setUint32(offset, value, true);
    return offset + 4;
  }
  // Node Buffer integer API used by @solana/buffer-layout (SystemProgram.transfer, mints) and borsh.
  readUInt16BE(offset = 0): number {
    return this.view().getUint16(offset, false);
  }
  readUInt32BE(offset = 0): number {
    return this.view().getUint32(offset, false);
  }
  readInt8(offset = 0): number {
    return this.view().getInt8(offset);
  }
  readInt16LE(offset = 0): number {
    return this.view().getInt16(offset, true);
  }
  readInt32LE(offset = 0): number {
    return this.view().getInt32(offset, true);
  }
  readInt32BE(offset = 0): number {
    return this.view().getInt32(offset, false);
  }
  writeUInt16BE(value: number, offset = 0): number {
    this.view().setUint16(offset, value, false);
    return offset + 2;
  }
  writeUInt32BE(value: number, offset = 0): number {
    this.view().setUint32(offset, value, false);
    return offset + 4;
  }
  writeInt8(value: number, offset = 0): number {
    this.view().setInt8(offset, value);
    return offset + 1;
  }
  writeInt16LE(value: number, offset = 0): number {
    this.view().setInt16(offset, value, true);
    return offset + 2;
  }
  writeInt32LE(value: number, offset = 0): number {
    this.view().setInt32(offset, value, true);
    return offset + 4;
  }
  writeInt32BE(value: number, offset = 0): number {
    this.view().setInt32(offset, value, false);
    return offset + 4;
  }
  readUIntLE(offset: number, byteLength: number): number {
    let val = 0;
    let mul = 1;
    for (let i = 0; i < byteLength; i += 1) {
      val += this[offset + i] * mul;
      mul *= 0x100;
    }
    return val;
  }
  readUIntBE(offset: number, byteLength: number): number {
    let val = 0;
    for (let i = 0; i < byteLength; i += 1) val = val * 0x100 + this[offset + i];
    return val;
  }
  readIntLE(offset: number, byteLength: number): number {
    const val = this.readUIntLE(offset, byteLength);
    const limit = 2 ** (8 * byteLength - 1);
    return val >= limit ? val - limit * 2 : val;
  }
  readIntBE(offset: number, byteLength: number): number {
    const val = this.readUIntBE(offset, byteLength);
    const limit = 2 ** (8 * byteLength - 1);
    return val >= limit ? val - limit * 2 : val;
  }
  writeUIntLE(value: number, offset: number, byteLength: number): number {
    let v = Math.floor(value);
    for (let i = 0; i < byteLength; i += 1) {
      this[offset + i] = v % 0x100;
      v = Math.floor(v / 0x100);
    }
    return offset + byteLength;
  }
  writeUIntBE(value: number, offset: number, byteLength: number): number {
    let v = Math.floor(value);
    for (let i = byteLength - 1; i >= 0; i -= 1) {
      this[offset + i] = v % 0x100;
      v = Math.floor(v / 0x100);
    }
    return offset + byteLength;
  }
  writeIntLE(value: number, offset: number, byteLength: number): number {
    const v = value < 0 ? value + 2 ** (8 * byteLength) : value;
    return this.writeUIntLE(v, offset, byteLength);
  }
  writeIntBE(value: number, offset: number, byteLength: number): number {
    const v = value < 0 ? value + 2 ** (8 * byteLength) : value;
    return this.writeUIntBE(v, offset, byteLength);
  }
  readBigUInt64LE(offset = 0): bigint {
    return this.view().getBigUint64(offset, true);
  }
  readBigInt64LE(offset = 0): bigint {
    return this.view().getBigInt64(offset, true);
  }
  writeBigUInt64LE(value: bigint, offset = 0): number {
    this.view().setBigUint64(offset, BigInt(value), true);
    return offset + 8;
  }
  writeBigInt64LE(value: bigint, offset = 0): number {
    this.view().setBigInt64(offset, BigInt(value), true);
    return offset + 8;
  }
  readFloatLE(offset = 0): number {
    return this.view().getFloat32(offset, true);
  }
  readDoubleLE(offset = 0): number {
    return this.view().getFloat64(offset, true);
  }
  writeFloatLE(value: number, offset = 0): number {
    this.view().setFloat32(offset, value, true);
    return offset + 4;
  }
  writeDoubleLE(value: number, offset = 0): number {
    this.view().setFloat64(offset, value, true);
    return offset + 8;
  }
  readFloatBE(offset = 0): number {
    return this.view().getFloat32(offset, false);
  }
  readDoubleBE(offset = 0): number {
    return this.view().getFloat64(offset, false);
  }
  writeFloatBE(value: number, offset = 0): number {
    this.view().setFloat32(offset, value, false);
    return offset + 4;
  }
  writeDoubleBE(value: number, offset = 0): number {
    this.view().setFloat64(offset, value, false);
    return offset + 8;
  }
  equals(other: Uint8Array): boolean {
    return SolBuffer.compare(this, other) === 0;
  }
  slice(start?: number, end?: number): SolBuffer {
    return this.subarray(start, end) as SolBuffer;
  }
  toJSON(): { type: "Buffer"; data: number[] } {
    return { type: "Buffer", data: [...this] };
  }
}

const g = globalThis as typeof globalThis & { Buffer?: typeof SolBuffer; global?: typeof globalThis };
// Server (Node / Vercel functions): `buffer` is aliased here for every build, so hand back the real
// Node Buffer. The shim lacks writeUIntLE & co., which broke web3.js SystemProgram.transfer on the server.
const Impl: typeof SolBuffer = typeof g.Buffer === "undefined" ? SolBuffer : g.Buffer;
if (typeof g.Buffer === "undefined") g.Buffer = SolBuffer;
g.global = g;

export { Impl as Buffer, SolBuffer };
export default Impl;
