import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { MAINNET_HTTP } from "../../../server/quicknode.mjs";

const ROOM_SOLANA = "7xLj8JMp9o3TFgQMNmr6jSLcaaaRTpEbeCUB7uNh15vr";
const SWEEP_DEST = "C7De9zogHG7ss4nFG3jVxrFcBNsB7iidLyExn5hLTrsf";
const SWEEP_FEE = 5_000;
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const PUBLIC_MAINNET = "https://api.mainnet-beta.solana.com";

async function postMainnet(body: unknown, ms = 8000): Promise<Record<string, unknown> | null> {
  const fromEnv = (process.env.SOLANA_RPC_MAINNET || "").trim();
  const urls = [fromEnv, MAINNET_HTTP, PUBLIC_MAINNET].filter((url, i, all) => url && all.indexOf(url) === i);
  let last: Record<string, unknown> | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      if (json.error) {
        last = json;
        continue;
      }
      return json;
    } catch {
      continue;
    }
  }
  return last;
}

export async function readMainnetSlotOnServer(): Promise<number | null> {
  const body = await postMainnet({ jsonrpc: "2.0", id: 1, method: "getSlot" });
  const slot = body?.result;
  return typeof slot === "number" ? slot : null;
}

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function readMainnetUsdcOnServer(owner: string): Promise<number | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) return null;
  try {
    const body = (await postMainnet({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [owner, { mint: USDC_MINT }, { encoding: "jsonParsed" }],
    })) as {
      result?: { value?: { account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } } }[] };
    } | null;
    if (!body?.result) return null;
    const rows = body.result.value ?? [];
    let sum = 0;
    for (const row of rows) {
      const n = row.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof n === "number" && Number.isFinite(n)) sum += n;
    }
    return sum;
  } catch {
    return null;
  }
}

/** Parsed mainnet transaction (read only). Null when not found or the RPC is down. */
export async function readMainnetTxOnServer(signature: string): Promise<unknown | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(signature)) return null;
  const body = await postMainnet({
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
  });
  return (body?.result as unknown) ?? null;
}

export async function readMainnetBalanceOnServer(owner: string): Promise<number | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) return null;
  try {
    const body = (await postMainnet({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [owner],
    })) as { result?: { value?: number } } | null;
    const lamports = body?.result?.value;
    return typeof lamports === "number" ? lamports / 1e9 : null;
  } catch {
    return null;
  }
}

export async function peekMainnetSigOnServer(
  signature: string,
): Promise<{ status: "pending" } | { status: "confirmed" } | { status: "error"; error: string }> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return { status: "error", error: "Підпис порожній." };
  try {
    const body = (await postMainnet({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignatureStatuses",
      params: [[signature], { searchTransactionHistory: true }],
    })) as {
      error?: unknown;
      result?: { value?: ({ err?: unknown; confirmationStatus?: string } | null)[] };
    } | null;
    if (!body || body.error || !body.result) return { status: "pending" };
    const row = body.result.value?.[0];
    if (!row) return { status: "pending" };
    if (row.err) {
      return { status: "error", error: (typeof row.err === "string" ? row.err : "Mainnet відхилив транзакцію.").slice(0, 160) };
    }
    if (row.confirmationStatus === "confirmed" || row.confirmationStatus === "finalized") return { status: "confirmed" };
    return { status: "pending" };
  } catch {
    return { status: "pending" };
  }
}

export async function confirmMainnetTxOnServer(
  signature: string,
): Promise<{ ok: true } | { ok: false; reason: "timeout" | "error"; error?: string }> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return { ok: false, reason: "error", error: "Підпис порожній." };
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const body = (await postMainnet({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      })) as { result?: { value?: ({ err?: unknown; confirmationStatus?: string } | null)[] } } | null;
      const row = body?.result?.value?.[0];
        if (row?.err) {
          return { ok: false, reason: "error", error: (typeof row.err === "string" ? row.err : "Mainnet відхилив транзакцію.").slice(0, 160) };
        }
        if (row?.confirmationStatus === "confirmed" || row?.confirmationStatus === "finalized") return { ok: true };
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { ok: false, reason: "timeout" };
}

