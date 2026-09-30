/** Official station read for Polymarket daily-high markets. No city lookup table. */

const UA = "SolarchikWork/1.0 (weather.gov timeseries)";

export type TempUnit = "F" | "C";

export type TempBucket = {
  id: string;
  question: string;
  bucket: string;
  tokenYes: string;
  hours: number;
  endDate: string;
  feeRate: number | null;
  feeType: string | null;
  negRisk: boolean;
  volume: number;
};

export type TempBoard = {
  station: string;
  unit: TempUnit;
  forecastHigh: number | null;
  observedHigh: number | null;
  /** Index of the single bucket the official whole degree lands in. */
  hit: number;
  buckets: TempBucket[];
};

type GammaMarket = {
  id?: string;
  question?: string;
  slug?: string;
  description?: string;
  groupItemTitle?: string;
  outcomes?: string | string[];
  clobTokenIds?: string | string[];
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  negRisk?: boolean;
  volume?: string | number;
  endDate?: string;
  feesEnabled?: boolean;
  feeType?: string;
  feeSchedule?: { rate?: number } | null;
};

type GammaEvent = {
  title?: string;
  slug?: string;
  endDate?: string;
  markets?: GammaMarket[];
};

function parseList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

export function isTempQuestion(text: string): boolean {
  return /highest temperature in\b/i.test(text);
}

export function isSportsMarket(market: { feeType?: string; question?: string; slug?: string; groupItemTitle?: string }): boolean {
  const fee = String(market.feeType ?? "").toLowerCase();
  if (fee.includes("sport")) return true;
  const q = `${market.question ?? ""} ${market.slug ?? ""} ${market.groupItemTitle ?? ""}`;
  if (/\bvs\.?\b/i.test(q)) return true;
  if (/\b(o\/u|over\/under|\bspread\b)\b/i.test(q)) return true;
  if (/\b(valorant|dota\s*2|dota2|counter-strike|cs2|csgo|\bcs\b|nhl|nfl|nba|mlb|ufc|atp|wta)\b/i.test(q)) return true;
  return false;
}

function utcDay(now: number, addDays: number): string {
  return new Date(now + addDays * 86_400_000).toISOString().slice(0, 10);
}

function feeFromApi(market: GammaMarket): number | null {
  if (market.feesEnabled !== true) return null;
  const rate = market.feeSchedule?.rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  return rate;
}

/** ICAO only when the rules name it. Never a city→station table. */
export function extractStation(description: string): string | null {
  const site = description.match(/[?&]site=([a-zA-Z0-9]{4})/i);
  if (site) return site[1]!.toUpperCase();
  const labeled = description.match(/\b(?:ICAO|site)\s*[:=]\s*([A-Za-z]{4})\b/);
  if (labeled) return labeled[1]!.toUpperCase();
  return null;
}

const WU = /wunderground\.com|weather\s+underground/i;

