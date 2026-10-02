/**
 * /api/native/<route> for the native (Capacitor) bundle, which has no TanStack server functions.
 * Same server code as the web server functions. Every state-changing call carries a
 * wallet proof signed by the room key, so CORS is open; secrets never leave the server.
 */
import { DESK_PROXY_PER_MIN, rateLimiter } from "../../src/lib/agents/desk-proxy-rules.ts";

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
]);
const MAX_BODY = 16 * 1024;
const allow = rateLimiter(DESK_PROXY_PER_MIN);

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
  if (method !== "POST") return reply(405, { ok: false, error: "method" });
  const ip = (event.req.headers?.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (!allow(`${ip}:${route}`, Date.now())) return reply(429, { ok: false, error: "slow down" });
  const text = (await event.req.text?.()) ?? "";
  if (text.length > MAX_BODY) return reply(413, { ok: false, error: "too large" });
  let body: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    return reply(400, { ok: false, error: "json" });
  }
  try {
    const { readProof } = await import("../../src/lib/agents/wallet-proof.ts");
    if (route === "arb-fire") {
      const { cleanArbSymbol } = await import("../../src/lib/agents/arb-rules.ts");
      const { guardedArbFire } = await import("../../src/lib/agents/arb-guard.server.ts");
      return reply(
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
      return reply(200, { ...house, mode: info.mode, modeReason: info.reason });
    }
    if (route === "mint-status") {
      const { mintStatusOnServer } = await import("../../src/lib/agents/mint.server.ts");
      return reply(200, mintStatusOnServer());
    }
    const b58 = (v: unknown, max: number) => str(v).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, max);
    if (route === "arb-credit") {
      const { readArbCreditOnServer } = await import("../../src/lib/agents/payments.server.ts");
      return reply(200, await readArbCreditOnServer(b58(body.asset, 44)));
    }
    if (route === "arb-credit-claim") {
      const { claimArbCreditOnServer } = await import("../../src/lib/agents/payments.server.ts");
      return reply(200, await claimArbCreditOnServer({ wallet: b58(body.wallet, 44), asset: b58(body.asset, 44), sig: b58(body.sig, 100) }));
    }
    if (route === "fee-record") {
      const { recordFeeOnServer } = await import("../../src/lib/agents/payments.server.ts");
      return reply(
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
        return reply(
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
      if (route === "position-close") return reply(200, await server.closePositionOnServer({ proof, fillId: rules.cleanFillId(body.fillId) }));
      if (route === "fee-window-start") return reply(200, await server.startFeeWindowOnServer({ proof }));
      if (route === "fee-balance") return reply(200, await server.feeBalanceOnServer(b58(body.wallet, 44)));
      return reply(
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
      return reply(200, await prepareReissueOnServer({ proof: readProof(body.proof), oldAsset: b58(body.oldAsset, 44), paySig: b58(body.paySig, 100) }));
    }
    const { prepareMintOnServer } = await import("../../src/lib/agents/mint.server.ts");
    return reply(
      200,
      await prepareMintOnServer({
        proof: readProof(body.proof),
        skuId: str(body.skuId).replace(/[^\w.:-]/g, "").slice(0, 64),
        paySig: str(body.paySig).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 100),
      }),
    );
  } catch (error) {
    console.error("[native-api]", route, error instanceof Error ? error.message : error);
    return reply(500, { ok: false, reason: "Сервер не відповів." });
  }
}
