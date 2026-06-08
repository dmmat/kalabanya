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
PROPOSED.warmCoef = 0.17;      // was 0.13 — warming bites harder
PROPOSED.ecoFloor = 0.55;      // was 0.12 — eco upgrades DELAY warming, can't cancel it
PROPOSED.warmSizeExp = 0.35;   // warming scales with sqrt-ish of size → big puddles aren't immortal

// ── 3. economy deflation handled by income model above + re-priced sinks ────
// permanent friends re-priced to the new income scale (reachable over ~many runs)
PROPOSED.permaPrices = [3000, 4500, 6500, 9000, 12000, 16000, 21000, 27000, 34000, 44000];
PROPOSED.prestigeUnlock = 100000; // lifetime essence to unlock prestige (a mid-game milestone)
PROPOSED.prestigeDiv = 200;
