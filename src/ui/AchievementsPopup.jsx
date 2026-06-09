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

export default function AchievementsPopup({ meta, setPopup }) {
  return (
        <div className="kal-over" onClick={() => setPopup(null)}>
          <div className="kal-panel" onClick={e => e.stopPropagation()}>
            <button className="kal-close" onClick={() => setPopup(null)}>✕</button>
            <span className="kal-tag">досягнення</span>
            <div className="kal-big" style={{ fontSize: "clamp(24px,5vw,34px)", marginBottom: 6 }}>Подвір'я пам'яті</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
              Відкрито {Object.keys(meta.ach || {}).filter(k => meta.ach[k]).length} / {ACHIEVEMENTS.length}
            </div>
            <div className="ach-grid">
              {ACHIEVEMENTS.map(a => {
                const got = meta.ach && meta.ach[a.id];
                const secret = a.hidden && !got; // приховане досягнення: текст ховаємо
                return (
                  <div key={a.id} className={"ach" + (got ? "" : " locked")}>
                    <div className="ae">{got ? a.e : secret ? "❔" : "🔒"}</div>
                    <div><div className="an">{secret ? "???" : a.nm}</div><div className="adq">{secret ? "Приховане досягнення" : a.dq}</div></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
  );
}
