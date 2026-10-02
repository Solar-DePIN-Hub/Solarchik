/** Pure Ukrainian -> English swap for the Work desk (es/pt/de/ja players see English). */
import { WORK_EN } from "./work-phrases.ts";

const LONG = Object.entries(WORK_EN)
  .filter(([uk]) => uk.length >= 2)
  .sort((a, b) => b[0].length - a[0].length);

function isLetter(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

function replaceWhole(text: string, uk: string, en: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf(uk, i);
    if (at < 0) {
      out += text.slice(i);
      break;
    }
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + uk.length] ?? "";
    // A digit right before is fine ("2д" -> "2d"); a letter is not (part of another word).
    const stuckLeft = isLetter(uk[0] ?? "") && /\p{L}/u.test(before);
    const stuckRight = isLetter(uk[uk.length - 1] ?? "") && isLetter(after);
    if (stuckLeft || stuckRight) {
      out += text.slice(i, at + 1);
      i = at + 1;
      continue;
    }
    out += text.slice(i, at) + en;
    i = at + uk.length;
  }
  return out;
}

export function translateText(raw: string): string {
  const key = raw.trim();
  const exact = key ? WORK_EN[key] : undefined;
  if (exact && exact !== key) {
    const at = raw.indexOf(key);
    return raw.slice(0, at) + exact + raw.slice(at + key.length);
  }
  let next = raw;
  for (const [uk, en] of LONG) {
    if (uk.length < 2 || uk === en || !next.includes(uk)) continue;
    next = replaceWhole(next, uk, en);
  }
  return next;
}
