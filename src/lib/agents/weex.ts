import { createServerFn } from "@tanstack/react-start";
import type { WeexStep } from "./weex.server";

export type { WeexStep } from "./weex.server";

export const stepWeex = createServerFn({ method: "POST" })
  .validator((input: { ping: true }) => input)
  .handler(async (): Promise<WeexStep> => {
    const { stepWeexOnServer } = await import("./weex.server");
    return stepWeexOnServer();
  });
