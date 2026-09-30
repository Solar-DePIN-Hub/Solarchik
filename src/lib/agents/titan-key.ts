const STORAGE = "solarchik-titan-key";

/** The Titan portal key, kept on this device. Never written into the NFT or a log. */
export function readTitanKey(): string {
  if (typeof localStorage === "undefined") return "";
  return (localStorage.getItem(STORAGE) || "").trim().slice(0, 256);
}

export function writeTitanKey(value: string): void {
  if (typeof localStorage === "undefined") return;
  const clean = value.trim().slice(0, 256);
  if (!clean) localStorage.removeItem(STORAGE);
  else localStorage.setItem(STORAGE, clean);
}