/** Resolution links from the rules. The Wunderground fallback is not a source. */
export function resolutionUrls(description: string): string[] {
  const found = description.match(/https?:\/\/[^\s)>"']+/gi) ?? [];
  return found.map((u) => u.replace(/[.,;]+$/, "")).filter((u) => !WU.test(u));
}

export type SourceKind = "nws" | "bom" | "page";

/** Host named in the rules. weather.gov.hk is not NWS. No other service is substituted. */
export function sourceKind(description: string, urls: string[]): SourceKind | null {
  const blob = `${description}\n${urls.join("\n")}`;
  if (/https?:\/\/(?:www\.)?weather\.gov(?!\.hk)\b/i.test(blob) || /\/wrh\/timeseries\?site=/i.test(blob)) return "nws";
  if (/bom\.gov\.au/i.test(blob) || /bureau of meteorology/i.test(blob) || /\bBoM\b/.test(description)) return "bom";
  if (urls.length) return "page";
  return null;
}

export function tempUnitFrom(description: string, question: string): TempUnit | null {
  const blob = `${description} ${question}`;
  if (/degrees?\s+fahrenheit|°\s*F\b/i.test(blob)) return "F";
  if (/degrees?\s+celsius|°\s*C\b|℃/i.test(blob)) return "C";
  return null;
}

type BucketSpec =
  | { kind: "below"; n: number }
  | { kind: "above"; n: number }
  | { kind: "range"; lo: number; hi: number }
  | { kind: "exact"; n: number };

export function parseBucket(label: string): BucketSpec | null {
  const below = label.match(/(-?\d+(?:\.\d+)?)\s*°?\s*[FC]?\s*(?:or below|or less|або нижче)/i);
  if (below) return { kind: "below", n: Number(below[1]) };
  const above = label.match(/(-?\d+(?:\.\d+)?)\s*°?\s*[FC]?\s*(?:or higher|or above|або вище|\+)/i);
  if (above) return { kind: "above", n: Number(above[1]) };
  const range = label.match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
  if (range) return { kind: "range", lo: Number(range[1]), hi: Number(range[2]) };
  const exact = label.match(/(-?\d+(?:\.\d+)?)\s*°/);
  if (exact) return { kind: "exact", n: Number(exact[1]) };
  return null;
}

function contains(spec: BucketSpec, whole: number): boolean {
  if (spec.kind === "below") return whole <= spec.n;
  if (spec.kind === "above") return whole >= spec.n;
  if (spec.kind === "exact") return whole === spec.n;
  return whole + 1e-9 >= spec.lo && whole - 1e-9 <= spec.hi;
}

/** Whole degree only when the reading is not sitting between two integers. */
export function landingIndex(value: number, labels: string[]): number | "edge" | "none" {
  if (!Number.isFinite(value)) return "none";
  if (Math.abs(value - Math.round(value)) >= 0.45) return "edge";
  const whole = Math.round(value);
  const hits: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    const spec = parseBucket(labels[i] ?? "");
    if (!spec) continue;
    if (contains(spec, whole)) hits.push(i);
  }
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0) return "none";
  return "edge";
}

async function getText(url: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  const text = await getText(url, headers);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function mesoToken(): Promise<string | null> {
  const text = await getText("https://www.weather.gov/source/wrh/apiKey.js", {
    "User-Agent": UA,
    Accept: "application/javascript,text/plain,*/*",
  });
  if (!text) return null;
  const m = text.match(/mesoToken\s*=\s*'([a-zA-Z0-9]+)'/);
  return m?.[1] ?? null;
}

/** Max temp that day from the same Synoptic feed weather.gov timeseries uses. */
async function observedHigh(icao: string, unit: TempUnit, day: string): Promise<number | null> {
  const token = await mesoToken();
  if (!token) return null;
  const units = unit === "F" ? "temp|F,speed|mph,english" : "temp|C";
  const url =
    `https://api.synopticdata.com/v2/stations/timeseries?STID=${encodeURIComponent(icao)}` +
    `&showemptystations=1&units=${encodeURIComponent(units)}&recent=2880&complete=1` +
    `&token=${encodeURIComponent(token)}&obtimezone=local`;
  const body = (await getJson(url, {
    "User-Agent": "Mozilla/5.0 (compatible; SolarchikWork/1.0; weather.gov timeseries)",
    Accept: "application/json",
    Origin: "https://www.weather.gov",
    Referer: `https://www.weather.gov/wrh/timeseries?site=${icao.toLowerCase()}`,
  })) as { STATION?: { OBSERVATIONS?: { air_temp_set_1?: unknown; date_time?: unknown } }[] } | null;
  const obs = body?.STATION?.[0]?.OBSERVATIONS;
  const temps = obs?.air_temp_set_1;
  const times = obs?.date_time;
  if (!Array.isArray(temps) || !Array.isArray(times)) return null;
  let max: number | null = null;
  for (let i = 0; i < temps.length; i++) {
    const t = Number(temps[i]);
    const stamp = String(times[i] ?? "");
    if (!stamp.startsWith(day) || !Number.isFinite(t)) continue;
    if (max == null || t > max) max = t;
  }
  return max;
}

async function forecastHigh(icao: string, unit: TempUnit, day: string): Promise<number | null> {
  const headers = { "User-Agent": UA, Accept: "application/geo+json" };
  const station = (await getJson(`https://api.weather.gov/stations/${encodeURIComponent(icao)}`, headers)) as {
    geometry?: { coordinates?: number[] };
  } | null;
  const coords = station?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lon, lat] = coords;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const points = (await getJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, headers)) as {
    properties?: { forecast?: string };
  } | null;
  const forecastUrl = points?.properties?.forecast;
  if (!forecastUrl || !forecastUrl.startsWith("https://api.weather.gov/")) return null;
  const forecast = (await getJson(forecastUrl, headers)) as {
    properties?: { periods?: { startTime?: string; isDaytime?: boolean; temperature?: number; temperatureUnit?: string }[] };
  } | null;
  const period = forecast?.properties?.periods?.find(
    (p) => p.isDaytime && String(p.startTime ?? "").slice(0, 10) === day && typeof p.temperature === "number",
  );
  if (!period || typeof period.temperature !== "number" || !Number.isFinite(period.temperature)) return null;
  const src = String(period.temperatureUnit ?? "").toUpperCase();
  let t = period.temperature;
  if (src.startsWith("F") && unit === "C") t = ((t - 32) * 5) / 9;
  if (src.startsWith("C") && unit === "F") t = (t * 9) / 5 + 32;
  return t;
}

