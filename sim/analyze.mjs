/* =========================================================================
   КАЛАБАНЯ — balance report (runs the REAL game via sim/run.mjs).

   Reports survival + economy on the LIVE balance (src/game/*), and a
   "BALANCE ISSUES" section that flags what breaks the game: immortal /
   runaway runs, NaN, dead (never-bought) upgrades, dominant strategies.

   Run:  npm run sim           (full report)
         node sim/analyze.mjs --quick   (fewer trials, faster)
   To test a tweak: edit src/game/balance.js → rerun. Numbers come from there.
   ========================================================================= */
import { simRun, avgRun, progression, BUY_GROW, BUY_SMALL } from "./run.mjs";
import { RUN_UPGRADES, META_UPGRADES, PRESTIGE_UNLOCK, evapPerSec, freshRun } from "../src/game/balance.js";
import { sunPeak } from "../src/game/engine.js";
import { PERMA_FRIENDS } from "../src/game/characters.js";

const QUICK = process.argv.includes("--quick");
const TRIALS = QUICK ? 8 : 24;

const fnum = (n) => {
  if (!Number.isFinite(n)) return "∞";
  const a = Math.abs(n);
  if (a >= 1e15) return n.toExponential(1);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + "Б";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "М";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "к";
  return Math.round(n).toString();
};
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const pct = (x) => (x * 100).toFixed(0) + "%";

const META = {
  fresh: {},
  mid: { memory: 6, cold: 4, silver: 5, spring: 3, roots: 3, absorb: 4, moon: 2, trees: 3 },
  late: { memory: 12, cold: 10, silver: 12, spring: 8, roots: 8, absorb: 10, moon: 8, trees: 12,
    swift: 6, wellspring: 5, permafrost: 4, golddrop: 5, deeproots: 4, thirst: 4, best: 12 },
};

console.log("\n=================== КАЛАБАНЯ · BALANCE (live balance.js) ===================");

console.log("\n[1] SURVIVAL & ESSENCE  (engaged player, growth strategy, medians)");
console.log("    meta   │ deathDay │ ess/run │ peakVol │ immortal │ runaway");
const tier1 = {};
for (const k of ["fresh", "mid", "late"]) {
  const r = avgRun(META[k], { policy: "engaged", buyOrder: BUY_GROW }, TRIALS);
  tier1[k] = r;
  console.log(`    ${pad(k, 6)} │ ${padL(r.deathDay.toFixed(0), 7)}  │ ${padL(fnum(r.essence), 6)}  │ ${padL(fnum(r.peakVol), 6)}  │ ${padL(pct(r.immortalRate), 7)}  │ ${padL(pct(r.runawayRate), 6)}`);
}

console.log("\n[2] STRATEGY: grow the puddle vs stay small  (mid meta, engaged)");
const grow = avgRun(META.mid, { policy: "engaged", buyOrder: BUY_GROW }, TRIALS);
const small = avgRun(META.mid, { policy: "engaged", buyOrder: BUY_SMALL }, TRIALS);
console.log(`    grower    │ day ${grow.deathDay.toFixed(0)} │ ess ${fnum(grow.essence)} │ vol ${fnum(grow.peakVol)} │ immortal ${pct(grow.immortalRate)}`);
console.log(`    stay-tiny │ day ${small.deathDay.toFixed(0)} │ ess ${fnum(small.essence)} │ vol ${fnum(small.peakVol)} │ immortal ${pct(small.immortalRate)}`);

console.log("\n[3] CASUAL player survival (growth strategy)");
const cas = {};
for (const k of ["fresh", "mid", "late"]) {
  const r = avgRun(META[k], { policy: "casual", buyOrder: BUY_GROW }, TRIALS);
  cas[k] = r;
  console.log(`    ${pad(k, 6)} │ day ${padL(r.deathDay.toFixed(0), 3)} │ ess ${padL(fnum(r.essence), 6)} │ immortal ${pct(r.immortalRate)}`);
}

console.log("\n[4] PROGRESSION: 40 runs from scratch (engaged grower, prestige on)");
const prog = progression({ runs: 40, policy: "engaged", buyOrder: BUY_GROW, prestige: true });
console.log("    run │ day │ ess/run │ bank   │ lifetime │ asc");
for (const h of prog.history) if ([1, 5, 10, 20, 30, 40].includes(h.run))
  console.log(`    ${padL(h.run, 3)} │ ${padL(h.day, 3)} │ ${padL(fnum(h.ess), 6)} │ ${padL(fnum(h.bank), 6)} │ ${padL(fnum(h.life), 7)} │ ${padL(h.asc, 3)}`);
