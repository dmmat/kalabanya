import React, { useState, useEffect, useRef, useCallback } from "react";
import WaterPuddle from "./WaterPuddle.jsx";

/* =========================================================================
   КАЛАБАНЯ — інкрементальна roguelike про калюжу, що висихає.
   Прогноз погоди = слот-машина. Погода керує днем. Тримайся до сутінків.
   Цикл день-ніч, досягнення, події, звук. Збереження: localStorage (+fallback).
   ========================================================================= */

const KEY = "kalabanya:save:v3";
const ABSORB_BASE = 2.5; // water per tap before multipliers (kept in sync logic↔HUD)

/* ---------- storage layer: localStorage -> window.storage -> memory ------- */
const _mem = {};
const store = {
  async load(k) {
    try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) {}
    try { if (typeof window !== "undefined" && window.storage) { const r = await window.storage.get(k); if (r && r.value != null) return r.value; } } catch (e) {}
    return _mem[k] ?? null;
  },
  async save(k, v) {
    _mem[k] = v;
    try { localStorage.setItem(k, v); } catch (e) {}
    try { if (typeof window !== "undefined" && window.storage) await window.storage.set(k, v); } catch (e) {}
  },
  async remove(k) {
    delete _mem[k];
    try { localStorage.removeItem(k); } catch (e) {}
    try { if (typeof window !== "undefined" && window.storage) await window.storage.delete(k); } catch (e) {}
  },
};

/* ---------- tiny WebAudio sfx ---------- */
const Sfx = (() => {
  let ctx = null, muted = false;
  const ac = () => { if (typeof window === "undefined") return null; if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } } return ctx; };
  const tone = (freq, dur, type = "sine", gain = 0.06, slideTo = null) => {
    if (muted) return; const c = ac(); if (!c) return;
    try {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
    } catch (e) {}
  };
  return {
    setMuted(m) { muted = m; },
    drip() { tone(620 + Math.random() * 120, 0.12, "sine", 0.05, 320); },
    click() { tone(420, 0.07, "triangle", 0.05); },
    spin() { tone(220, 0.5, "sawtooth", 0.025, 540); },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, "triangle", 0.05), i * 90)); },
    danger() { tone(180, 0.4, "sawtooth", 0.05, 90); },
    ach() { [659, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.2, "sine", 0.05), i * 110)); },
    dusk() { [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, 0.3, "sine", 0.05), i * 130)); },
  };
})();

/* ---------- haptics (телефонна вібрація; на iOS Safari — no-op) ---------- */
const Haptics = (() => {
  let on = true;
  const can = typeof navigator !== "undefined" && "vibrate" in navigator;
  const v = (p) => { if (on && can) { try { navigator.vibrate(p); } catch (e) {} } };
  return {
    setOn(x) { on = x; },
    tap() { v(6); },
    event() { v(18); },
    good() { v([0, 16, 36, 16]); },
    bad() { v([0, 38, 28, 38]); },
    win() { v([0, 12, 28, 12, 28, 22]); },
    combo() { v(22); },
  };
})();

/* ---------- weather slot symbols ---------- */
const SYMBOLS = [
  { e: "☀️", nm: "Сонце",   sun: 0.22,             combo: "П Е К Л О",            tier: "danger" },
  { e: "🌧️", nm: "Дощ",     rain: 0.55,            combo: "З Л И В А",            tier: "good", comboRain: 1.6 },
  { e: "☁️", nm: "Хмара",   sun: -0.18,            combo: "СУЦІЛЬНА ХМАРНІСТЬ",   tier: "good" },
  { e: "🌫️", nm: "Туман",   evap: -0.14,          combo: "М А Р Е В О",          tier: "good" },
  { e: "💨", nm: "Вітер",   abs: 0.45, rain: 0.06, combo: "Б У Р Я",             tier: "good" },
  { e: "🌈", nm: "Веселка", rain: 0.35, ess: 0.18, combo: "Д Ж Е К П О Т",       tier: "jackpot", comboEss: 0.7 },
  { e: "🔥", nm: "Засуха",  sun: 0.42, ess: 0.12,  combo: "ВЕЛИКА ЗАСУХА",        tier: "danger", comboEss: 1.4 },
  { e: "❄️", nm: "Сніг",    evap: -0.22, rain: 0.05, combo: "С Н І Г О П А Д",    tier: "good" },
  { e: "⛈️", nm: "Гроза",   rain: 0.7, abs: 0.1,   combo: "Г Р О З А",           tier: "good", comboRain: 1.8 },
  { e: "🌪️", nm: "Смерч",   abs: 0.6, sun: 0.1,    combo: "Т О Р Н А Д О",       tier: "good" },
  { e: "⛅", nm: "Мінливо", sun: -0.05, rain: 0.05, combo: "ХИТКЕ НЕБО",          tier: "norm" },
  { e: "🌡️", nm: "Спека",   sun: 0.3, evap: 0.08,  combo: "ТЕПЛОВИЙ КУПОЛ",       tier: "danger" },
];
const WEIGHTS = [4, 3, 4, 3, 3, 1, 1.6, 2, 1.4, 1.8, 3, 1.6];
const NEUTRAL = { rainPower: 0, sunMod: 0, absorbMod: 0, evapMod: 0, essMod: 0, name: "Ще не дивилась у небо", icon: "⛅", idxs: [0, 0, 0], tier: "norm" };

// детермінований ГВЧ — щоб прогноз погоди НЕ мінявся при перезавантаженні сторінки
// (інакше можна було безкоштовно «перекручувати» небо рефрешем). Сід — на забіг,
// результат залежить від (сід, день, № перекруту), тож рефреш дає той самий прогноз.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickIdxR(rnd) {
  const tot = WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rnd() * tot;
  for (let i = 0; i < WEIGHTS.length; i++) { r -= WEIGHTS[i]; if (r <= 0) return i; }
  return WEIGHTS.length - 1;
}
function rollForecast(seed, day, idx) {
  const s = (((seed >>> 0) ^ Math.imul(day | 0, 2654435761) ^ Math.imul((idx | 0) + 1, 40503)) >>> 0);
  const rnd = mulberry32(s);
  return [pickIdxR(rnd), pickIdxR(rnd), pickIdxR(rnd)];
}
function computeWeather(idxs) {
  const w = { rainPower: 0, sunMod: 0, absorbMod: 0, evapMod: 0, essMod: 0 };
  idxs.forEach(i => { const s = SYMBOLS[i]; w.rainPower += s.rain || 0; w.sunMod += s.sun || 0; w.absorbMod += s.abs || 0; w.evapMod += s.evap || 0; w.essMod += s.ess || 0; });
  const all = idxs[0] === idxs[1] && idxs[1] === idxs[2];
  let name, tier = "norm", icon = SYMBOLS[idxs[1]].e;
  if (all) {
    const s = SYMBOLS[idxs[0]];
    name = s.combo; tier = s.tier; icon = s.e;
    w.rainPower *= (s.comboRain || 2.0);
    w.sunMod *= 2; w.absorbMod *= 2; w.evapMod *= 2;
    w.essMod += (s.comboEss || 0);
  } else {
    if (w.rainPower >= 0.6) name = "Дощовитий день";
    else if (w.sunMod >= 0.32) name = "Спекотний день";
    else if (w.evapMod <= -0.18) name = "Сніжний день";
    else if (w.sunMod <= -0.2) name = "Хмарний день";
    else if (w.evapMod <= -0.1) name = "Імлистий день";
    else if (w.absorbMod >= 0.4) name = "Вітряний день";
    else name = "Мінлива погода";
    if (w.sunMod > 0.45) tier = "danger";
    else if (w.rainPower > 0.4 || w.essMod > 0.1) tier = "good";
  }
  return { ...w, name, icon, idxs, tier, isCombo: all };
}

/* ---------- in-run & meta upgrades ---------- */
const RUN_UPGRADES = [
  { id: "deepen", emo: "🕳️", nm: "Поглибшати", de: "+об'єму, трохи менший випар.", base: 24, growth: 1.4, frac: 0.18 },
  { id: "silt",   emo: "🟤", nm: "Намулитись", de: "Плівка мулу: +8% опору спеці (див. «Стан калабані»).", base: 30, growth: 1.42, frac: 0.12 },
  { id: "widen",  emo: "💧", nm: "Розширити русло", de: "+вбирання, +30 об'єму, трохи більший випар.", base: 22, growth: 1.4, frac: 0.10 },
  { id: "moss",   emo: "🌿", nm: "Поростити ряскою", de: "Ряска вкриває гладь: −7% випару.", base: 28, growth: 1.45, frac: 0.10 },
  { id: "vein",   emo: "🌊", nm: "Прокласти жилу", de: "Підземна жила: +0.4 води/с.", base: 40, growth: 1.5, frac: 0.14 },
  { id: "lake",   emo: "🟦", nm: "Підземне озеро", de: "Велике джерело: +об'єму, +0.7/с.", base: 130, growth: 1.7, frac: 0.25, req: g => g.levels.deepen >= 3, lock: "відкриється: Поглибшати рів.3" },
  { id: "trench", emo: "🌀", nm: "Океанічна западина", de: "Велетенська западина: +8% об'єму та +1.5/с.", base: 420, growth: 1.62, frac: 0.22, req: g => (g.levels.lake || 0) >= 2, lock: "відкриється: Підземне озеро рів.2" },
  { id: "summon", emo: "📣", nm: "Гучніший поклик", de: "−6% перезарядки здібностей.", base: 60, growth: 1.5, frac: 0.10, req: g => g.hasFriend, hidden: true },
];
// ціна = більше з експоненти (рання гра) та частки від об'єму (пізня гра),
// але ніколи не вище 92% об'єму → апгрейд завжди можна накопичити (без софт-локу за будь-якої стратегії)
const runCost = (u, lvl, maxW, disc = 1) => {
  lvl = lvl || 0; // захист: новододані апгрейди можуть не мати рівня у старих збереженнях → не дати NaN-ціні
  const c = Math.max(u.base * Math.pow(u.growth, lvl), (u.frac || 0) * maxW);
  return Math.max(1, Math.round(Math.min(c, 0.92 * maxW) * disc));
};
const META_UPGRADES = [
  { id: "memory", emo: "🫧", nm: "Глибша пам'ять", de: "+22 стартової води.", base: 40, growth: 1.72, max: 12 },
  { id: "cold",   emo: "❄️", nm: "Холодна сутність", de: "−4% базового випару.", base: 55, growth: 1.78, max: 10 },
  { id: "silver", emo: "🌙", nm: "Срібна крапля", de: "+12% сутності з мандрівок.", base: 48, growth: 1.74, max: 12 },
  { id: "spring", emo: "⛲", nm: "Вічне джерело", de: "Старт із +0.3/с пасивної води.", base: 70, growth: 1.85, max: 8 },
  { id: "roots",  emo: "🌱", nm: "Глибокі корінці", de: "+25% швидкості наповнення ґрунту.", base: 52, growth: 1.78, max: 8 },
  { id: "absorb", emo: "🪣", nm: "Спрагле ложе", de: "+10% вбирання вологи за дотик.", base: 50, growth: 1.76, max: 10 },
  { id: "swift",  emo: "⏩", nm: "Стрімкий час", de: "+12% швидкості гри (усе те саме, лише швидше).", base: 200, growth: 1.9, max: 12 },
  { id: "luck",   emo: "🍀", nm: "Прихильність неба", de: "+1 безкоштовний перекрут прогнозу на день.", base: 70, growth: 2.1, max: 4 },
  { id: "moon",   emo: "🌗", nm: "Срібло сутінків", de: "+15% сутності за виживання до ночі.", base: 85, growth: 1.95, max: 8 },
  { id: "trees",  emo: "🌳", nm: "Лісосмуга", de: "−6% глобального потепління.", base: 84, growth: 1.84, max: 12 },
  { id: "callcd", emo: "📣", nm: "Поклик друзів", de: "−8% перезарядки дружніх здібностей.", base: 60, growth: 1.78, max: 6, req: m => m.everFriend || Object.keys(m.perma || {}).length > 0 },
  // просунуті дари — відкриваються, коли викупиш базовий повністю
  { id: "wellspring", emo: "🌊", nm: "Бездонна пам'ять", de: "+40 стартової води та об'єму.", base: 120, growth: 1.8, max: 10, req: m => (m.memory || 0) >= 12 },
  { id: "permafrost", emo: "🧊", nm: "Вічна мерзлота", de: "−3% базового випару.", base: 150, growth: 1.82, max: 8, req: m => (m.cold || 0) >= 10 },
  { id: "golddrop", emo: "🪙", nm: "Золота крапля", de: "+15% сутності з мандрівок.", base: 140, growth: 1.8, max: 10, req: m => (m.silver || 0) >= 12 },
  { id: "deeproots", emo: "🌳", nm: "Прадавнє коріння", de: "+25% наповнення ґрунту.", base: 120, growth: 1.8, max: 8, req: m => (m.roots || 0) >= 8 },
  { id: "thirst", emo: "🫗", nm: "Невгасима спрага", de: "+12% вбирання за дотик.", base: 130, growth: 1.8, max: 8, req: m => (m.absorb || 0) >= 10 },
  // глибинні дари — відкриваються лише в довгій грі (рекорд ≥ 8 днів)
  { id: "spring2", emo: "🪨", nm: "Глибинна жила", de: "Старт із +0.4/с пасивної води.", base: 160, growth: 1.92, max: 6, tier: 2 },
  { id: "essflow", emo: "🌫️", nm: "Роса предків", de: "+0.05/с базового збору сутності.", base: 150, growth: 1.9, max: 6, tier: 2 },
  { id: "calmsky", emo: "🌬️", nm: "Пам'ять зливи", de: "−8% до ціни перекруту прогнозу.", base: 170, growth: 1.95, max: 5, tier: 2 },
  // нескінченний сток сутності — щоб надлишок завжди мав куди йти (вівтар «дорожчає й далі»)
  { id: "abyss", emo: "🌌", nm: "Безкрая глибінь", de: "Старт із +15 води/об'єму та +0.03/с (без межі — сюди йде надлишок сутності).", base: 240, growth: 1.42, max: 9999, inf: true, req: m => (m.wellspring || 0) >= 3 || (m.best || 0) >= 10 },
];
const META_TIER2_DAY = 8; // глибинні дари відкриваються після такого рекорду

/* ---------- prestige: «Велике Випаровування» ---------- */
const PRESTIGE_UNLOCK = 100000; // скільки сутності за все треба заробити, щоб відкрити престиж (середина гри, а не 1-й забіг)
const cloudsFrom = (essThisAsc) => Math.floor(Math.sqrt((essThisAsc || 0) / 200));
const PRESTIGE_UPGRADES = [
  { id: "c_ess",    emo: "🌫️", nm: "Небесна пам'ять", de: "+40% сутності за кожен рівень.", base: 1, growth: 2.0, max: 10 },
  { id: "c_full",   emo: "💧", nm: "Повноводний старт", de: "+30 стартової води та +25 об'єму.", base: 1, growth: 1.7, max: 10 },
  { id: "c_spring", emo: "🌧️", nm: "Першоджерело неба", de: "Старт із +0.5/с пасивної води.", base: 2, growth: 1.9, max: 8 },
  { id: "c_cheap",  emo: "🕊️", nm: "Лагідне небо", de: "−6% до ціни «постійних дарів».", base: 2, growth: 1.9, max: 8 },
  { id: "c_silt",   emo: "🪨", nm: "Прадавній мул", de: "Старт із +6% опору спеці.", base: 2, growth: 1.8, max: 6 },
  { id: "c_eco",    emo: "♻️", nm: "Чисте небо", de: "−10% глобального потепління.", base: 2, growth: 1.9, max: 6 },
];