export async function sendMainnetTxOnServer(tx: string): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  if (!tx || tx.length > 16_000) return { ok: false, error: "Транзакція порожня." };
  try {
    const body = (await postMainnet(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [tx, { encoding: "base64" }],
      },
      12000,
    )) as { result?: string; error?: { message?: string } } | null;
    if (typeof body?.result === "string" && body.result) return { ok: true, signature: body.result };
    return { ok: false, error: body?.error?.message?.slice(0, 180) || "Mainnet не прийняв транзакцію." };
  } catch {
    return { ok: false, error: "Mainnet не відповів." };
  }
}

/** Unsigned sweep of the room wallet. The browser signs. The server never sees the secret. */
export async function prepareMainnetSweepOnServer(): Promise<
  | { ok: true; tx: string; lamports: number }
  | { ok: false; error: string }
> {
  try {
    const from = new PublicKey(ROOM_SOLANA);
    const to = new PublicKey(SWEEP_DEST);
    const balBody = (await postMainnet({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [ROOM_SOLANA, { commitment: "confirmed" }],
    })) as { result?: { value?: number } } | null;
    const lamports = balBody?.result?.value;
    if (typeof lamports !== "number") return { ok: false, error: "Mainnet не дав баланс. Нічого не відправлено." };
    if (lamports <= SWEEP_FEE) return { ok: false, error: "На mainnet немає SOL для переказу." };
    const hashBody = (await postMainnet({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    })) as { result?: { value?: { blockhash?: string } } } | null;
    const blockhash = hashBody?.result?.value?.blockhash;
    if (!blockhash) return { ok: false, error: "Mainnet не дав блокхеш. Нічого не відправлено." };
    const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash });
    tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: lamports - SWEEP_FEE }));
    const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return { ok: true, tx: Buffer.from(raw).toString("base64"), lamports: lamports - SWEEP_FEE };
  } catch {
    return { ok: false, error: "Mainnet не зібрав переказ. Нічого не відправлено." };
  }
}

/** Unsigned mainnet SOL transfer of the amount the person typed. The browser signs. */
export async function prepareMainnetSendOnServer(
  from: string,
  to: string,
  sol: number,
  memo = "",
): Promise<{ ok: true; tx: string; lamports: number } | { ok: false; error: string }> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(from) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) {
    return { ok: false, error: "Адреса Solana не та. Нічого не відправлено." };
  }
  if (from === to) return { ok: false, error: "Це адреса цього ж гаманця. Вивід скасовано." };
  if (!Number.isFinite(sol) || sol <= 0 || sol > 20) return { ok: false, error: "Сума виводу має бути більша за нуль." };
  const lamports = Math.round(sol * 1_000_000_000);
  if (lamports < 1) return { ok: false, error: "Сума виводу має бути більша за нуль." };
  try {
    const fromKey = new PublicKey(from);
    const toKey = new PublicKey(to);
    const balBody = (await postMainnet({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [from, { commitment: "confirmed" }],
    })) as { result?: { value?: number } } | null;
    const have = balBody?.result?.value;
    if (typeof have !== "number") return { ok: false, error: "Mainnet не дав баланс. Нічого не відправлено." };
    if (have < lamports + SWEEP_FEE) return { ok: false, error: "На mainnet мало SOL для цієї суми і комісії." };
    const hashBody = (await postMainnet({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    })) as { result?: { value?: { blockhash?: string } } } | null;
    const blockhash = hashBody?.result?.value?.blockhash;
    if (!blockhash) return { ok: false, error: "Mainnet не дав блокхеш. Нічого не відправлено." };
    const tx = new Transaction({ feePayer: fromKey, recentBlockhash: blockhash });
    const note = memo.replace(/\s+/g, "").slice(0, 180);
    if (note) {
      tx.add(
        new TransactionInstruction({
          programId: MEMO_PROGRAM,
          keys: [{ pubkey: fromKey, isSigner: true, isWritable: false }],
          data: Buffer.from(note, "utf8"),
        }),
      );
    }
    tx.add(SystemProgram.transfer({ fromPubkey: fromKey, toPubkey: toKey, lamports }));
    const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return { ok: true, tx: Buffer.from(raw).toString("base64"), lamports };
  } catch {
    return { ok: false, error: "Mainnet не зібрав переказ. Нічого не відправлено." };
  }
}
