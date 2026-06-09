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

export default function DeathScreen({ finalizeDeath, meta, naperstky, pickNaperstok, rescue, rescueCost, rescuePct, rescuePool, rescuing, result, tryRescue }) {
  return (
        <div className="kal-over">
          <div className="kal-panel danger" style={{ textAlign: "center" }}>
            <span className="kal-tag">кінець</span>
            <div className="kal-big" style={{ color: "var(--dry)" }}>Ти висохла.</div>
            {rescuing ? (
              <div className="kal-lore">
                {rescue === "shuffle" ? "Шахрай долі тасує наперстки… стеж, де крапля життя."
                  : rescue === "pick" ? "Під одним із наперстків — крапля. Обери, не схибивши."
                  : naperstky.won ? "Наперсток підіймається… а під ним блищить крапля!"
                  : "Наперсток порожній. Крапля була не тут…"}
              </div>
            ) : rescue === "lose" ? (
              <div className="kal-lore">Цього разу наперстки тебе ошукали… ти таки висохла.</div>
            ) : (
              <div className="kal-lore">Остання крапля піднялась у небо парою. На сухій землі лишилось темне коло — з нього проросте нова калабаня.</div>
            )}
            {rescuing && (
              <div className={"kal-naperstky" + (rescue === "shuffle" ? " shuffling" : "")}>
                {[0, 1, 2].map(i => (
                  <button
                    key={i}
                    className={"naperstok"
                      + (rescue === "reveal" ? " lift" : "")
                      + (rescue === "reveal" && naperstky.drop === i ? " has-drop" : "")
                      + (naperstky.picked === i ? " picked" : "")}
                    disabled={rescue !== "pick"}
                    onClick={() => pickNaperstok(i)}
                  >
                    <span className="pea">💧</span>
                    <span className="cup" />
                    <span className="shadow" />
                  </button>
                ))}
              </div>
            )}
            <div className="kal-grid2">
              <ResStat l="Прожито" v={`день ${result.day}`} />
              <ResStat l="Трималась" v={`${result.secs}с`} />
              <ResStat l="Назбирано сутності" v={`◈ ${fmt(result.gained)}`} hi />
              <ResStat l="Усього мандрівок" v={meta.runs} />
            </div>
            {!rescuing && (() => {
              const cost = rescueCost(), canAfford = rescuePool() >= cost;
              return (
                <button className="kal-go" disabled={!canAfford} onClick={tryRescue} style={{ opacity: canAfford ? 1 : 0.5, background: "linear-gradient(180deg,#e0c060,#b8902f)", color: "#1a1206" }}>
                  🥃 {rescue === "lose" ? "Зіграти ще раз" : "Зіграти в наперстки"} (−◈ {fmt(cost)})
                </button>
              );
            })()}
            {!rescuing && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Наперстки можуть врятувати… а можуть і ні. Ціна — {Math.round(rescuePct() * 100)}% сутності, списується одразу й дорожчає щоразу.</div>}
            {!rescuing && <button className="kal-go ghost" onClick={finalizeDeath}>Прийняти долю → до вівтаря (забрати ◈ {fmt(result.gained)})</button>}
          </div>
        </div>
  );
}
