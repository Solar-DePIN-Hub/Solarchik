import { createServerFn } from "@tanstack/react-start";
import type { BridgePlan } from "./bridge.server";

export type { BridgePlan } from "./bridge.server";

export const prepareBridge = createServerFn({ method: "POST" })
  .validator((input: { polygon: string; room: string }) => input)
  .handler(async ({ data }): Promise<BridgePlan | { ok: false; error: string }> => {
    const { prepareBridgeOnServer } = await import("./bridge.server");
    return prepareBridgeOnServer(String(data.polygon ?? ""), String(data.room ?? ""));
  });

export const readBridgeStatus = createServerFn({ method: "POST" })
  .validator((input: { svm: string }) => input)
  .handler(async ({ data }): Promise<string | null> => {
    const { readBridgeStatusOnServer } = await import("./bridge.server");
    return readBridgeStatusOnServer(String(data.svm ?? ""));
  });