/* ---------- events ---------- */
const EVENTS = [
  // рідкісна загадка-вікторина (конкретну загадку добираємо при появі — makeRiddleEvent)
  { t: "Загадка", emo: "🧩", riddle: true, req: (g) => g.day >= 2, weight: 1.2 },
  { t: "Набігла хмара", emo: "☁️", d: "Темна хмара зависла над тобою.", opts: [
    { b: "Розкритись", sf: g => `+${aw(g, 0.16)} води, та швидко випарується (18с)`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.16), g.maxWater), evapBoostT: addT(g.evapBoostT, 18) }) },
    { b: "Зібратись", sf: g => `+${aw(g, 0.10)} води, безпечно`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.10), g.maxWater) }) }] },
  { t: "Сусідський песик", emo: "🐕", art: "dog", req: (g) => g.day >= 2, weight: 1.1, timer: 10,
    d: "Кудлатий песик підбіг до тебе, висолопив язика й завзято замахав хвостом.", opts: [
    { b: "Дати напитися", sf: g => `−${aw(g, 0.08)} води · +вдача`, fn: g => ({ ...g, water: g.water - aw(g, 0.08) }), meta: m => ({ ...m, dogFriend: true }), luck: 1 },
    { b: "Хай «позначить»", sf: g => `+${aw(g, 0.11)} води, та каламутна (+випар)`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.11), g.maxWater), evapBoostT: addT(g.evapBoostT, 9) }) },
    { b: "Відігнати", s: "нічого", fn: g => g }] },
  { t: "Дощовий хробак", emo: "🐛", art: "worm", req: (g) => g.day >= 2, weight: 1.0,
    d: "Після вологи з ґрунту виповз рожевий хробачок і блаженно скрутився у твоїй прохолоді.", opts: [
    { b: "Прихистити хробачка", s: "наповнити вологу ґрунту · +вдача", fn: g => ({ ...g, soil: g.soilMax }), luck: 1 },
    { b: "Не чіпати", s: "нічого", fn: g => g }] },
  { t: "Спрагла пташка", emo: "🐦", art: "bird", d: "Горобець нахилився попити з тебе.", opts: [
    { b: "Напоїти", sf: g => `−${aw(g, 0.07)} води, +${eAmt(g, 8)} сутності`, fn: g => ({ ...g, water: g.water - aw(g, 0.07), pending: g.pending + eAmt(g, 8) * effEss(g) }), meta: m => ({ ...m, birdFriend: true }), luck: 1 },
    { b: "Завмерти", s: "нічого", fn: g => g }] },
  { t: "Тінь дерева", emo: "🌳", d: "Гілка кинула на тебе прохолоду.", opts: [
    { b: "Сховатись у тіні", s: "−випар на 15с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 15) }) },
    { b: "Ловити сонце", s: "+вбирання на 15с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 15) }) }] },
  { t: "Тріщина в землі", emo: "🪨", d: "Поряд розверзлась суха тріщина.", opts: [
    { b: "Просочитись глибше", sf: g => `−30% води, +${aw(g, 0.14)} об'єму`, fn: g => ({ ...g, water: g.water * 0.7, maxWater: g.maxWater + aw(g, 0.14) }) },
    { b: "Лишитись", s: "нічого", fn: g => g }] },
  { t: "Калабаня-сусідка", emo: "💧", d: "Інша калабаня майже торкається тебе краєм.", opts: [
    { b: "Злитись воєдино", sf: g => `+${aw(g, 0.16)} води, +${aw(g, 0.10)} об'єму`, fn: g => { const v = aw(g, 0.10); return { ...g, maxWater: g.maxWater + v, water: Math.min(g.water + aw(g, 0.16), g.maxWater + v) }; } },
    { b: "Лишитись собою", sf: g => `+${eAmt(g, 14)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g) }) }] },
  { t: "Опале листя", emo: "🍂", d: "Жовтий лист ліг на тебе, мов покривало.", opts: [
    { b: "Прийняти прихисток", s: "−12% випару до кінця дня", fn: g => ({ ...g, leaf: Math.min(0.6, g.leaf + 0.12) }) },
    { b: "Струсити геть", sf: g => `+${aw(g, 0.06)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.06), g.maxWater) }) }] },
  { t: "Сонячне вікно", emo: "🌤️", tod: [0.30, 0.70], weight: 1.4, d: "Хмари розійшлись — пряме проміння впало на тебе.", opts: [
    { b: "Сховатись у бруд", s: "−випар на 18с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 18) }) },
    { b: "Витерпіти", sf: g => `+${aw(g, 0.14)} води, та швидко випарується (16с)`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.14), g.maxWater), evapBoostT: addT(g.evapBoostT, 16) }) }] },
  { t: "Жаба-мандрівниця", emo: "🐸", art: "frog", d: "Жаба обрала твою калабаню за прихисток на ніч.", opts: [
    { b: "Прихистити її", sf: g => `−${aw(g, 0.05)} води · +дружба з жабою`, fn: g => ({ ...g, water: g.water - aw(g, 0.05), shadeT: addT(g.shadeT, 16) }), meta: m => ({ ...m, frogBond: (m.frogBond || 0) + 1 }), luck: 2 },
    { b: "Прогнати геть", sf: g => `+${aw(g, 0.06)} води · жаба ображається`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.06), g.maxWater) }), meta: m => ({ ...m, frogShy: true }) }] },
  { t: "Дитячий кораблик", emo: "⛵", art: "boat", d: "Дитина пустила паперовий човник твоїми водами.", opts: [
    { b: "Гойдати лагідно", s: "+вбирання на 14с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 14) }) },
    { b: "Поглинути човник", sf: g => `+${aw(g, 0.07)} води, +${eAmt(g, 6)} сутності`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.07), g.maxWater), pending: g.pending + eAmt(g, 6) * effEss(g) }) }] },
  { t: "Нічний приморозок", emo: "🧊", tod: [0, 0.16], weight: 1.8, d: "Досвітній холод скував твою поверхню тонкою кригою.", opts: [
    { b: "Скутися льодом", s: "−випар на 22с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 22) }) },
    { b: "Берегти тепло глибин", sf: g => `−${aw(g, 0.04)} води, +${eAmt(g, 10)} сутності`, fn: g => ({ ...g, water: g.water - aw(g, 0.04), pending: g.pending + eAmt(g, 10) * effEss(g) }) }] },
  { t: "Вітер-пустун", emo: "🍃", d: "Пустотливий вітер заграв над твоєю гладдю.", opts: [
    { b: "Піддатися вітру", sf: g => `−${aw(g, 0.07)} води, +вбирання на 16с`, fn: g => ({ ...g, water: g.water - aw(g, 0.07), absorbBoostT: addT(g.absorbBoostT, 16) }) },
    { b: "Притихнути", sf: g => `+${eAmt(g, 8)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 8) * effEss(g) }) }] },
  { t: "Через яму — фура", emo: "🚚", art: "truck", d: "Важка фура з гуркотом увігналася просто в яму, де ти лежиш. Колеса здіймають хвилю.", opts: [
    { b: "Дати проїхати", sf: g => `−40% води, +${aw(g, 0.18)} об'єму (яма глибшає)`, fn: g => ({ ...g, water: g.water * 0.6, maxWater: g.maxWater + aw(g, 0.18) }) },
    { b: "Розплескатись навсібіч", sf: g => `−25% води, +${eAmt(g, 14)} сутності`, fn: g => ({ ...g, water: g.water * 0.75, pending: g.pending + eAmt(g, 14) * effEss(g) }) }] },
  { t: "Роса на світанку", emo: "🌅", tod: [0, 0.22], weight: 2.0, d: "Світанкова роса осіла на тобі дрібним сріблом.", opts: [
    { b: "Зібрати росу", sf: g => `+${aw(g, 0.12)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.12), g.maxWater) }) },
    { b: "Лишити блищати", sf: g => `+${eAmt(g, 12)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g) }) }] },

  { t: "Жаба Кума повертається", emo: "🐸", art: "frog", req: (g, m) => (m.frogBond || 0) >= 1, weight: 1.4,
    d: "Знайома жаба впізнала твій блиск і знову прийшла погрітись на твоїм краю.", opts: [
    { b: "Прийняти, як рідну", s: "−випар на 20с · міцніша дружба", fn: g => ({ ...g, shadeT: addT(g.shadeT, 20) }), meta: m => ({ ...m, frogBond: (m.frogBond || 0) + 1 }), luck: 2 },
    { b: "Попросити про послугу", sf: g => `+${eAmt(g, 16)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }) }] },
  { t: "Равлик-крамар", emo: "🐌", art: "snail", req: (g) => g.day >= 3, weight: 1.1, timer: 12,
    d: "Равлик зі скойкою-крамницею повз твоїм берегом і розклав на мушлі дрібний крам.", opts: [
    { b: "Виміняти мул на захист", sf: g => `−${aw(g, 0.05)} води · +опір спеці`, fn: g => ({ ...g, water: g.water - aw(g, 0.05), sunResist: clamp(g.sunResist + 0.06, 0, 0.85) }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Купити краплю глибини", sf: g => `−${aw(g, 0.08)} води · +${aw(g, 0.13)} об'єму`, fn: g => ({ ...g, water: g.water - aw(g, 0.08), maxWater: g.maxWater + aw(g, 0.13) }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Придбати жменю ряски", sf: g => `−${aw(g, 0.06)} води · −6% випару (на весь забіг)`, fn: g => ({ ...g, water: g.water - aw(g, 0.06), mossMult: g.mossMult * 0.94 }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Пройти повз", s: "нічого", fn: g => g }] },
  { t: "Чапля на одній нозі", emo: "🪽", art: "heron", req: (g) => g.day >= 4, weight: 0.9,
    d: "Сіра чапля завмерла над тобою, видивляючись щось у твоїй глибині.", opts: [
    { b: "Поділитися водою", sf: g => `−${aw(g, 0.12)} води · +${eAmt(g, 20)} сутності`, fn: g => ({ ...g, water: g.water - aw(g, 0.12), pending: g.pending + eAmt(g, 20) * effEss(g) }), meta: m => ({ ...m, heronFriend: true }), luck: 2 },
    { b: "Скаламутитись", s: "безпечно, чапля летить геть", fn: g => g }] },
  { t: "Місячний кіт", emo: "🐈‍⬛", art: "cat", req: (g) => g.day >= 4, tod: [0.74, 1.0], weight: 1.4,
    d: "Чорний кіт прийшов нечутно хлебтати місяць із твоєї поверхні.", opts: [
    { b: "Погладити брижами", sf: g => `+${eAmt(g, 16)} сутності · спокій`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }), meta: m => ({ ...m, catPet: true }), luck: 2 },
    { b: "Завмерти дзеркалом", s: "−випар на 18с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 18) }) }] },
  { t: "Дід-рибалка", emo: "🎣", art: "fisherman", req: (g) => g.day >= 6, weight: 0.8,
    d: "Старий присів поряд і закинув вудку просто в тебе, ніби ти — ціле озеро.", opts: [
    { b: "Підіграти озером", sf: g => `+${eAmt(g, 26)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 26) * effEss(g) }) },
    { b: "Віддати глибину", sf: g => `−20% води · +${aw(g, 0.15)} об'єму`, fn: g => ({ ...g, water: g.water * 0.8, maxWater: g.maxWater + aw(g, 0.15) }) }] },
  { t: "Тріщина до водоносу", emo: "⛲", req: (g) => g.maxWater >= 300, weight: 1.0,
    d: "Під тобою з тихим зітханням розкрилася тріщина аж до підземних вод.", opts: [
    { b: "Зрости вглиб", sf: g => `+${aw(g, 0.22)} об'єму · +0.4/с`, fn: g => ({ ...g, maxWater: g.maxWater + aw(g, 0.22), passive: g.passive + 0.4 }) },
    { b: "Запечатати мулом", sf: g => `+${aw(g, 0.12)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.12), g.maxWater) }) }] },
  { t: "Ямковий ремонт", emo: "🚧", req: (g) => g.day >= 4 && g.maxWater >= 200, weight: 0.9, timer: 11,
    d: "Дорожники сяк-так залатали яму гарячим асфальтом — твоє ложе помітно поменшало.", opts: [
    { b: "Влягтися в менше ложе", sf: g => `−18% об'єму · +${eAmt(g, 20)} сутності`, fn: g => { const mw = Math.max(120, Math.round(g.maxWater * 0.82)); return { ...g, maxWater: mw, water: Math.min(g.water, mw), pending: g.pending + eAmt(g, 20) * effEss(g) }; } },
    { b: "Просочитися під латку", s: "−35% води, об'єм цілий", fn: g => ({ ...g, water: g.water * 0.65 }) }] },
  { t: "Пожежна машина", emo: "🚒", req: (g) => g.day >= 3 && g.water < g.maxWater * 0.72, weight: 1.1, timer: 12,
    d: "Червона пожежна машина пригальмувала біля тебе. «Маємо зайву воду в цистерні — можемо долити по самі вінця. Та задарма ніхто не возить — щось та й віддай».", opts: [
    { b: "Заплатити сутністю", sf: g => `−${eAmt(g, 24)} сутності · +${aw(g, 0.5)} води`, fn: g => ({ ...g, pending: Math.max(0, g.pending - eAmt(g, 24)), water: Math.min(g.water + aw(g, 0.5), g.maxWater) }), meta: m => ({ ...m, fireFriend: true }), luck: 1 },
    { b: "Віддати шмат русла", sf: g => `−12% об'єму · наповнити майже по вінця`, fn: g => { const mw = Math.max(120, Math.round(g.maxWater * 0.88)); return { ...g, maxWater: mw, water: Math.max(g.water, Math.round(mw * 0.85)) }; }, meta: m => ({ ...m, fireFriend: true }) },
    { b: "Подякувати й відмовити", s: "нічого", fn: g => g, luck: 1 }] },

  /* — нові події з розгалуженням (вибір веде до наступної сцени) — */
  { t: "Замулений сундук", emo: "🧰", req: (g) => g.day >= 4, weight: 0.9,
    d: "У твоєму намулі проступив старий сундук із важким, поіржавілим замком.", opts: [
    { b: "Розбити замок об камінь", sf: g => `−${aw(g, 0.06)} води`, fn: g => ({ ...g, water: g.water - aw(g, 0.06) }),
      then: { t: "Сундук відчинено", emo: "🗝️", d: "Замок піддався з тріском. Усередині — потьмяніле начиння, а в кутку щось зблиснуло.", opts: [
        { b: "Забрати жменю монет", sf: g => `+${eAmt(g, 30)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 30) * effEss(g) }), luck: 1 },
        { b: "Розколупати дно — там джерельце", sf: g => `+${aw(g, 0.2)} об'єму`, fn: g => ({ ...g, maxWater: g.maxWater + aw(g, 0.2) }) }] } },
    { b: "Не чіпати чужого", s: "+вдача", fn: g => g, luck: 2 }] },
  { t: "Подорожній із загадкою", emo: "🧙", req: (g) => g.day >= 3, weight: 0.9, timer: 12,
    d: "Подорожній присів на твоїм березі: «Відгадаєш — віддячу. Що росте догори корінням?»", opts: [
    { b: "«Бурулька»", fn: g => g, luck: 1,
      then: { t: "Просто в ціль!", emo: "🎉", d: "«А ти кмітлива калабаня!» — він простягнув тобі вибір дарунка.", opts: [
        { b: "Жменя сутності", sf: g => `+${eAmt(g, 28)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 28) * effEss(g) }), luck: 1 },
        { b: "Ковток із його баклаги", sf: g => `+${aw(g, 0.18)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.18), g.maxWater) }) }] } },
    { b: "«Дерево»", fn: g => g,
      then: { t: "Майже…", emo: "🤔", d: "«Не зовсім. Та за сміливість — ось дещиця».", opts: [
        { b: "Прийняти дещицю", sf: g => `+${eAmt(g, 8)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 8) * effEss(g) }) }] } },
    { b: "Промовчати", s: "нічого", fn: g => g }] },
  { t: "Стара верба схилилась", emo: "🌳", req: (g) => g.day >= 5, weight: 0.85,
    d: "Гілля старої верби схилилось над тобою — то прихисток, то спрага її коренів.", opts: [
    { b: "Прийняти затінок", s: "−випар на 24с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 24) }),
      then: { t: "Корінь прокинувся", emo: "🪵", d: "У затінку верба пустила корінь глибше до тебе — обери, як бути.", opts: [
        { b: "Напоїти вербу", sf: g => `−${aw(g, 0.08)} води · +вдача`, fn: g => ({ ...g, water: g.water - aw(g, 0.08) }), luck: 2 },
        { b: "Відштовхнути корінь", s: "нічого", fn: g => g }] } },
    { b: "Скаламутитись", s: "верба відступає", fn: g => g }] },

  /* — персонажі, що здешевлюють «Поглиблення» на якийсь час — */
  { t: "Бобер-будівничий", emo: "🦫", req: (g) => g.day >= 4, weight: 0.85, timer: 12,
    d: "Дбайливий бобер приволік оберемок гілок: «Підсоблю тобі з ложем — поки я тут, поглиблюватись дешевше!»", opts: [
    { b: "Прийняти допомогу", s: "−40% до «Поглиблення» на 30с", fn: g => ({ ...g, cheapT: addT(g.cheapT, 30) }), luck: 1 },
    { b: "Подякувати й відмовити", s: "+вдача", fn: g => g, luck: 1 }] },
  { t: "Кріт-землекоп", emo: "⛏️", req: (g) => g.day >= 3, weight: 0.85,
    d: "З-під дна виткнувся кріт у касці: «Розпушу тобі ложе — усі поглиблення підуть легше й дешевше!»", opts: [
    { b: "Хай порпається", s: "−40% до «Поглиблення» на 28с", fn: g => ({ ...g, cheapT: addT(g.cheapT, 28) }), luck: 1 },
    { b: "Не чіпати дно", s: "нічого", fn: g => g }] },

  /* — ще «скарбові» події з розгалуженням (як сундук) — */
  { t: "Глиняний глечик у намулі", emo: "🏺", req: (g) => g.day >= 5, weight: 0.8,
    d: "З-під намулу проступив старий глиняний глечик, замазаний воском. Усередині щось глухо побрязкує.", opts: [
    { b: "Розбити й зазирнути", sf: g => `−${aw(g, 0.07)} води`, fn: g => ({ ...g, water: g.water - aw(g, 0.07) }),
      then: { t: "Козацький скарб!", emo: "🪙", d: "Жменя старих монет і чорна від часу каблучка. Та кажуть, на кладах буває й закляття…", opts: [
        { b: "Забрати геть усе", sf: g => `+${eAmt(g, 36)} сутності · ризик`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 36) * effEss(g) }), luck: -1 },
        { b: "Узяти лиш монети, каблучку лишити", sf: g => `+${eAmt(g, 18)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 18) * effEss(g) }), luck: 2 }] } },
    { b: "Закопати назад", s: "+вдача", fn: g => g, luck: 1 }] },
  { t: "Запечатана пляшка", emo: "🍾", req: (g) => g.day >= 3, weight: 0.85,
    d: "До берега прибилась запечатана сургучем пляшка. Усередині — згорнутий пожовклий папір.", opts: [
    { b: "Розкоркувати й прочитати", s: "цікаво…", fn: g => g,
      then: { t: "Карта схову", emo: "🗺️", d: "Це карта! Хрестик позначає місце просто під тобою. Копнути глибше?", opts: [
        { b: "Копати за картою", sf: g => `−${aw(g, 0.08)} води · +${aw(g, 0.22)} об'єму`, fn: g => ({ ...g, water: g.water - aw(g, 0.08), maxWater: g.maxWater + aw(g, 0.22) }) },
        { b: "Сховати карту на потім", sf: g => `+${eAmt(g, 14)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g) }), luck: 1 }] } },
    { b: "Відправити далі плисти", s: "+вдача", fn: g => g, luck: 1 }] },
  { t: "Зоряний камінь", emo: "☄️", req: (g) => g.day >= 6, tod: [0.72, 1.0], weight: 0.7,
    d: "З нічного неба зірвалась зоря й шубовснула просто в тебе — на дні мерехтить ще теплий камінець.", opts: [
    { b: "Притиснути до дна", s: "—", fn: g => g,
      then: { t: "Камінь жевріє", emo: "✨", d: "Зоряний уламок пульсує теплом і світлом. Що з ним зробити?", opts: [
        { b: "Увібрати тепло", sf: g => `+${eAmt(g, 30)} сутності · −випар на 20с`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 30) * effEss(g), shadeT: addT(g.shadeT, 20) }), luck: 1 },
        { b: "Загадати бажання", s: "+багато вдачі", fn: g => g, luck: 3 }] } },
    { b: "Дати йому охолонути", s: "нічого", fn: g => g }] },
  { t: "Водяник зі дна", emo: "🌊", req: (g) => g.maxWater >= 400, weight: 0.7,
    d: "З глибини зринув старий Водяник, борода в рясці: «Гарна калабаня… Зробимо оборудку?»", opts: [
    { b: "Вислухати оборудку", s: "—", fn: g => g,
      then: { t: "Оборудка Водяника", emo: "🧜", d: "«Дай краплю свого блиску — а я тобі підземну жилу відкрию». Згода?", opts: [
        { b: "Потиснути перетинчасту руку", sf: g => `−${eAmt(g, 18)} сутності · +0.4 води/с назавжди`, fn: g => ({ ...g, pending: Math.max(0, g.pending - eAmt(g, 18)), passive: g.passive + 0.4 }), luck: 1 },
        { b: "Чемно відмовити", s: "+вдача", fn: g => g, luck: 1 }] } },
    { b: "Скаламутитись від нього", s: "Водяник пірнає геть", fn: g => g }] },

  // мем «фліт»: їжачок на трасі → фура → зірка (подія їжака й фури йдуть одна за одною; раз за гру)
  { t: "Їжачок на трасі", emo: "🦔", req: (g) => g.day >= 3, weight: 0.55, once: "flit",
    d: "Маленький їжачок вибрався на нічну трасу біля тебе й завмер, осліплений фарами вантажівки, що мчить здалеку…", opts: [
    { b: "Затамувати подих…", s: "що ж буде далі?", fn: g => g,
      then: { t: "ФУРА!!!", emo: "🚛", d: "Фура з ревом пролетіла трасою — і їжачок беззвучно злетів у нічне небо, спалахнувши яскравою зіркою. Флііііт… ⭐", opts: [
        { b: "Загадати на зірку бажання", sf: g => `+${eAmt(g, 50)} сутності · +багато вдачі`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 50) * effEss(g) }), luck: 4, sfx: "win", ach: "flitstar" },
        { b: "Тихо вшанувати героя", s: "−випар на 26с · +вдача", fn: g => ({ ...g, shadeT: addT(g.shadeT, 26) }), luck: 2, ach: "flitstar" }] } },
    { b: "Гукнути: «Тікай, малий!»", s: "їжачок шмигнув у траву · +вдача", fn: g => g, luck: 2 }] },

  /* — нові звичайні події (для різноманіття) — */
  { t: "Паперовий кораблик", emo: "⛵", req: (g) => g.day >= 2, weight: 1.0,
    d: "Хлопчик пустив паперовий кораблик, і той закружляв твоєю гладдю.", opts: [
    { b: "Лагідно гойдати кораблик", sf: g => `+${eAmt(g, 10)} сутності · −випар на 10с`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 10) * effEss(g), shadeT: addT(g.shadeT, 10) }), luck: 1 },
    { b: "Втопити кораблик", s: "−вдача", fn: g => g, luck: -1 }] },
  { t: "Загублений м'яч", emo: "⚽", req: (g) => g.day >= 2, weight: 1.0, timer: 10,
    d: "Дітлахи загнали м'яч просто в тебе — і вже біжать слідом, репетуючи.", opts: [
    { b: "Виштовхнути м'яч брижами", sf: g => `+${eAmt(g, 12)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g) }), luck: 1 },
    { b: "Сховати на дні", s: "тиша, але −вдача", fn: g => g, luck: -1 }] },
  { t: "Водомірки ковзають", emo: "🪲", req: (g) => g.day >= 3, weight: 1.0,
    d: "Зграйка водомірок розкреслила твою гладь тонкими тінями.", opts: [
    { b: "Завмерти дзеркалом", s: "−випар на 14с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 14) }) },
    { b: "Розігнати їх брижами", sf: g => `+${eAmt(g, 9)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 9) * effEss(g) }) }] },

  { t: "Веселка торкнулась води", emo: "🌈", req: (g) => g.day >= 5, weight: 0.7,
    d: "Після короткого дощу веселка вмочила свій край просто в тебе.", opts: [
    { b: "Зачерпнути барв", sf: g => `+${aw(g, 0.14)} води · +${eAmt(g, 12)} сутності`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.14), g.maxWater), pending: g.pending + eAmt(g, 12) * effEss(g) }) },
    { b: "Лише милуватись", sf: g => `+${eAmt(g, 24)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 24) * effEss(g) }) }] },
  { t: "Відлуння старих калабань", emo: "🌌", req: (g, m) => (m.best || 0) >= 10, weight: 0.7,
    d: "У сутінковій тиші ти чуєш шепіт усіх калабань, що висихали тут до тебе.", opts: [
    { b: "Прийняти їхню пам'ять", sf: g => `+${eAmt(g, 42)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 42) * effEss(g) }) },
    { b: "Тихо відпустити", s: "−випар на 26с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 26) }) }] },

  /* — глибші зустрічі зі старими друзями (рідкісні, за рівнем прогресу) — */
  { t: "Жаб'яче весілля", emo: "🐸", art: "frog", req: (g, m) => (m.frogBond || 0) >= 4, weight: 0.5,
    d: "Кума привела все жаб'яче кодло — у тебе галасливе весілля до самого ранку!", opts: [
    { b: "Влаштувати свято", sf: g => `+${eAmt(g, 30)} сутності · міцніша дружба`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 30) * effEss(g), shadeT: addT(g.shadeT, 24) }), meta: m => ({ ...m, frogBond: (m.frogBond || 0) + 2 }), luck: 3 },
    { b: "Попросити тиші", sf: g => `+${aw(g, 0.14)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.14), g.maxWater) }) }] },
  { t: "Равликова гільдія", emo: "🐌", art: "snail", req: (g, m) => m.snailMet && g.day >= 8, weight: 0.5, timer: 12,
    d: "Равлик привів старшого з гільдії — на мушлі рідкісний, добірний крам.", opts: [
    { b: "Купити глибоке русло", sf: g => `−${aw(g, 0.12)} води · +${aw(g, 0.28)} об'єму`, fn: g => ({ ...g, water: g.water - aw(g, 0.12), maxWater: g.maxWater + aw(g, 0.28) }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Купити вічний мул", sf: g => `−${aw(g, 0.10)} води · +опір спеці`, fn: g => ({ ...g, water: g.water - aw(g, 0.10), sunResist: clamp(g.sunResist + 0.10, 0, 0.85) }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Пройти повз", s: "нічого", fn: g => g }] },
  { t: "Кошенята місячного кота", emo: "🐈‍⬛", art: "cat", req: (g, m) => m.catPet && g.day >= 6, tod: [0.74, 1.0], weight: 0.5,
    d: "Місячний кіт привів кошенят — вони бавляться у твоїх відблисках.", opts: [
    { b: "Бавитися з ними", sf: g => `+${eAmt(g, 24)} сутності · спокій`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 24) * effEss(g) }), meta: m => ({ ...m, catPet: true }), luck: 3 },
    { b: "Дати намилуватись місяцем", s: "−випар на 20с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 20) }) }] },
  { t: "Чапля-провидиця", emo: "🪽", art: "heron", req: (g) => g.day >= 9, weight: 0.5,
    d: "Стара чапля довго вдивлялася в тебе й прорекла прийдешню погоду.", opts: [
    { b: "Дослухатись пророцтва", sf: g => `+${eAmt(g, 22)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 22) * effEss(g) }), luck: 1 },
    { b: "Напоїти віщунку", sf: g => `−${aw(g, 0.10)} води · +вдача`, fn: g => ({ ...g, water: g.water - aw(g, 0.10) }), luck: 2 }] },
  { t: "Щедрий улов діда", emo: "🎣", art: "fisherman", req: (g) => g.day >= 11, weight: 0.5,
    d: "Дід-рибалка таки щось упіймав у тобі й на радощах поглибив твоє ложе.", opts: [
    { b: "Прийняти дарунок", sf: g => `+${aw(g, 0.16)} об'єму · +0.4/с`, fn: g => ({ ...g, maxWater: g.maxWater + aw(g, 0.16), passive: g.passive + 0.4 }) },
    { b: "Випросити сутність", sf: g => `+${eAmt(g, 34)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 34) * effEss(g) }) }] },

  /* — більше різноманіття: природа, дрібнота, дива — */
  { t: "Світлячки", emo: "✨", tod: [0.78, 1.0], weight: 0.9,
    d: "У сутінках над тобою закружляли світлячки, мов живі зорі.", opts: [
    { b: "Замилуватися", sf: g => `+${eAmt(g, 12)} сутності · спокій`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g), shadeT: addT(g.shadeT, 12) }), luck: 1 },
    { b: "Зловити одного в дзеркало", sf: g => `+${eAmt(g, 18)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 18) * effEss(g) }) }] },
  { t: "Грибний дощ", emo: "🍄", weight: 1.0,
    d: "Теплий грибний дощик сипнув на тебе дрібним сріблом.", opts: [
    { b: "Розкритись краплям", sf: g => `+${aw(g, 0.12)} води · наповнити ґрунт`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.12), g.maxWater), soil: g.soilMax }) },
    { b: "Зібрати на сутність", sf: g => `+${eAmt(g, 10)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 10) * effEss(g) }) }] },
  { t: "Бабка над гладдю", emo: "🦋", weight: 0.9,
    d: "Прозора бабка присіла на твою поверхню, ледь торкнувшись.", opts: [
    { b: "Завмерти дзеркалом", s: "+вбирання на 14с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 14) }), luck: 1 },
    { b: "Брижнути, щоб злетіла", sf: g => `+${aw(g, 0.05)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.05), g.maxWater) }) }] },
  { t: "Бджілка напитись", emo: "🐝", weight: 1.0,
    d: "Руда бджілка сіла на край і обережно п'є.", opts: [
    { b: "Пригостити", sf: g => `−${aw(g, 0.05)} води · +вдача`, fn: g => ({ ...g, water: g.water - aw(g, 0.05) }), meta: m => ({ ...m, beeFriend: true }), luck: 1 },
    { b: "Не ворушитись", s: "нічого", fn: g => g }] },
  { t: "Зоряний дощ", emo: "🌠", tod: [0.8, 1.0], weight: 0.7,
    d: "Нічним небом покотилася зірка — встигни загадати бажання.", opts: [
    { b: "Загадати вирости", sf: g => `+${aw(g, 0.14)} об'єму`, fn: g => ({ ...g, maxWater: g.maxWater + aw(g, 0.14) }), luck: 1 },
    { b: "Загадати щастя", s: "+вдача", fn: g => g, luck: 3 }] },
  { t: "Монетка на щастя", emo: "🪙", weight: 0.9,
    d: "Перехожий кинув у тебе монетку й щось загадав.", opts: [
    { b: "Прийняти бажання", sf: g => `+${eAmt(g, 14)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g) }) },
    { b: "Сховати в мул", sf: g => `+${eAmt(g, 8)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 8) * effEss(g) }), luck: 1 }] },
  { t: "Парасолька-втікачка", emo: "☂️", weight: 0.8,
    d: "Вітер прикотив до тебе чиюсь загублену парасольку — вона лягла тінню.", opts: [
    { b: "Сховатись у тінь", s: "−випар на 22с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 22) }) },
    { b: "Відпустити далі", sf: g => `+${aw(g, 0.06)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.06), g.maxWater) }) }] },
  { t: "Спраглий їжачок", emo: "🦔", req: (g) => g.day >= 3, weight: 0.9,
    d: "Колючий їжачок дріботить до тебе попити перед довгою дорогою.", opts: [
    { b: "Напоїти подорожнього", sf: g => `−${aw(g, 0.06)} води · +${eAmt(g, 10)} сутності`, fn: g => ({ ...g, water: g.water - aw(g, 0.06), pending: g.pending + eAmt(g, 10) * effEss(g) }), meta: m => ({ ...m, hogFriend: true }), luck: 1 },
    { b: "Завмерти", s: "нічого", fn: g => g }] },
  { t: "Перекотиполе", emo: "🌾", req: (g) => g.day >= 4, weight: 0.8,
    d: "Сухий клубок перекотиполя зачепився за твій край — пахне посухою.", opts: [
    { b: "Напоїти його", sf: g => `−${aw(g, 0.05)} води · нехай зеленіє`, fn: g => ({ ...g, water: g.water - aw(g, 0.05) }), luck: 1 },
    { b: "Струсити геть", s: "+вбирання на 12с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 12) }) }] },

  /* — істоти, що приходять лише як виростеш (мрія стати озером) — */
  { t: "Качка з виводком", emo: "🦆", req: (g) => g.maxWater >= 2500, weight: 0.8,
    d: "Ти вже досить велика — на тебе сіла качка перепочити з каченятами!", opts: [
    { b: "Прихистити родину", sf: g => `−${aw(g, 0.08)} води · +вдача`, fn: g => ({ ...g, water: g.water - aw(g, 0.08) }), meta: m => ({ ...m, duckFriend: true }), luck: 2 },
    { b: "Лишити воду собі", sf: g => `+${aw(g, 0.06)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.06), g.maxWater) }) }] },
  { t: "Каченята вернулись", emo: "🐤", req: (g, m) => m.duckFriend && g.maxWater >= 2500, weight: 0.6,
    d: "Підрослі каченята впізнали тебе й привели всю зграю — у тобі вирує життя.", opts: [
    { b: "Радіти гостям", sf: g => `+${eAmt(g, 26)} сутності · спокій`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 26) * effEss(g), shadeT: addT(g.shadeT, 14) }), luck: 2 },
    { b: "Навчити плавати", s: "+вбирання на 18с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 18) }) }] },
  { t: "Перший короп", emo: "🐟", req: (g) => g.maxWater >= 6000, weight: 0.7,
    d: "У твоїй глибині зблиснув лускою короп — ти вже майже озеро!", opts: [
    { b: "Дати йому дім", sf: g => `+${aw(g, 0.10)} об'єму · +вдача`, fn: g => ({ ...g, maxWater: g.maxWater + aw(g, 0.10) }), luck: 1 },
    { b: "Замилуватись", sf: g => `+${eAmt(g, 28)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 28) * effEss(g) }) }] },

  /* — українські меми та культурні гості (з любов'ю) — */
  { t: "Пасічник Ющенко", emo: "🐝", req: (g) => g.day >= 2, weight: 0.4,
    d: "Сивий пасічник підійшов із вуликом, примружився й мовив: «Бджоли — це Так!».", opts: [
    { b: "«Так!»", sf: g => `+${eAmt(g, 16)} сутності · мед`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }), meta: m => ({ ...m, beeFriend: true }), luck: 2 },
    { b: "Узяти воскову плівку", s: "−випар на 18с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 18) }), meta: m => ({ ...m, beeFriend: true }) }] },
  { t: "Рій золотих бджіл", emo: "🐝", req: (g, m) => m.beeFriend && g.day >= 4, weight: 0.35,
    d: "Знайомі бджоли привели цілий рій — гудуть над тобою золотою хмаркою.", opts: [
    { b: "Прийняти медовий дар", sf: g => `+${eAmt(g, 28)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 28) * effEss(g) }), luck: 1 },
    { b: "Попросити воскову плівку", s: "−випар на 22с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 22) }) }] },
  { t: "Кіт Степан завітав", emo: "🐈", req: (g) => g.day >= 2, weight: 0.4,
    d: "Біля тебе флегматично вмостився рудий кіт зі склянкою — точнісінько як на тих картинках.", opts: [
    { b: "Зробити вірусне фото", sf: g => `+${eAmt(g, 14)} сутності · слава`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g) }), meta: m => ({ ...m, catPet: true }), luck: 2 },
    { b: "Не турбувати кота", s: "+вбирання на 14с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 14) }) }] },
  { t: "Пес Патрон на службі", emo: "🐕", req: (g) => g.day >= 2, weight: 0.4,
    d: "Маленький джек-рассел у жилетці обнюхав твій берег: «Чисто — мін немає!».", opts: [
    { b: "Подякувати герою", sf: g => `+${eAmt(g, 16)} сутності · спокій`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g), shadeT: addT(g.shadeT, 10) }), meta: m => ({ ...m, dogFriend: true }), luck: 2 },
    { b: "Дати водички", sf: g => `−${aw(g, 0.06)} води · +вдача`, fn: g => ({ ...g, water: g.water - aw(g, 0.06) }), meta: m => ({ ...m, dogFriend: true }), luck: 2 }] },
  { t: "Чорнобаївка", emo: "💥", req: (g) => g.day >= 5, weight: 0.3,
    d: "Тут знову щось пішло не так — уже вкотре. Дивне місце, ця твоя яма.", opts: [
    { b: "Махнути рукою", sf: g => `+${eAmt(g, 12)} сутності (з досвіду)`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g) }), luck: 1 },
    { b: "Спробувати ще раз", sf: g => `+${aw(g, 0.08)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.08), g.maxWater) }) }] },
  { t: "Байрактар над полем", emo: "🛩️", req: (g) => g.day >= 4, weight: 0.3,
    d: "Над тобою з тихим дзижчанням пройшов знайомий безпілотник — мов із тієї пісеньки.", opts: [
    { b: "Помахати знизу", s: "+вбирання на 16с · бойовий дух", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 16) }), luck: 1 },
    { b: "Сховатись у тінь крила", s: "−випар на 16с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 16) }) }] },
  { t: "Червона калина", emo: "🌺", req: (g) => g.day >= 3, weight: 0.35,
    d: "Над тобою схилилась гілка червоної калини, і десь у вітрі вчувається пісня.", opts: [
    { b: "Підспівати", sf: g => `+${eAmt(g, 14)} сутності · піднесення`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g) }), luck: 1 },
    { b: "Вмочити ягідку", sf: g => `+${aw(g, 0.06)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.06), g.maxWater) }) }] },
  { t: "Доброго вечора!", emo: "🌻", tod: [0.74, 1.0], weight: 0.4,
    d: "Хтось проходить повз і кидає тепле: «Доброго вечора, ми з України!».", opts: [
    { b: "Привітатись у відповідь", s: "+вбирання на 14с · добрий настрій", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 14) }), luck: 1 },
    { b: "Засоромитись брижами", sf: g => `+${eAmt(g, 10)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 10) * effEss(g) }) }] },
  { t: "Штани за 40 гривень", emo: "👖", once: "pants", req: (g) => g.day >= 2, weight: 0.5,
    d: "У тебе шубовснули чиїсь джинси — ті самі, «за сорок гривень». Легендарна знахідка, раз на життя!", opts: [
    { b: "Виставити на продаж", sf: g => `+${eAmt(g, 40)} сутності (рівно за 40!)`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 40) * effEss(g) }), luck: 2 },
    { b: "Зробити з них тінь", s: "−випар на 40с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 40) }) }] },
  { t: "Кличко латає яму", emo: "🥊", req: (g) => g.day >= 3, weight: 0.3,
    d: "Сам мер прийшов оглянути твою яму: «Сьогодні-завтра залатаємо. Тому що!» — махнув рукою й кудись зник.", opts: [
    { b: "«Тому що!»", sf: g => `+${eAmt(g, 16)} сутності (за терпіння)`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }), luck: 1 },
    { b: "Дочекатись «ремонту»", sf: g => `−12% об'єму, зате +${eAmt(g, 18)} сутності`, fn: g => { const mw = Math.max(120, Math.round(g.maxWater * 0.88)); return { ...g, maxWater: mw, water: Math.min(g.water, mw), pending: g.pending + eAmt(g, 18) * effEss(g) }; } }] },

  /* — розгалуження за історією стосунків (дружба / образа / обман) — */
  { t: "Песик-приятель", emo: "🐕", art: "dog", req: (g, m) => m.dogFriend && g.day >= 4, weight: 0.6,
    d: "Той самий песик, якого ти напоїв, прибіг знову — приніс у зубах щось блискуче й завзято завиляв хвостом.", opts: [
    { b: "Прийняти дарунок", sf: g => `+${eAmt(g, 18)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 18) * effEss(g) }), luck: 2 },
    { b: "Погратися замість того", s: "+вбирання на 18с · вірний друг", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 18) }), luck: 1 }] },
  { t: "Жаб'яче віче", emo: "🐸", art: "frog", req: (g, m) => (m.frogBond || 0) >= 2, weight: 0.6,
    d: "Жаби зібрались коло тебе на раду — гадають, як помогти тобі вирости в озеро.", opts: [
    { b: "Прийняти поміч громади", sf: g => `+${aw(g, 0.18)} об'єму`, fn: g => ({ ...g, maxWater: g.maxWater + aw(g, 0.18) }), luck: 1 },
    { b: "Попросити колискову", sf: g => `+${eAmt(g, 22)} сутності · −випар на 16с`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 22) * effEss(g), shadeT: addT(g.shadeT, 16) }) }] },
  { t: "Скривджена Кума", emo: "🐸", art: "frog", req: (g, m) => m.frogShy && (m.frogBond || 0) < 2, weight: 0.7,
    d: "Жаба, яку ти колись прогнав, скоса визирає з очерету й не наближається.", opts: [
    { b: "Щиро перепросити", sf: g => `−${aw(g, 0.06)} води · знову дружба`, fn: g => ({ ...g, water: g.water - aw(g, 0.06) }), meta: m => ({ ...m, frogShy: false, frogBond: (m.frogBond || 0) + 1 }), luck: 2 },
    { b: "Байдуже знизати краєм", s: "нічого", fn: g => g }] },
  { t: "Равлик пропонує борг", emo: "🐌", art: "snail", req: (g, m) => m.snailMet && g.day >= 7, weight: 0.6, timer: 11,
    d: "Равлик підморгнув ріжком: «Бери крам у борг — поверне́ш сутністю, як підростеш».", opts: [
    { b: "Узяти об'єм у борг", sf: g => `+${aw(g, 0.16)} об'єму · −${eAmt(g, 18)} сутності`, fn: g => ({ ...g, maxWater: g.maxWater + aw(g, 0.16), pending: Math.max(0, g.pending - eAmt(g, 18) * effEss(g)) }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Чесно заплатити зараз", sf: g => `−${aw(g, 0.10)} води · +${aw(g, 0.11)} об'єму`, fn: g => ({ ...g, water: g.water - aw(g, 0.10), maxWater: g.maxWater + aw(g, 0.11) }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Пройти повз", s: "нічого", fn: g => g }] },
  { t: "Крук тисне на боржника", emo: "🐦‍⬛", art: "crow", cunning: true, req: (g, m) => m.tricked && g.day >= 6, weight: 0.7, timer: 9,
    d: "Крук, якому ти вже колись повірив, нахабно вимагає «повернути послугу».", opts: [
    { b: "Відкупитися", sf: g => `−${aw(g, 0.14)} води`, fn: g => ({ ...g, water: g.water - aw(g, 0.14) }), luck: -2 },
    { b: "Нарешті прогнати назавжди", s: "+вдача · спокій", fn: g => g, meta: m => ({ ...m, tricked: false }), luck: 3 }] },

  /* — хитруни: на вигляд вигідно, насправді користуються тобою (таємно мінус Вдача) — */
  { t: "Воронячий борг", emo: "🐦‍⬛", art: "crow", cunning: true, req: (g) => g.day >= 9, weight: 0.6, timer: 9,
    d: "Той самий крук повернувся: «Цього разу точно віддам борг — лиш позич трохи більше».", opts: [
    { b: "Знову повірити", sf: g => `−${aw(g, 0.16)} води · «велика віддяка»`, fn: g => ({ ...g, water: g.water - aw(g, 0.16) }), luck: -4 },
    { b: "Прогнати назавжди", s: "нічого", fn: g => g }] },
  { t: "Спритний крук", emo: "🐦‍⬛", art: "crow", cunning: true, req: (g) => g.day >= 3, weight: 1.0, timer: 10,
    d: "Крук схилив голову й зблиснув оком на твоє срібло: «Дай краплин — поверну скарбом, обіцяю».", opts: [
    { b: "Повірити круку", sf: g => `−${aw(g, 0.10)} води · обіцяє скарб`, fn: g => ({ ...g, water: g.water - aw(g, 0.10) }), luck: -3 },
    { b: "Не вестись", s: "нічого", fn: g => g }] },
  { t: "Очеретяний шепіт", emo: "🌾", cunning: true, req: (g) => g.day >= 4, weight: 0.9, timer: 9,
    d: "З очерету тягнеться вкрадливий шепіт: «Розкрийся ширше — і станеш цілим озером…»", opts: [
    { b: "Розкритись на шепіт", s: "обіцяє великий об'єм", fn: g => ({ ...g, water: g.water * 0.7, evapBoostT: addT(g.evapBoostT, 18) }), luck: -2 },
    { b: "Стулитись міцніше", s: "нічого", fn: g => g }] },
  { t: "Лощава п'явка", emo: "🪱", cunning: true, req: (g) => g.day >= 5, weight: 0.8, timer: 9,
    d: "Слизька п'явка лащиться до краю: «Я почищу тебе зсередини, будеш як кришталь».", opts: [
    { b: "Дозволити «почистити»", s: "обіцяє чистоту", fn: g => ({ ...g, water: g.water - aw(g, 0.08), evapBoostT: addT(g.evapBoostT, 16) }), luck: -2 },
    { b: "Струсити геть", sf: g => `+${aw(g, 0.04)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.04), g.maxWater) }) }] },
];

/* eligible events filtered by req + час доби (tod), потім зважений вибір */
/* ---------- загадки (рідкісна подія-вікторина) ----------
   q — загадка, a — правильна відповідь, w — хибні варіанти. */
const RIDDLES = [
  { q: "Без рук, без ніг, а ворота відчиняє.", a: "Вітер", w: ["Дощ", "Сонце"] },
  { q: "Біла скатертина все поле вкрила.", a: "Сніг", w: ["Туман", "Листя"] },
  { q: "Сидить дід за подушками й стріляє голками.", a: "Їжак", w: ["Кактус", "Сосна"] },
  { q: "Влітку сірий, а взимку білий.", a: "Заєць", w: ["Вовк", "Ведмідь"] },
  { q: "Що росте догори корінням?", a: "Бурулька", w: ["Морква", "Дерево"] },
  { q: "Серед ночі по небу гуляє, тьмяним світлом землю осяває.", a: "Місяць", w: ["Сонце", "Зоря"] },
  { q: "Розсипався горох на сто доріг — ніхто його не позбирає.", a: "Зорі", w: ["Сніг", "Град"] },
  { q: "Сидить дівчина в семи кожухах; хто роздягає, той сльози проливає.", a: "Цибуля", w: ["Капуста", "Часник"] },
  { q: "Сидить баба на грядці, вся закутана в хустки.", a: "Капуста", w: ["Гарбуз", "Буряк"] },
  { q: "Сидить красна дівчина в темниці, а коса її на вулиці.", a: "Морква", w: ["Буряк", "Ріпа"] },
  { q: "Кругле, зелене, із хвостиком, а всередині червоне й солодке.", a: "Кавун", w: ["Гарбуз", "Огірок"] },
  { q: "Біла бочка, а нема ні сучка, ні дучки.", a: "Яйце", w: ["Гарбуз", "Картопля"] },
  { q: "Маю шапку, та без голови; маю ніжку, та без чобота.", a: "Гриб", w: ["Цвях", "Свічка"] },
  { q: "Чотири ноги має, а ходити не вміє.", a: "Стіл", w: ["Стілець", "Шафа"] },
  { q: "Два кінці, два кільця, а посередині цвях.", a: "Ножиці", w: ["Окуляри", "Велосипед"] },
  { q: "День і ніч стукоче, ніколи не спочине.", a: "Годинник", w: ["Дятел", "Молоток"] },
  { q: "Маленька, гостренька, через усе село пройшла й сорочку пошила.", a: "Голка", w: ["Шпилька", "Ніж"] },
  { q: "Зубів багато має, а нічого не з'їдає.", a: "Гребінець", w: ["Замок", "Книга"] },
  { q: "Не кущ, а з листочками; не людина, а все розкаже.", a: "Книга", w: ["Газета", "Зошит"] },
  { q: "Тоненький, кругленький, серце чорне; хто гляне — думку відгадає.", a: "Олівець", w: ["Ручка", "Цвях"] },
  { q: "Сам пустий, а голос густий; дроб вибиває, всіх скликає.", a: "Барабан", w: ["Дзвін", "Бубон"] },
  { q: "Текло, текло та й лягло під скло.", a: "Лід", w: ["Роса", "Туман"] },
  { q: "По стінах стрибає, а в руки не дається.", a: "Сонячний зайчик", w: ["Тінь", "Муха"] },
  { q: "Куди ти — туди й вона, а вночі зникає вона.", a: "Тінь", w: ["Відлуння", "Слід"] },
  { q: "Голос є, а тіла нема; гукнеш — відгукнеться сама.", a: "Відлуння", w: ["Тінь", "Вітер"] },
  { q: "Без рук, без ніг, а вгору лізе.", a: "Дим", w: ["Тісто", "Плющ"] },
  { q: "Удень спить, уночі літає, перехожих лякає.", a: "Сова", w: ["Горобець", "Орел"] },
  { q: "Маленька, сіренька, а хвостик, мов шило.", a: "Миша", w: ["Білка", "Кріт"] },
  { q: "Без сокири й лопати греблю на річці будує.", a: "Бобер", w: ["Видра", "Ондатра"] },
  { q: "Зелененька, скрекотлива, біля річки гомінлива.", a: "Жаба", w: ["Ящірка", "Коник"] },
  { q: "Не звір, не птах, а ніс, як шпиця; всю ніч дзижчить, спати не дає.", a: "Комар", w: ["Бджола", "Муха"] },
  { q: "Сам пряде, сам тче, а сорочки не носить.", a: "Павук", w: ["Шовкопряд", "Кравець"] },
  { q: "Хату на собі носить, а в гості не проситься.", a: "Равлик", w: ["Жук", "Мурашка"] },
  { q: "Влітку наїдається, а всю зиму висипається.", a: "Ведмідь", w: ["Вовк", "Лось"] },
  { q: "По дереву стукає, а з-під кори черв'яка дістає.", a: "Дятел", w: ["Сорока", "Сова"] },
  { q: "Гребінець на голові, не швець, а зі шпорами; на тину сидить, світанок кричить.", a: "Півень", w: ["Індик", "Гусак"] },
  { q: "Зимою й літом одним кольором.", a: "Ялинка", w: ["Дуб", "Береза"] },
  { q: "Влітку вдягається, а на зиму роздягається.", a: "Дерево", w: ["Поле", "Гора"] },
  { q: "Лежить, лежить, по всьому світу біжить, а з місця не зрушить.", a: "Дорога", w: ["Річка", "Стіна"] },
  { q: "Біжить, біжить — не вибіжить; тече, тече — не витече.", a: "Річка", w: ["Час", "Дорога"] },
  { q: "Пливе небом біла гора, а тінь на землю кида.", a: "Хмара", w: ["Туман", "Дим"] },
  { q: "Іде з неба, та не сніг; землю напуває, трава буяє.", a: "Дощ", w: ["Роса", "Град"] },
  { q: "Зранку на травах блищить, а сонце зійде — і зникне вмить.", a: "Роса", w: ["Іній", "Туман"] },
  { q: "Сім кольорів від краю до краю після дощу в небі сяють.", a: "Веселка", w: ["Зоря", "Блискавка"] },
  { q: "У воді родиться, а води боїться.", a: "Сіль", w: ["Пісок", "Камінь"] },
  { q: "Біле поле, чорне зерня; хто посіє — той розумний.", a: "Папір", w: ["Сніг", "Поле"] },
  { q: "Чорна, крива, по хаті ходить, у вогонь лазить.", a: "Кочерга", w: ["Лопата", "Мітла"] },
  { q: "Кланяється, кланяється, прийде додому — розпростається.", a: "Сокира", w: ["Коса", "Молоток"] },
  { q: "За білими дверима, за червоними замками, без кісток, а працює.", a: "Язик", w: ["Зуб", "Серце"] },
  { q: "Біла отара за червоними горами.", a: "Зуби", w: ["Перлини", "Сніжинки"] },
  { q: "Брат із братом через дорогу живуть, а один одного не бачать.", a: "Очі", w: ["Вуха", "Береги"] },
  { q: "Лежить драбина — нема їй кінця; крокуй по щаблях угору без упину.", a: "Драбина", w: ["Міст", "Колія"] },
  { q: "Пливе по морю, дим пускає, людей за море перевозить.", a: "Корабель", w: ["Поїзд", "Літак"] },
  { q: "По залізній стежці біжить, колесами стукоче, всіх везе, куди хочеш.", a: "Поїзд", w: ["Трамвай", "Автобус"] },
  { q: "У дощ розквітає, від води ховає; сонце вигляне — згортається.", a: "Парасолька", w: ["Квітка", "Намет"] },
  { q: "Сама себе з'їдає, а світло дарує.", a: "Свічка", w: ["Лампа", "Сірник"] },
  { q: "Маленький, дерев'яний, голівка вогняна; раз креснеш — і займеться.", a: "Сірник", w: ["Свічка", "Гніт"] },
  { q: "Золоте, вусате, в полі колоситься, із нього хліб родиться.", a: "Пшениця", w: ["Соняшник", "Кукурудза"] },
  { q: "Голова велика, насіння повна; за сонцем цілий день голівку повертає.", a: "Соняшник", w: ["Ромашка", "Мак"] },
  { q: "Лежить на грядці жовтий бік, великий, круглий, як бочок.", a: "Гарбуз", w: ["Кавун", "Диня"] },
  { q: "Стоїть у дворі з відром на голові; сонце пригріє — і він розтане.", a: "Сніговик", w: ["Опудало", "Стовп"] },
  { q: "З неба зірочка летить, на долоні вмить розтане.", a: "Сніжинка", w: ["Дощинка", "Пушинка"] },
  { q: "Двоє братів по боках голови живуть, усе чують, та мовчать.", a: "Вуха", w: ["Очі", "Щоки"] },
  { q: "Хто вранці на чотирьох, удень на двох, а ввечері на трьох?", a: "Людина", w: ["Час", "Сонце"] },
  { q: "Що без вогню найдужче гріє?", a: "Сонце", w: ["Піч", "Ковдра"] },
  { q: "Червоний колір, а білий смак.", a: "Редиска", w: ["Помідор", "Яблуко"] },
];
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function makeRiddleEvent() {
  const r = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];
  const opts = shuffle([{ text: r.a, correct: true }, ...r.w.map(t => ({ text: t, correct: false }))]).map(o => (
    o.correct
      ? { b: o.text, sfx: "win", fn: g => ({ ...g, pending: g.pending + eAmt(g, 22) * effEss(g), water: Math.min(g.water + aw(g, 0.08), g.maxWater) }), luck: 2,
          then: { t: "Влучно! 🎉", emo: "🎉", d: `Так, це ${r.a}. Мудра калабаня!`, opts: [{ b: "Далі →", fn: g => g }] } }
      : { b: o.text, sfx: "bad", fn: g => g,
          then: { t: "Не цього разу 🙃", emo: "🙃", d: `Правильна відповідь — «${r.a}». Наступного разу пощастить!`, opts: [{ b: "Далі →", fn: g => g }] } }
  ));
  return { t: "Загадка мандрівника", emo: "🧩", d: `«${r.q}»`, timer: 16, opts };
}

function pickEvent(g, meta) {
  const tod = g.dayLen ? clamp(g.elapsed / g.dayLen, 0, 1) : 0.5;
  const okReq = e => !e.req || e.req(g, meta);
  const okTod = e => !e.tod || (tod >= e.tod[0] && tod <= e.tod[1]);
  const okOnce = e => !e.once || !((meta.seenOnce || {})[e.once]); // одноразові події — лише раз за всю гру
  let pool = EVENTS.filter(e => okReq(e) && okTod(e) && okOnce(e));
  if (!pool.length) pool = EVENTS.filter(e => okReq(e) && okOnce(e)); // запас: якщо за часом нічого не підійшло
  const tot = pool.reduce((a, e) => a + (e.weight || 1), 0);
  let r = Math.random() * tot;
  for (const e of pool) { r -= (e.weight || 1); if (r <= 0) return e; }
  return pool[pool.length - 1] || EVENTS[0];
}

/* ---------- Колесо Фортуни (рідкісне) + прихована Вдача ---------- */
// прихований коефіцієнт вдачі 0..1 з накопичених добрих рішень (meta.fate)
const fateLuck = (meta) => clamp((meta.fate || 0) / 24, 0, 1);
const WHEEL = [
  { emo: "🌈", nm: "Джекпот", tier: "jackpot", col: "#cdb4f6", w: 1,
    fn: g => ({ ...g, water: g.maxWater, maxWater: g.maxWater + 80, pending: g.pending + 60 * effEss(g) }),
    msg: "Небо розщедрилось: повна вода, +об'єм і повна жменя сутності!" },
  { emo: "💎", nm: "Скарб", tier: "good", col: "#7fe8b0", w: 2,
    fn: g => ({ ...g, pending: g.pending + 40 * effEss(g) }), msg: "На дні зблиснув скарб — багато сутності." },
  { emo: "💧", nm: "Повінь", tier: "good", col: "#74c39a", w: 2,
    fn: g => ({ ...g, water: g.maxWater }), msg: "Раптова повінь наповнила тебе по вінця." },
  { emo: "🍀", nm: "Доля", tier: "good", col: "#9be8c0", w: 2, luck: 3,
    fn: g => ({ ...g, pending: g.pending + 12 * effEss(g) }), msg: "Тобі усміхнулась доля — вдача зросла." },
  { emo: "➖", nm: "Нічого", tier: "none", col: "#3a4a52", w: 3,
    fn: g => g, msg: "Колесо завмерло на порожнечі. Нічого не сталось." },
  { emo: "🥀", nm: "Посуха", tier: "bad", col: "#f0a86a", w: 2,
    fn: g => ({ ...g, water: g.water * 0.5, evapBoostT: 14 }), msg: "Війнуло жаром — пів води й сильніший випар." },
  { emo: "🕳️", nm: "Провал", tier: "bad", col: "#e07a5a", w: 1.6,
    fn: g => ({ ...g, water: g.water * 0.6, maxWater: Math.max(120, Math.round(g.maxWater * 0.8)) }), msg: "Дно просіло — менше об'єму й води." },
  { emo: "💀", nm: "Безодня", tier: "verybad", col: "#c0504a", w: 1,
    fn: g => ({ ...g, water: Math.min(g.water, g.maxWater * 0.06) }), msg: "Тріщина випила тебе майже до останньої краплі." },
];
function pickWheel(luck) {
  const ws = WHEEL.map(s => {
    let w = s.w;
    if (s.tier === "jackpot" || s.tier === "good") w *= (1 + 1.3 * luck);
    else if (s.tier === "bad") w *= (1 - 0.6 * luck);
    else if (s.tier === "verybad") w *= (1 - 0.85 * luck);
    return Math.max(0.05, w);
  });
  const tot = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return i; }
  return WHEEL.length - 1;
}

/* ---------- achievements ---------- */
const ACHIEVEMENTS = [
  { id: "firstdew", e: "🌅", nm: "Перша роса",      dq: "Пережити першу ніч і вціліти до світанку." },
  { id: "rainchild", e: "🌧️", nm: "Дитя дощу",      dq: "Наповнитися по вінця під час дня." },
  { id: "sevensuns", e: "☀️", nm: "Сім сонць",      dq: "Протриматися сім днів попри спеку." },
  { id: "unfathom", e: "🕳️", nm: "Незглибима",      dq: "Досягти об'єму у 500 крапель." },
  { id: "fortune",  e: "🌈", nm: "Усмішка фортуни", dq: "Зірвати джекпот у прогнозі погоди." },
  { id: "mirror",   e: "🪞", nm: "Дзеркало неба",   dq: "Прожити цілий день, жодного разу не торкнувшись ґрунту." },
  { id: "lastdrop", e: "💧", nm: "Остання крапля",  dq: "Дожити до сутінків, маючи менш як 5 крапель." },
  { id: "oldpuddle", e: "👵", nm: "Стара калабаня", dq: "Прожити тридцять днів і стати легендою подвір'я." },
  { id: "kumasya",  e: "🐸", nm: "Кумася",          dq: "Заприятелювати з жабою, що повертається." },
  { id: "merchant", e: "🐌", nm: "Равликів борг",   dq: "Поторгувати з равликом-крамарем." },
  { id: "mooncat",  e: "🐈‍⬛", nm: "Місячний гість",  dq: "Погладити місячного кота брижами." },
  { id: "deepwell", e: "🟦", nm: "Підземне озеро",  dq: "Прокласти шлях до підземного озера." },
  { id: "eternal",  e: "🏵️", nm: "Вічна калабаня",  dq: "Прожити п'ятдесят днів." },
  { id: "ascend",   e: "🌥️", nm: "Велике Випаровування", dq: "Розчинитися в небі та переродитися хмарою." },
  { id: "pond",     e: "🪷", nm: "Ставок",          dq: "Дорости до об'єму ставка (2.5к)." },
  { id: "lakeach",  e: "🏞️", nm: "Озеро",           dq: "Дорости до об'єму озера (16к)." },
  { id: "ocean",    e: "🌊", nm: "Океан",           dq: "Здійснити мрію — дорости до об'єму океану (160к)." },
  { id: "worldocean", e: "🌍", nm: "Світовий океан", dq: "Дорости до мільйона об'єму — справжній океан світу.", hidden: true },
  { id: "bestfriend", e: "🐸", nm: "Нерозлийвода",  dq: "Дорости дружбу з жабою до 6-го рівня." },
  // приховані: текст з'являється лише після відкриття
  { id: "allfriends", e: "🐾", nm: "Душа компанії", dq: "Заприятелювати з жабою, котом і равликом за один забіг.", hidden: true },
  { id: "deceived", e: "😈", nm: "Обкручений довкола пальця", dq: "Повестися на солодку обіцянку хитрого гостя.", hidden: true },
  { id: "lucky",    e: "🍀", nm: "Пещений долею",   dq: "Накопичити дуже високу приховану Вдачу.", hidden: true },
  { id: "warmed",   e: "🌡️", nm: "Жертва потепління", dq: "Висохнути від глобального потепління (день 20+).", hidden: true },
  { id: "trial",    e: "🚀", nm: "Загартована",      dq: "Пережити День Випробування." },
  { id: "festival", e: "🎉", nm: "Слава Республіці!", dq: "Відсвяткувати Фестиваль Республіка (12-й день)." },
  { id: "flitstar", e: "⭐", nm: "Флііііт!", dq: "Побачити, як їжачок із траси злітає зіркою.", hidden: true },
  { id: "ducks",    e: "🦆", nm: "Дім для всіх",     dq: "Прихистити качку з каченятами." },
  { id: "summoner", e: "📣", nm: "Гукни друзів",     dq: "Уперше скористатися здібністю друга.", hidden: true },
  { id: "combo3",   e: "✨", nm: "Зграя помічників", dq: "Скласти комбо з 3 здібностей поспіль.", hidden: true },
  { id: "combo5",   e: "🎆", nm: "Симфонія друзів",  dq: "Скласти комбо ×5.", hidden: true },
  { id: "comboMix", e: "🌈", nm: "Усі гуртом",       dq: "В одному комбо — 3 різні здібності.", hidden: true },
  { id: "synergy",  e: "🧩", nm: "Спільна пісня",    dq: "Поєднати дві здібності в синергію.", hidden: true },
  { id: "shrek",    e: "🧅", nm: "Це моє болото!",   dq: "Так замулитись, що калабаня стала справжнім болотом.", hidden: true },
];

/* ---------- Дні Випробувань: кожен 10-й день — особливий, без прокруту погоди ---------- */
const CHALLENGE_EVERY = 10;
const CHALLENGES = [
  { id: "heat", emo: "☀️", nm: "Аномальна спека", tone: "danger",
    warn: "Синоптики обіцяють аномальну спеку.", desc: "Спекотніше за звичай — тримай запас води.",
    apply: w => ({ ...w, sunMod: (w.sunMod || 0) + 0.7 }) },
  { id: "rocket", emo: "🚀", nm: "Запуск ракети", tone: "danger",
    warn: "Поряд космодром — буде запуск ракети. Чекай на пекло.", desc: "Пекельний жар від ракетних двигунів. Переживи його!",
    apply: w => ({ ...w, sunMod: (w.sunMod || 0) + 1.3, evapMod: (w.evapMod || 0) + 0.15 }) },
  { id: "drought", emo: "🔥", nm: "Велика засуха", tone: "danger",
    warn: "Насувається велика засуха — без жодної краплі.", desc: "Ні дощу — лиш жар і нещадний випар.",
    apply: w => ({ ...w, sunMod: (w.sunMod || 0) + 0.8, rainPower: 0, evapMod: (w.evapMod || 0) + 0.25 }) },
  { id: "dust", emo: "🌪️", nm: "Курна буря", tone: "danger",
    warn: "Іде курна буря — ґрунт пересохне, вбирати буде нічим.", desc: "Ґрунт мертвий: вбирання не діє. Виживай на запасі та припливі.",
    apply: w => ({ ...w, sunMod: (w.sunMod || 0) + 0.4 }) },
  { id: "eclipse", emo: "🌑", nm: "Сонячне затемнення", tone: "good",
    warn: "Близиться сонячне затемнення — благодатна прохолода.", desc: "Затемнення дарує перепочинок: майже без випару.",
    apply: w => ({ ...w, sunMod: (w.sunMod || 0) - 0.7, evapMod: (w.evapMod || 0) - 0.5 }) },
];
const challengeForDay = (day) => (day >= CHALLENGE_EVERY && day % CHALLENGE_EVERY === 0) ? CHALLENGES[(day / CHALLENGE_EVERY - 1) % CHALLENGES.length] : null;
const nextChallengeDay = (day) => (Math.floor(day / CHALLENGE_EVERY) + 1) * CHALLENGE_EVERY;
const applyChallenge = (w, day) => {
  const ch = challengeForDay(day); if (!ch) return w;
  const nw = ch.apply({ ...(w || NEUTRAL) });
  return { ...nw, name: ch.nm, icon: ch.emo, tier: ch.tone, challenge: ch.id };
};

/* ---------- ФЕСТИВАЛІ: особливі святкові дні ----------
   Кожен фест має власну погоду й тему. Торкатися калабані не можна — лише святкувати,
   а події (зокрема короткі «флеш») линуть одна за одною. */
const FESTIVALS = [
  { id: "respublika", day: 12, emo: "🎉", nm: "ФЕСТИВАЛЬ РЕСПУБЛІКА", color: "var(--water-a)", tone: "win", ticket: 650,
    intro: "Дванадцятий день — велике свято! Небо дарує зливу-благодать, тож торкатися тебе нікому не дають — лише святкуй. Гості, музика й дива линуть одне за одним.",
    weather: { rainPower: 2.6, sunMod: -0.5, absorbMod: 0, evapMod: -0.35, essMod: 0.6, name: "ФЕСТИВАЛЬ РЕСПУБЛІКА", icon: "🎉", idxs: [1, 1, 1], tier: "jackpot", festival: true },
    events: [
      { t: "Фестиваль РЕСПУБЛІКА!", emo: "🎉", d: "Над калабанею злітають прапори, грає музика, дощ-благодать ллє з неба! Сьогодні нічого не треба робити — лише святкувати.",
        opts: [{ b: "Ну, гуляймо!", sf: g => `+${eAmt(g, 14)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g) }), luck: 1 }] },
      { t: "Перший залп феєрверку", emo: "🎆", flash: true, timer: 5, d: "Небо спалахнуло барвами — їхній відблиск затанцював на твоїй гладі!",
        opts: [{ b: "Милуватись", sf: g => `+${eAmt(g, 10)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 10) * effEss(g) }) }] },
      { t: "Лине гімн", emo: "🎶", d: "Усі підвелись — над майданом і над тобою лине гімн. Вода тремтить у такт.",
        opts: [
          { b: "Підспівати брижами", sf: g => `+${eAmt(g, 18)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 18) * effEss(g) }), luck: 2 },
          { b: "Завмерти з шани", s: "−випар на 20с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 20) }) }] },
      { t: "Вареники з неба", emo: "🥟", d: "Господині несуть полумиски — кілька гарячих вареників шубовснули просто в тебе!",
        opts: [
          { b: "Розчинити начинку", sf: g => `+${eAmt(g, 16)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }) },
          { b: "Сховати на потім", sf: g => `+${aw(g, 0.12)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.12), g.maxWater) }) }] },
      { t: "Кобзар торкнув струни", emo: "🪕", flash: true, timer: 6, d: "Дума попливла над водою — на мить усе стихло, і навіть сонце сховалось.",
        opts: [{ b: "Заслухатись", s: "−випар на 22с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 22) }) }] },
      { t: "Віддзеркалена вишиванка", emo: "🧵", d: "Дівчина схилилась поправити вінок — і в тобі віддзеркалився цілий рушник із червоно-чорним мереживом.",
        opts: [{ b: "Замилуватись візерунком", sf: g => `+${eAmt(g, 20)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 20) * effEss(g) }), luck: 2 }] },
      { t: "Гопак!", emo: "💃", flash: true, timer: 5, d: "Танцюристи закружляли гопак, аж бризки полетіли навсібіч!",
        opts: [{ b: "Підхопити ритм", sf: g => `+${eAmt(g, 12)} сутності · +вбирання`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g), absorbBoostT: addT(g.absorbBoostT, 14) }) }] },
      { t: "Кулі в небо", emo: "🎈", flash: true, timer: 5, d: "Сотні барвистих кульок зринули в небо й відбились у твоїй гладі.",
        opts: [{ b: "Загадати з ними бажання", sf: g => `+${eAmt(g, 12)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g) }), luck: 1 }] },
      { t: "Медова ярмарка", emo: "🍯", d: "Пасічники розклали барила — мед, медовуха, перга. Чим почастуєшся?",
        opts: [
          { b: "Скуштувати медовухи", sf: g => `+${aw(g, 0.12)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.12), g.maxWater) }) },
          { b: "Виміняти стільники на блиск", sf: g => `+${eAmt(g, 22)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 22) * effEss(g) }) }] },
      { t: "Трембіта над майданом", emo: "🪈", flash: true, timer: 6, d: "Протяжний голос трембіти прокотився над натовпом — мурашки по воді.",
        opts: [{ b: "Завмерти в тиші", s: "−випар на 24с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 24) }) }] },
      { t: "Вуличні артисти", emo: "🤹", d: "Жонглери, ходулісти й вогнедихи влаштували виставу просто над тобою.",
        opts: [
          { b: "Кидати їм у відбиток монетки", sf: g => `+${eAmt(g, 24)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 24) * effEss(g) }), luck: 2 },
          { b: "Ловити іскри вогнедихів", s: "+вбирання на 16с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 16) }) }] },
      { t: "Водограй ожив", emo: "⛲", flash: true, timer: 5, d: "На площі вдарив святковий водограй — бризки долетіли й до тебе!",
        opts: [{ b: "Зловити струмінь", sf: g => `+${aw(g, 0.16)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.16), g.maxWater) }) }] },
      { t: "Фінальний салют РЕСПУБЛІКИ", emo: "🎇", finale: true, d: "Небо вибухнуло золотим феєрверком — увесь майдан гукає «Слава!». Свято лишає тебе повною по вінця.",
        opts: [{ b: "Слава!", sf: g => `повна вода · +${eAmt(g, 40)} сутності`, fn: g => ({ ...g, water: g.maxWater, pending: g.pending + eAmt(g, 40) * effEss(g) }), luck: 3 }] },
    ] },

  { id: "fainemisto", day: 18, emo: "🎸", nm: "ФАЙНЕ МІСТО", color: "var(--sun)", tone: "danger", ticket: 1400,
    intro: "Тернопільське «Файне місто» гримить роком під палючим сонцем — спека, драйв і засуха! Води з неба обмаль, тож лови дари зі сцени.",
    weather: { rainPower: 0.7, sunMod: 0.35, absorbMod: 0, evapMod: 0.08, essMod: 0.5, name: "ФАЙНЕ МІСТО · спека", icon: "🎸", idxs: [6, 6, 6], tier: "danger", festival: true },
    events: [
      { t: "Файне місто гримить!", emo: "🎸", d: "Сонце палить, а зі сцени б'є рок. Натовп реве, і навіть твоя гладь дрижить від басів.",
        opts: [{ b: "Дати жару!", sf: g => `+${eAmt(g, 16)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }), luck: 1 }] },
      { t: "Барабанне соло", emo: "🥁", flash: true, timer: 5, d: "Драм-соло струснуло повітря — брижі пішли тобою колами.",
        opts: [{ b: "Вібрувати в такт", sf: g => `+${eAmt(g, 12)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g) }) }] },
      { t: "Намет від сонця", emo: "⛱️", d: "Утомлені рокери напнули над тобою тент — рятівна тінь серед спеки.",
        opts: [
          { b: "Сховатись у холодок", s: "−випар на 26с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 26) }) },
          { b: "Лишитись на сонці", sf: g => `+${eAmt(g, 18)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 18) * effEss(g) }) }] },
      { t: "Кухоль квасу", emo: "🍺", d: "Хтось перехилив кухоль холодного квасу просто в тебе, щоб освіжити.",
        opts: [
          { b: "Прийняти прохолоду", sf: g => `+${aw(g, 0.14)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.14), g.maxWater) }) },
          { b: "Зварити з нього сутність", sf: g => `+${eAmt(g, 14)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g) }) }] },
      { t: "Стейдж-дайв!", emo: "🤘", flash: true, timer: 5, d: "Фанат стрибнув зі сцени на руки натовпу — бризки злетіли аж до тебе!",
        opts: [{ b: "Спіймати хвилю", sf: g => `+${eAmt(g, 10)} сутності · +вбирання`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 10) * effEss(g), absorbBoostT: addT(g.absorbBoostT, 14) }) }] },
      { t: "Гітарний рифф", emo: "🎸", flash: true, timer: 5, d: "Соло-гітарист вийшов на край сцени й видав рифф, від якого тремтить повітря.",
        opts: [{ b: "Резонувати", sf: g => `+${eAmt(g, 16)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }) }] },
      { t: "Водяна гармата на натовп", emo: "💦", flash: true, timer: 5, d: "Щоб охолодити розпашілих фанатів, увімкнули водяну гармату — і тобі перепало!",
        opts: [{ b: "Підставитись під струмінь", sf: g => `+${aw(g, 0.18)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.18), g.maxWater) }) }] },
      { t: "Фуд-корт", emo: "🌭", d: "Запахло гриллю, бургерами й кукурудзою. Чим підживишся?",
        opts: [
          { b: "Млинці з начинкою", sf: g => `+${eAmt(g, 20)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 20) * effEss(g) }) },
          { b: "Лимонад із льодом", sf: g => `+${aw(g, 0.1)} води · прохолода`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.1), g.maxWater), shadeT: addT(g.shadeT, 14) }) }] },
      { t: "Кинули мерч", emo: "🧢", d: "Зі сцени полетіли футболки й кепки — щось упало просто на тебе.",
        opts: [
          { b: "Продати раритетну футболку", sf: g => `+${eAmt(g, 22)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 22) * effEss(g) }) },
          { b: "Лишити на згадку", s: "+вдача", fn: g => g, luck: 2 }] },
      { t: "Серкл-піт!", emo: "🌀", flash: true, timer: 5, d: "Натовп розкрутив величезне коло — здійнялась курява й вихор.",
        opts: [{ b: "Закрутитись вихором", s: "+вбирання на 18с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 18) }) }] },
      { t: "Хедлайнер виходить", emo: "🎤", finale: true, d: "Останній рифф розриває ніч — фаєри спалахують, і над сценою проливається вода з гармат.",
        opts: [{ b: "Розчинитись у звуці", sf: g => `повна вода · +${eAmt(g, 36)} сутності`, fn: g => ({ ...g, water: g.maxWater, pending: g.pending + eAmt(g, 36) * effEss(g) }), luck: 2 }] },
    ] },

  { id: "zakhid", day: 24, emo: "🤘", nm: "ЗАХІД ФЕСТ", color: "var(--good)", tone: "win", ticket: 2600,
    intro: "Львівський «Захід» — прохолодний вітер, сонце крізь хмари і панк-енергія. Свіжо, гучно й весело!",
    weather: { rainPower: 0.9, sunMod: 0.1, absorbMod: 0.2, evapMod: -0.2, essMod: 0.5, name: "ЗАХІД ФЕСТ · прохолода", icon: "🤘", idxs: [2, 2, 2], tier: "good", festival: true },
    events: [
      { t: "Захід прокидається", emo: "🤘", d: "Гори дихають прохолодою, сонце визирає крізь хмари, а зі сцени летить панк-драйв.",
        opts: [{ b: "Влитись у вир", sf: g => `+${eAmt(g, 16)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }), luck: 1 }] },
      { t: "Слем у пітбені", emo: "💥", flash: true, timer: 5, d: "Натовп закрутив скажений слем — хвиля плескоту докотилась і до тебе.",
        opts: [{ b: "Розгойдатись", sf: g => `+${eAmt(g, 12)} сутності · +вбирання`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g), absorbBoostT: addT(g.absorbBoostT, 14) }) }] },
      { t: "Гірський бриз", emo: "🌬️", d: "Свіжий вітер скотився з Карпат, несучи прохолоду й дрібну мжичку.",
        opts: [
          { b: "Підставитись мжичці", sf: g => `+${aw(g, 0.13)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.13), g.maxWater) }) },
          { b: "Завмерти у прохолоді", s: "−випар на 24с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 24) }) }] },
      { t: "Ватра на світанні", emo: "🔥", d: "Колом запалала ватра — гурти грають акустику, аж до ранку.",
        opts: [
          { b: "Гріти боки біля ватри", sf: g => `+${eAmt(g, 20)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 20) * effEss(g) }), luck: 2 },
          { b: "Дзеркалити зорі", s: "−випар на 20с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 20) }) }] },
      { t: "Карпатський туман", emo: "🌁", flash: true, timer: 6, d: "З гір накотила прохолодна імла й огорнула сцену молочною завісою.",
        opts: [{ b: "Сховатись у тумані", s: "−випар на 26с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 26) }) }] },
      { t: "Бринза й вино", emo: "🧀", d: "Карпатські ґазди розклали бринзу, гуслянку й тепле вино.",
        opts: [
          { b: "Продегустувати на блиск", sf: g => `+${eAmt(g, 22)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 22) * effEss(g) }) },
          { b: "Запити гуслянкою", sf: g => `+${aw(g, 0.12)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.12), g.maxWater) }) }] },
      { t: "Акустичний сет", emo: "🎸", flash: true, timer: 6, d: "На малій сцені заграли тихий акустичний сет — натовп присів на траву.",
        opts: [{ b: "Розчулитись", sf: g => `+${eAmt(g, 12)} сутності · −випар на 16с`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 12) * effEss(g), shadeT: addT(g.shadeT, 16) }) }] },
      { t: "Стіна смерті", emo: "🤟", flash: true, timer: 5, d: "Натовп розступився надвоє й за командою вокаліста зійшовся стіною!",
        opts: [{ b: "Влитись у зіткнення", sf: g => `+${eAmt(g, 14)} сутності · +вбирання`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g), absorbBoostT: addT(g.absorbBoostT, 14) }) }] },
      { t: "Намети фестивалю", emo: "🏕️", d: "Поле вкрилось наметами — хтось уже бренькає на гітарі біля свого.",
        opts: [
          { b: "Слухати пісні до ранку", sf: g => `+${eAmt(g, 18)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 18) * effEss(g) }), luck: 1 },
          { b: "Подрімати в холодку", s: "−випар на 22с", fn: g => ({ ...g, shadeT: addT(g.shadeT, 22) }) }] },
      { t: "Фінал на головній сцені", emo: "🎆", finale: true, d: "Хедлайнер врубив фінал — над юрбою злітають конфеті й холодні струмені води.",
        opts: [{ b: "Стрибати під біт", sf: g => `повна вода · +${eAmt(g, 34)} сутності`, fn: g => ({ ...g, water: g.maxWater, pending: g.pending + eAmt(g, 34) * effEss(g) }), luck: 2 }] },
    ] },

  { id: "atlas", day: 29, emo: "🎶", nm: "ATLAS WEEKEND", color: "var(--essence)", tone: "win", ticket: 4200,
    intro: "Київський Atlas Weekend — найбільша сцена країни, тисячі вогнів, лазери й нескінченний драйв. Сутність ллється рікою!",
    weather: { rainPower: 1.2, sunMod: -0.1, absorbMod: 0.3, evapMod: -0.1, essMod: 0.9, name: "ATLAS WEEKEND", icon: "🎶", idxs: [5, 5, 5], tier: "jackpot", festival: true },
    events: [
      { t: "Atlas Weekend!", emo: "🎶", d: "Десятки тисяч вогнів спалахнули над головною сценою — і ти віддзеркалюєш кожен.",
        opts: [{ b: "Засяяти разом", sf: g => `+${eAmt(g, 22)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 22) * effEss(g) }), luck: 1 }] },
      { t: "Лазер-шоу", emo: "🟣", flash: true, timer: 5, d: "Зелені й фіолетові промені прокреслили твою поверхню до дна.",
        opts: [{ b: "Спіймати промінь", sf: g => `+${eAmt(g, 14)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 14) * effEss(g) }) }] },
      { t: "Діджей-сет на світанку", emo: "🎧", d: "Світанковий хедлайнер ловить ритм — басом аж піна на воді.",
        opts: [
          { b: "Пульсувати з басом", sf: g => `+${eAmt(g, 18)} сутності · +вбирання`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 18) * effEss(g), absorbBoostT: addT(g.absorbBoostT, 16) }) },
          { b: "Розлитись хвилею", sf: g => `+${aw(g, 0.14)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.14), g.maxWater) }) }] },
      { t: "Дощ конфеті", emo: "💫", flash: true, timer: 5, d: "Гармати випустили тонни конфеті — вони осіли на тобі золотими цятками.",
        opts: [{ b: "Зібрати блиск", sf: g => `+${eAmt(g, 16)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 16) * effEss(g) }), luck: 1 }] },
      { t: "Стіна звуку", emo: "🔊", flash: true, timer: 5, d: "Дроп вдарив так, що по тобі пішла справжня звукова хвиля.",
        opts: [{ b: "Завібрувати всім тілом", sf: g => `+${eAmt(g, 18)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 18) * effEss(g) }) }] },
      { t: "Тебе показали на айдекрані!", emo: "🤳", flash: true, timer: 5, d: "Камера вихопила твій блиск — і кинула на гігантський екран над сценою. Слава!",
        opts: [{ b: "Засяяти на всю арену", sf: g => `+${eAmt(g, 20)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 20) * effEss(g) }), luck: 2 }] },
      { t: "Крижані бари", emo: "🧊", d: "Уздовж арени — бари з льодом, коктейлями й безкоштовною водою.",
        opts: [
          { b: "Набрати води по вінця", sf: g => `+${aw(g, 0.16)} води`, fn: g => ({ ...g, water: Math.min(g.water + aw(g, 0.16), g.maxWater) }) },
          { b: "Виміняти лід на блиск", sf: g => `+${eAmt(g, 22)} сутності`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 22) * effEss(g) }) }] },
      { t: "Диско-куля над водою", emo: "🪩", flash: true, timer: 5, d: "Велетенська дзеркальна куля розсипала тисячу зайчиків по твоїй поверхні.",
        opts: [{ b: "Ловити відблиски", s: "+вбирання на 18с", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 18) }) }] },
      { t: "Бекстейдж-перепустка", emo: "🎟️", d: "Хтось загубив бекстейдж-браслет — і він заблищав на твоєму дні.",
        opts: [
          { b: "Майнути браслетом за блиск", sf: g => `+${eAmt(g, 28)} сутності · +вдача`, fn: g => ({ ...g, pending: g.pending + eAmt(g, 28) * effEss(g) }), luck: 2 },
          { b: "Підглянути в риддер-зоні джерело", sf: g => `+${aw(g, 0.18)} об'єму`, fn: g => ({ ...g, maxWater: g.maxWater + aw(g, 0.18) }) }] },
      { t: "Закриття Atlas", emo: "🎇", finale: true, d: "Фінальний дроп, стіна вогню й водяні гармати — головна сцена прощається до наступного року.",
        opts: [{ b: "Розчинитись у фіналі", sf: g => `повна вода · +${eAmt(g, 48)} сутності`, fn: g => ({ ...g, water: g.maxWater, pending: g.pending + eAmt(g, 48) * effEss(g) }), luck: 3 }] },
    ] },
];
const festivalForDay = (day) => FESTIVALS.find(f => f.day === day) || null;

