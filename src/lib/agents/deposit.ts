import { createServerFn } from "@tanstack/react-start";
import type { Hex } from "viem";

export const ensureDepositWallet = createServerFn({ method: "POST" })
  .validator((input: { owner: string }) => input)
  .handler(async ({ data }) => {
    const { ensureDepositWalletOnServer } = await import("./deposit.server");
    return ensureDepositWalletOnServer(String(data.owner ?? ""));
  });

export const walletNonce = createServerFn({ method: "POST" })
  .validator((input: { owner: string }) => input)
  .handler(async ({ data }) => {
    const { walletNonceOnServer } = await import("./deposit.server");
    return walletNonceOnServer(String(data.owner ?? ""));
  });

export const submitWalletBatch = createServerFn({ method: "POST" })
  .validator(
    (input: {
      from: string;
      depositWallet: string;
      nonce: string;
      signature: Hex;
      deadline: string;
      calls: { target: string; value: string; data: Hex }[];
    }) => input,
  )
  .handler(async ({ data }) => {
    const { submitWalletBatchOnServer } = await import("./deposit.server");
    return submitWalletBatchOnServer(data);
  });
