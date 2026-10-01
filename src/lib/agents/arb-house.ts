import { createServerFn } from "@tanstack/react-start";

export type ArbHouse = {
  bpSol: number | null;
  bpUsdc: number | null;
  chainSol: number | null;
  chainUsdc: number | null;
  houseKey: boolean;
  tokens: Record<string, { bp: number; chain: number }> | null;
};

export const readArbHouse = createServerFn({ method: "GET" }).handler(async (): Promise<ArbHouse> => {
  const { readArbHouseOnServer } = await import("./arb-house.server");
  return readArbHouseOnServer();
});

export const fireArb = createServerFn({ method: "POST" })
  .validator((input: { dir: "A" | "B"; symbol?: string; ticket?: string }) => ({
    dir: input?.dir === "B" ? "B" : "A",
    symbol: typeof input?.symbol === "string" ? input.symbol.toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 16) : "SOL",
    ticket: typeof input?.ticket === "string" ? input.ticket.slice(0, 128) : "",
  }))
  .handler(async ({ data }) => {
    const dir = data.dir === "B" ? "B" : "A";
    const { assertArbFire, noteArbFire } = await import("./arb-guard.server");
    const gate = assertArbFire(data.ticket);
    if (!gate.ok) return { ok: false as const, broken: false, reason: gate.reason };
    const { fireArbOnServer } = await import("./arb-house.server");
    const result = await fireArbOnServer(dir, data.symbol || "SOL");
    if (result.ok) noteArbFire(result.size);
    return result;
  });
