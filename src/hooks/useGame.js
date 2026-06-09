/* AUTO-EXTRACTED from App.jsx — all game state, effects and handlers.
   Returns every local so App can destructure them and keep its JSX unchanged. */
import { useState, useEffect, useRef, useCallback } from "react";
import { fmt, clamp, mix, shuffle } from "../game/format.js";
import { SYMBOLS, NEUTRAL, rollForecast, computeWeather } from "../game/weather.js";
import { ABSORB_BASE, RUN_UPGRADES, runCost, META_UPGRADES, META_TIER2_DAY, PRESTIGE_UNLOCK, cloudsFrom, PRESTIGE_UPGRADES, CHALLENGES, challengeForDay, applyChallenge, effEss, sizeMul, aw, eAmt, tempC, warmingDrain, rankName, evapPerSec, freshRun } from "../game/balance.js";
import { friendCount, PERMA_FRIENDS, PERMA_FLAG, friendBaseline, ABILITIES, SYNERGY, synKey, PREY_ACC, joinUa } from "../game/characters.js";
import { makeRiddleEvent, pickEvent } from "../game/events.js";
import { FESTIVALS, festivalForDay } from "../game/festivals.js";
import { WHEEL, pickWheel, fateLuck } from "../game/wheel.js";
import { ACHIEVEMENTS } from "../game/achievements.js";
import { skyAt } from "../game/sky.js";
import { buyRunUpgrade } from "../game/engine.js";
import { KEY, store } from "../storage.js";
import { Sfx, Haptics } from "../audio.js";
import { DEFAULT_META, migrateMeta } from "../constants.js";
import { useGameLoop } from "./useGameLoop.js";
import { usePersistence } from "./usePersistence.js";
import { useWakeLock } from "./useWakeLock.js";

