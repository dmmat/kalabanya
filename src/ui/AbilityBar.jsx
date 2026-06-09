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

export default function AbilityBar({ abilCD, abilFx, combo, g, meta, useAbility }) {
  return (
          <div className="kal-abilities reveal">
            {combo >= 2 && <div className="kal-combo" key={combo}>КОМБО ×{combo}!</div>}
            {abilFx && <div className={"kal-abilfx " + abilFx.kind} key={abilFx.text}>{abilFx.text}</div>}
            {ABILITIES.filter(a => a.req(meta, g)).map((a, i) => {
              const cd = (g.abil && g.abil[a.id]) || 0;
              const max = abilCD(a);
              const hot = i < 9 ? String(i + 1) : i === 9 ? "0" : null; // 1-9, 0 для десятої
              const preyEmos = (a.prey || []).map(id => (ABILITIES.find(x => x.id === id) || {}).emo).filter(Boolean);
              const synEmos = Object.keys(SYNERGY).filter(k => k.split("+").includes(a.id))
                .map(k => (ABILITIES.find(x => x.id === k.split("+").find(id => id !== a.id)) || {}).emo).filter(Boolean);
              return (
                <button key={a.id} className={"kal-abil" + (cd > 0 ? " cd" : "")} disabled={cd > 0} onClick={() => useAbility(a)}>
                  {cd > 0 && <span className="ab-ring" style={{ background: `conic-gradient(rgba(0,0,0,.55) ${(cd / max) * 360}deg, transparent 0)` }} />}
                  <span className="ab-emo">{a.emo}</span>
                  {cd > 0 && <span className="ab-num">{Math.ceil(cd)}</span>}
                  {hot && cd <= 0 && <span className="ab-key">{hot}</span>}
                  <span className="ab-tip">
                    <b>{a.emo} {a.nm}</b>
                    <i>{a.tip}</i>
                    <em>Перезарядка ~{max}с · {a.kind}{hot ? ` · клавіша ${hot}` : ""}{cd > 0 ? ` · ще ${Math.ceil(cd)}с` : ""}</em>
                    {synEmos.length > 0 && <span className="good">Синергія: {synEmos.join(" ")}</span>}
                    {preyEmos.length > 0 && <span className="bad">Лякає: {preyEmos.join(" ")}</span>}
                  </span>
                </button>
              );
            })}
          </div>
  );
}
