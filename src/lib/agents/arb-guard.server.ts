import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

/** Server-side arb fire cap. Not the browser credit ledger. */
const DAY_CAP_SOL = 0.02;
const MIN_GAP_MS = 30_000;
const LEDGER_URL = new URL("../../../server/arb-fire-ledger.json", import.meta.url);

type Ledger = { day: string; spent: number; lastAt: number };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readLedger(): Ledger {
  const empty = { day: today(), spent: 0, lastAt: 0 };
  if (!existsSync(LEDGER_URL)) return empty;
  try {
    const raw = JSON.parse(readFileSync(LEDGER_URL, "utf8")) as Partial<Ledger>;
    if (raw.day !== today()) return empty;
    return {
      day: today(),
      spent: typeof raw.spent === "number" && raw.spent > 0 ? raw.spent : 0,
      lastAt: typeof raw.lastAt === "number" ? raw.lastAt : 0,
    };
  } catch {
    return empty;
  }
}

function writeLedger(row: Ledger) {
  writeFileSync(LEDGER_URL, JSON.stringify(row), { mode: 0o600 });
}

/** Client credit is ignored. The secret never leaves the server. */
export function assertArbFire(ticket: string): { ok: true } | { ok: false; reason: string } {
  const secret = (process.env.ARB_FIRE_SECRET || "").trim();
  if (secret.length < 16) return { ok: false, reason: "Каса не озброєна." };
  const given = Buffer.from(ticket);
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: "Каса не озброєна." };
  const ledger = readLedger();
  if (Date.now() - ledger.lastAt < MIN_GAP_MS) return { ok: false, reason: "Зачекай. Ліміт каси." };
  if (ledger.spent + 1e-9 >= DAY_CAP_SOL) return { ok: false, reason: "Денний ліміт каси." };
  return { ok: true };
}

export function noteArbFire(sol: number) {
  const ledger = readLedger();
  const spent = Math.round((ledger.spent + (sol > 0 ? sol : 0)) * 1e9) / 1e9;
  writeLedger({ day: today(), spent, lastAt: Date.now() });
}
