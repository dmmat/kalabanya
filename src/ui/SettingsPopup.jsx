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

export default function SettingsPopup({ copyExport, exportProgress, importProgress, io, meta, setIo, setMeta, setPopup, wipe }) {
  return (
        <div className="kal-over" onClick={() => setPopup(null)}>
          <div className="kal-panel" onClick={e => e.stopPropagation()}>
            <button className="kal-close" onClick={() => setPopup(null)}>✕</button>
            <span className="kal-tag">налаштування</span>
            <div className="kal-big" style={{ fontSize: "clamp(24px,5vw,34px)", marginBottom: 14 }}>Тиша й звук</div>
            <div className="kal-up" style={{ cursor: "default" }}>
              <div className="emo">{meta.sound ? "🔊" : "🔇"}</div>
              <div className="body"><div className="nm">Звукові ефекти</div><div className="de">Краплі, барабани, фанфари сутінків.</div></div>
              <button className="kal-mini" onClick={() => { setMeta(m => ({ ...m, sound: !m.sound })); Sfx.click(); }}>{meta.sound ? "Увімкнено" : "Вимкнено"}</button>
            </div>
            <div className="kal-up" style={{ cursor: "default", marginTop: 6 }}>
              <div className="emo">{meta.keepAwake !== false ? "📱" : "🌙"}</div>
              <div className="body"><div className="nm">Не гасити екран</div><div className="de">Тримає екран увімкненим під час гри (тратить більше батареї).</div></div>
              <button className="kal-mini" onClick={() => { setMeta(m => ({ ...m, keepAwake: m.keepAwake === false ? true : false })); Sfx.click(); }}>{meta.keepAwake !== false ? "Увімкнено" : "Вимкнено"}</button>
            </div>
            <div className="kal-up" style={{ cursor: "default", marginTop: 6 }}>
              <div className="emo">{meta.haptics !== false ? "📳" : "🔕"}</div>
              <div className="body"><div className="nm">Вібрація</div><div className="de">Тактильний відгук на тап і події (телефон).</div></div>
              <button className="kal-mini" onClick={() => { setMeta(m => ({ ...m, haptics: m.haptics === false ? true : false })); Sfx.click(); Haptics.tap(); }}>{meta.haptics !== false ? "Увімкнено" : "Вимкнено"}</button>
            </div>
            <div className="kal-up" style={{ cursor: "default", marginTop: 6 }}>
              <div className="emo">{meta.lowGfx ? "⚡" : "🖌"}</div>
              <div className="body"><div className="nm">Спрощена графіка</div><div className="de">Легша вода для слабких пристроїв (нижча деталізація, ~30 к/с).</div></div>
              <button className="kal-mini" onClick={() => { setMeta(m => ({ ...m, lowGfx: !m.lowGfx })); Sfx.click(); }}>{meta.lowGfx ? "Увімкнено" : "Вимкнено"}</button>
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <div className="seclab">Збереження</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.4 }}>Можна зберегти або перенести прогрес будь-якої миті — навіть посеред дня.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="kal-mini" onClick={exportProgress}>⬇ Експортувати</button>
                <button className="kal-mini" onClick={() => setIo({ open: true, text: "", msg: "Встав сюди код збереження й натисни «Завантажити»." })}>⬆ Імпортувати</button>
                <button className="kal-mini danger" onClick={wipe}>✕ Стерти все</button>
              </div>
              {io.open && (
                <div style={{ marginTop: 12 }}>
                  <textarea className="kal-ta" value={io.text} onChange={e => setIo(o => ({ ...o, text: e.target.value }))} placeholder="код збереження…" spellCheck={false} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="kal-mini" onClick={copyExport}>Копіювати</button>
                    <button className="kal-mini" onClick={() => { importProgress(); setPopup(null); }}>Завантажити</button>
                    <button className="kal-mini ghost" onClick={() => setIo({ open: false, text: "", msg: "" })}>Закрити</button>
                    {io.msg && <span style={{ fontSize: 12.5, color: "var(--water-a)" }}>{io.msg}</span>}
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <div className="seclab">Статистика</div>
              <div className="kal-grid2">
                <ResStat l="Мандрівок" v={meta.runs} />
                <ResStat l="Рекорд днів" v={`${meta.best} дн.`} />
                <ResStat l="Найбільший об'єм" v={`${fmt(meta.maxVol || 120)} 💧`} />
                <ResStat l="Сутність" v={`◈ ${fmt(meta.essence)}`} hi />
                {(meta.clouds > 0 || meta.ascensions > 0) && <ResStat l="Хмари" v={`☁ ${fmt(meta.clouds || 0)}`} />}
                {meta.ascensions > 0 && <ResStat l="Випаровувань" v={meta.ascensions} />}
              </div>
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted)", textAlign: "center", lineHeight: 1.5 }}>
              КАЛАБАНЯ v1.0 · <a href="https://github.com/dmmat/kalabanya" target="_blank" rel="noopener noreferrer" style={{ color: "var(--water-a)" }}>вихідний код</a>
            </div>
          </div>
        </div>
  );
}
