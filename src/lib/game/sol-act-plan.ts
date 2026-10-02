/**
 * Web Sol "do things" (0.21.8): pure planning on the browser side of the chat-to-action route.
 * The server (sol-act) or the offline parser proposes ONE action; this module checks it against the
 * player's own context and builds the confirmation card (what changes, price, sale lock). Nothing
 * here executes anything: only the card's Confirm button runs the devnet flow (sol-act-web.ts).
 * Same rules as the phone (android sol/SolActions.kt), so web and app behave alike.
 */
import { WINDOWS, normalizeAction, type ActCtx, type SolAction } from "./sol-actions.ts";

export type ActLang = "uk" | "en";
export const actLang = (locale: string | undefined): ActLang => (locale === "uk" ? "uk" : "en");

/** Strategy spec as stored on chain (strategy-spec.ts StrategySpec), kept structural so this file stays pure. */
export type Spec = Record<string, unknown>;

/** Browser-only facts behind the ids the model sees (never sent to the server). */
export interface ActSide {
  agents: Record<string, { spec?: Spec; listed?: boolean; version?: number; aprSince?: number | null }>;
  listings: Record<string, { priceLamports: number; spec?: Spec }>;
  freeName: string;
}

export type Blocked = "gone" | "free_used" | "already_running" | "already_stopped" | "no_strategy_nft" | "listed" | "same" | "no_agent";

export interface ActPlan {
  action: SolAction;
  /** Card title, already localized. */
  title: string;
  changes: { key: string; label: string; from: string; to: string }[];
  next?: Spec;
  /** 0 = free; undefined = no transaction (local desk start/stop/status). */
  priceLamports?: number;
  locksSale: boolean;
  /** True when the wallet must sign a devnet transaction. */
  onChain: boolean;
  blocked?: Blocked;
  blockedText?: string;
  templateName?: string;
}

/* ---------------- offline / quick intent parser (EN + UK), same as the phone ---------------- */

