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

export default function WelcomeScreen({ meta, setPhase, setPopup, setWaterOk, startJourney, waterOk }) {
  return (
        <div className="kal-welcome">
          {waterOk && (
            <img className="kal-welcome-bg" src={`${import.meta.env.BASE_URL}scenes/puddle-bg.webp`} alt="" draggable={false} onError={() => setWaterOk(false)} />
          )}
          <div className="kal-welcome-veil" />
          <div className="kal-welcome-inner">
            <span className="kal-tag">поетична інкрементальна roguelike</span>
            <h1 className="kal-welcome-title">КАЛАБАНЯ<span>, що висихає</span></h1>
            <p className="kal-welcome-tag">
              Ти — мала калабаня на узбіччі, що мріє стати ставком, озером… а може, й океаном.
              Та сонце п'є тебе краплю за краплею, і щодня дужчає глобальне потепління.
              Крути слот неба, тримайся до сутінків — і лиши по собі сутність.
            </p>
            <div className="kal-welcome-chips">
              <span>🎰 Слот неба</span>
              <span>🌗 День і ніч</span>
              <span>🏆 Досягнення</span>
              <span>💧 Виживання</span>
            </div>
            <button className="kal-go" onClick={() => { if (meta.runs > 0) { Sfx.dusk(); setPhase("menu"); } else { startJourney(); } }}>
              {meta.runs > 0 ? "До вівтаря калабань →" : "Стати калабанею →"}
            </button>
            <button className="kal-go ghost" onClick={() => { Sfx.click(); setPopup("codex"); }}>Як грати</button>
            <div className="kal-welcome-foot">
              автозбереження · {meta.best > 0 ? `рекорд ${meta.best} дн. · ` : ""}
              <a href="https://github.com/dmmat/kalabanya" target="_blank" rel="noopener noreferrer">github</a>
            </div>
          </div>
        </div>
  );
}
