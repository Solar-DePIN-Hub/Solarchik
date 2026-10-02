/**
 * Web Sol actions: browser I/O around the pure planner (sol-act-plan.ts).
 * - context: the room wallet's own agents (store + on-chain strategy-info) and the devnet market;
 * - ask: POST /api/native/sol-act (Gemini structured output), offline keyword parser as fallback;
 * - execute: ONLY called from the confirmation card's Confirm button. Runs the same flows as the
 *   work desk (strategy-client buyOnChain / saveChainStrategy, store.buyLiveSku, runAsset / pauseAsset).
 * The heavy agent store and web3 are loaded lazily, so plain chat stays light.
 */
import type { ActCtx, CtxAgent, CtxListing, SolAction } from "./sol-actions";
import { normalizeAction } from "./sol-actions";
import { parseLocal, solOf, tx, SALE_LOCK_H, type ActLang, type ActPlan, type ActSide } from "./sol-act-plan";

const NATIVE = import.meta.env.VITE_NATIVE === "1";
const ACT_URL = `${NATIVE ? "https://solarchik-market.vercel.app" : ""}/api/native/sol-act`;
const CACHE_MS = 45_000;
const FREE_SKU = "sku-pred-alpha";

export type Loaded = { ctx: ActCtx; side: ActSide; at: number };
let cache: Loaded | null = null;
export const dropActCache = () => {
  cache = null;
};

async function store() {
  const { useAgents } = await import("@/lib/agents/store");
  await useAgents.getState().hydrate();
  return useAgents;
}

export async function loadActContext(force = false): Promise<Loaded> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const useAgents = await store();
  const st = useAgents.getState();
  const wallet = st.wallet ?? (await st.ensureWallet());
  const { readMarket, readStrategyInfo } = await import("@/lib/agents/strategy-client");
  const { liveCatalog } = await import("@/lib/agents/catalog");
  const owned = st.nfts.filter((n) => n.owner === wallet.pubkey && n.asset.length >= 32 && !n.asset.startsWith("local-")).slice(0, 8);
  const [infos, market] = await Promise.all([
    Promise.all(owned.map((n) => readStrategyInfo(n.asset).catch(() => ({ ok: false as const, reason: "" })))),
    readMarket().catch(() => []),
  ]);
  const agents = useAgents.getState().agents;
  const side: ActSide = { agents: {}, listings: {}, freeName: liveCatalog().find((s) => s.id === FREE_SKU)?.nft.name ?? "Free agent" };
  const ctxAgents: CtxAgent[] = owned.map((n, i) => {
    const info = infos[i];
    const chain = info.ok ? info.chain : null;
    const spec = chain?.spec ?? n.chainSpec?.spec;
    const perf = info.ok ? info.perf : n.chainSpec?.perf ?? null;
    const listed = info.ok && !!info.listing && (info.listing.status === "active" || info.listing.status === "pending");
    side.agents[n.asset] = { spec: spec ? { ...spec } : undefined, listed, version: chain?.version, aprSince: perf?.aprSince ?? null };
    return {
      id: n.asset,
      name: n.name,
      running: Object.values(agents).some((a) => a.sourceAsset === n.asset && a.status === "working"),
      strategyNft: !!chain,
      risk: spec?.risk,
      windows: spec?.windows,
      trades: perf?.trades,
      pnlSol: perf ? Number(perf.realizedSol.toFixed(4)) : undefined,
    };
  });
  const ctxMarket: CtxListing[] = market
    .filter((m) => m.owner !== wallet.pubkey)
    .slice(0, 20)
    .map((m) => {
      side.listings[m.asset] = { priceLamports: m.priceLamports, spec: m.chain?.spec ? { ...m.chain.spec } : undefined };
      return { id: m.asset, name: m.name, priceSol: Number(solOf(m.priceLamports)), risk: m.chain?.spec.risk, windows: m.chain?.spec.windows };
    });
  const canMintFree = !st.nfts.some((n) => n.owner === wallet.pubkey && n.tier === "free");
  cache = { ctx: { agents: ctxAgents, market: ctxMarket, canMintFree }, side, at: Date.now() };
  return cache;
}

