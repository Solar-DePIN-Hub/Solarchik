import { create } from "zustand";
import { LAMPORTS_PER_SOL, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { SAVE_VERSION } from "./types";
import {
  aprFromClosed,
  clampStrategy,
  cryptoBand,
  defaultStrategy,
  eventsDaysOf,
  kindsForClass,
  laneEnabledOn,
  listEligible,
  quoteResaleSol,
  workClockOn,
} from "./classes";
import { liveCatalog } from "./catalog";
import { advanceAgent, commitBrain, emptyRuntimeLine, type ChainJob, type FillPatch, type Quote } from "./engine";
import { loadState, saveState, type LaneNote, type LastGrok, type PolyHold } from "./persist";
import { pickBestAsset, verifyWork } from "./verify";
import { createWallet, importRoomSecret, loadKeypair, loadMarketKeypair, loadWallet, peekStoredPubkey } from "./wallet";
import { ensurePolygonAddress, importPolygonSecret, loadPolygonAccount } from "./polygon";
import { holdRest, readPolyBalances, reviewClose, reviewPolymarket, reviewRedeem, scanRedeem, type GrokTrace, type PolyTicket } from "./poly";
import { readChainlinkTwap, type TwapSnapshot } from "./twap";
import { cancelPolyOrder, placePolyOrder, readPolyOrder, redeemPolyPosition, withdrawPusd as sendPusd } from "./poly-order";
import { liveQuotes } from "./shift";
import { readTitanKey } from "./titan-key";
import { coachAgent } from "./coach";
import { encodeBase58 } from "./base58";
import { confirmMainnetTx, peekMainnetSig, prepareMainnetSend, prepareMainnetSweep, readMainnetBalance, readMainnetUsdc, sendMainnetTx } from "./mainnet";
import { readArbCredit, writeArbCreditCache, addPendingCredit, readPendingCredits, dropPendingCredit } from "./arb-credit";
import type { ArbHouse } from "./arb-house";
import {
  callArbFire,
  callArbHouse,
  callClaimArbCredit,
  callMintStatus,
  callPrepareMint,
  callPrepareReissue,
  callReadArbCredit,
  callRecordFee,
} from "./server-calls";
import { proMemo } from "./mint-rules";
import { SIM_LABEL, cleanArbSymbol } from "./arb-rules";
import { signProof } from "./wallet-sign";
import { feeCovered, planFee, type FeeRow } from "./fee-ledger";
import { paySkuFromPlayer } from "./tier-pay";
import { readCaps, userTradeBlock } from "./user-limits";
import { loadSave } from "@/lib/game/save";
import { ARB_TREASURY, PAY_WALLET } from "@/lib/game/pay";
import { feeMemo } from "./payment-rules";
import { GROK_MODEL } from "./grok-model";
import { decideBet } from "./decide";
import { stepWeex } from "./weex";
import { buildJupiterSwap, buildStockSwap, quoteJupiter } from "./jupiter";
import { prepareBridge, readBridgeStatus, type BridgePlan } from "./bridge";
import type {
  AgentBrief,
  AgentFill,
  AgentKind,
  AgentNft,
  AgentRuntime,
  LogEntry,
  MarketListing,
  PredLane,
  StrategyBundle,
  Track,
  WalletRecord,
} from "./types";

async function loadChain() {
  return import("./chain");
}

const KINDS: AgentKind[] = ["prediction", "dex"];
const STACK = "Agent Kit + RIG";

function idleRuntimes(): Record<AgentKind, AgentRuntime> {
  return {
    prediction: bay("prediction"),
    dex: bay("dex"),
  };
}

function bay(kind: AgentKind): AgentRuntime {
  return {
    kind,
    status: "idle",
    sourceAsset: null,
    sourceClass: null,
    config: null,
    lastLine: emptyRuntimeLine(kind),
    brain: kind === "prediction" ? "RIG" : "Agent Kit",
    clockMin: 0,
    anchorPx: null,
    anchorLabel: null,
    epochStartedAt: null,
  };
}

export type TabId = "room" | "work" | "store" | "slice";

type AgentsState = {
  ready: boolean;
  tab: TabId;
  track: Track;
  wallet: WalletRecord | null;
  sol: number;
  /** False until a Devnet read returns a number. Cached sol is not a balance. */
  solKnown: boolean;
  /** True when the last Devnet read got no number. Do not show sol as 0. */
  solMiss: boolean;
  paperSol: number;
  nfts: AgentNft[];
  listings: MarketListing[];
  log: LogEntry[];
  fills: AgentFill[];
  feeLedger: FeeRow[];
  focusAsset: string | null;
  agents: Record<AgentKind, AgentRuntime>;
  working: boolean;
  aiBusy: boolean;
  aiCalls: number;
  betCalls: number;
  chainBusy: boolean;
  /** Human must confirm before any bet or DEX move leaves the device. */
  pendingTrade: PendingTrade | null;
  sessionCapSol: number;
  sessionSpent: number;
  dayKey: string;
  daySpent: number;
  lossStreak: number;
  haltReason: string | null;
  /** Phantom / phone wallet. Not the Devnet room key. */
  externalWallet: string | null;
  externalSol: number | null;
  /** Mainnet SOL of the room key. Null until the network answers, or when the answer was empty. */
  roomMainnetSol: number | null;
  /** True after a mainnet SOL read finished. Null + true is "немає цифри", not "читаю". */
  roomMainnetSolKnown: boolean;
  /** Mainnet USDC of the room key. Null until the network answers. */
  roomMainnetUsdc: number | null;
  roomMainnetUsdcKnown: boolean;
  /** Live Jupiter path. Off until Phantom is connected and both switches are on. */
  liveArmed: boolean;
  liveAck: boolean;
  /** Restored after a reload when it was on. */
  autoRun: boolean;
  liveSessionSpent: number;
  liveDaySpent: number;
  liveDayKey: string;
  liveLossStreak: number;
  secretSeen: boolean;
  /** Last mainnet swap signature. Null until one is sent. */
  lastLiveSig: string | null;
  /** True after that signature was counted or marked as an on-chain error. */
  lastLiveSigCounted: boolean;
  /** SOL size of lastLiveSig. Zero until a live swap is sent. */
  lastLiveAmount: number;
  /** When lastLiveSig was sent. Zero until a live swap is sent. */
  lastLiveAt: number;
  /** Fresh Jupiter out for the open live card. Null until the quote returns. */
  liveQuoteUsdc: number | null;
  brain: string | null;
  notice: string | null;
  quote: Quote | null;
  hydrate: () => Promise<void>;
  setTab: (tab: TabId) => void;
  setTrack: (track: Track) => void;
  ensureWallet: () => Promise<WalletRecord>;
  deposit: (sol: number) => Promise<void>;
  withdraw: (to: string, amount: number) => Promise<void>;
  sweepMainnetSol: () => Promise<void>;
  withdrawMainnet: (to: string, amount: number) => Promise<void>;
  fundArbDesk: (asset: string, sol: number) => Promise<void>;
  /** Claims an earlier mainnet deposit (signature) as arb credit. The server reads and records it once. */
  claimArbDeposit: (asset: string, sig: string) => Promise<boolean>;
  arbCredit: Record<string, number>;
  /** Server collection address (null: no server mint authority, or unknown). */
  mintCollection: string | null;
  /** Re-issue a pre-co-sign agent into the server collection; paySig keeps Pro. */
  reissueAgent: (asset: string, paySig?: string) => Promise<boolean>;
  arbHouse: ArbHouse | null;
  withdrawPusd: (to: string, amount: number) => Promise<void>;
  buySlice: (mint: string, sol: number) => Promise<void>;
  buyLiveSku: (id: string) => Promise<boolean>;
  pressWork: () => Promise<void>;
  armArb: () => void;
  stopWork: () => void;
  tick: (now: number) => void;
  pollQuote: () => Promise<void>;
  /** Re-read Devnet, mainnet SOL/USDC, POL, pUSD and bridge status. Keeps the last number if the network is silent. */
  refreshFigures: () => Promise<void>;
  saveStrategy: (asset: string, strategy: StrategyBundle) => void;
  setFocus: (asset: string) => void;
  runAsset: (asset: string) => void;
  pauseAsset: (asset: string) => void;
  withdrawLocked: (asset: string) => Promise<void>;
  coachAsset: (asset: string, guidance: string) => Promise<{ ok: true; reply: string } | { ok: false; error: string }>;
  listForSale: (asset: string) => void;
  buyListing: (id: string) => void;
  confirmTrade: () => void;
  rejectTrade: () => void;
  setExternalWallet: (pubkey: string | null, sol: number | null) => void;
  setLiveArmed: (on: boolean) => void;
  setLiveAck: (on: boolean) => void;
  setAutoRun: (on: boolean) => void;
  markSecretSeen: () => void;
  restoreRoomKey: (secret: string) => Promise<void>;
  restorePolygonKey: (secret: string) => Promise<void>;
  setLiveQuoteUsdc: (usdc: number | null) => void;
  polyAddress: string | null;
  polyPol: number | null;
  polyPusd: number | null;
  polyKnown: boolean;
  /** Last Chainlink TWAP read. Null until the server answers. */
  twap: TwapSnapshot | null;
  refreshTwap: () => Promise<void>;
  polyDayKey: string;
  polyDaySpent: number;
  polyOpenId: string | null;
  polyHold: PolyHold | null;
  polyBooks: PolyHold[];
  polyTicket: PolyTicket | null;
  polyCancel: { orderId: string } | null;
  polyRedeem: { tokenId: string; conditionId: string; negRisk: boolean; adapter: string } | null;
  polyBusy: boolean;
  /** True only while one Polymarket review is waiting on Grok. Not persisted. */
  grokFlight: boolean;
  lastGrok: LastGrok | null;
  laneNotes: LaneNote[];
  /** Epoch ms of the last events/weather Grok pass. Persisted. */
  lastEventsGrokAt: number;
  lastPolyOrder: string | null;
  lastPolyStatus: string | null;
  reviewPoly: (lane: "crypto" | "events" | "weather") => Promise<void>;
  confirmPoly: () => Promise<void>;
  rejectPoly: () => void;
  confirmPolyCancel: () => Promise<void>;
  rejectPolyCancel: () => void;
  confirmRedeem: () => Promise<void>;
  rejectRedeem: () => void;
  bridgeSvm: string | null;
  bridgeWhy: string | null;
  bridgePlan: BridgePlan | null;
  bridgeBusy: boolean;
  bridgeStatus: string | null;
  prepareBridgeDeposit: (open?: boolean) => Promise<void>;
  confirmBridge: () => Promise<void>;
  rejectBridge: () => void;
  persist: () => void;
};

function pushLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
  return [...log, entry].slice(-80);
}

const EVENTS_GROK_GAP_MS = 3_600_000;

function eventsCooldownText(at: number, now = Date.now()): string | null {
  if (!at) return null;
  const left = EVENTS_GROK_GAP_MS - (now - at);
  if (left <= 0) return null;
  const min = Math.max(1, Math.ceil(left / 60_000));
  return `Наступний розбір подій через ${min} хв.`;
}

const CRYPTO_SLOT = "Уже є крипто-нога. Нову не ставлю.";

const CRYPTO_NOTICE = new Set([
  "Зарано. Чекаю кінець вікна. Ордера немає.",
  "Дельта в шумі. Ордера немає.",
  "Немає свіжого Chainlink TWAP. Ордера немає.",
  "Край після ціни замалий. Ордера немає.",
  "Прогноз проти дельти. Ордера немає.",
  "Grok ще відповідає. Нову не ставлю.",
  CRYPTO_SLOT,
]);

function anyLane(state: { nfts: AgentNft[]; wallet: { pubkey: string } | null }, lane: PredLane): boolean {
  const owner = state.wallet?.pubkey;
  if (!owner) return false;
  return state.nfts.some((n) => n.owner === owner && n.classId !== 2 && laneEnabledOn(n.strategy.prediction, lane, n.classId));
}

function eventsHorizonH(state: { nfts: AgentNft[]; wallet: { pubkey: string } | null }): 24 | 48 {
  const owner = state.wallet?.pubkey;
  if (!owner) return 48;
  let days: 1 | 2 = 2;
  let seen = false;
  for (const n of state.nfts) {
    if (n.owner !== owner || n.classId === 2) continue;
    if (!laneEnabledOn(n.strategy.prediction, "events", n.classId)) continue;
    seen = true;
    if (eventsDaysOf(n.strategy.prediction) < days) days = 1;
  }
  return seen && days === 1 ? 24 : 48;
}

function noteLane(row: Omit<LaneNote, "at">) {
  const note: LaneNote = {
    at: Date.now(),
    lane: row.lane,
    market: row.market.replace(/\s+/g, " ").trim().slice(0, 120) || row.lane,
    action: row.action.slice(0, 16),
    pct: row.pct != null && Number.isFinite(row.pct) ? Math.min(1, Math.max(0, row.pct)) : null,
    why: row.why.replace(/\s+/g, " ").trim().slice(0, 180),
    orderId: row.orderId,
    status: row.status,
  };
  const prev = useAgents.getState().laneNotes ?? [];
  const last = prev[0];
  if (
    last &&
    last.lane === note.lane &&
    last.action === note.action &&
    last.why === note.why &&
    last.orderId === note.orderId &&
    note.at - last.at < 60_000
  ) {
    return;
  }
  useAgents.setState({ laneNotes: [note, ...prev].slice(0, 48) });
  useAgents.getState().persist();
}

function stampEventsGrok() {
  useAgents.setState({ lastEventsGrokAt: Date.now() });
  useAgents.getState().persist();
}

export type PendingTrade = {
  id: string;
  title: string;
  detail: string;
  amount: number;
  kind: "dex" | "prediction";
  network: "Devnet" | "Mainnet";
  from: string;
  to: string;
  honest: string;
  live: boolean;
};

function rememberGrok(trace: GrokTrace | null): LastGrok | null {
  if (!trace || trace.model !== GROK_MODEL) return null;
  if (trace.action !== "yes" && trace.action !== "no" && trace.action !== "skip" && trace.action !== "sell" && trace.action !== "hold") return null;
  if (typeof trace.confidence !== "number" || !Number.isFinite(trace.confidence)) return null;
  if (typeof trace.ms !== "number" || !Number.isFinite(trace.ms) || trace.ms < 0) return null;
  return {
    action: trace.action,
    confidence: Math.min(1, Math.max(0, trace.confidence)),
    why: trace.why,
    ms: trace.ms,
    lane: trace.lane,
    question: trace.question,
    priceToBeat: trace.priceToBeat,
    currentRef: trace.currentRef,
    delta: trace.delta,
    secondsLeft: trace.secondsLeft,
    windowLabel: trace.windowLabel,
    twapLine: trace.twapLine,
    entryAsk: typeof trace.entryAsk === "number" && Number.isFinite(trace.entryAsk) ? trace.entryAsk : null,
  };
}

function ticketGrok(ticket: PolyTicket): LastGrok | null {
  if (ticket.model !== GROK_MODEL) return null;
  if (ticket.action !== "yes" && ticket.action !== "no" && ticket.action !== "sell") return null;
  if (!Number.isFinite(ticket.confidence)) return null;
  if (!(ticket.lane === "crypto" && ticket.action !== "sell") && ticket.confidence < 0.65) return null;
  if (!Number.isFinite(ticket.grokMs) || ticket.grokMs < 0) return null;
  return {
    action: ticket.action,
    confidence: ticket.confidence,
    why: ticket.why,
    ms: ticket.grokMs,
    lane: ticket.lane,
    question: ticket.question || null,
    priceToBeat: ticket.priceToBeat,
    currentRef: ticket.currentRef,
    delta: ticket.delta,
    secondsLeft: ticket.secondsLeft,
    windowLabel: ticket.windowLabel,
    twapLine: ticket.twapLine,
    entryAsk: Number.isFinite(Number(ticket.price)) ? Number(ticket.price) : null,
  };
}

function grokLogText(g: LastGrok): string {
  const bits = [
    GROK_MODEL,
    g.lane === "crypto" ? "крипто" : g.lane === "weather" ? "погода" : "події",
    g.action,
    `${Math.round(g.confidence * 100)}%`,
    `${(g.ms / 1000).toFixed(1)} с`,
    g.windowLabel ? `вікно ${g.windowLabel}` : "",
    g.priceToBeat != null && g.currentRef != null
      ? `price to beat ${g.priceToBeat.toFixed(2)} · current TWAP ${g.currentRef.toFixed(2)} · дельта ${g.delta == null ? "немає" : g.delta.toFixed(2)}${g.secondsLeft == null ? "" : ` · ${g.secondsLeft} с`}`
      : "",
    g.entryAsk != null ? `ціна входу ${g.entryAsk.toFixed(2)}` : "",
    g.twapLine ?? "",
    g.question ?? "",
    g.why,
  ];
  return bits.filter(Boolean).join(" · ");
}

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Транзакція не пройшла";
  const flat = msg.replace(/\s+/g, " ").trim();
  if (/airdrop|faucet|429|limit reached|run dry|кран devnet/i.test(flat)) {
    return "Кран Devnet відповів відмовою: ліміт на сьогодні. Кнопка стукала в мережу, SOL не зараховано.";
  }
  if (/prior credit|attempt to debit|insufficient lamports|insufficient funds/i.test(flat)) {
    return "На Devnet у цього гаманця немає SOL. Транзакцію не відправив. Капни кран на faucet.solana.com на адресу кімнати.";
  }
  return flat.slice(0, 220);
}

function shortAddr(pubkey: string): string {
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

function needSolNotice(have: number, need: number, pubkey: string): string {
  const short = shortAddr(pubkey);
  if (have < 0.02) {
    return `На Devnet у ${short} зараз 0 SOL. Цифра зі старого ланцюга не рахується. Капни devnet SOL на faucet.solana.com на цю адресу.`;
  }
  return `Мало тестового SOL. Є ${have.toFixed(2)}, потрібно ${need} + комісія.`;
}

async function readSol(owner: PublicKey): Promise<number | null> {
  try {
    const lamports = await (await loadChain()).balanceLamports(owner);
    if (typeof lamports !== "number" || !Number.isFinite(lamports) || lamports < 0) return null;
    return Number((lamports / LAMPORTS_PER_SOL).toFixed(4));
  } catch {
    return null;
  }
}

const failedLocks = new Set<string>();

function revertLock(fillId: string, asset: string) {
  failedLocks.add(fillId);
  useAgents.setState((s) => ({
    nfts: s.nfts.map((n) => {
      if (n.asset !== asset || n.openBook?.fillId !== fillId) return n;
      return {
        ...n,
        openBook: null,
        metrics: {
          ...n.metrics,
          jobs: Math.max(0, n.metrics.jobs - 1),
          xp: Math.max(0, n.metrics.xp - 1),
        },
      };
    }),
    fills: s.fills.filter((f) => f.id !== fillId),
  }));
  useAgents.getState().persist();
}

let chainQueue: Promise<void> = Promise.resolve();
let brainFlight = false;
let arbFlight = false;
const brainAsked = new Set<string>();
let sidePrefer: "events" | "weather" = "events";
const BET_CAP = 6;
const BET_WINDOW_MS = 15 * 60 * 1000;
let betWindowAt = Date.now();

function rollBetWindow(now = Date.now()) {
  if (now - betWindowAt < BET_WINDOW_MS) return;
  betWindowAt = now;
  brainAsked.clear();
  const s = useAgents.getState();
  if (s.betCalls === 0) return;
  const capped = (s.notice ?? "").includes("більше не ставить");
  useAgents.setState({
    betCalls: 0,
    ...(capped ? { notice: "Ліміт Grok оновлено. Ще 6 запитів." } : {}),
  });
}
const SESSION_CAP_SOL = 0.2;
const MIN_WORK_SOL = 0.05;
const MAX_TRADE_SOL = 0.02;
const DAY_CAP_SOL = 0.3;
const MAX_OPEN = 1;
const MAX_LOSSES = 2;
const LIVE_MAX_SOL = 0.005;
const LIVE_CAP_SOL = 0.02;
const LIVE_MIN_SOL = 0.01;
const LIVE_PENDING_MS = 120_000;
const LIMITS_KEY = "solarchik.limits.v1";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readLimits(): { dayKey: string; daySpent: number; lossStreak: number } {
  if (typeof localStorage === "undefined") return { dayKey: todayKey(), daySpent: 0, lossStreak: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(LIMITS_KEY) ?? "") as {
      dayKey?: string;
      daySpent?: number;
      lossStreak?: number;
    };
    const dayKey = raw.dayKey === todayKey() ? raw.dayKey : todayKey();
    return {
      dayKey,
      daySpent: dayKey === raw.dayKey && typeof raw.daySpent === "number" ? raw.daySpent : 0,
      lossStreak: typeof raw.lossStreak === "number" ? raw.lossStreak : 0,
    };
  } catch {
    return { dayKey: todayKey(), daySpent: 0, lossStreak: 0 };
  }
}

function writeLimits(dayKey: string, daySpent: number, lossStreak: number) {
  if (typeof localStorage === "undefined") return;
  let prev: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(LIMITS_KEY) ?? "");
    if (parsed && typeof parsed === "object") prev = parsed as Record<string, unknown>;
  } catch {
    prev = {};
  }
  localStorage.setItem(LIMITS_KEY, JSON.stringify({ ...prev, dayKey, daySpent, lossStreak }));
}

