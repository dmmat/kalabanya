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

export default function SurvivedScreen({ confirmEnd, continueDay, endJourney, g, setConfirmEnd }) {
  return (
        <div className="kal-over">
          <div className="kal-panel win" style={{ textAlign: "center" }}>
            <span className="kal-tag">сутінки</span>
            <div className="kal-big" style={{ color: "var(--water-a)" }}>Ти дожила до ночі.</div>
            <div className="kal-lore">Сонце сіло, повітря зволожніло — випар майже спинився. Ризикнути ще одним, спекотнішим днем — чи забрати сутність і піти у спокій?</div>
            <div className="kal-grid2" style={{ marginBottom: 6 }}>
              <ResStat l="Пережито днів" v={g.day} />
              <ResStat l="Об'єм" v={`${fmt(g.maxWater)} 💧`} />
              <ResStat l="Вода" v={`${fmt(g.water)} 💧`} />
              <ResStat l="Сутність" v={`◈ ${fmt(g.pending)}`} hi />
            </div>
            {!confirmEnd ? (
              <>
                <button className="kal-go" onClick={() => { setConfirmEnd(false); continueDay(); }}>Зустріти день {g.day + 1} (важче) →</button>
                <button className="kal-go ghost" onClick={() => { Sfx.click(); setConfirmEnd(true); }}>Завершити й забрати ◈ {fmt(Math.round(g.pending))}</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13.5, color: "var(--bad)", margin: "4px 0 8px", fontStyle: "italic" }}>Завершити забіг і піти у вівтар? Прогрес цього забігу скинеться.</div>
                <button className="kal-go" style={{ background: "linear-gradient(180deg,#e0c060,#b8902f)", color: "#1a1206" }} onClick={endJourney}>Так, забрати ◈ {fmt(Math.round(g.pending))}</button>
                <button className="kal-go ghost" onClick={() => { Sfx.click(); setConfirmEnd(false); }}>Ні, лишитись →</button>
              </>
            )}
          </div>
        </div>
  );
}
