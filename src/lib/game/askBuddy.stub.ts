export type AskBuddyInput = {
  name: string;
  vibe: string;
  stage: string;
  emotion: string;
  locale: string;
  charge: number;
  mood: number;
  rest: number;
  shine: number;
  careDays: number;
  history: { role: "user" | "buddy"; text: string }[];
  message: string;
  scene?: string;
  context?: string;
};

export type AskBuddyResult = { ok: true; text: string; offline?: boolean } | { ok: false; error: "offline" | "bad" | "busy" | "timeout" | "empty" };

export async function askBuddy(_args?: unknown): Promise<AskBuddyResult> {
  return { ok: false, error: "offline" };
}

export async function hearBuddy(_args?: unknown): Promise<{ ok: true; text: string } | { ok: false }> {
  return { ok: false };
}

export async function speakBuddy(_args?: unknown): Promise<{ ok: true; audio: string; mime: string } | { ok: false }> {
  return { ok: false };
}