function dayLossSol(): number {
  const day = todayKey();
  return useAgents.getState().feeLedger.reduce((sum, row) => {
    if (row.pnl >= 0) return sum;
    const key = new Date(row.closedAt).toISOString().slice(0, 10);
    return key === day ? sum + -row.pnl : sum;
  }, 0);
}

function noteSettledFees(patches: FillPatch[], track: Track) {
  const settled = patches.filter((p) => p.status === "settled");
  if (!settled.length) return;
  const state = useAgents.getState();
  const known = new Set(state.feeLedger.map((r) => r.id));
  const save = loadSave();
  const rows: FeeRow[] = [];
  for (const patch of settled) {
    if (known.has(patch.id)) continue;
    const fill = state.fills.find((f) => f.id === patch.id);
    const nft = state.nfts.find((n) => n.asset === fill?.asset);
    rows.push(
      planFee({
        id: patch.id,
        agent: fill?.asset ?? "",
        tier: nft?.tier,
        openedAt: fill?.at ?? 0,
        closedAt: Date.now(),
        pnl: patch.pnl,
        paper: track === "paper" || nft?.track === "paper",
        covered: feeCovered(save.feeWindows, fill?.at ?? 0),
      }),
    );
  }
  if (!rows.length) return;
  useAgents.setState((s) => ({ feeLedger: [...s.feeLedger, ...rows].slice(-200) }));
  useAgents.getState().persist();
  const due = rows.filter((r) => r.reason === "unsent");
  if (due.length) void sendDueFees(due);
}

async function sendDueFees(due: FeeRow[]) {
  let kp: Awaited<ReturnType<typeof loadKeypair>>;
  let chain: Awaited<ReturnType<typeof loadChain>>;
  try {
    kp = await loadKeypair();
    chain = await loadChain();
  } catch {
    useAgents.setState({ notice: "Комісію не відправлено. Ключ або модуль мережі не відкрився." });
    return;
  }
  if (!kp) {
    useAgents.setState({ notice: "Комісію не відправлено. Немає ключа." });
    return;
  }
  const wallet = kp.publicKey.toBase58();
  for (const row of due) {
    try {
      const sig = await chain.payAccount(kp, new PublicKey(PAY_WALLET), row.fee, feeMemo(row.id));
      useAgents.setState((s) => ({
        feeLedger: s.feeLedger.map((r) => (r.id === row.id ? { ...r, charged: true, reason: "charged", sig, verified: false } : r)),
      }));
      await verifyFeeRow(wallet, { ...row, sig });
    } catch {
      useAgents.setState({ notice: "Комісію не відправлено. Підпис не вигадую." });
    }
  }
  useAgents.getState().persist();
}

/** The server reads the fee transfer on devnet and records it once. The row is "verified" only then. */
async function verifyFeeRow(wallet: string, row: FeeRow): Promise<void> {
  if (!row.sig) return;
  try {
    const res = await callRecordFee({ wallet, rowId: row.id, sig: row.sig, lamports: Math.round(row.fee * 1e9) });
    if (res.ok) {
      useAgents.setState((s) => ({ feeLedger: s.feeLedger.map((r) => (r.id === row.id ? { ...r, verified: true } : r)) }));
    } else if (!res.retry) {
      useAgents.setState((s) => ({
        feeLedger: s.feeLedger.map((r) => (r.id === row.id ? { ...r, verified: false, note: res.reason.slice(0, 120) } : r)),
      }));
    }
  } catch {
    /* server quiet: retried on the next load */
  }
}

async function claimCredit(input: { sig: string; asset: string; wallet: string }) {
  try {
    const res = await callClaimArbCredit(input);
    if (res.ok || /вже зараховано|застара|немає|більший/i.test(res.reason)) dropPendingCredit(input.sig);
    if (res.creditSol != null) writeArbCreditCache(input.asset, res.creditSol);
    return res;
  } catch {
    return { ok: false as const, reason: "Сервер не відповів. Спробую ще раз пізніше.", creditSol: null };
  }
}

/** After load: server credit per arb NFT, unfinished credit claims, unverified fee rows. */
async function syncServerLedgers(room: string): Promise<void> {
  const state = useAgents.getState();
  if (state.wallet?.pubkey !== room) return;
  for (const pending of readPendingCredits().filter((p) => p.wallet === room)) {
    await claimCredit(pending);
  }
  const arbAssets = state.nfts.filter((n) => n.classId === 2 && n.owner === room && n.asset.length >= 32).map((n) => n.asset);
  for (const asset of arbAssets) {
    try {
      const res = await callReadArbCredit(asset);
      if (res.ok) {
        writeArbCreditCache(asset, res.creditSol);
        useAgents.setState((s) => ({ arbCredit: { ...s.arbCredit, [asset]: res.creditSol } }));
      }
    } catch {
      /* keep the cached figure */
    }
  }
  const unverified = useAgents.getState().feeLedger.filter((r) => r.charged && r.sig && r.verified !== true && !r.note).slice(-20);
  for (const row of unverified) await verifyFeeRow(room, row);
  try {
    const status = await callMintStatus();
    useAgents.setState({ mintCollection: status.collection });
  } catch {
    /* status unknown: no re-issue button */
  }
  useAgents.getState().persist();
}

const PENDING_PRO_KEY = "solarchik.pending-pro";

/** A Pro payment that did not end in a mint yet. Reused once instead of charging again. */
function readPendingPro(room: string, skuId: string): string {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_PRO_KEY) || "null") as { room?: string; skuId?: string; sig?: string } | null;
    return raw && raw.room === room && raw.skuId === skuId && typeof raw.sig === "string" ? raw.sig : "";
  } catch {
    return "";
  }
}

function writePendingPro(room: string, skuId: string, sig: string) {
  try {
    localStorage.setItem(PENDING_PRO_KEY, JSON.stringify({ room, skuId, sig }));
  } catch {
    /* private mode: server still binds the payment by memo */
  }
}

function clearPendingPro() {
  try {
    localStorage.removeItem(PENDING_PRO_KEY);
  } catch {
    /* ignore */
  }
}

/** Sign with the room key, then let the server decide. The browser holds no arb secret. */
async function signedArbFire(dir: "A" | "B", rawSymbol: string, asset: string) {
  const kp = await loadKeypair();
  if (!kp) return { ok: false as const, mode: "closed" as const, broken: false, reason: "Немає ключа кімнати." };
  const symbol = cleanArbSymbol(rawSymbol);
  const proof = await signProof(kp, "arb", `${dir}:${symbol}:${asset}`);
  return callArbFire({ dir, symbol, asset, proof });
}

type HeldTrade = PendingTrade & { job: ChainJob };

const heldTrades: HeldTrade[] = [];

function describeJob(job: ChainJob, from: string, to: string): Omit<PendingTrade, "id"> {
  if (job.kind === "dex") {
    return {
      title: "DEX-переказ",
      detail: `${job.side} ${job.amount} SOL`,
      amount: job.amount,
      kind: "dex",
      network: "Devnet",
      from,
      to,
      honest: "Це тестовий переказ Devnet.",
      live: false,
    };
  }
  if (job.phase === "settle") {
    return {
      title: "Закрити ставку",
      detail: job.win ? `Повернути ${job.stake} SOL` : `Мінус ${job.stake} SOL. Виплати немає.`,
      amount: 0,
      kind: "prediction",
      network: "Devnet",
      from: job.win ? to : from,
      to: job.win ? from : to,
      honest: "Це тестовий переказ Devnet.",
      live: false,
    };
  }
  return {
    title: "Ставка",
    detail: `${job.stake} SOL`,
    amount: job.stake,
    kind: "prediction",
    network: "Devnet",
    from,
    to,
    honest: "Це тестовий переказ Devnet.",
    live: false,
  };
}

function showNextTrade() {
  const state = useAgents.getState();
  if (state.pendingTrade || heldTrades.length === 0) return;
  const next = heldTrades[0];
  useAgents.setState({
    pendingTrade: {
      id: next.id,
      title: next.title,
      detail: next.detail,
      amount: next.amount,
      kind: next.kind,
      network: next.network,
      from: next.from,
      to: next.to,
      honest: next.honest,
      live: next.live,
    },
    liveQuoteUsdc: null,
  });
}

function dropHeld(id: string | null) {
  const index = id ? heldTrades.findIndex((row) => row.id === id) : 0;
  if (index < 0) return null;
  const [row] = heldTrades.splice(index, 1);
  return row ?? null;
}

function enqueue(job: () => Promise<void>) {
  chainQueue = chainQueue.then(job).catch((e: unknown) => {
    useAgents.setState({ notice: errText(e) });
  });
}

async function refreshBalances(user: Awaited<ReturnType<typeof loadKeypair>>) {
  if (!user) return;
  const sol = await readSol(user.publicKey);
  if (sol == null) {
    useAgents.setState({ solKnown: false, solMiss: true, notice: "немає цифри" });
    return;
  }
  useAgents.setState({
    sol,
    solKnown: true,
    solMiss: false,
    paperSol: 0,
  });
}

async function settleUncounted(): Promise<"clear" | "pending"> {
  const start = useAgents.getState();
  if (!start.lastLiveSig || start.lastLiveSigCounted) return "clear";
  const peeked = await peekMainnetSig({ data: { signature: start.lastLiveSig } });
  const now = useAgents.getState();
  if (!now.lastLiveSig || now.lastLiveSig !== start.lastLiveSig || now.lastLiveSigCounted) return "clear";
  if (peeked.status === "pending") {
    const age = now.lastLiveAt > 0 ? Date.now() - now.lastLiveAt : LIVE_PENDING_MS;
    if (age < LIVE_PENDING_MS) return "pending";
    useAgents.setState({
      lastLiveSigCounted: true,
      notice: `Живий своп Jupiter на mainnet · ${now.lastLiveSig}. Мережа так і не підтвердила. Баланс не оновлюю.`,
    });
    useAgents.getState().persist();
    return "clear";
  }
  if (peeked.status === "error") {
    const streak = now.liveLossStreak + 1;
    const stop = streak >= MAX_LOSSES;
    const why = peeked.error || "Mainnet відхилив транзакцію.";
    useAgents.setState({
      liveLossStreak: streak,
      lastLiveSigCounted: true,
      liveArmed: stop ? false : now.liveArmed,
      haltReason: stop ? "Два мінуси підряд. Боти стоять." : why,
      notice: stop ? "Два мінуси підряд. Боти стоять." : `Живий своп Jupiter на mainnet · ${now.lastLiveSig}. ${why}`,
    });
    useAgents.getState().persist();
    return "clear";
  }
  const amount = now.lastLiveAmount > 0 ? now.lastLiveAmount : 0;
  const today = todayKey();
  const same = now.liveDayKey === today;
  useAgents.setState({
    liveSessionSpent: Number(((same ? now.liveSessionSpent : 0) + amount).toFixed(4)),
    liveDayKey: today,
    liveDaySpent: Number(((same ? now.liveDaySpent : 0) + amount).toFixed(4)),
    liveLossStreak: 0,
    lastLiveSigCounted: true,
    haltReason: null,
  });
  useAgents.getState().persist();
  const owner = now.wallet?.pubkey;
  if (!owner) return "clear";
  try {
    const main = await readMainnetBalance({ data: { owner } });
    const usdc = await readMainnetUsdc({ data: { owner } });
    const low = typeof main === "number" && main < LIVE_MIN_SOL;
    useAgents.setState({
      ...(typeof main === "number" ? { roomMainnetSol: main } : {}),
      ...(typeof usdc === "number" ? { roomMainnetUsdc: usdc, roomMainnetUsdcKnown: true } : {}),
      haltReason: low ? "Поповни гаманець. Боти стоять." : null,
      notice: `Живий своп Jupiter на mainnet · ${now.lastLiveSig}`,
    });
  } catch {
    /* network had no balance figure */
  }
  return "clear";
}

const liveGate = false;
let autoDexFlight = false;
let autoPolyFlight = false;
let weexFlight = false;
let weexAt = 0;
let weexTold = "";
let grokStarted = 0;
let reviewGen = 0;
const REVIEW_CAP_MS = 75_000;

function maybeStepWeex(nfts: AgentNft[], agents: Record<AgentKind, AgentRuntime>) {
  const live = useAgents.getState();
  if (!live.autoRun || !live.wallet || weexFlight) return;
  const drive = nfts.find((n) => n.asset === agents.prediction.sourceAsset && n.owner === live.wallet?.pubkey);
  const lanes = drive?.strategy.prediction.lanes ?? [];
  if (!drive || drive.classId === 2 || agents.prediction.status !== "working") return;
  if (drive.strategy.prediction.weexOn !== true || !lanes.includes("crypto")) return;
  if (Date.now() - weexAt < 90_000) return;
  weexFlight = true;
  weexAt = Date.now();
  void stepWeex({ data: { ping: true } })
    .then((res) => {
      const text = res.ok ? (res.placed && res.orderId ? `${res.why} · ${res.orderId}` : res.why) : res.error;
      if (!text || text === weexTold) return;
      weexTold = text;
      useAgents.setState((s) => ({
        notice: text,
        log: pushLog(s.log, { id: `weex-${Date.now()}`, at: Date.now(), kind: "system", text }),
      }));
      useAgents.getState().persist();
    })
    .catch(() => undefined)
    .finally(() => {
      weexFlight = false;
    });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Розбір обірвався. Натисни ще раз.")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error("Розбір обірвався. Натисни ще раз."));
      },
    );
  });
}

function reviewLive(): boolean {
  return grokStarted > 0 && Date.now() - grokStarted < REVIEW_CAP_MS;
}

function beginReview(): number {
  grokStarted = Date.now();
  return ++reviewGen;
}

function endReview(gen: number): boolean {
  if (gen !== reviewGen) return false;
  grokStarted = 0;
  return true;
}
const closeAsked = new Set<string>();
const restAt = new Map<string, number>();
const restEnd = new Map<string, number>();
const restFlipAt = new Map<string, number>();
const redeemAsked = new Set<string>();
const redeemAt = new Map<string, number>();
const closeTried = new Map<string, number>();

function cryptoCloseDue(hold: PolyHold, now = Date.now()): boolean {
  const id = hold.orderId;
  if (closeAsked.has(id)) {
    if (redeemAsked.has(id)) return false;
    const since = now - (redeemAt.get(id) ?? 0);
    if (redeemAt.has(id) && since < 60_000) return false;
    redeemAt.set(id, now);
    return true;
  }
  if (!restAt.has(id)) restAt.set(id, now);
  const age = now - (restAt.get(id) ?? 0);
  const end = restEnd.get(id);
  const left = end == null ? null : Math.round((end - now) / 1000);
  const near = left != null && left < 30;
  const dueFlip = age >= 45_000 && now - (restFlipAt.get(id) ?? 0) >= 20_000;
  const tried = closeTried.get(id) ?? 0;
  const needEnd = end == null && age >= 5_000 && now - tried >= 20_000;
  if (!(near || dueFlip || needEnd)) return false;
  closeTried.set(id, now);
  return true;
}

function holdFromBuy(ticket: PolyTicket, orderId: string): PolyHold | null {
  if (ticket.side === "SELL" || ticket.action === "sell") return null;
  if (!/^\d+$/.test(ticket.tokenId) || ticket.tokenId.length < 6) return null;
  if (!/^\d+(\.\d+)?$/.test(ticket.price) || !/^\d+(\.\d+)?$/.test(ticket.spend) || !/^\d+(\.\d+)?$/.test(ticket.shares)) {
    return null;
  }
  return { orderId, tokenId: ticket.tokenId, side: "BUY", price: ticket.price, spend: ticket.spend, shares: ticket.shares, lane: ticket.lane };
}

function cryptoSlotTaken(s: { polyRedeem: unknown; polyHold: PolyHold | null; polyOpenId: string | null }): boolean {
  if (s.polyRedeem) return true;
  const side = s.polyHold?.lane === "events" || s.polyHold?.lane === "weather";
  if (s.polyHold && !side) return true;
  if (s.polyOpenId && !side) return true;
  return false;
}

function cryptoPrefs(s: { nfts: AgentNft[]; wallet: { pubkey: string } | null }): { windows: number[]; askLo: number; askHi: number } {
  const owner = s.wallet?.pubkey;
  const nft = s.nfts.find((n) => owner && n.owner === owner && n.classId !== 2 && laneEnabledOn(n.strategy.prediction, "crypto", n.classId));
  const p = nft?.strategy.prediction;
  const band = cryptoBand(p ?? {});
  return { windows: p?.windows?.length ? p.windows : [15], askLo: band.lo, askHi: band.hi };
}

function heldTokenIds(s: { polyBooks: PolyHold[]; polyHold: PolyHold | null }): string[] {
  const ids: string[] = [];
  for (const row of s.polyBooks) ids.push(row.tokenId);
  if (s.polyHold && (s.polyHold.lane === "events" || s.polyHold.lane === "weather")) ids.push(s.polyHold.tokenId);
  return [...new Set(ids)].slice(0, 40);
}

function pushBook(books: PolyHold[], hold: PolyHold | null): PolyHold[] {
  if (!hold || (hold.lane !== "events" && hold.lane !== "weather")) return books;
  return [hold, ...books.filter((b) => b.orderId !== hold.orderId && b.tokenId !== hold.tokenId)].slice(0, 40);
}

function orderKind(status: string, sizeMatched: string): "sell" | "rest" | "clear" | "unknown" {
  const s = status.toLowerCase();
  const matched = Number(sizeMatched);
  if (s === "canceled" || s === "cancelled") return "clear";
  if ((Number.isFinite(matched) && matched > 0) || s === "matched" || s === "filled") return "sell";
  if (s === "live" || s === "delayed" || s === "unmatched") return "rest";
  return "unknown";
}

async function classifyHold(hold: PolyHold): Promise<"sell" | "rest" | "clear" | "unknown"> {
  const row = await readPolyOrder(hold.orderId);
  if (row) return orderKind(row.status, row.sizeMatched);
  const mem = (useAgents.getState().lastPolyStatus ?? "").toLowerCase();
  if (mem === "matched" || mem === "filled") return "sell";
  return "unknown";
}

function clearHold(notice: string) {
  useAgents.setState({ polyHold: null, polyOpenId: null, polyTicket: null, polyCancel: null, polyRedeem: null, notice });
  useAgents.getState().persist();
}

async function refreshPolyBalances(address: string | null): Promise<{ known: boolean; pol: number | null; pusd: number | null }> {
  if (!address) return { known: false, pol: null, pusd: null };
  try {
    const bals = await readPolyBalances({ data: { address } });
    return { known: true, pol: bals.pol, pusd: bals.pusd };
  } catch {
    return { known: false, pol: null, pusd: null };
  }
}

let figuresFlight = false;

async function pullFigures() {
  if (figuresFlight) return;
  const state = useAgents.getState();
  if (!state.ready) return;
  figuresFlight = true;
  try {
    const kp = await loadKeypair();
    if (kp) {
      const sol = await readSol(kp.publicKey).catch(() => null);
      if (typeof sol === "number") {
        useAgents.setState({ sol, solKnown: true, solMiss: false, paperSol: 0 });
      } else if (!useAgents.getState().solKnown) {
        // RPC down: say "no figure" instead of "reading…" forever.
        useAgents.setState({ solMiss: true });
      }
      const owner = kp.publicKey.toBase58();
      const [main, usdc] = await Promise.all([
        readMainnetBalance({ data: { owner } }).catch(() => null),
        readMainnetUsdc({ data: { owner } }).catch(() => null),
      ]);
      useAgents.setState({
        ...(typeof main === "number" ? { roomMainnetSol: main, roomMainnetSolKnown: true } : { roomMainnetSolKnown: true }),
        ...(typeof usdc === "number" ? { roomMainnetUsdc: usdc, roomMainnetUsdcKnown: true } : {}),
      });
    }
    let polygon = useAgents.getState().polyAddress;
    if (!polygon) {
      try {
        polygon = await ensurePolygonAddress();
      } catch {
        polygon = null;
      }
    }
    if (polygon) {
      const bals = await refreshPolyBalances(polygon);
      if (bals.known) {
        useAgents.setState({
          polyAddress: polygon,
          polyKnown: true,
          ...(bals.pol != null ? { polyPol: bals.pol } : {}),
          ...(bals.pusd != null ? { polyPusd: bals.pusd } : {}),
        });
      }
    }
    const live = useAgents.getState();
    if (!live.bridgeBusy && !live.bridgeSvm && polygon && live.wallet?.pubkey) {
      await live.prepareBridgeDeposit(false);
    }
    const svm = useAgents.getState().bridgeSvm;
    if (svm && !useAgents.getState().bridgeBusy) {
      try {
        const status = await readBridgeStatus({ data: { svm } });
        if (status) useAgents.setState({ bridgeStatus: status });
      } catch {
        /* keep the last status */
      }
      if (polygon) {
        const again = await refreshPolyBalances(polygon);
        if (again.known) {
          useAgents.setState({
            polyKnown: true,
            ...(again.pol != null ? { polyPol: again.pol } : {}),
            ...(again.pusd != null ? { polyPusd: again.pusd } : {}),
          });
        }
      }
    }
  } catch {
    /* RPC or bridge quiet: keep the last figures, next poll retries */
  } finally {
    figuresFlight = false;
  }
}

let redeemFlight = false;

