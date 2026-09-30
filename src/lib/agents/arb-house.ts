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
  .validator((input: { dir: "A" | "B"; symbol?: string }) => ({
    dir: input?.dir === "B" ? "B" : "A",
    symbol: typeof input?.symbol === "string" ? input.symbol.toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 16) : "SOL",
  }))
  .handler(async ({ data }) => {
    const dir = data.dir === "B" ? "B" : "A";
    const { fireArbOnServer } = await import("./arb-house.server");
    return fireArbOnServer(dir, data.symbol || "SOL");
  });