export type AskResult = { action: SolAction | null; reply: string; via: "server" | "local"; model?: string };

/** Chat-to-action: the server proposes, the browser re-checks against its own context. */
export async function askAct(message: string, lang: ActLang, ctx: ActCtx, history: { role: string; text: string }[] = []): Promise<AskResult> {
  try {
    const res = await fetch(ACT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, language: lang, context: ctx, history: history.slice(-6) }),
      signal: AbortSignal.timeout(12_000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; action?: unknown; reply?: string; model?: string } | null;
    if (res.ok && json?.ok) {
      const action = json.action ? normalizeAction({ ...(json.action as Record<string, unknown>), action: (json.action as { type?: string }).type }, ctx) : null;
      return { action, reply: String(json.reply ?? ""), via: "server", model: json.model };
    }
  } catch {
    /* route down or offline: keyword fallback below */
  }
  return { action: parseLocal(message, ctx), reply: "", via: "local" };
}

export type ActResult = { ok: boolean; text: string; sig?: string; link?: string };

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** Runs a confirmed plan. Never called without the card's Confirm tap. */
export async function executePlan(plan: ActPlan, loaded: Loaded, lang: ActLang): Promise<ActResult> {
  if (plan.blocked) return { ok: false, text: plan.blockedText ?? "" };
  const a = plan.action;
  const agent = loaded.ctx.agents.find((x) => x.id === a.agent);
  const listing = loaded.ctx.market.find((x) => x.id === a.listing);
  const fail = (why: string): ActResult => ({ ok: false, text: tx(lang, "failed", { why: why || "?" }) });
  try {
    const useAgents = await store();
    switch (a.type) {
      case "buy_strategy": {
        if (!listing || plan.priceLamports == null) return fail(tx(lang, "gone"));
        const { buyOnChain } = await import("@/lib/agents/strategy-client");
        const r = await buyOnChain(listing.id, plan.priceLamports);
        if (!r.ok) return fail(r.reason);
        await useAgents.getState().refreshAsset(listing.id);
        dropActCache();
        return { ok: true, sig: r.sig, link: explorerTx(r.sig), text: tx(lang, "bought", { name: listing.name, sol: solOf(plan.priceLamports) }) };
      }
      case "set_strategy": {
        if (!agent || !plan.next) return fail(tx(lang, "noNft"));
        const { saveChainStrategy, readStrategyInfo } = await import("@/lib/agents/strategy-client");
        const r = await saveChainStrategy(agent.id, plan.next);
        if (!r.ok) return fail(r.reason);
        const info = await readStrategyInfo(agent.id).catch(() => null);
        const v = info && info.ok && info.chain ? info.chain.version : (loaded.side.agents[agent.id]?.version ?? 0) + 1;
        await useAgents.getState().refreshAsset(agent.id);
        dropActCache();
        return { ok: true, sig: r.sig, link: explorerTx(r.sig), text: tx(lang, "strategyDone", { name: agent.name, v, h: SALE_LOCK_H }) };
      }
      case "mint_free": {
        const before = useAgents.getState().log.length;
        const ok = await useAgents.getState().buyLiveSku(FREE_SKU);
        const st = useAgents.getState();
        if (!ok) return fail(st.notice ?? "");
        const row = st.log.slice(before).reverse().find((l) => l.kind === "system" && /^[1-9A-HJ-NP-Za-km-z]{60,90}$/.test(l.id));
        const minted = st.nfts[st.nfts.length - 1];
        dropActCache();
        return { ok: true, sig: row?.id, link: row ? explorerTx(row.id) : undefined, text: tx(lang, "minted", { name: minted?.name ?? loaded.side.freeName }) };
      }
      case "start_agent": {
        if (!agent) return fail(tx(lang, "noAgent"));
        useAgents.getState().runAsset(agent.id);
        dropActCache();
        return { ok: true, text: tx(lang, "started", { name: agent.name }) };
      }
      case "stop_agent": {
        if (!agent) return fail(tx(lang, "noAgent"));
        useAgents.getState().pauseAsset(agent.id);
        dropActCache();
        return { ok: true, text: tx(lang, "stopped", { name: agent.name }) };
      }
      default:
        return fail("");
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
