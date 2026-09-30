import { isLocale, t, type Locale } from "./i18n";
import type { AskBuddyInput, AskBuddyResult } from "@/lib/game/askBuddy.functions";
import { isPetVibe, isPetVoice, type PetVibe, type PetVoice } from "./pet";
import { safeJson } from "./netErr";

const NATIVE_BUILD = import.meta.env.VITE_NATIVE === "1";

type NativeBridge = {
  ask: (payload: string, id: string) => void;
  hear: (audio: string, mime: string, id: string) => void;
  listen?: (id: string, locale: string) => void;
  stopListen?: () => void;
  speak?: (text: string, locale: string, voice?: string) => void;
  hush?: () => void;
  clockIn?: (meters: string, score: string, streak: string, id: string) => void;
  contacts?: (id: string) => void;
  ussd?: (code: string) => void;
  pay?: (url: string, id: string) => void;
  connectWallet?: (id: string) => void;
  playerId?: () => string;
  bindPlayer?: (id: string) => void;
  setScreening?: (on: string) => void;
  inbox?: (id: string) => void;
};

declare global {
  interface Window {
    SolarchikNative?: NativeBridge;
    SolarchikNativeReply?: (id: string, json: string) => void;
    SolarchikIncoming?: (json: string) => void;
  }
}

const pending = new Map<string, (json: string) => void>();
let seq = 1;

function bridge(): NativeBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SolarchikNative;
}

export function isNativeApp() {
  return !!bridge();
}

function ensureReply() {
  if (typeof window === "undefined") return;
  if (window.SolarchikNativeReply) return;
  window.SolarchikNativeReply = (id, json) => {
    const fn = pending.get(id);
    if (!fn) return;
    pending.delete(id);
    fn(json);
  };
}

function nativeCall(run: (id: string) => void, ms = 8000): Promise<string> {
  ensureReply();
  return new Promise((resolve, reject) => {
    const id = String(seq++);
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout"));
    }, ms);
    pending.set(id, (json) => {
      window.clearTimeout(timer);
      resolve(json);
    });
    run(id);
  });
}

function canned(locale: string, vibe: string, name: string) {
  const loc: Locale = isLocale(locale) ? locale : "en";
  const v: PetVibe = isPetVibe(vibe) ? vibe : "sunny";
  const key =
    v === "dry"
      ? "pet.chat.can.dry"
      : v === "hype"
        ? "pet.chat.can.hype"
        : v === "gentle"
          ? "pet.chat.can.gentle"
          : "pet.chat.can.sunny";
  return t(loc, key, { name: name || "Solarchik" });
}

