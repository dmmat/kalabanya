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

export default function AltarMenu({ buyMeta, buyPerma, buyPrestige, buyTicket, copyExport, doPrestige, exportProgress, importProgress, io, meta, setIo, sky, startJourney, wipe }) {
  return (
          <>
            <div className="kal-menubg-wrap">
              <SafeImg className="kal-menubg" src={`${import.meta.env.BASE_URL}scenes/altar.webp`} />
            </div>
            <div className="kal-card reveal" style={{ marginTop: 16 }}>
              <span className="kal-tag">між мандрівками</span>
              <div className="kal-lore">Кожна калабаня мріє стати озером, а потай — океаном. Та сонце п'є тебе краплю за краплею, і з кожним днем дужчає потепління. Витрачай <span className="kal-ess">Сутність</span>, що лишили попередні твої «я», й рости далі.</div>
              <button className="kal-go" onClick={startJourney} style={{ marginTop: 4, marginBottom: 4 }}>Стати калабанею знову →</button>
              <div className="seclab">Постійні дари</div>
              {META_UPGRADES.filter(u => u.tier !== 2 && (!u.req || u.req(meta))).map(u => {
                const lvl = meta[u.id] || 0, maxed = lvl >= u.max, cost = Math.round(u.base * Math.pow(u.growth, lvl)), can = !maxed && meta.essence >= cost;
                return (
                  <div key={u.id} className={"kal-up meta clickable" + (can || maxed ? "" : " dis")} onClick={() => can && buyMeta(u)} style={maxed ? { cursor: "default", opacity: 0.7 } : {}}>
                    <div className="emo">{u.emo}</div>
                    <div className="body"><div className="nm">{u.nm}<span className="lvl">{u.inf ? `рів.${lvl}` : `${lvl}/${u.max}`}</span></div><div className="de">{u.de}</div></div>
                    <div className="cost">{maxed ? "✦" : `◈ ${fmt(cost)}`}</div>
                  </div>
                );
              })}
              {meta.best >= META_TIER2_DAY ? (
                <>
                  <div className="seclab" style={{ marginTop: 12, color: "var(--essence)" }}>Глибинні дари ✦</div>
                  {META_UPGRADES.filter(u => u.tier === 2).map(u => {
                    const lvl = meta[u.id] || 0, maxed = lvl >= u.max, cost = Math.round(u.base * Math.pow(u.growth, lvl)), can = !maxed && meta.essence >= cost;
                    return (
                      <div key={u.id} className={"kal-up meta clickable" + (can || maxed ? "" : " dis")} onClick={() => can && buyMeta(u)} style={maxed ? { cursor: "default", opacity: 0.7 } : {}}>
                        <div className="emo">{u.emo}</div>
                        <div className="body"><div className="nm">{u.nm}<span className="lvl">{lvl}/{u.max}</span></div><div className="de">{u.de}</div></div>
                        <div className="cost">{maxed ? "✦" : `◈ ${fmt(cost)}`}</div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="kal-up dis" style={{ marginTop: 8 }}>
                  <div className="emo">🔒</div>
                  <div className="body"><div className="nm">Глибинні дари</div><div className="de">Відкриються, коли проживеш {META_TIER2_DAY} днів за одну мандрівку.</div></div>
                </div>
              )}
            </div>

            <div className="kal-card reveal" style={{ marginTop: 14 }}>
              <span className="kal-tag">квитки на фестивалі</span>
              <div className="kal-lore">За <span className="kal-ess">Сутність</span> придбай квиток на фестиваль — і він трапиться у твоєму наступному забігу в свій день. Квиток діє <b>один забіг</b>. Торкатися там не можна, тож приходь із друзями, щоб не висохнути.</div>
              {FESTIVALS.map(f => {
                const owned = !!(meta.tickets || {})[f.id];
                const need = Math.max(0, f.day - 5); // фестивалі відкриваються поступово — у міру зростання рекорду
                const revealed = owned || (meta.best || 0) >= need;
                if (!revealed) { // ще не дорослий до цього свята — показуємо як ціль
                  return (
                    <div key={f.id} className="kal-up dis" style={{ cursor: "default" }}>
                      <div className="emo">🔒</div>
                      <div className="body"><div className="nm">Свято попереду<span className="lvl">день {f.day}</span></div><div className="de">Відкриється за рекорду {need} дн.</div></div>
                      <div className="cost">◈ {fmt(f.ticket)}</div>
                    </div>
                  );
                }
                const can = !owned && meta.essence >= f.ticket;
                return (
                  <div key={f.id} className={"kal-up clickable" + (owned ? "" : can ? "" : " dis")} onClick={() => can && buyTicket(f)} style={owned ? { cursor: "default", borderColor: "var(--water-a)" } : {}}>
                    <div className="emo">{f.emo}</div>
                    <div className="body"><div className="nm">{f.nm}<span className="lvl">день {f.day}</span></div><div className="de">{f.weather.name}</div></div>
                    <div className="cost" style={owned ? { color: "var(--good)" } : {}}>{owned ? "✓ є квиток" : `◈ ${fmt(f.ticket)}`}</div>
                  </div>
                );
              })}
            </div>

            <div className="kal-card reveal" style={{ marginTop: 14 }}>
              <span className="kal-tag">друзі назавжди</span>
              <div className="kal-lore">Тепер дружби <b>скидаються щозабігу</b> — друзів треба здобувати знову через події. Та за <b>дуже багато</b> <span className="kal-ess">Сутності</span> можна <b>приручити</b> когось назавжди — і він стартуватиме з тобою в кожному забігу.</div>
              {PERMA_FRIENDS.map(f => {
                const owned = !!(meta.perma || {})[f.id];
                const met = owned || !!(meta.metFriends || {})[f.id];
                if (!met) return null; // нерозкритих друзів не показуємо — з'являються лише після знайомства
                const can = !owned && meta.essence >= f.cost;
                return (
                  <div key={f.id} className={"kal-up clickable" + (owned ? "" : can ? "" : " dis")} onClick={() => can && buyPerma(f)} style={owned ? { cursor: "default", borderColor: "var(--water-a)" } : {}}>
                    <div className="emo">{f.emo}</div>
                    <div className="body"><div className="nm">{f.nm}<span className="lvl">друг</span></div><div className="de">{owned ? "приручений назавжди" : "стартуватиме з тобою щозабігу"}</div></div>
                    <div className="cost" style={owned ? { color: "var(--good)" } : {}}>{owned ? "✓ назавжди" : `◈ ${fmt(f.cost)}`}</div>
                  </div>
                );
              })}
            </div>

            {!(meta.ascensions > 0 || (meta.lifeEss || 0) >= PRESTIGE_UNLOCK || (meta.best || 0) >= 12) && (() => {
              const prog = clamp((meta.lifeEss || 0) / PRESTIGE_UNLOCK, 0, 1);
              return (
                <div className="kal-card reveal" style={{ marginTop: 14 }}>
                  <span className="kal-tag">небо попереду</span>
                  <div className="kal-lore">Збери досить <span className="kal-ess">Сутності</span> за всі свої життя — і відкриється <b>Велике Випаровування</b>: піднімешся парою в небо, проллєшся новою калабанею й лишиш собі вічні <span className="kal-clouds">Хмари</span>.</div>
                  <div style={{ height: 10, borderRadius: 6, background: "rgba(255,255,255,0.10)", overflow: "hidden", marginTop: 4 }}>
                    <div style={{ height: "100%", width: `${(prog * 100).toFixed(1)}%`, background: "var(--essence)", borderRadius: 6, transition: "width .4s ease" }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 6 }}>
                    ◈ {fmt(Math.floor(meta.lifeEss || 0))} / {fmt(PRESTIGE_UNLOCK)} сутності за всі життя{prog >= 0.5 ? " · вже близько ☁" : ""}
                  </div>
                </div>
              );
            })()}

            {(meta.ascensions > 0 || (meta.lifeEss || 0) >= PRESTIGE_UNLOCK || (meta.best || 0) >= 12) && (() => {
              const gain = cloudsFrom(meta.essThisAsc);
              return (
                <div className="kal-card reveal kal-sky-card" style={{ marginTop: 14 }}>
                  <span className="kal-tag">небо</span>
                  <div className="kal-stat" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <div><div className="lab">Хмари</div><div className="val kal-clouds">☁ {fmt(meta.clouds || 0)}</div></div>
                    <div style={{ textAlign: "right" }}><div className="lab">Випаровувань</div><div className="val kal-num">{meta.ascensions || 0}</div></div>
                  </div>
                  <div className="kal-lore">Усе висихає. Та коли ти піднімешся парою в небо, то проллєшся новою калабанею — мудрішою. <span className="kal-clouds">Хмари</span> лишаються з тобою назавжди.</div>
                  <div className="seclab">Небесні дари ☁ <small style={{ color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>(вічні, не зникають)</small></div>
                  {PRESTIGE_UPGRADES.map(u => {
                    const lvl = meta[u.id] || 0, maxed = lvl >= u.max, cost = Math.round(u.base * Math.pow(u.growth, lvl)), can = !maxed && (meta.clouds || 0) >= cost;
                    return (
                      <div key={u.id} className={"kal-up sky clickable" + (can || maxed ? "" : " dis")} onClick={() => can && buyPrestige(u)} style={maxed ? { cursor: "default", opacity: 0.7 } : {}}>
                        <div className="emo">{u.emo}</div>
                        <div className="body"><div className="nm">{u.nm}<span className="lvl">{lvl}/{u.max}</span></div><div className="de">{u.de}</div></div>
                        <div className="cost">{maxed ? "✦" : `☁ ${fmt(cost)}`}</div>
                      </div>
                    );
                  })}
                  <button className="kal-go sky" disabled={gain < 1} onClick={doPrestige} style={{ opacity: gain < 1 ? 0.5 : 1, marginTop: 12 }}>
                    {gain < 1
                      ? `Велике Випаровування (треба ще сутності)`
                      : `🌥️ Велике Випаровування → +☁ ${gain}`}
                  </button>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "center", marginTop: 8, lineHeight: 1.4 }}>
                    Забере: всю сутність і «постійні дари». Лишить: хмари, небесні дари, досягнення, рекорд.
                  </div>
                </div>
              );
            })()}

            <div className="kal-card reveal" style={{ marginTop: 14 }}>
              <span className="kal-tag">сховище</span>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10, lineHeight: 1.4 }}>Прогрес зберігається автоматично. Можна перенести його на інший пристрій кодом.</div>
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
                    <button className="kal-mini" onClick={importProgress}>Завантажити</button>
                    <button className="kal-mini ghost" onClick={() => setIo({ open: false, text: "", msg: "" })}>Закрити</button>
                    {io.msg && <span style={{ fontSize: 12.5, color: "var(--water-a)" }}>{io.msg}</span>}
                  </div>
                </div>
              )}
            </div>
            <div className="kal-foot reveal">
              <div>КАЛАБАНЯ · поетична інкрементальна roguelike про калюжу, що висихає</div>
              <div><a href="https://github.com/dmmat/kalabanya" target="_blank" rel="noopener noreferrer">github.com/dmmat/kalabanya</a></div>
            </div>
          </>
  );
}
