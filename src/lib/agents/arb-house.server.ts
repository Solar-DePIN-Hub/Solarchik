import { existsSync, readFileSync } from "node:fs";
import { createPrivateKey, sign as edSign } from "node:crypto";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ARB_TREASURY } from "@/lib/game/pay";
import { decodeBase58 } from "./base58";
import { readMainnetBalanceOnServer, readMainnetUsdcOnServer } from "./mainnet.server";
import { bookTop, findSpot, floorToStep, loadSpots, stepDp, USDC_MINT } from "./arb-markets.server";

export type ArbHouse = {
  bpSol: number | null;
  bpUsdc: number | null;
  chainSol: number | null;
  chainUsdc: number | null;
  houseKey: boolean;
  tokens: Record<string, { bp: number; chain: number }> | null;
};

const LIVE_MAX = 0.005;
const KEY_URL = new URL("../../../server/arb-house.key", import.meta.url);
const BP_URL = new URL("../../../server/backpack.secret", import.meta.url);

function houseKeypair(): Keypair | null {
  if (!existsSync(KEY_URL)) return null;
  let text = "";
  try {
    text = readFileSync(KEY_URL, "utf8").trim();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    const secret = text.startsWith("[")
      ? Uint8Array.from(JSON.parse(text) as number[])
      : decodeBase58(text);
    const kp = secret.length === 32 ? Keypair.fromSeed(secret) : Keypair.fromSecretKey(secret);
    return kp.publicKey.toBase58() === ARB_TREASURY ? kp : null;
  } catch {
    return null;
  }
}

function backpackSeed(): { apiKey: string; seed: Buffer } | null {
  try {
    const lines = readFileSync(BP_URL, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const apiKey = lines[0];
    const secret = lines[1];
    if (!apiKey || !secret) return null;
    const seed = Buffer.from(secret, "base64");
    if (seed.length !== 32) return null;
    return { apiKey, seed };
  } catch {
    return null;
  }
}

function bpSign(seed: Buffer, msg: string): string {
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return edSign(null, Buffer.from(msg), key).toString("base64");
}

async function bpCall(
  instruction: string,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const keys = backpackSeed();
  if (!keys) return null;
  const ts = Date.now().toString();
  const window = "5000";
  const sorted = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = sorted.map(([k, v]) => `${k}=${v}`).join("&");
  const msg = `instruction=${instruction}${qs ? `&${qs}` : ""}&timestamp=${ts}&window=${window}`;
  const res = await fetch(`https://api.backpack.exchange${path}${method === "GET" && qs ? `?${qs}` : ""}`, {
    method,
    headers: {
      "X-API-Key": keys.apiKey,
      "X-Signature": bpSign(keys.seed, msg),
      "X-Timestamp": ts,
      "X-Window": window,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: method === "POST" ? JSON.stringify(Object.fromEntries(sorted)) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json();
}

function availOf(body: unknown, symbol: string): number | null {
  if (!body || typeof body !== "object") return null;
  const row = (body as Record<string, unknown>)[symbol];
  if (!row || typeof row !== "object") return 0;
  const n = Number((row as { available?: string | number }).available);
  return Number.isFinite(n) ? n : 0;
}

async function chainByMint(owner: string): Promise<Record<string, number> | null> {
  const programs = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  const out: Record<string, number> = {};
  let ok = false;
  for (const programId of programs) {
    const result = (await rpc("getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed" }]).catch(() => null)) as {
      value?: { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }[];
    } | null;
    if (!result) continue;
    ok = true;
    for (const row of result.value ?? []) {
      const info = row.account?.data?.parsed?.info;
      const mint = info?.mint;
      const n = info?.tokenAmount?.uiAmount;
      if (mint && typeof n === "number" && n > 0) out[mint] = (out[mint] ?? 0) + n;
    }
  }
  return ok ? out : null;
}

export async function readArbHouseOnServer(): Promise<ArbHouse> {
  const [capital, chainSol, chainUsdc, spots, chainMints] = await Promise.all([
    bpCall("balanceQuery", "GET", "/api/v1/capital", {}).catch(() => null),
    readMainnetBalanceOnServer(ARB_TREASURY),
    readMainnetUsdcOnServer(ARB_TREASURY),
    loadSpots().catch(() => []),
    chainByMint(ARB_TREASURY),
  ]);
  const tokens =
    capital && chainMints
      ? Object.fromEntries(
          spots.map((spot) => [
            spot.base,
            {
              bp: availOf(capital, spot.base) ?? 0,
              chain: spot.base === "SOL" ? (chainSol ?? 0) : (chainMints[spot.mint] ?? 0),
            },
          ]),
        )
      : null;
  return {
    bpSol: availOf(capital, "SOL"),
    bpUsdc: availOf(capital, "USDC"),
    chainSol,
    chainUsdc,
    houseKey: houseKeypair() !== null,
    tokens,
  };
}

type TitanIx = { p: string; a?: { p: string; s?: boolean; w?: boolean }[]; d?: string };

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json()) as { result?: unknown };
  return body.result ?? null;
}

