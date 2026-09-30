/** Public receive address only. Never a secret. */
export const PAY_WALLET = "H7zKmmnMNfnsMtib6mopdT8XsPYAyPBFuaQeWhBYTpQg";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RPC = "https://api.mainnet-beta.solana.com";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const PAY_AMOUNTS = [5, 10] as const;
export type PayUsd = number;

export function clampPay(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  const x = Math.round(n * 100) / 100;
  if (x < 1 || x > 100) return 0;
  return x;
}

function b58encode(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    zeros++;
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => B58[d]).join("");
}

export function newPayRef(): string {
  const b = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 32; i++) b[i] = (Math.random() * 256) | 0;
  return b58encode(b);
}

export function payUrl(usd: PayUsd, ref: string, playerId: string): string {
  const q = new URLSearchParams({
    amount: String(clampPay(usd) || usd),
    "spl-token": USDC,
    reference: ref,
    label: "Solarchik Secretary",
    message: `${usd} USD credit`,
    memo: playerId.slice(0, 32),
  });
  return `solana:${PAY_WALLET}?${q.toString()}`;
}

export type PayHit = { sig: string; from: string };

function accountKey(k: unknown): string {
  if (typeof k === "string") return k;
  if (k && typeof k === "object" && "pubkey" in k) return String((k as { pubkey: string }).pubkey);
  return "";
}

function txKeys(tx: unknown): string[] {
  if (!tx || typeof tx !== "object") return [];
  const keys = (tx as { transaction?: { message?: { accountKeys?: unknown } } }).transaction?.message?.accountKeys;
  return Array.isArray(keys) ? keys.map(accountKey).filter(Boolean) : [];
}

function payerOf(tx: unknown): string {
  return txKeys(tx)[0] || "";
}

function tokenDelta(tx: unknown, usd: PayUsd): boolean {
  if (!tx || typeof tx !== "object") return false;
  const meta = (tx as { meta?: Record<string, unknown> }).meta;
  if (!meta) return false;
  const pre = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
  const post = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances : [];
  const amt = (row: unknown) => {
    if (!row || typeof row !== "object") return 0;
    const o = row as { mint?: string; owner?: string; uiTokenAmount?: { uiAmount?: number } };
    if (o.mint !== USDC) return 0;
    if (o.owner && o.owner !== PAY_WALLET) return 0;
    return Number(o.uiTokenAmount?.uiAmount) || 0;
  };
  return Math.abs(post.reduce((s, r) => s + amt(r), 0) - pre.reduce((s, r) => s + amt(r), 0) - usd) < 0.01;
}

function hasRef(tx: unknown, ref: string): boolean {
  return Boolean(ref) && txKeys(tx).includes(ref);
}

export async function findPayment(ref: string, usd: PayUsd, used: string[]): Promise<PayHit | null> {
  if (!ref) return null;
  const rows = (await rpc("getSignaturesForAddress", [ref, { limit: 12 }])) as { signature?: string }[] | null;
  if (!Array.isArray(rows) || !rows.length) return null;
  for (const row of rows) {
    const sig = String(row?.signature || "");
    if (!sig || used.includes(sig)) continue;
    const tx = await rpc("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    if (hasRef(tx, ref) && tokenDelta(tx, usd)) {
      return { sig, from: payerOf(tx) };
    }
  }
  return null;
}

export async function confirmPay(ref: string, usd: PayUsd, used: string[]): Promise<PayHit | null> {
  return findPayment(ref, usd, used);
}

export async function confirmPending(
  pending: { ref: string; usd: PayUsd }[],
  used: string[],
): Promise<(PayHit & { usd: PayUsd; ref: string }) | null> {
  for (const p of pending) {
    const hit = await findPayment(p.ref, p.usd, used);
    if (hit) return { ...hit, usd: p.usd, ref: p.ref };
  }
  return null;
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || "";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function shortWallet(): string {
  return shortAddr(PAY_WALLET);
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: unknown };
  return j.result;
}

