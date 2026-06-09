/* =========================================================================
   КАЛАБАНЯ — REAL simulator.

   Unlike the old model, this does NOT re-implement the game. It imports the
   live modules from ../src/game/* and the pure engine, then drives them with
   player POLICIES. So every number it reports comes from the shipped balance,
   and it actually exercises real events, abilities, festivals, challenges,
   the wheel, the full altar and prestige. Edit src/game/* → rerun → see effect.

   Determinism: we temporarily seed Math.random for each run, so the real
   pickEvent / pickWheel / shuffle / forecast become reproducible.
   ========================================================================= */
import { freshRun, RUN_UPGRADES, META_UPGRADES, PRESTIGE_UPGRADES, runCost,
  ABSORB_BASE, META_TIER2_DAY, PRESTIGE_UNLOCK, cloudsFrom,
  challengeForDay, applyChallenge } from "../src/game/balance.js";
import { advanceTick, buyRunUpgrade, duskBonus, abilityCooldown, metaCost } from "../src/game/engine.js";
import { NEUTRAL, computeWeather, rollForecast } from "../src/game/weather.js";
import { pickEvent, makeRiddleEvent, CROW_GAG, CROW_SHOO_LIMIT } from "../src/game/events.js";
import { FESTIVALS, festivalForDay } from "../src/game/festivals.js";
import { WHEEL, pickWheel, fateLuck } from "../src/game/wheel.js";
import { ABILITIES, friendBaseline, friendCount } from "../src/game/characters.js";

// ---------- seeded Math.random (so the real RNG-using modules are reproducible) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function withSeed(seed, fn) {
  const orig = Math.random;
  Math.random = mulberry32(seed >>> 0);
  try { return fn(); } finally { Math.random = orig; }
}

// ---------- player archetypes ----------
export const POLICIES = {
  engaged: { tapsPerSec: 4.0, topUpAt: 0.96, buyFloor: 0.45, buyEvery: 1.0, useAbilities: true, dodge: true },
  casual:  { tapsPerSec: 1.1, topUpAt: 0.80, buyFloor: 0.60, buyEvery: 2.0, useAbilities: true, dodge: true },
};
// run-upgrade buy priorities
export const BUY_GROW  = ["silt", "moss", "deepen", "vein", "lake", "trench", "widen"];
export const BUY_SMALL = ["silt", "moss", "widen"]; // never grow volume → "stay tiny" exploit test

// ---------- one day ----------
function tapTick(g, policy, dt) {
  if (g.water >= g.maxWater * policy.topUpAt) return;
  const taps = Math.min(policy.tapsPerSec * dt, g.soil / 6);
  if (taps <= 0) return;
  const boost = g.absorbBoostT > 0 ? 1.9 : 1;
  const wb = 1 + (g.weather.absorbMod || 0);
  g.water = Math.min(g.water + taps * ABSORB_BASE * g.absorbMult * boost * wb, g.maxWater);
  g.soil -= taps * 6;
}

function tryBuyRun(g, policy, order) {
  let bought = true;
  while (bought) {
    bought = false;
    for (const u of order.map(id => RUN_UPGRADES.find(x => x.id === id))) {
      if (!u || (u.req && !u.req(g))) continue;
      const cost = runCost(u, g.levels[u.id] || 0, g.maxWater, g.cheapT > 0 ? 0.6 : 1);
      if (g.water - cost >= g.maxWater * policy.buyFloor) {
        const r = buyRunUpgrade(g, u); if (r) { Object.assign(g, r); bought = true; break; } // real engine effect
      }
    }
  }
}

