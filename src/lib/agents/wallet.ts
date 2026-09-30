/**
 * Non-custodial Solana keypair.
 * 64-byte secret stays in this browser, AES-GCM wrapped. Never sent to a server.
 */
import { Keypair } from "@solana/web3.js";
import { decodeBase58, encodeBase58 } from "./base58";
import type { WalletRecord } from "./types";

const WALLET_KEY = "solarchik.agent-wallet.v2";
const MARKET_KEY = "solarchik.market-wallet.v2";
const WRAP_KEY = "solarchik.agent-wrap.v1";

type StoredWallet = {
  version: 2;
  pubkey: string;
  createdAt: number;
  iv: string;
  cipher: string;
};

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => {
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

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function deviceWrappingKey(): Promise<CryptoKey> {
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

async function readStored(key: string): Promise<StoredWallet | null> {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const stored = JSON.parse(raw) as StoredWallet;
  if (!stored?.pubkey || stored.version !== 2) return null;
  return stored;
}

async function decrypt(stored: StoredWallet): Promise<Uint8Array<ArrayBuffer>> {
  const wrap = await deviceWrappingKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(stored.iv) },
    wrap,
    b64ToBytes(stored.cipher),
  );
  return copyBytes(new Uint8Array(plain));
}

async function persistKeypair(storageKey: string, kp: Keypair): Promise<WalletRecord> {
  const wrap = await deviceWrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrap, copyBytes(kp.secretKey));
  const createdAt = Date.now();
  const stored: StoredWallet = {
    version: 2,
    pubkey: kp.publicKey.toBase58(),
    createdAt,
    iv: bufToB64(iv),
    cipher: bufToB64(cipher),
  };
  localStorage.setItem(storageKey, JSON.stringify(stored));
  return { pubkey: stored.pubkey, createdAt };
}

/** Old funded room. Import of this secret still works. A new browser mints its own key. */
export const ROOM_SOLANA = "7xLj8JMp9o3TFgQMNmr6jSLcaaaRTpEbeCUB7uNh15vr";

let creating: Promise<WalletRecord> | null = null;

export async function loadWallet(): Promise<WalletRecord | null> {
  try {
    const kp = await loadKeypair();
    if (!kp) return null;
    const stored = await readStored(WALLET_KEY);
    if (!stored || stored.pubkey !== kp.publicKey.toBase58()) return null;
    return { pubkey: stored.pubkey, createdAt: stored.createdAt };
  } catch {
    return null;
  }
}

export async function loadKeypair(): Promise<Keypair | null> {
  try {
    const stored = await readStored(WALLET_KEY);
    if (!stored) return null;
    const secret = await decrypt(stored);
    if (secret.length !== 64) return null;
    const kp = Keypair.fromSecretKey(secret);
    if (kp.publicKey.toBase58() !== stored.pubkey) return null;
    return kp;
  } catch {
    return null;
  }
}

/** First visit mints one key. A later visit reuses it. A cipher that will not open is not overwritten. */
export async function createWallet(): Promise<WalletRecord> {
  if (creating) return creating;
  creating = (async () => {
    const existing = await loadWallet();
    if (existing) return existing;
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(WALLET_KEY);
    if (raw) {
      try {
        const stored = JSON.parse(raw) as StoredWallet;
        if (stored?.pubkey) return { pubkey: stored.pubkey, createdAt: stored.createdAt ?? 0 };
      } catch {
        /* leave the unreadable blob on disk */
      }
      throw new Error("Ключ не розшифрувався");
    }
    return persistKeypair(WALLET_KEY, Keypair.generate());
  })().finally(() => {
    creating = null;
  });
  return creating;
}

export function peekStoredPubkey(which: "room" | "market"): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(which === "room" ? WALLET_KEY : MARKET_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { pubkey?: string };
    return typeof stored.pubkey === "string" ? stored.pubkey : null;
  } catch {
    return null;
  }
}

/** Replace the room key in this browser only. Never log or send the secret. */
export async function importRoomSecret(text: string): Promise<WalletRecord> {
  const clean = text.trim();
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(clean);
  } catch {
    throw new Error("Секрет не читається");
  }
  if (bytes.length !== 64) throw new Error("Це не секрет ключа кімнати");
  const kp = Keypair.fromSecretKey(bytes);
  return persistKeypair(WALLET_KEY, kp);
}
export async function revealRoomSecret(): Promise<string> {
  const kp = await loadKeypair();
  if (!kp) throw new Error("Ключа кімнати немає");
  return encodeBase58(kp.secretKey);
}

export async function loadMarketKeypair(): Promise<Keypair> {
  const stored = await readStored(MARKET_KEY);
  if (stored) {
    const secret = await decrypt(stored);
    if (secret.length === 64) return Keypair.fromSecretKey(secret);
  }
  const kp = Keypair.generate();
  await persistKeypair(MARKET_KEY, kp);
  return kp;
}
