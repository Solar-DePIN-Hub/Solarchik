import type { Locale } from "./i18n";

export type FwdRule = {
  id: string;
  iso: string;
  cc: string;
  on: string;
  off: string;
  check: string;
  nMode: "intl" | "nat";
  en: string;
  uk: string;
};

const GSM = { on: "**21*{n}#", off: "##21#", check: "*#21#", nMode: "intl" as const };
const STAR72 = { on: "*72{n}", off: "*73", check: "", nMode: "nat" as const };

function g(id: string, iso: string, cc: string, en: string, uk: string, extra: Partial<FwdRule> = {}): FwdRule {
  return { id, iso, cc, en, uk, ...GSM, ...extra };
}

export const FWD_COUNTRIES: FwdRule[] = [
  g("UA", "UA", "380", "Ukraine", "Україна"),
  g("PL", "PL", "48", "Poland", "Польща"),
  g("DE", "DE", "49", "Germany", "Німеччина"),
  g("GB", "GB", "44", "United Kingdom", "Велика Британія"),
  g("FR", "FR", "33", "France", "Франція"),
  g("ES", "ES", "34", "Spain", "Іспанія"),
  g("IT", "IT", "39", "Italy", "Італія"),
  g("PT", "PT", "351", "Portugal", "Португалія"),
  g("NL", "NL", "31", "Netherlands", "Нідерланди"),
  g("BE", "BE", "32", "Belgium", "Бельгія"),
  g("AT", "AT", "43", "Austria", "Австрія"),
  g("CH", "CH", "41", "Switzerland", "Швейцарія"),
  g("CZ", "CZ", "420", "Czechia", "Чехія"),
  g("SK", "SK", "421", "Slovakia", "Словаччина"),
  g("RO", "RO", "40", "Romania", "Румунія"),
  g("HU", "HU", "36", "Hungary", "Угорщина"),
  g("BG", "BG", "359", "Bulgaria", "Болгарія"),
  g("GR", "GR", "30", "Greece", "Греція"),
  g("IE", "IE", "353", "Ireland", "Ірландія"),
  g("SE", "SE", "46", "Sweden", "Швеція"),
  g("NO", "NO", "47", "Norway", "Норвегія"),
  g("DK", "DK", "45", "Denmark", "Данія"),
  g("FI", "FI", "358", "Finland", "Фінляндія"),
  g("LT", "LT", "370", "Lithuania", "Литва"),
  g("LV", "LV", "371", "Latvia", "Латвія"),
  g("EE", "EE", "372", "Estonia", "Естонія"),
  g("MD", "MD", "373", "Moldova", "Молдова"),
  g("BY", "BY", "375", "Belarus", "Білорусь"),
  g("RU", "RU", "7", "Russia", "Росія"),
  g("KZ", "KZ", "7", "Kazakhstan", "Казахстан"),
  g("TR", "TR", "90", "Turkey", "Туреччина"),
  g("IL", "IL", "972", "Israel", "Ізраїль"),
  g("AE", "AE", "971", "UAE", "ОАЕ"),
  g("IN", "IN", "91", "India", "Індія"),
  g("PK", "PK", "92", "Pakistan", "Пакистан"),
  g("BD", "BD", "880", "Bangladesh", "Бангладеш"),
  g("PH", "PH", "63", "Philippines", "Філіппіни"),
  g("ID", "ID", "62", "Indonesia", "Індонезія"),
  g("VN", "VN", "84", "Vietnam", "В’єтнам"),
  g("TH", "TH", "66", "Thailand", "Таїланд"),
  g("MY", "MY", "60", "Malaysia", "Малайзія"),
  g("SG", "SG", "65", "Singapore", "Сінгапур"),
  g("AU", "AU", "61", "Australia", "Австралія"),
  g("NZ", "NZ", "64", "New Zealand", "Нова Зеландія"),
  g("ZA", "ZA", "27", "South Africa", "ПАР"),
  g("NG", "NG", "234", "Nigeria", "Нігерія"),
  g("KE", "KE", "254", "Kenya", "Кенія"),
  g("EG", "EG", "20", "Egypt", "Єгипет"),
  g("MA", "MA", "212", "Morocco", "Марокко"),
  g("BR", "BR", "55", "Brazil", "Бразилія"),
  g("MX", "MX", "52", "Mexico", "Мексика"),
  g("AR", "AR", "54", "Argentina", "Аргентина"),
  g("CL", "CL", "56", "Chile", "Чилі"),
  g("CO", "CO", "57", "Colombia", "Колумбія"),
  g("PE", "PE", "51", "Peru", "Перу"),
  g("JP", "JP", "81", "Japan", "Японія"),
  g("KR", "KR", "82", "South Korea", "Південна Корея"),
  g("CN", "CN", "86", "China", "Китай"),
  g("TW", "TW", "886", "Taiwan", "Тайвань"),
  g("HK", "HK", "852", "Hong Kong", "Гонконг"),
  g("US", "US", "1", "United States (GSM)", "США (GSM)"),
  g("US72", "US", "1", "United States (*72)", "США (*72)", STAR72),
  g("CA", "CA", "1", "Canada (GSM)", "Канада (GSM)"),
  g("CA72", "CA", "1", "Canada (*72)", "Канада (*72)", STAR72),
];

const BY_ID = new Map(FWD_COUNTRIES.map((c) => [c.id, c]));

export function fwdName(c: FwdRule, locale: Locale): string {
  return locale === "uk" ? c.uk : c.en;
}

export function defaultFwdId(locale: Locale): string {
  if (locale === "uk") return "UA";
  if (locale === "de") return "DE";
  if (locale === "es") return "ES";
  if (locale === "pt") return "BR";
  if (locale === "ja") return "JP";
  return "US";
}

export function readFwdId(raw: unknown, locale: Locale): string {
  const s = typeof raw === "string" ? raw : "";
  return BY_ID.has(s) ? s : defaultFwdId(locale);
}

export function fwdRule(id: string, locale: Locale = "en"): FwdRule {
  return BY_ID.get(id) || BY_ID.get(defaultFwdId(locale))!;
}

export function fwdDigits(raw: string, rule: FwdRule): string {
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("0")) s = s.slice(1);
  if (rule.nMode === "nat") {
    if (s.startsWith(rule.cc)) s = s.slice(rule.cc.length);
    if (rule.cc === "1" && s.length === 11 && s.startsWith("1")) s = s.slice(1);
    return s;
  }
  if (s.startsWith(rule.cc)) return s;
  return `${rule.cc}${s}`;
}

export function fillUssd(tpl: string, digits: string): string {
  if (!tpl) return "";
  return tpl.replace(/\{n\}/g, digits);
}

export function ussdOnFor(raw: string, id: string, locale: Locale = "en"): string {
  const rule = fwdRule(id, locale);
  const d = fwdDigits(raw, rule);
  if (d.length < 6) return "";
  return fillUssd(rule.on, d);
}

export function ussdOffFor(id: string, locale: Locale = "en"): string {
  return fwdRule(id, locale).off;
}

export function sortedFwd(locale: Locale): FwdRule[] {
  return [...FWD_COUNTRIES].sort((a, b) => {
    if (a.id === defaultFwdId(locale)) return -1;
    if (b.id === defaultFwdId(locale)) return 1;
    return fwdName(a, locale).localeCompare(fwdName(b, locale), locale === "uk" ? "uk" : "en");
  });
}