async function titanTx(inputMint: string, outputMint: string, amount: string, payer: Keypair): Promise<VersionedTransaction | null> {
  let key = "";
  try {
    key = readFileSync(new URL("../../../server/titan.secret", import.meta.url), "utf8").trim();
  } catch {
    return null;
  }
  if (!key) return null;
  const url = new URL("https://portal.api.titan.exchange/api/v1/quote/swap");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", "30");
  url.searchParams.set("userPublicKey", ARB_TREASURY);
  const res = await fetch(url, {
    headers: {
      "x-api-key": key,
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { quotes?: Record<string, { instructions?: TitanIx[]; addressLookupTables?: string[] }> };
  const row = Object.values(body.quotes ?? {}).find((q) => q.instructions?.length);
  if (!row?.instructions?.length) return null;
  const alts: AddressLookupTableAccount[] = [];
  for (const addr of row.addressLookupTables ?? []) {
    const info = (await rpc("getAccountInfo", [addr, { encoding: "base64" }])) as {
      value?: { data?: [string, string] };
    } | null;
    const b64 = info?.value?.data?.[0];
    if (!b64) return null;
    alts.push(
      new AddressLookupTableAccount({
        key: new PublicKey(addr),
        state: AddressLookupTableAccount.deserialize(Buffer.from(b64, "base64")),
      }),
    );
  }
  const ixs = row.instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.p),
        keys: (ix.a ?? []).map((a) => ({
          pubkey: new PublicKey(a.p),
          isSigner: Boolean(a.s),
          isWritable: Boolean(a.w),
        })),
        data: Buffer.from(ix.d ?? "", "base64"),
      }),
  );
  const hash = (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])) as {
    value?: { blockhash?: string };
  } | null;
  const blockhash = hash?.value?.blockhash;
  if (!blockhash) return null;
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  return tx;
}

export async function fireArbOnServer(
  dir: "A" | "B",
  symbol = "SOL",
): Promise<
  | { ok: true; size: number; qty: number; base: string; bp: string; titan: string }
  | { ok: false; broken: boolean; reason: string }
