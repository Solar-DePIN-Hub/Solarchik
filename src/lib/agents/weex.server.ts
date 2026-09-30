import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { GROK_MODEL } from "./grok-model";

const BASE = "https://api-contract.weex.com";
const SYMBOL = "BTCUSDT";
const LEVERAGE = "2";

type Creds = { key: string; secret: string; pass: string };

export type WeexStep =
  | { ok: true; placed: boolean; why: string; orderId?: string }
  | { ok: false; error: string };

function fileEnv(): Record<string, string> {
  try {
    const text = readFileSync("/workspace/.grok/weex.env", "utf8");
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const cut = trimmed.indexOf("=");
      if (cut < 1) continue;
      const key = trimmed.slice(0, cut).trim();
      const value = trimmed.slice(cut + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function creds(): Creds | null {
  const file = fileEnv();
  const key = process.env.WEEX_API_KEY?.trim() || file.WEEX_API_KEY;
  const secret = process.env.WEEX_API_SECRET?.trim() || file.WEEX_API_SECRET;
  const pass = process.env.WEEX_API_PASSPHRASE?.trim() || file.WEEX_API_PASSPHRASE;
  if (!key || !secret || !pass) return null;
  return { key, secret, pass };
}

function sign(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("base64");
}

function failText(json: unknown, status: number): string | null {
  if (!json || typeof json !== "object") return status >= 400 ? `WEEX ${status}` : null;
  const row = json as { success?: boolean; msg?: string; message?: string; code?: string | number };
  const msg = String(row.msg || row.message || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (row.success === false) return msg || "WEEX відхилив. Ордера немає.";
  if (typeof row.code === "number" && row.code !== 0) return msg || `WEEX ${row.code}`;
  if (typeof row.code === "string" && row.code !== "0" && row.code !== "00000") return msg || `WEEX ${row.code}`;
  if (status >= 400) return msg || `WEEX ${status}`;
  return null;
}

async function call(c: Creds, method: "GET" | "POST", path: string, query = "", body = ""): Promise<unknown> {
  const ts = String(Date.now());
  const message = ts + method + path + (query ? `?${query}` : "") + body;
  const res = await fetch(`${BASE}${path}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      "ACCESS-KEY": c.key,
      "ACCESS-SIGN": sign(c.secret, message),
      "ACCESS-PASSPHRASE": c.pass,
      "ACCESS-TIMESTAMP": ts,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const bad = failText(json, res.status);
  if (bad) throw new Error(bad);
  return json;
}

function openSize(json: unknown): number {
  const rows = Array.isArray(json) ? json : [];
  let n = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const size = Number((row as { size?: string }).size);
    if (Number.isFinite(size)) n += Math.abs(size);
  }
  return n;
}

async function readMove(): Promise<{ last: number; bps: number } | null> {
  const res = await fetch(`${BASE}/capi/v3/market/klines?symbol=${SYMBOL}&interval=15m&limit=3`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows) || !rows.length) return null;
  let best: { t: number; open: number; close: number } | null = null;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const t = Number(row[0]);
    const open = Number(row[1]);
    const close = Number(row[4]);
    if (!Number.isFinite(t) || !(open > 0) || !(close > 0)) continue;
    if (!best || t > best.t) best = { t, open, close };
  }
  if (!best) return null;
  return { last: best.close, bps: ((best.close - best.open) / best.open) * 10_000 };
}

async function minQty(): Promise<string> {
  try {
    const res = await fetch(`${BASE}/capi/v3/market/exchangeInfo`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return "0.0001";
    const body = (await res.json()) as { symbols?: { symbol?: string; minOrderSize?: number; quantityPrecision?: number }[] };
    const row = body.symbols?.find((s) => s.symbol === SYMBOL);
    const min = Number(row?.minOrderSize);
    const prec = Number(row?.quantityPrecision);
    if (min > 0) return min.toFixed(Number.isFinite(prec) && prec >= 0 ? prec : 4);
  } catch {
    /* public info down — use the known floor */
  }
  return "0.0001";
}

async function setLeverage(c: Creds): Promise<boolean> {
  const isolated = JSON.stringify({
    symbol: SYMBOL,
    marginType: "ISOLATED",
    isolatedLongLeverage: LEVERAGE,
    isolatedShortLeverage: LEVERAGE,
  });
  try {
    await call(c, "POST", "/capi/v3/account/leverage", "", isolated);
    return true;
  } catch {
    const crossed = JSON.stringify({ symbol: SYMBOL, marginType: "CROSSED", crossLeverage: LEVERAGE });
    try {
      await call(c, "POST", "/capi/v3/account/leverage", "", crossed);
      return true;
    } catch {
      return false;
    }
  }
}

async function askGrok(last: number, bps: number, side: "long" | "short"): Promise<{ ok: true; action: "long" | "short" | "skip"; confidence: number; why: string } | { ok: false; error: string }> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "Grok зараз недоступний. Ордера немає." };
  const system = [
    "WEEX USDT-M BTCUSDT. long = BUY LONG. short = SELL SHORT.",
    "Напрямок лише зі знака ходу свічки. long лише якщо bps > 0. short лише якщо bps < 0.",
    "Прогноз проти знака — skip. |bps| малий — skip.",
    "Не вигадуй ціну, PnL і плече. Плече ставить сервер, не ти.",
    "JSON: {\"action\":\"long\"|\"short\"|\"skip\",\"confidence\":0..1,\"why\":\"хід і секунди\"}.",
  ].join(" ");
  const user = JSON.stringify({ symbol: SYMBOL, last, bps: Number(bps.toFixed(2)), side });
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        model: GROK_MODEL,
        temperature: 0,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `Grok ${res.status}. Ордера немає.` };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: true, action: "skip", confidence: 0, why: "Grok не зібрав рішення." };
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { action?: string; confidence?: number; why?: string };
    const action = parsed.action === "long" || parsed.action === "short" ? parsed.action : "skip";
    const confidence = Number(parsed.confidence);
    const why = String(parsed.why ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || "Grok не зібрав рішення.";
    return { ok: true, action, confidence: Number.isFinite(confidence) ? confidence : 0, why };
  } catch {
    return { ok: false, error: "Grok не відповів. Ордера немає." };
  }
}

function px(n: number): string {
  return n.toFixed(1);
}

export async function stepWeexOnServer(): Promise<WeexStep> {
  const c = creds();
  if (!c) return { ok: false, error: "Немає ключа WEEX. Ордера немає." };
  try {
    const held = await call(c, "GET", "/capi/v3/account/position/singlePosition", `symbol=${SYMBOL}`);
    if (openSize(held) > 0) return { ok: true, placed: false, why: "Уже є слот WEEX. Ордера немає." };
    const book = await readMove();
    if (!book) return { ok: true, placed: false, why: "Немає ціни BTCUSDT. Ордера немає." };
    if (Math.abs(book.bps) < 5) return { ok: true, placed: false, why: "Хід BTC малий. Ордера немає." };
    const side = book.bps > 0 ? "long" : "short";
    const mind = await askGrok(book.last, book.bps, side);
    if (!mind.ok) return mind;
    if (mind.action === "skip" || mind.confidence < 0.65) {
      return { ok: true, placed: false, why: mind.why || "Grok не зібрав рішення." };
    }
    if (mind.action !== side) return { ok: true, placed: false, why: "Прогноз проти ходу. Ордера немає." };
    if (!(await setLeverage(c))) return { ok: false, error: "Плече 2× не стало. Ордера немає." };
    const qty = await minQty();
    const tp = side === "long" ? px(book.last * 1.004) : px(book.last * 0.996);
    const sl = side === "long" ? px(book.last * 0.996) : px(book.last * 1.004);
    const clientId = `sclk${Date.now()}`.slice(0, 36);
    const body = JSON.stringify({
      symbol: SYMBOL,
      side: side === "long" ? "BUY" : "SELL",
      positionSide: side === "long" ? "LONG" : "SHORT",
      type: "MARKET",
      quantity: qty,
      newClientOrderId: clientId,
      tpTriggerPrice: tp,
      slTriggerPrice: sl,
      TpWorkingType: "CONTRACT_PRICE",
      SlWorkingType: "MARK_PRICE",
    });
    const placed = await call(c, "POST", "/capi/v3/order", "", body);
    const orderId = placed && typeof placed === "object" && "orderId" in placed ? String((placed as { orderId?: string }).orderId ?? "") : "";
    const label = side === "long" ? "LONG" : "SHORT";
    return {
      ok: true,
      placed: true,
      orderId: orderId || clientId,
      why: `WEEX ${label} ${qty} BTCUSDT · плече 2×`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/\s+/g, " ").trim().slice(0, 160) : "";
    return { ok: false, error: msg || "WEEX не відповів. Ордера немає." };
  }
}