// score an event option by simulating its REAL fn — pick the most valuable, dodge traps
function chooseOption(g, ev) {
  let best = ev.opts[0], bestScore = -1e18;
  for (const o of ev.opts) {
    let ng; try { ng = o.fn ? o.fn({ ...g }) : { ...g }; } catch { ng = { ...g }; }
    const score = (ng.water - g.water) + 0.5 * (ng.maxWater - g.maxWater) + 0.6 * (ng.pending - g.pending)
      + 0.15 * ((ng.shadeT - g.shadeT) + (ng.absorbBoostT - g.absorbBoostT)) - 0.2 * (ng.evapBoostT - g.evapBoostT)
      - (o.luck && o.luck < 0 ? 60 : 0);
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}
function resolveEvent(g, meta, ev, stat) {
  let cur = ev, depth = 0;
  while (cur && depth++ < 6) {
    const o = chooseOption(g, cur);
    if (o.fn) Object.assign(g, o.fn({ ...g }));
    if (o.meta) Object.assign(meta, o.meta({ ...meta }));
    if (o.luck) meta.fate = Math.max(0, (meta.fate || 0) + o.luck);
    stat.events++;
    cur = o.then ? (typeof o.then === "function" ? o.then(g, meta) : o.then) : null;
  }
}

// use one friend ability if helpful (shade when hot/dropping, water when low, else essence)
function maybeAbility(g, meta) {
  const ready = ABILITIES.filter(a => a.req(meta, g) && ((g.abil || {})[a.id] || 0) <= 0);
  if (!ready.length) return;
  const hot = g.sun > 120, low = g.water < g.maxWater * 0.4;
  const want = low ? ["вода", "тінь+вбирання"] : hot ? ["тінь", "тінь+вбирання"] : ["сутність+вбирання", "сутність+спокій", "сутність+ґрунт"];
  const pick = ready.find(a => want.some(k => a.kind.includes(k.split("+")[0]))) || ready[0];
  Object.assign(g, pick.apply({ ...g }, meta));
  g.abil = { ...(g.abil || {}), [pick.id]: abilityCooldown(pick, g, meta) };
}

function startFestival(g, fest) {
  g.festival = true; g.festAt = 0; g.weather = fest.weather;
  g.water = Math.min(g.maxWater, g.water + Math.max(8, Math.round(g.maxWater * 0.15)));
  return fest.events;
}

function simulateDay(g, meta, policy, opt, stat, festEvents) {
  let buyAccum = 0, abilAccum = 0;
  for (;;) {
    const r = advanceTick(g);
    Object.assign(g, r.g);
    if (Number.isNaN(g.water) || Number.isNaN(g.maxWater)) { stat.nan = true; return false; }
    if (r.wantEvent) {
      g.nextEvent = 99999;
      if (g.festival && festEvents && festEvents.length) {
        const at = g.festAt || 0, last = festEvents.length - 1, nearDusk = (g.dayLen - g.elapsed) < 30;
        let ev = null;
        if (at === 0) { g.festAt = 1; ev = festEvents[0]; }
        else if (nearDusk && festEvents[last].finale && at <= last) { g.festAt = last + 1; ev = festEvents[last]; }
        else if (at < last) { g.festAt = at + 1; ev = festEvents[at]; }
        if (ev) resolveEvent(g, meta, ev, stat);
        g.nextEvent = 7 + Math.random() * 6;
      } else {
        // wheel sometimes replaces an event (rare)
        const wheelReady = !g.festival && g.day >= 2 && (g.day - (g.wheelDay ?? -9)) >= 2 && Math.random() < 0.35;
        if (wheelReady) {
          g.wheelDay = g.day;
          const seg = WHEEL[pickWheel(fateLuck(meta))];
          if (seg.tier === "jackpot" || seg.tier === "good" || seg.tier === "none") { Object.assign(g, seg.fn({ ...g })); if (seg.luck) meta.fate = (meta.fate || 0) + seg.luck; }
          stat.wheels++;
        } else if ((g.crowShoo || 0) >= CROW_SHOO_LIMIT && !g.crowGagDone) {
          g.crowGagDone = true; g.eventCd = { ...(g.eventCd || {}), [CROW_GAG.t]: g.day };
          resolveEvent(g, meta, CROW_GAG, stat);
        } else {
          let ev = pickEvent(g, meta);
          g.eventCd = { ...(g.eventCd || {}), [ev.t]: g.day }; // mirror the game's per-name event cooldown
          if (ev.riddle) { const rr = makeRiddleEvent(g.usedRiddles); ev = rr.ev; g.usedRiddles = rr.usedRiddles; }
          resolveEvent(g, meta, ev, stat);
        }
        g.nextEvent = 13 + Math.random() * 8;
      }
    }
    if (r.dusk) return true;
    if (r.dead) { g.water = 0; return false; }
    if (!g.festival) tapTick(g, policy, 0.1 * (g.speed || 1)); // на фесті торкатись не можна
    abilAccum += 0.1; if (policy.useAbilities && abilAccum >= 3) { abilAccum = 0; maybeAbility(g, meta); }
    buyAccum += 0.1; if (buyAccum >= policy.buyEvery) { buyAccum = 0; if (!g.festival) tryBuyRun(g, policy, opt.buyOrder || BUY_GROW); }
  }
}

// ---------- one full run ----------
export function simRun(meta, opt = {}) {
  return withSeed((opt.seed ?? 1) >>> 0, () => {
    const policy = POLICIES[opt.policy || "engaged"];
    const runMeta = { ...meta, ...friendBaseline(meta.perma || {}) };
    let g = freshRun(runMeta);
    const stat = { events: 0, wheels: 0, abilities: 0, nan: false };
    const maxDay = opt.maxDay || 100;
    const RUNAWAY = 1e12; // beyond any sane scale → growth has outrun warming (immortal)
    let day = 0, peakVol = g.maxWater;
    for (;;) {
      day++; g.day = day; g.elapsed = 0; g.dayLen = 100 + (day - 1) * 6;
      g.festival = false; g.festAt = 0; g.leaf = 0; g.nextEvent = 12 + Math.random() * 6;
      let festEvents = null;
      const fest = festivalForDay(day);
      if (fest && (runMeta.tickets || {})[fest.id]) festEvents = startFestival(g, fest);
      else if (challengeForDay(day)) g.weather = applyChallenge(NEUTRAL, day);
      else {
        let idx = 0, w = computeWeather(rollForecast(g.seed, day, idx));
        let free = runMeta.luck || 0;
        while (policy.dodge && w.tier === "danger" && free > 0) { idx++; free--; w = computeWeather(rollForecast(g.seed, day, idx)); }
        g.weather = w;
      }
      const alive = simulateDay(g, runMeta, policy, opt, stat, festEvents);
      peakVol = Math.max(peakVol, g.maxWater);
      if (!Number.isFinite(g.water) || !Number.isFinite(g.maxWater) || !Number.isFinite(g.pending)) stat.nan = true;
      if (!alive || stat.nan) break;
      g.pending += duskBonus(g, runMeta.moon);
      if (g.maxWater > RUNAWAY) { stat.runaway = true; stat.immortal = true; break; }
      if (day >= maxDay) { stat.immortal = true; break; }
    }
    return { deathDay: day, essence: g.pending, peakVol, levels: { ...g.levels }, runMeta, stat };
  });
}

const median = (arr) => { const a = [...arr].sort((x, y) => x - y); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
// Mean is meaningless when some runs run away to 1e60; report MEDIANs + breakage rates.
export function avgRun(meta, opt = {}, trials = 20) {
  const days = [], ess = [], vol = [], evs = [];
  let immortal = 0, runaway = 0, nan = 0;
  for (let s = 0; s < trials; s++) {
    const r = simRun(meta, { ...opt, seed: (opt.seed ?? 1000) + s * 7919 });
    days.push(r.deathDay); ess.push(r.essence); vol.push(r.peakVol); evs.push(r.stat.events);
    if (r.stat.immortal) immortal++; if (r.stat.runaway) runaway++; if (r.stat.nan) nan++;
  }
  return {
    deathDay: median(days), essence: median(ess), peakVol: median(vol), eventsPerRun: median(evs),
    immortalRate: immortal / trials, runawayRate: runaway / trials, nanRate: nan / trials,
  };
}

// ---------- progression: many runs, bank essence, buy the FULL altar, prestige ----------
function buyAltarGreedy(meta) {
  // buy every available meta gift we can afford, cheapest-first, repeatedly
  let bought = true;
  while (bought) {
    bought = false;
    const avail = META_UPGRADES.filter(u => (u.tier !== 2 || (meta.best || 0) >= META_TIER2_DAY) && (!u.req || u.req(meta)));
    avail.sort((a, b) => metaCost(a, meta[a.id] || 0, meta.c_cheap) - metaCost(b, meta[b.id] || 0, meta.c_cheap));
    for (const u of avail) {
      const lvl = meta[u.id] || 0; if (lvl >= u.max) continue;
      const cost = metaCost(u, lvl, meta.c_cheap);
      if (meta.essence >= cost) { meta.essence -= cost; meta[u.id] = lvl + 1; bought = true; break; }
    }
  }
}
function maybePrestige(meta) {
  if ((meta.lifeEss || 0) < PRESTIGE_UNLOCK) return false;
  const gain = cloudsFrom(meta.essThisAsc);
  if (gain < 3) return false; // a real player ascends when the payoff is worth it
  // buy cloud gifts, then reset run-scoped meta (mirror of doPrestige)
  meta.clouds = (meta.clouds || 0) + gain; meta.ascensions = (meta.ascensions || 0) + 1; meta.essThisAsc = 0; meta.essence = 0;
  for (const id of ["memory", "cold", "silver", "spring", "roots", "absorb", "thirst", "luck", "moon", "callcd", "trees", "swift", "wellspring", "permafrost", "golddrop", "deeproots", "spring2", "essflow", "calmsky", "abyss"]) meta[id] = 0;
  let bought = true;
  while (bought) {
    bought = false;
    for (const u of PRESTIGE_UPGRADES) {
      const lvl = meta[u.id] || 0; if (lvl >= u.max) continue;
      const cost = Math.round(u.base * Math.pow(u.growth, lvl));
      if ((meta.clouds || 0) >= cost) { meta.clouds -= cost; meta[u.id] = lvl + 1; bought = true; break; }
    }
  }
  return true;
}

export function progression(opt = {}) {
  const runs = opt.runs || 50;
  const meta = { essence: 0, best: 0, lifeEss: 0, essThisAsc: 0, perma: {}, tickets: {} };
  const history = [];
  for (let r = 1; r <= runs; r++) {
    const res = simRun(meta, { ...opt, seed: 5000 + r * 1009 });
    meta.essence += res.essence; meta.lifeEss = (meta.lifeEss || 0) + res.essence; meta.essThisAsc = (meta.essThisAsc || 0) + res.essence;
    meta.best = Math.max(meta.best || 0, res.deathDay);
    const ascended = opt.prestige ? maybePrestige(meta) : false;
    buyAltarGreedy(meta);
    history.push({ run: r, day: res.deathDay, ess: res.essence, bank: Math.round(meta.essence), life: Math.round(meta.lifeEss), vol: res.peakVol, ascended, asc: meta.ascensions || 0, clouds: meta.clouds || 0 });
  }
  return { meta, history };
}
