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

export function useGameLoop({ dayTaps, event, festEventsRef, metaRef, phase, setEvent, setG, setMeta, setPhase, setResult, setWheel, unlock, wheelRef }) {
  useEffect(() => {
    if (phase !== "playing") return;
    const iv = setInterval(() => {
      setG(prev => {
        if (wheelRef.current) return prev; // Колесо Фортуни ставить день на паузу
        const dt = 0.1 * (prev.speed || 1); // «Стрімкий час» — усе те саме, лише швидше
        const n = { ...prev };
        n.elapsed += dt;
        const t = clamp(n.elapsed / n.dayLen, 0, 1);
        // прогресія спеки крутіша: кожен день помітно гарячіший, а пізні дні — лавиною.
        const peak = 72 + (n.day - 1) * 16 + Math.pow(Math.max(0, n.day - 4), 1.75) * 0.9;
        // крива дня гостріша (^1.25): ранок/вечір лагідні, а ОПІВДНІ — пік-пекло,
        // тож удень доводиться активно шукати тінь, щоб пережити полудень.
        n.sun = Math.max(6, peak * Math.pow(Math.sin(Math.PI * t), 1.25));
        n.shadeT = Math.max(0, n.shadeT - dt);
        n.evapBoostT = Math.max(0, n.evapBoostT - dt);
        n.absorbBoostT = Math.max(0, n.absorbBoostT - dt);
        n.cheapT = Math.max(0, (n.cheapT || 0) - dt);
        if (n.abil) { const ab = { ...n.abil }; for (const k in ab) ab[k] = Math.max(0, ab[k] - dt); n.abil = ab; }
        const w = n.weather || NEUTRAL;
        // курна буря: ґрунт пересихає й не відновлюється (вбирати нічим)
        n.soil = w.challenge === "dust" ? Math.max(0, n.soil - 4 * dt) : clamp(n.soil + n.soilRegen * dt, 0, n.soilMax);
        const evap = evapPerSec(n);
        n.water = Math.min(n.water + (n.passive + w.rainPower - evap) * dt, n.maxWater);
        n.pending += (n.essRate || 0.10) * sizeMul(n.maxWater) * effEss(n) * dt; // збір сутності росте з розміром
        if (!event) n.nextEvent -= dt; // таймер паузиться, поки відкрите вікно події
        if (n.water >= n.maxWater - 0.5) unlock("rainchild");
        // не запускати подій/Колесо в останні ~13с дня (щоб не вискакували перед сутінками)
        if (n.nextEvent <= 0 && !event && (n.dayLen - n.elapsed) > 13) {
          n.nextEvent = 99999; // сентинел: жодних нових подій, доки цю не закриють
          let fired = false;
          const fest = n.festival ? festEventsRef.current : null;
          if (fest && fest.length) {
            const lastIdx = fest.length - 1, at = n.festAt || 0;
            const nearDusk = (n.dayLen - n.elapsed) < 30;
            // інтро — завжди перше; фінал — гарантовано під кінець дня; між тим святкові події вперемішку зі звичайними
            if (at === 0) { n.festAt = 1; Haptics.event(); setEvent({ ...fest[0], fest: true }); fired = true; }
            else if (nearDusk && fest[lastIdx] && fest[lastIdx].finale && at <= lastIdx) { n.festAt = lastIdx + 1; Haptics.event(); setEvent({ ...fest[lastIdx], fest: true }); fired = true; }
            else if (at < lastIdx && Math.random() < 0.6) { n.festAt = at + 1; Haptics.event(); setEvent({ ...fest[at], fest: true }); fired = true; }
          }
          if (!fired) {
            // рідко (раз на пару днів) замість звичайної події випадає Колесо Фортуни (не на фестивалі)
            const wheelReady = !n.festival && n.day >= 2 && (n.day - (n.wheelDay ?? -9)) >= 2 && Math.random() < 0.35;
            if (wheelReady) { n.wheelDay = n.day; Haptics.event(); setWheel({ stage: "offer" }); }
            else { let ev = pickEvent(n, metaRef.current); if (ev.riddle) ev = makeRiddleEvent(); if (ev.once) setMeta(m => ({ ...m, seenOnce: { ...(m.seenOnce || {}), [ev.once]: true } })); Haptics.event(); setEvent(ev); }
          }
        }
        if (n.elapsed >= n.dayLen) {
          const bonus = 5 * sizeMul(n.maxWater) * effEss(n) * (1 + 0.15 * (metaRef.current.moon || 0)); // дар за виживання до сутінків — за РОЗМІР, а не за номер дня
          n.pending += bonus;
          const tapsThisDay = dayTaps.current;
          const waterAtDusk = n.water;
          queueMicrotask(() => {
            unlock("firstdew");
            if (tapsThisDay === 0) unlock("mirror");
            if (waterAtDusk <= 5) unlock("lastdrop");
            if (challengeForDay(n.day)) unlock("trial");
            if (n.day >= 7) unlock("sevensuns");
            if (n.day >= 30) unlock("oldpuddle");
            if (n.day >= 50) unlock("eternal");
            Sfx.dusk();
            setEvent(null);
            setPhase("survived");
          });
        }
        if (n.water <= 0) {
          n.water = 0;
          const gained = Math.round(n.pending);
          queueMicrotask(() => {
            // ще НЕ банкуємо сутність — спершу даємо шанс на рятувальний слот
            setResult({ gained, secs: Math.round(n.elapsed), day: n.day });
            if (n.day >= 7) unlock("sevensuns");
            if (n.day >= 30) unlock("oldpuddle");
            if (n.day >= 50) unlock("eternal");
            if (n.day >= 20) unlock("warmed"); // висох уже за відчутного потепління
            Sfx.danger(); Haptics.bad();
            setEvent(null); setPhase("dead");
          });
        }
        return n;
      });
    }, 100);
    return () => clearInterval(iv);
  }, [phase, event, unlock]);
}
