/**
 * Sol "do things" mode (0.21.7): the chat model turns a request into ONE structured action.
 * Pure helpers (no I/O) so the server, the tests and the phone agree on the shape. Nothing here
 * executes anything: the app shows a confirmation card and runs the real devnet flow only on tap.
 */
export const ACTION_TYPES = ["none", "set_strategy", "buy_strategy", "mint_free", "start_agent", "stop_agent", "agent_status"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const RISKS = ["calm", "balanced", "risky"] as const;
export type Risk = (typeof RISKS)[number];
export const WINDOWS = [5, 15, 60, 240] as const;

export interface CtxAgent {
  id: string;
  name: string;
  running?: boolean;
  strategyNft?: boolean;
  risk?: string;
  windows?: number[];
  pnlSol?: number;
  trades?: number;
}
export interface CtxListing {
  id: string;
  name: string;
  priceSol: number;
  risk?: string;
  windows?: number[];
}
export interface ActCtx {
  agents: CtxAgent[];
  market: CtxListing[];
  canMintFree?: boolean;
}

export interface SolAction {
  type: Exclude<ActionType, "none">;
  agent?: string;
  listing?: string;
  risk?: Risk;
  windows?: number[];
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function readCtx(raw: unknown): ActCtx {
  const r = (raw ?? {}) as Record<string, unknown>;
  const agents = (Array.isArray(r.agents) ? r.agents : []).slice(0, 12).map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    return {
      id: str(o.id, 64),
      name: str(o.name, 48),
      running: o.running === true,
      strategyNft: o.strategyNft === true,
      risk: str(o.risk, 12) || undefined,
      windows: Array.isArray(o.windows) ? o.windows.map(Number).filter((w) => (WINDOWS as readonly number[]).includes(w)) : undefined,
      pnlSol: num(o.pnlSol),
      trades: num(o.trades),
    };
  }).filter((a) => a.id && a.name);
  const market = (Array.isArray(r.market) ? r.market : []).slice(0, 20).map((m) => {
    const o = (m ?? {}) as Record<string, unknown>;
    return {
      id: str(o.id, 64),
      name: str(o.name, 48),
      priceSol: num(o.priceSol) ?? 0,
      risk: str(o.risk, 12) || undefined,
      windows: Array.isArray(o.windows) ? o.windows.map(Number).filter((w) => (WINDOWS as readonly number[]).includes(w)) : undefined,
    };
  }).filter((m) => m.id && m.name);
  return { agents, market, canMintFree: r.canMintFree === true };
}

/** What the model sees: short ids (a1, m1) so it never has to copy a 44-char address. */
export function ctxLines(ctx: ActCtx): string {
  const a = ctx.agents.map((x, i) =>
    `a${i + 1}: ${x.name}${x.strategyNft ? " [strategy NFT]" : ""}; ${x.running ? "running" : "stopped"}` +
    (x.risk ? `; risk ${x.risk}` : "") + (x.windows?.length ? `; windows ${x.windows.join("/")}m` : "") +
    (x.trades != null ? `; trades ${x.trades}` : "") + (x.pnlSol != null ? `; pnl ${x.pnlSol} SOL` : ""),
  );
  const m = ctx.market.map((x, i) => `m${i + 1}: ${x.name}; ${x.priceSol} SOL` + (x.risk ? `; risk ${x.risk}` : "") + (x.windows?.length ? `; windows ${x.windows.join("/")}m` : ""));
  return [
    "MY AGENTS:", ...(a.length ? a : ["(none)"]),
    "MARKET (strategy NFTs for sale, devnet):", ...(m.length ? m : ["(empty)"]),
    `FREE MINT AVAILABLE: ${ctx.canMintFree ? "yes" : "no"}`,
  ].join("\n");
}

function pick<T extends { id: string }>(ref: unknown, list: T[], prefix: string): T | undefined {
  const s = str(ref, 64);
  const m = new RegExp(`^${prefix}(\\d{1,2})$`).exec(s);
  if (m) return list[Number(m[1]) - 1];
  return list.find((x) => x.id === s);
}

/**
 * Model output → a safe action or null. Every target must exist in the phone's own context, risk
 * and windows must be legal spec values, and a strategy change must change something.
 */
