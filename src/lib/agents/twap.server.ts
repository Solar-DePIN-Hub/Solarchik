import type { TwapSnapshot, TwapWindow } from "./twap";

const URL = "wss://ws-live-data.polymarket.com";
const FRESH_SEC = 15;

type Stored = {
  symbol: "btc/usd";
  windowS: 30 | 60;
  fullAccuracy: string;
  observedAt: number;
  receivedAt: number;
};

type Hub = {
  ticks: Map<30 | 60, Stored>;
  generation: number;
  ws: WebSocket | null;
  ping: ReturnType<typeof setInterval> | null;
  reconnect: ReturnType<typeof setTimeout> | null;
  started: boolean;
  connectAt: number;
};

const hub: Hub = ((globalThis as { __solarchikTwap?: Hub }).__solarchikTwap ??= {
  ticks: new Map(),
  generation: 0,
  ws: null,
  ping: null,
  reconnect: null,
  started: false,
  connectAt: 0,
});

function blank(windowS: 30 | 60): TwapWindow {
  return { symbol: "btc/usd", windowS, known: false, price: null, ageSec: null, stale: false };
}

/** Exact decimal from a signed E18 integer string. No float. */
export function formatE18(raw: string): string | null {
  if (!/^\d+$/.test(raw) || /^0+$/.test(raw)) return null;
  const padded = raw.padStart(19, "0");
  let whole = padded.slice(0, -18).replace(/^0+/, "");
  if (!whole) whole = "0";
  const frac = padded.slice(-18).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function view(windowS: 30 | 60, now: number): TwapWindow {
  const tick = hub.ticks.get(windowS);
  if (!tick) return blank(windowS);
  const price = formatE18(tick.fullAccuracy);
  if (!price) return blank(windowS);
  const delta = now - tick.observedAt;
  const ageSec = delta < 0 ? 0 : Math.round(delta / 1000);
  const stale = delta < -5000 || ageSec > FRESH_SEC;
  return {
    symbol: "btc/usd",
    windowS,
    known: true,
    price: stale ? null : price,
    ageSec,
    stale,
  };
}

export function snapshotTwap(now = Date.now()): TwapSnapshot {
  return { w30: view(30, now), w60: view(60, now) };
}

function hasTick(): boolean {
  return hub.ticks.has(30) || hub.ticks.has(60);
}

function waitForTick(ms: number): Promise<void> {
  if (ms <= 0 || hasTick()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const poll = setInterval(() => {
      if (hasTick()) done();
    }, 100);
    function done() {
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    }
  });
}

function windowOf(topic: string, raw: unknown): 30 | 60 | null {
  const n = Number(raw);
  if (n === 30 || n === 60) return n;
  if (topic === "crypto_prices_twap_thirty") return 30;
  if (topic === "crypto_prices_twap_sixty") return 60;
  return null;
}

function pointOf(row: Record<string, unknown>): { full: string; stamp: number } | null {
  const full = row.full_accuracy_value;
  if (typeof full !== "string" || !/^\d+$/.test(full) || !formatE18(full)) return null;
  const stamp = Number(row.timestamp);
  if (!Number.isFinite(stamp) || stamp <= 0) return null;
  return { full, stamp };
}

function newestPoint(payload: Record<string, unknown>): { full: string; stamp: number } | null {
  let best = pointOf(payload);
  const data = payload.data;
  if (!Array.isArray(data)) return best;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const next = pointOf(row as Record<string, unknown>);
    if (!next) continue;
    const nextAt = next.stamp < 1e12 ? next.stamp * 1000 : next.stamp;
    const bestAt = best ? (best.stamp < 1e12 ? best.stamp * 1000 : best.stamp) : -1;
    if (nextAt >= bestAt) best = next;
  }
  return best;
}

function freshestReceived(): number {
  let at = 0;
  for (const tick of hub.ticks.values()) if (tick.receivedAt > at) at = tick.receivedAt;
  return at;
}