/* ---------- активні здібності від друзів (з'являються лише з дружбою — сюрприз) ----------
   Ефекти СТАКАЮТЬСЯ (додають тривалість, з кепом). Кулдаун зменшує дар «Поклик друзів». */
const ABT_CAP = 120; // стеля тривалості тіні/вбирання від стакання (досить високо, щоб щедрі бусти справді складалися)
const addT = (v, a) => Math.min((v || 0) + a, ABT_CAP);
// скільки всього друзів здобуто — чим більше, тим щедріші активні дари
const FRIEND_KEYS = ["frogBond", "dogFriend", "catPet", "duckFriend", "birdFriend", "beeFriend", "hogFriend", "heronFriend", "snailMet", "fireFriend"];
const friendCount = (m) => FRIEND_KEYS.reduce((s, k) => s + (m && m[k] ? 1 : 0), 0);
const fc3 = (m) => Math.floor(friendCount(m) / 3); // +1 кожні 3 друзі
const eMul = (m) => 1 + friendCount(m) * 0.045; // дружба підсилює дари сутності
// дружби тепер скидаються щозабігу — друзів треба здобувати знову.
// За велику сутність їх можна «приручити назавжди» у вівтарі (meta.perma).
// ціни перераховано під нову (розмірозалежну) економіку сутності — кожен друг це реальна ціль
const PERMA_FRIENDS = [
  { id: "frog",  emo: "🐸",  nm: "Жаба Кума",        cost: 3000 },
  { id: "dog",   emo: "🐕",  nm: "Песик-приятель",   cost: 4500 },
  { id: "bird",  emo: "🐦",  nm: "Зграя птахів",     cost: 6500 },
  { id: "duck",  emo: "🦆",  nm: "Качина родина",    cost: 9000 },
  { id: "snail", emo: "🐌",  nm: "Равлик-крамар",    cost: 12000 },
  { id: "cat",   emo: "🐈‍⬛", nm: "Місячний кіт",     cost: 16000 },
  { id: "bee",   emo: "🐝",  nm: "Золоті бджоли",    cost: 21000 },
  { id: "hog",   emo: "🦔",  nm: "Їжак-садівник",    cost: 27000 },
  { id: "heron", emo: "🪽",  nm: "Чапля-провидиця",  cost: 34000 },
  { id: "fire",  emo: "🚒",  nm: "Пожежники",        cost: 44000 },
];
const PERMA_FLAG = { frog: "frogBond", dog: "dogFriend", cat: "catPet", duck: "duckFriend", bird: "birdFriend", bee: "beeFriend", hog: "hogFriend", heron: "heronFriend", snail: "snailMet", fire: "fireFriend" };
// скинути дружби до купленого «назавжди» базису (на старті забігу)
const friendBaseline = (perma) => {
  const p = perma || {};
  const b = { frogBond: p.frog ? 1 : 0, frogShy: false };
  for (const k of ["dog", "cat", "duck", "bird", "bee", "hog", "heron", "snail", "fire"]) b[PERMA_FLAG[k]] = !!p[k];
  return b;
};
const ABILITIES = [
  // — тінь: коротка перезарядка, легкі дари —
  { id: "birds", emo: "🐦", nm: "Зграя птахів", cd: 26, kind: "тінь", req: m => m.birdFriend,
    apply: (g, m) => ({ ...g, shadeT: addT(g.shadeT, 9 + fc3(m)) }), tip: "Зграя затуляє сонце — +тінь (міцніша з друзями)" },
  { id: "ducks", emo: "🦆", nm: "Качині крила", cd: 34, kind: "тінь", req: m => m.duckFriend,
    apply: (g, m) => ({ ...g, shadeT: addT(g.shadeT, 11 + fc3(m)) }), tip: "Качки обмахують крильми — +тінь" },
  { id: "dog", emo: "🐕", nm: "Песик хлюпає", cd: 30, kind: "вбирання", req: m => m.dogFriend,
    apply: (g, m) => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 11 + fc3(m)) }), tip: "Песик розбризкує — +вбирання" },
  { id: "frogs", emo: "🐸", nm: "Жаб'ячий хор", cd: 38, kind: "тінь+вбирання", req: m => (m.frogBond || 0) >= 1,
    apply: (g, m) => ({ ...g, shadeT: addT(g.shadeT, 6 + Math.min(m.frogBond || 0, 6)), absorbBoostT: addT(g.absorbBoostT, 6 + fc3(m)) }), tip: "Хор жаб: +тінь і +вбирання (росте з дружбою)" },
  { id: "snail", emo: "🐌", nm: "Равликів слиз", cd: 46, kind: "тінь", req: m => m.snailMet,
    apply: (g, m) => ({ ...g, shadeT: addT(g.shadeT, 14 + fc3(m)) }), summon: "Равлик-крамар", summonChance: 0.3,
    tip: "Прохолодний слиз — велика тінь (інколи приваблює равлика-крамаря)" },
  { id: "hog", emo: "🦔", nm: "Їжак розпушує", cd: 44, kind: "ґрунт", req: m => m.hogFriend, prey: ["snail"], lock: 9,
    apply: g => ({ ...g, soil: g.soilMax }), tip: "Розпушує ґрунт — повна волога (равлик ховається)" },
  // — сутність + ситуативна користь: довша перезарядка —
  { id: "cat", emo: "🐈‍⬛", nm: "Котячий замур", cd: 58, kind: "сутність+спокій", req: m => m.catPet, prey: ["birds", "ducks"], lock: 11,
    apply: (g, m) => ({ ...g, pending: g.pending + eAmt(g, 7) * effEss(g) * eMul(m), shadeT: addT(g.shadeT, 6) }), tip: "Кіт муркоче — сутність і трохи спокою-тіні (птахи й качки тікають)" },
  { id: "bee", emo: "🐝", nm: "Бджолиний нектар", cd: 56, kind: "сутність+вбирання", req: m => m.beeFriend,
    apply: (g, m) => ({ ...g, pending: g.pending + eAmt(g, 9) * effEss(g) * eMul(m), absorbBoostT: addT(g.absorbBoostT, 6) }), tip: "Бджоли діляться нектаром — сутність і +вбирання" },
  { id: "heron", emo: "🪽", nm: "Чапля будить глибину", cd: 66, kind: "сутність+ґрунт", req: m => m.heronFriend, prey: ["frogs", "fish"], lock: 11,
    apply: (g, m) => ({ ...g, pending: g.pending + eAmt(g, 11) * effEss(g) * eMul(m), soil: Math.min(g.soilMax, g.soil + g.soilMax * 0.4) }), tip: "Чапля ворушить дно — сутність і свіжа волога ґрунту (жаби й короп ховаються)" },
  // — вода: рідкісні, потужні —
  { id: "fish", emo: "🐟", nm: "Сплеск коропа", cd: 50, kind: "вода", req: (m, g) => (g && g.maxWater >= 6000),
    apply: (g, m) => ({ ...g, water: Math.min(g.water + aw(g, 0.05 + 0.004 * friendCount(m)), g.maxWater) }), tip: "Короп плюскоче — трохи води" },
  { id: "fire", emo: "🚒", nm: "Пожежний шланг", cd: 82, kind: "вода", req: m => m.fireFriend, prey: ["birds", "ducks"], lock: 8,
    apply: (g, m) => ({ ...g, water: Math.min(g.water + aw(g, 0.06 + 0.004 * friendCount(m)), g.maxWater) }), tip: "Цистерна доливає води — потужно (гомін лякає птахів і качок, та тішить жаб)" },
];
// синергія: дві здібності поспіль (вікно комбо) дають додатковий дар
const SYNERGY = {
  "birds+frogs": { t: "🌤️ Хор неба й болота", fn: g => ({ ...g, shadeT: addT(g.shadeT, 8) }) },
  "ducks+frogs": { t: "💦 Болотяний плескіт", fn: g => ({ ...g, absorbBoostT: addT(g.absorbBoostT, 8) }) },
  "bee+cat":     { t: "🍯 Лінива дрімота", fn: g => ({ ...g, pending: g.pending + eAmt(g, 10) * effEss(g) }) },
  "dog+hog":     { t: "🐾 Землекопи", fn: g => ({ ...g, soil: g.soilMax, absorbBoostT: addT(g.absorbBoostT, 7) }) },
  "fire+frogs":  { t: "🐸 Жаби в захваті від води", fn: g => ({ ...g, shadeT: addT(g.shadeT, 7) }) },
};
const synKey = (a, b) => [a, b].sort().join("+");
// як назвати сполоханих звірят (знахідний відмінок) для повідомлення «хижак сполохав…»
const PREY_ACC = { birds: "птахів", ducks: "качок", frogs: "жаб", fish: "коропа", snail: "равлика" };
const joinUa = (arr) => arr.length <= 1 ? (arr[0] || "") : arr.slice(0, -1).join(", ") + " і " + arr[arr.length - 1];

