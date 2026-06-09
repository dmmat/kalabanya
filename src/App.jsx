import React, { useState, useEffect, useRef, useCallback } from "react";
import WaterPuddle from "./WaterPuddle.jsx";
import { fmt, clamp, mix, shuffle } from "./game/format.js";
import { SYMBOLS, NEUTRAL, rollForecast, computeWeather } from "./game/weather.js";
import { ABSORB_BASE, RUN_UPGRADES, runCost, META_UPGRADES, META_TIER2_DAY, PRESTIGE_UNLOCK, cloudsFrom, PRESTIGE_UPGRADES, CHALLENGES, challengeForDay, applyChallenge, effEss, sizeMul, aw, eAmt, tempC, warmingDrain, rankName, evapPerSec, freshRun } from "./game/balance.js";
import { friendCount, PERMA_FRIENDS, friendBaseline, ABILITIES, SYNERGY, synKey, PREY_ACC, joinUa } from "./game/characters.js";
import { makeRiddleEvent, pickEvent } from "./game/events.js";
import { FESTIVALS, festivalForDay } from "./game/festivals.js";
import { WHEEL, pickWheel, fateLuck } from "./game/wheel.js";
import { ACHIEVEMENTS } from "./game/achievements.js";
import { skyAt } from "./game/sky.js";
import { KEY, store } from "./storage.js";
import { Sfx, Haptics } from "./audio.js";
import { DEFAULT_META, migrateMeta } from "./constants.js";
import Reel from "./ui/Reel.jsx";
import { SafeImg, Stat, ResStat } from "./ui/atoms.jsx";
import { useGame } from "./hooks/useGame.js";
import AbilityBar from "./ui/AbilityBar.jsx";
import AchievementsPopup from "./ui/AchievementsPopup.jsx";
import AltarMenu from "./ui/AltarMenu.jsx";
import ChallengeScreen from "./ui/ChallengeScreen.jsx";
import CodexPopup from "./ui/CodexPopup.jsx";
import DeathScreen from "./ui/DeathScreen.jsx";
import EventModal from "./ui/EventModal.jsx";
import FestivalScreen from "./ui/FestivalScreen.jsx";
import ForecastScreen from "./ui/ForecastScreen.jsx";
import PlayHeatRow from "./ui/PlayHeatRow.jsx";
import PlayPanels from "./ui/PlayPanels.jsx";
import PlayTodRow from "./ui/PlayTodRow.jsx";
import SettingsPopup from "./ui/SettingsPopup.jsx";
import SurvivedScreen from "./ui/SurvivedScreen.jsx";
import Toasts from "./ui/Toasts.jsx";
import WelcomeScreen from "./ui/WelcomeScreen.jsx";
import WheelModal from "./ui/WheelModal.jsx";


/* =========================================================================
   КАЛАБАНЯ — інкрементальна roguelike про калюжу, що висихає.
   Прогноз погоди = слот-машина. Погода керує днем. Тримайся до сутінків.
   Цикл день-ніч, досягнення, події, звук. Збереження: localStorage (+fallback).
   ========================================================================= */