function redeemLine(hash: string, bals: { known: boolean; pusd: number | null }): string {
  if (bals.known && bals.pusd != null) return `redeem · ${hash} · ${bals.pusd.toFixed(4)} pUSD`;
  return `redeem · ${hash}. Баланс не вигадую.`;
}

async function settleRedeem(hash: string, conditionId: string) {
  const bals = await refreshPolyBalances(useAgents.getState().polyAddress);
  const line = redeemLine(conditionId || hash, bals);
  useAgents.setState({
    polyHold: null,
    polyOpenId: null,
    polyTicket: null,
    polyCancel: null,
    polyRedeem: null,
    polyPol: bals.known ? bals.pol : null,
    polyPusd: bals.known ? bals.pusd : null,
    polyKnown: bals.known,
    lastPolyOrder: hash,
    lastPolyStatus: "redeem",
    notice: line,
    log: pushLog(useAgents.getState().log, {
      id: `poly-${Date.now()}`,
      at: Date.now(),
      kind: "system",
      text: line,
    }),
  });
  useAgents.getState().persist();
}

/** Data-api of the deposit wallet. Redeemable size blocks a new BUY. */
async function sendRedeem(plan: { tokenId: string; conditionId: string; negRisk: boolean; adapter: string }): Promise<"stop"> {
  const recent = Date.now() - (redeemAt.get(plan.conditionId) ?? 0);
  if (redeemAt.has(plan.conditionId) && recent < 60_000) {
    useAgents.setState({ notice: "Спочатку погасити виграш. Нову не ставлю." });
    return "stop";
  }
  redeemAt.set(plan.conditionId, Date.now());
  redeemFlight = true;
  useAgents.setState({ polyBusy: true, notice: "Спочатку погасити виграш. Нову не ставлю." });
  try {
    if (!useAgents.getState().autoRun) return "stop";
    const sent = await redeemPolyPosition(plan);
    if (!sent.ok) {
      useAgents.setState({ notice: sent.error || "Редіму немає." });
      return "stop";
    }
    await settleRedeem(sent.hash, plan.conditionId);
  } catch {
    useAgents.setState({ notice: "Редіму немає." });
  } finally {
    redeemFlight = false;
    useAgents.setState({ polyBusy: false });
  }
  return "stop";
}

async function guardRedeem(auto: boolean): Promise<"stop" | "go"> {
  if (redeemFlight) {
    useAgents.setState({ notice: "Спочатку погасити виграш. Нову не ставлю." });
    return "stop";
  }
  const live = useAgents.getState();
  if (live.polyRedeem) {
    if (auto && live.autoRun) return sendRedeem(live.polyRedeem);
    useAgents.setState({ notice: "Спочатку погасити виграш. Нову не ставлю." });
    return "stop";
  }
  const address = live.polyAddress ?? (await ensurePolygonAddress().catch(() => null));
  if (!address) return "go";
  const scan = await scanRedeem({ data: { address } });
  if (!scan.ok) {
    if (useAgents.getState().polyHold) {
      useAgents.setState({ notice: scan.error || "Редіму немає." });
      return "stop";
    }
    return "go";
  }
  if (scan.redeem) {
    if (!auto || !useAgents.getState().autoRun) {
      useAgents.setState({
        polyAddress: address,
        polyRedeem: {
          tokenId: scan.tokenId,
          conditionId: scan.conditionId,
          negRisk: scan.negRisk,
          adapter: scan.adapter,
        },
        polyTicket: null,
        polyCancel: null,
        notice: "Спочатку погасити виграш. Нову не ставлю.",
      });
      return "stop";
    }
    useAgents.setState({ polyAddress: address });
    return sendRedeem(scan);
  }
  const hold = useAgents.getState().polyHold;
  const openId = useAgents.getState().polyOpenId;
  const assetGone = !hold || !scan.assets.includes(hold.tokenId);
  if ((hold || openId) && assetGone) {
    const bals = await refreshPolyBalances(address);
    const notice = "Ставка закрита. Слот вільний.";
    useAgents.setState({
      polyHold: null,
      polyOpenId: null,
      polyTicket: null,
      polyCancel: null,
      polyRedeem: null,
      ...(bals.known && bals.pusd != null
        ? { polyKnown: true, polyPol: bals.pol, polyPusd: bals.pusd }
        : {}),
      notice,
      log: pushLog(useAgents.getState().log, {
        id: `poly-clear-${Date.now()}`,
        at: Date.now(),
        kind: "system",
        text: notice,
      }),
    });
    useAgents.getState().persist();
  }
  return "go";
}

async function offerCancel(hold: PolyHold, auto: boolean) {
  if (!auto) {
    if (!useAgents.getState().liveArmed || !useAgents.getState().liveAck) {
      useAgents.setState({ notice: "Спочатку обидві галочки живого режиму. Ордера немає." });
      return;
    }
    useAgents.setState({
      polyCancel: { orderId: hold.orderId },
      polyTicket: null,
      polyRedeem: null,
      notice: "Ордер ще в стакані. Продажу акцій немає.",
    });
    return;
  }
  if (!useAgents.getState().autoRun) return;
  const sent = await cancelPolyOrder(hold.orderId);
  if (!sent.ok) {
    restAt.set(hold.orderId, Date.now());
    useAgents.setState({ notice: sent.error });
    return;
  }
  if (!sent.canceled) {
    restAt.set(hold.orderId, Date.now());
    useAgents.setState({ notice: sent.why || "CLOB не скасував. Слот лишається." });
    return;
  }
  clearHold("Ордер скасовано в стакані.");
}

async function offerRedeem(hold: PolyHold, auto: boolean): Promise<"done" | "skip" | "stop"> {
  if (auto && redeemAsked.has(hold.orderId)) return "skip";
  const plan = await reviewRedeem({ data: { tokenId: hold.tokenId } });
  if (!plan.ok) {
    useAgents.setState({ notice: plan.error });
    return "stop";
  }
  if (!plan.redeem) {
    if (plan.resolved) {
      if (auto) redeemAsked.add(hold.orderId);
      useAgents.setState({ notice: plan.why || "Редіму немає." });
      return "stop";
    }
    return "skip";
  }
  if (!auto) {
    useAgents.setState({
      polyRedeem: {
        tokenId: plan.tokenId,
        conditionId: plan.conditionId,
        negRisk: plan.negRisk,
        adapter: plan.adapter,
      },
      polyTicket: null,
      polyCancel: null,
      notice: "Спочатку погасити виграш. Нову не ставлю.",
    });
    return "done";
  }
  if (!useAgents.getState().autoRun) return "stop";
  redeemAsked.add(hold.orderId);
  const sent = await redeemPolyPosition(plan);
  if (!sent.ok) {
    useAgents.setState({ notice: sent.error, polyRedeem: null });
    return "done";
  }
  await settleRedeem(sent.hash, plan.conditionId);
  return "done";
}

async function runClose(hold: PolyHold, auto: boolean) {
  const kind = await classifyHold(hold);
  if (!useAgents.getState().autoRun && auto) return;
  if (kind === "clear") {
    clearHold("Ордер скасовано. Слоту немає.");
    return;
  }
  if (kind === "rest") {
    if (!restAt.has(hold.orderId)) restAt.set(hold.orderId, Date.now());
    const age = Date.now() - (restAt.get(hold.orderId) ?? Date.now());
    const cachedEnd = restEnd.get(hold.orderId);
    const cachedLeft = cachedEnd == null ? null : Math.max(0, Math.round((cachedEnd - Date.now()) / 1000));
    let secondsLeft = cachedLeft;
    let flipped: boolean | null = null;
    const askFlip = age >= 45_000 && Date.now() - (restFlipAt.get(hold.orderId) ?? 0) >= 20_000;
    if (cachedEnd == null || askFlip || (cachedLeft != null && cachedLeft < 40)) {
      try {
        const gate = await holdRest({ data: { tokenId: hold.tokenId } });
        if (gate.secondsLeft != null) {
          secondsLeft = gate.secondsLeft;
          restEnd.set(hold.orderId, Date.now() + gate.secondsLeft * 1000);
        }
        flipped = gate.flipped;
        if (askFlip) restFlipAt.set(hold.orderId, Date.now());
      } catch {
        flipped = null;
      }
    }
    const late = secondsLeft != null && secondsLeft < 30;
    const staleFlip = age >= 45_000 && flipped === true;
    if (!late && !staleFlip) {
      useAgents.setState({ notice: "Ордер у стакані. Ще не скасовую." });
      return;
    }
    await offerCancel(hold, auto);
    return;
  }
  if (kind === "unknown") {
    useAgents.setState({ notice: "Немає статусу ордера. Продажу немає." });
    return;
  }
  if (auto && closeAsked.has(hold.orderId)) {
    await offerRedeem(hold, true);
    return;
  }
  const redeemed = await offerRedeem(hold, auto);
  if (redeemed !== "skip") return;
  if (auto) closeAsked.add(hold.orderId);
  const address = useAgents.getState().polyAddress ?? (await ensurePolygonAddress());
  useAgents.setState({ grokFlight: true, polyBusy: true, polyAddress: address, notice: "Питаю Grok, чи закривати." });
  const review = await reviewClose({
    data: { address, tokenId: hold.tokenId, entry: hold.price, shares: hold.shares },
  });
  const now = useAgents.getState();
  if (auto && !now.autoRun) {
    useAgents.setState({ polyTicket: null, notice: "Авто вимкнено. Нових угод немає." });
    return;
  }
  if (!review.ok) {
    useAgents.setState({ notice: review.error, polyTicket: null });
    return;
  }
  const traced = rememberGrok(review.place ? null : review.grok);
  if (!review.place) {
    useAgents.setState({ notice: review.why, polyTicket: null, lastGrok: traced ?? now.lastGrok });
    if (traced) useAgents.getState().persist();
    return;
  }
  const kept = ticketGrok(review);
  if (!kept || review.action !== "sell" || review.confidence < 0.65) {
    useAgents.setState({ notice: "Grok не зібрав рішення.", polyTicket: null, lastGrok: traced ?? now.lastGrok });
    return;
  }
  if (!auto) {
    useAgents.setState({
      polyTicket: review,
      lastGrok: kept,
      notice: "Живий ордер Polymarket CLOB на Polygon. Чекає підтвердження.",
    });
    useAgents.getState().persist();
    return;
  }
  const placed = await placePolyOrder(review);
  if (!placed.ok) {
    useAgents.setState({ notice: placed.error, polyTicket: null, lastGrok: kept });
    useAgents.getState().persist();
    return;
  }
  const bals = await readPolyBalances({ data: { address } });
  useAgents.setState({
    polyTicket: null,
    polyHold: null,
    polyOpenId: null,
    lastPolyOrder: placed.orderId,
    lastPolyStatus: placed.status,
    polyPol: bals.pol,
    polyPusd: bals.pusd,
    polyKnown: true,
    lastGrok: kept,
    notice: `Живий ордер Polymarket CLOB на Polygon · ${placed.orderId} · ${placed.status}`,
    log: pushLog(useAgents.getState().log, {
      id: `poly-${Date.now()}`,
      at: Date.now(),
      kind: "system",
      text: `Живий ордер Polymarket CLOB SELL ${review.shares} · ${placed.status} · ${placed.orderId}`,
    }),
  });
  useAgents.getState().persist();
}

function ownedKinds(state: AgentsState): Set<AgentKind> {
  const owner = state.wallet?.pubkey;
  const kinds = new Set<AgentKind>();
  if (!owner) return kinds;
  for (const nft of state.nfts) {
    if (nft.owner !== owner || nft.classId === 2) continue;
    kinds.add("prediction");
  }
  return kinds;
}

function clearUnsent() {
  const dropped = heldTrades.splice(0);
  for (const row of dropped) {
    if (row.job.kind === "prediction" && row.job.phase === "lock") revertLock(row.job.fillId, row.job.asset);
  }
  const now = useAgents.getState();
  useAgents.setState({
    pendingTrade: null,
    polyTicket: now.polyBusy ? now.polyTicket : null,
  });
}

async function fireAutoDex(amount: number) {
  if (autoDexFlight) return;
  const state = useAgents.getState();
  if (!state.autoRun || !state.wallet) return;
  if (!ownedKinds(state).has("dex")) return;
  const size = Number(amount.toFixed(4));
  const blocked = userTradeBlock(size, state.liveLossStreak, state.liveDayKey === todayKey() ? state.liveDaySpent : 0, dayLossSol());
  if (blocked) {
    useAgents.setState((s) => ({
      notice: blocked,
      haltReason: blocked,
      log: pushLog(s.log, { id: `skip-${Date.now()}`, at: Date.now(), kind: "system", text: blocked }),
    }));
    return;
  }
  if (!(size > 0) || size > LIVE_MAX_SOL) {
    useAgents.setState({ notice: "Макс. на угоду 0.005 SOL. Угоду не відправляю.", haltReason: "Макс. на угоду 0.005 SOL. Угоду не відправляю." });
    return;
  }
  if (state.roomMainnetSol == null || state.roomMainnetSol < LIVE_MIN_SOL) {
    useAgents.setState({ notice: "Поповни SOL. Агент стоїть.", haltReason: "Поповни SOL. Агент стоїть." });
    return;
  }
  if (state.liveLossStreak >= MAX_LOSSES) {
    useAgents.setState({ notice: "Два мінуси підряд. Боти стоять.", haltReason: "Два мінуси підряд. Боти стоять." });
    return;
  }
  const same = state.liveDayKey === todayKey();
  const liveDay = same ? state.liveDaySpent : 0;
  const liveSession = same ? state.liveSessionSpent : 0;
  if (liveDay + size > LIVE_CAP_SOL) {
    useAgents.setState({ notice: "Ліміт доби 0.02 SOL. Угоду не відправляю." });
    return;
  }
  if (liveSession + size > LIVE_CAP_SOL) {
    useAgents.setState({ notice: "Ліміт сесії 0.02 SOL. Угоду не відправляю." });
    return;
  }
  autoDexFlight = true;
  try {
    if (state.lastLiveSig && !state.lastLiveSigCounted) {
      const gate = await settleUncounted();
      const fresh = useAgents.getState();
      if (!fresh.autoRun || !fresh.wallet) return;
      if (gate === "pending" || liveSending || (fresh.lastLiveSig && !fresh.lastLiveSigCounted)) {
        useAgents.setState({ notice: "Уже є відкрита угода. Нову не ставлю." });
        return;
      }
    } else if (liveSending || liveGate) {
      useAgents.setState({ notice: "Уже є відкрита угода. Нову не ставлю." });
      return;
    }
    const gated = useAgents.getState();
    if (!gated.autoRun || !gated.wallet) return;
    if (gated.liveLossStreak >= MAX_LOSSES) {
      useAgents.setState({ notice: "Два мінуси підряд. Боти стоять.", haltReason: "Два мінуси підряд. Боти стоять." });
      return;
    }
    const quote = await quoteJupiter({ data: { sol: size } });
    const now = useAgents.getState();
    if (!now.autoRun || !now.wallet) return;
    if (!quote.ok) {
      useAgents.setState({ notice: "Jupiter не відповів", liveQuoteUsdc: null });
      return;
    }
    useAgents.setState({
      liveQuoteUsdc: quote.outUsdc,
      notice: "Живий своп Jupiter на mainnet.",
    });
    await sendLiveSwap(size, now.wallet.pubkey);
  } finally {
    autoDexFlight = false;
  }
}

async function fireAutoPoly() {
  if (redeemFlight) {
    useAgents.setState({ notice: "Спочатку погасити виграш. Нову не ставлю." });
    return;
  }
  if (autoPolyFlight) return;
  const armed = useAgents.getState();
  if (!armed.autoRun || !armed.wallet) return;
  if (!ownedKinds(armed).has("prediction")) return;
  if (!anyLane(armed, "crypto")) return;
  if (armed.polyHold && (armed.polyHold.lane === "events" || armed.polyHold.lane === "weather")) {
    useAgents.setState({ notice: "Спочатку закрити відкриту ставку. Нову не ставлю." });
    return;
  }
  const gate = await guardRedeem(true);
  if (gate === "stop") return;
  const start = useAgents.getState();
  if (!start.autoRun || !start.wallet) return;
  if (start.grokFlight && reviewLive()) {
    useAgents.setState({ notice: "Grok ще відповідає. Нову не ставлю." });
    return;
  }
  if (start.polyHold && start.polyHold.lane !== "events" && start.polyHold.lane !== "weather" && cryptoCloseDue(start.polyHold)) {
    try {
      await runClose(start.polyHold, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/\s+/g, " ").trim().slice(0, 180) : "";
      useAgents.setState({ notice: msg || "CLOB 0", polyTicket: null });
    }
  }
  if (cryptoSlotTaken(useAgents.getState())) {
    useAgents.setState({ notice: CRYPTO_SLOT });
    return;
  }
  const pusdNow = useAgents.getState().polyPusd;
  if (pusdNow == null || pusdNow + 1e-9 < 1) {
    useAgents.setState({ notice: "Поповни pUSD. Агент стоїть.", haltReason: "Поповни pUSD. Агент стоїть." });
    return;
  }
  const lane = "crypto" as const;
  autoPolyFlight = true;
  const gen = beginReview();
  useAgents.setState({ grokFlight: true, polyBusy: true, notice: "Читаю ринок і питаю Grok." });
  try {
    const address = start.polyAddress ?? (await ensurePolygonAddress());
    const today = todayKey();
    const spent = start.polyDayKey === today ? start.polyDaySpent : 0;
    const review = await withTimeout(reviewPolymarket({ data: { address, daySpent: spent, lane, ...cryptoPrefs(useAgents.getState()) } }), REVIEW_CAP_MS);
    if (gen !== reviewGen) return;
    const now = useAgents.getState();
    if (!now.autoRun) {
      useAgents.setState({ polyTicket: null, notice: "Авто вимкнено. Нових угод немає." });
      return;
    }
    if (!review.ok) {
      noteLane({ lane: "crypto", market: "15m", action: "skip", pct: null, why: review.error, orderId: null, status: null });
      useAgents.setState({ notice: review.error, polyTicket: null });
      return;
    }
    const traced = rememberGrok(review.place ? null : review.grok);
    if (!review.place) {
      noteLane({
        lane: "crypto",
        market: review.grok?.question || review.grok?.windowLabel || "15m",
        action: review.grok?.action || "skip",
        pct: review.grok?.confidence ?? null,
        why: review.why,
        orderId: null,
        status: null,
      });
      useAgents.setState({
        notice: review.why,
        polyTicket: null,
        lastGrok: traced ?? now.lastGrok,
      });
      if (traced) useAgents.getState().persist();
      return;
    }
    const kept = ticketGrok(review);
    if (!kept || review.model !== GROK_MODEL) {
      useAgents.setState({ notice: "Grok не зібрав рішення.", polyTicket: null, lastGrok: traced ?? now.lastGrok });
      return;
    }
    const spend = Number(review.spend);
    if (review.side === "SELL" || !Number.isFinite(spend) || spend + 1e-9 < 1) {
      useAgents.setState({ notice: "Мінімум ставки 1 pUSD. Поповни. Ордера немає.", polyTicket: null, lastGrok: kept });
      useAgents.getState().persist();
      return;
    }
    if (!useAgents.getState().autoRun) {
      useAgents.setState({ polyTicket: null, lastGrok: kept, notice: "Авто вимкнено. Нових угод немає." });
      useAgents.getState().persist();
      return;
    }
    if (cryptoSlotTaken(useAgents.getState())) {
      useAgents.setState({ notice: CRYPTO_SLOT, polyTicket: null, lastGrok: kept });
      useAgents.getState().persist();
      return;
    }
    const placed = await placePolyOrder(review);
    if (!placed.ok) {
      useAgents.setState({ notice: placed.error, polyTicket: null, lastGrok: kept });
      useAgents.getState().persist();
      return;
    }
    const spentNow = useAgents.getState().polyDayKey === today ? useAgents.getState().polyDaySpent : 0;
    const nextSpent = Number((spentNow + spend).toFixed(6));
    const bought = holdFromBuy(review, placed.orderId);
    if (placed.orderId) restAt.set(placed.orderId, Date.now());
    noteLane({
      lane: "crypto",
      market: review.question || review.windowLabel || "15m",
      action: review.action,
      pct: review.confidence,
      why: review.why,
      orderId: placed.orderId,
      status: placed.status,
    });
    const bals = await readPolyBalances({ data: { address } });
    useAgents.setState({
      polyAddress: address,
      polyTicket: null,
      polyDayKey: today,
      polyDaySpent: nextSpent,
      polyOpenId: placed.orderId,
      polyHold: bought,
      lastPolyOrder: placed.orderId,
      lastPolyStatus: placed.status,
      polyPol: bals.pol,
      polyPusd: bals.pusd,
      polyKnown: true,
      lastGrok: kept,
      notice: `Живий ордер Polymarket CLOB на Polygon · ${placed.orderId} · ${placed.status}`,
      log: pushLog(useAgents.getState().log, {
        id: `poly-${Date.now()}`,
        at: Date.now(),
        kind: "system",
        text: `Живий ордер Polymarket CLOB ${review.spend} pUSD · ${placed.status} · ${placed.orderId}`,
      }),
    });
    useAgents.getState().persist();
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/\s+/g, " ").trim().slice(0, 180) : "";
    useAgents.setState({ notice: msg || "CLOB 0", polyTicket: null });
  } finally {
    autoPolyFlight = false;
    if (endReview(gen)) {
      const live = useAgents.getState();
      const slotFree = live.autoRun && !live.polyOpenId;
      useAgents.setState({
        grokFlight: false,
        polyBusy: false,
        ...(live.notice === "Grok ще відповідає. Нову не ставлю." ? { notice: null } : {}),
        ...(slotFree
          ? {
              agents: {
                ...live.agents,
                prediction: { ...live.agents.prediction, clockMin: 0 },
              },
            }
          : {}),
      });
    }
  }
}