> {
  const spot = await findSpot(symbol);
  if (!spot) return { ok: false, broken: false, reason: "Немає цієї пари на Backpack." };
  const [house, book, solBook] = await Promise.all([
    readArbHouseOnServer(),
    bookTop(spot.market),
    spot.base === "SOL" ? Promise.resolve(null) : bookTop("SOL_USDC"),
  ]);
  const bid = book?.bid ?? 0;
  const ask = book?.ask ?? 0;
  if (!(bid > 0) || !(ask > bid)) return { ok: false, broken: false, reason: "Чекаю касу." };
  const solPx = spot.base === "SOL" ? ask : (solBook?.ask ?? 0);
  if (!(solPx > 0)) return { ok: false, broken: false, reason: "Чекаю ціну SOL." };
  const rawQty = spot.base === "SOL" ? LIVE_MAX : (LIVE_MAX * solPx) / ask;
  const qty = floorToStep(rawQty, spot.step);
  if (!(qty + 1e-12 >= spot.minQty)) return { ok: false, broken: false, reason: "Нога менша за мінімум біржі." };
  const px = dir === "A" ? ask : bid;
  const needUsdc = qty * px;
  const row = house.tokens?.[spot.base];
  const bpBase = spot.base === "SOL" ? house.bpSol : row?.bp;
  const chainBase = spot.base === "SOL" ? house.chainSol : row?.chain;
  const covered = (base: number | null | undefined, usdc: number | null | undefined) =>
    base != null && usdc != null && base + 1e-12 >= qty && usdc + 1e-9 >= needUsdc;
  if (house.bpUsdc == null || (spot.base !== "SOL" && !house.tokens)) {
    return { ok: false, broken: false, reason: "Чекаю касу." };
  }
  if (!covered(bpBase, house.bpUsdc)) return { ok: false, broken: false, reason: "Каса Backpack порожня." };
  if (house.chainUsdc == null || chainBase == null) return { ok: false, broken: false, reason: "Чекаю касу." };
  if (!covered(chainBase, house.chainUsdc)) return { ok: false, broken: false, reason: "Ончейн-каса порожня." };
  const payer = houseKeypair();
  if (!payer) return { ok: false, broken: false, reason: "Немає ключа каси ончейн." };
  const atoms = Math.round(qty * 10 ** spot.decimals);
  const usdcAtoms = Math.round(needUsdc * 1e6);
  if (!(atoms > 0) || !(usdcAtoms > 0)) return { ok: false, broken: false, reason: "Нога менша за мінімум біржі." };
  const tx =
    dir === "A"
      ? await titanTx(spot.mint, USDC_MINT, String(atoms), payer)
      : await titanTx(USDC_MINT, spot.mint, String(usdcAtoms), payer);
  if (!tx) return { ok: false, broken: false, reason: "Ончейн не відповів." };
  const side = dir === "A" ? "Bid" : "Ask";
  const [bp, sent] = await Promise.all([
    bpCall("orderExecute", "POST", "/api/v1/order", {
      orderType: "Limit",
      price: px.toFixed(stepDp(spot.tick)),
      quantity: qty.toFixed(stepDp(spot.step)),
      side,
      symbol: spot.market,
      timeInForce: "IOC",
    }),
    (async () => {
      const raw = Buffer.from(tx.serialize()).toString("base64");
      const result = (await rpc("sendTransaction", [raw, { encoding: "base64", skipPreflight: false }])) as string | null;
      return typeof result === "string" ? result : null;
    })(),
  ]);
  const bpId = bp && typeof bp === "object" && typeof (bp as { id?: string }).id === "string" ? (bp as { id: string }).id : "";
  if (bpId && sent) return { ok: true, size: LIVE_MAX, qty, base: spot.base, bp: bpId, titan: sent };
  if (bpId || sent) return { ok: false, broken: true, reason: "Зламано, чекає зведення." };
  return { ok: false, broken: false, reason: "Ончейн не відповів." };
}

/**
 * Same sizing as fireArbOnServer against the live Backpack book, but nothing is
 * signed or sent. No keys are read. Used whenever mainnet is not armed.
 */
export async function simulateArbOnServer(
  dir: "A" | "B",
  symbol = "SOL",
): Promise<
  | { ok: true; size: number; qty: number; base: string; bp: string; titan: string }
  | { ok: false; broken: boolean; reason: string }
> {
  const spot = await findSpot(symbol);
  if (!spot) return { ok: false, broken: false, reason: "Немає цієї пари на Backpack." };
  const [book, solBook] = await Promise.all([
    bookTop(spot.market),
    spot.base === "SOL" ? Promise.resolve(null) : bookTop("SOL_USDC"),
  ]);
  const bid = book?.bid ?? 0;
  const ask = book?.ask ?? 0;
  if (!(bid > 0) || !(ask > bid)) return { ok: false, broken: false, reason: "Чекаю книгу." };
  const solPx = spot.base === "SOL" ? ask : (solBook?.ask ?? 0);
  if (!(solPx > 0)) return { ok: false, broken: false, reason: "Чекаю ціну SOL." };
  const rawQty = spot.base === "SOL" ? LIVE_MAX : (LIVE_MAX * solPx) / ask;
  const qty = floorToStep(rawQty, spot.step);
  if (!(qty + 1e-12 >= spot.minQty)) return { ok: false, broken: false, reason: "Нога менша за мінімум біржі." };
  const px = dir === "A" ? ask : bid;
  const tag = `sim-${Date.now().toString(36)}`;
  return { ok: true, size: LIVE_MAX, qty, base: spot.base, bp: `${tag}@${px}`, titan: tag };
}