/* ---------- helpers ---------- */
const fmt = (n) => {
  if (n == null || isNaN(n)) return "0";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "М";
  if (a >= 1e3) return (n / 1e3).toFixed(2) + "к";
  if (a >= 100) return Math.round(n).toString();
  return n.toFixed(1);
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (c1, c2, t) => {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [r1, g1, b1] = p(c1), [r2, g2, b2] = p(c2);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
};
const effEss = (g) => g.essMult * (1 + (g.weather ? g.weather.essMod : 0));
// дохід сутності тепер РОСТЕ З РОЗМІРОМ калабані (sqrt → сильна, але спадна віддача):
// що більша калабаня — то більше сутності/с і за виживання. Зростати = головна мета,
// а не «лишатися малою й фармити дні». Орієнтир — стартовий об'єм (120).
const sizeMul = (mw) => Math.pow(Math.max(1, mw || 120) / 120, 0.5);
// масштаб подій до прогресу: водні суми = частка об'єму; сутність злегка росте з днем і дружбою
const aw = (g, frac, floor = 8) => Math.max(floor, Math.round((g.maxWater || 120) * frac));
const eAmt = (g, base) => Math.round(base * (1 + (g.day - 1) * 0.06) * (g.friend || 1));
// внутрішня «спека» (sun) — ігрова інтенсивність; для показу мапимо у правдоподібний °C
const tempC = (sun) => Math.round(14 + Math.sqrt(clamp(sun, 0, 400) / 400) * 32);
// глобальне потепління: невідворотний випар, що росте з днем І з розміром калабані
// (більша гладь — більше випаровує). Завдяки цьому ЖОДЕН забіг не безсмертний: пасив
// зрештою програє потеплінню за будь-якого об'єму, а зростати — це усвідомлений ризик
// (більший дохід, але важче втриматись). Еко-дари лише ВІДТЕРМІНОВУЮТЬ, не скасовують.
const warmingDrain = (day, maxWater) => Math.pow(Math.max(0, day - 10), 1.5) * 0.17 * Math.pow(Math.max(1, maxWater || 120) / 120, 0.35);
// мрія калабані рости: ранг за об'ємом
const RANKS = [[300, "калабаня"], [900, "велика калабаня"], [2500, "ставок"], [6000, "озерце"], [16000, "озеро"], [50000, "велике озеро"], [160000, "море"], [400000, "велике море"], [1000000, "Північний Льодовитий океан"], [3000000, "Індійський океан"], [10000000, "Атлантичний океан"], [35000000, "Тихий океан"]];
const rankName = (mw) => { for (const [t, n] of RANKS) if (mw < t) return n; return "Світовий океан"; };

function evapPerSec(g) {
  const w = g.weather || NEUTRAL;
  const sunEff = clamp(g.sun * (1 + w.sunMod), 0, 400);
  const sunMul = 1 + (sunEff / 100) * 2.5 * (1 - clamp(g.sunResist, 0, 0.85));
  // апгрейди зменшують випар не більше ніж удвічі (щоб пізня гра не ставала тривіальною)
  const redu = Math.max(0.5, g.deepenMult * g.mossMult);
  let e = g.baseEvap * redu * sunMul * (1 - g.leaf);
  if (g.shadeT > 0) e *= 0.35;
  // буст випару від подій: множник + плоский злив, обмежений доходом (а не об'ємом),
  // щоб відчувалось, але не вибухало на велетенських калабанях
  if (g.evapBoostT > 0) e = e * 1.8 + Math.min((g.maxWater || 120) * 0.005, 8 + (g.passive || 0) * 0.8);
  // глобальне потепління: невідворотний випар, що росте з днем (еко-дари трохи зменшують)
  e += warmingDrain(g.day, g.maxWater) * (g.ecoMult ?? 1);
  e *= (1 + w.evapMod);
  return Math.max(0, e);
}

function freshRun(meta) {
  const M = (k) => meta[k] || 0;
  return {
    water: 46 + M("memory") * 22 + 40 * M("wellspring") + 30 * M("c_full") + 15 * M("abyss"), maxWater: 120 + M("memory") * 22 + 40 * M("wellspring") + 25 * M("c_full") + 15 * M("abyss"),
    day: 1, elapsed: 0, dayLen: 100, sun: 8, speed: 1 + 0.12 * M("swift"), rescues: 0,
    baseEvap: 0.95 * Math.pow(0.96, M("cold")) * Math.pow(0.97, M("permafrost")),
    deepenMult: 1, mossMult: 1, sunResist: clamp(0.06 * M("c_silt"), 0, 0.85), absorbMult: 1 + 0.10 * M("absorb") + 0.12 * M("thirst"),
    soil: 60, soilMax: 60, soilRegen: 3.8 * (1 + 0.25 * M("roots") + 0.25 * M("deeproots")),
    passive: 0.3 * M("spring") + 0.4 * M("spring2") + 0.5 * M("c_spring") + 0.03 * M("abyss") + ((meta.frogBond || 0) >= 3 ? 0.1 : 0), leaf: 0,
    shadeT: 0, evapBoostT: 0, absorbBoostT: 0, cheapT: 0,
    essMult: (1 + 0.12 * M("silver") + 0.15 * M("golddrop")) * (1 + 0.4 * M("c_ess")), essRate: 0.10 + 0.05 * M("essflow"),
    friend: 1 + Math.min(0.6, (meta.frogBond || 0) * 0.05), // дружба з жабою покращує дари подій
    ecoMult: Math.max(0.55, (1 - 0.06 * M("trees")) * (1 - 0.10 * M("c_eco"))), // еко-дари ВІДТЕРМІНОВУЮТЬ потепління (не скасовують)
    abil: { birds: 0, frogs: 0, dog: 0, cat: 0, ducks: 0, snail: 0, bee: 0, hog: 0, heron: 0, fish: 0, fire: 0 },
    hasFriend: !!(meta.birdFriend || (meta.frogBond || 0) >= 1 || meta.dogFriend || meta.catPet || meta.duckFriend || meta.snailMet || meta.beeFriend || meta.hogFriend || meta.heronFriend || meta.fireFriend),
    pending: 0, nextEvent: 14, festival: false, festAt: 0,
    tickets: { ...(meta.tickets || {}) }, // придбані квитки на фестивалі діють цей забіг
    seed: (Math.random() * 4294967296) >>> 0, // сід забігу для детермінованого прогнозу
    fcIdx: 0, fcFree: 0, // № перекруту прогнозу цього дня та скільки безкоштовних витрачено (зберігаються → рефреш не змінює небо)
    levels: { deepen: 0, silt: 0, widen: 0, moss: 0, vein: 0, lake: 0, trench: 0, summon: 0 },
    weather: NEUTRAL,
  };
}

/* ---------- day/night sky model ---------- */
const SKY_KEYS = [
  { t: 0.00, a: "#0a1a2c", b: "#15304a" },
  { t: 0.12, a: "#33415f", b: "#c98a5a" },
  { t: 0.28, a: "#1f5a78", b: "#5fa8c8" },
  { t: 0.50, a: "#1b6e92", b: "#8fcce4" },
  { t: 0.72, a: "#2a5f7a", b: "#e89a5a" },
  { t: 0.86, a: "#5a3a6a", b: "#f0682f" },
  { t: 1.00, a: "#101e34", b: "#2e2440" },
];
function skyAt(t) {
  t = clamp(t, 0, 1);
  let i = 0; while (i < SKY_KEYS.length - 1 && t > SKY_KEYS[i + 1].t) i++;
  const k0 = SKY_KEYS[i], k1 = SKY_KEYS[Math.min(i + 1, SKY_KEYS.length - 1)];
  const span = (k1.t - k0.t) || 1, f = clamp((t - k0.t) / span, 0, 1);
  const a = mix(k0.a, k1.a, f), b = mix(k0.b, k1.b, f);
  const star = clamp(Math.max(t < 0.1 ? (0.1 - t) / 0.1 : 0, t > 0.84 ? (t - 0.84) / 0.16 : 0), 0, 1);
  return { gradient: `linear-gradient(180deg, ${a} 0%, ${b} 78%, ${mix(b, "#1a1008", 0.5)} 100%)`, star };
}

/* ============================ SLOT REEL ============================ */
const CELL = 78, REP = 10;
function Reel({ target, spinKey, delay, dur }) {
  const N = SYMBOLS.length;
  const [off, setOff] = useState(() => target * CELL);
  const [instant, setInstant] = useState(true);
  const [blur, setBlur] = useState(false);
  const offRef = useRef(target * CELL);
  useEffect(() => {
    if (spinKey === 0) return;
    const curIdx = Math.round(offRef.current / CELL) % N;
    const delta = (((target - curIdx) % N) + N) % N;
    const steps = 4 * N + delta;
    const dest = offRef.current + steps * CELL;
    setInstant(false); setBlur(true);
    requestAnimationFrame(() => setOff(dest));
    offRef.current = dest;
    const tot = delay + dur;
    const t1 = setTimeout(() => setBlur(false), tot);
    const t2 = setTimeout(() => {
      const norm = dest % (N * CELL);
      setInstant(true); setOff(norm); offRef.current = norm;
      requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    }, tot + 70);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [spinKey]); // eslint-disable-line
  const cells = [];
  for (let r = 0; r < REP; r++) for (let i = 0; i < N; i++) cells.push(SYMBOLS[i].e);
  return (
    <div className="reel">
      <div className="reel-strip" style={{
        transform: `translateY(${-off}px)`,
        transition: instant ? "none" : `transform ${dur}ms cubic-bezier(.13,.78,.27,1) ${delay}ms`,
        filter: blur ? "blur(2.5px)" : "none",
      }}>
        {cells.map((e, i) => <div className="reel-cell" key={i}>{e}</div>)}
      </div>
      <div className="reel-fade top" /><div className="reel-fade bot" />
    </div>
  );
}

/* ============================ APP ============================ */
const DEFAULT_META = { essence: 0, runs: 0, best: 0, memory: 0, cold: 0, silver: 0, spring: 0, roots: 0, absorb: 0, thirst: 0, luck: 0, moon: 0, wellspring: 0, permafrost: 0, golddrop: 0, deeproots: 0, spring2: 0, essflow: 0, calmsky: 0, abyss: 0, tickets: {}, perma: {}, permaWipe: true, everFriend: false, frogBond: 0, snailMet: false, catPet: false, dogFriend: false, duckFriend: false, birdFriend: false, beeFriend: false, hogFriend: false, heronFriend: false, fireFriend: false, frogShy: false, tricked: false, callcd: 0, trees: 0, swift: 0, fate: 0, seenOnce: {}, sound: true, haptics: true, keepAwake: true, ach: {}, maxVol: 120, clouds: 0, ascensions: 0, essThisAsc: 0, lifeEss: 0, c_ess: 0, c_full: 0, c_spring: 0, c_cheap: 0, c_silt: 0, c_eco: 0 };
// зведення дублюючих дарів: рівні старих апгрейдів переливаються в той, що лишився
function migrateMeta(src) {
  const m = { ...src };
  if (m.reeds) { m.trees = Math.min(12, (m.trees || 0) + m.reeds); } // Очеретяний пояс → Лісосмуга
  delete m.reeds;
  // дружби стали щозабіговими; «приручення назавжди» треба КУПУВАТИ за сутність.
  // одноразово прибираємо помилково «подаровані» назавжди дружби (їх ніхто не купував).
  if (!m.permaWipe) { m.perma = {}; m.permaWipe = true; }
  return m;
}

export default function App() {
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
  useEffect(() => {
    const want = phase === "playing" && meta.keepAwake !== false && typeof navigator !== "undefined" && "wakeLock" in navigator;
    const acquire = async () => {
      if (!want || wakeLockRef.current || document.visibilityState !== "visible") return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener?.("release", () => { wakeLockRef.current = null; });
      } catch (e) { wakeLockRef.current = null; }
    };
    const release = () => { try { wakeLockRef.current && wakeLockRef.current.release(); } catch (e) {} wakeLockRef.current = null; };
    if (want) acquire(); else release();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); release(); };
  }, [phase, meta.keepAwake]);

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
  const checkVol = useCallback((mw) => {
    if (mw >= 500) unlock("unfathom");
    if (mw >= 2500) unlock("pond");
    if (mw >= 16000) unlock("lakeach");
    if (mw >= 160000) unlock("ocean");
    if (mw >= 1000000) unlock("worldocean");
  }, [unlock]);

  /* ---- load ---- */
  useEffect(() => {
    (async () => {
      const raw = await store.load(KEY);
      if (raw) {
        try {
          const d = JSON.parse(raw);
          if (d.meta) setMeta(m => ({ ...m, ...migrateMeta(d.meta), ach: { ...(d.meta.ach || {}) } }));
          const resumable = ["playing", "survived", "forecast", "challenge", "festival", "dead"];
          if (d.g && resumable.includes(d.phase)) {
            // якщо перезавантажили під час події/колеса — скидаємо «паузу» таймера подій
            const ne = (d.g.nextEvent == null || d.g.nextEvent >= 9999) ? 6 + Math.random() * 6 : d.g.nextEvent;
            // фестиваль не відновлюється з пів-дороги (черга подій у пам'яті) — лагідно завершуємо його
            const wasFest = d.phase === "playing" && d.g.festival;
            setG(gg => ({ ...gg, ...d.g, weather: d.g.weather || NEUTRAL, nextEvent: ne, festival: wasFest ? false : d.g.festival }));
            if (d.phase === "dead") {
              if (d.result) { setResult(d.result); setPhase("dead"); }
              else setPhase("menu"); // run already banked, just no screen to show
            } else if (d.phase === "forecast") {
              bootForecast.current = true; setPhase("forecast"); // re-open the day's slot
            } else {
              setPhase(d.phase); // playing | survived | challenge | festival — continue where we stopped
            }
          } else setPhase("welcome");
        } catch (e) { setPhase("welcome"); }
      } else setPhase("welcome");
      loaded.current = true;
    })();
  }, []);

  /* ---- autosave ---- */
  useEffect(() => {
    if (!loaded.current) return;
    const iv = setInterval(() => {
      const snap = JSON.stringify({ v: 3, meta: metaRef.current, phase: phaseRef.current, g: gRef.current, result: resultRef.current });
      store.save(KEY, snap);
    }, 2500);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { if (loaded.current) store.save(KEY, JSON.stringify({ v: 3, meta, phase: phaseRef.current, g: gRef.current, result: resultRef.current })); }, [meta]);
  // живий заголовок вкладки — відображає, що зараз із калабанею
  useEffect(() => {
    const NM = "КАЛАБАНЯ";
    let t = `💧 ${NM} — калюжа, що мріє стати океаном`;
    if (phase === "playing") t = g.festival ? `🎉 Фестиваль Республіка — ${NM}` : `💧 День ${g.day} · ${rankName(g.maxWater)} — ${NM}`;
    else if (phase === "festival") t = `🎉 Свято! День ${g.day} — ${NM}`;
    else if (phase === "forecast" || phase === "challenge") t = `🎰 День ${g.day} — ${NM}`;
    else if (phase === "survived") t = `🌙 День ${g.day} пережито — ${NM}`;
    else if (phase === "dead") t = `🥀 Висохла на ${(result && result.day) || g.day} день — ${NM}`;
    else if (phase === "menu") t = `✦ Вівтар калабань — ${NM}`;
    document.title = t;
  }, [phase, g.day, g.maxWater, g.festival, result]);
  // persist immediately whenever the phase changes, so a refresh resumes the exact screen
  useEffect(() => {
    if (!loaded.current || phase === "loading") return;
    store.save(KEY, JSON.stringify({ v: 3, meta: metaRef.current, phase, g: gRef.current, result: resultRef.current }));
  }, [phase]);

  /* ---- game loop ---- */
  useEffect(() => {
    if (phase !== "playing") return;
    const iv = setInterval(() => {
      setG(prev => {
        if (wheelRef.current) return prev; // Колесо Фортуни ставить день на паузу
        const dt = 0.1 * (prev.speed || 1); // «Стрімкий час» — усе те саме, лише швидше
        const n = { ...prev };
        n.elapsed += dt;
        const t = clamp(n.elapsed / n.dayLen, 0, 1);
        const peak = 72 + (n.day - 1) * 13 + Math.pow(Math.max(0, n.day - 5), 1.6) * 0.6;
        n.sun = Math.max(6, peak * Math.sin(Math.PI * t));
        n.shadeT = Math.max(0, n.shadeT - dt);
        n.evapBoostT = Math.max(0, n.evapBoostT - dt);
        n.absorbBoostT = Math.max(0, n.absorbBoostT - dt);
        n.cheapT = Math.max(0, (n.cheapT || 0) - dt);
        if (n.abil) { const ab = { ...n.abil }; for (const k in ab) ab[k] = Math.max(0, ab[k] - dt); n.abil = ab; }
        const w = n.weather || NEUTRAL;
        // курна буря: ґрунт пересихає й не відновлюється (вбирати нічим)
        n.soil = w.challenge === "dust" ? Math.max(0, n.soil - 4 * dt) : clamp(n.soil + n.soilRegen * dt, 0, n.soilMax);
        const evap = evapPerSec(n);
        n.water = Math.min(n.water + (n.passive + w.rainPower - evap) * dt, n.maxWater);
        n.pending += (n.essRate || 0.10) * sizeMul(n.maxWater) * effEss(n) * dt; // збір сутності росте з розміром
        if (!event) n.nextEvent -= dt; // таймер паузиться, поки відкрите вікно події
        if (n.water >= n.maxWater - 0.5) unlock("rainchild");
        // не запускати подій/Колесо в останні ~13с дня (щоб не вискакували перед сутінками)
        if (n.nextEvent <= 0 && !event && (n.dayLen - n.elapsed) > 13) {
          n.nextEvent = 99999; // сентинел: жодних нових подій, доки цю не закриють
          let fired = false;
          const fest = n.festival ? festEventsRef.current : null;
          if (fest && fest.length) {
            const lastIdx = fest.length - 1, at = n.festAt || 0;
            const nearDusk = (n.dayLen - n.elapsed) < 30;
            // інтро — завжди перше; фінал — гарантовано під кінець дня; між тим святкові події вперемішку зі звичайними
            if (at === 0) { n.festAt = 1; Haptics.event(); setEvent({ ...fest[0], fest: true }); fired = true; }
            else if (nearDusk && fest[lastIdx] && fest[lastIdx].finale && at <= lastIdx) { n.festAt = lastIdx + 1; Haptics.event(); setEvent({ ...fest[lastIdx], fest: true }); fired = true; }
            else if (at < lastIdx && Math.random() < 0.6) { n.festAt = at + 1; Haptics.event(); setEvent({ ...fest[at], fest: true }); fired = true; }
          }
          if (!fired) {
            // рідко (раз на пару днів) замість звичайної події випадає Колесо Фортуни (не на фестивалі)
            const wheelReady = !n.festival && n.day >= 2 && (n.day - (n.wheelDay ?? -9)) >= 2 && Math.random() < 0.35;
            if (wheelReady) { n.wheelDay = n.day; Haptics.event(); setWheel({ stage: "offer" }); }
            else { let ev = pickEvent(n, metaRef.current); if (ev.riddle) ev = makeRiddleEvent(); if (ev.once) setMeta(m => ({ ...m, seenOnce: { ...(m.seenOnce || {}), [ev.once]: true } })); Haptics.event(); setEvent(ev); }
          }
        }
        if (n.elapsed >= n.dayLen) {
          const bonus = 5 * sizeMul(n.maxWater) * effEss(n) * (1 + 0.15 * (metaRef.current.moon || 0)); // дар за виживання до сутінків — за РОЗМІР, а не за номер дня
          n.pending += bonus;
          const tapsThisDay = dayTaps.current;
          const waterAtDusk = n.water;
          queueMicrotask(() => {
            unlock("firstdew");
            if (tapsThisDay === 0) unlock("mirror");
            if (waterAtDusk <= 5) unlock("lastdrop");
            if (challengeForDay(n.day)) unlock("trial");
            if (n.day >= 7) unlock("sevensuns");
            if (n.day >= 30) unlock("oldpuddle");
            if (n.day >= 50) unlock("eternal");
            Sfx.dusk();
            setEvent(null);
            setPhase("survived");
          });
        }
        if (n.water <= 0) {
          n.water = 0;
          const gained = Math.round(n.pending);
          queueMicrotask(() => {
            // ще НЕ банкуємо сутність — спершу даємо шанс на рятувальний слот
            setResult({ gained, secs: Math.round(n.elapsed), day: n.day });
            if (n.day >= 7) unlock("sevensuns");
            if (n.day >= 30) unlock("oldpuddle");
            if (n.day >= 50) unlock("eternal");
            if (n.day >= 20) unlock("warmed"); // висох уже за відчутного потепління
            Sfx.danger(); Haptics.bad();
            setEvent(null); setPhase("dead");
          });
        }
        return n;
      });
    }, 100);
    return () => clearInterval(iv);
  }, [phase, event, unlock]);

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
    const lvl = prev.levels[u.id], cost = runCost(u, lvl, prev.maxWater, prev.cheapT > 0 ? 0.6 : 1);
    if (prev.water < cost) return prev;
    Sfx.click();
    const n = { ...prev, water: prev.water - cost, levels: { ...prev.levels, [u.id]: lvl + 1 } };
    // additive capacity — помірний ріст об'єму (від софт-локу захищає стеля ціни 92% у runCost)
    // об'єм росте і адитивно (рання гра), і часткою від поточного (пізня гра) — щоб дотягтись аж до океанів
    if (u.id === "deepen") { n.maxWater += Math.max(50 + lvl * 10, Math.round(n.maxWater * 0.05)); n.deepenMult *= 0.97; }
    if (u.id === "silt") { n.sunResist = clamp(n.sunResist + 0.08, 0, 0.85); if (n.levels.silt >= 10) queueMicrotask(() => unlock("shrek")); }
    if (u.id === "widen") { n.absorbMult += 0.6; n.soilMax += 40; n.maxWater += Math.max(30, Math.round(n.maxWater * 0.02)); n.baseEvap += 0.04; }
    if (u.id === "moss") n.mossMult *= 0.93;
    if (u.id === "vein") n.passive += 0.4;
    if (u.id === "lake") { n.maxWater += Math.max(150, Math.round(n.maxWater * 0.08)); n.passive += 0.7; queueMicrotask(() => unlock("deepwell")); }
    if (u.id === "trench") { n.maxWater += Math.max(400, Math.round(n.maxWater * 0.08)); n.passive += 1.5; }
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
    // виклик гостя: равликів слиз інколи приваблює крамаря. Шанс залежить від прихованої Вдачі:
    // за доброї — частіше добрий крам; за лихої — натомість приповзає равлик-лихвар із боргом (гірша угода).
    if (ab.summon && !event) {
      const fl = fateLuck(metaRef.current);            // 0..1 прихована Вдача
      const base = ab.summonChance || 0.3;
      const goodCh = base * (0.5 + fl);                // більше доброго з удачею
      const badCh = base * (1 - fl) * 0.8;             // більше лихого без удачі
      const r = Math.random();
      const good = r < goodCh, bad = !good && r < goodCh + badCh;
      if (good || bad) {
        const wantT = good ? ab.summon : "Равлик пропонує борг";
        const reqOk = e => !e.req || e.req(gRef.current, metaRef.current);
        const ev = EVENTS.find(e => e.t === wantT && reqOk(e)) || EVENTS.find(e => e.t === ab.summon && reqOk(e));
        if (ev) {
          Haptics.event();
          setEvent(ev);
          const showSummon = () => flashAbil(good ? "syn" : "clash", good ? `${ev.emo} Слиз привабив ${ev.t.toLowerCase()}` : `${ev.emo} На слиз приповз лихвар`);
          if (syn) setTimeout(showSummon, 950); else showSummon(); // не перебивати синергію миттєво
        }
      }
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
      return { ...nm, everFriend: m.everFriend || friendCount(nm) > 0 };
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

  if (phase === "loading") return <div className="kal-root"><div style={{ padding: 40, textAlign: "center", color: "#6f9099", fontFamily: "Fraunces, serif", fontStyle: "italic" }}>збираю краплі…</div></div>;

  return (
    <div className="kal-root">
      {/* ACHIEVEMENT TOASTS */}
      {toasts.length > 0 && (
        <div className="kal-toasts">
          {toasts.map(t => (
            <div className="kal-toast" key={t.id}>
              <div className="ti">{t.def.e}</div>
              <div><div className="tt">Досягнення</div><div className="tn">{t.def.nm}</div><div className="td">{t.def.dq}</div></div>
            </div>
          ))}
        </div>
      )}

      <div className="kal-wrap">
        {/* TOP */}
        <div className="kal-top reveal">
          <div>
            <div className="kal-title">КАЛАБАНЯ<span>, що висихає</span></div>
            <div className="kal-sub">{rankName(g.maxWater)} · день {g.day}</div>
          </div>
          <div className="kal-stat">
            <div><div className="lab">Сутність</div><div className="val kal-ess">◈ {fmt(meta.essence)}</div></div>
            {(meta.clouds > 0 || meta.ascensions > 0) && <div><div className="lab">Хмари</div><div className="val kal-clouds">☁ {fmt(meta.clouds || 0)}</div></div>}
            <div><div className="lab">Рекорд</div><div className="val kal-num">{meta.best} дн.</div></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="kal-toolbtn" title="Досягнення" onClick={() => { Sfx.click(); setPopup("ach"); }}>🏆</button>
              <button className="kal-toolbtn" title="Як грати" onClick={() => { Sfx.click(); setPopup("codex"); }}>?</button>
              <button className="kal-toolbtn" title="Налаштування" onClick={() => { Sfx.click(); setPopup("settings"); }}>⚙</button>
            </div>
          </div>
        </div>

        {phase === "playing" && (
          <div className="reveal" style={{ marginTop: 12, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div className="rowlab"><span>Спека {w.sunMod ? <em style={{ color: tierCol(w.tier) }}>· {w.name}</em> : null}</span><span className="kal-num">{tempC(g.sun * (1 + (w.sunMod || 0)))}°C</span></div>
              <div className="kal-heat"><i style={{ width: `${clamp(g.sun / 1.4, 0, 100)}%`, background: `linear-gradient(90deg, var(--sun), ${sunCol})` }} /></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="lab">До сутінків</div><div className="kal-num" style={{ fontSize: 20 }}>{timeLeft}с</div>
            </div>
          </div>
        )}
        {phase === "playing" && (
          <div className="kal-tod reveal" style={{ marginTop: 10 }}>
            <span style={{ minWidth: 78 }}>{phaseLabel}</span>
            <div className="kal-todbar"><i style={{ left: `${todT * 100}%` }} /></div>
            <span>🌙</span>
          </div>
        )}

        {/* STAGE — pinned (only the puddle card) while playing on phones */}
        <div className={"kal-stagewrap" + (phase === "playing" ? " sticky" : "")}>
        <div className={"kal-stage reveal" + (phase === "playing" ? " live" : "")} ref={stageRef} onClick={absorb}>
          <div className="kal-sky" style={{ background: sky.gradient }} />
          <div className="kal-stars" style={{ "--star": sky.star, opacity: sky.star }} />
          {!waterOk && sky.star > 0.4 && <div className="kal-moon" style={{ opacity: sky.star }} />}

          {/* procedural fallback puddle (shown only if the water canvas assets failed) */}
          {!waterOk && <>
            <div className="kal-ground" style={{ filter: `brightness(${0.7 + 0.5 * Math.sin(Math.PI * todT)})` }} />
            {showSunArc && <>
              <div className="kal-rays" style={{ opacity: sunT * 0.5, background: `conic-gradient(from 0deg at ${sunArcLeft}% ${sunArcTop / 3.8}%, transparent 0deg, ${sunCol}33 8deg, transparent 16deg, transparent 40deg, ${sunCol}22 48deg, transparent 56deg)` }} />
              <div className="kal-sun" style={{ left: `${sunArcLeft}%`, top: sunArcTop, width: sunArcSize, height: sunArcSize, background: `radial-gradient(circle at 38% 38%, #fff7e0, ${sunCol} 55%, transparent 72%)`, boxShadow: `0 0 ${30 + sunT * 70}px ${10 + sunT * 30}px ${sunCol}66`, opacity: 0.6 + sunT * 0.4 }} />
            </>}
            <div className="kal-puddle" style={{ width: size, height: size * 0.62 }}>
              <div className="kal-blob" style={{ background: `radial-gradient(120% 130% at 50% 25%, ${waterEdge}, ${waterCol} 55%, ${mix("#0c4a58", "#3a2414", dryT)} 100%)` }} />
              <div className="kal-crack" style={{ opacity: clamp((dryT - 0.55) * 2.5, 0, 0.85) }} />
              <div className="kal-sheen" style={{ opacity: 0.7 * ratio }} />
              <div className="kal-pmid"><b>{fmt(g.water)}</b><small>/ {fmt(g.maxWater)} води</small></div>
            </div>
          </>}

          {/* procedural water (canvas) — основний шар; returns null self if assets fail */}
          <WaterPuddle
            fill={ratio}
            tod={todT}
            night={sky.star}
            active={phase === "playing"}
            fxEvents={fx}
            bgDayUrl={waterBgDay}
            bgNightUrl={waterBgNight}
            mapUrl={waterMap}
            onError={() => setWaterOk(false)}
          />

          {/* weather particles (both modes) */}
          {phase === "playing" && Array.from({ length: rainN }).map((_, i) => (
            <div key={"r" + i} className="kal-rain" style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 1.2}s`, animationDuration: `${0.6 + Math.random() * 0.5}s` }} />
          ))}
          {Array.from({ length: snowN }).map((_, i) => (
            <div key={"s" + i} className="kal-snow" style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 2}s`, animationDuration: `${2.5 + Math.random() * 2}s` }} />
          ))}
          {phase === "playing" && Array.from({ length: vaporN }).map((_, i) => (
            <div key={"v" + i} className="kal-vapor" style={{ left: `${42 + Math.random() * 16}%`, animationDelay: `${i * 0.35}s`, animationDuration: `${2 + Math.random()}s` }} />
          ))}

          {/* storm lightning flashes */}
          {phase === "playing" && (w.icon === "⛈️" || w.rainPower >= 0.65) && <div className="kal-lightning" />}

          {/* event ambiance — themed emoji burst + glow when a gost appears */}
          {event && phase === "playing" && (
            <div className="kal-eventfx" key={event.t}>
              <div className="kal-eventglow" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={"ef" + i} className="ef-emoji" style={{ left: `${12 + Math.random() * 76}%`, animationDelay: `${Math.random() * 1.1}s`, "--r": `${Math.random() * 70 - 35}deg`, fontSize: `${20 + Math.random() * 16}px` }}>{event.emo}</div>
              ))}
            </div>
          )}

          {/* positional ripple FX (both modes) */}
          {fx.map(r => (
            <div key={r.id} className="kal-fx" style={{ left: `${r.x}%`, top: `${r.y}%` }}>
              {!waterOk && <div className="kal-ripple" />}
              {r.amt > 0 && <div className="kal-gain kal-num">+{r.amt.toFixed(1)}</div>}
            </div>
          ))}

          {/* water HUD overlay (shown over the water canvas) */}
          {phase === "playing" && (
            <div className="kal-hud kal-pmid"><b>{fmt(g.water)}</b><small>/ {fmt(g.maxWater)} води</small></div>
          )}
          {phase === "playing" && <div className="kal-hint">{g.festival ? `🎉 свято — просто святкуй · ${w.icon} злива-благодать` : `торкайся, щоб вбирати · ${net >= 0 ? "▲" : "▼"} ${fmt(Math.abs(net))}/с ${w.icon}`}</div>}
        </div>
        </div>{/* end stage wrap */}

        {/* ACTIVE ABILITIES (appear only once befriended — a surprise) */}
        {phase === "playing" && ABILITIES.some(a => a.req(meta, g)) && (
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
        )}

        {/* PLAY PANELS */}
        {phase === "playing" && (
          <div className="kal-cols reveal">
            <div className="kal-card">
              <h3>Поглиблення <small>{g.cheapT > 0 ? `🏷️ знижка −40% (${Math.ceil(g.cheapT)}с)` : "ціна у воді"}</small></h3>
              {RUN_UPGRADES.map(u => {
                const lvl = g.levels[u.id] || 0, cost = runCost(u, lvl, g.maxWater, g.cheapT > 0 ? 0.6 : 1);
                const locked = u.req && !u.req(g);
                if (locked && u.hidden) return null; // прихований апгрейд (сюрприз) — не показуємо замкненим
                if (locked) return (
                  <div key={u.id} className="kal-up dis">
                    <div className="emo" style={{ filter: "grayscale(1)" }}>🔒</div>
                    <div className="body"><div className="nm">{u.nm}</div><div className="de">{u.lock || "ще не відкрито"}</div></div>
                  </div>
                );
                const can = g.water >= cost;
                return (
                  <div key={u.id} className={"kal-up clickable" + (can ? "" : " dis")} onClick={() => can && buyRun(u)}>
                    <div className="emo">{u.emo}</div>
                    <div className="body"><div className="nm">{u.nm}<span className="lvl">рів.{lvl}</span></div><div className="de">{u.de}</div></div>
                    <div className="cost">{fmt(cost)} 💧</div>
                  </div>
                );
              })}
            </div>
            <div className="kal-card">
              <h3>Стан калабані <small>{w.icon} {w.name}</small></h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 15 }}>
                <Stat l="Випар" v={`${fmt(evap)}/с`} c="var(--bad)" />
                <Stat l="Приплив" v={`+${fmt(g.passive + w.rainPower)}/с`} c="var(--good)" />
                <Stat l="Чистий" v={`${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))}/с`} c={net >= 0 ? "var(--good)" : "var(--bad)"} />
                <Stat l="Вбирання" v={`+${fmt(ABSORB_BASE * g.absorbMult * (g.absorbBoostT > 0 ? 1.9 : 1) * (1 + w.absorbMod))}/тап`} c="var(--water-a)" />
                <Stat l="Наповнення" v={`${Math.round(clamp(g.water / g.maxWater, 0, 1) * 100)}%`} c="var(--ink)" />
                <Stat l="Волога ґрунту" v={`${Math.round(g.soil)}%`} c="var(--ink)" />
                <Stat l="Опір спеці 🟤" v={`${Math.round(g.sunResist * 100)}%`} c="var(--ink)" />
                {warmingDrain(g.day, g.maxWater) * (g.ecoMult ?? 1) * (1 + w.evapMod) > 0.05 && <Stat l="Потепління 🌡️" v={`−${fmt(warmingDrain(g.day, g.maxWater) * (g.ecoMult ?? 1) * (1 + w.evapMod))}/с`} c="var(--bad)" />}
                <Stat l="Сутність ◈" v={`${fmt(g.pending)}${w.essMod ? ` ·${(1 + w.essMod).toFixed(1)}×` : ""}`} c="var(--essence)" />
                <Stat l="Збір ◈ (більша калабаня — більше)" v={`+${fmt((g.essRate || 0.10) * sizeMul(g.maxWater) * effEss(g))}/с`} c="var(--essence)" />
                {(g.speed || 1) > 1.01 && <Stat l="Швидкість ⏩" v={`×${(g.speed).toFixed(2)}`} c="var(--essence)" />}
              </div>
              <div className="kal-fxchips">
                {g.shadeT > 0 && <span>🌑 тінь {Math.ceil(g.shadeT)}с</span>}
                {g.evapBoostT > 0 && <span className="bad">♨️ випар {Math.ceil(g.evapBoostT)}с</span>}
                {g.absorbBoostT > 0 && <span className="good">💧 вбирання {Math.ceil(g.absorbBoostT)}с</span>}
                {g.leaf > 0 && <span>🍂 листя −{Math.round(g.leaf * 100)}% випару</span>}
                {g.cheapT > 0 && <span className="good">🏷️ −40% поглиблення {Math.ceil(g.cheapT)}с</span>}
                {g.shadeT <= 0 && g.evapBoostT <= 0 && g.absorbBoostT <= 0 && g.leaf <= 0 && g.cheapT <= 0 && <span className="idle">Небо тремтить у твоєму дзеркалі…</span>}
              </div>
            </div>
          </div>
        )}

        {/* MENU */}
        {phase === "menu" && (
          <>
            <div className="kal-menubg-wrap">
              <SafeImg className="kal-menubg" src={`${import.meta.env.BASE_URL}scenes/altar.webp`} />
            </div>
            <div className="kal-card reveal" style={{ marginTop: 16 }}>
              <span className="kal-tag">між мандрівками</span>
              <div className="kal-lore">Кожна калабаня мріє стати озером, а потай — океаном. Та сонце п'є тебе краплю за краплею, і з кожним днем дужчає потепління. Витрачай <span className="kal-ess">Сутність</span>, що лишили попередні твої «я», й рости далі.</div>
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
              <button className="kal-go" onClick={startJourney}>Стати калабанею знову →</button>
            </div>

            <div className="kal-card reveal" style={{ marginTop: 14 }}>
              <span className="kal-tag">квитки на фестивалі</span>
              <div className="kal-lore">За <span className="kal-ess">Сутність</span> придбай квиток на фестиваль — і він трапиться у твоєму наступному забігу в свій день. Квиток діє <b>один забіг</b>. Торкатися там не можна, тож приходь із друзями, щоб не висохнути.</div>
              {FESTIVALS.map(f => {
                const owned = !!(meta.tickets || {})[f.id];
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
        )}
      </div>

      {/* EVENT */}
      {event && phase === "playing" && (
        <div className={"kal-evt" + (event.cunning ? " cunning" : "")}>
          <div className="ehead"><div className="eemo"><span className="eemo-ring" />{event.emo}{event.art && <SafeImg className="eemo-img" src={`${import.meta.env.BASE_URL}events/${event.art}.webp`} />}</div><div className="et">{event.t}</div></div>
          {event.timer ? <div className="evt-timer"><i style={{ width: `${clamp((eventT / event.timer) * 100, 0, 100)}%` }} /></div> : null}
          <div className="ed">{event.d}</div>
          <div className="opts">{event.opts.map((o, i) => <button key={i} className="kal-btn" onClick={() => resolveEvent(o)}><b>{o.b}</b><small>{o.sf ? o.sf(g) : o.s}</small></button>)}</div>
        </div>
      )}

      {/* WHEEL OF FORTUNE (rare) */}
      {wheel && (
        <div className="kal-over">
          <div className="kal-panel wheel-panel" style={{ textAlign: "center" }}>
            <div className="wheel-scroll">
              <span className="kal-tag">рідкісне</span>
              <div className="kal-big" style={{ fontSize: "clamp(24px,6vw,38px)", marginBottom: 4 }}>Колесо Фортуни</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>Крутни — і доля сама вирішить: щось чудове, лихе або нічого. Можна й відмовитись.</div>
              <div className="wheel-wrap">
                <div className="wheel-aura" style={{ opacity: luck * 0.9 }} />
                <div className="wheel-pointer" style={{ borderTopColor: mix("#ffffff", "#ffd05a", luck), filter: `drop-shadow(0 2px 3px rgba(0,0,0,.5)) drop-shadow(0 0 ${luck * 7}px rgba(255,205,90,${luck * 0.9}))` }} />
                <div className="wheel" style={{ transform: `rotate(${wheelRot}deg)`, background: `conic-gradient(from -22.5deg, ${WHEEL.map((s, i) => `${s.col} ${i * 45}deg ${(i + 1) * 45}deg`).join(",")})` }}>
                  {WHEEL.map((s, i) => (
                    <div key={i} className="wheel-lbl" style={{ transform: `rotate(${i * 45}deg) translateY(calc(var(--wsz) * -0.374)) rotate(${-i * 45}deg)` }}>{s.emo}</div>
                  ))}
                </div>
                <div className="wheel-hub" />
                {wheel.stage === "done" && <div className="wheel-win" />}
              </div>
              {wheel.stage === "done" && (
                <div className="kal-reveal">
                  <div className="fc-name" style={{ color: WHEEL[wheel.idx].tier === "jackpot" ? "var(--essence)" : WHEEL[wheel.idx].tier === "good" ? "var(--good)" : WHEEL[wheel.idx].tier === "none" ? "var(--muted)" : "var(--bad)" }}>{WHEEL[wheel.idx].emo} {WHEEL[wheel.idx].nm}</div>
                  <div style={{ fontSize: 13.5, color: "#cfe6ea", margin: "8px 0 2px", fontStyle: "italic" }}>{WHEEL[wheel.idx].msg}</div>
                </div>
              )}
            </div>
            <div className="wheel-foot">
              {wheel.stage === "done" ? (() => {
                const rrCost = wheelRerollCost(wheel.rr, g.day);
                const canRR = ((g.pending || 0) + (meta.essence || 0)) >= rrCost;
                return (
                  <>
                    <button className="kal-go" onClick={acceptWheel}>Прийняти →</button>
                    <button className="kal-go ghost" disabled={!canRR} onClick={rerollWheel} style={{ opacity: canRR ? 1 : 0.5 }}>🎡 Перекрутити (−◈ {fmt(rrCost)})</button>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Сектор діє лише коли «Прийняти». Перекрут коштує сутності й дорожчає.</div>
                  </>
                );
              })() : (
                <>
                  <button className="kal-go" disabled={wheel.stage === "spin"} onClick={spinWheel} style={{ opacity: wheel.stage === "spin" ? 0.5 : 1 }}>🎡 Крутити колесо</button>
                  <button className="kal-go ghost" disabled={wheel.stage === "spin"} onClick={declineWheel} style={{ opacity: wheel.stage === "spin" ? 0.5 : 1 }}>Відмовитися</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CHALLENGE DAY (no forecast — fact, not warning) */}
      {phase === "challenge" && (() => {
        const ch = challengeForDay(g.day) || CHALLENGES[0];
        return (
          <div className="kal-over">
            <div className={"kal-panel" + (ch.tone === "danger" ? " danger" : ch.tone === "good" ? " win" : "")} style={{ textAlign: "center" }}>
              <span className="kal-tag">день {g.day} · випробування</span>
              <div style={{ fontSize: 56, lineHeight: 1, margin: "6px 0 2px" }}>{ch.emo}</div>
              <div className="kal-big" style={{ fontSize: "clamp(26px,6.5vw,40px)", color: ch.tone === "good" ? "var(--water-a)" : "var(--bad)" }}>{ch.nm}</div>
              <div className="kal-lore">{ch.desc}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "-6px 0 4px", fontStyle: "italic" }}>Сьогодні прогнозу немає — небо вирішило за тебе.</div>
              <button className="kal-go" onClick={acceptChallenge}>Зустріти випробування →</button>
            </div>
          </div>
        );
      })()}

      {/* FESTIVALS (ticketed special days — no forecast, can't tap, events flow) */}
      {phase === "festival" && (() => {
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
      })()}

      {/* FORECAST SLOT */}
      {phase === "forecast" && (
        <div className="kal-over">
          <div className={"kal-panel slot" + (fcResult && (fcResult.tier === "jackpot" || fcResult.tier === "good") ? " win" : "") + (fcResult && fcResult.tier === "danger" ? " danger" : "")} style={{ textAlign: "center" }}>
            <span className="kal-tag">прогноз на день {g.day}</span>
            <div className="kal-big" style={{ fontSize: "clamp(22px,5vw,34px)", marginBottom: 4 }}>Слот неба</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>Крути барабани — це твоя погода на день. Можна перекрутити, ризикнувши водою.</div>

            <div className="reelbox">
              <Reel target={reels[0]} spinKey={spinKey} delay={0} dur={1900} />
              <Reel target={reels[1]} spinKey={spinKey} delay={260} dur={1900} />
              <Reel target={reels[2]} spinKey={spinKey} delay={520} dur={1900} />
              <div className="reel-line" />
            </div>

            {fcResult && (fcResult.tier === "good" || fcResult.tier === "jackpot") &&
              Array.from({ length: fcResult.tier === "jackpot" ? 30 : 18 }).map((_, i) => (
                <div key={i} className="fc-part" style={{ left: `${Math.random() * 100}%`, background: fcResult.tier === "jackpot" ? "var(--essence)" : "var(--water-a)", animationDuration: `${0.9 + Math.random() * 0.8}s`, animationDelay: `${Math.random() * 0.3}s` }} />
              ))}
            {fcResult && fcResult.tier === "danger" &&
              Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="fc-part ember" style={{ left: `${Math.random() * 100}%`, animationDuration: `${0.8 + Math.random() * 0.7}s`, animationDelay: `${Math.random() * 0.3}s` }} />
              ))}

            <div className="fc-res" style={{ minHeight: 64 }}>
              {fcResult ? (
                <div className="kal-reveal">
                  <div className="fc-name" style={{ color: tierCol(fcResult.tier) }}>{fcResult.icon} {fcResult.name}</div>
                  <div className="fc-mods">
                    {fcResult.rainPower > 0 && <span className="mod good">🌧 +{fcResult.rainPower.toFixed(2)} води/с</span>}
                    {fcResult.sunMod !== 0 && <span className={"mod " + (fcResult.sunMod > 0 ? "bad" : "good")}>☀ спека {fcResult.sunMod > 0 ? "+" : ""}{Math.round(fcResult.sunMod * 100)}%</span>}
                    {fcResult.evapMod !== 0 && <span className={"mod " + (fcResult.evapMod < 0 ? "good" : "bad")}>💨 випар {Math.round(fcResult.evapMod * 100)}%</span>}
                    {fcResult.absorbMod > 0 && <span className="mod good">💧 вбирання +{Math.round(fcResult.absorbMod * 100)}%</span>}
                    {fcResult.essMod > 0 && <span className="mod ess">◈ сутність +{Math.round(fcResult.essMod * 100)}%</span>}
                  </div>
                </div>
              ) : <div style={{ color: "var(--muted)", fontStyle: "italic", paddingTop: 18 }}>барабани крутяться…</div>}
            </div>

            <button className="kal-go" disabled={spinning || !fcResult} onClick={acceptForecast} style={{ opacity: spinning || !fcResult ? 0.5 : 1 }}>Прийняти прогноз і почати день →</button>
            <button className="kal-go ghost" disabled={spinning || (freeSpins <= 0 && g.water < respinCost)} onClick={() => spin(respinCost)} style={{ opacity: spinning || (freeSpins <= 0 && g.water < respinCost) ? 0.5 : 1 }}>
              🎰 Перекрутити {freeSpins > 0 ? `(безкоштовно ×${freeSpins})` : `(−${fmt(respinCost)} 💧)`}
            </button>
          </div>
        </div>
      )}

      {/* DEATH */}
      {phase === "dead" && result && (
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
      )}

      {/* SURVIVED */}
      {phase === "survived" && (
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
      )}

      {/* ACHIEVEMENTS POPUP */}
      {popup === "ach" && (
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
      )}

      {/* CODEX / HELP POPUP */}
      {popup === "codex" && (
        <div className="kal-over" onClick={() => setPopup(null)}>
          <div className="kal-panel codex" onClick={e => e.stopPropagation()}>
            <button className="kal-close" onClick={() => setPopup(null)}>✕</button>
            <span className="kal-tag">як грати</span>
            <div className="kal-big" style={{ fontSize: "clamp(24px,5vw,34px)" }}>Книга калабані</div>
            <h4>Мета</h4>
            <p>Ти — калюжа, що висихає, але мріє рости: калабаня → ставок → озеро → <b>океан</b>. Сонце п'є тебе щосекунди. Тримайся до <b>сутінків</b> кожного дня, а тоді обери: ризикнути важчим днем чи забрати <span className="kal-ess">Сутність</span>.</p>
            <p><b>🌡️ Глобальне потепління:</b> з ~10-го дня з'являється невідворотний випар, що росте з кожним днем і не блокується нічим. Рано чи пізно він переможе будь-яку калабаню — і це нормально (рогалик).</p>
            <h4>Дії</h4>
            <ul>
              <li><b>Торкайся калабані</b> — вбираєш вологу з ґрунту (ґрунт повільно відновлюється).</li>
              <li><b>Поглиблення</b> — витрачай воду на покращення поточної мандрівки: глибина, ряска, жили, а <b>🟤 Намулитись</b> додає <b>опору спеці</b>.</li>
              <li><b>Постійні дари</b> — між мандрівками витрачай Сутність на вічні бонуси.</li>
              <li><b>⌨️ Клавіатура:</b> <b>Пробіл</b> — торкнутись калабані (як клік), клавіші <b>1–9 та 0</b> — активувати здібності друзів за порядком.</li>
            </ul>

            <h4>Стан калабані</h4>
            <p>Картка «Стан калабані» показує живі цифри твоєї води:</p>
            <ul>
              <li><b>Випар</b> — скільки води сонце п'є щосекунди; <b>Приплив</b> — скільки прибуває.</li>
              <li><b>Чистий</b> — підсумок (приплив мінус випар): <span style={{ color: "var(--good)" }}>+</span> зростаєш, <span style={{ color: "var(--bad)" }}>−</span> висихаєш.</li>
              <li><b>Вбирання</b> — скільки даєш за один дотик; <b>Опір спеці 🟤</b> — наскільки мул гасить спеку (росте від «Намулитись»).</li>
              <li><b>Волога ґрунту</b> — запас, з якого тягнеш дотиками; <b>Потепління 🌡️</b> — додатковий випар від глобального потепління.</li>
              <li>Внизу — <b>тимчасові бусти</b> (тінь, листя, прискорений випар тощо) з лічильником секунд.</li>
            </ul>
            <h4>Слот неба</h4>
            <p>Перед кожним днем крути барабани — три однакові символи дають потужне <b>комбо</b>. Можна перекрутити, ризикнувши водою.</p>
            <div style={{ marginTop: 6 }}>
              {SYMBOLS.map((s, i) => (
                <div className="wx" key={i}>
                  <span className="we">{s.e}</span><span className="wn">{s.nm}</span>
                  <span className="wd">{s.rain ? `дощ +${s.rain} ` : ""}{s.sun ? `спека ${s.sun > 0 ? "+" : ""}${Math.round(s.sun * 100)}% ` : ""}{s.evap ? `випар ${Math.round(s.evap * 100)}% ` : ""}{s.abs ? `вітер +${Math.round(s.abs * 100)}% ` : ""}{s.ess ? `сутність +${Math.round(s.ess * 100)}%` : ""}</span>
                </div>
              ))}
            </div>

            <h4>Гості</h4>
            <ul>
              <li>Час від часу приходять <b>гості</b> з вибором. Деякі <b>не дуже чесні</b>: на вигляд обіцяють добро, а потай користуються тобою — навчишся їх упізнавати.</li>
              <li><b>Дружба</b> (жаба, кіт, равлик…) дає активні <b>здібності</b> на забіг, але <b>скидається щозабігу</b> — друзів треба здобувати знову через події. За велику <span className="kal-ess">Сутність</span> у вівтарі можна <b>приручити</b> когось назавжди.</li>
              <li>Деякі гості мають <b>таймер</b>: не вирішиш — підуть (обереться безпечний варіант). Події не «стакаються».</li>
              <li>Деякі зустрічі <b>розгалужуються</b>: твій вибір веде до наступної сцени з новим рішенням (сундук, загадка, верба…).</li>
              <li>Зрідка трапляється <b>🧩 загадка</b> — угадай відповідь і отримай нагороду (сутність і вода).</li>
            </ul>

            <h4>Прихована Вдача</h4>
            <p>Кожне рішення тихо змінює невидиму <b>Вдачу</b>: добрі/щедрі вчинки — підвищують, обман хитрунів — знижує. Чисел немає — лише відчуття. Вища Вдача робить <b>Колесо Фортуни</b> щедрішим (вказівник теплішає).</p>

            <h4>Колесо Фортуни</h4>
            <p>Рідко (раз на пару днів) випадає <b>Колесо</b> — щось дуже добре, дуже лихе або нічого. Можна крутити або <b>відмовитися</b>.</p>

            <h4>Дні Випробувань</h4>
            <p>Кожен <b>10-й день</b> — особливий: без прогнозу, з фіксованою екстремальною погодою (спека, 🚀 запуск ракети, засуха, курна буря, затемнення…). Тебе не попереджають — запам'ятовуй і готуй білд наперед.</p>

            <h4>Сутінки й Велике Випаровування</h4>
            <p>Доживши до <b>сутінків</b>, обери: важчий новий день чи забрати Сутність. А коли назбираєш досвіду — наважся на <b>Велике Випаровування</b> ☁: скидаєш сутність і дари, та отримуєш вічні <span className="kal-clouds">Хмари</span> й небесні дари. Нескінченне переродження.</p>

            <h4>Остання надія — наперстки</h4>
            <p>Коли висихаєш — шахрай долі пропонує зіграти в <b>🥃 наперстки</b>. Заплати <b>відсоток зібраної сутності</b> (на старті — щонайменше 1 тис.), стеж за тасуванням і обери наперсток: під одним сховано <b>краплю життя</b>. Угадаєш — калабаня наповнюється й мандрівка триває; схибиш — спробуй ще, але ціна щоразу дорожчає. Вища <b>Вдача</b> підвищує шанс. Можна й просто <b>прийняти долю</b> та забрати всю сутність.</p>

            <h4>Досягнення</h4>
            <p>За подвиги даються <b>досягнення</b> (🏆). Деякі — <b>приховані</b> (показуються як «???», поки не відкриєш).</p>

            <h4>Перенесення</h4>
            <p>Прогрес зберігається сам і працює <b>офлайн</b>. У ⚙ можна <b>експортувати/імпортувати</b> код будь-коли — навіть посеред дня.</p>
          </div>
        </div>
      )}

      {/* WELCOME / INTRO */}
      {phase === "welcome" && (
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
      )}

      {/* SETTINGS POPUP */}
      {popup === "settings" && (
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
      )}
    </div>
  );
}

// renders an optional image; if the file is missing it simply disappears (graceful fallback)
function SafeImg({ src, className, alt = "", style }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img className={className} src={src} alt={alt} style={style} draggable={false} onError={() => setOk(false)} />;
}

function Stat({ l, v, c }) {
  return <div><div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>{l}</div><div className="kal-num" style={{ fontSize: 16, color: c }}>{v}</div></div>;
}
function ResStat({ l, v, hi }) {
  return <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", textAlign: "left" }}><div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{l}</div><div className="kal-num" style={{ fontSize: 20, color: hi ? "var(--essence)" : "var(--ink)" }}>{v}</div></div>;
}
