/* Proposed rebalance config. Starts as a structural clone of CURRENT; the
   rebalance deltas are applied below and explained in BALANCE.md.

   Pillars (chosen with the designer):
     1. Income from SIZE — essence/s scales with volume (sqrt) so growing the
        puddle is the reward. Kills the "stay small & farm days" exploit.
     2. Keep TENSION — warming outscales any passive eventually, so every run
        is finite; bigger investment = deeper run, never immortal.
     3. Full economy rebalance — income & prices recomputed so unlocks pace
        out over many runs instead of being trivial on run 1-2.
*/
import { CURRENT } from "./model.mjs";

export const PROPOSED = structuredClone(CURRENT);

// ── 1. income tied to puddle size ──────────────────────────────────────────
PROPOSED.incomeModel = "size";
PROPOSED.essSizeExp = 0.5;     // sqrt(volume): strong but diminishing reward for growth
PROPOSED.essRefVol = 120;      // reference = starting volume
PROPOSED.essRate = 0.10;       // per-second base (×sizeMul ×effEss)
PROPOSED.essBonusBase = 5;     // dusk survival bonus base (×sizeMul ×effEss), was 14×day
PROPOSED.eAmtDayCoef = 0.06;   // events scale gentler with day (was 0.12) → less day-farm

// ── 2. tension: warming is the terminal driver for ALL sizes ────────────────
// it's a roguelike — dying is the point. Warming starts earlier, bites harder,
// and leans more on size, so even big puddles dry out and runs stay short.
PROPOSED.warmStart = 8;        // was 10 — warming kicks in two days sooner
PROPOSED.warmCoef = 0.26;      // was 0.13 — warming bites much harder
PROPOSED.ecoFloor = 0.55;      // was 0.12 — eco upgrades DELAY warming, can't cancel it
PROPOSED.warmSizeExp = 0.45;   // warming scales harder with size → big puddles aren't immortal

// weather swings harder too — good and bad days both hit more (more tension/variance)
PROPOSED.weatherAmp = 1.45;

// evaporation ramps up faster day-to-day, and the midday curve is sharper, so each
// day the noon spike forces you to actively seek shade to survive the hot hours.
PROPOSED.sunPeakPerDay = 16;   // was 13 — every day noticeably hotter
PROPOSED.sunPeakLateStart = 4; // was 5 — late-game heat avalanche starts sooner
PROPOSED.sunPeakLateExp = 1.75;// was 1.6
PROPOSED.sunPeakLateCoef = 0.9;// was 0.6
PROPOSED.sunCurveExp = 1.25;   // sharper midday peak (sine^1.25) → noon is a danger window

// ── 3. growth is the goal: prices no longer scale with volume ───────────────
// pure exponential cost per level (no frac-of-volume floor, no volume cap) → a
// bigger puddle just means a bigger water pool to spend, so pumping volume pays off.
PROPOSED.runCostCap = Infinity;
for (const k in PROPOSED.runUpg) PROPOSED.runUpg[k].frac = 0;

// ── economy deflation handled by income model above + re-priced sinks ────────
// permanent friends re-priced to the new income scale (reachable over ~many runs)
PROPOSED.permaPrices = [3000, 4500, 6500, 9000, 12000, 16000, 21000, 27000, 34000, 44000];
PROPOSED.prestigeUnlock = 100000; // lifetime essence to unlock prestige (a mid-game milestone)
PROPOSED.prestigeDiv = 200;
