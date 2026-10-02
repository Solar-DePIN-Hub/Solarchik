/**
 * /api/native/<route> for the native (Capacitor) bundle, which has no TanStack server functions.
 * Same server code as the web server functions. Every state-changing call carries a
 * wallet proof signed by the room key, so CORS is open; secrets never leave the server.
 */
import { DESK_PROXY_PER_MIN, rateLimiter } from "../../src/lib/agents/desk-proxy-rules.ts";
import { translateText } from "../../src/components/game/work-translate.ts";

const SOL_PER_MIN = 40;

interface NativeEvent {
  url: URL;
  req: { method?: string; text?: () => Promise<string>; headers?: Headers };
}

const ROUTES = new Set([
  "arb-fire",
  "arb-house",
  "arb-credit",
  "arb-credit-claim",
  "fee-record",
  "fee-balance",
  "fee-window-start",
  "clock-record",
  "position-open",
  "position-close",
  "mint-status",
  "mint-prepare",
  "mint-reissue",
  "faucet-drip",
  "strategy-validate",
  "strategy-info",
  "strategy-prepare",
  "strategy-confirm",
  "strategy-sync",
  "market-list",
  "market-prepare-list",
  "market-confirm-list",
  "market-unlist",
  "market-prepare-buy",
  "market-confirm-buy",
  "sol-chat",
  "sol-voice",
]);
const MAX_BODY = 16 * 1024;
const allow = rateLimiter(DESK_PROXY_PER_MIN);
/** Sol chat/voice: a run fires a line every few seconds and the app caches voice by text, so allow more. */
const allowSol = rateLimiter(SOL_PER_MIN);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
}

const TEXT_KEYS = new Set(["reason", "error", "errors", "modeReason", "note", "message"]);

/**
 * Server texts are Ukrainian at the source. A native client that sends `"lang":"en"` gets the same
 * English swap the web desk uses (one dictionary, tested to cover every agent module).
 */