export default function App() {
  const {
    phase, setPhase, g, setG, meta, setMeta, event, setEvent, fx, setFx, result, setResult, io, setIo, popup, setPopup, toasts, setToasts, waterOk, setWaterOk, wheel, setWheel, wheelRot, setWheelRot, eventT, setEventT, combo, setCombo, confirmEnd, setConfirmEnd, abilFx, setAbilFx, rescue, setRescue, naperstky, setNaperstky, comboRef, comboHideRef, abilFxRef, resolveEventRef, stageRef, wheelRef, reels, setReels, spinKey, setSpinKey, spinning, setSpinning, fcResult, setFcResult, respins, setRespins, freeSpins, setFreeSpins, loaded, gRef, phaseRef, metaRef, dayTaps, festEventsRef, resultRef, bootForecast, wakeLockRef, unlock, checkVol, absorb, buyRun, buyMeta, buyPrestige, doPrestige, abilCD, flashAbil, useAbility, resolveEvent, useAbilityRef, declineWheel, wheelRerollCost, wheelPool, spinWheelTo, spinWheel, rerollWheel, acceptWheel, spin, enterForecast, startJourney, buyPerma, buyTicket, acceptForecast, continueDay, startFestival, acceptChallenge, endJourney, rescuePool, rescuePct, rescueCost, finalizeDeath, rescuing, tryRescue, pickNaperstok, exportProgress, copyExport, importProgress, wipe, w, luck, ratio, size, evap, net, dryT, waterCol, waterEdge, sunT, sunCol, vaporN, rainN, snowN, timeLeft, respinCost, tierCol, todT, sky, showSunArc, sunArcLeft, sunArcTop, sunArcSize, phaseLabel, waterBgDay, waterBgNight, waterMap,
  } = useGame();

  if (phase === "loading") return <div className="kal-root"><div style={{ padding: 40, textAlign: "center", color: "#6f9099", fontFamily: "Fraunces, serif", fontStyle: "italic" }}>збираю краплі…</div></div>;

  return (
    <div className="kal-root">
      {/* ACHIEVEMENT TOASTS */}
      {toasts.length > 0 && <Toasts toasts={toasts} />}

      <div className="kal-wrap">
        {/* TOP */}
        <div className="kal-top reveal">
          <div>
            <div className="kal-title">КАЛАБАНЯ<span>, що висихає</span></div>
            <div className="kal-sub">{rankName(g.maxWater)} · день {g.day}</div>
          </div>
          <div className="kal-stat">
            <div><div className="lab">Сутність</div><div className="val kal-ess">◈ {fmt(meta.essence)}</div></div>
            {(meta.clouds > 0 || meta.ascensions > 0) && <div><div className="lab">Хмари</div><div className="val kal-clouds">☁ {fmt(meta.clouds || 0)}</div></div>}
            <div><div className="lab">Рекорд</div><div className="val kal-num">{meta.best} дн.</div></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="kal-toolbtn" title="Досягнення" onClick={() => { Sfx.click(); setPopup("ach"); }}>🏆</button>
              <button className="kal-toolbtn" title="Як грати" onClick={() => { Sfx.click(); setPopup("codex"); }}>?</button>
              <button className="kal-toolbtn" title="Налаштування" onClick={() => { Sfx.click(); setPopup("settings"); }}>⚙</button>
            </div>
          </div>
        </div>

        {phase === "playing" && <PlayHeatRow g={g} sunCol={sunCol} tierCol={tierCol} timeLeft={timeLeft} w={w} />}
        {phase === "playing" && <PlayTodRow phaseLabel={phaseLabel} todT={todT} />}

        {/* STAGE — pinned (only the puddle card) while playing on phones */}
        <div className={"kal-stagewrap" + (phase === "playing" ? " sticky" : "")}>
        <div className={"kal-stage reveal" + (phase === "playing" ? " live" : "")} ref={stageRef} onClick={absorb}>
          <div className="kal-sky" style={{ background: sky.gradient }} />
          <div className="kal-stars" style={{ "--star": sky.star, opacity: sky.star }} />
          {!waterOk && sky.star > 0.4 && <div className="kal-moon" style={{ opacity: sky.star }} />}

          {/* procedural fallback puddle (shown only if the water canvas assets failed) */}
          {!waterOk && <>
            <div className="kal-ground" style={{ filter: `brightness(${0.7 + 0.5 * Math.sin(Math.PI * todT)})` }} />
            {showSunArc && <>
              <div className="kal-rays" style={{ opacity: sunT * 0.5, background: `conic-gradient(from 0deg at ${sunArcLeft}% ${sunArcTop / 3.8}%, transparent 0deg, ${sunCol}33 8deg, transparent 16deg, transparent 40deg, ${sunCol}22 48deg, transparent 56deg)` }} />
              <div className="kal-sun" style={{ left: `${sunArcLeft}%`, top: sunArcTop, width: sunArcSize, height: sunArcSize, background: `radial-gradient(circle at 38% 38%, #fff7e0, ${sunCol} 55%, transparent 72%)`, boxShadow: `0 0 ${30 + sunT * 70}px ${10 + sunT * 30}px ${sunCol}66`, opacity: 0.6 + sunT * 0.4 }} />
            </>}
            <div className="kal-puddle" style={{ width: size, height: size * 0.62 }}>
              <div className="kal-blob" style={{ background: `radial-gradient(120% 130% at 50% 25%, ${waterEdge}, ${waterCol} 55%, ${mix("#0c4a58", "#3a2414", dryT)} 100%)` }} />
              <div className="kal-crack" style={{ opacity: clamp((dryT - 0.55) * 2.5, 0, 0.85) }} />
              <div className="kal-sheen" style={{ opacity: 0.7 * ratio }} />
              <div className="kal-pmid"><b>{fmt(g.water)}</b><small>/ {fmt(g.maxWater)} води</small></div>
            </div>
          </>}

          {/* procedural water (canvas) — основний шар; returns null self if assets fail */}
          <WaterPuddle
            fill={ratio}
            tod={todT}
            night={sky.star}
            active={phase === "playing"}
            fxEvents={fx}
            bgDayUrl={waterBgDay}
            bgNightUrl={waterBgNight}
            mapUrl={waterMap}
            lowGfx={meta.lowGfx}
            onError={() => setWaterOk(false)}
          />

          {/* weather particles (both modes) */}
          {phase === "playing" && Array.from({ length: rainN }).map((_, i) => (
            <div key={"r" + i} className="kal-rain" style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 1.2}s`, animationDuration: `${0.6 + Math.random() * 0.5}s` }} />
          ))}
          {Array.from({ length: snowN }).map((_, i) => (
            <div key={"s" + i} className="kal-snow" style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 2}s`, animationDuration: `${2.5 + Math.random() * 2}s` }} />
          ))}
          {phase === "playing" && Array.from({ length: vaporN }).map((_, i) => (
            <div key={"v" + i} className="kal-vapor" style={{ left: `${42 + Math.random() * 16}%`, animationDelay: `${i * 0.35}s`, animationDuration: `${2 + Math.random()}s` }} />
          ))}

          {/* storm lightning flashes */}
          {phase === "playing" && (w.icon === "⛈️" || w.rainPower >= 0.65) && <div className="kal-lightning" />}

          {/* event ambiance — themed emoji burst + glow when a gost appears */}
          {event && phase === "playing" && (
            <div className="kal-eventfx" key={event.t}>
              <div className="kal-eventglow" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={"ef" + i} className="ef-emoji" style={{ left: `${12 + Math.random() * 76}%`, animationDelay: `${Math.random() * 1.1}s`, "--r": `${Math.random() * 70 - 35}deg`, fontSize: `${20 + Math.random() * 16}px` }}>{event.emo}</div>
              ))}
            </div>
          )}

          {/* positional ripple FX (both modes) */}
          {fx.map(r => (
            <div key={r.id} className="kal-fx" style={{ left: `${r.x}%`, top: `${r.y}%` }}>
              {!waterOk && <div className="kal-ripple" />}
              {r.amt > 0 && <div className="kal-gain kal-num">+{r.amt.toFixed(1)}</div>}
            </div>
          ))}

          {/* water HUD overlay (shown over the water canvas) */}
          {phase === "playing" && (
            <div className="kal-hud kal-pmid"><b>{fmt(g.water)}</b><small>/ {fmt(g.maxWater)} води</small></div>
          )}
          {phase === "playing" && <div className="kal-hint">{g.festival ? `🎉 свято — просто святкуй · ${w.icon} злива-благодать` : `торкайся, щоб вбирати · ${net >= 0 ? "▲" : "▼"} ${fmt(Math.abs(net))}/с ${w.icon}`}</div>}
        </div>
        </div>{/* end stage wrap */}

        {/* ACTIVE ABILITIES (appear only once befriended — a surprise) */}
        {phase === "playing" && ABILITIES.some(a => a.req(meta, g)) && <AbilityBar abilCD={abilCD} abilFx={abilFx} combo={combo} g={g} meta={meta} useAbility={useAbility} />}

        {/* PLAY PANELS */}
        {phase === "playing" && <PlayPanels buyRun={buyRun} evap={evap} g={g} net={net} w={w} />}

        {/* MENU */}
        {phase === "menu" && <AltarMenu buyMeta={buyMeta} buyPerma={buyPerma} buyPrestige={buyPrestige} buyTicket={buyTicket} copyExport={copyExport} doPrestige={doPrestige} exportProgress={exportProgress} importProgress={importProgress} io={io} meta={meta} setIo={setIo} sky={sky} startJourney={startJourney} wipe={wipe} />}
      </div>

      {/* EVENT */}
      {event && phase === "playing" && <EventModal event={event} eventT={eventT} g={g} meta={meta} resolveEvent={resolveEvent} />}

      {/* WHEEL OF FORTUNE (rare) */}
      {wheel && <WheelModal acceptWheel={acceptWheel} declineWheel={declineWheel} g={g} luck={luck} meta={meta} rerollWheel={rerollWheel} spin={spin} spinWheel={spinWheel} wheel={wheel} wheelRerollCost={wheelRerollCost} wheelRot={wheelRot} />}

      {/* CHALLENGE DAY (no forecast — fact, not warning) */}
      {phase === "challenge" && <ChallengeScreen acceptChallenge={acceptChallenge} g={g} phase={phase} />}

      {/* FESTIVALS (ticketed special days — no forecast, can't tap, events flow) */}
      {phase === "festival" && <FestivalScreen g={g} phase={phase} startFestival={startFestival} />}

      {/* FORECAST SLOT */}
      {phase === "forecast" && <ForecastScreen acceptForecast={acceptForecast} fcResult={fcResult} freeSpins={freeSpins} g={g} reels={reels} respinCost={respinCost} spin={spin} spinKey={spinKey} spinning={spinning} tierCol={tierCol} />}

      {/* DEATH */}
      {phase === "dead" && result && <DeathScreen finalizeDeath={finalizeDeath} meta={meta} naperstky={naperstky} pickNaperstok={pickNaperstok} rescue={rescue} rescueCost={rescueCost} rescuePct={rescuePct} rescuePool={rescuePool} rescuing={rescuing} result={result} tryRescue={tryRescue} />}

      {/* SURVIVED */}
      {phase === "survived" && <SurvivedScreen confirmEnd={confirmEnd} continueDay={continueDay} endJourney={endJourney} g={g} setConfirmEnd={setConfirmEnd} />}

      {/* ACHIEVEMENTS POPUP */}
      {popup === "ach" && <AchievementsPopup meta={meta} setPopup={setPopup} />}

      {/* CODEX / HELP POPUP */}
      {popup === "codex" && <CodexPopup evap={evap} setPopup={setPopup} />}

      {/* WELCOME / INTRO */}
      {phase === "welcome" && <WelcomeScreen meta={meta} setPhase={setPhase} setPopup={setPopup} setWaterOk={setWaterOk} startJourney={startJourney} waterOk={waterOk} />}

      {/* SETTINGS POPUP */}
      {popup === "settings" && <SettingsPopup copyExport={copyExport} exportProgress={exportProgress} importProgress={importProgress} io={io} meta={meta} setIo={setIo} setMeta={setMeta} setPopup={setPopup} wipe={wipe} />}
    </div>
  );
}
