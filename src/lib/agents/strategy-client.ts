/**
 * Browser side of Strategy NFTs: the room key signs a proof, the server builds and
 * co-signs the Core transaction, the room key signs as owner/payer and sends,
 * then the server confirms what the chain shows.
 */
import { callStrategy } from "./server-calls";
import { loadKeypair } from "./wallet";
import { signProof } from "./wallet-sign";
import { specHash, validateSpec, type StrategySpec } from "./strategy-spec";
import type { StrategyInfo } from "./strategy.server";
import { chainErrorText, NO_SOL_REASON } from "./wallet-errors";

type Res = { ok: true; sig: string } | { ok: false; reason: string };
const fail = (reason: string): Res => ({ ok: false, reason });

async function sendTxs(txs: string[]): Promise<string> {
  const kp = await loadKeypair();
  if (!kp) throw new Error("Немає ключа кімнати.");
  const { sendServerMint } = await import("./chain");
  try {
    return await sendServerMint(kp, txs);
  } catch (e) {
    console.warn("[strategy] send failed", e);
    throw new Error(chainErrorText(e));
  }
}

/** Price + fees + a little rent headroom, before asking the server to build a buy. */
const BUY_HEADROOM_LAMPORTS = 5_000_000;
async function hasLamports(need: number): Promise<boolean | null> {
  const kp = await loadKeypair();
  if (!kp) return null;
  try {
    const { getConn } = await import("./chain");
    return (await getConn().getBalance(kp.publicKey, "confirmed")) >= need;
  } catch {
    return null; // unknown: let the chain decide
  }
}

async function confirmLoop<T extends { ok: boolean; reason?: string }>(route: string, body: Record<string, unknown>): Promise<T> {
  let last = { ok: false, reason: "Ланцюг ще не показав зміну." } as unknown as T;
  for (let i = 0; i < 6; i++) {
    last = await callStrategy<T>(route, body);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

export async function saveChainStrategy(asset: string, raw: unknown): Promise<Res & { unlockSec?: number }> {
  const checked = validateSpec(raw);
  if (!checked.ok) return fail(checked.errors.join(" "));
  const kp = await loadKeypair();
  if (!kp) return fail("Немає ключа кімнати.");
  const spec = checked.spec;
  const proof = await signProof(kp, "strategy", `${asset}:${specHash(spec)}`);
  const prep = await callStrategy<{ ok: true; txs: string[]; version: number; unlockSec: number } | { ok: false; reason: string }>("strategy-prepare", { proof, asset, spec });
  if (!prep.ok) return fail(prep.reason);
  const sig = await sendTxs(prep.txs);
  const conf = await confirmLoop<{ ok: boolean; reason?: string; unlockSec?: number }>("strategy-confirm", { asset, version: prep.version, sig });
  if (!conf.ok) return fail(conf.reason ?? "Сервер не підтвердив стратегію.");
  return { ok: true, sig, unlockSec: conf.unlockSec };
}

export async function listOnChain(asset: string, priceSol: number): Promise<Res> {
  const priceLamports = Math.round(priceSol * 1e9);
  const kp = await loadKeypair();
  if (!kp) return fail("Немає ключа кімнати.");
  const proof = await signProof(kp, "market", `list:${asset}:${priceLamports}`);
  const prep = await callStrategy<{ ok: true; txs: string[] } | { ok: false; reason: string }>("market-prepare-list", { proof, asset, priceLamports });
  if (!prep.ok) return fail(prep.reason);
  const sig = await sendTxs(prep.txs);
  const conf = await confirmLoop<{ ok: boolean; reason?: string }>("market-confirm-list", { asset });
  return conf.ok ? { ok: true, sig } : fail(conf.reason ?? "Лістинг не підтверджено.");
}

export async function unlistOnChain(asset: string): Promise<Res> {
  const kp = await loadKeypair();
  if (!kp) return fail("Немає ключа кімнати.");
  const proof = await signProof(kp, "market", `unlist:${asset}`);
  const res = await callStrategy<{ ok: true; thawSig: string | null } | { ok: false; reason: string }>("market-unlist", { proof, asset });
  return res.ok ? { ok: true, sig: res.thawSig ?? "" } : fail(res.reason);
}

export async function buyOnChain(asset: string, priceLamports: number): Promise<Res> {
  const kp = await loadKeypair();
  if (!kp) return fail("Немає ключа кімнати.");
  if ((await hasLamports(priceLamports + BUY_HEADROOM_LAMPORTS)) === false) return fail(NO_SOL_REASON);
  const proof = await signProof(kp, "market", `buy:${asset}:${priceLamports}`);
  const prep = await callStrategy<{ ok: true; txs: string[] } | { ok: false; reason: string }>("market-prepare-buy", { proof, asset, priceLamports });
  if (!prep.ok) return fail(prep.reason);
  const sig = await sendTxs(prep.txs);
  const conf = await confirmLoop<{ ok: boolean; reason?: string }>("market-confirm-buy", { asset, sig });
  return conf.ok ? { ok: true, sig } : fail(conf.reason ?? "Купівлю не підтверджено.");
}

export type MarketItem = StrategyInfo & { priceLamports: number };

export async function readMarket(): Promise<MarketItem[]> {
  const res = await callStrategy<{ ok: true; items: MarketItem[] } | { ok: false; reason: string }>("market-list", {});
  return res.ok ? res.items : [];
}

export async function readStrategyInfo(asset: string): Promise<(StrategyInfo & { ok: true }) | { ok: false; reason: string }> {
  return callStrategy("strategy-info", { asset });
}

export type { StrategySpec };

/** Judge onboarding fallback: the server's devnet faucet (rate-limited) when the public airdrop is limited. */
export async function serverFaucet(): Promise<{ ok: true; sig: string; lamports: number; via?: "faucet" | "airdrop" } | { ok: false; reason: string }> {
  const kp = await loadKeypair();
  if (!kp) return { ok: false, reason: "Немає ключа кімнати." };
  const proof = await signProof(kp, "faucet", "devnet");
  return callStrategy("faucet-drip", { proof });
}
