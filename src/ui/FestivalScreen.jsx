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

export default function FestivalScreen({ g, phase, startFestival }) {
        const f = festivalForDay(g.day) || FESTIVALS[0];
        return (
          <div className="kal-over">
            <div className={"kal-panel " + (f.tone || "win")} style={{ textAlign: "center" }}>
              <span className="kal-tag">день {g.day} · свято за квитком</span>
              <div style={{ fontSize: 56, lineHeight: 1, margin: "6px 0 2px" }}>{f.emo}</div>
              <div className="kal-big" style={{ fontSize: "clamp(22px,5.5vw,36px)", color: f.color }}>{f.nm}</div>
              <div className="kal-lore">{f.intro}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "-6px 0 4px", fontStyle: "italic" }}>Торкатися не можна — лише святкуй. Та не дай собі висохнути: користуйся друзями!</div>
              <button className="kal-go" onClick={startFestival}>Почати свято →</button>
            </div>
          </div>
        );
}