const SIDE_BLOCK = "Спочатку закрити відкриту ставку. Нову не ставлю.";
const SIDE_FLIGHT = "Grok ще відповідає. Нову не ставлю.";
const SIDE_FUNDS = "Поповни pUSD. Агент стоїть.";

function sideBlock(s: { polyRedeem: unknown; polyHold: PolyHold | null; polyOpenId: string | null; grokFlight: boolean; polyBusy: boolean; polyTicket: unknown; polyCancel: unknown; polyPusd: number | null }): "crypto" | "flight" | "card" | "funds" | null {
  if (redeemFlight || cryptoSlotTaken(s)) return "crypto";
  if (autoPolyFlight || s.grokFlight || s.polyBusy) return "flight";
  if (s.polyTicket || s.polyCancel) return "card";
  if (s.polyPusd != null && s.polyPusd + 1e-9 < 1) return "funds";
  return null;
}

async function fireAutoSide(lane: "events" | "weather") {
  if (redeemFlight || autoPolyFlight) return;
  const armed = useAgents.getState();
  if (!armed.autoRun || !armed.wallet || !armed.liveArmed || !armed.liveAck) return;
  if (!ownedKinds(armed).has("prediction")) return;
  if (!anyLane(armed, lane)) return;
  const block = sideBlock(armed);
  if (block === "crypto") {
    useAgents.setState({ notice: SIDE_BLOCK });
    return;
  }
  if (block === "flight") {
    useAgents.setState({ notice: SIDE_FLIGHT });
    return;
  }
  if (block === "funds") {
    useAgents.setState({ notice: SIDE_FUNDS, haltReason: SIDE_FUNDS });
    return;
  }
  if (block === "card") return;
  const wait = eventsCooldownText(useAgents.getState().lastEventsGrokAt);
  if (wait) {
    const notice = useAgents.getState().notice;
    if (notice !== wait && !CRYPTO_NOTICE.has(notice ?? "")) useAgents.setState({ notice: wait });
    return;
  }
  const before = useAgents.getState().polyBooks.length;
  autoPolyFlight = true;
  try {
    await useAgents.getState().reviewPoly(lane);
  } finally {
    autoPolyFlight = false;
  }
  const placed = useAgents.getState().polyBooks.length > before;
  sidePrefer = !placed && lane === "events" ? "weather" : "events";
}

function queueSide(lane: "events" | "weather") {
  const live = useAgents.getState();
  const picked: "events" | "weather" | null = anyLane(live, lane)
    ? lane
    : anyLane(live, lane === "events" ? "weather" : "events")
      ? lane === "events"
        ? "weather"
        : "events"
      : null;
  if (!picked) return;
  if (!live.autoRun || !live.liveArmed || !live.liveAck || !live.wallet) return;
  if (!ownedKinds(live).has("prediction")) return;
  const block = sideBlock(live);
  if (block === "flight" || block === "card") return;
  if (block === "crypto") {
    if (live.notice !== SIDE_BLOCK) useAgents.setState({ notice: SIDE_BLOCK });
    return;
  }
  if (block === "funds") {
    if (live.haltReason !== SIDE_FUNDS) useAgents.setState({ notice: SIDE_FUNDS, haltReason: SIDE_FUNDS });
    return;
  }
  const wait = eventsCooldownText(live.lastEventsGrokAt);
  if (wait) {
    if (live.notice !== wait && !CRYPTO_NOTICE.has(live.notice ?? "")) useAgents.setState({ notice: wait });
    return;
  }
  void fireAutoSide(picked);
}

function enqueueChain(job: ChainJob) {
  if (job.kind === "dex") return;
  const state = useAgents.getState();
  if (state.autoRun) {
    if (job.phase === "lock") void fireAutoPoly();
    return;
  }
  const refuse = (reason: string) => {
    if (job.kind === "prediction" && job.phase === "lock") revertLock(job.fillId, job.asset);
    useAgents.setState((s) => ({
      notice: reason,
      haltReason: reason,
      log: pushLog(s.log, { id: `skip-${Date.now()}`, at: Date.now(), kind: "system", text: reason }),
    }));
  };
  const from = state.wallet?.pubkey ?? peekStoredPubkey("room") ?? "ключ кімнати";
  const to = peekStoredPubkey("market") ?? "ринок кімнати";
  const described = describeJob(job, from, to);
  const daySpent = state.dayKey === todayKey() ? state.daySpent : 0;
  const userBlock = userTradeBlock(described.amount, state.lossStreak, daySpent, dayLossSol());
  if (userBlock) {
    refuse(userBlock);
    return;
  }
  if (described.amount > 0) {
    if (!state.solKnown || state.sol < MIN_WORK_SOL) {
      refuse("Поповни гаманець. Боти стоять.");
      return;
    }
    if (state.lossStreak >= MAX_LOSSES) {
      refuse("Два мінуси підряд. Боти стоять.");
      return;
    }
    if (described.amount > MAX_TRADE_SOL) {
      refuse("Макс. на угоду 0.02 SOL. Угоду не відправляю.");
      return;
    }
    if (daySpent + described.amount > DAY_CAP_SOL) {
      refuse("Ліміт доби 0.3 SOL. Угоду не відправляю.");
      return;
    }
    if (state.sessionSpent + described.amount > state.sessionCapSol) {
      refuse(`Ліміт сесії ${state.sessionCapSol} SOL. Угоду не відправляю.`);
      return;
    }
    if (job.kind === "prediction" && job.phase === "lock") {
      const open =
        state.fills.filter((f) => f.status === "open" && f.id !== job.fillId).length +
        heldTrades.filter((row) => row.job.kind === "prediction" && row.job.phase === "lock").length;
      if (open >= MAX_OPEN) {
        refuse("Уже є відкрита угода. Нову не ставлю.");
        return;
      }
    }
  }
  heldTrades.push({ id: `${Date.now().toString(36)}-${heldTrades.length}`, job, ...described });
  showNextTrade();
}

function sendChain(job: ChainJob) {
  enqueue(async () => {
    const user = await loadKeypair();
    if (!user) return;
    const market = await loadMarketKeypair();
    try {
      await (await loadChain()).fundIfNeeded(market);
      if (job.kind === "dex") {
        const from = job.side === "buy" ? user : market;
        const to = job.side === "buy" ? market.publicKey : user.publicKey;
        const bal = (await (await loadChain()).balanceLamports(from.publicKey)) / LAMPORTS_PER_SOL;
        const amount = Math.min(job.amount, Math.max(0, bal - 0.08));
        if (amount < 0.001) throw new Error("Мало тестового SOL для переказу");
        const sig = await (await import("./sak")).sakMove({ from, to, amount, mint: null });
        await refreshBalances(user);
        useAgents.setState((s) => ({
          notice: `Agent Kit ${job.side} ${amount} · ${sig.slice(0, 8)}…`,
          log: pushLog(s.log, {
            id: sig,
            at: Date.now(),
            kind: "dex",
            text: `Solana Agent Kit ${job.side} ${amount} SOL · ${sig}`,
          }),
        }));
        return;
      }
      const sig = await (await loadChain()).commitPrediction({
        user,
        market,
        track: "live",
        stake: job.stake,
        pnl: job.pnl,
        win: job.win,
        memo: job.memo,
        phase: job.phase,
      });
      await refreshBalances(user);
      if (!sig) {
        useAgents.setState((s) => ({
          notice: "RIG закрив вікно в мінус. Ставка лишилась на ринку.",
          log: pushLog(s.log, {
            id: `settle-${job.fillId}`,
            at: Date.now(),
            kind: "prediction",
            text: `RIG мінус ${job.stake} · без виплати`,
          }),
        }));
        return;
      }
      useAgents.setState((s) => ({
        notice:
          job.phase === "lock"
            ? `Тестовий переказ Devnet ${job.stake} SOL · ${sig.slice(0, 8)}…`
            : `RIG повернув кошти · ${sig.slice(0, 8)}…`,
        log: pushLog(s.log, {
          id: sig,
          at: Date.now(),
          kind: "prediction",
          text: `RIG ${job.phase} ${job.stake} · ${sig}`,
        }),
      }));
    } catch (e) {
      if (job.kind === "prediction" && job.phase === "lock") revertLock(job.fillId, job.asset);
      throw e;
    }
  });
}

let tickCount = 0;
let workMarkedAt: number | null = null;
let workCarryMs = 0;
let workPersistAt = 0;
const workChainAt = new Map<string, number>();

function stampWork(
  now: number,
  nfts: AgentNft[],
  agents: Record<AgentKind, AgentRuntime>,
  owner: string,
  fills: AgentFill[],
): { nfts: AgentNft[]; checkpoint: AgentNft | null } {
  if (workMarkedAt == null) {
    workMarkedAt = now;
    return { nfts, checkpoint: null };
  }
  const dt = Math.min(4000, Math.max(0, now - workMarkedAt));
  workMarkedAt = now;
  workCarryMs += dt;
  const add = Math.floor(workCarryMs / 1000);
  if (add <= 0) return { nfts, checkpoint: null };
  workCarryMs -= add * 1000;
  const rt = agents.prediction;
  if (rt.status !== "working" || !rt.sourceAsset) return { nfts, checkpoint: null };
  const nft = nfts.find((n) => n.asset === rt.sourceAsset && n.owner === owner);
  if (!nft || !workClockOn(nft)) return { nfts, checkpoint: null };
  const workedSec = (nft.metrics.workedSec ?? 0) + add;
  const closed = fills.filter((f) => f.asset === nft.asset && f.status === "settled");
  const next: AgentNft = {
    ...nft,
    updatedAt: now,
    graduated: workedSec >= 480 * 3600,
    metrics: {
      ...nft.metrics,
      workedSec,
      aprPct: aprFromClosed(workedSec, closed),
    },
  };
  if (now - workPersistAt >= 30_000) {
    workPersistAt = now;
    queueMicrotask(() => useAgents.getState().persist());
  }
  const prev = workChainAt.get(nft.asset) ?? 0;
  const hitGoal = workedSec >= 480 * 3600 && prev < 480 * 3600;
  const checkpoint = workedSec - prev >= 300 || hitGoal ? next : null;
  if (checkpoint) workChainAt.set(nft.asset, workedSec);
  return { nfts: nfts.map((n) => (n.asset === nft.asset ? next : n)), checkpoint };
}
let writing = false;
let writeQueued: { nft: AgentNft; onSig: (sig: string) => void; onErr: (msg: string) => void } | null = null;

function pumpWrite() {
  const job = writeQueued;
  writeQueued = null;
  if (!job) {
    writing = false;
    return;
  }
  writing = true;
  void (async () => {
    try {
      const kp = await loadKeypair();
      if (!kp) return;
      const sig = await (await loadChain()).writeCore(kp, job.nft);
      job.onSig(sig);
    } catch (e) {
      job.onErr(errText(e));
    } finally {
      pumpWrite();
    }
  })();
}

function queueWrite(nft: AgentNft, onSig: (sig: string) => void, onErr: (msg: string) => void) {
  if (!nft.coreCollection) return;
  writeQueued = { nft, onSig, onErr };
  if (!writing) pumpWrite();
}

type PhantomSigner = {
  signAndSendTransaction: (tx: VersionedTransaction) => Promise<{ signature?: string } | string>;
};

let phantomSigner: PhantomSigner | null = null;
let liveSending = false;

export function bindPhantomSigner(signer: PhantomSigner | null) {
  phantomSigner = signer;
}

export function currentPhantomSigner(): PhantomSigner | null {
  return phantomSigner;
}

async function sendLiveSwap(amount: number, user: string) {
  liveSending = true;
  let sentSig = "";
  try {
    const built = await buildJupiterSwap({ data: { sol: amount, user } });
    if (!built.ok) {
      useAgents.setState({ notice: built.error, haltReason: built.error });
      return;
    }
    const kp = await loadKeypair();
    if (!kp || kp.publicKey.toBase58() !== user) {
      useAgents.setState({ notice: "Ключ кімнати не підписав. Нічого не відправлено." });
      return;
    }
    const raw = Uint8Array.from(atob(built.tx), (c) => c.charCodeAt(0));
    const tx = VersionedTransaction.deserialize(raw);
    tx.sign([kp]);
    let bin = "";
    tx.serialize().forEach((b) => {
      bin += String.fromCharCode(b);
    });
    const sent = await sendMainnetTx({ data: { tx: btoa(bin) } });
    if (!sent.ok) throw new Error(sent.error);
    sentSig = sent.signature || (tx.signatures[0] ? encodeBase58(tx.signatures[0]) : "");
    useAgents.setState((s) => ({
      lastLiveSig: sentSig || s.lastLiveSig,
      lastLiveSigCounted: false,
      lastLiveAmount: amount,
      lastLiveAt: sentSig ? Date.now() : s.lastLiveAt,
      notice: `Живий своп Jupiter на mainnet · ${sentSig}`,
      log: pushLog(s.log, {
        id: sentSig || `jup-${Date.now()}`,
        at: Date.now(),
        kind: "dex",
        text: `Живий своп Jupiter на mainnet ${amount} SOL · ключ кімнати · ${sentSig}`,
      }),
    }));
    useAgents.getState().persist();
    const confirmed = await confirmMainnetTx({ data: { signature: sentSig } });
    if (!confirmed.ok) {
      if (confirmed.reason === "timeout") {
        useAgents.setState({
          notice: `Живий своп Jupiter на mainnet · ${sentSig}. Мережа ще не підтвердила. Баланс не оновлюю.`,
        });
        return;
      }
      const streak = useAgents.getState().liveLossStreak + 1;
      const stop = streak >= MAX_LOSSES;
      const why = confirmed.error || "Mainnet відхилив транзакцію.";
      useAgents.setState({
        liveLossStreak: streak,
        lastLiveSigCounted: true,
        liveArmed: stop ? false : useAgents.getState().liveArmed,
        haltReason: stop ? "Два мінуси підряд. Боти стоять." : why,
        notice: stop
          ? "Два мінуси підряд. Боти стоять."
          : `Живий своп Jupiter на mainnet · ${sentSig}. ${why}`,
      });
      useAgents.getState().persist();
      return;
    }
    const today = todayKey();
    useAgents.setState((s) => {
      if (s.lastLiveSigCounted) return {};
      const same = s.liveDayKey === today;
      const day = same ? s.liveDaySpent : 0;
      const session = same ? s.liveSessionSpent : 0;
      return {
        liveSessionSpent: Number((session + amount).toFixed(4)),
        liveDayKey: today,
        liveDaySpent: Number((day + amount).toFixed(4)),
        liveLossStreak: 0,
        lastLiveSigCounted: true,
        haltReason: null,
      };
    });
    useAgents.getState().persist();
    try {
      const main = await readMainnetBalance({ data: { owner: user } });
      const usdc = await readMainnetUsdc({ data: { owner: user } });
      const low = typeof main === "number" && main < LIVE_MIN_SOL;
      useAgents.setState({
        ...(typeof main === "number" ? { roomMainnetSol: main } : {}),
        ...(typeof usdc === "number"
          ? { roomMainnetUsdc: usdc, roomMainnetUsdcKnown: true }
          : { roomMainnetUsdc: null, roomMainnetUsdcKnown: true }),
        haltReason: low ? "Поповни гаманець. Боти стоять." : null,
        notice: low
          ? `Живий своп Jupiter на mainnet · ${sentSig}. Поповни гаманець. Боти стоять.`
          : `Живий своп Jupiter на mainnet · ${sentSig}`,
      });
    } catch {
      useAgents.setState({
        notice: `Живий своп Jupiter на mainnet · ${sentSig}`,
      });
    }
  } catch (e) {
    if (sentSig) {
      useAgents.setState({
        notice: `Живий своп Jupiter на mainnet · ${sentSig}. Мережа ще не підтвердила. Баланс не оновлюю.`,
      });
      return;
    }
    const why = e instanceof Error ? e.message.slice(0, 160) : "Mainnet не прийняв транзакцію.";
    useAgents.setState({ haltReason: why, notice: why });
  } finally {
    liveSending = false;
  }
}

