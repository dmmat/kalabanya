/* AUTO-EXTRACTED from useGame.js — composed effect hook. */
import { useEffect, useRef, useCallback } from "react";
import { fmt, clamp, mix, shuffle } from "../game/format.js";
import { SYMBOLS, NEUTRAL, rollForecast, computeWeather } from "../game/weather.js";
import { ABSORB_BASE, RUN_UPGRADES, runCost, META_UPGRADES, META_TIER2_DAY, PRESTIGE_UNLOCK, cloudsFrom, PRESTIGE_UPGRADES, CHALLENGES, challengeForDay, applyChallenge, effEss, sizeMul, aw, eAmt, tempC, warmingDrain, rankName, evapPerSec, freshRun } from "../game/balance.js";
import { friendCount, PERMA_FRIENDS, friendBaseline, ABILITIES, SYNERGY, synKey, PREY_ACC, joinUa } from "../game/characters.js";
import { makeRiddleEvent, pickEvent } from "../game/events.js";
import { FESTIVALS, festivalForDay } from "../game/festivals.js";
import { WHEEL, pickWheel, fateLuck } from "../game/wheel.js";
import { ACHIEVEMENTS } from "../game/achievements.js";
import { skyAt } from "../game/sky.js";
import { KEY, store } from "../storage.js";
import { Sfx, Haptics } from "../audio.js";
import { DEFAULT_META, migrateMeta } from "../constants.js";

export function useWakeLock({ meta, phase, wakeLockRef }) {
  useEffect(() => {
    const want = phase === "playing" && meta.keepAwake !== false && typeof navigator !== "undefined" && "wakeLock" in navigator;
    const acquire = async () => {
      if (!want || wakeLockRef.current || document.visibilityState !== "visible") return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener?.("release", () => { wakeLockRef.current = null; });
      } catch (e) { wakeLockRef.current = null; }
    };
    const release = () => { try { wakeLockRef.current && wakeLockRef.current.release(); } catch (e) {} wakeLockRef.current = null; };
    if (want) acquire(); else release();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); release(); };
  }, [phase, meta.keepAwake]);
}
