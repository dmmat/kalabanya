/* =========================================================================
   КАЛАБАНЯ — balance analysis report
   Runs the simulator against a config and prints the diagnostics that matter
   for game feel. Usage:
     node sim/analyze.mjs            → analyse CURRENT (shipped) balance
     node sim/analyze.mjs proposed   → analyse PROPOSED rebalance
     node sim/analyze.mjs compare    → side-by-side CURRENT vs PROPOSED
   ========================================================================= */
import { CURRENT, freshRun, applyRunUpgrade, evapPerSec, sunPeak } from "./model.mjs";
import { PROPOSED } from "./proposed.mjs";
import { avgRun, progression } from "./sim.mjs";

const GROW = ["silt", "moss", "deepen", "vein", "lake", "trench", "widen"];
const SMALL = ["silt", "moss", "vein"]; // exploit: never grow maxWater

const META = {
  fresh: {},
  mid: { memory: 6, cold: 5, silver: 6, absorb: 5, roots: 4 },
  late: { memory: 12, cold: 10, silver: 12, absorb: 10, roots: 8, spring: 6, moon: 6, trees: 8 },
};

const n0 = (x, w = 6) => x.toFixed(0).padStart(w);
const n1 = (x, w = 6) => x.toFixed(1).padStart(w);

function report(C, label) {
  console.log(`\n================ ${label} ================`);

  console.log(`\n[1] SURVIVAL & ESSENCE per run (engaged player, grower strategy)`);
  console.log(`     meta     │ deathDay │ essence/run │ peakVol`);
  for (const [k, m] of Object.entries(META)) {
    const r = avgRun(m, C, { policy: "engaged", buyOrder: GROW, events: true });
    console.log(`     ${k.padEnd(8)} │ ${n1(r.deathDay)}   │ ${n0(r.essence, 9)}   │ ${n0(r.peakVol, 8)}`);
  }

  console.log(`\n[2] STRATEGY EXPLOIT: grow the puddle vs stay small (mid meta, engaged)`);
  const grow = avgRun(META.mid, C, { policy: "engaged", buyOrder: GROW, events: true });
  const small = avgRun(META.mid, C, { policy: "engaged", buyOrder: SMALL, events: true });
  console.log(`     grower   │ deathDay ${n1(grow.deathDay)} │ ess/run ${n0(grow.essence, 8)} │ peakVol ${n0(grow.peakVol, 9)}`);
  console.log(`     stay-tiny│ deathDay ${n1(small.deathDay)} │ ess/run ${n0(small.essence, 8)} │ peakVol ${n0(small.peakVol, 9)}`);
  const ratio = small.essence / grow.essence;
  console.log(`     → staying tiny yields ${(ratio * 100).toFixed(0)}% of grower essence with ${(small.peakVol / grow.peakVol * 100).toFixed(0)}% of the volume`);
  console.log(`       (if ≥~90%, growth is pointless → players exploit "stay small")`);

  console.log(`\n[3] CASUAL player survival (grower)`);
  for (const [k, m] of Object.entries(META)) {
    const r = avgRun(m, C, { policy: "casual", buyOrder: GROW, events: true });
    console.log(`     ${k.padEnd(8)} │ deathDay ${n1(r.deathDay)} │ ess/run ${n0(r.essence, 8)}`);
  }

  console.log(`\n[4] PROGRESSION: 40 runs from scratch (engaged grower)`);
  const prog = progression(C, { runs: 40, policy: "engaged", buyOrder: GROW, events: true });
  const milestones = [1, 5, 10, 20, 30, 40];
  console.log(`     run │ deathDay │ ess/run │ bank      │ lifetime`);
  for (const h of prog.history) {
    if (milestones.includes(h.run)) console.log(`     ${n0(h.run, 3)} │ ${n0(h.day, 8)} │ ${n0(h.ess, 7)} │ ${n0(h.bank, 9)} │ ${n0(h.life, 8)}`);
  }
  const prestigeRun = prog.history.find(h => h.life >= C.prestigeUnlock);
  const friend1 = prog.history.find(h => h.bank >= C.permaPrices[0]);
  console.log(`     → prestige unlock (${C.prestigeUnlock} lifetime ess): run ${prestigeRun ? prestigeRun.run : ">40"}`);
  console.log(`     → 1st permanent friend (${C.permaPrices[0]} ess banked): run ${friend1 ? friend1.run : ">40"}`);

  console.log(`\n[5] WARMING CLIFF: net water flow/s at peak sun (late meta, fully built puddle)`);
  // approximate a fully-built late puddle and measure flow at peak sun across days
  printWarming(C);
}

function printWarming(C) {
  // build a representative end-game puddle
  const g = freshRun(META.late, C);
  for (let i = 0; i < 12; i++) applyRunUpgrade(g, "deepen");
  for (let i = 0; i < 4; i++) applyRunUpgrade(g, "silt");
  for (let i = 0; i < 6; i++) applyRunUpgrade(g, "moss");
  for (let i = 0; i < 5; i++) applyRunUpgrade(g, "vein");
  for (let i = 0; i < 3; i++) applyRunUpgrade(g, "lake");
  for (let i = 0; i < 2; i++) applyRunUpgrade(g, "trench");
  g.weather = { rainPower: 0.05, sunMod: 0, absorbMod: 0, evapMod: 0, essMod: 0, tier: "norm" }; // mild/typical day
  console.log(`     (puddle maxVol≈${g.maxWater.toFixed(0)}, passive ${g.passive.toFixed(1)}/s, sunResist ${(g.sunResist * 100).toFixed(0)}%)`);
  console.log(`     day │ peakSun │ evap@peak │ passive │ net@peak`);
  for (const day of [5, 10, 15, 20, 25, 30, 40, 50]) {
    g.day = day;
    g.sun = sunPeak(day, C);
    const evap = evapPerSec(g, C);
    const net = g.passive + g.weather.rainPower - evap;
    console.log(`     ${n0(day, 3)} │ ${n0(g.sun, 7)} │ ${n1(evap, 9)} │ ${n1(g.passive, 7)} │ ${n1(net, 8)}${net < 0 ? "  ⚠ negative — must tap" : ""}`);
  }
}

const mode = process.argv[2] || "current";
if (mode === "compare") {
  report(CURRENT, "CURRENT (shipped)");
  report(PROPOSED, "PROPOSED (rebalance)");
} else if (mode === "proposed") {
  report(PROPOSED, "PROPOSED (rebalance)");
} else {
  report(CURRENT, "CURRENT (shipped)");
}
