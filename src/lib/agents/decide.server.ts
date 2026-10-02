import { GROK_MODEL } from "./grok-model";
import { grokChat } from "./grok-fetch";
import { geminiTalk } from "./gemini-live.server";

export type DecideTwap = {
  w30: { price: string | null; ageSec: number | null };
  w60: { price: string | null; ageSec: number | null };
};

export type DecideMarket = {
  id: string;
  question: string;
  yesLabel: string;
  noLabel: string;
  yes: number;
  windowMin: number | null;
  volume: number;
  feeRate?: number | null;
  hoursLeft?: number | null;
  priceToBeat?: number | null;
  currentRef?: number | null;
  delta?: number | null;
  secondsLeft?: number | null;
  askUp?: number | null;
  askDown?: number | null;
  feeLabel?: string | null;
  windowLabel?: string | null;
  resolveTwap?: 30 | 60 | null;
  twapPrice?: string | null;
  twapAgeSec?: number | null;
  bucket?: string | null;
  station?: string | null;
  forecastHigh?: number | null;
  observedHigh?: number | null;
  tempUnit?: "F" | "C" | null;
};

export type DecideRequest = {
  focus: "btc" | "events" | "weather";
  name: string;
  risk: string;
  goal: string;
  edgeBps: number;
  maxStakeSol: number;
  anchorYes: number;
  moveBps: number;
  twap?: DecideTwap | null;
  markets: DecideMarket[];
  askLo?: number;
  askHi?: number;
  /** Player's UI locale ("uk" / "en"...). English players get an English `why`. */
  locale?: string;
};

export type DecideResult =
  | { ok: true; action: "yes" | "no" | "skip"; marketId: string; confidence: number; why: string; brain?: Brain }
  | { ok: false; error: string };

export type CloseDecision =
  | { ok: true; action: "sell" | "hold"; confidence: number; why: string; brain?: Brain }
  | { ok: false; error: string };

const GROK_WAIT_MS = 12_000;

function bandOf(input: { askLo?: number; askHi?: number }): { lo: number; hi: number } {
  let lo = Number(input.askLo);
  let hi = Number(input.askHi);
  if (!Number.isFinite(lo)) lo = 0.15;
  if (!Number.isFinite(hi)) hi = 0.85;
  return { lo, hi };
}

function grokSilent(started: number): string {
  const sec = Math.max(1, Math.round((Date.now() - started) / 1000));
  return `Grok не відповів за ${sec} с.`;
}

function deniesPayload(why: string): boolean {
  return /немає\s*(twap|ціни|даних)|без даних|усі вікна|без явної переваги/i.test(why) || inventedGate(why);
}

function inventedGate(why: string): boolean {
  return /\|\s*delta\s*\|\s*<\s*100|менше\s*(ніж\s*)?100|поріг.{0,16}100|мало\s*часу|надто\s*коротк|не відповідає порогу/i.test(why);
}

export type Brain = "Grok" | "Gemini";

/** Language of the human-facing `why`. Checks below still read the Ukrainian `why`. */
export type DecideLang = "uk" | "en";

export function decideLang(locale: string | undefined | null): DecideLang {
  return String(locale || "").toLowerCase().startsWith("uk") || !locale ? "uk" : "en";
}

const WHY_EN_ASK =
  " Додай поле \"why_en\": те саме пояснення одним реченням англійською (English).";

/**
 * Grok first (XAI_API_KEY or the desk worker). If Grok is not reachable on this deploy, Gemini answers
 * the same prompt, and the result says which model decided (never labelled Grok when Gemini answered).
 */