export function useGame() {
  const [phase, setPhase] = useState("loading"); // loading|welcome|menu|forecast|challenge|playing|dead|survived
  const [g, setG] = useState(() => freshRun({}));
  const [meta, setMeta] = useState(DEFAULT_META);
  const [event, setEvent] = useState(null);
  const [fx, setFx] = useState([]);
  const [result, setResult] = useState(null);
  const [io, setIo] = useState({ open: false, text: "", msg: "" });
  const [popup, setPopup] = useState(null); // null | "codex" | "ach" | "settings"
  const [toasts, setToasts] = useState([]);
  const [waterOk, setWaterOk] = useState(true); // procedural water assets (bg/map) present?
  const [wheel, setWheel] = useState(null); // null | { stage:"offer"|"spin"|"done", idx }
  const [wheelRot, setWheelRot] = useState(0);
  const [eventT, setEventT] = useState(0); // countdown for timed (passing) guests
  const [combo, setCombo] = useState(0); // ability combo display
  const [confirmEnd, setConfirmEnd] = useState(false); // підтвердження «завершити забіг» (щоб не міс-клікали)
  const [abilFx, setAbilFx] = useState(null); // { kind:"syn"|"clash", text } — спливний відгук синергії/конфлікту
  const [rescue, setRescue] = useState(null); // null | "shuffle" | "pick" | "reveal" | "lose" — наперстки на смерті
  const [naperstky, setNaperstky] = useState({ won: false, picked: -1, drop: -1 }); // стан гри в наперстки
  const comboRef = useRef({ count: 0, last: 0, ids: new Set(), lastId: null });
  const comboHideRef = useRef(null);
  const abilFxRef = useRef(null);
  const resolveEventRef = useRef(null);
  const stageRef = useRef(null);
  const wheelRef = useRef(null); wheelRef.current = wheel;

  // forecast slot state
  const [reels, setReels] = useState([0, 0, 0]);
  const [spinKey, setSpinKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [fcResult, setFcResult] = useState(null);
  const [respins, setRespins] = useState(0);
  const [freeSpins, setFreeSpins] = useState(0);

  const loaded = useRef(false);
  const gRef = useRef(g); gRef.current = g;
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const metaRef = useRef(meta); metaRef.current = meta;
  const dayTaps = useRef(0);
  const festEventsRef = useRef([]);
  const resultRef = useRef(result); resultRef.current = result;
  const bootForecast = useRef(false);

  useEffect(() => { Sfx.setMuted(!meta.sound); }, [meta.sound]);
  useEffect(() => { Haptics.setOn(meta.haptics !== false); }, [meta.haptics]);

  /* ---- keep screen awake while playing (Screen Wake Lock API) ---- */
  const wakeLockRef = useRef(null);
  useWakeLock({ meta, phase, wakeLockRef });

  /* ---- achievements ---- */
  const unlock = useCallback((id) => {
    if (metaRef.current.ach && metaRef.current.ach[id]) return;
    const def = ACHIEVEMENTS.find(a => a.id === id); if (!def) return;
    setMeta(m => ({ ...m, ach: { ...m.ach, [id]: true } }));
    const tid = Math.random();
    setToasts(t => [...t, { id: tid, def }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== tid)), 5200);
    Sfx.ach(); Haptics.good();
  }, []);
  // досягнення за об'ємом (мрія рости)
  // пороги збігаються з рангами (rankName): досягнення дають точно тоді, коли калабаня стає тим рангом
  const checkVol = useCallback((mw) => {
    if (mw >= 500) unlock("unfathom");
    if (mw >= 900) unlock("pond");        // стає «ставком»
    if (mw >= 6000) unlock("lakeach");    // стає «озером»
    if (mw >= 400000) unlock("ocean");    // стає «океаном» (Північний Льодовитий)
    if (mw >= 35000000) unlock("worldocean"); // стає «Світовим океаном»
  }, [unlock]);

  usePersistence({ bootForecast, g, gRef, loaded, meta, metaRef, phase, phaseRef, result, resultRef, setG, setMeta, setPhase, setResult });

  /* ---- game loop ---- */
  useGameLoop({ dayTaps, event, festEventsRef, metaRef, phase, setEvent, setG, setMeta, setPhase, setResult, setWheel, unlock, wheelRef });

  /* ---- absorb ---- */
  const absorb = useCallback((e) => {
    if (phaseRef.current !== "playing") return;
    if (gRef.current.festival) return; // на Фестивалі торкатися не можна — лише святкувати
    let shown = 0;
    dayTaps.current += 1;
    setG(prev => {
      if (prev.soil <= 0) return prev;
      const drain = Math.min(prev.soil, 6);
      const ratio = drain / 6;
      const boost = prev.absorbBoostT > 0 ? 1.9 : 1;
      const wb = 1 + (prev.weather ? prev.weather.absorbMod : 0);
      const amt = ABSORB_BASE * prev.absorbMult * boost * ratio * wb;
      shown = amt;
      return { ...prev, water: Math.min(prev.water + amt, prev.maxWater), soil: prev.soil - drain };
    });
    if (shown > 0) { Sfx.drip(); Haptics.tap(); }
    // ripple at the cursor within the stage
    let x = 50, y = 55; // percentages, fallback to centre
    const rect = stageRef.current && stageRef.current.getBoundingClientRect();
    if (rect && e && e.clientX != null) {
      x = clamp(((e.clientX - rect.left) / rect.width) * 100, 6, 94);
      y = clamp(((e.clientY - rect.top) / rect.height) * 100, 10, 92);
    }
    const id = Math.random();
    setFx(f => [...f.slice(-12), { id, amt: shown, x, y }]);
    setTimeout(() => setFx(f => f.filter(x2 => x2.id !== id)), 1000);
  }, []);

  const buyRun = (u) => setG(prev => {
    const n = buyRunUpgrade(prev, u); // ефект апгрейду — у чистому рушії (його ж бачить симулятор)
    if (!n) return prev; // не вистачило води
    Sfx.click();
    if (u.id === "silt" && n.levels.silt >= 10) queueMicrotask(() => unlock("shrek"));
    if (u.id === "lake") queueMicrotask(() => unlock("deepwell"));
    checkVol(n.maxWater);
    if (n.maxWater > (metaRef.current.maxVol || 0)) setMeta(m => ({ ...m, maxVol: Math.round(n.maxWater) }));
    return n;
  });
  const buyMeta = (u) => setMeta(m => {
    const lvl = m[u.id] || 0; if (lvl >= u.max) return m;
    const disc = Math.max(0.4, 1 - 0.06 * (m.c_cheap || 0)); // «Лагідне небо» здешевлює дари
    const cost = Math.round(u.base * Math.pow(u.growth, lvl) * disc);
    if (m.essence < cost) return m;
    Sfx.click();
    return { ...m, essence: m.essence - cost, [u.id]: lvl + 1 };
  });
  const buyPrestige = (u) => setMeta(m => {
    const lvl = m[u.id] || 0; if (lvl >= u.max) return m;
    const cost = Math.round(u.base * Math.pow(u.growth, lvl));
    if ((m.clouds || 0) < cost) return m;
    Sfx.click();
    return { ...m, clouds: m.clouds - cost, [u.id]: lvl + 1 };
  });
  const doPrestige = () => {
    const gain = cloudsFrom(metaRef.current.essThisAsc);
    if (gain < 1) return;
    if (!window.confirm(`Велике Випаровування — ти розчинишся в небі й переродишся.\n\nОтримаєш: ☁ ${gain} ${gain === 1 ? "хмару" : "хмар"}.\nЗникнуть: уся сутність і всі «постійні дари».\nЛишаться: хмари, небесні дари, досягнення, рекорд.\n\nПродовжити?`)) return;
    setMeta(m => ({
      ...m,
      essence: 0, essThisAsc: 0,
      memory: 0, cold: 0, silver: 0, spring: 0, roots: 0, absorb: 0, thirst: 0, luck: 0, moon: 0, callcd: 0, trees: 0, swift: 0, wellspring: 0, permafrost: 0, golddrop: 0, deeproots: 0, spring2: 0, essflow: 0, calmsky: 0, abyss: 0,
      clouds: (m.clouds || 0) + gain,
      ascensions: (m.ascensions || 0) + 1,
    }));
    unlock("ascend");
    Sfx.dusk();
    setPhase("menu");
  };
  // зниження КД капається (адитивно), а підлога — половина базового КД здібності,
  // щоб потужні (пожежники, сутність) не ставали спамом навіть при гарній прокачці
  const abilCD = (ab) => {
    const red = clamp(0.07 * (metaRef.current.callcd || 0) + 0.04 * ((gRef.current.levels && gRef.current.levels.summon) || 0), 0, 0.55);
    const floor = Math.max(8, Math.round(ab.cd * 0.45));
    return Math.max(floor, Math.round(ab.cd * (1 - red)));
  };
  const flashAbil = (kind, text) => {
    setAbilFx({ kind, text });
    clearTimeout(abilFxRef.current);
    abilFxRef.current = setTimeout(() => setAbilFx(null), 1800);
  };
  const useAbility = (ab) => {
    if (phaseRef.current !== "playing") return;
    const cur = (gRef.current.abil || {})[ab.id] || 0;
    if (cur > 0) return; // на перезарядці або «сполохана» (тимчасово недоступна)
    // комбо: швидке поєднання здібностей (вікно 4с) нарощує лічильник і дає бонус
    const now = Date.now(), c = comboRef.current;
    const prevId = now - c.last < 4000 ? c.lastId : null;
    if (now - c.last < 4000) c.count++; else { c.count = 1; c.ids = new Set(); }
    c.ids.add(ab.id); c.last = now;
    const cc = c.count;
    // синергія з попередньою здібністю (позитивна комбінація)
    const syn = prevId && prevId !== ab.id ? SYNERGY[synKey(prevId, ab.id)] : null;
    Sfx.drip(); Haptics.tap(); if (cc >= 2) { Sfx.win(); Haptics.combo(); }
    setG(p => {
      let n = ab.apply({ ...p }, metaRef.current);
      n.abil = { ...(p.abil || {}) };
      n.abil[ab.id] = abilCD(ab);
      // хижак лякає здобич — ті здібності тимчасово недоступні
      if (ab.prey) for (const id of ab.prey) n.abil[id] = Math.max(n.abil[id] || 0, ab.lock || 10);
      if (syn) n = syn.fn(n);
      // комбо більше НЕ друкує сутність щотиском (це був фарм) — лише невелика винагорода на віхах
      if (cc === 3) n.pending = n.pending + eAmt(p, 6) * effEss(p);
      else if (cc === 5) n.pending = n.pending + eAmt(p, 14) * effEss(p);
      return n;
    });
    c.lastId = ab.id;
    // відгук гравцю: синергія (зелена) / конфлікт — хто сполоханий (червона). Комбо ×N показує окремий напис.
    const scared = ab.prey ? ab.prey.filter(id => ABILITIES.some(x => x.id === id && x.req(metaRef.current, gRef.current))) : [];
    if (syn) flashAbil("syn", `Синергія · ${syn.t}`);
    if (scared.length) {
      const names = joinUa(scared.map(id => PREY_ACC[id] || id));
      const showClash = () => flashAbil("clash", `${ab.emo} сполохав ${names} — тимчасово недоступні`);
      if (syn) setTimeout(showClash, 950); else showClash(); // не перебивати синергію миттєво
    }
    setCombo(cc);
    clearTimeout(comboHideRef.current);
    comboHideRef.current = setTimeout(() => setCombo(0), 1700);
    unlock("summoner");
    if (cc >= 3) unlock("combo3");
    if (cc >= 5) unlock("combo5");
    if (c.ids.size >= 3) unlock("comboMix");
    if (syn) unlock("synergy");
  };
  const resolveEvent = (opt) => {
    Sfx.click();
    if (opt.sfx === "win") { Sfx.win(); Haptics.good(); } else if (opt.sfx === "bad") { Sfx.danger(); Haptics.bad(); }
    if (opt.ach) queueMicrotask(() => unlock(opt.ach)); // подія може дати досягнення
    setG(prev => {
      const n = opt.fn ? { ...opt.fn(prev) } : { ...prev };
      if (opt.shoo === "crow") n.crowShoo = (prev.crowShoo || 0) + 1; // прогнав крука → крок до приколу з кодлом
      // на фестивалі святкові й звичайні події чергуються через звичайний спавнер
      n.nextEvent = prev.festival ? 7 + Math.random() * 6 : 13 + Math.random() * 8;
      checkVol(n.maxWater);
      if (n.maxWater > (metaRef.current.maxVol || 0)) setMeta(m => ({ ...m, maxVol: Math.round(n.maxWater) }));
      return n;
    });
    if (opt.meta) setMeta(m => {
      const nm = opt.meta(m);
      if ((nm.frogBond || 0) >= 3) queueMicrotask(() => unlock("kumasya"));
      if ((nm.frogBond || 0) >= 6) queueMicrotask(() => unlock("bestfriend"));
      if (nm.snailMet) queueMicrotask(() => unlock("merchant"));
      if (nm.catPet) queueMicrotask(() => unlock("mooncat"));
      if (nm.duckFriend) queueMicrotask(() => unlock("ducks"));
      if ((nm.frogBond || 0) >= 1 && nm.catPet && nm.snailMet) queueMicrotask(() => unlock("allfriends"));
      const gained = friendCount(nm) > friendCount(m);
      if (gained) queueMicrotask(() => setG(p => ({ ...p, hasFriend: true }))); // відкрити «Гучніший поклик» цього забігу
      // персистентно запам'ятати, з ким уже знайомились — у вівтарі приручати можна лише відкритих
      const met = { ...(m.metFriends || {}) };
      for (const pid in PERMA_FLAG) if (nm[PERMA_FLAG[pid]]) met[pid] = true;
      return { ...nm, everFriend: m.everFriend || friendCount(nm) > 0, metFriends: met };
    });
    if (opt.luck) setMeta(m => {
      const fate = Math.max(0, (m.fate || 0) + opt.luck); // рішення впливають на приховану Вдачу (±)
      if (opt.luck < 0) queueMicrotask(() => unlock("deceived"));
      if (fate >= 20) queueMicrotask(() => unlock("lucky"));
      return { ...m, fate, tricked: opt.luck < 0 ? true : m.tricked };
    });
    // розгалуження: варіант може вести до наступної (вкладеної) події замість закриття
    const nxt = opt.then ? (typeof opt.then === "function" ? opt.then(gRef.current, metaRef.current) : opt.then) : null;
    if (nxt) { Haptics.event(); setEvent(nxt); return; }
    setEvent(null);
  };
  resolveEventRef.current = resolveEvent;
  // клавіатура: Пробіл = торкнутись калабані; 1-9,0 = здібності друзів
  const useAbilityRef = useRef(useAbility); useAbilityRef.current = useAbility;
  useEffect(() => {
    const blocked = () => {
      if (phaseRef.current !== "playing") return true;
      const ae = document.activeElement;
      return !!(ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT"));
    };
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || blocked()) return;
      if (e.code === "Space") { e.preventDefault(); return; } // лише гасимо прокрутку; торкання — на відпусканні
      if (e.repeat) return; // ігноруємо автоповтор при затисканні
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === "0" ? 9 : parseInt(e.key, 10) - 1; // 1→перша … 0→десята
        const list = ABILITIES.filter(a => a.req(metaRef.current, gRef.current));
        const ab = list[idx];
        if (ab && ((gRef.current.abil || {})[ab.id] || 0) <= 0) { e.preventDefault(); useAbilityRef.current(ab); }
      }
    };
    const onKeyUp = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || blocked()) return;
      if (e.code === "Space") { e.preventDefault(); absorb(); } // одне торкання на одне натискання
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []); // eslint-disable-line
  // timed guests (равлик, хитруни): йдуть, якщо не вирішити вчасно (авто-відмова — останній варіант)
  useEffect(() => {
    if (!event || !event.timer) { setEventT(0); return; }
    setEventT(event.timer);
    const iv = setInterval(() => {
      setEventT(t => {
        const nt = t - 0.1;
        if (nt <= 0) { clearInterval(iv); resolveEventRef.current(event.opts[event.opts.length - 1]); return 0; }
        return nt;
      });
    }, 100);
    return () => clearInterval(iv);
  }, [event]);

  /* ---- Колесо Фортуни ---- */
  const declineWheel = () => { Sfx.click(); setWheel(null); setG(p => ({ ...p, nextEvent: 13 + Math.random() * 8 })); };
  // перекрут колеса за сутність дорожчає щоразу й росте з днем
  const wheelRerollCost = (rr, day) => Math.round(80 * Math.pow(2.2, rr || 0) * (1 + ((day || 1) - 1) * 0.12));
  const wheelPool = () => Math.round((gRef.current.pending || 0) + (metaRef.current.essence || 0));
  // прокрутити колесо (rr — лічильник перекрутів цього колеса). Результат лише показуємо — застосуємо на «Прийняти»
  const spinWheelTo = (rr) => {
    const idx = pickWheel(fateLuck(metaRef.current));
    Sfx.spin();
    setWheelRot(prev => Math.ceil(prev / 360) * 360 + 360 * 6 + ((360 - idx * 45) % 360));
    setWheel({ stage: "spin", idx, rr });
    setTimeout(() => {
      const seg = WHEEL[idx];
      if (seg.tier === "jackpot" || seg.tier === "good") { Sfx.win(); Haptics.good(); }
      else if (seg.tier === "bad" || seg.tier === "verybad") { Sfx.danger(); Haptics.bad(); }
      setWheel({ stage: "done", idx, rr });
    }, 3300);
  };
  const spinWheel = () => { if (wheel && wheel.stage === "offer") spinWheelTo(0); };
  const rerollWheel = () => {
    if (!wheel || wheel.stage !== "done") return;
    const cost = wheelRerollCost(wheel.rr, gRef.current.day);
    if (wheelPool() < cost) return;
    const fromRun = Math.min(gRef.current.pending || 0, cost), fromBank = cost - fromRun;
    setG(p => ({ ...p, pending: Math.max(0, (p.pending || 0) - fromRun) }));
    if (fromBank > 0) setMeta(m => ({ ...m, essence: Math.max(0, m.essence - fromBank) }));
    spinWheelTo((wheel.rr || 0) + 1);
  };
  // прийняти випалий сектор — лише тут застосовуємо ефект
  const acceptWheel = () => {
    if (!wheel || wheel.stage !== "done") return;
    const seg = WHEEL[wheel.idx];
    Sfx.click();
    setG(p => {
      const n = seg.fn ? { ...seg.fn(p) } : { ...p };
      checkVol(n.maxWater);
      if (n.maxWater > (metaRef.current.maxVol || 0)) setMeta(m => ({ ...m, maxVol: Math.round(n.maxWater) }));
      n.nextEvent = 13 + Math.random() * 8;
      return n;
    });
    if (seg.luck) setMeta(m => ({ ...m, fate: Math.max(0, (m.fate || 0) + seg.luck) }));
    setWheel(null);
  };

  /* ---- slot spin ---- */
  const spin = (cost) => {
    if (spinning) return;
    const cur = gRef.current.fcIdx || 0;
    let idx = cur, payWater = false, usedFree = false;
    if (cost > 0) {
      // перекрут: наступний (детермінований) сектор; спершу витрачаємо безкоштовні, тоді воду
      if (freeSpins > 0) { setFreeSpins(s => s - 1); usedFree = true; }
      else { if (gRef.current.water < cost) return; payWater = true; }
      idx = cur + 1;
      setRespins(r => r + 1);
    }
    // зберігаємо № перекруту й витрачені безкоштовні в g → рефреш відновлює точно той самий прогноз
    setG(p => ({ ...p, fcIdx: idx, water: payWater ? p.water - cost : p.water, fcFree: (p.fcFree || 0) + (usedFree ? 1 : 0) }));
    Sfx.spin();
    const targets = rollForecast(gRef.current.seed || 0, gRef.current.day, idx);
    setReels(targets); setFcResult(null); setSpinning(true); setSpinKey(k => k + 1);
    setTimeout(() => {
      setSpinning(false);
      const res = computeWeather(targets);
      setFcResult(res);
      if (res.tier === "jackpot") { unlock("fortune"); Sfx.win(); }
      else if (res.tier === "good") Sfx.win();
      else if (res.tier === "danger") Sfx.danger();
    }, 520 + 1900 + 220);
  };

  // resuming straight into the day's forecast after a page refresh
  useEffect(() => {
    if (phase === "forecast" && bootForecast.current) {
      bootForecast.current = false;
      // відновлюємо точний стан прогнозу: № перекруту й витрачені безкоштовні (щоб рефреш не давав нового неба)
      setRespins(gRef.current.fcIdx || 0); setFcResult(null); setSpinning(false);
      setFreeSpins(Math.max(0, (metaRef.current.luck || 0) - (gRef.current.fcFree || 0)));
      const t = setTimeout(() => spin(0), 350); // spin(0) перекрутить до збереженого fcIdx — той самий результат
      return () => clearTimeout(t);
    }
  }, [phase]); // eslint-disable-line

  const enterForecast = () => {
    setRespins(0); setFcResult(null); setSpinning(false);
    setFreeSpins(meta.luck || 0);
    setG(p => ({ ...p, fcIdx: 0, fcFree: 0, seed: p.seed || ((Math.random() * 4294967296) >>> 0) })); // новий день — лічильник перекрутів обнуляється (сід для старих збережень)
    setPhase("forecast");
    setTimeout(() => spin(0), 350);
  };
  const startJourney = () => {
    Sfx.click(); dayTaps.current = 0;
    // новий забіг: дружби скидаються до купленого «назавжди» базису — друзів треба здобувати знову
    const m2 = { ...meta, ...friendBaseline(meta.perma) };
    setG(freshRun(m2)); // freshRun бачить скинуті дружби й копіює квитки у забіг
    setMeta({ ...m2, tickets: {} }); // квитки діють лише цей забіг — забираємо з вівтаря
    setEvent(null); setResult(null); enterForecast();
  };
  // приручити друга назавжди (дорого, за сутність) — стартуватиме з тобою щозабігу
  const buyPerma = (f) => setMeta(m => {
    if ((m.perma || {})[f.id] || m.essence < f.cost) return m;
    Sfx.click(); Haptics.tap();
    return { ...m, essence: m.essence - f.cost, perma: { ...(m.perma || {}), [f.id]: true }, everFriend: true };
  });
  // купити квиток на фестиваль (за сутність) — діятиме наступний забіг
  const buyTicket = (f) => setMeta(m => {
    if ((m.tickets || {})[f.id] || m.essence < f.ticket) return m;
    Sfx.click(); Haptics.tap();
    return { ...m, essence: m.essence - f.ticket, tickets: { ...(m.tickets || {}), [f.id]: true } };
  });
  const acceptForecast = () => {
    Sfx.click();
    dayTaps.current = 0;
    setG(prev => ({ ...prev, weather: fcResult || NEUTRAL }));
    setEvent(null); setPhase("playing");
  };
  const continueDay = () => {
    Sfx.click();
    const nd = g.day + 1;
    // новий день — листяний прихисток («до кінця дня») спадає
    setG(prev => ({ ...prev, day: prev.day + 1, elapsed: 0, sun: 6, dayLen: prev.dayLen + 6, nextEvent: 12 + Math.random() * 6, leaf: 0, festival: false }));
    const fest = festivalForDay(nd);
    if (fest && (g.tickets || {})[fest.id]) { dayTaps.current = 0; setEvent(null); setPhase("festival"); } // фестиваль — лише з квитком, без прогнозу
    else if (challengeForDay(nd)) { dayTaps.current = 0; setEvent(null); setPhase("challenge"); } // День Випробування — без слота
    else enterForecast();
  };
  // ФЕСТИВАЛІ — святкові події вперемішку зі звичайними (спавнер сам чергує)
  const startFestival = () => {
    const fest = festivalForDay(gRef.current.day);
    if (!fest) { enterForecast(); return; }
    Sfx.dusk(); Haptics.event();
    dayTaps.current = 0;
    festEventsRef.current = fest.events; // черга святкових подій (спавнер бере наступну за g.festAt)
    setG(prev => ({ ...prev, festival: true, festAt: 0, weather: fest.weather, elapsed: 0, sun: 3, nextEvent: 1.2, water: Math.min(prev.maxWater, prev.water + aw(prev, 0.15)) }));
    setEvent(null); setPhase("playing");
    queueMicrotask(() => unlock("festival"));
  };
  const acceptChallenge = () => {
    Sfx.dusk(); Haptics.event();
    dayTaps.current = 0;
    setG(prev => ({ ...prev, weather: applyChallenge(NEUTRAL, prev.day) }));
    setEvent(null); setPhase("playing");
  };
  const endJourney = () => {
    Sfx.click(); setConfirmEnd(false);
    const gained = Math.round(g.pending);
    setResult({ gained, secs: Math.round(g.elapsed), day: g.day, finished: true });
    setMeta(m => ({ ...m, essence: m.essence + gained, runs: m.runs + 1, best: Math.max(m.best, g.day), essThisAsc: (m.essThisAsc || 0) + gained, lifeEss: (m.lifeEss || 0) + gained }));
    if (g.day >= 7) unlock("sevensuns");
    if (g.day >= 30) unlock("oldpuddle");
    if (g.day >= 50) unlock("eternal");
    setPhase("menu");
  };

  /* ---- death + rescue slot ---- */
  // рятунок оплачується із сутності, зібраної цього забігу (показана на екрані), а решта — з банку
  const rescuePool = () => Math.round((gRef.current.pending || 0) + (metaRef.current.essence || 0));
  // ціна — відсоток від наявної сутності, що дорожчає з кожним прокрутом (мінімум 1тис на старті)
  const rescuePct = () => Math.min(0.4 + 0.2 * (gRef.current.rescues || 0), 0.85);
  const rescueCost = () => Math.max(1000, Math.round(rescuePool() * rescuePct()));
  const finalizeDeath = () => { // забанкувати сутність і піти у вівтар
    Sfx.click();
    const gained = (resultRef.current && resultRef.current.gained) || 0;
    const day = (resultRef.current && resultRef.current.day) || gRef.current.day;
    setMeta(m => ({ ...m, essence: m.essence + gained, runs: m.runs + 1, best: Math.max(m.best, day), essThisAsc: (m.essThisAsc || 0) + gained, lifeEss: (m.lifeEss || 0) + gained }));
    setRescue(null); setResult(null); setPhase("menu");
  };
  const rescuing = rescue === "shuffle" || rescue === "pick" || rescue === "reveal";
  const tryRescue = () => {
    const cost = rescueCost();
    if (rescuePool() < cost || rescuing) return;
    // спершу списуємо із сутності цього забігу, решту (якщо треба) — з банку
    const fromRun = Math.min(gRef.current.pending || 0, cost);
    const fromBank = cost - fromRun;
    setG(p => ({ ...p, rescues: (p.rescues || 0) + 1, pending: Math.max(0, (p.pending || 0) - fromRun) }));
    if (fromBank > 0) setMeta(m => ({ ...m, essence: Math.max(0, m.essence - fromBank) }));
    setResult(r => (r ? { ...r, gained: Math.max(0, Math.round((r.gained || 0) - fromRun)) } : r));
    // результат вирішено заздалегідь (наперстки «підкручені» — шанс той самий, що й був)
    const chance = clamp(0.42 + fateLuck(metaRef.current) * 0.18, 0.2, 0.7);
    setNaperstky({ won: Math.random() < chance, picked: -1, drop: -1 });
    setRescue("shuffle"); Sfx.spin();
    setTimeout(() => setRescue("pick"), 1100); // перемішали — обирай наперсток
  };
  const pickNaperstok = (i) => {
    if (rescue !== "pick") return;
    Sfx.click(); Haptics.tap();
    const won = naperstky.won;
    // крапля під обраним, якщо виграш; інакше — під одним з інших наперстків
    const others = [0, 1, 2].filter(s => s !== i);
    const drop = won ? i : others[Math.floor(Math.random() * 2)];
    setNaperstky(n => ({ ...n, picked: i, drop }));
    setRescue("reveal");
    setTimeout(() => {
      if (won) {
        Sfx.win(); Haptics.good();
        setG(p => ({ ...p, water: Math.round(p.maxWater * 0.45) }));
        setRescue(null); setResult(null); setEvent(null); setPhase("playing");
      } else { Sfx.danger(); Haptics.bad(); setRescue("lose"); }
    }, 1500);
  };

  /* ---- export / import ---- */
  const exportProgress = () => {
    const data = JSON.stringify({ v: 3, meta, phase: phaseRef.current, g: gRef.current, result: resultRef.current }, null, 0);
    const b64 = (() => { try { return "KAL1" + btoa(unescape(encodeURIComponent(data))); } catch (e) { return data; } })();
    setIo({ open: true, text: b64, msg: "Скопіюй цей код або завантаж файл. Це вся твоя мандрівка." });
    try {
      const blob = new Blob([b64], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "kalabanya-save.txt"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {}
  };
  const copyExport = async () => { try { await navigator.clipboard.writeText(io.text); setIo(o => ({ ...o, msg: "Скопійовано ✓" })); } catch (e) { setIo(o => ({ ...o, msg: "Виділи текст і скопіюй вручну." })); } };
  const importProgress = () => {
    let str = io.text.trim();
    try {
      if (str.startsWith("KAL1")) str = decodeURIComponent(escape(atob(str.slice(4))));
      const d = JSON.parse(str);
      if (!d.meta) throw new Error("no meta");
      setMeta(m => ({ ...m, ...migrateMeta(d.meta), ach: { ...(m.ach || {}), ...(d.meta.ach || {}) } }));
      setEvent(null); setWheel(null);
      const resumable = ["playing", "survived", "forecast", "challenge", "festival", "dead"];
      let nextPhase = "menu";
      if (d.g && resumable.includes(d.phase)) {
        const ne = (d.g.nextEvent == null || d.g.nextEvent >= 9999) ? 6 + Math.random() * 6 : d.g.nextEvent;
        const wasFest = d.phase === "playing" && d.g.festival;
        setG(gg => ({ ...gg, ...d.g, weather: d.g.weather || NEUTRAL, nextEvent: ne, festival: wasFest ? false : d.g.festival }));
        if (d.phase === "dead") { if (d.result) { setResult(d.result); nextPhase = "dead"; } else nextPhase = "menu"; }
        else if (d.phase === "forecast") { bootForecast.current = true; nextPhase = "forecast"; }
        else nextPhase = d.phase; // playing | survived | challenge | festival — переносимо активний забіг
      } else if (d.g) {
        setG(gg => ({ ...gg, ...d.g, weather: d.g.weather || NEUTRAL }));
      }
      setIo({ open: false, text: "", msg: "" });
      setPopup(null);
      setPhase(nextPhase);
      store.save(KEY, JSON.stringify({ v: 3, meta: { ...metaRef.current, ...d.meta }, phase: nextPhase, g: d.g || gRef.current, result: d.result }));
    } catch (e) { setIo(o => ({ ...o, msg: "Не вдалося прочитати код 🙁" })); }
  };
  const wipe = () => {
    if (!window.confirm("Стерти ВЕСЬ прогрес? Це назавжди.")) return;
    store.remove(KEY);
    setMeta(DEFAULT_META);
    setG(freshRun({})); setPhase("menu");
  };

  /* ---- derived visuals ---- */
  const w = g.weather || NEUTRAL;
  const luck = fateLuck(meta); // прихована вдача (0..1) — тільки для тонких візуальних натяків
  const ratio = clamp(g.water / g.maxWater, 0.04, 1);
  const size = 130 + ratio * 175;
  const evap = evapPerSec(g);
  const net = g.passive + w.rainPower - evap;
  const dryT = 1 - ratio;
  const waterCol = mix("#2f7d5f", "#8a5a3c", dryT * 0.65);
  const waterEdge = mix("#74c39a", "#b07a4a", dryT * 0.6);
  const sunT = clamp(g.sun / 130, 0, 1);
  const sunCol = sunT < 0.5 ? mix("#f7c14b", "#f0682f", sunT * 2) : mix("#f0682f", "#d23a2c", (sunT - 0.5) * 2);
  const vaporN = Math.round(clamp(evap / 0.7, 0, 7));
  const rainN = Math.round(clamp(w.rainPower * 10, 0, 36));
  const snowN = phase === "playing" && w.evapMod < -0.18 ? 18 : 0;
  const timeLeft = Math.max(0, Math.ceil(g.dayLen - g.elapsed));
  // база перекруту росте з кожним днем; далі множиться за кількістю перекрутів і дешевшає від «Пам'яті зливи»
  const respinCost = Math.max(1, Math.round((12 + (g.day - 1) * 7) * Math.pow(1.8, respins) * (1 - 0.08 * (meta.calmsky || 0))));
  const tierCol = (t) => t === "jackpot" ? "var(--essence)" : t === "good" ? "var(--good)" : t === "danger" ? "var(--bad)" : "var(--water-a)";

  // time-of-day for the sky
  const todT = phase === "playing" ? clamp(g.elapsed / g.dayLen, 0, 1)
    : phase === "forecast" ? 0.08
    : phase === "survived" ? 0.93
    : phase === "menu" ? 0.97 : 0.45;
  const sky = skyAt(todT);
  const showSunArc = phase === "playing" && todT > 0.04 && todT < 0.92;
  const sunArcLeft = 14 + todT * 72;
  const sunArcTop = 12 + (1 - Math.sin(Math.PI * todT)) * 150;
  const sunArcSize = 56 + Math.sin(Math.PI * todT) * 34;
  const phaseLabel = todT < 0.12 ? "Світанок" : todT < 0.4 ? "Ранок" : todT < 0.62 ? "Полудень" : todT < 0.82 ? "Пообіддя" : "Сутінки";

  // процедурна вода (намальований фон ями + карта глибини, див. public/scenes/README)
  const waterBgDay = `${import.meta.env.BASE_URL}scenes/puddle-bg.webp`;
  const waterBgNight = `${import.meta.env.BASE_URL}scenes/puddle-bg-night.webp`;
  const waterMap = `${import.meta.env.BASE_URL}scenes/puddle-map.webp`;


  return {
    phase, setPhase, g, setG, meta, setMeta, event, setEvent, fx, setFx, result, setResult, io, setIo, popup, setPopup, toasts, setToasts, waterOk, setWaterOk, wheel, setWheel, wheelRot, setWheelRot, eventT, setEventT, combo, setCombo, confirmEnd, setConfirmEnd, abilFx, setAbilFx, rescue, setRescue, naperstky, setNaperstky, comboRef, comboHideRef, abilFxRef, resolveEventRef, stageRef, wheelRef, reels, setReels, spinKey, setSpinKey, spinning, setSpinning, fcResult, setFcResult, respins, setRespins, freeSpins, setFreeSpins, loaded, gRef, phaseRef, metaRef, dayTaps, festEventsRef, resultRef, bootForecast, wakeLockRef, unlock, checkVol, absorb, buyRun, buyMeta, buyPrestige, doPrestige, abilCD, flashAbil, useAbility, resolveEvent, useAbilityRef, declineWheel, wheelRerollCost, wheelPool, spinWheelTo, spinWheel, rerollWheel, acceptWheel, spin, enterForecast, startJourney, buyPerma, buyTicket, acceptForecast, continueDay, startFestival, acceptChallenge, endJourney, rescuePool, rescuePct, rescueCost, finalizeDeath, rescuing, tryRescue, pickNaperstok, exportProgress, copyExport, importProgress, wipe, w, luck, ratio, size, evap, net, dryT, waterCol, waterEdge, sunT, sunCol, vaporN, rainN, snowN, timeLeft, respinCost, tierCol, todT, sky, showSunArc, sunArcLeft, sunArcTop, sunArcSize, phaseLabel, waterBgDay, waterBgNight, waterMap,
  };
}
