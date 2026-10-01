import { createServerFn } from "@tanstack/react-start";
import { readProof } from "./wallet-proof";

/** Which mint path the server allows right now (co-signed, browser, or closed). */
export const readMintStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { mintStatusOnServer } = await import("./mint.server");
  return mintStatusOnServer();
});

/** Server checks the entitlement (Pro payment / one Free) and returns co-signed transactions. */
export const prepareMint = createServerFn({ method: "POST" })
  .validator((input: { proof?: unknown; skuId?: string; paySig?: string }) => ({
    proof: readProof(input?.proof),
    skuId: typeof input?.skuId === "string" ? input.skuId.replace(/[^\w.:-]/g, "").slice(0, 64) : "",
    paySig: typeof input?.paySig === "string" ? input.paySig.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 100) : "",
  }))
  .handler(async ({ data }) => {
    const { prepareMintOnServer } = await import("./mint.server");
    return prepareMintOnServer(data);
  });
