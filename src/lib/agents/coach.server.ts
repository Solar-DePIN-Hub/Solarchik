import { clampStrategy, cryptoBand, lanesForStrategy, laneEnabledOn } from "./classes";
import { grokChat } from "./grok-fetch";
import { GROK_MODEL } from "./grok-model";
import { geminiTalk } from "./gemini-live.server";
import type { AgentBrief, NftClassId, PredLane, RiskMode, StrategyBundle } from "./types";

export type CoachRequest = {
  name: string;
  classId: NftClassId;
  guidance: string;
  brief: AgentBrief;
  strategy: StrategyBundle;
  /** App language; the player's own message decides first (see coachLang). */
  locale?: string;
};

export type CoachBet = PredLane | null;

export type CoachOk = {
  ok: true;
  reply: string;
  brief: AgentBrief;
  strategy: StrategyBundle;
  bet: CoachBet;
};

export type CoachResult = CoachOk | { ok: false; error: string };

function asRisk(value: unknown, fallback: RiskMode): RiskMode {
  return value === "calm" || value === "balanced" || value === "risky" ? value : fallback;
}

function asText(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string") return fallback.slice(0, max);
  const text = value.replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, max);
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asBet(value: unknown): CoachBet {
  return value === "crypto" || value === "events" || value === "weather" ? value : null;
}

/** Reply in the language the player wrote in; app locale only when the text gives no hint. */
export function coachLang(text: string, locale?: string): "uk" | "en" {
  if (/[\u0400-\u04FF]/.test(text)) return "uk";
  if (/[A-Za-z]{2,}/.test(text)) return "en";
  return String(locale || "").toLowerCase().startsWith("en") ? "en" : "uk";
}

const COACH_TEXT = {
  uk: {
    empty: "Напиши агенту, що змінити.",
    noReply: "Агент не відповів. Спробуй ще раз.",
    badJson: "Агент не зібрав відповідь. Скажи коротше.",
    ok: "Прийняв.",
    laneOff: "Смуга вимкнена. Ставки немає.",
    rule: "reply — 1-2 речення українською: що зрозумів і що змінив. behavior теж українською. Не вигадуй біржу, ринок і ціну.",
  },
  en: {
    empty: "Tell the agent what to change.",
    noReply: "The agent did not answer. Try again.",
    badJson: "The agent could not build an answer. Say it shorter.",
    ok: "Got it.",
    laneOff: "That lane is off. No bet.",
    rule: "reply — 1-2 sentences in English: what you understood and what you changed. behavior in English too. Do not invent an exchange, market or price.",
  },
} as const;

export async function coachStrategy(input: CoachRequest): Promise<CoachResult> {
  const guidance = input.guidance.replace(/\s+/g, " ").trim().slice(0, 400);
  const tx = COACH_TEXT[coachLang(guidance, input.locale)];
  if (!guidance) return { ok: false, error: tx.empty };

  const lanes = lanesForStrategy(input.strategy.prediction, input.classId);
  const predOnly = input.classId !== 2;
  const system = [
    "Ти чат торгового агента Соларчика. Відповідай лише JSON без markdown.",
    tx.rule,
    "risk: calm|balanced|risky або null якщо людина не просила ризик.",
    "behavior: одне речення до 180 символів як торгувати, або null.",
    "crypto, events, weather, weex: true|false|null. null = не чіпати. Міняй лише те, що людина назвала.",
    `Смуги цього NFT: ${lanes.join(", ") || "немає"}. Інші смуги не вмикай.`,
    "windows: масив з 5, 15, 60, 240 або null. 5 = 5 хв, 15 = 15 хв, 60 = 1 год, 240 = 4 год. null = не міняти вікна.",
    "Якщо сказала «додай» — допиши до поточних. Якщо назвала список — це новий повний список.",
    "askLo і askHi: числа 0.05–0.95 або null. Це коридор ask крипти. lo менше hi. null = не міняти.",
    "eventsDays: 1 або 2 або null. Лише якщо просили горизонт подій.",
    "bet: crypto|events|weather|null. Став bet лише якщо людина прямо просить зробити ставку зараз. Інакше null.",
    predOnly ? "DEX не чіпай." : "Це DEX-агент. Смуги prediction і bet лишай null.",
  ].join(" ");

  const user = JSON.stringify({
    name: input.name,
    said: guidance,
    risk: input.brief.risk,
    behavior: input.brief.behavior,
    lanes,
    laneOn: input.strategy.prediction.laneOn ?? {},
    weex: input.strategy.prediction.weexOn === true,
    eventsDays: input.strategy.prediction.eventsDays === 1 ? 1 : 2,
    windows: input.strategy.prediction.windows ?? [15],
    askLo: cryptoBand(input.strategy.prediction).lo,
    askHi: cryptoBand(input.strategy.prediction).hi,
  });

  let raw = "";
  try {
    const res = await grokChat(
      {
        model: GROK_MODEL,
        temperature: 0,
        max_tokens: 220,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      12_000,
    );
    if (res.ok) {
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      raw = body.choices?.[0]?.message?.content ?? "";
    }
  } catch {
    raw = "";
  }
  if (!raw.trim()) {
    const alt = await geminiTalk(system, user, 400);
    raw = alt?.text ?? "";
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: tx.noReply };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { ok: false, error: tx.badJson };
  }

  const risk = asRisk(parsed.risk, input.brief.risk);
  const laneOn = { ...(input.strategy.prediction.laneOn ?? {}) };
  if (predOnly) {
    for (const lane of lanes) {
      const bit = asBool(parsed[lane]);
      if (bit != null) laneOn[lane] = bit;
    }
  }
  const weexBit = predOnly && lanes.includes("crypto") ? asBool(parsed.weex) : null;
  const daysRaw = parsed.eventsDays;
  const eventsDays = daysRaw === 1 || daysRaw === 2 ? daysRaw : input.strategy.prediction.eventsDays;
  const named = Array.isArray(parsed.windows)
    ? [...new Set(parsed.windows.map(Number).filter((n) => n === 5 || n === 15 || n === 60 || n === 240))]
    : [];
  const windows = named.length ? named : input.strategy.prediction.windows;
  const askLo = typeof parsed.askLo === "number" ? parsed.askLo : input.strategy.prediction.askLo;
  const askHi = typeof parsed.askHi === "number" ? parsed.askHi : input.strategy.prediction.askHi;
  const strategy = clampStrategy({
    prediction: {
      ...input.strategy.prediction,
      laneOn,
      eventsDays,
      windows,
      askLo,
      askHi,
      weexOn: weexBit == null ? input.strategy.prediction.weexOn === true : weexBit,
    },
    dex: input.strategy.dex,
  });
  let bet = predOnly ? asBet(parsed.bet) : null;
  let reply = asText(parsed.reply, tx.ok, 220);
  if (bet && !laneEnabledOn(strategy.prediction, bet, input.classId)) {
    reply = `${reply} ${tx.laneOff}`.slice(0, 220);
    bet = null;
  }
  const brief: AgentBrief = {
    risk,
    behavior: asText(parsed.behavior, input.brief.behavior, 180),
    goal: guidance,
  };
  return { ok: true, reply, brief, strategy, bet };
}
