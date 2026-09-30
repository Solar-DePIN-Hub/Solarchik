import type { Locale } from "./i18n";
import type { PetVibe } from "./pet";
import type { ChapterId, Ev, RunState } from "./sim";

export type BanterKind = "go" | "chapter" | "combo" | "gold" | "hurt" | "dead" | "bonus" | "grind" | "shield" | "boss";

const FALLBACK: Locale = "en";

const LINES: Record<Locale, Record<BanterKind, string[]>> = {
  en: {
    go: ["Let's go. I'm with you on the roofs.", "Start jumping. I've got your back."],
    chapter: ["New rooftops ahead. Watch your step.", "The roofs changed. Stay steady."],
    combo: ["Nice streak. Keep that pace.", "Good rhythm. Don't rush the next jump."],
    gold: ["You caught a gold sun. Well done."],
    hurt: ["Careful. You still have hearts left.", "That hit hurt. Jump a little earlier."],
    dead: ["That's okay. We can run it again.", "We fell. Take a breath, then retry."],
    bonus: ["We're flying. Grab the suns."],
    grind: ["Nice grind on the wire. Keep balanced."],
    shield: ["Shield is on. You can take one hit."],
    boss: ["Big one ahead. Jump and stomp it."],
  },
  uk: {
    go: ["Поїхали. Я з тобою на дахах.", "Починай стрибати. Я поруч."],
    chapter: ["Нові дахи попереду. Дивись під ноги.", "Дахи змінились. Тримай рівновагу."],
    combo: ["Гарний темп. Тримай його.", "Добрий ритм. Не поспішай наступний стрибок."],
    gold: ["Золоте сонце. Гарна робота."],
    hurt: ["Обережно. Ще є серця.", "Вдарило. Стрибай трохи раніше."],
    dead: ["Нічого. Можемо пробігти ще раз.", "Впали. Переведи подих і ще раз."],
    bonus: ["Летимо. Збирай жовті сонця."],
    grind: ["Гарний слайд по дроту. Тримай баланс."],
    shield: ["Щит увімкнений. Можна витримати один удар."],
    boss: ["Великий попереду. Стрибни і натисни зверху."],
  },
  es: {
    go: ["Vamos. Estoy contigo en los techos.", "Empieza a saltar. Te cubro."],
    chapter: ["Techos nuevos. Mira el suelo.", "Cambiaron los techos. Ve con calma."],
    combo: ["Buen ritmo. Sigue así.", "Buena racha. No te apresures."],
    gold: ["Sol de oro. Muy bien."],
    hurt: ["Cuidado. Aún tienes corazones.", "Ese golpe dolió. Salta un poco antes."],
    dead: ["No pasa nada. Podemos repetir.", "Caímos. Respira y otra vez."],
    bonus: ["Estamos volando. Toma los soles."],
    grind: ["Buen grind. Mantén el equilibrio."],
    shield: ["Escudo puesto. Aguantas un golpe."],
    boss: ["Uno grande. Salta y písalo."],
  },
  pt: {
    go: ["Bora. Estou com você nos telhados.", "Começa a pular. Estou aqui."],
    chapter: ["Telhados novos. Olha o chão.", "Os telhados mudaram. Vai com calma."],
    combo: ["Bom ritmo. Mantém.", "Boa sequência. Sem pressa no próximo pulo."],
    gold: ["Sol de ouro. Mandou bem."],
    hurt: ["Cuidado. Ainda tem corações.", "Doce. Pula um pouco mais cedo."],
    dead: ["Tudo bem. Dá pra tentar de novo.", "Caímos. Respira e outra vez."],
    bonus: ["Estamos voando. Pega os sóis."],
    grind: ["Bom grind no fio. Equilíbrio."],
    shield: ["Escudo ligado. Aguenta um hit."],
    boss: ["Um grande na frente. Pula e pisa."],
  },
  de: {
    go: ["Los. Ich bin bei dir auf den Dächern.", "Spring. Ich passe auf."],
    chapter: ["Neue Dächer. Schau auf den Schritt.", "Die Dächer wechseln. Bleib ruhig."],
    combo: ["Gutes Tempo. Halt das.", "Schöner Lauf. Nicht hetzen."],
    gold: ["Goldsonne. Gut gemacht."],
    hurt: ["Vorsicht. Du hast noch Herzen.", "Das hat getroffen. Spring etwas früher."],
    dead: ["Ist okay. Wir laufen nochmal.", "Gefallen. Kurz atmen, dann neu."],
    bonus: ["Wir fliegen. Nimm die Sonnen."],
    grind: ["Schöner Grind. Halte das Gleichgewicht."],
    shield: ["Schild an. Ein Treffer geht."],
    boss: ["Ein Großer. Spring und stampfe."],
  },
  ja: {
    go: ["いくよ。屋根の上、一緒にいる。", "跳んで。そばにいる。"],
    chapter: ["新しい屋根だ。足元を見て。", "屋根が変わった。落ち着いて。"],
    combo: ["いいペース。そのままで。", "いい流れ。次は焦らないで。"],
    gold: ["金の太陽。上手い。"],
    hurt: ["気をつけて。ハートはまだある。", "当たった。少し早く跳んで。"],
    dead: ["大丈夫。もう一回いける。", "落ちた。息して、再挑戦。"],
    bonus: ["飛んでる。太陽を取って。"],
    grind: ["いいグラインド。バランスを。"],
    shield: ["シールドオン。一回は耐える。"],
    boss: ["大きいのが来る。跳んで踏んで。"],
  },
};

