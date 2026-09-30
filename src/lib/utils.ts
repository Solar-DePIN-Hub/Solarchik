import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortKey(pubkey: string, left = 4, right = 4): string {
  if (pubkey.length <= left + right + 1) return pubkey;
  return `${pubkey.slice(0, left)}…${pubkey.slice(-right)}`;
}

export function formatSol(amount: number): string {
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "uk";
  const loc =
    lang === "en"
      ? "en-US"
      : lang === "de"
        ? "de-DE"
        : lang === "es"
          ? "es-ES"
          : lang === "pt"
            ? "pt-PT"
            : lang === "ja"
              ? "ja-JP"
              : "uk-UA";
  return amount.toLocaleString(loc, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}
