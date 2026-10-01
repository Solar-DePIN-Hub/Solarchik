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
    return value instanceof Uint8Array;
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
  static from(input: unknown, encoding?: string): SolBuffer {
    const bytes = asBytes(input, encoding);
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
}

const g = globalThis as typeof globalThis & { Buffer?: typeof SolBuffer; global?: typeof globalThis };
if (typeof g.Buffer === "undefined") g.Buffer = SolBuffer;
g.global = g;

export { SolBuffer as Buffer };
export default SolBuffer;
