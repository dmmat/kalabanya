/* AUTO-EXTRACTED from useGame.js — composed effect hook. */
import { useEffect, useRef, useCallback } from "react";
import { fmt, clamp, mix, shuffle } from "../game/format.js";
import { SYMBOLS, NEUTRAL, rollForecast, computeWeather } from "../game/weather.js";
import { ABSORB_BASE, RUN_UPGRADES, runCost, META_UPGRADES, META_TIER2_DAY, PRESTIGE_UNLOCK, cloudsFrom, PRESTIGE_UPGRADES, CHALLENGES, challengeForDay, applyChallenge, effEss, sizeMul, aw, eAmt, tempC, warmingDrain, rankName, evapPerSec, freshRun } from "../game/balance.js";
import { friendCount, PERMA_FRIENDS, friendBaseline, ABILITIES, SYNERGY, synKey, PREY_ACC, joinUa } from "../game/characters.js";
import { makeRiddleEvent, pickEvent, CROW_GAG, CROW_SHOO_LIMIT } from "../game/events.js";
import { FESTIVALS, festivalForDay } from "../game/festivals.js";
import { WHEEL, pickWheel, fateLuck } from "../game/wheel.js";
import { ACHIEVEMENTS } from "../game/achievements.js";
import { skyAt } from "../game/sky.js";
import { advanceTick, duskBonus } from "../game/engine.js";
import { KEY, store } from "../storage.js";
import { Sfx, Haptics } from "../audio.js";
import { DEFAULT_META, migrateMeta } from "../constants.js";

export function useGameLoop({ dayTaps, event, festEventsRef, metaRef, phase, setEvent, setG, setMeta, setPhase, setResult, setWheel, unlock, wheelRef }) {
  useEffect(() => {
    if (phase !== "playing") return;
    const iv = setInterval(() => {
      setG(prev => {
        if (wheelRef.current) return prev; // Колесо Фортуни ставить день на паузу
        // увесь неперервний крок дня — у чистому рушії (його ж використовує симулятор)
        const { g: n, rainchild, wantEvent, dusk, dead } = advanceTick(prev, { eventOpen: !!event });
        if (rainchild) unlock("rainchild");
        // не запускати подій/Колесо в останні ~13с дня (щоб не вискакували перед сутінками)
        if (wantEvent) {
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
            // прикол: достатньо разів прогнав крука → злітається все кодло (раз за забіг)
            else if ((n.crowShoo || 0) >= CROW_SHOO_LIMIT && !n.crowGagDone) {
              n.crowGagDone = true; n.eventCd = { ...(n.eventCd || {}), [CROW_GAG.t]: n.day };
              Haptics.event(); setEvent(CROW_GAG);
            }
            else {
              let ev = pickEvent(n, metaRef.current);
              n.eventCd = { ...(n.eventCd || {}), [ev.t]: n.day }; // кулдаун за базовою назвою події
              if (ev.riddle) { const rr = makeRiddleEvent(n.usedRiddles); ev = rr.ev; n.usedRiddles = rr.usedRiddles; } // загадки без повторів за забіг
              if (ev.once) setMeta(m => ({ ...m, seenOnce: { ...(m.seenOnce || {}), [ev.once]: true } }));
              Haptics.event(); setEvent(ev);
            }
          }
        }
        if (dusk) {
          n.pending += duskBonus(n, metaRef.current.moon); // дар за виживання до сутінків — за РОЗМІР, а не за номер дня
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
        if (dead) {
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
