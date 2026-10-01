import { createServerFn } from "@tanstack/react-start";
import { readProof } from "./wallet-proof";

/** Server gate for "one Free strategy NFT per wallet". The client check stays as UX only. */
export const claimFreeMint = createServerFn({ method: "POST" })
  .validator((input: { proof?: unknown }) => ({ proof: readProof(input?.proof) }))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const { checkFreeMint } = await import("./free-mint.server");
    return checkFreeMint(data.proof);
  });
