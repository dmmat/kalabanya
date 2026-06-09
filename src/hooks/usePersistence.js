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

export function usePersistence({ bootForecast, g, gRef, loaded, meta, metaRef, phase, phaseRef, result, resultRef, setG, setMeta, setPhase, setResult }) {
  /* ---- load ---- */
  useEffect(() => {
    (async () => {
      const raw = await store.load(KEY);
      if (raw) {
        try {
          const d = JSON.parse(raw);
          if (d.meta) setMeta(m => ({ ...m, ...migrateMeta(d.meta), ach: { ...(d.meta.ach || {}) } }));
          const resumable = ["playing", "survived", "forecast", "challenge", "festival", "dead"];
          if (d.g && resumable.includes(d.phase)) {
            // якщо перезавантажили під час події/колеса — скидаємо «паузу» таймера подій
            const ne = (d.g.nextEvent == null || d.g.nextEvent >= 9999) ? 6 + Math.random() * 6 : d.g.nextEvent;
            // фестиваль не відновлюється з пів-дороги (черга подій у пам'яті) — лагідно завершуємо його
            const wasFest = d.phase === "playing" && d.g.festival;
            setG(gg => ({ ...gg, ...d.g, weather: d.g.weather || NEUTRAL, nextEvent: ne, festival: wasFest ? false : d.g.festival }));
            if (d.phase === "dead") {
              if (d.result) { setResult(d.result); setPhase("dead"); }
              else setPhase("menu"); // run already banked, just no screen to show
            } else if (d.phase === "forecast") {
              bootForecast.current = true; setPhase("forecast"); // re-open the day's slot
            } else {
              setPhase(d.phase); // playing | survived | challenge | festival — continue where we stopped
            }
          } else setPhase("welcome");
        } catch (e) { setPhase("welcome"); }
      } else setPhase("welcome");
      loaded.current = true;
    })();
  }, []);

  /* ---- autosave ---- */
  useEffect(() => {
    if (!loaded.current) return;
    const iv = setInterval(() => {
      const snap = JSON.stringify({ v: 3, meta: metaRef.current, phase: phaseRef.current, g: gRef.current, result: resultRef.current });
      store.save(KEY, snap);
    }, 2500);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { if (loaded.current) store.save(KEY, JSON.stringify({ v: 3, meta, phase: phaseRef.current, g: gRef.current, result: resultRef.current })); }, [meta]);
  // живий заголовок вкладки — відображає, що зараз із калабанею
  useEffect(() => {
    const NM = "КАЛАБАНЯ";
    let t = `💧 ${NM} — калюжа, що мріє стати океаном`;
    if (phase === "playing") t = g.festival ? `🎉 Фестиваль Республіка — ${NM}` : `💧 День ${g.day} · ${rankName(g.maxWater)} — ${NM}`;
    else if (phase === "festival") t = `🎉 Свято! День ${g.day} — ${NM}`;
    else if (phase === "forecast" || phase === "challenge") t = `🎰 День ${g.day} — ${NM}`;
    else if (phase === "survived") t = `🌙 День ${g.day} пережито — ${NM}`;
    else if (phase === "dead") t = `🥀 Висохла на ${(result && result.day) || g.day} день — ${NM}`;
    else if (phase === "menu") t = `✦ Вівтар калабань — ${NM}`;
    document.title = t;
  }, [phase, g.day, g.maxWater, g.festival, result]);
  // persist immediately whenever the phase changes, so a refresh resumes the exact screen
  useEffect(() => {
    if (!loaded.current || phase === "loading") return;
    store.save(KEY, JSON.stringify({ v: 3, meta: metaRef.current, phase, g: gRef.current, result: resultRef.current }));
  }, [phase]);
}