async function completeGrok(
  system: string,
  user: string,
  maxTokens = 220,
): Promise<{ ok: true; raw: string; brain: Brain } | { ok: false; error: string }> {
  const asked = Date.now();
  let grokFail = "";
  try {
    const res = await grokChat(
      {
        model: GROK_MODEL,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      GROK_WAIT_MS,
    );
    if (res.ok) {
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return { ok: true, raw: body.choices?.[0]?.message?.content ?? "", brain: "Grok" };
    }
    grokFail = `Grok ${res.status}`;
  } catch {
    grokFail = grokSilent(asked).replace(/\.$/, "");
  }
  const alt = await geminiTalk(system, user, maxTokens + 120).catch(() => null);
  if (alt?.text) return { ok: true, raw: alt.text, brain: "Gemini" };
  return { ok: false, error: `ШІ не відповів (${grokFail}, Gemini теж). Ставку не відкриваю.` };
}

/** Swap the model's Ukrainian sentence for its English copy inside the final line (prefixes stay for the dictionary). */
function localizeWhy(why: string, uk: string, en: string | null, lang: DecideLang): string {
  if (lang !== "en" || !en || !uk || !why.includes(uk)) return why;
  return why.replace(uk, en);
}

function citesCrowdOdds(why: string): boolean {
  return (
    /(ринок|натовп|стакан|polymarket|outcomeprices|yes%).{0,48}(\d+\s*%|0\.\d+)/i.test(why) ||
    /(\d+\s*%|0\.\d+).{0,48}(ринок|натовп|стакан|ймовірн)/i.test(why) ||
    /ask\s*(up|down)?.{0,24}(дає|каже|означає|ймовірн)/i.test(why)
  );
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function decideBetOnServer(input: DecideRequest): Promise<DecideResult> {
  const markets: DecideMarket[] = (input.markets ?? []).slice(0, 6).map((m) => {
    const row: DecideMarket = {
      id: String(m.id).slice(0, 80),
      question: String(m.question).slice(0, 160),
      yesLabel: String(m.yesLabel).slice(0, 32),
      noLabel: String(m.noLabel).slice(0, 32),
      yes: Number(m.yes),
      windowMin: m.windowMin,
      volume: Number(m.volume) || 0,
      feeRate: m.feeRate == null || !Number.isFinite(Number(m.feeRate)) ? null : Number(m.feeRate),
      hoursLeft: m.hoursLeft == null || !Number.isFinite(Number(m.hoursLeft)) ? null : Number(m.hoursLeft),
    };
    const priceToBeat = numOrNull(m.priceToBeat);
    const currentRef = numOrNull(m.currentRef);
    if (priceToBeat != null && currentRef != null) {
      row.priceToBeat = priceToBeat;
      row.currentRef = currentRef;
      row.delta = numOrNull(m.delta) ?? currentRef - priceToBeat;
      row.secondsLeft = numOrNull(m.secondsLeft);
      row.askUp = numOrNull(m.askUp);
      row.askDown = numOrNull(m.askDown);
      row.feeLabel = m.feeLabel ? String(m.feeLabel).slice(0, 80) : "невідома";
      row.windowLabel = m.windowLabel ? String(m.windowLabel).slice(0, 8) : null;
      row.resolveTwap = m.resolveTwap === 30 || m.resolveTwap === 60 ? m.resolveTwap : null;
      row.twapPrice = m.twapPrice ? String(m.twapPrice).slice(0, 40) : null;
      row.twapAgeSec = numOrNull(m.twapAgeSec);
    }
    if (input.focus === "weather") {
      row.bucket = m.bucket ? String(m.bucket).slice(0, 40) : null;
      row.station = m.station ? String(m.station).slice(0, 8) : null;
      row.forecastHigh = numOrNull(m.forecastHigh);
      row.observedHigh = numOrNull(m.observedHigh);
      row.tempUnit = m.tempUnit === "F" || m.tempUnit === "C" ? m.tempUnit : null;
      row.yes = 0;
    }
    return row;
  });
  if (!markets.length) return { ok: false, error: "Немає ринків для розбору." };
  const anchored = input.focus === "btc" && markets.some((m) => m.priceToBeat != null && m.currentRef != null);
  const events = input.focus === "events";
  const weather = input.focus === "weather";
  const band = bandOf(input);
  const system = anchored
    ? [
        "Бік вирішуєш ти: yes = Up, no = Down. Дивись priceToBeat і currentRef, не дешевший ask.",
        "ask 0.30 не означає шанс 30%. Це ціна входу, не напрямок.",
        "Час до кінця, свіжість TWAP і «мало дельти» не причина skip.",
        `skip, якщо ask обраного боку поза ${band.lo}–${band.hi}, або вже стоїть нога на цьому conditionId, або з priceToBeat і currentRef не видно боку.`,
        "Не купуй обидва боки. Не міняй Up на Down лише бо той ask дешевший.",
        "Комісія не причина skip. Не вигадуй ціну BTC і PnL.",
        "JSON: {\"action\":\"yes\"|\"no\"|\"skip\",\"marketId\":\"id\",\"confidence\":0..1,\"why\":\"бік, priceToBeat і currentRef\"}.",
      ].join(" ")
    : events
      ? [
          "Це не крипта. BTC Up/Down не чіпай.",
          "Ask / outcomePrices / yes% у рішення не входять. Це ціна натовпу, не прогноз.",
          "Немає власного аргумента з факту події — action skip.",
          "Не повторюй стакан і не пиши, що ринок дає N%.",
          "Не вигадуй вінрейт і PnL.",
          "yes = перший бік (outcomes[0]). no = другий.",
          "hoursLeft — години до резолву. Далі двох діб не бери.",
          "yes або no лише якщо confidence від 0.65. Сумнів = skip.",
          "JSON: {\"action\":\"yes\"|\"no\"|\"skip\",\"marketId\":\"id зі списку\",\"confidence\":0..1,\"why\":\"одне речення\"}.",
        ].join(" ")
      : weather
        ? [
            "Температуру не вигадуй. Бери лише forecastHigh / observedHigh зі станції.",
            "Немає observedHigh — action skip. Лише forecast — не ставка.",
            "Бакет лише той, куди лягає observedHigh. На межі двох бакетів — skip.",
            "forecastHigh і observedHigh у різних бакетах — skip.",
            "Ask / % натовпу не прогноз. BoM rates без цифри станції — skip.",
            "yes лише на один marketId бака. no не став. Сумнів = skip.",
            "Не вигадуй вінрейт і PnL.",
            "JSON: {\"action\":\"yes\"|\"skip\",\"marketId\":\"id\",\"confidence\":0..1,\"why\":\"станція і цифра\"}.",
          ].join(" ")
        : [
        "Ти вирішуєш одну ставку prediction-агента Соларчик.",
        "Ціни нижче — живі з Polymarket Gamma. Не вигадуй інші цифри і не додавай ринки.",
        "yes = перший бік (yesLabel, для біткоїна це Up). no = другий бік.",
        "focus btc: лише Bitcoin Up/Down. Up означає, що ціна на кінець вікна не нижча за старт.",
        "focus events: біткоїн і крипту не чіпай. Бери ринок лише якщо після питання бачиш явну перевагу. Інакше skip.",
        "На подіях TWAP немає і не вигадуй його. Не пиши «немає TWAP», якщо тобі його не передавали.",
        "feeRate — taker з API. null означає, що комісія невідома: не вважай її нулем і не скасовуй нею ставку.",
        "hoursLeft, якщо є, — години до резолву. Далі двох діб не бери.",
        "Ти експерт, не гравець. За замовчуванням skip.",
        "yes або no лише якщо впевненість від 0.65 і ти поставив би свої гроші. Сумнів = skip.",
        "Не став лише тому, що ціна зрушила або один бік трохи попереду.",
        "skip, якщо ринок уже майже вирішений, питання неясне, даних мало, або перевага слабка.",
        ...(input.focus === "btc"
          ? ["twap.w30 і twap.w60 — Chainlink TWAP btc/usd. price null означає, що свіжої цифри немає. Не вигадуй прайс."]
          : []),
        "Відповідай лише JSON: {\"action\":\"yes\"|\"no\"|\"skip\",\"marketId\":\"id зі списку\",\"confidence\":0..1,\"why\":\"одне речення українською\"}.",
        "why пояснює рішення людині. Не обіцяй ордер у стакані Polymarket.",
      ].join(" ");
  const user = anchored
    ? JSON.stringify({
        markets: markets
          .filter((m) => m.priceToBeat != null && m.currentRef != null)
          .map((m) => ({
            id: m.id,
            question: m.question,
            window: m.windowLabel,
            forecast: {
              secondsLeft: m.secondsLeft,
              priceToBeat: m.priceToBeat,
              currentRef: m.currentRef,
              delta: m.delta,
              resolveTwap: m.resolveTwap,
              twapPrice: m.twapPrice,
              twapAgeSec: m.twapAgeSec,
            },
            exec: {
              askUp: m.askUp,
              askDown: m.askDown,
              feeLabel: m.feeLabel ?? "невідома",
            },
          })),
      })
    : events
      ? JSON.stringify({
          markets: markets.map((m) => ({
            id: m.id,
            question: m.question,
            outcomes: [m.yesLabel, m.noLabel],
            hoursLeft: m.hoursLeft ?? null,
          })),
        })
      : weather
        ? JSON.stringify({
            station: markets[0]?.station ?? null,
            unit: markets[0]?.tempUnit ?? null,
            forecastHigh: markets[0]?.forecastHigh ?? null,
            observedHigh: markets[0]?.observedHigh ?? null,
            markets: markets.map((m) => ({
              id: m.id,
              bucket: m.bucket,
              hoursLeft: m.hoursLeft ?? null,
            })),
          })
        : JSON.stringify({
        focus: input.focus,
        name: input.name,
        risk: input.risk,
        goal: input.goal.slice(0, 180),
        edgeBps: input.edgeBps,
        moveBps: input.moveBps,
        anchorYes: input.anchorYes,
        ...(input.focus === "btc" ? { twap: input.twap ?? null } : {}),
        markets,
      });

  const lang = decideLang(input.locale);
  const ask = lang === "en" ? WHY_EN_ASK : "";
  const first = await completeGrok(system + ask, user);
  if (!first.ok) return first;
  const decision = readBet(first.raw, first.brain);
  if (!decision.ok) return decision;
  const priced = markets.some((m) => {
    const up = m.askUp;
    const down = m.askDown;
    return (up != null && up > band.lo && up < band.hi) || (down != null && down > band.lo && down < band.hi);
  });
  if (anchored && decision.action === "skip" && priced && deniesPayload(decision.why)) {
    const again = await completeGrok(
      [
        "Цифри в запиті є. Не пиши, що немає TWAP, ціни чи даних.",
        "Бік з priceToBeat і currentRef. yes = Up, no = Down. Не бери дешевший ask.",
        "ask — ціна входу, не шанс і не напрямок.",
        `Час, дельта і TWAP не причина skip. skip, якщо ask твого боку поза ${band.lo}–${band.hi}, або ноги з цифр не видно.`,
        "Не вигадуй поріг і не пиши «мало часу». Не вигадуй ціну BTC і PnL.",
        "Відповідай лише JSON: {\"action\":\"yes\"|\"no\"|\"skip\",\"marketId\":\"id зі списку\",\"confidence\":0..1,\"why\":\"бік, priceToBeat і currentRef\"}.",
      ].join(" ") + ask,
      user,
    );
    if (!again.ok) return again;
    const second = readBet(again.raw, again.brain);
    if (!second.ok) return second;
    if (second.action === "skip" && deniesPayload(second.why)) {
      const invented = inventedGate(second.why);
      return {
        ok: true,
        action: "skip",
        marketId: "",
        confidence: second.confidence,
        brain: again.brain,
        why: invented
          ? `${again.brain} вигадав поріг. Ордера немає.`
          : `${again.brain} проігнорував коридор ціни. Ордера немає.`,
      };
    }
    return second;
  }
  if (!anchored && decision.action === "skip" && /twap/i.test(decision.why)) {
    return { ...decision, why: "Немає явної переваги на події. Ордера немає." };
  }
  return decision;

  function readBet(raw: string, brain: Brain): DecideResult {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, error: `${brain} не зібрав рішення.` };
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `${brain} не зібрав рішення.` };
    }
    const marketId = typeof parsed.marketId === "string" ? parsed.marketId : "";
    const known = markets.some((m) => m.id === marketId);
    if (typeof parsed.confidence !== "number" || !Number.isFinite(parsed.confidence)) {
      return { ok: false, error: `${brain} не зібрав рішення.` };
    }
    const confidence = Math.min(1, Math.max(0, parsed.confidence));
    let why = String(parsed.why ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
    const modelWhy = why;
    const whyEn = typeof parsed.why_en === "string" ? parsed.why_en.replace(/\s+/g, " ").trim().slice(0, 180) || null : null;
    if (parsed.action !== "yes" && parsed.action !== "no" && parsed.action !== "skip") {
      return { ok: false, error: `${brain} не зібрав рішення.` };
    }
    let action: "yes" | "no" | "skip" = parsed.action;
    if (action !== "skip" && !known) {
      action = "skip";
      why = why ? `Ринок не зі списку. ${why}` : "Ринок не зі списку. Ордера немає.";
    }
    if (action !== "skip" && confidence < 0.65 && !anchored) {
      action = "skip";
      why = why
        ? `Не беру: впевненість ${Math.round(confidence * 100)}%. ${why}`
        : "Не беру: впевненість нижче 65%.";
    }
    if ((input.focus === "events" || input.focus === "weather") && action !== "skip" && (citesCrowdOdds(why) || /ринок\s+(дає\s+)?\d+/i.test(why))) {
      action = "skip";
      why = "Ask — ціна натовпу, не прогноз. Ордера немає.";
    }
    if ((input.focus === "events" || input.focus === "weather") && action !== "skip" && /\bbom\s+rates?\b/i.test(why) && !/\d/.test(why)) {
      action = "skip";
      why = "Немає цифри станції. Ордера немає.";
    }
    if (input.focus === "weather" && action === "no") {
      action = "skip";
      why = "Бакет лише той, куди лягає цифра. Ордера немає.";
    }
    if (input.focus === "weather" && action !== "skip") {
      const sample = markets[0];
      if (!sample || sample.observedHigh == null) {
        action = "skip";
        why = "Ще не знятий high. Ордера немає.";
      }
    }
    if (anchored && action !== "skip") {
      const picked = markets.find((m) => m.id === marketId);
      const ask = action === "yes" ? picked?.askUp : picked?.askDown;
      if (ask == null || !(ask > band.lo && ask < band.hi)) {
        action = "skip";
        why = `Ask поза ${band.lo}–${band.hi}. Ордера немає.`;
      }
    }
    return {
      ok: true,
      action,
      marketId: known ? marketId : "",
      confidence,
      why: localizeWhy(why || "Без пояснення.", modelWhy, whyEn, lang),
      brain,
    };
  }
}