function finiteTemp(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > -80 && n < 70 ? n : null;
}

function stampOnDay(stamp: string, day: string): boolean {
  const compact = stamp.replace(/[-:TZ. ]/g, "");
  return stamp.startsWith(day) || compact.startsWith(day.replace(/-/g, ""));
}

function harvestTemps(node: unknown, day: string, out: number[], depth: number): void {
  if (depth > 5 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) harvestTemps(item, day, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const row = node as Record<string, unknown>;
  const stamp = String(row.local_date_time_full ?? row.aifstime_utc ?? row.date_time ?? row.time ?? "");
  const temp = finiteTemp(row.air_temp ?? row.air_temp_set_1 ?? row.max_temp ?? row.maximum_air_temperature);
  if (stamp && stampOnDay(stamp, day) && temp != null) out.push(temp);
  for (const value of Object.values(row)) {
    if (value && typeof value === "object") harvestTemps(value, day, out, depth + 1);
  }
}

function pageHasDay(text: string, day: string): boolean {
  if (text.includes(day) || text.includes(day.replace(/-/g, ""))) return true;
  const [year, month, date] = day.split("-");
  if (!year || !month || !date) return false;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mon = months[Number(month) - 1];
  if (!mon) return false;
  const blob = text.toLowerCase();
  const dayNum = String(Number(date));
  return (
    blob.includes(`${dayNum} ${mon}`) ||
    blob.includes(`${mon} ${dayNum}`) ||
    blob.includes(`${date}/${month}/${year}`) ||
    blob.includes(`${dayNum}/${Number(month)}/${year}`)
  );
}

function labeledNumber(text: string, label: RegExp): number | null {
  const flags = label.flags.includes("i") ? "i" : "";
  const match = text.match(new RegExp(`${label.source}[^\\d-]{0,24}(-?\\d+(?:\\.\\d+)?)`, flags));
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > -80 && n < 140 ? n : null;
}

function unitNamed(text: string, unit: TempUnit, url: string): boolean {
  if (/bom\.gov\.au/i.test(url)) return unit === "C";
  const saysF = /fahrenheit|°\s*F\b|\bdeg\s*f\b/i.test(text);
  const saysC = /celsius|°\s*C\b|℃|\bdeg\s*c\b/i.test(text);
  if (unit === "F") return saysF;
  return saysC;
}

/** Official page or JSON named in the rules. No second service if this one is quiet. */
async function readLinkedSource(
  url: string,
  unit: TempUnit,
  day: string,
): Promise<{ forecastHigh: number | null; observedHigh: number | null }> {
  const empty = { forecastHigh: null, observedHigh: null };
  const text = await getText(url, {
    "User-Agent": UA,
    Accept: "application/json,text/html,text/plain,*/*",
  });
  if (!text) return empty;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const temps: number[] = [];
      harvestTemps(JSON.parse(trimmed) as unknown, day, temps, 0);
      const jsonOk = /bom\.gov\.au/i.test(url) ? unit === "C" : unitNamed(trimmed, unit, url);
      if (temps.length && jsonOk) return { forecastHigh: null, observedHigh: Math.max(...temps) };
    } catch {
      /* not JSON */
    }
  }
  if (!pageHasDay(text, day) || !unitNamed(text, unit, url)) return empty;
  return {
    forecastHigh: labeledNumber(text, /forecast(?:ed)?\s+(?:max(?:imum)?|high)/i),
    observedHigh: labeledNumber(text, /absolute\s+daily\s+max|highest\s+temperature|max(?:imum)?\s+temp(?:erature)?/i),
  };
}

