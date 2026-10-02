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

export const NO_SOL_REASON = "Не вистачає devnet SOL на гаманці кімнати. Натисни «Отримати devnet SOL» і спробуй ще раз.";

/** Raw web3 / RPC errors (English, technical) -> one short line the player can act on. */
export function chainErrorText(e: unknown): string {
  const raw = e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message ?? "") : String(e ?? "");
  if (/no record of a prior credit|insufficient (lamports|funds)|0x1\b/i.test(raw)) return NO_SOL_REASON;
  if (/429|too many requests|rate.?limit/i.test(raw)) return "Devnet зараз перевантажений. Спробуй за хвилину.";
  if (/blockhash not found|block height exceeded|expired/i.test(raw)) return "Мережа не встигла підтвердити. Спробуй ще раз.";
  if (/reject|declin|denied|cancel/i.test(raw)) return "Підпис відхилено.";
  if (/failed to fetch|network|timeout|timed out/i.test(raw)) return "Немає зв'язку з Devnet. Спробуй ще раз.";
  return "Транзакція не пройшла на Devnet.";
}