export async function decideCloseOnServer(input: {
  windowLabel: string | null;
  priceToBeat: number | null;
  currentRef: number | null;
  delta: number | null;
  secondsLeft: number | null;
  entry: number;
  bid: number;
  feeLabel: string;
  lane: "crypto" | "events";
}): Promise<CloseDecision> {
  const system = [
    "Ти закриваєш одну вже куплену ставку Polymarket. Нову не відкривай.",
    "Питання одне: чи край уже з’їдений і ринок розверне.",
    "Напрямок лише з priceToBeat, currentRef, delta і secondsLeft. Немає власного прогнозу — action hold.",
    "bid не є прогнозом і не є ймовірністю. Ask і % натовпу тобі не передані. Не цитуй їх.",
    "feeLabel «невідома» не є нулем. Не вигадуй PnL і цільову ціну.",
    "sell лише якщо confidence від 0.65 і край уже з’їдений. Інакше hold.",
    "Відповідай лише JSON: {\"action\":\"sell\"|\"hold\",\"confidence\":0..1,\"why\":\"одне речення українською\"}.",
  ].join(" ");
  const user = JSON.stringify({
    lane: input.lane,
    windowLabel: input.windowLabel,
    priceToBeat: input.priceToBeat,
    currentRef: input.currentRef,
    delta: input.delta,
    secondsLeft: input.secondsLeft,
    entry: input.entry,
    bid: input.bid,
    feeLabel: input.feeLabel,
  });
  const done = await completeGrok(system, user, 180);
  if (!done.ok) return { ok: false, error: done.error.replace("Ставку не відкриваю.", "Закриття немає.") };
  const { raw, brain } = done;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: `${brain} не зібрав рішення.` };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `${brain} не зібрав рішення.` };
  }
  if (typeof parsed.confidence !== "number" || !Number.isFinite(parsed.confidence)) {
    return { ok: false, error: `${brain} не зібрав рішення.` };
  }
  const confidence = Math.min(1, Math.max(0, parsed.confidence));
  let why = String(parsed.why ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (parsed.action !== "sell" && parsed.action !== "hold") {
    return { ok: false, error: `${brain} не зібрав рішення.` };
  }
  let action: "sell" | "hold" = parsed.action;
  if (action === "sell" && confidence < 0.65) {
    action = "hold";
    why = why ? `Не продаю: впевненість ${Math.round(confidence * 100)}%. ${why}` : "Не продаю: впевненість нижче 65%.";
  }
  if (action === "sell" && citesCrowdOdds(why)) {
    action = "hold";
    why = "Напрямок зі стакана не беру. Не продаю.";
  }
  return { ok: true, action, confidence, why: why || "Без пояснення.", brain };
}