function sourceLabel(url: string | undefined, station: string | null): string {
  if (station) return station;
  if (!url) return "rules";
  try {
    return new URL(url).hostname.replace(/^www\./, "").slice(0, 16);
  } catch {
    return "rules";
  }
}

function hoursUntilDayEnd(day: string, now: number): number {
  const end = Date.parse(`${day}T23:59:59Z`);
  if (!Number.isFinite(end)) return 0;
  return (end - now) / 3_600_000;
}

async function fetchEvent(slug: string): Promise<GammaEvent | null> {
  const body = await getJson(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`, {
    Accept: "application/json",
  });
  if (!Array.isArray(body) || !body[0]) return null;
  return body[0] as GammaEvent;
}

function bucketsFrom(event: GammaEvent, now: number): { buckets: TempBucket[]; description: string; unit: TempUnit | null; day: string } | null {
  const day = String(event.endDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const markets = event.markets ?? [];
  const description = markets.map((m) => String(m.description ?? "")).find((d) => d.length > 40) ?? "";
  const unit = tempUnitFrom(description, String(event.title ?? markets[0]?.question ?? ""));
  const hours = hoursUntilDayEnd(day, now);
  const buckets: TempBucket[] = [];
  for (const market of markets) {
    if (!market.acceptingOrders || !market.enableOrderBook || !market.question) continue;
    const label = String(market.groupItemTitle ?? "").trim();
    if (!label || !parseBucket(label)) continue;
    const tokens = parseList(market.clobTokenIds);
    const outcomes = parseList(market.outcomes);
    const yesI = outcomes.findIndex((o) => /^yes$/i.test(o.trim()));
    const tokenYes = tokens[yesI >= 0 ? yesI : 0];
    if (!tokenYes || !market.id) continue;
    buckets.push({
      id: String(market.id),
      question: String(market.question).slice(0, 180),
      bucket: label.slice(0, 40),
      tokenYes,
      hours,
      endDate: String(market.endDate ?? event.endDate ?? ""),
      feeRate: feeFromApi(market),
      feeType: market.feeType ? String(market.feeType) : null,
      negRisk: Boolean(market.negRisk),
      volume: Number(market.volume) || 0,
    });
  }
  return { buckets, description, unit, day };
}

export async function loadTempBoard(now: number, skip: readonly string[] = []): Promise<{ board: TempBoard } | { why: string }> {
  const held = new Set(skip);
  const today = utcDay(now, 0);
  const tomorrow = utcDay(now, 1);
  const raw = await getJson("https://gamma-api.polymarket.com/public-search?q=highest%20temperature&limit_per_type=20", {
    Accept: "application/json",
  });
  const events = (raw as { events?: GammaEvent[] } | null)?.events;
  if (!events) return { why: "Немає погодного ринку на 2 доби. Ордера немає." };
  const ranked = events
    .filter((e) => isTempQuestion(String(e.title ?? "")) && (String(e.endDate ?? "").slice(0, 10) === today || String(e.endDate ?? "").slice(0, 10) === tomorrow))
    .sort((a, b) => {
      const da = String(a.endDate).slice(0, 10) === today ? 0 : 1;
      const db = String(b.endDate).slice(0, 10) === today ? 0 : 1;
      return da - db;
    });
  if (!ranked.length) return { why: "Немає погодного ринку на 2 доби. Ордера немає." };

  let sawStation = false;
  let sawNoDigit = false;
  let sawPending = false;
  let sawEdge = false;
  let sawSplit = false;
  let sawNone = false;
  let sawHeld = false;
  for (const summary of ranked.slice(0, 8)) {
    const slug = String(summary.slug ?? "");
    if (!slug) continue;
    const full = await fetchEvent(slug);
    if (!full?.markets?.length) continue;
    const packed = bucketsFrom(full, now);
    if (!packed || !packed.buckets.length || !packed.unit) continue;
    if (packed.buckets.some((b) => held.has(b.tokenYes))) {
      sawHeld = true;
      continue;
    }
    const urls = resolutionUrls(packed.description);
    const kind = sourceKind(packed.description, urls);
    const station = extractStation(packed.description);
    if (!kind || (kind === "nws" && !station)) continue;
    sawStation = true;
    let observedHighV: number | null = null;
    let forecastHighV: number | null = null;
    if (kind === "nws") {
      [observedHighV, forecastHighV] = await Promise.all([
        observedHigh(station!, packed.unit, packed.day),
        forecastHigh(station!, packed.unit, packed.day),
      ]);
    } else {
      const url = kind === "bom" ? urls.find((item) => /bom\.gov\.au/i.test(item)) : urls[0];
      if (!url) {
        sawNoDigit = true;
        continue;
      }
      const read = await readLinkedSource(url, packed.unit, packed.day);
      observedHighV = read.observedHigh;
      forecastHighV = read.forecastHigh;
    }
    if (observedHighV == null && forecastHighV == null) {
      sawNoDigit = true;
      continue;
    }
    if (observedHighV == null) {
      sawPending = true;
      continue;
    }
    const labels = packed.buckets.map((b) => b.bucket);
    const observedHit = landingIndex(observedHighV, labels);
    if (observedHit === "edge") {
      sawEdge = true;
      continue;
    }
    if (observedHit === "none") {
      sawNone = true;
      continue;
    }
    const forecastHit = forecastHighV == null ? null : landingIndex(forecastHighV, labels);
    if (typeof forecastHit === "number" && forecastHit !== observedHit) {
      sawSplit = true;
      continue;
    }
    return {
      board: {
        station: sourceLabel(urls[0], station),
        unit: packed.unit,
        forecastHigh: forecastHighV,
        observedHigh: observedHighV,
        hit: observedHit,
        buckets: packed.buckets,
      },
    };
  }
  if (sawHeld && !sawStation) return { why: "Уже є ця ставка. Ордера немає." };
  if (!sawStation) return { why: "Немає станції в правилах. Ордера немає." };
  if (sawSplit) return { why: "Прогноз і знятий high розходяться. Ордера немає." };
  if (sawEdge) return { why: "Цифра на межі. Ордера немає." };
  if (sawNone) return { why: "Цифра не лягає в один бакет. Ордера немає." };
  if (sawPending) return { why: "Ще не знятий high. Ордера немає." };
  if (sawNoDigit) return { why: "Немає цифри станції. Ордера немає." };
  return { why: "Немає погодного ринку на 2 доби. Ордера немає." };
}