export function englishReply(value: unknown, key = ""): unknown {
  if (typeof value === "string") return TEXT_KEYS.has(key) ? translateText(value) : value;
  if (Array.isArray(value)) return value.map((v) => englishReply(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, englishReply(v, k)]));
  }
  return value;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default async function nativeApiMiddleware(
  event: NativeEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (!event.url.pathname.startsWith("/api/native/")) return next();
  const route = event.url.pathname.slice("/api/native/".length).replace(/\/+$/, "");
  if (!ROUTES.has(route)) return reply(404, { ok: false, error: "route" });
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Vercel cron: GET /api/native/strategy-sync with Authorization: Bearer CRON_SECRET.
  if (route === "strategy-sync" && method === "GET") {
    const secret = (process.env.CRON_SECRET || "").trim();
    if (!secret || event.req.headers?.get("authorization") !== `Bearer ${secret}`) return reply(401, { ok: false, error: "auth" });
    const { strategyRoute } = await import("../../src/lib/agents/strategy.server.ts");
    return reply(200, await strategyRoute("strategy-sync", {}, { cron: true }));
  }
  if (method !== "POST") return reply(405, { ok: false, error: "method" });
  const ip = (event.req.headers?.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  const limiter = route.startsWith("sol-") ? allowSol : allow;
  if (!limiter(`${ip}:${route}`, Date.now())) return reply(429, { ok: false, error: "slow down" });
  const text = (await event.req.text?.()) ?? "";
  if (text.length > MAX_BODY) return reply(413, { ok: false, error: "too large" });
  let body: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    return reply(400, { ok: false, error: "json" });
  }
  // Sol replies are generated in the requested language; the UK→EN dictionary swap does not apply.
  if (route === "sol-chat") {
    const { solChat } = await import("../../src/lib/game/sol-native.server.ts");
    const r = await solChat(body);
    return reply(r.status, r.body);
  }
  if (route === "sol-voice") {
    const { solVoice } = await import("../../src/lib/game/sol-native.server.ts");
    const r = await solVoice(body);
    if (!r.audio) return reply(r.status, r.body);
    return new Response(r.audio as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "audio/wav", "cache-control": "no-store", "x-sol-model": r.model || "", ...CORS, "access-control-expose-headers": "x-sol-model" },
    });
  }
  const lang = body.lang === "en" ? "en" : "uk";
  const out = (status: number, payload: unknown) => reply(status, lang === "en" ? englishReply(payload) : payload);
  try {
    if (route.startsWith("strategy-") || route.startsWith("market-") || route === "faucet-drip") {
      const { strategyRoute } = await import("../../src/lib/agents/strategy.server.ts");
      return out(200, await strategyRoute(route, body, { ip }));
    }
    const { readProof } = await import("../../src/lib/agents/wallet-proof.ts");
    if (route === "arb-fire") {
      const { cleanArbSymbol } = await import("../../src/lib/agents/arb-rules.ts");
      const { guardedArbFire } = await import("../../src/lib/agents/arb-guard.server.ts");
      return out(
        200,
        await guardedArbFire({
          dir: body.dir === "B" ? "B" : "A",
          symbol: cleanArbSymbol(str(body.symbol) || "SOL") || "SOL",
          asset: str(body.asset).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 44),
          proof: readProof(body.proof),
        }),
      );
    }
    if (route === "arb-house") {
      const { currentArbMode } = await import("../../src/lib/agents/arb-guard.server.ts");
      const { readArbHouseOnServer } = await import("../../src/lib/agents/arb-house.server.ts");
      const info = currentArbMode();
      const house = await readArbHouseOnServer();
      return out(200, { ...house, mode: info.mode, modeReason: info.reason });
    }
    if (route === "mint-status") {
      const { mintStatusOnServer } = await import("../../src/lib/agents/mint.server.ts");
      return out(200, mintStatusOnServer());
    }
    const b58 = (v: unknown, max: number) => str(v).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, max);
    if (route === "arb-credit") {
      const { readArbCreditOnServer } = await import("../../src/lib/agents/payments.server.ts");
      return out(200, await readArbCreditOnServer(b58(body.asset, 44)));
    }
    if (route === "arb-credit-claim") {
      const { claimArbCreditOnServer } = await import("../../src/lib/agents/payments.server.ts");
      return out(200, await claimArbCreditOnServer({ wallet: b58(body.wallet, 44), asset: b58(body.asset, 44), sig: b58(body.sig, 100) }));
    }
    if (route === "fee-record") {
      const { recordFeeOnServer } = await import("../../src/lib/agents/payments.server.ts");
      return out(
        200,
        await recordFeeOnServer({
          wallet: b58(body.wallet, 44),
          rowId: str(body.rowId).slice(0, 64),
          sig: b58(body.sig, 100),
          lamports: typeof body.lamports === "number" && Number.isFinite(body.lamports) ? Math.round(body.lamports) : 0,
        }),
      );
    }
    if (route === "position-open" || route === "position-close" || route === "clock-record" || route === "fee-window-start" || route === "fee-balance") {
      const server = await import("../../src/lib/agents/positions.server.ts");
      const rules = await import("../../src/lib/agents/position-rules.ts");
      const proof = readProof(body.proof);
      if (route === "position-open") {
        return out(
          200,
          await server.openPositionOnServer({
            proof,
            fillId: rules.cleanFillId(body.fillId),
            asset: b58(body.asset, 44),
            book: rules.readBook(body.book),
            side: rules.readSide(body.side),
            stakeLamports: typeof body.stakeLamports === "number" && Number.isFinite(body.stakeLamports) ? Math.round(body.stakeLamports) : 0,
          }),
        );
      }
      if (route === "position-close") return out(200, await server.closePositionOnServer({ proof, fillId: rules.cleanFillId(body.fillId) }));
      if (route === "fee-window-start") return out(200, await server.startFeeWindowOnServer({ proof }));
      if (route === "fee-balance") return out(200, await server.feeBalanceOnServer(b58(body.wallet, 44)));
      return out(
        200,
        await server.recordClockOnServer({
          proof,
          clockAddress: b58(body.clockAddress, 44),
          clockSig: b58(body.clockSig, 100),
          kind: body.kind === "message" ? "message" : "tx",
          cluster: body.cluster === "mainnet" ? "mainnet" : "devnet",
          memo: str(body.memo).slice(0, 120),
        }),
      );
    }
    if (route === "mint-reissue") {
      const { prepareReissueOnServer } = await import("../../src/lib/agents/mint.server.ts");
      return out(200, await prepareReissueOnServer({ proof: readProof(body.proof), oldAsset: b58(body.oldAsset, 44), paySig: b58(body.paySig, 100) }));
    }
    const { prepareMintOnServer } = await import("../../src/lib/agents/mint.server.ts");
    return out(
      200,
      await prepareMintOnServer({
        proof: readProof(body.proof),
        skuId: str(body.skuId).replace(/[^\w.:-]/g, "").slice(0, 64),
        paySig: str(body.paySig).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 100),
      }),
    );
  } catch (error) {
    console.error("[native-api]", route, error instanceof Error ? error.message : error);
    return out(500, { ok: false, reason: "Сервер не відповів." });
  }
}
