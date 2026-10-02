import { createRun, step, type DayMod } from "./sim";

function daySeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const out: any = { cases: [] };
const seeds = [daySeed("2026-10-02"), 12345, 1, daySeed("2026-01-15")];
const mods: DayMod[] = ["calm", "wind", "gold", "drones", "wire"];
for (const seed of seeds) for (const mod of mods) for (const bonus of [false, true]) {
  if (bonus && mod !== "calm") continue;
  const s = createRun(seed, { mod, offerBonus: bonus });
  const c: any = {
    seed, mod, bonus,
    plats: s.plats.map((p) => [r3(p.x), r3(p.y), r3(p.w), p.kind]),
    picks: s.picks.map((p) => [r3(p.x), r3(p.y), p.gold ? 1 : 0, p.shield ? 1 : 0, p.portal ? 1 : 0]),
    enemies: s.enemies.map((e) => [e.kind, r3(e.x), r3(e.y), r3(e.vx), r3(e.t)]),
    trace: [],
  };
  let st = s;
  for (let i = 0; i < 4000; i++) {
    const k = i % 47;
    const input = { jumpPressed: k === 0 || (i % 113 === 5), jumpHeld: k < 18, slidePressed: i % 211 === 100, slideHeld: i % 211 >= 100 && i % 211 < 130 };
    const res = step(st, 1 / 60, input);
    st = res.state;
    if (i % 25 === 0 || res.events.length) {
      c.trace.push([i, r3(st.x), r3(st.y), r3(st.vy), st.hearts, r3(st.score), st.suns, st.phase, st.combo, st.shield, st.grounded ? 1 : 0, st.bonus ? 1 : 0, res.events.join(","), st.plats.length, st.picks.length, st.enemies.length]);
    }
  }
  out.cases.push(c);
}
console.log(JSON.stringify(out));
