/* =========================================================================
   КАЛАБАНЯ — balance model (standalone, no deps)

   This mirrors the core economy of src/App.jsx so we can run mathematical
   simulations of survival and the essence economy offline. Every formula
   here is a faithful copy of the live game; the tunable numbers live in the
   exported CONFIG objects (CURRENT = shipped values, PROPOSED = rebalance).

   The player POLICY (how a real person taps / buys / respins) is modelled
   separately in sim.mjs so we can test the same balance against several
   archetypes (engaged vs casual).
   ========================================================================= */

// ---- weather symbols (copy of SYMBOLS / WEIGHTS in App.jsx) ----
export const SYMBOLS = [
  { e: "☀️", sun: 0.22, comboRain: undefined, tier: "danger" },
  { e: "🌧️", rain: 0.55, tier: "good", comboRain: 1.6 },
  { e: "☁️", sun: -0.18, tier: "good" },
  { e: "🌫️", evap: -0.14, tier: "good" },
  { e: "💨", abs: 0.45, rain: 0.06, tier: "good" },
  { e: "🌈", rain: 0.35, ess: 0.18, tier: "jackpot", comboEss: 0.7 },
  { e: "🔥", sun: 0.42, ess: 0.12, tier: "danger", comboEss: 1.4 },
  { e: "❄️", evap: -0.22, rain: 0.05, tier: "good" },
  { e: "⛈️", rain: 0.7, abs: 0.1, tier: "good", comboRain: 1.8 },
  { e: "🌪️", abs: 0.6, sun: 0.1, tier: "good" },
  { e: "⛅", sun: -0.05, rain: 0.05, tier: "norm" },
  { e: "🌡️", sun: 0.3, evap: 0.08, tier: "danger" },
];
export const WEIGHTS = [4, 3, 4, 3, 3, 1, 1.6, 2, 1.4, 1.8, 3, 1.6];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function pickIdx(rng) {
  const tot = WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * tot;
  for (let i = 0; i < WEIGHTS.length; i++) { r -= WEIGHTS[i]; if (r <= 0) return i; }
  return WEIGHTS.length - 1;
}

export function rollWeather(rng, C = CURRENT) {
  const idxs = [pickIdx(rng), pickIdx(rng), pickIdx(rng)];
  const w = { rainPower: 0, sunMod: 0, absorbMod: 0, evapMod: 0, essMod: 0 };
  idxs.forEach(i => { const s = SYMBOLS[i]; w.rainPower += s.rain || 0; w.sunMod += s.sun || 0; w.absorbMod += s.abs || 0; w.evapMod += s.evap || 0; w.essMod += s.ess || 0; });
  const all = idxs[0] === idxs[1] && idxs[1] === idxs[2];
  let tier = "norm";
  if (all) {
    const s = SYMBOLS[idxs[0]];
    tier = s.tier;
    w.rainPower *= (s.comboRain || 2.0);
    w.sunMod *= 2; w.absorbMod *= 2; w.evapMod *= 2;
    w.essMod += (s.comboEss || 0);
  } else {
    if (w.sunMod > 0.45) tier = "danger";
    else if (w.rainPower > 0.4 || w.essMod > 0.1) tier = "good";
  }
  // tier/name use base values; physical mods are amplified (mirror of App.jsx WEATHER_AMP)
  const amp = C.weatherAmp || 1;
  w.rainPower *= amp; w.sunMod *= amp; w.absorbMod *= amp; w.evapMod *= amp;
  return { ...w, tier, isCombo: all };
}

