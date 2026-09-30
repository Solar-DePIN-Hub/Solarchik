/**
 * Polygon EOA for Polymarket. Separate from the Solana room key.
 * The hex secret stays in this browser, AES-GCM wrapped. Never sent to a server.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";

const POLY_KEY = "solarchik.polygon-eoa.v1";
const WRAP_KEY = "solarchik.polygon-wrap.v1";

/** Old funded Polymarket EOA. Import of this secret still works. A new browser mints its own key. */
export const ROOM_POLYGON = "0x0f8f9947fe3bf77d108Afe79D51089210927922C";

type Stored = { version: 1; address: string; iv: string; cipher: string };

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

function bufToB64(buf: Uint8Array): string {
  let s = "";
  buf.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function wrapKey(): Promise<CryptoKey> {
  let rawHex = localStorage.getItem(WRAP_KEY);
  if (!rawHex) {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    rawHex = bytesToHex(raw);
    localStorage.setItem(WRAP_KEY, rawHex);
  }
  return crypto.subtle.importKey("raw", copyBytes(hexToBytes(rawHex)), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function persistHex(pk: `0x${string}`): Promise<string> {
  const account = privateKeyToAccount(pk);
  const wrap = await wrapKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrap,
    new TextEncoder().encode(pk),
  );
  const stored: Stored = {
    version: 1,
    address: account.address,
    iv: bufToB64(iv),
    cipher: bufToB64(new Uint8Array(cipher)),
  };
  localStorage.setItem(POLY_KEY, JSON.stringify(stored));
  return account.address;
}

export function peekPolygonAddress(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(POLY_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { address?: string };
    return typeof stored.address === "string" ? stored.address : null;
  } catch {
    return null;
  }
}

export async function loadPolygonAccount(): Promise<PrivateKeyAccount | null> {
  try {
    const raw = localStorage.getItem(POLY_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    if (!stored?.cipher || stored.version !== 1 || !stored.address) return null;
    const wrap = await wrapKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(stored.iv) },
      wrap,
      b64ToBytes(stored.cipher),
    );
    const pk = new TextDecoder().decode(plain) as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) return null;
    const account = privateKeyToAccount(pk);
    if (!sameAddr(account.address, stored.address)) return null;
    return account;
  } catch {
    return null;
  }
}

let minting: Promise<string> | null = null;

async function mintPolygon(): Promise<string> {
  for (let i = 0; i < 4; i += 1) {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const pk = `0x${bytesToHex(raw)}` as `0x${string}`;
    try {
      return await persistHex(pk);
    } catch {
      /* scalar was not on the curve */
    }
  }
  throw new Error("Ключ Polygon не створився");
}

/** First visit mints one EOA. A later visit reuses it. A cipher that will not open is not overwritten. */
export async function ensurePolygonAddress(): Promise<string> {
  if (minting) return minting;
  minting = (async () => {
    const account = await loadPolygonAccount();
    if (account) return account.address;
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(POLY_KEY);
    if (raw) {
      try {
        const stored = JSON.parse(raw) as Stored;
        if (stored?.address) return stored.address;
      } catch {
        /* leave the unreadable blob on disk */
      }
      throw new Error("Ключ Polygon не розшифрувався");
    }
    return mintPolygon();
  })().finally(() => {
    minting = null;
  });
  return minting;
}

export async function importPolygonSecret(text: string): Promise<string> {
  const raw = text.trim();
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("форма");
  const account = privateKeyToAccount(pk);
  await persistHex(pk);
  return account.address;
}

export async function revealPolygonSecret(): Promise<string> {
  const account = await loadPolygonAccount();
  if (!account) throw new Error("Ключа Polygon немає");
  const raw = localStorage.getItem(POLY_KEY);
  if (!raw) throw new Error("Ключа Polygon немає");
  const stored = JSON.parse(raw) as Stored;
  const wrap = await wrapKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(stored.iv) },
    wrap,
    b64ToBytes(stored.cipher),
  );
  return new TextDecoder().decode(plain);
}
