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

export default function EventModal({ event, eventT, g, meta, resolveEvent }) {
  return (
        <div className={"kal-evt" + (event.cunning ? " cunning" : "")}>
          <div className="ehead"><div className="eemo"><span className="eemo-ring" />{event.emo}{event.art && <SafeImg className="eemo-img" src={`${import.meta.env.BASE_URL}events/${event.art}.webp`} />}</div><div className="et">{event.t}</div></div>
          {event.timer ? <div className="evt-timer"><i style={{ width: `${clamp((eventT / event.timer) * 100, 0, 100)}%` }} /></div> : null}
          <div className="ed">{event.d}</div>
          <div className="opts">{event.opts.map((o, i) => <button key={i} className="kal-btn" onClick={() => resolveEvent(o)}><b>{o.b}</b><small>{o.sf ? o.sf(g) : o.s}</small></button>)}</div>
        </div>
  );
}