// ---- balance config: CURRENT (shipped) ----
export const CURRENT = {
  // core loop
  dayLen: 100, dt: 0.1,
  baseEvap: 0.95, evapColdMul: 0.96, evapPermaMul: 0.97,
  evapReduFloor: 0.5,
  sunMulCoef: 2.5, sunResistCap: 0.85,
  sunEffCap: 400,
  // sun peak curve (day-to-day ramp) + within-day curve sharpness (sunCurveExp 1 = sine)
  sunPeakBase: 72, sunPeakPerDay: 13, sunPeakLateStart: 5, sunPeakLateExp: 1.6, sunPeakLateCoef: 0.6,
  sunCurveExp: 1,
  // global warming (warmSizeExp 0 = original: size-independent additive drain)
  warmStart: 10, warmExp: 1.5, warmCoef: 0.13, ecoFloor: 0.12, warmSizeExp: 0,
  // weather amplifier (1 = original; >1 makes weather swing harder)
  weatherAmp: 1,
  // absorb / soil
  absorbBase: 2.5, soilDrain: 6, soilRegen: 3.8, absorbBoost: 1.9,
  soilStart: 60, soilMaxStart: 60,
  // essence — income model "day" = original (per-sec flat + day-scaled dusk bonus)
  incomeModel: "day",
  essSizeExp: 0.5, essRefVol: 120,
  essRate: 0.15, essBonusBase: 14, moonCoef: 0.15, eAmtDayCoef: 0.12,
  // start
  startWater: 46, startMaxWater: 120, memoryWater: 22,
  // run upgrades
  runCostCap: 0.92,
  runUpg: {
    deepen: { base: 24, growth: 1.4, frac: 0.18 },
    silt:   { base: 30, growth: 1.42, frac: 0.12 },
    widen:  { base: 22, growth: 1.4, frac: 0.10 },
    moss:   { base: 28, growth: 1.45, frac: 0.10 },
    vein:   { base: 40, growth: 1.5, frac: 0.14 },
    lake:   { base: 130, growth: 1.7, frac: 0.25 },
    trench: { base: 420, growth: 1.62, frac: 0.22 },
  },
  // meta upgrades (subset that matters for the economy curve)
  metaUpg: {
    memory: { base: 40, growth: 1.72, max: 12 },
    cold:   { base: 55, growth: 1.78, max: 10 },
    silver: { base: 48, growth: 1.74, max: 12 },
    spring: { base: 70, growth: 1.85, max: 8 },
    roots:  { base: 52, growth: 1.78, max: 8 },
    absorb: { base: 50, growth: 1.76, max: 10 },
    moon:   { base: 85, growth: 1.95, max: 8 },
    trees:  { base: 84, growth: 1.84, max: 12 },
  },
  // permanent friends prices
  permaPrices: [22000, 28000, 34000, 42000, 50000, 62000, 76000, 92000, 115000, 140000],
  prestigeUnlock: 1200, prestigeDiv: 200,
};

// effective evaporation per in-game second
export function evapPerSec(g, C) {
  const w = g.weather;
  const sunEff = clamp(g.sun * (1 + w.sunMod), 0, C.sunEffCap);
  const sunMul = 1 + (sunEff / 100) * C.sunMulCoef * (1 - clamp(g.sunResist, 0, C.sunResistCap));
  const redu = Math.max(C.evapReduFloor, g.deepenMult * g.mossMult);
  let e = g.baseEvap * redu * sunMul * (1 - g.leaf);
  if (g.shadeT > 0) e *= 0.35;
  if (g.evapBoostT > 0) e = e * 1.8 + Math.min(g.maxWater * 0.005, 8 + g.passive * 0.8);
  e += warmingDrain(g, C) * g.ecoMult;
  e *= (1 + w.evapMod);
  return Math.max(0, e);
}
// global warming: inexorable drain that grows with the day AND (in the new model)
// with puddle size — a bigger surface loses more, so growth is a genuine tradeoff
// (richer income, harder to keep alive) and runs stay finite at every scale.
export const warmingDrain = (g, C) => {
  const base = Math.pow(Math.max(0, g.day - C.warmStart), C.warmExp) * C.warmCoef;
  const sizeF = C.warmSizeExp ? Math.pow(Math.max(1, g.maxWater) / C.essRefVol, C.warmSizeExp) : 1;
  return base * sizeF;
};
export const sunPeak = (day, C) => C.sunPeakBase + (day - 1) * C.sunPeakPerDay + Math.pow(Math.max(0, day - C.sunPeakLateStart), C.sunPeakLateExp) * C.sunPeakLateCoef;
// within-day sun curve: sine raised to sunCurveExp (>1 = sharper midday spike)
export const sunCurve = (t, C) => Math.pow(Math.sin(Math.PI * t), C.sunCurveExp || 1);

