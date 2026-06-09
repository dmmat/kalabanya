/* =========================================================================
   КАЛАБАНЯ — balance simulator

   Drives model.mjs with realistic player POLICIES to answer:
     • Survival curve: how deep (which day) can a player reach at a given
       meta-progression level?  Where is the difficulty cliff?
     • Economy curve: essence per run over progression → are prices
       (meta upgrades, permanent friends) reachable in a sane number of runs?
     • Are any upgrades dead (never worth buying) or dominant?

   Run:  node sim/sim.mjs            (current vs proposed summary)
         node sim/sim.mjs --verbose  (per-day detail)
   ========================================================================= */
import {
  CURRENT, freshRun, evapPerSec, effEss, runCost, metaCost, applyRunUpgrade,
  rollWeather, sunPeak, sunCurve, warmingDrain, mulberry32, clamp, essCollect, dayBonus,
} from "./model.mjs";
import { PROPOSED } from "./proposed.mjs";

// ---------- player policies ----------
const POLICIES = {
  engaged: { tapsPerSec: 4.0, topUpAt: 0.96, buyFloor: 0.45, buyEvery: 1.0, dangerRespin: true },
  casual:  { tapsPerSec: 1.1, topUpAt: 0.80, buyFloor: 0.60, buyEvery: 2.0, dangerRespin: true },
};

// run-upgrade purchase priority (survival-first, then growth)
const BUY_ORDER = ["silt", "moss", "deepen", "vein", "lake", "trench", "widen"];

function canBuy(id, g) {
  if (id === "lake") return g.levels.deepen >= 3;
  if (id === "trench") return (g.levels.lake || 0) >= 2;
  return true;
}

function tryBuy(g, C, policy, order) {
  // buy greedily down the priority list while keeping a water buffer
  let bought = true;
  while (bought) {
    bought = false;
    for (const id of (order || BUY_ORDER)) {
      if (!canBuy(id, g)) continue;
      const cost = runCost(id, g.levels[id], g.maxWater, C);
      if (g.water - cost >= g.maxWater * policy.buyFloor) {
        g.water -= cost;
        applyRunUpgrade(g, id, C);
        bought = true;
        break;
      }
    }
  }
}

function tapTick(g, C, policy, dt) {
  if (g.water >= g.maxWater * policy.topUpAt) return; // topped up → let soil refill
  const desired = policy.tapsPerSec * dt;
  const taps = Math.min(desired, g.soil / C.soilDrain);
  if (taps <= 0) return;
  const boost = g.absorbBoostT > 0 ? C.absorbBoost : 1;
  const wb = 1 + g.weather.absorbMod;
  const amt = taps * C.absorbBase * g.absorbMult * boost * wb;
  g.water = Math.min(g.water + amt, g.maxWater);
  g.soil -= taps * C.soilDrain;
}

function simulateDay(g, C, dayLen, policy, rng, opt) {
  const dt = C.dt;
  const ticks = Math.round(dayLen / dt);
  const peak = sunPeak(g.day, C);
  let buyAccum = 0;
  let eventAccum = 0;
  for (let i = 0; i < ticks; i++) {
    const t = g.elapsed / dayLen;
    g.sun = Math.max(6, peak * sunCurve(t, C));
    g.shadeT = Math.max(0, g.shadeT - dt);
    g.evapBoostT = Math.max(0, g.evapBoostT - dt);
    g.absorbBoostT = Math.max(0, g.absorbBoostT - dt);
    g.soil = clamp(g.soil + g.soilRegen * dt, 0, g.soilMax);
    const evap = evapPerSec(g, C);
    g.water = Math.min(g.water + (g.passive + g.weather.rainPower - evap) * dt, g.maxWater);
    g.pending += essCollect(g, C) * effEss(g) * dt;
    tapTick(g, C, policy, dt);
    // approximate event essence stream (~1 essence-giving event / 18s; many events give water/shade,
    // so this is a conservative estimate of the essence side only)
    if (opt.events) {
      // ~1 event / 16s fires, but only ~half award essence (rest give water/shade/volume),
      // so model an essence-event roughly every ~32s — a conservative estimate.
      eventAccum += dt;
      if (eventAccum >= 32) { eventAccum = 0; g.pending += Math.round(9 * (1 + (g.day - 1) * C.eAmtDayCoef)) * effEss(g); }
    }
    buyAccum += dt;
    if (buyAccum >= policy.buyEvery) { buyAccum = 0; tryBuy(g, C, policy, opt.buyOrder); }
    g.elapsed += dt;
    if (g.water <= 0) return false;
  }
  return true;
}

export function simRun(meta, C, opt = {}) {
  const policy = POLICIES[opt.policy || "engaged"];
  const rng = opt.rng || mulberry32((opt.seed ?? 1) >>> 0);
  const g = freshRun(meta, C);
  const maxDay = opt.maxDay || 120;
  let day = 0;
  let peakVol = g.maxWater;
  for (;;) {
    day++;
    g.day = day;
    g.elapsed = 0;
    const dayLen = C.dayLen + (day - 1) * 6;
    // forecast: dodge danger with free respins (meta.luck)
    let w = rollWeather(rng, C);
    let free = meta.luck || 0;
    while (policy.dangerRespin && w.tier === "danger" && free > 0) { w = rollWeather(rng, C); free--; }
    g.weather = w;
    const alive = simulateDay(g, C, dayLen, policy, rng, opt);
    peakVol = Math.max(peakVol, g.maxWater);
    if (!alive) break;
    g.pending += dayBonus(g, C, meta.moon) * effEss(g);
    if (day >= maxDay) break;
  }
  return { deathDay: day, essence: Math.round(g.pending), peakVol: Math.round(peakVol) };
}

// average several seeds for a stable number
export function avgRun(meta, C, opt = {}, trials = 24) {
  let dSum = 0, eSum = 0, vSum = 0;
  for (let s = 0; s < trials; s++) {
    const r = simRun(meta, C, { ...opt, seed: (opt.seed ?? 1000) + s * 7919 });
    dSum += r.deathDay; eSum += r.essence; vSum += r.peakVol;
  }
  return { deathDay: dSum / trials, essence: eSum / trials, peakVol: vSum / trials };
}

// ---------- progression: play many runs, bank essence, buy meta upgrades ----------
const META_BUY_ORDER = ["memory", "cold", "silver", "absorb", "roots", "spring", "moon", "trees"];
function buyMetaGreedy(meta, C) {
  let bought = true;
  while (bought) {
    bought = false;
    for (const id of META_BUY_ORDER) {
      const u = C.metaUpg[id];
      const lvl = meta[id] || 0;
      if (lvl >= u.max) continue;
      const cost = metaCost(id, lvl, C);
      if (meta.essence >= cost) { meta.essence -= cost; meta[id] = lvl + 1; bought = true; break; }
    }
  }
}

export function progression(C, opt = {}) {
  const runs = opt.runs || 40;
  const meta = { essence: 0 };
  const history = [];
  let lifeEss = 0;
  for (let r = 1; r <= runs; r++) {
    const res = simRun(meta, C, { ...opt, seed: 5000 + r * 1009 });
    meta.essence += res.essence;
    lifeEss += res.essence;
    buyMetaGreedy(meta, C);
    history.push({ run: r, day: res.deathDay, ess: res.essence, bank: Math.round(meta.essence), life: lifeEss, vol: res.peakVol });
  }
  return { meta, history, lifeEss };
}