export const useAgents = create<AgentsState>((set, get) => ({
  ready: false,
  tab: "work",
  track: "live",
  wallet: null,
  sol: 0,
  solKnown: false,
  solMiss: false,
  paperSol: 0,
  nfts: [],
  listings: [],
  log: [],
  fills: [],
  feeLedger: [],
  focusAsset: null,
  agents: idleRuntimes(),
  working: false,
  aiBusy: false,
  aiCalls: 0,
  betCalls: 0,
  chainBusy: false,
  pendingTrade: null,
  sessionCapSol: SESSION_CAP_SOL,
  sessionSpent: 0,
  ...readLimits(),
  haltReason: null,
  externalWallet: null,
  externalSol: null,
  roomMainnetSol: null,
  roomMainnetSolKnown: false,
  roomMainnetUsdc: null,
  roomMainnetUsdcKnown: false,
  arbCredit: {},
  mintCollection: null,
  arbHouse: null,
  liveArmed: false,
  liveAck: false,
  autoRun: false,
  liveSessionSpent: 0,
  liveDaySpent: 0,
  liveDayKey: todayKey(),
  liveLossStreak: 0,
  secretSeen: false,
  lastLiveSig: null,
  lastLiveSigCounted: false,
  lastLiveAmount: 0,
  lastLiveAt: 0,
  liveQuoteUsdc: null,
  polyAddress: null,
  polyPol: null,
  polyPusd: null,
  polyKnown: false,
  twap: null,
  polyDayKey: "",
  polyDaySpent: 0,
  polyOpenId: null,
  polyHold: null,
  polyBooks: [],
  polyTicket: null,
  polyCancel: null,
  polyRedeem: null,
  polyBusy: false,
  grokFlight: false,
  lastGrok: null,
  laneNotes: [],
  lastEventsGrokAt: 0,
  lastPolyOrder: null,
  lastPolyStatus: null,
  bridgeSvm: null,
  bridgeWhy: null,
  bridgePlan: null,
  bridgeBusy: false,
  bridgeStatus: null,
  brain: null,
  notice: null,
  quote: null,

  setExternalWallet(pubkey, sol) {
    set({ externalWallet: pubkey, externalSol: sol });
  },

  setLiveArmed(on) {
    if (on && !get().wallet) {
      set({ liveArmed: false, notice: "Гаманець кімнати ще не готовий." });
      return;
    }
    set({
      liveArmed: on,
      liveAck: on ? get().liveAck : false,
      notice: on ? "Живий режим увімкнено. Ще потрібна згода на живий SOL." : "Пісочниця Devnet.",
    });
    get().persist();
  },

  setLiveAck(on) {
    if (on && !get().liveArmed) {
      set({ liveAck: false, notice: "Спочатку ввімкни дрібні живі угоди." });
      return;
    }
    set({ liveAck: on });
    get().persist();
  },

  setAutoRun(on) {
    if (!on) {
      clearUnsent();
      set({
        autoRun: false,
        working: false,
        polyCancel: null,
        polyRedeem: null,
        polyTicket: get().polyBusy ? get().polyTicket : null,
        notice: "Авто вимкнено. Нових угод немає.",
      });
      get().persist();
      return;
    }
    const now = get();
    if (!now.wallet) {
      set({ autoRun: false, notice: "Гаманець кімнати ще не готовий." });
      return;
    }
    const kinds = ownedKinds(now);
    if (!kinds.has("prediction")) {
      set({ autoRun: false, notice: "Немає агента. Купіть готового в Store." });
      return;
    }
    if (now.polyPusd == null || now.polyPusd + 1e-9 < 1) {
      set({ autoRun: false, notice: "Поповни pUSD. Агент стоїть.", haltReason: "Поповни pUSD. Агент стоїть." });
      return;
    }
    set({
      autoRun: true,
      haltReason: null,
      notice: "Агент працює сам у межах лімітів.",
    });
    void fireAutoPoly();
    if (!get().working) void get().pressWork();
    get().persist();
  },

  markSecretSeen() {
    set({ secretSeen: true });
  },

  async restoreRoomKey(secret) {
    try {
      const wallet = await importRoomSecret(secret);
      const kp = await loadKeypair();
      if (!kp || kp.publicKey.toBase58() !== wallet.pubkey) throw new Error("не розшифрувався");
      const sol = await readSol(kp.publicKey);
      const main = await readMainnetBalance({ data: { owner: wallet.pubkey } });
      const usdc = await readMainnetUsdc({ data: { owner: wallet.pubkey } });
      set({
        wallet,
        ...(sol == null ? { solKnown: false, solMiss: true } : { sol, solKnown: true, solMiss: false }),
        roomMainnetSol: typeof main === "number" ? main : null,
        roomMainnetSolKnown: true,
        roomMainnetUsdc: typeof usdc === "number" ? usdc : null,
        roomMainnetUsdcKnown: true,
        secretSeen: true,
        notice: `Ключ кімнати повернуто: ${wallet.pubkey}`,
      });
    } catch {
      set({ notice: "Секрет не підійшов. Ключ не замінив." });
    }
  },

  async restorePolygonKey(secret) {
    try {
      const address = await importPolygonSecret(secret);
      const bals = await readPolyBalances({ data: { address } });
      set({
        polyAddress: address,
        polyPol: bals.pol,
        polyPusd: bals.pusd,
        polyKnown: true,
        notice: `Гаманець Polygon повернуто: ${address}`,
      });
    } catch {
      set({ notice: "Секрет Polygon не підійшов. Гаманець не замінив." });
    }
  },

  setLiveQuoteUsdc(usdc) {
    set({ liveQuoteUsdc: usdc });
  },

  confirmTrade() {
    const pending = get().pendingTrade;
    if (!pending) return;
    const row = dropHeld(pending.id);
    if (!row) {
      set({ pendingTrade: null });
      return;
    }
    if (row.live) {
      set({ pendingTrade: null, notice: "Нічого не відправлено." });
      showNextTrade();
      return;
    }
    const today = todayKey();
    const prev = get();
    const daySpent = prev.dayKey === today ? prev.daySpent : 0;
    const nextDay = Number((daySpent + row.amount).toFixed(4));
    const nextSession = Number((prev.sessionSpent + row.amount).toFixed(4));
    let lossStreak = prev.lossStreak;
    if (row.job.kind === "prediction" && row.job.phase === "settle") {
      lossStreak = row.job.win ? 0 : lossStreak + 1;
    }
    const halted = lossStreak >= MAX_LOSSES;
    writeLimits(today, nextDay, lossStreak);
    set({
      pendingTrade: null,
      dayKey: today,
      daySpent: nextDay,
      sessionSpent: nextSession,
      lossStreak,
      haltReason: halted ? "Два мінуси підряд. Боти стоять." : null,
      working: halted ? false : prev.working,
      notice: halted
        ? "Два мінуси підряд. Боти стоять."
        : "Підтверджено. Шлю тестову транзакцію Devnet.",
    });
    sendChain(row.job);
    showNextTrade();
  },

  rejectTrade() {
    const pending = get().pendingTrade;
    if (!pending) return;
    const row = dropHeld(pending.id);
    if (row?.job.kind === "prediction" && row.job.phase === "lock") revertLock(row.job.fillId, row.job.asset);
    set({ pendingTrade: null, notice: "Угоду скасовано. Нічого не відправлено." });
    showNextTrade();
  },

  rejectPoly() {
    if (!get().polyTicket) return;
    set({ polyTicket: null, notice: "Ордер скасовано. Нічого не відправлено." });
  },

  rejectPolyCancel() {
    if (!get().polyCancel || get().polyBusy) return;
    set({ polyCancel: null, notice: "Нічого не відправлено." });
  },

  async confirmPolyCancel() {
    const card = get().polyCancel;
    if (!card || get().polyBusy) return;
    if (!get().liveArmed || !get().liveAck) {
      set({ polyCancel: null, notice: "Живий шлях вимкнений. Нічого не відправлено." });
      return;
    }
    const orderId = card.orderId;
    set({ polyBusy: true, notice: "Скасовую ордер у стакані." });
    try {
      const sent = await cancelPolyOrder(orderId);
      if (!sent.ok) {
        set({ notice: sent.error });
        return;
      }
      if (!sent.canceled) {
        const matched = /match/i.test(sent.why);
        set({
          notice: sent.why || "CLOB не скасував. Слот лишається.",
          ...(matched ? { polyCancel: null } : {}),
        });
        return;
      }
      clearHold("Ордер скасовано в стакані.");
    } catch {
      set({ notice: "CLOB не відповів" });
    } finally {
      set({ polyBusy: false });
    }
  },

  rejectRedeem() {
    if (!get().polyRedeem || get().polyBusy) return;
    set({ polyRedeem: null, notice: "Нічого не відправлено." });
  },

  async confirmRedeem() {
    const card = get().polyRedeem;
    if (!card || get().polyBusy || redeemFlight) return;
    set({ polyBusy: true, notice: "Спочатку погасити виграш. Нову не ставлю." });
    redeemFlight = true;
    try {
      const sent = await redeemPolyPosition(card);
      if (!sent.ok) {
        set({ notice: sent.error || "Редіму немає." });
        return;
      }
      await settleRedeem(sent.hash, card.conditionId);
    } catch {
      set({ notice: "Редіму немає." });
    } finally {
      redeemFlight = false;
      set({ polyBusy: false });
    }
  },

  rejectBridge() {
    if (!get().bridgePlan) return;
    set({ bridgePlan: null, notice: "Депозит скасовано. Нічого не відправлено." });
  },

  async prepareBridgeDeposit(open = false) {
    if (get().bridgeBusy) return;
    const room = get().wallet?.pubkey;
    const polygon = get().polyAddress;
    if (!room || !polygon) {
      set({ bridgeWhy: "немає адреси моста", bridgePlan: open ? null : get().bridgePlan });
      return;
    }
    set({ bridgeBusy: true });
    try {
      const plan = await prepareBridge({ data: { polygon, room } });
      if (!plan.ok) {
        set({ bridgeSvm: null, bridgeWhy: plan.error, bridgePlan: null, bridgeBusy: false });
        return;
      }
      set({
        bridgeSvm: plan.svm,
        bridgeWhy: plan.why,
        bridgePlan: open ? plan : get().bridgePlan,
        bridgeBusy: false,
      });
    } catch {
      set({ bridgeSvm: null, bridgeWhy: "немає адреси моста", bridgePlan: null, bridgeBusy: false });
    }
  },

  async confirmBridge() {
    const shown = get().bridgePlan;
    if (!shown?.canConfirm || get().bridgeBusy) return;
    const room = get().wallet?.pubkey;
    const polygon = get().polyAddress;
    if (!room || !polygon) return;
    set({ bridgeBusy: true });
    try {
      const plan = await prepareBridge({ data: { polygon, room } });
      if (!plan.ok || !plan.canConfirm || !plan.tx) {
        const why = !plan.ok ? plan.error : plan.why || "немає котирування";
        set({
          bridgeBusy: false,
          bridgePlan: plan.ok ? plan : null,
          bridgeSvm: plan.ok ? plan.svm : get().bridgeSvm,
          bridgeWhy: why,
          notice: why,
        });
        return;
      }
      const kp = await loadKeypair();
      if (!kp || kp.publicKey.toBase58() !== room) {
        set({ bridgeBusy: false, notice: "Ключ кімнати не підписав. Нічого не відправлено." });
        return;
      }
      const raw = Uint8Array.from(atob(plan.tx), (c) => c.charCodeAt(0));
      const tx = Transaction.from(raw);
      tx.sign(kp);
      let bin = "";
      tx.serialize().forEach((b) => {
        bin += String.fromCharCode(b);
      });
      const sent = await sendMainnetTx({ data: { tx: btoa(bin) } });
      if (!sent.ok) {
        set({ bridgeBusy: false, notice: sent.error });
        return;
      }
      let status: string | null = null;
      try {
        status = await readBridgeStatus({ data: { svm: plan.svm } });
      } catch {
        status = null;
      }
      const done = status === "COMPLETED";
      try {
        const bals = await readPolyBalances({ data: { address: polygon } });
        const usdc = await readMainnetUsdc({ data: { owner: room } });
        const sol = await readMainnetBalance({ data: { owner: room } });
        set({
          bridgeBusy: false,
          bridgePlan: null,
          bridgeStatus: status,
          bridgeSvm: plan.svm,
          polyKnown: true,
          polyPol: bals.pol,
          polyPusd: bals.pusd,
          ...(typeof usdc === "number" ? { roomMainnetUsdc: usdc, roomMainnetUsdcKnown: true } : {}),
          ...(typeof sol === "number" ? { roomMainnetSol: sol } : {}),
          notice: done
            ? `Депозит Polymarket Bridge · ${status} · ${sent.signature}`
            : `Статус моста: ${status ?? "немає статусу"}. Кошти ще не completed.`,
        });
      } catch {
        set({
          bridgeBusy: false,
          bridgePlan: null,
          bridgeStatus: status,
          bridgeSvm: plan.svm,
          notice: done
            ? `Депозит Polymarket Bridge · ${status} · ${sent.signature}`
            : `Статус моста: ${status ?? "немає статусу"}. Кошти ще не completed. Баланс не вигадую.`,
        });
      }
    } catch {
      set({ bridgeBusy: false, notice: "Депозит не відправлено." });
    }
  },

  async reviewPoly(lane: "crypto" | "events" | "weather") {
    if (!anyLane(get(), lane)) {
      set({ notice: "Смуга вимкнена на NFT. Ордера немає." });
      return;
    }
    if (redeemFlight) {
      set({ notice: "Спочатку погасити виграш. Нову не ставлю." });
      return;
    }
    const stuck = get().grokFlight && !reviewLive();
    if (get().grokFlight && reviewLive()) {
      set({ notice: "Grok ще відповідає. Нову не ставлю." });
      return;
    }
    if (lane === "events" || lane === "weather") {
      const wait = eventsCooldownText(get().lastEventsGrokAt);
      if (wait) {
        set({ notice: wait });
        return;
      }
    }
    if (!stuck && (get().polyBusy || get().polyTicket || get().polyCancel || get().polyRedeem)) {
      if (get().polyRedeem) {
        set({ notice: lane === "events" || lane === "weather" ? SIDE_BLOCK : "Спочатку погасити виграш. Нову не ставлю." });
      }
      return;
    }
    if (lane === "crypto" || lane === "events" || lane === "weather") {
      const gate = await guardRedeem(get().autoRun);
      if (gate === "stop") {
        if (lane === "events" || lane === "weather") set({ notice: SIDE_BLOCK });
        return;
      }
    }
    if (!get().liveArmed || !get().liveAck) {
      set({ notice: "Спочатку обидві галочки живого режиму. Ордера немає." });
      return;
    }
    if ((lane === "events" || lane === "weather") && cryptoSlotTaken(get())) {
      set({ notice: SIDE_BLOCK });
      return;
    }
    if (lane === "crypto" && cryptoSlotTaken(get())) {
      set({ notice: CRYPTO_SLOT });
      return;
    }
    const laneName = lane === "crypto" ? "крипто" : lane === "weather" ? "погоду" : "події";
    const gen = beginReview();
    let sideAsked = false;
    set({ polyBusy: true, grokFlight: true, notice: `Читаю ${laneName} і питаю Grok.` });
    try {
      const address = get().polyAddress ?? (await ensurePolygonAddress());
      const today = todayKey();
      const spent = get().polyDayKey === today ? get().polyDaySpent : 0;
      const bals = await readPolyBalances({ data: { address } });
      if (gen !== reviewGen) return;
      set({
        polyAddress: address,
        polyPol: bals.pol,
        polyPusd: bals.pusd,
        polyKnown: true,
      });
      if (bals.pusd != null && bals.pusd + 1e-9 < 1) {
        if (lane === "events" || lane === "weather") {
          set({ notice: SIDE_FUNDS, haltReason: SIDE_FUNDS, polyTicket: null });
        } else {
          set({ notice: "Мінімум ставки 1 pUSD. Поповни. Ордера немає.", polyTicket: null });
        }
        return;
      }
      const sideLane = lane === "events" || lane === "weather";
      sideAsked = sideLane;
      const review = await withTimeout(
        reviewPolymarket({
          data: {
            address,
            daySpent: spent,
            lane,
            ...(lane === "events" ? { horizonH: eventsHorizonH(get()), skip: heldTokenIds(get()) } : lane === "weather" ? { skip: heldTokenIds(get()) } : cryptoPrefs(get())),
          },
        }),
        REVIEW_CAP_MS,
      );
      if (sideLane) stampEventsGrok();
      if (gen !== reviewGen) return;
      if (!review.ok) {
        noteLane({ lane, market: lane === "crypto" ? "15m" : lane, action: "skip", pct: null, why: review.error, orderId: null, status: null });
        set({ notice: review.error, polyTicket: null });
        return;
      }
      const traced = rememberGrok(review.place ? null : review.grok);
      if (!review.place) {
        noteLane({
          lane,
          market: review.grok?.question || review.grok?.windowLabel || (lane === "crypto" ? "15m" : lane),
          action: review.grok?.action || "skip",
          pct: review.grok?.confidence ?? null,
          why: review.why,
          orderId: null,
          status: null,
        });
        set({
          notice: review.why,
          polyTicket: null,
          lastGrok: traced ?? get().lastGrok,
        });
        if (traced) get().persist();
        return;
      }
      const kept = ticketGrok(review);
      if (!kept || (lane !== "crypto" && review.confidence < 0.65) || review.model !== GROK_MODEL) {
        set({ notice: "Grok не зібрав рішення.", polyTicket: null });
        return;
      }
      if ((lane === "events" || lane === "weather") && !get().autoRun) {
        set({
          polyTicket: review,
          lastGrok: kept,
          notice: "Живий ордер Polymarket CLOB на Polygon. Чекає підтвердження.",
        });
        get().persist();
        return;
      }
      if (lane === "events" || lane === "weather") {
        const spend = Number(review.spend);
        if (!get().liveArmed || !get().liveAck) {
          set({ notice: "Живий шлях вимкнений. Нічого не відправлено.", polyTicket: null, lastGrok: kept });
          return;
        }
        if (cryptoSlotTaken(get())) {
          set({ notice: SIDE_BLOCK, polyTicket: null, lastGrok: kept });
          get().persist();
          return;
        }
        if (heldTokenIds(get()).includes(review.tokenId)) {
          set({ notice: "Уже є ця ставка. Ордера немає.", polyTicket: null, lastGrok: kept });
          get().persist();
          return;
        }
        if (!Number.isFinite(spend) || spend + 1e-9 < 1) {
          set({ notice: SIDE_FUNDS, haltReason: SIDE_FUNDS, polyTicket: null, lastGrok: kept });
          return;
        }
        set({ lastGrok: kept, polyTicket: null, notice: "Підписую ключем Polygon." });
        get().persist();
        const placed = await placePolyOrder(review);
        if (gen !== reviewGen) return;
        if (!placed.ok) {
          set({ notice: placed.error, polyTicket: null, lastGrok: kept });
          get().persist();
          return;
        }
        const day = todayKey();
        const spentNow = get().polyDayKey === day ? get().polyDaySpent : 0;
        const balsNow = await readPolyBalances({ data: { address } });
        if (gen !== reviewGen) return;
        const bought = holdFromBuy(review, placed.orderId);
        const low = balsNow.pusd != null && balsNow.pusd + 1e-9 < 1;
        noteLane({
          lane,
          market: review.question || lane,
          action: review.action,
          pct: review.confidence,
          why: review.why,
          orderId: placed.orderId,
          status: placed.status,
        });
        const halt = get().haltReason;
        set({
          polyTicket: null,
          polyDayKey: day,
          polyDaySpent: Number((spentNow + spend).toFixed(6)),
          polyBooks: pushBook(get().polyBooks, bought),
          lastPolyOrder: placed.orderId,
          lastPolyStatus: placed.status,
          polyPol: balsNow.pol,
          polyPusd: balsNow.pusd,
          polyKnown: true,
          lastGrok: kept,
          haltReason: low ? SIDE_FUNDS : halt === SIDE_FUNDS ? null : halt,
          notice: low ? SIDE_FUNDS : `Живий ордер Polymarket CLOB на Polygon · ${placed.orderId} · ${placed.status}`,
          log: pushLog(get().log, {
            id: `poly-${Date.now()}`,
            at: Date.now(),
            kind: "system",
            text: `Живий ордер Polymarket CLOB ${review.spend} pUSD · ${placed.status} · ${placed.orderId}`,
          }),
        });
        get().persist();
        return;
      }
      if (lane === "crypto") {
        const spend = Number(review.spend);
        if (!get().liveArmed || !get().liveAck) {
          set({ notice: "Живий шлях вимкнений. Нічого не відправлено.", polyTicket: null, lastGrok: kept });
          return;
        }
        if (!Number.isFinite(spend) || spend + 1e-9 < 1) {
          set({ notice: "Мінімум ставки 1 pUSD. Поповни. Ордера немає.", polyTicket: null, lastGrok: kept });
          return;
        }
        if (cryptoSlotTaken(get())) {
          set({ notice: CRYPTO_SLOT, polyTicket: null, lastGrok: kept });
          get().persist();
          return;
        }
        set({ lastGrok: kept, polyTicket: null, notice: "Підписую ключем Polygon." });
        get().persist();
        const placed = await placePolyOrder(review);
        if (gen !== reviewGen) return;
        if (!placed.ok) {
          set({ notice: placed.error, polyTicket: null, lastGrok: kept });
          get().persist();
          return;
        }
        const day = todayKey();
        const spentNow = get().polyDayKey === day ? get().polyDaySpent : 0;
        const balsNow = await readPolyBalances({ data: { address } });
        if (gen !== reviewGen) return;
        if (placed.orderId) restAt.set(placed.orderId, Date.now());
        noteLane({
          lane: "crypto",
          market: review.question || review.windowLabel || "15m",
          action: review.action,
          pct: review.confidence,
          why: review.why,
          orderId: placed.orderId,
          status: placed.status,
        });
        set({
          polyTicket: null,
          polyDayKey: day,
          polyDaySpent: Number((spentNow + spend).toFixed(6)),
          polyOpenId: placed.orderId,
          polyHold: holdFromBuy(review, placed.orderId),
          lastPolyOrder: placed.orderId,
          lastPolyStatus: placed.status,
          polyPol: balsNow.pol,
          polyPusd: balsNow.pusd,
          polyKnown: true,
          lastGrok: kept,
          notice: `Живий ордер Polymarket CLOB на Polygon · ${placed.orderId} · ${placed.status}`,
          log: pushLog(get().log, {
            id: `poly-${Date.now()}`,
            at: Date.now(),
            kind: "system",
            text: `Живий ордер Polymarket CLOB ${review.spend} pUSD · ${placed.status} · ${placed.orderId}`,
          }),
        });
        get().persist();
        return;
      }
      set({
        polyTicket: review,
        lastGrok: kept,
        notice: "Живий ордер Polymarket CLOB на Polygon. Чекає підтвердження.",
      });
      get().persist();
    } catch (e) {
      if (sideAsked) stampEventsGrok();
      const msg = e instanceof Error ? e.message.replace(/\s+/g, " ").trim().slice(0, 180) : "";
      set({ notice: msg || "CLOB 0", polyTicket: null });
    } finally {
      if (endReview(gen)) {
        const n = get().notice;
        set({
          polyBusy: false,
          grokFlight: false,
          ...(n === "Grok ще відповідає. Нову не ставлю." ? { notice: null } : {}),
        });
      }
    }
  },

  async confirmPoly() {
    const ticket = get().polyTicket;
    if (!ticket || get().polyBusy) return;
    const spend = Number(ticket.spend);
    const selling = ticket.side === "SELL" || ticket.action === "sell";
    if (!selling && (!Number.isFinite(spend) || spend + 1e-9 < 1)) {
      set({ polyTicket: null, notice: "Мінімум ставки 1 pUSD. Поповни. Ордера немає." });
      return;
    }
    if (selling && ticket.action !== "sell") {
      set({ polyTicket: null, notice: "Grok не зібрав рішення. Нічого не відправлено." });
      return;
    }
    if (!selling && ticket.action !== "yes" && ticket.action !== "no") {
      set({ polyTicket: null, notice: "Grok не зібрав рішення. Нічого не відправлено." });
      return;
    }
    const cryptoBuy = !selling && ticket.lane === "crypto";
    if (cryptoBuy && cryptoSlotTaken(get())) {
      set({ polyTicket: null, notice: CRYPTO_SLOT });
      return;
    }
    if (!Number.isFinite(ticket.confidence) || ticket.model !== GROK_MODEL || (!cryptoBuy && ticket.confidence < 0.65)) {
      set({ polyTicket: null, notice: "Grok не зібрав рішення. Нічого не відправлено." });
      return;
    }
    if (!get().liveArmed || !get().liveAck) {
      set({ polyTicket: null, notice: "Живий шлях вимкнений. Нічого не відправлено." });
      return;
    }
    const sideBuy = !selling && (ticket.lane === "events" || ticket.lane === "weather");
    if (sideBuy && cryptoSlotTaken(get())) {
      set({ polyTicket: null, notice: SIDE_BLOCK });
      return;
    }
    if (sideBuy && heldTokenIds(get()).includes(ticket.tokenId)) {
      set({ polyTicket: null, notice: "Уже є ця ставка. Ордера немає." });
      return;
    }
    if (selling && !get().polyHold) {
      set({ polyTicket: null, notice: "Немає відкритої позиції. Закриття немає." });
      return;
    }
    set({ polyBusy: true, notice: "Підписую ключем Polygon." });
    try {
      const placed = await placePolyOrder(ticket);
      if (!placed.ok) {
        set({ notice: placed.error });
        return;
      }
      const today = todayKey();
      const spent = get().polyDayKey === today ? get().polyDaySpent : 0;
      const nextSpent = selling ? spent : Number((spent + Number(ticket.spend)).toFixed(6));
      const bought = selling ? null : holdFromBuy(ticket, placed.orderId);
      if (!selling && placed.orderId && !sideBuy) restAt.set(placed.orderId, Date.now());
      const address = get().polyAddress;
      const bals = address ? await readPolyBalances({ data: { address } }) : { pol: null, pusd: null };
      const low = sideBuy && bals.pusd != null && bals.pusd + 1e-9 < 1;
      const halt = get().haltReason;
      set({
        polyTicket: null,
        polyDayKey: today,
        polyDaySpent: nextSpent,
        polyOpenId: selling ? null : sideBuy ? get().polyOpenId : placed.orderId,
        polyHold: selling ? null : sideBuy ? get().polyHold : bought,
        ...(sideBuy
          ? {
              polyBooks: pushBook(get().polyBooks, bought),
              haltReason: low ? SIDE_FUNDS : halt === SIDE_FUNDS ? null : halt,
            }
          : {}),
        lastPolyOrder: placed.orderId,
        lastPolyStatus: placed.status,
        polyPol: bals.pol,
        polyPusd: bals.pusd,
        polyKnown: true,
        notice: low ? SIDE_FUNDS : `Живий ордер Polymarket CLOB на Polygon · ${placed.orderId} · ${placed.status}`,
        log: pushLog(get().log, {
          id: `poly-${Date.now()}`,
          at: Date.now(),
          kind: "system",
          text: `Живий ордер Polymarket CLOB ${selling ? "SELL" : ticket.spend + " pUSD"} · ${placed.status} · ${placed.orderId}`,
        }),
      });
      get().persist();
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/\s+/g, " ").trim().slice(0, 180) : "";
      set({ notice: msg || "CLOB 0", polyTicket: null });
    } finally {
      set({ polyBusy: false });
    }
  },

  persist() {
    const { sol, paperSol, nfts, listings, log, fills, feeLedger, lastLiveSig, lastLiveSigCounted, lastLiveAmount, lastLiveAt, liveDayKey, liveDaySpent, liveSessionSpent, liveLossStreak, polyDayKey, polyDaySpent, polyOpenId, polyHold, polyBooks, lastGrok, laneNotes, lastEventsGrokAt, liveArmed, liveAck, autoRun } =
      get();
    saveState({
      version: SAVE_VERSION,
      sol,
      paperSol,
      nfts,
      listings,
      log,
      fills,
      feeLedger,
      lastLiveSig,
      lastLiveSigCounted,
      lastLiveAmount,
      lastLiveAt,
      liveDayKey,
      liveDaySpent,
      liveSessionSpent,
      liveLossStreak,
      polyDayKey,
      polyDaySpent,
      polyOpenId,
      polyHold,
      polyBooks,
      lastGrok,
      laneNotes,
      lastEventsGrokAt,
      liveArmed,
      liveAck,
      autoRun,
    });
  },

  async hydrate() {
    if (get().ready) return;
    const saved = loadState();
    let wallet: WalletRecord;
    try {
      wallet = (await loadWallet()) ?? (await createWallet());
    } catch (e) {
      set({
        ready: true,
        notice: e instanceof Error ? e.message : "Ключ не розшифрувався",
        solKnown: false,
        solMiss: true,
        roomMainnetSolKnown: true,
        roomMainnetUsdcKnown: true,
        polyKnown: true,
      });
      return;
    }
    const track = "live";
    const nfts = saved.nfts.filter((n) => n.owner === wallet.pubkey);
    set({
      ready: true,
      wallet,
      sol: 0,
      solKnown: false,
      paperSol: 0,
      nfts,
      arbCredit: Object.fromEntries(nfts.filter((n) => n.classId === 2).map((n) => [n.asset, readArbCredit(n.asset)])),
      listings: saved.listings,
      log: saved.log,
      fills: saved.fills,
      feeLedger: saved.feeLedger,
      lastLiveSig: saved.lastLiveSig,
      lastLiveSigCounted: saved.lastLiveSigCounted,
      lastLiveAmount: saved.lastLiveAmount,
      lastLiveAt: saved.lastLiveAt,
      liveDayKey: saved.liveDayKey,
      liveDaySpent: saved.liveDaySpent,
      liveSessionSpent: saved.liveSessionSpent,
      liveLossStreak: saved.liveLossStreak,
      polyDayKey: saved.polyDayKey,
      polyDaySpent: saved.polyDaySpent,
      polyOpenId: saved.polyOpenId,
      polyHold: saved.polyHold,
      polyBooks: saved.polyBooks,
      lastGrok: saved.lastGrok,
      laneNotes: saved.laneNotes,
      lastEventsGrokAt: saved.lastEventsGrokAt,
      grokFlight: false,
      liveArmed: saved.liveArmed,
      liveAck: saved.liveAck,
      autoRun: false,
      track,
      brain: STACK,
    });
    get().armArb();
    void (async () => {
      try {
        const found = await (await loadChain()).fetchOwnedAgents(wallet.pubkey);
        if (!found.length || get().wallet?.pubkey !== wallet.pubkey) return;
        const prev = get().nfts.filter((n) => n.owner === wallet.pubkey);
        const byAsset = new Map(prev.map((n) => [n.asset, n]));
        for (const n of found) {
          const old = byAsset.get(n.asset);
          const pulled = { ...n, strategy: clampStrategy(n.strategy), owner: wallet.pubkey };
          const workedSec = Math.max(old?.metrics.workedSec ?? 0, pulled.metrics.workedSec ?? 0);
          byAsset.set(
            n.asset,
            old
              ? {
                  ...pulled,
                  ...old,
                  // Chain is the truth for tier and collection (server URI), not the local save.
                  tier: pulled.tier,
                  coreCollection: pulled.coreCollection,
                  owner: wallet.pubkey,
                  strategy: clampStrategy(old.strategy),
                  graduated: workedSec >= 480 * 3600,
                  metrics: {
                    ...pulled.metrics,
                    ...old.metrics,
                    workedSec,
                    aprPct: old.metrics.aprPct ?? pulled.metrics.aprPct ?? null,
                  },
                }
              : pulled,
          );
        }
        set({ nfts: [...byAsset.values()] });
        void syncServerLedgers(wallet.pubkey).catch(() => undefined);
        const live = get();
        const real = [...byAsset.values()].find((n) => n.classId === 2 && n.asset !== "local-dex-arb" && n.owner === wallet.pubkey);
        if (real && live.agents.dex.sourceAsset === "local-dex-arb") {
          set({
            agents: {
              ...live.agents,
              dex: { ...live.agents.dex, sourceAsset: real.asset, config: real.strategy.dex },
            },
          });
        }
      } catch {
        /* RPC quiet — keep what was already saved for this room */
        void syncServerLedgers(wallet.pubkey).catch(() => undefined);
      }
    })();
    const resume = () => {
      if (saved.autoRun && get().liveArmed && get().liveAck) get().setAutoRun(true);
      else get().persist();
    };
    try {
      const kp = await loadKeypair();
      if (!kp) {
        let main: number | null = null;
        let usdc: number | null = null;
        try {
          [main, usdc] = await Promise.all([
            readMainnetBalance({ data: { owner: wallet.pubkey } }),
            readMainnetUsdc({ data: { owner: wallet.pubkey } }),
          ]);
        } catch {
          main = null;
          usdc = null;
        }
        set({
          solKnown: false,
          solMiss: true,
          notice: "Ключ не розшифрувався",
          roomMainnetSol: typeof main === "number" ? main : null,
          roomMainnetSolKnown: true,
          roomMainnetUsdc: typeof usdc === "number" ? usdc : null,
          roomMainnetUsdcKnown: true,
        });
        try {
          const polyAddress = await ensurePolygonAddress();
          set({ polyAddress });
          const bals = await readPolyBalances({ data: { address: polyAddress } });
          const signer = await loadPolygonAccount();
          set({
            polyAddress,
            polyPol: bals.pol,
            polyPusd: bals.pusd,
            polyKnown: true,
            ...(!signer ? { notice: "Ключ Polygon не розшифрувався. Встав записаний секрет." } : {}),
          });
          await guardRedeem(false);
        } catch {
          set({ polyKnown: true });
        }
        void get().refreshTwap();
        resume();
        return;
      }
      const sol = await readSol(kp.publicKey);
      if (sol == null) {
        set({ solKnown: false, solMiss: true, notice: "немає цифри" });
      } else {
        set({
          sol,
          solKnown: true,
          solMiss: false,
          paperSol: 0,
          notice:
            sol < 0.02
              ? `Гаманець ${shortAddr(wallet.pubkey)} уже на пристрої. На Devnet ${sol.toFixed(4)} SOL — вкажи суму й натисни «Поповнити».`
              : get().notice,
        });
      }
      get().persist();
      const [main, usdc] = await Promise.all([
        readMainnetBalance({ data: { owner: wallet.pubkey } }).catch(() => null),
        readMainnetUsdc({ data: { owner: wallet.pubkey } }).catch(() => null),
      ]);
      set({
        roomMainnetSol: typeof main === "number" ? main : null,
        roomMainnetSolKnown: true,
        roomMainnetUsdc: typeof usdc === "number" ? usdc : null,
        roomMainnetUsdcKnown: true,
      });
      if (get().lastLiveSig && !get().lastLiveSigCounted) {
        await settleUncounted();
      }
      try {
        const polyAddress = await ensurePolygonAddress();
        set({ polyAddress });
        const bals = await readPolyBalances({ data: { address: polyAddress } });
        const signer = await loadPolygonAccount();
        set({
          polyAddress,
          polyPol: bals.pol,
          polyPusd: bals.pusd,
          polyKnown: true,
          ...(!signer ? { notice: "Ключ Polygon не розшифрувався. Встав записаний секрет." } : {}),
        });
        await guardRedeem(false);
      } catch {
        set({ polyKnown: true, polyPol: null, polyPusd: null });
      }
    } catch {
      set({
        solKnown: false,
        solMiss: true,
        notice: "немає цифри",
        roomMainnetSolKnown: true,
        roomMainnetUsdcKnown: true,
        roomMainnetUsdc: null,
      });
      try {
        const polyAddress = await ensurePolygonAddress();
        set({ polyAddress });
        const bals = await readPolyBalances({ data: { address: polyAddress } });
        set({ polyAddress, polyPol: bals.pol, polyPusd: bals.pusd, polyKnown: true });
        await guardRedeem(false);
      } catch {
        set({ polyKnown: true, polyPol: null, polyPusd: null });
      }
    }
    void get().refreshTwap();
    resume();
  },

  setTab(tab) {
    set({ tab });
    if (!get().wallet) void get().ensureWallet().catch(() => set({ notice: "Гаманець кімнати не відкрився. Онови сторінку." }));
  },

  setTrack() {
    set({ track: "live" });
  },

  async ensureWallet() {
    const current = get().wallet ?? (await loadWallet());
    const wallet = current ?? (await createWallet());
    set({ wallet });
    try {
      const kp = await loadKeypair();
      if (!kp) {
        let main: number | null = null;
        try {
          main = await readMainnetBalance({ data: { owner: wallet.pubkey } });
        } catch {
          main = null;
        }
        set({
          solKnown: false,
          solMiss: true,
          notice: "Ключ не розшифрувався",
          roomMainnetSol: typeof main === "number" ? main : null,
          roomMainnetSolKnown: true,
          roomMainnetUsdcKnown: true,
        });
        get().persist();
        return wallet;
      }
      const sol = await readSol(kp.publicKey);
      if (sol == null) {
        set({ solKnown: false, solMiss: true, notice: "немає цифри" });
        get().persist();
        return wallet;
      }
      set((s) => ({
        wallet,
        sol,
        solKnown: true,
        solMiss: false,
        paperSol: 0,
        notice:
          sol < 0.02
            ? `Ключ ${shortAddr(wallet.pubkey)} на пристрої. На Devnet ${sol.toFixed(4)} SOL. Вкажи суму й натисни «Поповнити».`
            : s.notice,
        log: s.log.some((e) => e.id === `w-${wallet.createdAt}`)
          ? s.log
          : pushLog(s.log, {
              id: `w-${wallet.createdAt}`,
              at: Date.now(),
              kind: "system",
              text: `Гаманець ${wallet.pubkey}. Секрет лишився в браузері.`,
            }),
      }));
      get().persist();
      return wallet;
    } catch (e) {
      let sol: number | null = null;
      try {
        const kp = await loadKeypair();
        if (kp) sol = await readSol(kp.publicKey);
      } catch {
        sol = null;
      }
      if (sol == null) {
        set({ solKnown: false, solMiss: true, notice: errText(e) });
      } else {
        set({ sol, solKnown: true, solMiss: false, notice: errText(e) });
      }
      get().persist();
      return wallet;
    }
  },

  async deposit(sol) {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return;
    }
    const amount = Math.round(Number(sol) * 1e9) / 1e9;
    if (!Number.isFinite(amount) || amount <= 0) {
      set({ notice: "Вкажи суму в SOL." });
      return;
    }
    if (amount > 100) {
      set({ notice: "За один раз кран бере до 100 тестових SOL." });
      return;
    }
    await get().ensureWallet();
    const kp = await loadKeypair();
    if (!kp) {
      set({ notice: "Немає ключа" });
      return;
    }
    set({ chainBusy: true, notice: `Прошу ${amount} SOL у крана Devnet…` });
    try {
      const sig = await (await loadChain()).airdropDevnet(kp.publicKey, amount);
      const next = await readSol(kp.publicKey);
      if (next == null) {
        set({ chainBusy: false, solKnown: false, solMiss: true, notice: "немає цифри" });
        return;
      }
      set((s) => ({
        chainBusy: false,
        sol: next,
        solKnown: true,
        solMiss: false,
        notice: `Кран підтвердив ${sig.slice(0, 8)}…. Зараз ${next.toFixed(4)} SOL.`,
        log: pushLog(s.log, {
          id: sig,
          at: Date.now(),
          kind: "system",
          text: `Поповнення ${amount} SOL · ${sig}`,
        }),
      }));
      get().persist();
    } catch (e) {
      const next = await readSol(kp.publicKey);
      if (next == null) {
        set({ chainBusy: false, solKnown: false, solMiss: true, notice: errText(e) });
      } else {
        set({ chainBusy: false, sol: next, solKnown: true, solMiss: false, notice: errText(e) });
      }
      get().persist();
    }
  },

  async sweepMainnetSol() {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return;
    }
    const room = get().wallet?.pubkey;
    const kp = await loadKeypair();
    if (!kp || !room || kp.publicKey.toBase58() !== room) {
      set({ notice: "Ключ кімнати не підписав. Нічого не відправлено." });
      return;
    }
    set({ chainBusy: true, notice: "Збираю весь mainnet SOL…" });
    try {
      const built = await prepareMainnetSweep({ data: { ping: true } });
      if (!built.ok) {
        set({ chainBusy: false, notice: built.error });
        return;
      }
      const raw = Uint8Array.from(atob(built.tx), (c) => c.charCodeAt(0));
      const tx = Transaction.from(raw);
      tx.sign(kp);
      let bin = "";
      tx.serialize().forEach((b) => {
        bin += String.fromCharCode(b);
      });
      const sent = await sendMainnetTx({ data: { tx: btoa(bin) } });
      if (!sent.ok) {
        set({ chainBusy: false, notice: sent.error });
        return;
      }
      const confirmed = await confirmMainnetTx({ data: { signature: sent.signature } });
      const sol = await readMainnetBalance({ data: { owner: room } });
      const moved = (built.lamports / LAMPORTS_PER_SOL).toFixed(6);
      const dest = "C7De9z…Trsf";
      set((s) => ({
        chainBusy: false,
        ...(typeof sol === "number" ? { roomMainnetSol: sol } : {}),
        notice: confirmed.ok
          ? `Mainnet ${moved} SOL → ${dest} · ${sent.signature}`
          : `Підпис пішов, мережа ще не підтвердила · ${sent.signature}`,
        log: pushLog(s.log, {
          id: sent.signature,
          at: Date.now(),
          kind: "system",
          text: `Mainnet ${moved} SOL → ${dest} · ${sent.signature}`,
        }),
      }));
      get().persist();
    } catch (e) {
      set({ chainBusy: false, notice: errText(e) });
    }
  },

  async withdrawMainnet(to, amount) {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return;
    }
    const room = get().wallet?.pubkey;
    const kp = await loadKeypair();
    if (!kp || !room || kp.publicKey.toBase58() !== room) {
      set({ notice: "Ключ агента не підписав. Нічого не відправлено." });
      return;
    }
    set({ chainBusy: true, notice: "Виводжу SOL з гаманця агента…" });
    try {
      const built = await prepareMainnetSend({ data: { from: room, to: to.trim(), sol: amount } });
      if (!built.ok) {
        set({ chainBusy: false, notice: built.error });
        return;
      }
      const raw = Uint8Array.from(atob(built.tx), (c) => c.charCodeAt(0));
      const tx = Transaction.from(raw);
      tx.sign(kp);
      let bin = "";
      tx.serialize().forEach((b) => {
        bin += String.fromCharCode(b);
      });
      const sent = await sendMainnetTx({ data: { tx: btoa(bin) } });
      if (!sent.ok) {
        set({ chainBusy: false, notice: sent.error });
        return;
      }
      const confirmed = await confirmMainnetTx({ data: { signature: sent.signature } });
      const sol = await readMainnetBalance({ data: { owner: room } });
      const moved = (built.lamports / LAMPORTS_PER_SOL).toFixed(6);
      set((s) => ({
        chainBusy: false,
        ...(typeof sol === "number" ? { roomMainnetSol: sol } : {}),
        notice: confirmed.ok
          ? `Вивід ${moved} SOL з гаманця агента · ${sent.signature}`
          : `Підпис пішов, мережа ще не підтвердила · ${sent.signature}`,
        log: pushLog(s.log, {
          id: sent.signature,
          at: Date.now(),
          kind: "system",
          text: `Вивід mainnet ${moved} SOL → ${to.trim()} · ${sent.signature}`,
        }),
      }));
      get().persist();
    } catch (e) {
      set({ chainBusy: false, notice: errText(e) });
    }
  },

  async claimArbDeposit(asset, rawSig) {
    const room = get().wallet?.pubkey;
    const sig = String(rawSig || "").trim();
    const nft = get().nfts.find((n) => n.asset === asset && n.classId === 2 && n.owner === room);
    if (!nft || !room) {
      set({ notice: "Немає NFT арбітражу на цьому ключі." });
      return false;
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(sig)) {
      set({ notice: "Це не схоже на підпис транзакції Solana." });
      return false;
    }
    set({ notice: "Сервер читає переказ на mainnet…" });
    const claim = await claimCredit({ sig, asset, wallet: room });
    set((s) => ({
      ...(claim.creditSol != null ? { arbCredit: { ...s.arbCredit, [asset]: claim.creditSol } } : {}),
      notice: claim.ok ? `Кредит зараховано. Зараз ${claim.creditSol.toFixed(4)} SOL.` : `Кредит не зараховано: ${claim.reason}`,
    }));
    return claim.ok;
  },

  async fundArbDesk(asset, sol) {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return;
    }
    const room = get().wallet?.pubkey;
    const nft = get().nfts.find((n) => n.asset === asset && n.classId === 2 && n.owner === room);
    if (!nft || !room) {
      set({ notice: "Немає NFT арбітражу на цьому ключі." });
      return;
    }
    const amount = Math.round(Number(sol) * 1e9) / 1e9;
    if (!Number.isFinite(amount) || amount < 0.005 || amount > MAX_TRADE_SOL) {
      set({ notice: `На касу арбу від 0.005 до ${MAX_TRADE_SOL} SOL.` });
      return;
    }
    const kp = await loadKeypair();
    if (!kp || kp.publicKey.toBase58() !== room) {
      set({ notice: "Ключ агента не підписав. Нічого не відправлено." });
      return;
    }
    set({ chainBusy: true, notice: "Шлю SOL на касу арбу…" });
    try {
      const built = await prepareMainnetSend({
        data: { from: room, to: ARB_TREASURY, sol: amount, memo: asset },
      });
      if (!built.ok) {
        set({ chainBusy: false, notice: built.error });
        return;
      }
      const raw = Uint8Array.from(atob(built.tx), (c) => c.charCodeAt(0));
      const tx = Transaction.from(raw);
      tx.sign(kp);
      let bin = "";
      tx.serialize().forEach((b) => {
        bin += String.fromCharCode(b);
      });
      const sent = await sendMainnetTx({ data: { tx: btoa(bin) } });
      if (!sent.ok) {
        set({ chainBusy: false, notice: sent.error });
        return;
      }
      addPendingCredit({ sig: sent.signature, asset, wallet: room });
      const confirmed = await confirmMainnetTx({ data: { signature: sent.signature } });
      const main = await readMainnetBalance({ data: { owner: room } });
      // The server reads the deposit on mainnet and keeps the credit; the browser only shows it.
      const claim = confirmed.ok ? await claimCredit({ sig: sent.signature, asset, wallet: room }) : null;
      set((s) => ({
        chainBusy: false,
        ...(claim && claim.creditSol != null ? { arbCredit: { ...s.arbCredit, [asset]: claim.creditSol } } : {}),
        ...(typeof main === "number" ? { roomMainnetSol: main } : {}),
        notice: claim?.ok
          ? `На касу арбу ${amount} SOL. Кредит ${claim.creditSol.toFixed(4)}.`
          : claim
            ? `Переказ ${sent.signature.slice(0, 8)}… пішов. Кредит не зараховано: ${claim.reason}`
            : `Підпис пішов, кредит зарахую після підтвердження · ${sent.signature}`,
        log: pushLog(s.log, {
          id: sent.signature,
          at: Date.now(),
          kind: "system",
          text: `Каса арбу ${amount} SOL → ${ARB_TREASURY} · ${asset} · ${sent.signature}`,
        }),
      }));
      get().persist();
    } catch (e) {
      set({ chainBusy: false, notice: errText(e) });
    }
  },

  async withdrawPusd(to, amount) {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return;
    }
    set({ chainBusy: true, notice: "Виводжу pUSD з гаманця Polymarket…" });
    try {
      const sent = await sendPusd(to.trim(), amount);
      if (!sent.ok) {
        set({ chainBusy: false, notice: sent.error });
        return;
      }
      const address = get().polyAddress;
      const bals = address ? await readPolyBalances({ data: { address } }) : null;
      set((s) => ({
        chainBusy: false,
        ...(bals ? { polyPusd: bals.pusd, polyPol: bals.pol, polyKnown: true } : {}),
        notice: `Вивід pUSD · ${sent.hash}`,
        log: pushLog(s.log, {
          id: sent.hash,
          at: Date.now(),
          kind: "system",
          text: `Вивід ${amount} pUSD → ${to.trim()} · ${sent.hash}`,
        }),
      }));
      get().persist();
    } catch (e) {
      set({ chainBusy: false, notice: errText(e) });
    }
  },

  async buySlice(mint, sol) {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return;
    }
    const room = get().wallet?.pubkey;
    const kp = await loadKeypair();
    if (!kp || !room || kp.publicKey.toBase58() !== room) {
      set({ notice: "Ключ агента не підписав. Покупки немає." });
      return;
    }
    set({ chainBusy: true, notice: "Купую акцію ключем агента…" });
    try {
      const built = await buildStockSwap({ data: { sol, user: room, mint } });
      if (!built.ok) {
        set({ chainBusy: false, notice: built.error });
        return;
      }
      const raw = Uint8Array.from(atob(built.tx), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(raw);
      tx.sign([kp]);
      let bin = "";
      tx.serialize().forEach((b) => {
        bin += String.fromCharCode(b);
      });
      const sent = await sendMainnetTx({ data: { tx: btoa(bin) } });
      if (!sent.ok) {
        set({ chainBusy: false, notice: sent.error });
        return;
      }
      const solBal = await readMainnetBalance({ data: { owner: room } });
      set((s) => ({
        chainBusy: false,
        ...(typeof solBal === "number" ? { roomMainnetSol: solBal } : {}),
        notice: `${built.name} куплено ключем агента · ${sent.signature}`,
        log: pushLog(s.log, {
          id: sent.signature,
          at: Date.now(),
          kind: "dex",
          text: `Slice ${built.name} · ${sol} SOL · ${sent.signature}`,
        }),
      }));
      get().persist();
    } catch (e) {
      set({ chainBusy: false, notice: errText(e) });
    }
  },

  async withdraw(to, amount) {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return;
    }
    const wallet = await get().ensureWallet();
    const kp = await loadKeypair();
    if (!kp) {
      set({ notice: "Немає ключа" });
      return;
    }
    let dest: PublicKey;
    try {
      dest = new PublicKey(to.trim());
    } catch {
      set({ notice: "Адреса отримувача не схожа на ключ Solana." });
      return;
    }
    if (dest.equals(kp.publicKey)) {
      set({ notice: "Це адреса цього ж гаманця. Вивід скасовано." });
      return;
    }
    const solNow = await readSol(kp.publicKey);
    if (solNow == null) {
      set({ solKnown: false, solMiss: true, notice: "немає цифри" });
      return;
    }
    set({ sol: solNow, solKnown: true, solMiss: false });
    const take = Number(amount);
    if (!(take > 0) || !Number.isFinite(take)) {
      set({ notice: "Сума виводу має бути більша за нуль." });
      return;
    }
    const reserve = 0.002;
    if (solNow < take + reserve) {
      set({
        notice: `Мало SOL для виводу. Є ${solNow.toFixed(4)}, треба ${take} плюс ${reserve} на комісію.`,
      });
      return;
    }
    set({ chainBusy: true, notice: `Виводжу ${take} SOL на ${shortAddr(dest.toBase58())}…` });
    try {
      const sig = await (await loadChain()).payAccount(kp, dest, take, "Solarchik withdraw");
      const sol = await readSol(kp.publicKey);
      set((s) => ({
        chainBusy: false,
        ...(sol == null ? { solKnown: false, solMiss: true } : { sol, solKnown: true, solMiss: false }),
        notice:
          sol == null
            ? "немає цифри"
            : `Вивід підтверджено ${sig.slice(0, 8)}…. Залишок ${sol.toFixed(4)} SOL.`,
        log: pushLog(s.log, {
          id: sig,
          at: Date.now(),
          kind: "system",
          text: `Вивід ${take} SOL → ${dest.toBase58()} · ${sig}`,
        }),
      }));
      get().persist();
    } catch (e) {
      let sol = solNow;
      try {
        const again = await readSol(kp.publicKey);
        if (again != null) sol = again;
      } catch {
        /* keep */
      }
      set({
        chainBusy: false,
        sol,
        solKnown: true,
        solMiss: false,
        notice: errText(e),
      });
    }
  },

  async reissueAgent(asset, paySig = "") {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return false;
    }
    const room = get().wallet?.pubkey;
    const old = get().nfts.find((n) => n.asset === asset && n.owner === room);
    const kp = await loadKeypair().catch(() => null);
    if (!old || !room || !kp || kp.publicKey.toBase58() !== room) {
      set({ notice: "Немає цього NFT або ключа кімнати." });
      return false;
    }
    set({ chainBusy: true, notice: "Сервер готує перенос у свою колекцію…" });
    let prep: Awaited<ReturnType<typeof callPrepareReissue>>;
    try {
      const sig = paySig.trim();
      const proof = await signProof(kp, "reissue", `${asset}:${sig}`);
      prep = await callPrepareReissue({ proof, oldAsset: asset, paySig: sig });
    } catch {
      prep = { ok: false, reason: "Сервер не відповів." };
    }
    if (!prep.ok) {
      set({ chainBusy: false, notice: `${prep.reason} Нічого не змінено.` });
      return false;
    }
    try {
      const chain = await loadChain();
      const signature = await chain.sendServerMint(kp, prep.txs);
      let burned = true;
      try {
        await chain.burnCore(kp, asset);
      } catch {
        burned = false;
      }
      const next: AgentNft = { ...old, asset: prep.asset, coreCollection: prep.collection, tier: prep.tier, updatedAt: Date.now() };
      set((s) => {
        const agents = { ...s.agents };
        for (const kind of KINDS) {
          if (agents[kind].sourceAsset === asset) agents[kind] = { ...agents[kind], sourceAsset: prep.asset };
        }
        const credit = s.arbCredit[asset];
        return {
          chainBusy: false,
          agents,
          nfts: [...s.nfts.filter((n) => n.asset !== asset && n.asset !== prep.asset), next],
          ...(credit != null ? { arbCredit: { ...s.arbCredit, [prep.asset]: credit } } : {}),
          notice: burned
            ? `${next.name} у колекції сервера. Старий NFT спалено.`
            : `${next.name} у колекції сервера. Старий NFT не спалився — він більше не працює на арбі.`,
          log: pushLog(s.log, { id: signature, at: Date.now(), kind: "system", text: `Перенос ${asset} → ${prep.asset} (${prep.tier})` }),
        };
      });
      get().persist();
      return true;
    } catch (e) {
      set({ chainBusy: false, notice: `Перенос не пройшов. ${errText(e)}` });
      return false;
    }
  },

  async buyLiveSku(id) {
    if (get().chainBusy) {
      set({ notice: "Ще йде транзакція. Зачекайте." });
      return false;
    }
    const wallet = await get().ensureWallet();
    const sku = liveCatalog().find((s) => s.id === id);
    if (!sku) return false;
    const tier = sku.nft.tier === "free" ? "free" : "pro";
    if (tier === "free" && get().nfts.some((n) => n.owner === wallet.pubkey && n.tier === "free")) {
      set({ notice: "Безкоштовний агент уже є. Pro без комісії з прибутку." });
      return false;
    }
    const kp = await loadKeypair();
    if (!kp) {
      set({ notice: "Немає ключа" });
      return false;
    }
    const solNow = await readSol(kp.publicKey);
    if (solNow == null) {
      set({ solKnown: false, solMiss: true, notice: "немає цифри" });
      return false;
    }
    set({ sol: solNow, solKnown: true, solMiss: false });
    // The server decides the mint path before any money moves.
    let status: Awaited<ReturnType<typeof callMintStatus>> | null = null;
    try {
      status = await callMintStatus();
    } catch {
      status = null;
    }
    const gate = status?.[tier];
    if (!gate || (gate.mode !== "cosign" && gate.mode !== "client")) {
      set({ notice: gate?.reason || "Сервер мінту не відповів. Нічого не списано." });
      return false;
    }
    const feeReserve = 0.02;
    if (solNow < feeReserve) {
      set({ notice: "Поповни Devnet краном. Для мінту треба 0.02 SOL." });
      get().persist();
      return false;
    }
    let paySig = "";
    if (sku.priceSol > 0) {
      const pending = readPendingPro(wallet.pubkey, sku.id);
      if (pending) {
        paySig = pending;
      } else {
        set({ chainBusy: true, notice: "Оплата з твого гаманця на казну…" });
        const paid = await paySkuFromPlayer(sku.priceSol, get().externalWallet, currentPhantomSigner(), proMemo(wallet.pubkey));
        if (!paid.ok) {
          set({ chainBusy: false, notice: paid.reason });
          return false;
        }
        paySig = paid.sig;
        writePendingPro(wallet.pubkey, sku.id, paySig);
      }
    }
    set({ chainBusy: true, notice: "Сервер перевіряє право на мінт…" });
    let prep: Awaited<ReturnType<typeof callPrepareMint>>;
    try {
      const proof = await signProof(kp, "mint", `${sku.id}:${paySig}`);
      prep = await callPrepareMint({ proof, skuId: sku.id, paySig });
    } catch {
      prep = { ok: false, reason: "Сервер мінту не відповів." };
    }
    if (!prep.ok) {
      if (paySig && /використано/.test(prep.reason)) clearPendingPro();
      set({
        chainBusy: false,
        notice: paySig ? `Оплату ${paySig.slice(0, 8)}… збережено, повтори мінт. ${prep.reason}` : `${prep.reason} Мінт не почато.`,
      });
      return false;
    }
    set({ chainBusy: true, notice: sku.priceSol > 0 ? "Мінчу агента в Core…" : "Мінчу агента. Списується лише комісія мережі…" });
    try {
      const now = Date.now();
      const draft: AgentNft = {
        ...sku.nft,
        tier: prep.tier,
        asset: "",
        owner: wallet.pubkey,
        mintedAt: now,
        updatedAt: now,
        track: "live",
        trainedDays: sku.nft.trainedDays,
        graduated: false,
        metrics: { ...sku.nft.metrics, workedSec: 0, aprPct: null },
      };
      const chain = await loadChain();
      const minted =
        prep.mode === "cosign"
          ? { asset: prep.asset, coreCollection: prep.collection, signature: await chain.sendServerMint(kp, prep.txs) }
          : await chain.mintCore(kp, draft);
      clearPendingPro();
      const nft: AgentNft = { ...draft, asset: minted.asset, coreCollection: minted.coreCollection };
      const sol = await readSol(kp.publicKey);
      set((s) => ({
        chainBusy: false,
        ...(sol == null ? { solKnown: false, solMiss: true } : { sol, solKnown: true, solMiss: false }),
        nfts: [...s.nfts.filter((n) => n.asset !== nft.asset), nft],
        track: "live",
        notice: `${nft.name} у гаманці. ${nft.asset.slice(0, 4)}…${nft.asset.slice(-4)}`,
        log: pushLog(s.log, {
          id: minted.signature,
          at: now,
          kind: "system",
          text: paySig
            ? `Core ${nft.name} ${nft.asset}. Оплата ${paySig.slice(0, 8)}…`
            : `Core ${nft.name} ${nft.asset}. Лише комісія мережі.`,
        }),
      }));
      get().persist();
      return true;
    } catch (e) {
      set({
        chainBusy: false,
        notice: paySig ? `Оплату ${paySig.slice(0, 8)}… прийнято. Мінт не пройшов. ${errText(e)}` : errText(e),
      });
      return false;
    }
  },

  armArb() {
    const wallet = get().wallet;
    if (!wallet || get().agents.dex.status === "working") return;
    const track = get().track;
    let owned = get().nfts.filter((n) => n.owner === wallet.pubkey && n.classId === 2 && n.track === track);
    if (!owned.length) {
      const now = Date.now();
      const local: AgentNft = {
        asset: "local-dex-arb",
        collection: "SolarchikAgents",
        classId: 2,
        name: "Titan × Backpack",
        owner: wallet.pubkey,
        mintedAt: now,
        updatedAt: now,
        track,
        trainedDays: 0,
        graduated: false,
        strategy: defaultStrategy(),
        metrics: { xp: 0, jobs: 0, wins: 0, losses: 0, pnlSol: 0, lastJobAt: null, workedSec: 0, aprPct: null },
      };
      set((s) => ({ nfts: s.nfts.some((n) => n.asset === local.asset) ? s.nfts : [...s.nfts, local] }));
      owned = [get().nfts.find((n) => n.asset === local.asset) ?? local];
    }
    const asset = owned[0];
    if (!asset) return;
    const agents = { ...get().agents };
    agents.dex = {
      kind: "dex",
      status: "working",
      sourceAsset: asset.asset,
      sourceClass: 2,
      config: asset.strategy.dex,
      lastLine: "Читаю стратегію з токена…",
      brain: "Titan × Backpack",
      clockMin: 120,
      anchorPx: null,
      anchorLabel: null,
      epochStartedAt: Date.now(),
    };
    set({
      working: true,
      agents,
      notice: "Арбітраж працює сам. Стріляє лише коли є край і каса.",
    });
  },

  async pressWork() {
    if (readCaps().paused) {
      set({ notice: "Агент на паузі. Угоду не відправляю." });
      return;
    }
    const wallet = await get().ensureWallet();
    const track = get().track;
    let localOwned = get().nfts.filter((x) => x.owner === wallet.pubkey && x.track === track);
    if (!localOwned.some((n) => n.classId === 2)) {
      const now = Date.now();
      const local: AgentNft = {
        asset: "local-dex-arb",
        collection: "SolarchikAgents",
        classId: 2,
        name: "Titan × Backpack",
        owner: wallet.pubkey,
        mintedAt: now,
        updatedAt: now,
        track,
        trainedDays: 0,
        graduated: false,
        strategy: defaultStrategy(),
        metrics: { xp: 0, jobs: 0, wins: 0, losses: 0, pnlSol: 0, lastJobAt: null, workedSec: 0, aprPct: null },
      };
      set((s) => ({ nfts: s.nfts.some((n) => n.asset === local.asset) ? s.nfts : [...s.nfts, local] }));
      localOwned = [...localOwned, local];
    }
    if (!get().autoRun) {
      const dexOwned = localOwned.some((n) => n.classId === 2);
      const funded = get().solKnown && get().sol >= MIN_WORK_SOL;
      if (!funded && !dexOwned) {
        set({ working: false, haltReason: "Поповни гаманець. Боти стоять.", notice: "Поповни гаманець. Боти стоять." });
        return;
      }
      if (get().lossStreak >= MAX_LOSSES && !dexOwned) {
        set({ working: false, haltReason: "Два мінуси підряд. Боти стоять.", notice: "Два мінуси підряд. Боти стоять." });
        return;
      }
      set({ haltReason: null });
    }
    const keepHold = get().autoRun;
    const refreshed: AgentNft[] = [];
    for (const n of localOwned) {
      try {
        const live = await (await loadChain()).fetchAgent(n.asset);
        if (live && live.owner === wallet.pubkey) {
          refreshed.push({
            ...n,
            ...live,
            name: n.name,
            mintedAt: n.mintedAt,
            brief: n.brief,
            openBook: n.openBook ?? null,
          });
        }
      } catch {
        /* chain miss does not erase the agent already in the room */
      }
    }
    const owned = localOwned.map((n) => refreshed.find((o) => o.asset === n.asset) ?? n);
    if (owned.length) {
      set((s) => ({
        nfts: s.nfts.map((n) => owned.find((o) => o.asset === n.asset) ?? n),
      }));
    }
    const gate = verifyWork(owned, wallet.pubkey, track);
    if (keepHold && !get().autoRun) return;
    if (!gate.ok) {
      const agents = idleRuntimes();
      for (const k of KINDS) agents[k] = { ...agents[k], status: "blocked" };
      set({
        working: false,
        agents,
        notice: localOwned.some((n) => n.classId !== 2) ? "Агент уже в кімнаті." : gate.reason,
        log: pushLog(get().log, {
          id: `gate-${Date.now()}`,
          at: Date.now(),
          kind: "system",
          text: localOwned.some((n) => n.classId !== 2) ? "Агент уже в кімнаті." : gate.reason,
        }),
      });
      get().persist();
      return;
    }
    const agents = idleRuntimes();
    const funded = get().solKnown && get().sol >= MIN_WORK_SOL;
    for (const kind of KINDS) {
      if (kind === "prediction" && (!funded || get().lossStreak >= MAX_LOSSES)) {
        agents[kind] = { ...agents[kind], status: "blocked" };
        continue;
      }
      const asset = pickBestAsset(get().nfts, wallet.pubkey, kind, track);
      if (!asset) {
        agents[kind] = { ...agents[kind], status: "blocked" };
        continue;
      }
      agents[kind] = {
        kind,
        status: "working",
        sourceAsset: asset.asset,
        sourceClass: asset.classId,
        config: asset.strategy[kind],
        lastLine: "Читаю стратегію з токена…",
        brain: kind === "prediction" ? "RIG" : "Titan × Backpack",
        clockMin: 0,
        anchorPx: null,
        anchorLabel: null,
        epochStartedAt: Date.now(),
      };
    }
    set((s) => ({
      working: true,
      agents,
      brain: STACK,
      notice: `Праця: ${gate.agents.join(", ")} · ончейн`,
      log: pushLog(s.log, {
        id: `work-${Date.now()}`,
        at: Date.now(),
        kind: "system",
        text: `Праця. ${gate.assets.map((a) => a.asset.slice(0, 4) + "…" + a.asset.slice(-4)).join(", ")}`,
      }),
    }));
    get().persist();
  },

  stopWork() {
    brainFlight = false;
    brainAsked.clear();
    sidePrefer = "events";
    workMarkedAt = null;
    workCarryMs = 0;
    const dropped = heldTrades.splice(0);
    for (const row of dropped) {
      if (row.job.kind === "prediction" && row.job.phase === "lock") revertLock(row.job.fillId, row.job.asset);
    }
    set({ pendingTrade: null, autoRun: false, polyCancel: null, polyRedeem: null, polyTicket: get().polyBusy ? get().polyTicket : null });
    const agents = { ...get().agents };
    for (const kind of KINDS) {
      if (agents[kind].status === "working") {
        agents[kind] = { ...agents[kind], status: "stopped", lastLine: "Зупинено. Пишу атрибути в Core…" };
      }
    }
    set({ working: false, agents, notice: "Зміну зупинено. Стратегія йде в NFT." });
    const wallet = get().wallet;
    if (wallet) {
      for (const kind of KINDS) {
        const asset = agents[kind].sourceAsset;
        const nft = get().nfts.find((n) => n.asset === asset && n.owner === wallet.pubkey);
        if (nft) {
          queueWrite(
            nft,
            (sig) => set({ notice: `Core оновлено ${sig.slice(0, 8)}…` }),
            (msg) => set({ notice: msg }),
          );
        }
      }
    }
    get().persist();
  },

  tick(now) {
    rollBetWindow(now);
    if (readCaps().paused) {
      if (get().working) get().stopWork();
      return;
    }
    const { working, wallet, agents, nfts, track, quote, chainBusy, sol, solKnown } = get();
    if (!working || !wallet || chainBusy) return;
    const free = solKnown ? sol : 0;
    let nextNfts = nfts;
    const logs: LogEntry[] = [];
    const nextAgents = { ...agents };
    const dirty: AgentNft[] = [];
    const jobs: ChainJob[] = [];
    const born: AgentFill[] = [];
    const patches: FillPatch[] = [];
    let cryptoKicked = false;
    for (const kind of KINDS) {
      const rt = agents[kind];
      if (rt.status !== "working" || !rt.sourceAsset) continue;
      const nft = nextNfts.find((n) => n.asset === rt.sourceAsset && n.owner === wallet.pubkey);
      if (!nft) {
        nextAgents[kind] = { ...rt, status: "blocked", lastLine: "NFT зник з гаманця" };
        continue;
      }
      const step = advanceAgent({
        nft,
        kind,
        track,
        now,
        clockMin: rt.clockMin,
        anchorPx: rt.anchorPx,
        anchorLabel: rt.anchorLabel,
        quote,
        free,
        liveDex: false,
        creditSol: get().arbCredit[nft.asset] ?? readArbCredit(nft.asset),
        house: get().arbHouse,
        liveMaxSol: LIVE_MAX_SOL,
        decider:
          kind !== "prediction" ? "rule" : brainFlight ? "wait" : get().betCalls >= BET_CAP ? "capped" : "grok",
      });
      if (kind === "dex" && step.arbFire && !arbFlight) {
        arbFlight = true;
        const dir = step.arbFire.dir;
        const symbol = step.arbFire.symbol;
        const asset = nft.asset;
        void signedArbFire(dir, symbol, asset)
          .then((res) => {
            if (res.ok && res.simulated) {
              // Simulation: no money moved, so arb credit is not spent.
              const text = `${SIM_LABEL} · ${dir} ${res.qty} ${res.base} · ${res.bp}`;
              useAgents.setState((s) => ({
                notice: text,
                log: pushLog(s.log, { id: res.titan, at: Date.now(), kind: "dex", text }),
              }));
              return;
            }
            if (res.ok) {
              const left = typeof res.creditSol === "number" ? res.creditSol : null;
              if (left != null) writeArbCreditCache(asset, left);
              useAgents.setState((s) => ({
                ...(left == null ? {} : { arbCredit: { ...s.arbCredit, [asset]: left } }),
                notice: `MAINNET · ${dir} ${res.qty} ${res.base} · Backpack ${res.bp} · Titan ${res.titan}`,
                log: pushLog(s.log, {
                  id: res.titan,
                  at: Date.now(),
                  kind: "dex",
                  text: `MAINNET · ${dir} ${res.qty} ${res.base} · Backpack ${res.bp} · Titan ${res.titan}`,
                }),
              }));
              return;
            }
            useAgents.setState((s) => ({
              notice: res.reason,
              log: pushLog(s.log, {
                id: `arb-${Date.now()}`,
                at: Date.now(),
                kind: "dex",
                text: res.broken ? "Зламано, чекає зведення." : res.reason,
              }),
            }));
          })
          .catch(() => {
            useAgents.setState({ notice: "Ончейн не відповів." });
          })
          .finally(() => {
            arbFlight = false;
          });
      }
      const evolved = step.nft;
      if (step.counted || step.log) {
        nextNfts = nextNfts.map((n) => (n.asset === nft.asset ? evolved : n));
        if (step.counted) dirty.push(evolved);
      }
      if (step.log) logs.push(step.log);
      if (step.fill) born.push(step.fill);
      if (step.fillPatch) patches.push(step.fillPatch);
      if (step.chain) jobs.push(step.chain);
      const cryptoHere = laneEnabledOn(nft.strategy.prediction, "crypto", nft.classId);
      if (step.ask && kind === "prediction" && cryptoHere) {
        const ask = step.ask;
        const key = `${nft.asset}:${ask.anchorLabel}`;
        const liveNow = get();
        if (liveNow.autoRun && !autoPolyFlight && !liveNow.grokFlight && !liveNow.polyBusy) {
          const low = liveNow.polyPusd == null || liveNow.polyPusd + 1e-9 < 1;
          if (low) {
            if (liveNow.haltReason !== "Поповни pUSD. Агент стоїть.") {
              useAgents.setState({ notice: "Поповни pUSD. Агент стоїть.", haltReason: "Поповни pUSD. Агент стоїть." });
            }
          } else {
            cryptoKicked = true;
            void fireAutoPoly();
          }
        }
        if (!get().autoRun && !brainAsked.has(key) && !brainFlight && !get().grokFlight && !get().polyBusy && get().betCalls < BET_CAP) {
          brainAsked.add(key);
          brainFlight = true;
          const asset = nft.asset;
          const freeNow = free;
          set({ notice: "Grok розбирає ринок…" });
          void decideBet({
            data: {
              focus: ask.focus,
              name: ask.name,
              risk: ask.risk,
              goal: ask.goal,
              edgeBps: ask.edgeBps,
              maxStakeSol: ask.maxStakeSol,
              anchorYes: ask.anchorYes,
              moveBps: ask.moveBps,
              markets: ask.markets,
            },
          })
            .then((res) => {
              brainFlight = false;
              const live = get();
              const current = live.nfts.find((n) => n.asset === asset && n.owner === live.wallet?.pubkey);
              if (!current || !live.quote) return;
              const decision = res.ok
                ? res
                : {
                    action: "skip" as const,
                    marketId: ask.markets[0]?.id ?? "",
                    confidence: 0,
                    why: res.error,
                  };
              const landed = commitBrain({
                nft: current,
                now: Date.now(),
                quote: live.quote,
                marketId: decision.marketId,
                action: decision.action,
                confidence: decision.confidence,
                why: decision.why,
                free: freeNow,
              });
              set((s) => {
                let fills = s.fills;
                if (landed.fill && !failedLocks.has(landed.fill.id)) fills = [...fills, landed.fill].slice(-160);
                return {
                  nfts: s.nfts.map((n) => (n.asset === asset ? landed.nft : n)),
                  fills,
                  betCalls: res.ok ? s.betCalls + 1 : res.error.includes("недоступний") ? BET_CAP : s.betCalls,
                  notice: landed.line,
                  agents: {
                    ...s.agents,
                    prediction: {
                      ...s.agents.prediction,
                      lastLine: landed.line,
                      clockMin: landed.clockMin,
                      anchorPx: landed.anchorPx,
                      anchorLabel: landed.anchorLabel,
                      brain: "Grok",
                    },
                  },
                  log: landed.log ? pushLog(s.log, landed.log) : s.log,
                };
              });
              if (landed.chain) enqueueChain(landed.chain);
              if (landed.counted) {
                queueWrite(
                  landed.nft,
                  () => undefined,
                  (msg) => set({ notice: msg }),
                );
              }
              get().persist();
            })
            .catch(() => {
              brainFlight = false;
              set({ notice: "Grok не відповів. Ставку не відкриваю." });
            });
        }
      }
      nextAgents[kind] = {
        ...rt,
        config: evolved.strategy[kind],
        lastLine: step.line,
        clockMin: step.clockMin,
        anchorPx: step.anchorPx,
        anchorLabel: step.anchorLabel,
        brain: step.brain ?? rt.brain,
        status: "working",
        epochStartedAt: step.clockMin === 0 ? now : (rt.epochStartedAt ?? now),
      };
    }
    const owner = wallet?.pubkey;
    const drive = owner ? get().nfts.find((n) => n.asset === agents.prediction.sourceAsset && n.owner === owner) : null;
    const driveCrypto = drive ? laneEnabledOn(drive.strategy.prediction, "crypto", drive.classId) : false;
    if (
      get().autoRun &&
      !cryptoKicked &&
      !driveCrypto &&
      anyLane(get(), "crypto") &&
      !autoPolyFlight &&
      !get().grokFlight &&
      !get().polyBusy
    ) {
      const pusd = get().polyPusd;
      if (pusd != null && pusd + 1e-9 < 1) {
        if (get().haltReason !== "Поповни pUSD. Агент стоїть.") {
          useAgents.setState({ notice: "Поповни pUSD. Агент стоїть.", haltReason: "Поповни pUSD. Агент стоїть." });
        }
      } else if (pusd != null) {
        cryptoKicked = true;
        void fireAutoPoly();
      }
    }
    if (get().autoRun && !cryptoKicked && !autoPolyFlight && !get().grokFlight && !get().polyBusy) {
      queueSide(sidePrefer);
    }
    maybeStepWeex(nextNfts, nextAgents);
    const stamped = stampWork(now, nextNfts, nextAgents, wallet.pubkey, [...get().fills, ...born]);
    nextNfts = stamped.nfts;
    set((s) => {
      let fills = s.fills;
      for (const patch of patches) {
        fills = fills.map((f) => (f.id === patch.id ? { ...f, pnl: patch.pnl, status: patch.status } : f));
      }
      for (const fill of born) {
        if (failedLocks.has(fill.id)) continue;
        fills = [...fills, fill];
      }
      const kept = nextNfts.map((n) => {
        if (n.openBook && failedLocks.has(n.openBook.fillId)) {
          return s.nfts.find((x) => x.asset === n.asset) ?? { ...n, openBook: null };
        }
        return n;
      });
      return {
        nfts: kept,
        fills: fills.slice(-160),
        agents: nextAgents,
        log: logs.reduce((acc, e) => pushLog(acc, e), s.log),
      };
    });
    noteSettledFees(patches, track);
    tickCount += 1;
    const chainDue = stamped.checkpoint;
    if (dirty.length || chainDue) {
      const seen = new Set<string>();
      const batch = chainDue ? [...dirty, chainDue] : dirty;
      for (const nft of batch) {
        if (seen.has(nft.asset)) continue;
        seen.add(nft.asset);
        const fresh = nextNfts.find((n) => n.asset === nft.asset) ?? nft;
        if (fresh.openBook && failedLocks.has(fresh.openBook.fillId)) continue;
        queueWrite(
          fresh,
          () => undefined,
          (msg) => set({ notice: msg }),
        );
      }
    }
    if (jobs.length) {
      for (const job of jobs) {
        if (job.kind === "prediction" && job.phase === "lock" && failedLocks.has(job.fillId)) continue;
        enqueueChain(job);
      }
    }
    if (tickCount % 4 === 0) get().persist();
  },

  async pollQuote() {
    rollBetWindow();
    try {
      const keywords = new Set<string>();
      let sizeSol = 0.1;
      let side: "buy" | "sell" | "both" = "both";
      for (const n of get().nfts) {
        const p = n.strategy?.prediction;
        if (p?.venue === "polymarket" && p.market) keywords.add(p.market);
        const dex = n.strategy?.dex;
        if (dex && n.classId === 2 && typeof dex.dcaAmountSol === "number") sizeSol = dex.dcaAmountSol;
        if (dex && n.classId === 2 && (dex.side === "buy" || dex.side === "sell" || dex.side === "both")) side = dex.side;
      }
      const [quote, house] = await Promise.all([
        liveQuotes({ data: { keywords: [...keywords].slice(0, 4), titanKey: readTitanKey(), sizeSol, side } }),
        callArbHouse().catch(() => null),
      ]);
      if (quote && typeof quote === "object" && "solUsd" in quote && "btcUsd" in quote) {
        set({ quote, ...(house ? { arbHouse: house } : {}) });
      } else if (house) {
        set({ arbHouse: house });
      }
    } catch {
      /* keep the last quote */
    }
    await get().refreshTwap();
  },

  async refreshFigures() {
    await pullFigures();
  },

  async refreshTwap() {
    try {
      const snap = await readChainlinkTwap({ data: { waitMs: get().twap ? 0 : 2000 } });
      if (snap && typeof snap === "object" && "w30" in snap) set({ twap: snap });
    } catch {
      if (!get().twap) {
        set({
          twap: {
            w30: { symbol: "btc/usd", windowS: 30, known: false, price: null, ageSec: null, stale: false },
            w60: { symbol: "btc/usd", windowS: 60, known: false, price: null, ageSec: null, stale: false },
          },
        });
      }
    }
  },

  saveStrategy(asset, strategy) {
    const wallet = get().wallet;
    if (!wallet) return;
    const nft = get().nfts.find((n) => n.asset === asset && n.owner === wallet.pubkey);
    if (!nft) return;
    const nextStrategy = clampStrategy(strategy);
    const next: AgentNft = { ...nft, strategy: nextStrategy, updatedAt: Date.now() };
    const agents = { ...get().agents };
    for (const kind of KINDS) {
      if (agents[kind].sourceAsset === asset) {
        agents[kind] = {
          ...agents[kind],
          config: nextStrategy[kind],
          clockMin: 0,
          anchorPx: null,
          anchorLabel: null,
          epochStartedAt: Date.now(),
          lastLine: "Стратегію оновлено. Вікно пішло спочатку.",
        };
      }
    }
    set((s) => ({
      nfts: s.nfts.map((n) => (n.asset === asset ? next : n)),
      agents,
      notice: "Пишу стратегію в Core…",
    }));
    queueWrite(
      next,
      (sig) => set({ notice: `Стратегію записано в токен ${sig.slice(0, 8)}…` }),
      (msg) => set({ notice: msg }),
    );
    get().persist();
  },

  setFocus(asset) {
    set({ focusAsset: asset });
  },

  runAsset(asset) {
    const wallet = get().wallet;
    if (!wallet) {
      void get()
        .ensureWallet()
        .then((w) => {
          if (w) get().runAsset(asset);
        })
        .catch(() => set({ notice: "Гаманець кімнати не відкрився. Онови сторінку." }));
      return;
    }
    const nft = get().nfts.find((n) => n.asset === asset && n.owner === wallet.pubkey);
    if (!nft) return;
    const agents = { ...get().agents };
    const now = Date.now();
    for (const kind of kindsForClass(nft.classId)) {
      agents[kind] = {
        kind,
        status: "working",
        sourceAsset: nft.asset,
        sourceClass: nft.classId,
        config: nft.strategy[kind],
        lastLine: "Цей токен веде зміну.",
        brain: kind === "prediction" ? "RIG" : "Agent Kit",
        clockMin: 0,
        anchorPx: null,
        anchorLabel: null,
        epochStartedAt: now,
      };
    }
    set({
      working: true,
      agents,
      focusAsset: asset,
      track: "live",
      brain: STACK,
      notice: `${nft.name} працює. Вікно пішло спочатку.`,
    });
    get().persist();
  },

  pauseAsset(asset) {
    const agents = { ...get().agents };
    let any = false;
    for (const kind of KINDS) {
      if (agents[kind].sourceAsset === asset && agents[kind].status === "working") {
        agents[kind] = { ...agents[kind], status: "stopped", lastLine: "Пауза. Вікно заморожено." };
      }
      if (agents[kind].status === "working") any = true;
    }
    set({ agents, working: any, focusAsset: asset, notice: "Агента поставлено на паузу." });
    get().persist();
  },

  async withdrawLocked(asset) {
    const nft = get().nfts.find((n) => n.asset === asset);
    const book = nft?.openBook;
    if (!nft || !book) {
      set({ notice: "У ринках нічого не заблоковано." });
      return;
    }
    if (get().chainBusy) return;
    set({ chainBusy: true, notice: "Повертаю кошти з ринку…" });
    try {
      const user = await loadKeypair();
      if (!user) throw new Error("Немає ключа");
      const market = await loadMarketKeypair();
      const sig = await (await loadChain()).commitPrediction({
        user,
        market,
        track: "live",
        stake: book.stake,
        pnl: 0,
        win: true,
        memo: "RIG withdraw",
        phase: "settle",
      });
      if (!sig) throw new Error("Ринок не повернув ставку.");
      await refreshBalances(user);
      set((s) => ({
        chainBusy: false,
        nfts: s.nfts.map((n) => (n.asset === asset ? { ...n, openBook: null } : n)),
        fills: s.fills.map((f) => (f.id === book.fillId ? { ...f, status: "withdrawn" as const, pnl: 0 } : f)),
        notice: `Кошти з ринку повернуто · ${sig.slice(0, 8)}…`,
      }));
      get().persist();
    } catch (e) {
      set({ chainBusy: false, notice: errText(e) });
    }
  },

  async coachAsset(asset, guidance) {
    const text = guidance.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!text) return { ok: false, error: "Напиши агенту, що змінити." };
    if (get().aiBusy) return { ok: false, error: "Агент ще відповідає." };
    const wallet = get().wallet;
    const nft = get().nfts.find((n) => n.asset === asset && (!wallet || n.owner === wallet.pubkey));
    if (!nft) return { ok: false, error: "Немає цього агента." };
    const brief: AgentBrief = nft.brief ?? {
      risk: "balanced",
      behavior: "Розмір угоди залежить від руху ринку, впевненості агента і вільних коштів.",
      goal: "",
    };
    set({ aiBusy: true });
    try {
      const res = await coachAgent({
        data: {
          name: nft.name,
          classId: nft.classId,
          guidance: text,
          brief,
          strategy: nft.strategy,
          locale: typeof document !== "undefined" ? document.documentElement.lang : undefined,
        },
      });
      if (!res.ok) {
        set({ aiBusy: false, notice: res.error });
        return res;
      }
      const next: AgentNft = {
        ...nft,
        strategy: res.strategy,
        brief: res.brief,
        updatedAt: Date.now(),
      };
      const agents = { ...get().agents };
      const now = Date.now();
      for (const kind of KINDS) {
        if (agents[kind].sourceAsset === asset) {
          agents[kind] = {
            ...agents[kind],
            config: res.strategy[kind],
            clockMin: 0,
            anchorPx: null,
            anchorLabel: null,
            epochStartedAt: now,
            lastLine: res.bet ? "Агент ставить за проханням з чату." : "Агент переписав стратегію з чату.",
          };
        }
      }
      set((s) => ({
        aiBusy: false,
        nfts: s.nfts.map((n) => (n.asset === asset ? next : n)),
        agents,
        notice: res.reply,
      }));
      queueWrite(
        next,
        (sig) => set({ notice: `${res.reply} · токен ${sig.slice(0, 8)}…` }),
        (msg) => set({ notice: msg }),
      );
      get().persist();
      if (res.bet) void get().reviewPoly(res.bet);
      return { ok: true, reply: res.reply };
    } catch (e) {
      const error = errText(e);
      set({ aiBusy: false, notice: error });
      return { ok: false, error };
    }
  },

  listForSale(asset) {
    const wallet = get().wallet;
    if (!wallet || get().chainBusy) return;
    const nft = get().nfts.find((n) => n.asset === asset && n.owner === wallet.pubkey);
    if (!nft) return;
    const gate = listEligible(nft);
    if (!gate.ok) {
      set({ notice: gate.reason });
      return;
    }
    if (get().working) get().stopWork();
    const price = quoteResaleSol(nft);
    set({ chainBusy: true, notice: "Переказ NFT на касу ринку…" });
    void (async () => {
      try {
        const from = await loadKeypair();
        if (!from) throw new Error("Немає ключа");
        const market = await loadMarketKeypair();
        await (await loadChain()).fundIfNeeded(market);
        await (await loadChain()).writeCore(from, nft);
        const sig = await (await loadChain()).transferCore(from, nft, market.publicKey);
        const listed: AgentNft = { ...nft, owner: market.publicKey.toBase58() };
        const listing: MarketListing = {
          id: `sell-${asset.slice(0, 8)}-${Date.now()}`,
          nft: listed,
          priceSol: price,
          listedAt: Date.now(),
        };
        set((s) => ({
          chainBusy: false,
          nfts: s.nfts.filter((n) => n.asset !== asset),
          listings: [listing, ...s.listings],
          notice: `${nft.name} на ринку за ${price.toFixed(2)} тестових SOL.`,
          log: pushLog(s.log, {
            id: sig,
            at: listing.listedAt,
            kind: "system",
            text: `Transfer ${nft.asset} → каса. ${sig.slice(0, 8)}…`,
          }),
        }));
        get().persist();
      } catch (e) {
        set({ chainBusy: false, notice: errText(e) });
      }
    })();
  },

  buyListing(id) {
    if (get().chainBusy) return;
    const listing = get().listings.find((l) => l.id === id);
    if (!listing) return;
    set({ chainBusy: true, notice: "Купівля: SOL продавцю, NFT назад у гаманець…" });
    void (async () => {
      try {
        const wallet = await get().ensureWallet();
        const buyer = await loadKeypair();
        if (!buyer) throw new Error("Немає ключа");
        const have = await readSol(buyer.publicKey);
        if (have == null) {
          set({ chainBusy: false, solKnown: false, solMiss: true, notice: "немає цифри" });
          return;
        }
        set({ sol: have, solKnown: true, solMiss: false });
        if (have < listing.priceSol + 0.01) {
          set({ chainBusy: false, notice: needSolNotice(have, listing.priceSol, wallet.pubkey) });
          return;
        }
        const market = await loadMarketKeypair();
        const paySig = await (await loadChain()).payAccount(buyer, new PublicKey(listing.nft.owner), listing.priceSol);
        const sig = await (await loadChain()).transferCore(market, listing.nft, buyer.publicKey);
        const nft: AgentNft = { ...listing.nft, owner: wallet.pubkey, updatedAt: Date.now() };
        const sol = await readSol(buyer.publicKey);
        set((s) => ({
          chainBusy: false,
          ...(sol == null ? { solKnown: false, solMiss: true } : { sol, solKnown: true, solMiss: false }),
          listings: s.listings.filter((l) => l.id !== id),
          nfts: [...s.nfts, nft],
          track: "live",
          notice: `Куплено ${nft.name}. Власник знову ${wallet.pubkey.slice(0, 4)}…`,
          log: pushLog(s.log, {
            id: sig,
            at: Date.now(),
            kind: "system",
            text: `Купівля ${nft.asset}. Оплата ${paySig.slice(0, 8)}… transfer ${sig.slice(0, 8)}…`,
          }),
        }));
        get().persist();
      } catch (e) {
        set({ chainBusy: false, notice: errText(e) });
      }
    })();
  },
}));

useAgents.subscribe((state, prev) => {
  if (!state.lastGrok || state.lastGrok === prev.lastGrok) return;
  const text = grokLogText(state.lastGrok);
  if (state.log[state.log.length - 1]?.text === text) return;
  useAgents.setState({
    log: pushLog(state.log, { id: `grok-${Date.now()}`, at: Date.now(), kind: "system", text }),
  });
  useAgents.getState().persist();
});