export const effEss = (g) => g.essMult * (1 + g.weather.essMod);
export const eAmt = (g, base, C) => Math.round(base * (1 + (g.day - 1) * C.eAmtDayCoef) * (g.friend || 1));

// size income multiplier: sublinear (sqrt by default) growth with volume.
// Bigger puddle = more essence, but with diminishing returns so it can't run away.
export const sizeMul = (mw, C) => Math.pow(Math.max(1, mw) / C.essRefVol, C.essSizeExp);
// per-second essence collection (pre-effEss)
export const essCollect = (g, C) => (C.incomeModel === "size") ? g.essRate * sizeMul(g.maxWater, C) : g.essRate;
// dusk survival bonus (pre-effEss): size-scaled in the new model, day-scaled in the old
export const dayBonus = (g, C, moon) => {
  const f = (C.incomeModel === "size") ? sizeMul(g.maxWater, C) : g.day;
  return C.essBonusBase * f * (1 + C.moonCoef * (moon || 0));
};

// run-upgrade cost (mirror of runCost in App.jsx)
export function runCost(id, lvl, maxW, C, disc = 1) {
  const u = C.runUpg[id];
  const c = Math.max(u.base * Math.pow(u.growth, lvl), (u.frac || 0) * maxW);
  return Math.max(1, Math.round(Math.min(c, C.runCostCap * maxW) * disc));
}
export function metaCost(id, lvl, C) {
  const u = C.metaUpg[id];
  return Math.round(u.base * Math.pow(u.growth, lvl));
}

// build a fresh run state from meta levels (mirror of freshRun)
export function freshRun(meta, C) {
  const M = (k) => meta[k] || 0;
  return {
    water: C.startWater + M("memory") * C.memoryWater,
    maxWater: C.startMaxWater + M("memory") * C.memoryWater,
    day: 1, elapsed: 0,
    sun: 8,
    baseEvap: C.baseEvap * Math.pow(C.evapColdMul, M("cold")),
    deepenMult: 1, mossMult: 1, sunResist: 0,
    absorbMult: 1 + 0.10 * M("absorb"),
    soil: C.soilStart, soilMax: C.soilMaxStart, soilRegen: C.soilRegen * (1 + 0.25 * M("roots")),
    passive: 0.3 * M("spring") + ((meta.frogBond || 0) >= 3 ? 0.1 : 0),
    leaf: 0, shadeT: 0, evapBoostT: 0, absorbBoostT: 0,
    essMult: 1 + 0.12 * M("silver"),
    essRate: C.essRate,
    friend: 1,
    ecoMult: Math.max(C.ecoFloor, 1 - 0.06 * M("trees")),
    pending: 0,
    levels: { deepen: 0, silt: 0, widen: 0, moss: 0, vein: 0, lake: 0, trench: 0 },
    weather: { rainPower: 0, sunMod: 0, absorbMod: 0, evapMod: 0, essMod: 0, tier: "norm" },
  };
}

// apply a run-upgrade purchase (mirror of buyRun effects)
export function applyRunUpgrade(n, id) {
  const lvl = n.levels[id];
  if (id === "deepen") { n.maxWater += Math.max(50 + lvl * 10, Math.round(n.maxWater * 0.05)); n.deepenMult *= 0.97; }
  if (id === "silt") { n.sunResist = clamp(n.sunResist + 0.08, 0, 0.85); }
  if (id === "widen") { n.absorbMult += 0.6; n.soilMax += 40; n.maxWater += Math.max(30, Math.round(n.maxWater * 0.02)); n.baseEvap += 0.04; }
  if (id === "moss") n.mossMult *= 0.93;
  if (id === "vein") n.passive += 0.4;
  if (id === "lake") { n.maxWater += Math.max(150, Math.round(n.maxWater * 0.08)); n.passive += 0.7; }
  if (id === "trench") { n.maxWater += Math.max(400, Math.round(n.maxWater * 0.08)); n.passive += 1.5; }
  n.levels[id] = lvl + 1;
}

// simple deterministic RNG (mulberry32) so runs are reproducible
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
