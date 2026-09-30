import type { MsgKey } from "./i18n";

export type FailKind = "offline" | "timeout" | "empty" | "bad" | "busy" | "denied";

export function isOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function failOf(e: unknown): FailKind {
  if (!isOnline()) return "offline";
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  const msg = e instanceof Error ? e.message : String(e || "");
  if (name === "AbortError" || /timeout|timed out|aborted/i.test(msg)) return "timeout";
  if (name === "NotAllowedError" || /notallowed|permission|denied/i.test(msg)) return "denied";
  if (name === "TypeError" || /network|fetch|failed to fetch|load failed/i.test(msg)) return "offline";
  return "bad";
}

export function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function errKey(kind: string | undefined): MsgKey {
  if (kind === "offline") return "pet.err.offline";
  if (kind === "timeout") return "pet.err.timeout";
  if (kind === "empty") return "pet.err.empty";
  if (kind === "busy") return "pet.chat.busy";
  if (kind === "denied") return "pet.talk.needMic";
  return "pet.err.bad";
}
