import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D7_MS,
  FEE_WINDOW_CAP,
  H48_MS,
  activateWindow,
  grantStreakRewards,
  grantWindow,
  readWindows,
  windowsCover,
  type FeeWindow,
} from "./fee-windows.ts";
import { feeCovered, planFee } from "../agents/fee-ledger.ts";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 9, 1, 9, 0, 0);

function win(over: Partial<FeeWindow>): FeeWindow {
  return { id: "x", kind: "h48", milestone: 7, status: "available", grantedAt: t0, startedAt: 0, endsAt: 0, ...over };
}

describe("fee window coverage", () => {
  const spent = win({ id: "h48-1-2026-10-01", status: "spent", startedAt: t0, endsAt: t0 + H48_MS });
  const active = win({ id: "d7-30-2026-10-10", kind: "d7", status: "active", startedAt: t0 + 10 * DAY, endsAt: t0 + 10 * DAY + D7_MS });

  it("a trade opened inside a spent window is still fee-free", () => {
    assert.equal(windowsCover([spent, active], t0 + DAY), true);
    assert.equal(feeCovered([spent], t0 + H48_MS - 1), true);
  });
  it("start is inclusive, end exclusive", () => {
    assert.equal(windowsCover([spent], t0), true);
    assert.equal(windowsCover([spent], t0 + H48_MS), false);
    assert.equal(windowsCover([spent], t0 - 1), false);
  });
  it("active window covers; gaps and unactivated windows do not", () => {
    assert.equal(windowsCover([spent, active], t0 + 11 * DAY), true);
    assert.equal(windowsCover([spent, active], t0 + 5 * DAY), false);
    assert.equal(windowsCover([win({ status: "available" })], t0 + 1), false);
    assert.equal(windowsCover([spent], 0), false);
  });
  it("expiry keeps startedAt/endsAt, so a position closed after the end stays free", () => {
    const rows = activateWindow([win({ id: "h48-1-2026-10-01" })], t0);
    const openedAt = t0 + H48_MS - 60_000;
    const later = activateWindow(rows, t0 + H48_MS + DAY); // expires the first, nothing else to start
    assert.equal(later[0]?.status, "spent");
    assert.equal(later[0]?.startedAt, t0);
    const row = planFee({ id: "f", agent: "a", tier: "free", openedAt, closedAt: t0 + H48_MS + DAY, pnl: 1, paper: false, covered: feeCovered(later, openedAt) });
    assert.equal(row.reason, "window");
    const charged = planFee({ id: "g", agent: "a", tier: "free", openedAt: t0 + H48_MS + 1, closedAt: t0 + 3 * DAY, pnl: 1, paper: false, covered: feeCovered(later, t0 + H48_MS + 1) });
    assert.equal(charged.reason, "unsent");
  });
});

describe("reward ids", () => {
  it("ids carry the UTC grant day", () => {
    const a = grantStreakRewards([], { seven: 7, thirty: 30 }, t0);
    assert.deepEqual(a.rows.map((w) => w.id), ["h48-1-2026-10-01", "d7-30-2026-10-01"]);
    assert.equal(a.seven, 0);
  });
  it("a second 30-day run after a broken streak grants a new d7", () => {
    const first = grantStreakRewards([], { seven: 0, thirty: 30 }, t0).rows;
    const later = t0 + 45 * DAY;
    const second = grantStreakRewards(first, { seven: 0, thirty: 30 }, later).rows;
    assert.equal(second.filter((w) => w.kind === "d7").length, 2);
    assert.equal(second[1]?.id, "d7-30-2026-11-15");
  });
  it("old saved ids stay valid and never block new ones", () => {
    const old = readWindows([{ id: "d7-30", kind: "d7", milestone: 30, status: "spent", grantedAt: 1, startedAt: 1, endsAt: 2 }]);
    assert.equal(old[0]?.id, "d7-30");
    const next = grantStreakRewards(old, { seven: 0, thirty: 30 }, t0).rows;
    assert.deepEqual(next.map((w) => w.id), ["d7-30", "d7-30-2026-10-01"]);
  });
  it("same day is granted once", () => {
    const once = grantStreakRewards([], { seven: 0, thirty: 30 }, t0).rows;
    const twice = grantStreakRewards(once, { seven: 0, thirty: 30 }, t0 + 3_600_000).rows;
    assert.equal(twice.length, 1);
    assert.equal(grantWindow(once, { id: once[0]!.id, kind: "d7", milestone: 30, now: t0 }), once);
  });
  it("UTC day, not local", () => {
    const lateUtc = Date.UTC(2026, 9, 1, 23, 30, 0);
    assert.equal(grantStreakRewards([], { seven: 0, thirty: 60 }, lateUtc).rows[0]?.id, "d7-60-2026-10-01");
  });
  it("h48 numbers keep counting after old rows are trimmed", () => {
    let rows: FeeWindow[] = [];
    for (let i = 0; i < FEE_WINDOW_CAP + 5; i++) {
      rows = grantStreakRewards(rows, { seven: 7, thirty: 1 }, t0 + i * 7 * DAY).rows;
      rows = activateWindow(rows, t0 + i * 7 * DAY);
      rows = activateWindow(rows, t0 + i * 7 * DAY + H48_MS + 1);
    }
    assert.ok(rows.length <= FEE_WINDOW_CAP);
    const last = rows[rows.length - 1]!;
    assert.match(last.id, new RegExp(`^h48-${FEE_WINDOW_CAP + 5}-\\d{4}-\\d{2}-\\d{2}$`));
  });
  it("cap keeps available/active rows and the newest spent ones on load", () => {
    const raw = [
      ...Array.from({ length: 30 }, (_, i) => win({ id: `s${i}`, status: "spent", startedAt: i + 1, endsAt: 1000 + i })),
      win({ id: "fresh", status: "available" }),
    ];
    const rows = readWindows(raw);
    assert.equal(rows.length, FEE_WINDOW_CAP);
    assert.ok(rows.some((w) => w.id === "fresh"), "a new reward is never dropped at the cap");
    assert.ok(rows.some((w) => w.id === "s29"));
    assert.ok(!rows.some((w) => w.id === "s0"));
  });
});
