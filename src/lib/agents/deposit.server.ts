import { createHmac } from "node:crypto";
import type { Address, Hex } from "viem";
import { DEPOSIT_FACTORY, deriveDepositWallet } from "./deposit-wallet";
import { deskRelay } from "./grok-fetch";

const RELAYER = "https://relayer-v2.polymarket.com";
const RPC = "https://polygon-bor-rpc.publicnode.com";

type Builder = { key: string; secret: string; passphrase: string };

function envTrim(name: string): string {
  if (import.meta.env.VITE_NATIVE === "1" || typeof process === "undefined") return "";
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function builderCreds(): Builder | null {
  const key = envTrim("POLYMARKET_BUILDER_API_KEY");
  const secret = envTrim("POLYMARKET_BUILDER_SECRET");
  const passphrase = envTrim("POLYMARKET_BUILDER_PASSPHRASE");
  if (!key || !secret || !passphrase) return null;
  return { key, secret, passphrase };
}

function builderSignature(secret: string, message: string): string {
  const normalized = secret.replace(/-/g, "+").replace(/_/g, "/");
  const key = Buffer.from(normalized, "base64");
  return createHmac("sha256", key)
    .update(message)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function builderHeaders(creds: Builder, method: string, path: string, body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    POLY_BUILDER_API_KEY: creds.key,
    POLY_BUILDER_TIMESTAMP: timestamp,
    POLY_BUILDER_PASSPHRASE: creds.passphrase,
    POLY_BUILDER_SIGNATURE: builderSignature(creds.secret, `${timestamp}${method}${path}${body}`),
  };
}

async function relayerFetch(method: "GET" | "POST", path: string, body: string): Promise<Response> {
  const creds = builderCreds();
  if (!creds) return deskRelay(method, path, body);
  return fetch(`${RELAYER}${path}`, {
    method,
    headers: {
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...builderHeaders(creds, method, path, body),
    },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(12_000),
  });
}

async function codeAt(address: string): Promise<boolean | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string; error?: unknown };
    if (body.error || typeof body.result !== "string") return null;
    return body.result !== "0x" && body.result !== "0x0";
  } catch {
    return null;
  }
}

async function pollCreate(id: string): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await relayerFetch("GET", `/transaction?id=${encodeURIComponent(id)}`, "");
      const text = await res.text();
      const rows = JSON.parse(text) as Array<{ state?: string; proxyAddress?: string; error_msg?: string }>;
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row?.state === "STATE_CONFIRMED" && row.proxyAddress) {
        return { ok: true, address: row.proxyAddress };
      }
      if (row?.state === "STATE_FAILED" || row?.state === "STATE_INVALID") {
        return { ok: false, error: row.error_msg || row.state };
      }
    } catch {
      /* poll again */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, error: "Relayer не підтвердив deposit wallet." };
}

export async function ensureDepositWalletOnServer(
  owner: string,
): Promise<{ ok: true; address: Address; deployed: true } | { ok: false; error: string }> {
  const derived = deriveDepositWallet(owner);
  if (!derived) return { ok: false, error: "Адреса Polygon не та." };
  const alive = await codeAt(derived);
  if (alive === null) return { ok: false, error: "Немає цифри коду контракту. Ордера немає." };
  if (alive) return { ok: true, address: derived, deployed: true };
  const payload = {
    type: "WALLET-CREATE",
    from: owner,
    to: DEPOSIT_FACTORY,
    metadata: "Deploy Deposit Wallet",
  };
  const body = JSON.stringify(payload);
  const path = "/submit";
  let created: { transactionID?: string; error?: string };
  try {
    const res = await relayerFetch("POST", path, body);
    created = (await res.json()) as typeof created;
    if (!res.ok || !created.transactionID) {
      return { ok: false, error: String(created.error || `Relayer ${res.status}`).slice(0, 180) };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, error: msg.slice(0, 180) || "Relayer не відповів." };
  }
  const polled = await pollCreate(created.transactionID);
  if (!polled.ok) return polled;
  const again = await codeAt(derived);
  if (!again) return { ok: false, error: "Deposit wallet не з’явився в мережі. Ордера немає." };
  return { ok: true, address: derived, deployed: true };
}

export async function walletNonceOnServer(owner: string): Promise<{ ok: true; nonce: string } | { ok: false; error: string }> {
  const query = `address=${encodeURIComponent(owner)}&type=WALLET`;
  const path = `/v1/account/transactions/params?${query}`;
  try {
    const res = await relayerFetch("GET", path, "");
    const body = (await res.json()) as { nonce?: string; error?: string };
    if (!res.ok || body.nonce == null) {
      return { ok: false, error: String(body.error || `Relayer ${res.status}`).slice(0, 180) };
    }
    return { ok: true, nonce: String(body.nonce) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, error: msg.slice(0, 180) || "Relayer не відповів." };
  }
}

export async function submitWalletBatchOnServer(input: {
  from: string;
  depositWallet: string;
  nonce: string;
  signature: Hex;
  deadline: string;
  calls: { target: string; value: string; data: Hex }[];
}): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  const payload = {
    type: "WALLET",
    from: input.from,
    to: DEPOSIT_FACTORY,
    nonce: input.nonce,
    signature: input.signature,
    metadata: "pUSD approve",
    depositWalletParams: {
      depositWallet: input.depositWallet,
      deadline: input.deadline,
      calls: input.calls,
    },
  };
  const body = JSON.stringify(payload);
  const path = "/submit";
  try {
    const res = await relayerFetch("POST", path, body);
    const created = (await res.json()) as { transactionID?: string; error?: string };
    if (!res.ok || !created.transactionID) {
      return { ok: false, error: String(created.error || `Relayer ${res.status}`).slice(0, 180) };
    }
    const deadline = Date.now() + 20_000;
    const statusPath = `/v1/account/transactions/${created.transactionID}`;
    while (Date.now() < deadline) {
      const look = await relayerFetch("GET", statusPath, "");
      const row = (await look.json()) as {
        state?: string;
        error_msg?: string | null;
        transaction_hash?: string;
        transactionHash?: string;
      };
      if (row.state === "STATE_CONFIRMED") {
        return { ok: true, hash: row.transaction_hash || row.transactionHash || created.transactionID };
      }
      if (row.state === "STATE_FAILED" || row.state === "STATE_INVALID") {
        return { ok: false, error: String(row.error_msg || row.state).slice(0, 180) };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { ok: false, error: "Relayer не підтвердив дозвіл. Ордера немає." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, error: msg.slice(0, 180) || "Relayer не відповів." };
  }
}