function ingest(text: string) {
  if (!text || text === "PONG" || text === "PING") return;
  let msg: { topic?: unknown; payload?: Record<string, unknown> };
  try {
    msg = JSON.parse(text) as { topic?: unknown; payload?: Record<string, unknown> };
  } catch {
    return;
  }
  const topic = typeof msg.topic === "string" ? msg.topic : "";
  const payload = msg.payload;
  if (!payload || typeof payload !== "object") return;
  if (String(payload.symbol ?? "").toLowerCase() !== "btc/usd") return;
  const windowS = windowOf(topic, payload.window_s);
  if (!windowS) return;
  const point = newestPoint(payload);
  if (!point) return;
  const observedAt = point.stamp < 1e12 ? point.stamp * 1000 : point.stamp;
  hub.ticks.set(windowS, {
    symbol: "btc/usd",
    windowS,
    fullAccuracy: point.full,
    observedAt,
    receivedAt: Date.now(),
  });
}

async function asText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  return "";
}

function connect() {
  if (typeof WebSocket === "undefined") return;
  const gen = ++hub.generation;
  hub.connectAt = Date.now();
  if (hub.ping) clearInterval(hub.ping);
  hub.ping = null;
  if (hub.reconnect) clearTimeout(hub.reconnect);
  hub.reconnect = null;
  try {
    hub.ws?.close();
  } catch {
    /* previous socket already gone */
  }
  let sock: WebSocket;
  try {
    sock = new WebSocket(URL);
  } catch {
    return;
  }
  hub.ws = sock;
  sock.addEventListener("open", () => {
    if (gen !== hub.generation) return;
    sock.send(
      JSON.stringify({
        action: "subscribe",
        subscriptions: [
          { topic: "crypto_prices_twap_thirty", type: "update", filters: "{\"symbol\":\"btc/usd\"}" },
          { topic: "crypto_prices_twap_sixty", type: "update", filters: "{\"symbol\":\"btc/usd\"}" },
        ],
      }),
    );
    hub.ping = setInterval(() => {
      if (gen !== hub.generation) return;
      const heard = freshestReceived();
      const quietFor = heard > hub.connectAt ? Date.now() - heard : Date.now() - hub.connectAt;
      if (quietFor > 12_000) {
        connect();
        return;
      }
      if (sock.readyState === WebSocket.OPEN) sock.send("PING");
    }, 5000);
  });
  sock.addEventListener("message", (ev) => {
    if (gen !== hub.generation) return;
    void asText(ev.data).then((text) => {
      if (gen === hub.generation) ingest(text);
    });
  });
  const again = () => {
    if (gen !== hub.generation || hub.reconnect) return;
    if (hub.ping) clearInterval(hub.ping);
    hub.ping = null;
    hub.reconnect = setTimeout(() => {
      hub.reconnect = null;
      if (gen === hub.generation) connect();
    }, 2000);
  };
  sock.addEventListener("close", again);
  sock.addEventListener("error", () => {
    try {
      sock.close();
    } catch {
      again();
    }
  });
}

function waitForNewer(ms: number, since: number): Promise<void> {
  if (ms <= 0 || freshestReceived() > since) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const poll = setInterval(() => {
      if (freshestReceived() > since) done();
    }, 100);
    function done() {
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    }
  });
}

export function ensureTwapStream() {
  const state = hub.ws?.readyState;
  const live = state === WebSocket.OPEN || state === WebSocket.CONNECTING;
  const heard = freshestReceived();
  const sinceConnect = Date.now() - (hub.connectAt || 0);
  const quiet = !hub.connectAt
    ? heard === 0 || Date.now() - heard > 12_000
    : heard > hub.connectAt
      ? Date.now() - heard > 12_000
      : sinceConnect > 12_000;
  if (hub.started && live && !quiet) return;
  if (live && hub.connectAt && sinceConnect < 12_000 && heard <= hub.connectAt) return;
  hub.started = true;
  connect();
}

export async function readTwapSnapshot(waitMs = 0): Promise<TwapSnapshot> {
  const before = freshestReceived();
  ensureTwapStream();
  if (!hasTick() && waitMs > 0) await waitForTick(waitMs);
  else if (hub.connectAt > before) await waitForNewer(1500, before);
  return snapshotTwap();
}
