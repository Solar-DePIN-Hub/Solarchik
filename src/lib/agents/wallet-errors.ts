/** Wallet popups reject with code 4001 or a "User rejected" style message when the player says no. */
export function declined(e: unknown): boolean {
  const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  const text = String((e && typeof e === "object" && (e as { message?: unknown }).message) || e || "");
  return code === 4001 || /reject|declin|denied|cancel/i.test(text);
}

/** Short, readable reason from any thrown value. */
export function reasonOf(e: unknown, max = 160): string {
  const raw = e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message ?? "") : String(e ?? "");
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}