function packAsk(data: AskBuddyInput) {
  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const turn of data.history || []) {
    const role = turn.role === "buddy" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + turn.text;
    else contents.push({ role, parts: [{ text: turn.text }] });
  }
  if (contents[0]?.role === "model") contents.unshift({ role: "user", parts: [{ text: "Hi." }] });
  const last = contents[contents.length - 1];
  const message = data.message || "";
  if (last?.role === "user") last.parts[0].text += (last.parts[0].text ? "\n" : "") + message;
  else contents.push({ role: "user", parts: [{ text: message }] });
  const system = [
    `You are ${data.name || "Solarchik"}, a small navy-and-gold solar robot with a gold visor and cyan eyes.`,
    `You are the player's pocket friend in Solarchik CLOCK IN. Never a battery, egg, Tamagotchi, AI, Gemini, Grok, or chatbot.`,
    `Reply in the same language as the player. 1-2 complete spoken sentences. No markdown, no lists.`,
    data.scene === "run" ? `You are IN a roof run (${data.context || "running"}). One clear spoken sentence.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { system, contents, maxTokens: data.scene === "run" ? 70 : 140 };
}

function hasNativeAsk() {
  const n = bridge();
  if (!n) return false;
  try {
    return typeof n.ask === "function";
  } catch {
    return true;
  }
}

function readAsk(raw: string): AskBuddyResult | null {
  const v = safeJson(raw);
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const text = String(o.text || o.reply || "").trim();
  if (o.ok && text) return { ok: true, text, offline: Boolean(o.offline) };
  const error = o.error;
  if (error === "busy" || error === "offline" || error === "timeout" || error === "empty" || error === "bad") {
    return { ok: false, error };
  }
  if (o.ok === false) return { ok: false, error: text ? "bad" : "empty" };
  return null;
}

export async function liveAsk(data: AskBuddyInput): Promise<AskBuddyResult> {
  const fast = data.scene === "run";
  if (hasNativeAsk()) {
    try {
      const raw = await nativeCall((id) => bridge()!.ask(JSON.stringify(packAsk(data)), id), fast ? 8000 : 16000);
      const parsed = readAsk(raw);
      if (parsed?.ok && parsed.text) return parsed;
    } catch {
      /* canned */
    }
    return { ok: true, text: canned(data.locale, data.vibe, data.name), offline: true };
  }
  if (NATIVE_BUILD) return { ok: true, text: canned(data.locale, data.vibe, data.name), offline: true };
  try {
    const { askBuddy } = await import("@/lib/game/askBuddy.functions");
    return askBuddy({ data });
  } catch {
    return { ok: true, text: canned(data.locale, data.vibe, data.name), offline: true };
  }
}

export function canNativeListen() {
  const n = bridge();
  if (!n) return false;
  try {
    return typeof n.listen === "function";
  } catch {
    return true;
  }
}

export async function nativeListen(locale: string): Promise<string | null> {
  const n = bridge();
  if (!n) return null;
  try {
    const raw = await nativeCall((id) => n.listen!(id, locale), 16000);
    const parsed = safeJson(raw) as { ok?: boolean; text?: string } | null;
    const text = String(parsed?.text || "").trim();
    if (parsed?.ok && text) return text;
  } catch {
    return null;
  }
  return null;
}

export function nativeStopListen() {
  try {
    bridge()?.stopListen?.();
  } catch {
    /* webview */
  }
}

export async function importPhonebook(): Promise<{ ok: true; names: string[] } | { ok: false }> {
  const n = bridge();
  if (n?.contacts) {
    try {
      const raw = await nativeCall((id) => n.contacts!(id), 45000);
      const parsed = safeJson(raw) as { ok?: boolean; names?: unknown } | null;
      const names = Array.isArray(parsed?.names) ? parsed.names.map((x) => String(x || "").trim()).filter((x) => x.length >= 2) : [];
      if (parsed?.ok && names.length) return { ok: true, names };
    } catch {
      return { ok: false };
    }
    return { ok: false };
  }
  const nav = navigator as Navigator & {
    contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[] }[]> };
  };
  if (nav.contacts?.select) {
    try {
      const picked = await nav.contacts.select(["name"], { multiple: true });
      const names: string[] = [];
      for (const c of picked) {
        for (const nm of c.name || []) {
          const s = String(nm || "").trim();
          if (s.length >= 2) names.push(s);
        }
      }
      if (names.length) return { ok: true, names };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

export function nativeUssd(code: string): boolean {
  const n = bridge();
  if (n?.ussd && code) {
    try {
      n.ussd(code);
      return true;
    } catch {
      return false;
    }
  }
  if (typeof window === "undefined" || !code) return false;
  try {
    window.location.href = `tel:${code.replace(/#/g, "%23")}`;
    return true;
  } catch {
    return false;
  }
}

export async function openPay(url: string): Promise<boolean> {
  const n = bridge();
  if (n?.pay) {
    try {
      const raw = await nativeCall((id) => n.pay!(url, id), 8000);
      const parsed = safeJson(raw) as { ok?: boolean } | null;
      return Boolean(parsed?.ok);
    } catch {
      return false;
    }
  }
  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
}

export async function signClockIn(
  meters: number,
  score: number,
  streak: number,
): Promise<
  | { ok: true; address: string; signature: string; cluster: "mainnet" | "devnet"; kind: "tx" | "message" }
  | { ok: false; error: string }
> {
  const n = bridge();
  if (!n?.clockIn) return { ok: false, error: "wallet-missing" };
  try {
    const raw = await nativeCall(
      (id) => n.clockIn!(String(meters | 0), String(score | 0), String(streak | 0), id),
      120000,
    );
    const parsed = safeJson(raw) as {
      ok?: boolean;
      address?: string;
      signature?: string;
      cluster?: string;
      kind?: string;
      error?: string;
    } | null;
    if (!parsed?.ok) return { ok: false, error: parsed?.error || "Wallet did not sign" };
    const address = String(parsed.address || "").trim();
    const signature = String(parsed.signature || "").trim();
    const kind = parsed.kind === "message" ? "message" : "tx";
    if (signature.length < 32) return { ok: false, error: "Wallet sent no signature" };
    if (address.length < 32) return { ok: false, error: "Wallet signed without account" };
    return {
      ok: true,
      address,
      signature,
      cluster: parsed.cluster === "mainnet" ? "mainnet" : "devnet",
      kind,
    };
  } catch {
    return { ok: false, error: "timeout" };
  }
}

export async function connectPlayerWallet(): Promise<string | null> {
  const n = bridge();
  if (n?.connectWallet) {
    try {
      const raw = await nativeCall((id) => n.connectWallet!(id), 120000);
      const parsed = safeJson(raw) as { ok?: boolean; address?: string } | null;
      const addr = String(parsed?.address || "").trim();
      if (parsed?.ok && addr.length >= 32) return addr;
    } catch {
      return null;
    }
  }
  const sol = (window as unknown as { solana?: { connect?: () => Promise<{ publicKey?: { toString: () => string } }>; publicKey?: { toString: () => string } } }).solana;
  if (sol?.connect) {
    try {
      const res = await sol.connect();
      const addr = String(res?.publicKey?.toString?.() || sol.publicKey?.toString?.() || "").trim();
      if (addr.length >= 32) return addr;
    } catch {
      return null;
    }
  }
  return null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* webview */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    el.remove();
    return true;
  } catch {
    return false;
  }
}