const CHAPTER: Record<Locale, Partial<Record<ChapterId, string[]>>> = {
  en: {
    village: ["Village roofs now. Watch the chimneys."],
    storm: ["Storm line. Slide under the drones."],
    night: ["Night farm. Follow the lights."],
    serpent: ["The long roof. Stay with it."],
  },
  uk: {
    village: ["Зараз сільські дахи. Стеж за коминами."],
    storm: ["Штормова лінія. Слайд під дронів."],
    night: ["Нічна ферма. Тримайся світла."],
    serpent: ["Довгий дах. Не збавляй ходу."],
  },
  es: {
    village: ["Techos del pueblo. Cuidado con las chimeneas."],
    storm: ["Línea de tormenta. Desliza bajo los drones."],
    night: ["Granja de noche. Sigue las luces."],
    serpent: ["El techo largo. Sigue firme."],
  },
  pt: {
    village: ["Telhados da vila. Cuidado com as chaminés."],
    storm: ["Linha da tempestade. Desliza sob os drones."],
    night: ["Fazenda à noite. Segue as luzes."],
    serpent: ["Telhado longo. Mantém o ritmo."],
  },
  de: {
    village: ["Dorfdächer. Achtung Schornsteine."],
    storm: ["Sturmlinie. Unter die Drohnen rutschen."],
    night: ["Nachtfarm. Folge den Lichtern."],
    serpent: ["Langes Dach. Bleib dran."],
  },
  ja: {
    village: ["村の屋根だ。煙突に注意。"],
    storm: ["嵐のライン。ドローンの下を滑って。"],
    night: ["夜の農場。光をたどって。"],
    serpent: ["長い屋根。ペースを保って。"],
  },
};

let lastLine = "";

function pool(locale: Locale, kind: BanterKind, _vibe: PetVibe, chapter?: ChapterId): string[] {
  const pack = LINES[locale] || LINES[FALLBACK];
  let out = pack[kind] || LINES.en[kind];
  if (kind === "chapter" && chapter) {
    const extra = (CHAPTER[locale] || CHAPTER.en)[chapter];
    if (extra?.length) out = extra;
  }
  return out;
}

export function pickBanter(kind: BanterKind, locale: Locale, vibe: PetVibe, chapter?: ChapterId): string {
  const list = pool(locale, kind, vibe, chapter).filter((s) => s && s !== lastLine);
  const src = list.length ? list : pool(locale, kind, vibe, chapter);
  const line = src[Math.floor(Math.random() * src.length)] || "";
  lastLine = line;
  return line;
}

export function eventToBanter(ev: Ev): BanterKind | null {
  if (ev === "dead") return "dead";
  return null;
}

export function runContext(s: RunState): string {
  return `${Math.round(s.distance / 10)}m ${s.chapter} combo ${s.combo} suns ${s.suns} hearts ${s.hearts}`;
}

export function periodicKind(s: RunState): BanterKind {
  if (s.bonus) return "bonus";
  if (s.combo >= 4) return "combo";
  if (s.hearts <= 1) return "hurt";
  return "chapter";
}
