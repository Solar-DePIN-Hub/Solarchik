import { createServerFn } from "@tanstack/react-start";

export const readMainnetSlot = createServerFn({ method: "GET" }).handler(async (): Promise<number | null> => {
  const { readMainnetSlotOnServer } = await import("./mainnet.server");
  return readMainnetSlotOnServer();
});

export const readMainnetBalance = createServerFn({ method: "POST" })
  .validator((input: { owner: string }) => input)
  .handler(async ({ data }): Promise<number | null> => {
    const { readMainnetBalanceOnServer } = await import("./mainnet.server");
    return readMainnetBalanceOnServer(data.owner);
  });

export const readMainnetUsdc = createServerFn({ method: "POST" })
  .validator((input: { owner: string }) => input)
  .handler(async ({ data }): Promise<number | null> => {
    const { readMainnetUsdcOnServer } = await import("./mainnet.server");
    return readMainnetUsdcOnServer(data.owner);
  });

export const peekMainnetSig = createServerFn({ method: "POST" })
  .validator((input: { signature: string }) => input)
  .handler(async ({ data }) => {
    const { peekMainnetSigOnServer } = await import("./mainnet.server");
    return peekMainnetSigOnServer(data.signature);
  });

export const confirmMainnetTx = createServerFn({ method: "POST" })
  .validator((input: { signature: string }) => input)
  .handler(async ({ data }) => {
    const { confirmMainnetTxOnServer } = await import("./mainnet.server");
    return confirmMainnetTxOnServer(data.signature);
  });

export const prepareMainnetSweep = createServerFn({ method: "POST" })
  .validator((input: { ping: true }) => input)
  .handler(async () => {
    const { prepareMainnetSweepOnServer } = await import("./mainnet.server");
    return prepareMainnetSweepOnServer();
  });

export const prepareMainnetSend = createServerFn({ method: "POST" })
  .validator((input: { from: string; to: string; sol: number }) => input)
  .handler(async ({ data }) => {
    const { prepareMainnetSendOnServer } = await import("./mainnet.server");
    return prepareMainnetSendOnServer(String(data.from ?? ""), String(data.to ?? ""), Number(data.sol));
  });

export const sendMainnetTx = createServerFn({ method: "POST" })
  .validator((input: { tx: string }) => input)
  .handler(async ({ data }) => {
    const { sendMainnetTxOnServer } = await import("./mainnet.server");
    return sendMainnetTxOnServer(data.tx);
  });