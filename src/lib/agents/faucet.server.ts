/**
 * Judge onboarding: a devnet-only fallback faucet. When the public devnet airdrop is
 * rate-limited, the server sends a small drip from its own faucet wallet.
 * Limits: one drip per wallet per UTC day (atomic row), FAUCET_PER_IP per IP per day,
 * FAUCET_DAILY_SOL per day overall, no drip to a wallet that already holds enough.
 * Never runs against mainnet. Deps are injected so the rules are tested on PGLite.
 */
import type { Keypair } from "@solana/web3.js";
import type { GuardSql } from "./guard-ledger.server.ts";
import { spendProofOnce } from "./guard-ledger.server.ts";
import { verifyProof } from "./wallet-proof.server.ts";
import type { WalletProof } from "./wallet-proof.ts";

export type FaucetCaps = { dripLamports: number; perIp: number; dailyLamports: number; enoughLamports: number };
export const FAUCET_DEFAULTS: FaucetCaps = {
  dripLamports: 200_000_000,
  perIp: 3,
  dailyLamports: 5_000_000_000,
  enoughLamports: 150_000_000,
};

export type FaucetDeps = {
  sql: GuardSql | null;
  rpcUrl: string;
  now: number;
  caps: FaucetCaps;
  /** Faucet wallet; null = faucet not configured. */
  faucet: Keypair | null;
  balance: (wallet: string) => Promise<number>;
  send: (to: string, lamports: number) => Promise<string>;
};

export type FaucetResult = { ok: true; sig: string; lamports: number } | { ok: false; reason: string };

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isDevnetRpc(url: string): boolean {
  return !/mainnet/i.test(url);
}

export async function faucetDrip(deps: FaucetDeps, input: { proof: WalletProof | null; ip: string }): Promise<FaucetResult> {
  if (!isDevnetRpc(deps.rpcUrl)) return { ok: false, reason: "Кран лише для devnet." };
  if (!deps.faucet) return { ok: false, reason: "Кран сервера не налаштований (FAUCET_SECRET)." };
  if (!deps.sql) return { ok: false, reason: "Немає бази: кран вимкнено." };
  if (!input.proof) return { ok: false, reason: "Немає підпису гаманця." };
  const signed = verifyProof(input.proof, "faucet", "devnet", deps.now);
  if (!signed.ok) return signed;
  const wallet = input.proof.wallet;
  if (!(await spendProofOnce(deps.sql, wallet, "faucet", input.proof.ts, deps.now))) return { ok: false, reason: "Цей підпис уже використано." };
  const have = await deps.balance(wallet).catch(() => -1);
  if (have < 0) return { ok: false, reason: "Devnet не відповів. Спробуй ще раз." };
  if (have >= deps.caps.enoughLamports) return { ok: false, reason: `У гаманці вже ${(have / 1e9).toFixed(3)} SOL: цього досить.` };
  const day = utcDay(deps.now);
  const ip = (input.ip || "unknown").slice(0, 64);
  const [{ n: ipCount }] = await deps.sql.query<{ n: string }>("select count(*) as n from faucet_drips where day = $1 and ip = $2", [day, ip]);
  if (Number(ipCount) >= deps.caps.perIp) return { ok: false, reason: "Ліміт крана для цієї мережі на сьогодні." };
  const [{ s: used }] = await deps.sql.query<{ s: string | null }>("select sum(lamports) as s from faucet_drips where day = $1", [day]);
  if (Number(used ?? 0) + deps.caps.dripLamports > deps.caps.dailyLamports) return { ok: false, reason: "Кран сервера на сьогодні вичерпано." };
  const won = await deps.sql.query<{ ok: number }>(
    "insert into faucet_drips (wallet, day, ip, lamports, created_ms) values ($1, $2, $3, $4, $5) on conflict do nothing returning 1 as ok",
    [wallet, day, ip, deps.caps.dripLamports, deps.now],
  );
  if (!won.length) return { ok: false, reason: "Цей гаманець уже отримав SOL сьогодні." };
  try {
    const sig = await deps.send(wallet, deps.caps.dripLamports);
    await deps.sql.query("update faucet_drips set sig = $3 where wallet = $1 and day = $2", [wallet, day, sig]);
    return { ok: true, sig, lamports: deps.caps.dripLamports };
  } catch (e) {
    await deps.sql.query("delete from faucet_drips where wallet = $1 and day = $2 and sig is null", [wallet, day]);
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, reason: /insufficient|0x1\b/i.test(msg) ? "У крана сервера скінчились devnet SOL." : "Кран сервера не відправив SOL." };
  }
}

/** Process env: FAUCET_SECRET (or the mint key), FAUCET_DRIP_SOL, FAUCET_DAILY_SOL, FAUCET_PER_IP. */
export async function faucetFromProcess(proof: WalletProof | null, ip: string, sqlIn?: GuardSql | null): Promise<FaucetResult> {
  const { keypairFromText } = await import("./secret-key.server.ts");
  const web3 = await import("@solana/web3.js");
  let sql: GuardSql | null = sqlIn ?? null;
  if (sqlIn === undefined) {
    try {
      const { getSql } = await import("@/lib/db");
      sql = await getSql();
    } catch {
      sql = null;
    }
  }
  const rpcUrl = (process.env.SOLANA_RPC_DEVNET || "").trim() || "https://api.devnet.solana.com";
  const faucet = keypairFromText(process.env.FAUCET_SECRET) ?? keypairFromText(process.env.MINT_AUTHORITY_SECRET);
  const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const caps: FaucetCaps = {
    dripLamports: Math.round(num(process.env.FAUCET_DRIP_SOL, FAUCET_DEFAULTS.dripLamports / 1e9) * 1e9),
    perIp: Math.round(num(process.env.FAUCET_PER_IP, FAUCET_DEFAULTS.perIp)),
    dailyLamports: Math.round(num(process.env.FAUCET_DAILY_SOL, FAUCET_DEFAULTS.dailyLamports / 1e9) * 1e9),
    enoughLamports: FAUCET_DEFAULTS.enoughLamports,
  };
  const conn = new web3.Connection(rpcUrl, "confirmed");
  return faucetDrip(
    {
      sql,
      rpcUrl,
      now: Date.now(),
      caps,
      faucet,
      balance: (w) => conn.getBalance(new web3.PublicKey(w)),
      send: async (to, lamports) => {
        const tx = new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: faucet!.publicKey, toPubkey: new web3.PublicKey(to), lamports }));
        return web3.sendAndConfirmTransaction(conn, tx, [faucet!], { commitment: "confirmed" });
      },
    },
    { proof, ip },
  );
}
