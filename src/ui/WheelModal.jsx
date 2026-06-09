/* AUTO-EXTRACTED from App.jsx — presentational component. */
import { fmt, clamp, mix, shuffle } from "../game/format.js";
import { SYMBOLS, NEUTRAL, rollForecast, computeWeather } from "../game/weather.js";
import { ABSORB_BASE, RUN_UPGRADES, runCost, META_UPGRADES, META_TIER2_DAY, PRESTIGE_UNLOCK, cloudsFrom, PRESTIGE_UPGRADES, CHALLENGES, challengeForDay, applyChallenge, effEss, sizeMul, aw, eAmt, tempC, warmingDrain, rankName, evapPerSec, freshRun } from "../game/balance.js";
import { friendCount, PERMA_FRIENDS, friendBaseline, ABILITIES, SYNERGY, synKey, PREY_ACC, joinUa } from "../game/characters.js";
import { FESTIVALS, festivalForDay } from "../game/festivals.js";
import { WHEEL, pickWheel, fateLuck } from "../game/wheel.js";
import { ACHIEVEMENTS } from "../game/achievements.js";
import { Sfx, Haptics } from "../audio.js";
import { SafeImg, Stat, ResStat } from "./atoms.jsx";
import Reel from "./Reel.jsx";

export default function WheelModal({ acceptWheel, declineWheel, g, luck, meta, rerollWheel, spin, spinWheel, wheel, wheelRerollCost, wheelRot }) {
  return (
        <div className="kal-over">
          <div className="kal-panel wheel-panel" style={{ textAlign: "center" }}>
            <div className="wheel-scroll">
              <span className="kal-tag">рідкісне</span>
              <div className="kal-big" style={{ fontSize: "clamp(24px,6vw,38px)", marginBottom: 4 }}>Колесо Фортуни</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>Крутни — і доля сама вирішить: щось чудове, лихе або нічого. Можна й відмовитись.</div>
              <div className="wheel-wrap">
                <div className="wheel-aura" style={{ opacity: luck * 0.9 }} />
                <div className="wheel-pointer" style={{ borderTopColor: mix("#ffffff", "#ffd05a", luck), filter: `drop-shadow(0 2px 3px rgba(0,0,0,.5)) drop-shadow(0 0 ${luck * 7}px rgba(255,205,90,${luck * 0.9}))` }} />
                <div className="wheel" style={{ transform: `rotate(${wheelRot}deg)`, background: `conic-gradient(from -22.5deg, ${WHEEL.map((s, i) => `${s.col} ${i * 45}deg ${(i + 1) * 45}deg`).join(",")})` }}>
                  {WHEEL.map((s, i) => (
                    <div key={i} className="wheel-lbl" style={{ transform: `rotate(${i * 45}deg) translateY(calc(var(--wsz) * -0.374)) rotate(${-i * 45}deg)` }}>{s.emo}</div>
                  ))}
                </div>
                <div className="wheel-hub" />
                {wheel.stage === "done" && <div className="wheel-win" />}
              </div>
              {wheel.stage === "done" && (
                <div className="kal-reveal">
                  <div className="fc-name" style={{ color: WHEEL[wheel.idx].tier === "jackpot" ? "var(--essence)" : WHEEL[wheel.idx].tier === "good" ? "var(--good)" : WHEEL[wheel.idx].tier === "none" ? "var(--muted)" : "var(--bad)" }}>{WHEEL[wheel.idx].emo} {WHEEL[wheel.idx].nm}</div>
                  <div style={{ fontSize: 13.5, color: "#cfe6ea", margin: "8px 0 2px", fontStyle: "italic" }}>{WHEEL[wheel.idx].msg}</div>
                </div>
              )}
            </div>
            <div className="wheel-foot">
              {wheel.stage === "done" ? (() => {
                const rrCost = wheelRerollCost(wheel.rr, g.day);
                const canRR = ((g.pending || 0) + (meta.essence || 0)) >= rrCost;
                return (
                  <>
                    <button className="kal-go" onClick={acceptWheel}>Прийняти →</button>
                    <button className="kal-go ghost" disabled={!canRR} onClick={rerollWheel} style={{ opacity: canRR ? 1 : 0.5 }}>🎡 Перекрутити (−◈ {fmt(rrCost)})</button>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Сектор діє лише коли «Прийняти». Перекрут коштує сутності й дорожчає.</div>
                  </>
                );
              })() : (
                <>
                  <button className="kal-go" disabled={wheel.stage === "spin"} onClick={spinWheel} style={{ opacity: wheel.stage === "spin" ? 0.5 : 1 }}>🎡 Крутити колесо</button>
                  <button className="kal-go ghost" disabled={wheel.stage === "spin"} onClick={declineWheel} style={{ opacity: wheel.stage === "spin" ? 0.5 : 1 }}>Відмовитися</button>
                </>
              )}
            </div>
          </div>
        </div>
  );
}