export function normalizeAction(raw: unknown, ctx: ActCtx): SolAction | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const type = str(r.action ?? r.type, 20) as ActionType;
  if (!(ACTION_TYPES as readonly string[]).includes(type) || type === "none") return null;
  const agent = pick(r.agent, ctx.agents, "a");
  const listing = pick(r.listing, ctx.market, "m");
  const risk = (RISKS as readonly string[]).includes(str(r.risk, 12)) ? (str(r.risk, 12) as Risk) : undefined;
  const windows = Array.isArray(r.windows)
    ? [...new Set(r.windows.map(Number))].filter((w) => (WINDOWS as readonly number[]).includes(w)).sort((a, b) => a - b)
    : [];
  switch (type) {
    case "buy_strategy":
      return listing ? { type, listing: listing.id } : null;
    case "mint_free":
      return { type };
    case "start_agent":
    case "stop_agent":
    case "agent_status": {
      const only = ctx.agents.length === 1 ? ctx.agents[0] : undefined;
      const a = agent ?? only;
      return a ? { type, agent: a.id } : null;
    }
    case "set_strategy": {
      const nfts = ctx.agents.filter((x) => x.strategyNft);
      const a = agent ?? (nfts.length === 1 ? nfts[0] : undefined);
      if (!a) return null;
      if (!risk && !windows.length && !listing) return null;
      const out: SolAction = { type, agent: a.id };
      if (risk) out.risk = risk;
      if (windows.length) out.windows = windows;
      if (listing) out.listing = listing.id;
      return out;
    }
  }
  return null;
}

export const ACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING", description: "One or two short sentences to the player in the requested language." },
    action: { type: "STRING", enum: [...ACTION_TYPES] },
    agent: { type: "STRING", description: "Id of my agent (a1, a2, ...) or empty." },
    listing: { type: "STRING", description: "Id of a market listing (m1, m2, ...) or empty." },
    risk: { type: "STRING", enum: [...RISKS] },
    windows: { type: "ARRAY", items: { type: "INTEGER" } },
  },
  required: ["reply", "action"],
  propertyOrdering: ["action", "agent", "listing", "risk", "windows", "reply"],
} as const;

export function actionPrompt(lang: "uk" | "en"): string {
  return [
    "You are Sol, the sunny helper inside the Solarchik game on Solana devnet. The player talks to you to CONTROL their trading agents.",
    "Turn the request into at most ONE action from the list. Never invent ids: use only ids from the context.",
    "- set_strategy: change risk and/or time windows of MY agent with a [strategy NFT] (low/safe/calm = calm, medium/normal = balanced, high/aggressive = risky; 5m, 15m, 1h = 60, 4h = 240). 'set strategy <market name>' = set_strategy with that listing id as a template for my agent.",
    "- buy_strategy: buy a listing from MARKET (the app will ask the wallet to pay).",
    "- mint_free: mint the free agent NFT.",
    "- start_agent / stop_agent: start or pause/stop one of my agents.",
    "- agent_status: how my agent is doing.",
    "- none: anything else (chat, unclear request, missing target). Then ask a short clarifying question or just answer.",
    "windows: exactly the windows the player named (\"5m\" or \"5 хвилин\" = [5] only); leave empty if none named.",
    "Never say an action is done or started: the app shows a confirmation card and only the player's tap executes it. Say what you prepared and ask to confirm.",
    "Never show ids like a1 or m2 to the player: use names.",
    lang === "uk"
      ? "Reply field: Ukrainian only (no Russian), friendly, 1-2 short sentences, e.g. 'Готово до підтвердження: ...'."
      : "Reply field: English only, friendly, 1-2 short sentences.",
  ].join("\n");
}

/** Agent/listing names are Latin on chain; drop them before the language guard looks at the reply. */
export function withoutNames(reply: string, ctx: ActCtx): string {
  let out = reply;
  const names = [...ctx.agents.map((a) => a.name), ...ctx.market.map((m) => m.name)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const n of names) out = out.split(n).join(" ");
  // The model often shortens a name ("Momentum Rider" for "Momentum Rider 5m"): drop every word of a known name too.
  const words = new Set(names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 2));
  out = out.replace(/[A-Za-z][A-Za-z0-9]*/g, (w) => (words.has(w.toLowerCase()) ? " " : w));
  return out.replace(/\b[am]\d{1,2}\b/g, " ").replace(/\b\d+\s*(m|h|min)\b/gi, " ");
}