export async function liveHear(audio: string, mime: string): Promise<{ ok: true; text: string } | { ok: false }> {
  const native = bridge();
  if (native?.hear) {
    try {
      const raw = await nativeCall((id) => native.hear(audio, mime, id), 10000);
      const parsed = safeJson(raw) as { ok: boolean; text?: string } | null;
      if (parsed?.ok && parsed.text) return { ok: true, text: parsed.text };
    } catch {
      /* fall through */
    }
    return { ok: false };
  }
  if (NATIVE_BUILD) return { ok: false };
  const { hearBuddy } = await import("@/lib/game/askBuddy.functions");
  return hearBuddy({ data: { audio, mime } });
}

export async function liveSpeak(
  text: string,
  voice: PetVoice | string,
  locale: string,
): Promise<{ ok: true; audio: string; mime: string } | { ok: false }> {
  if (bridge() || NATIVE_BUILD) return { ok: false };
  const { speakBuddy } = await import("@/lib/game/askBuddy.functions");
  const v: PetVoice = isPetVoice(voice) ? voice : "eve";
  return speakBuddy({ data: { text, voice: v, locale } });
}

export function nativePlayerId(): string {
  try {
    return String(bridge()?.playerId?.() || "").trim();
  } catch {
    return "";
  }
}

export function bindNativePlayer(id: string) {
  try {
    if (id) bridge()?.bindPlayer?.(id);
  } catch {
    /* webview */
  }
}

export function setNativeScreening(on: boolean) {
  try {
    bridge()?.setScreening?.(on ? "1" : "0");
  } catch {
    /* webview */
  }
}

export async function pullNativeInbox(): Promise<unknown[]> {
  const n = bridge();
  if (!n?.inbox) return [];
  try {
    const raw = await nativeCall((id) => n.inbox!(id), 8000);
    const parsed = safeJson(raw) as { ok?: boolean; reports?: unknown } | null;
    return Array.isArray(parsed?.reports) ? parsed.reports : [];
  } catch {
    return [];
  }
}
