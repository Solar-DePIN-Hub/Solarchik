import { createServerFn } from "@tanstack/react-start";
import type { CoachRequest, CoachResult } from "./coach.server";

export type { CoachRequest, CoachResult } from "./coach.server";

export const coachAgent = createServerFn({ method: "POST" })
  .validator((input: CoachRequest) => input)
  .handler(async ({ data }): Promise<CoachResult> => {
    const { coachStrategy } = await import("./coach.server");
    return coachStrategy(data);
  });