const BUY = /\b(buy|purchase|get me)\b|купи|купити|придбай|придбати/i;
const MINT = /\bmint\b|змінт|мінт/i;
const STOP = /\b(pause|stop|halt|turn off)\b|зупини|зупинити|пауз|призупини|вимкни|стоп/i;
const START = /\b(start|resume|launch|turn on|run my)\b|запусти|запустити|увімкни|старт|віднови/i;
const STATUS = /how('s| is| are)\b.*\b(agent|doing|going)|\bstatus\b|\bdoing\b|як там|як справи|як працює|стан агента|результат/i;
const CHANGE = /\b(change|set|switch|make|move|use)\b|змін|постав|встанов|переключ|зроби|заміни|використ/i;
const STRATEGY = /strateg|стратег|risk|ризик|\d+\s*(m|min|h|хв|год)(?![\p{L}])|hourly|щогодин/iu;
const CALM = /\b(low|safe|calm|careful|conservative)\b|низьк|безпечн|спокійн|обережн/i;
const BALANCED = /\b(medium|balanced|normal|moderate)\b|середн|збалансован|помірн/i;
const RISKY = /\b(high|aggressive|risky|bold)\b|висок|агресивн|ризикован|ризиков|сміли/i;
const MINUTES = /(\d{1,3})\s*(m|min|mins|minutes?|хв|хвилин[аиу]?)(?![\p{L}])/giu;
const HOURS = /(\d{1,2})\s*(h|hr|hours?|год|годин[аиу]?)(?![\p{L}])/giu;
const HOURLY = /hourly|щогодин|1\s*год/i;

/** True when the message reads like a request to DO something (sent to the action route, not plain chat). */
export function looksLikeCommand(msg: string): boolean {
  const m = msg.trim();
  if (!m || m.length > 200) return false;
  return BUY.test(m) || MINT.test(m) || STOP.test(m) || START.test(m) || STATUS.test(m) || (CHANGE.test(m) && STRATEGY.test(m));
}

export function riskOf(msg: string): "calm" | "balanced" | "risky" | "" {
  if (CALM.test(msg)) return "calm";
  if (RISKY.test(msg)) return "risky";
  if (BALANCED.test(msg)) return "balanced";
  return "";
}

export function windowsIn(msg: string): number[] {
  const out: number[] = [];
  for (const m of msg.matchAll(MINUTES)) out.push(Number(m[1]));
  for (const m of msg.matchAll(HOURS)) out.push(Number(m[1]) * 60);
  if (HOURLY.test(msg)) out.push(60);
  return [...new Set(out.filter((w) => (WINDOWS as readonly number[]).includes(w)))].sort((a, b) => a - b);
}

const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/** Best name match by shared words (at least one); a tie means "not sure", so nothing. */
export function byName<T extends { name: string }>(msg: string, items: T[]): T | undefined {
  const said = new Set(tokens(msg));
  const scored = items.map((it) => [it, tokens(it.name).filter((w) => said.has(w)).length] as const).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  if (!scored.length) return undefined;
  if (scored.length > 1 && scored[0][1] === scored[1][1]) return undefined;
  return scored[0][0];
}

/** Offline fallback when the action route is down: keyword intent, then the same normalizeAction checks. */
export function parseLocal(msg: string, ctx: ActCtx): SolAction | null {
  const listing = byName(msg, ctx.market);
  const agent = byName(msg, ctx.agents);
  const raw = ((): Record<string, unknown> | null => {
    if (BUY.test(msg)) return listing ? { action: "buy_strategy", listing: listing.id } : null;
    if (MINT.test(msg)) return { action: "mint_free" };
    if (STOP.test(msg)) {
      const a = agent ?? (ctx.agents.filter((x) => x.running).length === 1 ? ctx.agents.find((x) => x.running) : undefined);
      return a ? { action: "stop_agent", agent: a.id } : null;
    }
    if (START.test(msg)) return { action: "start_agent", agent: agent?.id ?? "" };
    if ((CHANGE.test(msg) && STRATEGY.test(msg)) || (CHANGE.test(msg) && listing)) {
      const nfts = ctx.agents.filter((x) => x.strategyNft);
      const a = agent?.strategyNft ? agent : nfts.length === 1 ? nfts[0] : undefined;
      if (!a) return null;
      const tpl = listing && listing.name !== a.name ? listing : undefined;
      return { action: "set_strategy", agent: a.id, listing: tpl?.id ?? "", risk: riskOf(msg), windows: windowsIn(msg) };
    }
    if (STATUS.test(msg)) {
      const a = agent ?? (ctx.agents.length === 1 ? ctx.agents[0] : ctx.agents.find((x) => x.running));
      return a ? { action: "agent_status", agent: a.id } : null;
    }
    return null;
  })();
  return raw ? normalizeAction(raw, ctx) : null;
}

/* ---------------- texts (EN/UK; the action route answers in these two) ---------------- */

export const ACT_TEXT = {
  en: {
    card: "Sol will do this — after your tap",
    ready: "Ready to confirm: {what}. Check the card and tap Confirm.",
    titleBuy: "Buy strategy NFT “{name}”",
    titleStrategy: "Change the strategy of “{name}”",
    titleMint: "Mint the free agent “{name}”",
    titleStart: "Start agent “{name}”",
    titleStop: "Pause agent “{name}”",
    titleStatus: "Status of “{name}”",
    price: "Price: {sol} SOL + devnet network fee",
    priceFree: "Price: free (devnet network fee and account rent only)",
    priceStrategy: "Price: 0 SOL (devnet network fee only)",
    lock: "A strategy change locks selling this NFT for {h} h (the 240 h sale lock).",
    template: "Template: {name}",
    local: "Runs in this browser's work desk: no transaction, no SOL.",
    wallet: "Your room wallet (devnet key in this browser) signs. Nothing happens before you confirm.",
    confirm: "Confirm",
    cancel: "Cancel",
    cancelled: "Cancelled. Nothing was changed.",
    working: "Working on it… signing on devnet.",
    bought: "Done: you bought {name} for {sol} SOL.",
    strategyDone: "Done: {name} now runs strategy v{v}. Selling is locked for {h} h.",
    minted: "Done: minted {name}.",
    started: "Done: {name} is running in the work desk.",
    stopped: "Done: {name} is paused.",
    failed: "That didn't go through: {why}",
    explorer: "Open in Solana Explorer (devnet) ↗",
    unclear: "Tell me which agent or NFT, for example “buy Momentum Rider 5m” or “set my agent to low risk 5m”.",
    gone: "That listing is no longer on the market.",
    freeUsed: "This wallet already has its free agent.",
    running: "{name} is already running.",
    paused: "{name} is already paused.",
    noNft: "Strategy changes work on Strategy NFTs (server collection). Buy one on the market or mint the free agent first.",
    listed: "{name} is listed for sale. Unlist it first.",
    same: "That is already the current strategy: nothing to change.",
    noAgent: "I can't find that agent in this browser's wallet.",
    statusLine: "{name} is {state}. Trades: {n}, PnL {pnl} SOL.",
    statusStrategy: "Strategy: {risk} risk, {w} min windows, APR since the last change {apr}.",
    stRunning: "running",
    stPaused: "paused",
    chg: { risk: "Risk", windows: "Windows (min)", stakeSol: "Stake (SOL)", askLo: "Price from", askHi: "Price to", edgeBps: "Edge (bps)", stopPct: "Stop %", takePct: "Take %", rules: "Rules", lanes: "Lanes" },
    risk: { calm: "Calm", balanced: "Balanced", risky: "Risky" },
  },
  uk: {
    card: "Сол зробить це — після твого натискання",
    ready: "Готово до підтвердження: {what}. Перевір картку й натисни «Підтвердити».",
    titleBuy: "Купити NFT-стратегію «{name}»",
    titleStrategy: "Змінити стратегію «{name}»",
    titleMint: "Змінтити безкоштовного агента «{name}»",
    titleStart: "Запустити агента «{name}»",
    titleStop: "Призупинити агента «{name}»",
    titleStatus: "Стан «{name}»",
    price: "Ціна: {sol} SOL + комісія мережі devnet",
    priceFree: "Ціна: безкоштовно (лише комісія мережі devnet і рента акаунта)",
    priceStrategy: "Ціна: 0 SOL (лише комісія мережі devnet)",
    lock: "Зміна стратегії блокує продаж цього NFT на {h} год (замок продажу 240 год).",
    template: "Шаблон: {name}",
    local: "Працює в робочому столі цього браузера: без транзакції і без SOL.",
    wallet: "Підписує гаманець кімнати (devnet-ключ у цьому браузері). Без підтвердження нічого не станеться.",
    confirm: "Підтвердити",
    cancel: "Скасувати",
    cancelled: "Скасовано. Нічого не змінено.",
    working: "Виконую… підписую в devnet.",
    bought: "Готово: ти купив {name} за {sol} SOL.",
    strategyDone: "Готово: {name} тепер на стратегії v{v}. Продаж заблоковано на {h} год.",
    minted: "Готово: змінтовано {name}.",
    started: "Готово: {name} працює в робочому столі.",
    stopped: "Готово: {name} на паузі.",
    failed: "Не вдалося: {why}",
    explorer: "Відкрити в Solana Explorer (devnet) ↗",
    unclear: "Скажи, який агент чи NFT, наприклад «купи Momentum Rider 5m» або «постав моєму агенту низький ризик 5 хв».",
    gone: "Цього лота вже немає на ринку.",
    freeUsed: "У цього гаманця вже є безкоштовний агент.",
    running: "{name} уже працює.",
    paused: "{name} уже на паузі.",
    noNft: "Стратегію можна змінити лише в NFT-стратегії (колекція сервера). Спершу купи її на ринку або змінть безкоштовного агента.",
    listed: "{name} виставлено на продаж. Спершу зніми з продажу.",
    same: "Це вже поточна стратегія: нічого змінювати.",
    noAgent: "Не бачу такого агента в гаманці цього браузера.",
    statusLine: "{name} {state}. Угод: {n}, PnL {pnl} SOL.",
    statusStrategy: "Стратегія: ризик «{risk}», вікна {w} хв, APR від останньої зміни {apr}.",
    stRunning: "працює",
    stPaused: "на паузі",
    chg: { risk: "Ризик", windows: "Вікна (хв)", stakeSol: "Ставка (SOL)", askLo: "Ціна від", askHi: "Ціна до", edgeBps: "Перевага (bps)", stopPct: "Стоп %", takePct: "Тейк %", rules: "Правила", lanes: "Смуги" },
    risk: { calm: "спокійний", balanced: "збалансований", risky: "ризиковий" },
  },
} as const;

type FlatKey = Exclude<keyof (typeof ACT_TEXT)["en"], "chg" | "risk">;
export function tx(lang: ActLang, key: FlatKey, vars: Record<string, string | number> = {}): string {
  let s: string = ACT_TEXT[lang][key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export const SALE_LOCK_H = 240;
export const solOf = (lamports: number) => String(Number((lamports / 1e9).toFixed(4)));

function riskName(lang: ActLang, r: unknown): string {
  const k = String(r ?? "") as keyof (typeof ACT_TEXT)["en"]["risk"];
  return ACT_TEXT[lang].risk[k] ?? String(r ?? "—");
}

function show(lang: ActLang, key: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (key === "risk") return riskName(lang, v);
  if (Array.isArray(v)) return v.join("/");
  return String(v);
}

/** current spec ← template's spec (lanes kept: they are what the NFT class can do) ← explicit risk / windows. */
export function nextSpec(current: Spec, template: Spec | undefined, risk?: string, windows?: number[]): Spec {
  const out: Spec = { ...current };
  if (template) for (const [k, v] of Object.entries(template)) if (k !== "lanes") out[k] = Array.isArray(v) ? [...v] : v;
  if (risk) out.risk = risk;
  if (windows?.length) out.windows = [...windows];
  return out;
}

const CHANGE_KEYS = ["risk", "windows", "stakeSol", "askLo", "askHi", "edgeBps", "stopPct", "takePct", "rules"] as const;

export function planAction(action: SolAction, ctx: ActCtx, side: ActSide, lang: ActLang): ActPlan {
  const agent = ctx.agents.find((a) => a.id === action.agent);
  const listing = ctx.market.find((m) => m.id === action.listing);
  const L = ACT_TEXT[lang];
  const block = (p: ActPlan, b: Blocked, name = ""): ActPlan => ({
    ...p,
    blocked: b,
    blockedText:
      b === "gone" ? L.gone
      : b === "free_used" ? L.freeUsed
      : b === "already_running" ? tx(lang, "running", { name })
      : b === "already_stopped" ? tx(lang, "paused", { name })
      : b === "no_strategy_nft" ? L.noNft
      : b === "listed" ? tx(lang, "listed", { name })
      : b === "same" ? L.same
      : L.noAgent,
  });
  switch (action.type) {
    case "buy_strategy": {
      const price = listing ? side.listings[listing.id]?.priceLamports : undefined;
      const p: ActPlan = { action, title: tx(lang, "titleBuy", { name: listing?.name ?? "?" }), changes: [], priceLamports: price, locksSale: false, onChain: true };
      return listing && price != null ? p : block(p, "gone");
    }
    case "mint_free": {
      const p: ActPlan = { action, title: tx(lang, "titleMint", { name: side.freeName }), changes: [], priceLamports: 0, locksSale: false, onChain: true };
      return ctx.canMintFree ? p : block(p, "free_used");
    }
    case "start_agent":
    case "stop_agent":
    case "agent_status": {
      const key = action.type === "start_agent" ? "titleStart" : action.type === "stop_agent" ? "titleStop" : "titleStatus";
      const p: ActPlan = { action, title: tx(lang, key, { name: agent?.name ?? "?" }), changes: [], locksSale: false, onChain: false };
      if (!agent) return block(p, "no_agent");
      if (action.type === "start_agent" && agent.running) return block(p, "already_running", agent.name);
      if (action.type === "stop_agent" && !agent.running) return block(p, "already_stopped", agent.name);
      return p;
    }
    case "set_strategy": {
      const facts = agent ? side.agents[agent.id] : undefined;
      const p: ActPlan = { action, title: tx(lang, "titleStrategy", { name: agent?.name ?? "?" }), changes: [], priceLamports: 0, locksSale: true, onChain: true };
      if (!agent || !agent.strategyNft || !facts?.spec) return block(p, "no_strategy_nft");
      if (facts.listed) return block(p, "listed", agent.name);
      const tpl = listing ? side.listings[listing.id]?.spec : undefined;
      const next = nextSpec(facts.spec, tpl, action.risk, action.windows);
      const changes = CHANGE_KEYS.map((k) => ({ key: k, label: L.chg[k], from: show(lang, k, facts.spec?.[k]), to: show(lang, k, next[k]) })).filter((c) => c.from !== c.to);
      const out: ActPlan = { ...p, next, changes, templateName: listing?.name };
      return changes.length ? out : block(out, "same");
    }
  }
}

/** One-line status for agent_status (no transaction, no confirmation needed). */
export function statusText(agentId: string, ctx: ActCtx, side: ActSide, lang: ActLang): string {
  const a = ctx.agents.find((x) => x.id === agentId);
  if (!a) return ACT_TEXT[lang].noAgent;
  const line = tx(lang, "statusLine", {
    name: a.name,
    state: a.running ? ACT_TEXT[lang].stRunning : ACT_TEXT[lang].stPaused,
    n: a.trades ?? 0,
    pnl: (a.pnlSol ?? 0).toFixed(4),
  });
  if (!a.strategyNft) return line;
  const apr = side.agents[a.id]?.aprSince;
  return `${line} ${tx(lang, "statusStrategy", { risk: riskName(lang, a.risk), w: a.windows?.join("/") || "—", apr: apr == null ? "—" : `${apr}%` })}`;
}

/** Card text the model's reply is replaced with when it is empty or in the wrong language. */
export function readyText(plan: ActPlan, lang: ActLang): string {
  return plan.blocked ? (plan.blockedText ?? "") : tx(lang, "ready", { what: plan.title });
}

/** Explorer links in Sol's chat bubbles (only this host, devnet): split text into plain / link parts. */
export function linkParts(text: string): { text: string; href?: string }[] {
  const re = /https:\/\/explorer\.solana\.com\/(?:tx|address)\/[1-9A-HJ-NP-Za-km-z]{32,90}\?cluster=devnet/g;
  const out: { text: string; href?: string }[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], href: m[0] });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
