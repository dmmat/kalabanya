/* Pure game engine — the continuous day-tick and state-transition actions that
   used to live inline in the React loop. No React, no DOM: the live game (hooks/)
   and the offline simulator (sim/) both call THIS code, so they can never drift.
   See docs/ARCHITECTURE.md. */
import { clamp } from "./format.js";
import { NEUTRAL } from "./weather.js";
import { evapPerSec, sizeMul, effEss, runCost, addResist, SILT_STEP } from "./balance.js";

// sun: day-to-day ramp (hotter each day, late-game avalanche) + within-day curve
// (sine^1.25 → sharp midday spike). Was hard-coded in the game loop.
export const sunPeak = (day) => 72 + (day - 1) * 16 + Math.pow(Math.max(0, day - 4), 1.75) * 0.9;
export const sunCurve = (t) => Math.pow(Math.sin(Math.PI * t), 1.25);

// dusk survival bonus (size-scaled essence, banked when you reach nightfall)
export const duskBonus = (g, moon = 0) => 5 * sizeMul(g.maxWater) * effEss(g) * (1 + 0.15 * (moon || 0));

// friend-ability cooldown after reductions («Поклик друзів» gift + «Гучніший поклик»
// run-upgrade), floored at ~45 % so strong abilities never become spam.
export const abilityCooldown = (ab, g, meta) => {
  const red = clamp(0.07 * ((meta && meta.callcd) || 0) + 0.04 * ((g.levels && g.levels.summon) || 0), 0, 0.55);
  const floor = Math.max(8, Math.round(ab.cd * 0.45));
  return Math.max(floor, Math.round(ab.cd * (1 - red)));
};

// meta-gift cost (level → essence), discounted by «Лагідне небо» (c_cheap)
export const metaCost = (u, lvl, cCheap = 0) =>
  Math.round(u.base * Math.pow(u.growth, lvl) * Math.max(0.4, 1 - 0.06 * (cCheap || 0)));

// Advance the continuous day-state by ONE tick. Pure: returns the new state plus
// flags the caller reacts to. The React loop uses the flags to spawn events / change
// phase; the simulator drives its own policy. `eventOpen` freezes the event timer
// while a modal is up (matches the game — time still passes, no new event spawns).
export function advanceTick(prev, { baseDt = 0.1, eventOpen = false } = {}) {
  const dt = baseDt * (prev.speed || 1);
  const n = { ...prev };
  n.elapsed += dt;
  const t = clamp(n.elapsed / n.dayLen, 0, 1);
  n.sun = Math.max(6, sunPeak(n.day) * sunCurve(t));
  n.shadeT = Math.max(0, n.shadeT - dt);
  n.evapBoostT = Math.max(0, n.evapBoostT - dt);
  n.absorbBoostT = Math.max(0, n.absorbBoostT - dt);
  n.cheapT = Math.max(0, (n.cheapT || 0) - dt);
  if (n.abil) { const ab = { ...n.abil }; for (const k in ab) ab[k] = Math.max(0, ab[k] - dt); n.abil = ab; }
  const w = n.weather || NEUTRAL;
  // dust-storm challenge: soil dries out and never refills (nothing to absorb)
  n.soil = w.challenge === "dust" ? Math.max(0, n.soil - 4 * dt) : clamp(n.soil + n.soilRegen * dt, 0, n.soilMax);
  n.water = Math.min(n.water + (n.passive + w.rainPower - evapPerSec(n)) * dt, n.maxWater);
  n.pending += (n.essRate || 0.10) * sizeMul(n.maxWater) * effEss(n) * dt; // essence collection grows with size
  if (!eventOpen) n.nextEvent -= dt; // timer pauses while an event window is open
  return {
    g: n,
    rainchild: n.water >= n.maxWater - 0.5,
    wantEvent: n.nextEvent <= 0 && !eventOpen && (n.dayLen - n.elapsed) > 13,
    dusk: n.elapsed >= n.dayLen,
    dead: n.water <= 0,
  };
}

// Run-upgrade purchase EFFECT (cost + level + stat changes). Returns the new state,
// or null if unaffordable. Achievement/maxVol bookkeeping stays with the caller.
export function buyRunUpgrade(prev, u) {
  const lvl = prev.levels[u.id] || 0;
  const cost = runCost(u, lvl, prev.maxWater, prev.cheapT > 0 ? 0.6 : 1);
  if (prev.water < cost) return null;
  const n = { ...prev, water: prev.water - cost, levels: { ...prev.levels, [u.id]: lvl + 1 } };
  if (u.id === "deepen") { n.maxWater += Math.max(50 + lvl * 10, Math.round(n.maxWater * 0.05)); n.deepenMult *= 0.97; }
  if (u.id === "silt") { n.sunResist = addResist(n.sunResist, SILT_STEP); }
  if (u.id === "widen") { n.absorbMult += 0.6; n.soilMax += 40; n.maxWater += Math.max(30, Math.round(n.maxWater * 0.02)); n.baseEvap += 0.04; }
  if (u.id === "moss") n.mossMult *= 0.93;
  if (u.id === "vein") n.passive += 0.4;
  if (u.id === "lake") { n.maxWater += Math.max(150, Math.round(n.maxWater * 0.08)); n.passive += 1.5; }
  if (u.id === "trench") { n.maxWater += Math.max(400, Math.round(n.maxWater * 0.08)); n.passive += 4.0; }
  return n;
}
