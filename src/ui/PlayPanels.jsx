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

export default function PlayPanels({ buyRun, evap, g, net, w }) {
  return (
          <div className="kal-cols reveal">
            <div className="kal-card">
              <h3>Поглиблення <small>{g.cheapT > 0 ? `🏷️ знижка −40% (${Math.ceil(g.cheapT)}с)` : "ціна у воді"}</small></h3>
              {RUN_UPGRADES.map(u => {
                const lvl = g.levels[u.id] || 0, cost = runCost(u, lvl, g.maxWater, g.cheapT > 0 ? 0.6 : 1);
                const locked = u.req && !u.req(g);
                if (locked && u.hidden) return null; // прихований апгрейд (сюрприз) — не показуємо замкненим
                if (locked) return (
                  <div key={u.id} className="kal-up dis">
                    <div className="emo" style={{ filter: "grayscale(1)" }}>🔒</div>
                    <div className="body"><div className="nm">{u.nm}</div><div className="de">{u.lock || "ще не відкрито"}</div></div>
                  </div>
                );
                const can = g.water >= cost;
                return (
                  <div key={u.id} className={"kal-up clickable" + (can ? "" : " dis")} onClick={() => can && buyRun(u)}>
                    <div className="emo">{u.emo}</div>
                    <div className="body"><div className="nm">{u.nm}<span className="lvl">рів.{lvl}</span></div><div className="de">{u.de}</div></div>
                    <div className="cost">{fmt(cost)} 💧</div>
                  </div>
                );
              })}
            </div>
            <div className="kal-card">
              <h3>Стан калабані <small>{w.icon} {w.name}</small></h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 15 }}>
                <Stat l="Випар" v={`${fmt(evap)}/с`} c="var(--bad)" />
                <Stat l="Приплив" v={`+${fmt(g.passive + w.rainPower)}/с`} c="var(--good)" />
                <Stat l="Чистий" v={`${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))}/с`} c={net >= 0 ? "var(--good)" : "var(--bad)"} />
                <Stat l="Вбирання" v={`+${fmt(ABSORB_BASE * g.absorbMult * (g.absorbBoostT > 0 ? 1.9 : 1) * (1 + w.absorbMod))}/тап`} c="var(--water-a)" />
                <Stat l="Наповнення" v={`${Math.round(clamp(g.water / g.maxWater, 0, 1) * 100)}%`} c="var(--ink)" />
                <Stat l="Волога ґрунту" v={`${Math.round(g.soil)}%`} c="var(--ink)" />
                <Stat l="Опір спеці 🟤" v={`${Math.round(g.sunResist * 100)}%`} c="var(--ink)" />
                {warmingDrain(g.day, g.maxWater) * (g.ecoMult ?? 1) * (1 + w.evapMod) > 0.05 && <Stat l="Потепління 🌡️" v={`−${fmt(warmingDrain(g.day, g.maxWater) * (g.ecoMult ?? 1) * (1 + w.evapMod))}/с`} c="var(--bad)" />}
                <Stat l="Сутність ◈" v={`${fmt(g.pending)}${w.essMod ? ` ·${(1 + w.essMod).toFixed(1)}×` : ""}`} c="var(--essence)" />
                <Stat l="Збір ◈ (більша калабаня — більше)" v={`+${fmt((g.essRate || 0.10) * sizeMul(g.maxWater) * effEss(g))}/с`} c="var(--essence)" />
                {(g.speed || 1) > 1.01 && <Stat l="Швидкість ⏩" v={`×${(g.speed).toFixed(2)}`} c="var(--essence)" />}
              </div>
              <div className="kal-fxchips">
                {g.shadeT > 0 && <span>🌑 тінь {Math.ceil(g.shadeT)}с</span>}
                {g.evapBoostT > 0 && <span className="bad">♨️ випар {Math.ceil(g.evapBoostT)}с</span>}
                {g.absorbBoostT > 0 && <span className="good">💧 вбирання {Math.ceil(g.absorbBoostT)}с</span>}
                {g.leaf > 0 && <span>🍂 листя −{Math.round(g.leaf * 100)}% випару</span>}
                {g.cheapT > 0 && <span className="good">🏷️ −40% поглиблення {Math.ceil(g.cheapT)}с</span>}
                {g.shadeT <= 0 && g.evapBoostT <= 0 && g.absorbBoostT <= 0 && g.leaf <= 0 && g.cheapT <= 0 && <span className="idle">Небо тремтить у твоєму дзеркалі…</span>}
              </div>
            </div>
          </div>
  );
}
