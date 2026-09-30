import { createServerFn } from "@tanstack/react-start";
import type { DecideRequest, DecideResult } from "./decide.server";

export type { DecideRequest, DecideResult } from "./decide.server";

export const decideBet = createServerFn({ method: "POST" })
  .validator((input: DecideRequest) => input)
  .handler(async ({ data }): Promise<DecideResult> => {
    const { decideBetOnServer } = await import("./decide.server");
    return decideBetOnServer(data);
  });