const presRun = prog.history.find(h => h.life >= PRESTIGE_UNLOCK);
const friend1 = prog.history.find(h => h.ess >= PERMA_FRIENDS[0].cost);
console.log(`    → prestige unlock (${fnum(PRESTIGE_UNLOCK)} lifetime ess): run ${presRun ? presRun.run : ">40"}`);
console.log(`    → 1st run earning ≥ a perma-friend (${fnum(PERMA_FRIENDS[0].cost)}): run ${friend1 ? friend1.run : ">40"}`);

console.log("\n[5] WARMING CLIFF: net water/s at peak sun (mid meta, fully-built puddle)");
{
  const g = freshRun(META.mid);
  for (const u of RUN_UPGRADES) for (let i = 0; i < 6; i++) { const lv = g.levels[u.id] || 0; g.levels[u.id] = lv + 1;
    if (u.id === "deepen") { g.maxWater += Math.max(50 + lv * 10, Math.round(g.maxWater * 0.05)); g.deepenMult *= 0.97; }
    if (u.id === "silt") g.sunResist = Math.min(0.85, g.sunResist + 0.08);
    if (u.id === "vein") g.passive += 0.4; if (u.id === "lake") { g.maxWater += Math.round(g.maxWater * 0.08); g.passive += 0.7; }
    if (u.id === "trench") { g.maxWater += Math.round(g.maxWater * 0.08); g.passive += 1.5; } if (u.id === "moss") g.mossMult *= 0.93; }
  console.log(`    (puddle vol≈${fnum(g.maxWater)}, passive ${g.passive.toFixed(1)}/s, sunResist ${pct(g.sunResist)})`);
  console.log("    day │ peakSun │ evap/s │ passive │ net/s");
  for (const day of [5, 10, 15, 20, 30, 50]) {
    g.day = day; g.sun = sunPeak(day); g.weather = { sunMod: 0, evapMod: 0, rainPower: 0, essMod: 0, absorbMod: 0 };
    const evap = evapPerSec(g); const net = g.passive - evap;
    console.log(`    ${padL(day, 3)} │ ${padL(g.sun.toFixed(0), 7)} │ ${padL(evap.toFixed(1), 6)} │ ${padL(g.passive.toFixed(1), 7)} │ ${padL(net.toFixed(1), 6)}${net < 0 ? "  ⚠ must tap" : ""}`);
  }
}

// ---------- BALANCE ISSUES ----------
console.log("\n=================== ⚠  BALANCE ISSUES ===================");
const issues = [];

const worstImmortal = Math.max(tier1.fresh.immortalRate, tier1.mid.immortalRate, tier1.late.immortalRate);
if (worstImmortal > 0.02)
  issues.push(`IMMORTALITY: up to ${pct(worstImmortal)} of engaged-grower runs never die (reach day-cap / runaway).\n     Cause: water buffer scales with volume^1 but warming with volume^0.45, so a fast-growing\n     puddle drains slower relative to its size → growth can outrun warming. Raise warmSizeExp in\n     balance.js (warmingDrain) toward ~1.0, or cap event volume gains (aw fracs).`);
if (tier1.late.runawayRate > 0 || tier1.mid.runawayRate > 0)
  issues.push(`RUNAWAY VOLUME: some runs explode past 1e12 (geometric growth from %-of-volume events).`);

let nanSeen = 0;
for (let s = 0; s < 30; s++) { const r = simRun(META.late, { seed: 99 + s }); if (r.stat.nan) nanSeen++; }
if (nanSeen) issues.push(`NaN/Infinity: ${nanSeen}/30 late-meta runs produced non-finite state (would softlock the game).`);

const boughtCount = {};
for (const u of RUN_UPGRADES) boughtCount[u.id] = 0;
for (let s = 0; s < 30; s++) { const r = simRun(META.mid, { policy: "engaged", buyOrder: BUY_GROW, seed: 7 + s }); for (const id in r.levels) if (r.levels[id] > 0) boughtCount[id]++; }
const deadRun = RUN_UPGRADES.filter(u => u.id !== "summon" && boughtCount[u.id] === 0).map(u => u.nm);
if (deadRun.length) issues.push(`DEAD run-upgrades (never bought in 30 grower runs): ${deadRun.join(", ")}`);

// read meta from a NON-prestige progression (prestige wipes gifts → false "dead" reading)
const progNP = progression({ runs: 40, policy: "engaged", buyOrder: BUY_GROW, prestige: false });
const deadMeta = META_UPGRADES.filter(u => (progNP.meta[u.id] || 0) === 0 && (!u.req || u.req(progNP.meta))).map(u => u.nm);
if (deadMeta.length) issues.push(`META gifts never bought in 40 runs (too dear / locked / low priority): ${deadMeta.join(", ")}`);

if (!issues.length) console.log("  (none detected by the current policies)");
else issues.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log("");
