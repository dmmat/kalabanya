import React, { useState, useEffect, useRef, useCallback } from "react";

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
];
const WEIGHTS = [4, 3, 4, 3, 3, 1, 1.6, 2, 1.4];
const NEUTRAL = { rainPower: 0, sunMod: 0, absorbMod: 0, evapMod: 0, essMod: 0, name: "Ще не дивилась у небо", icon: "⛅", idxs: [0, 0, 0], tier: "norm" };

function pickIdx() {
  const tot = WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < WEIGHTS.length; i++) { r -= WEIGHTS[i]; if (r <= 0) return i; }
  return WEIGHTS.length - 1;
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
  { id: "silt",   emo: "🟤", nm: "Намулитись", de: "Плівка мулу береже від спеки.", base: 30, growth: 1.42, frac: 0.12 },
  { id: "widen",  emo: "💧", nm: "Розширити русло", de: "+вбирання, +30 об'єму, трохи більший випар.", base: 22, growth: 1.4, frac: 0.10 },
  { id: "moss",   emo: "🌿", nm: "Поростити ряскою", de: "Ряска вкриває гладь: −7% випару.", base: 28, growth: 1.45, frac: 0.10 },
  { id: "vein",   emo: "🌊", nm: "Прокласти жилу", de: "Підземна жила: +0.4 води/с.", base: 40, growth: 1.5, frac: 0.14 },
  { id: "lake",   emo: "🟦", nm: "Підземне озеро", de: "Велике джерело: +150 об'єму, +0.7/с.", base: 130, growth: 1.7, frac: 0.25, req: g => g.levels.deepen >= 3, lock: "відкриється: Поглибшати рів.3" },
];
// ціна = більше з експоненти (рання гра) та частки від об'єму (пізня гра),
// але ніколи не вище 92% об'єму → апгрейд завжди можна накопичити (без софт-локу за будь-якої стратегії)
const runCost = (u, lvl, maxW) => {
  const c = Math.max(u.base * Math.pow(u.growth, lvl), (u.frac || 0) * maxW);
  return Math.round(Math.min(c, 0.92 * maxW));
};
const META_UPGRADES = [
  { id: "memory", emo: "🫧", nm: "Глибша пам'ять", de: "+22 стартової води.", base: 18, growth: 1.6, max: 12 },
  { id: "cold",   emo: "❄️", nm: "Холодна сутність", de: "−4% базового випару.", base: 24, growth: 1.7, max: 10 },
  { id: "silver", emo: "🌙", nm: "Срібна крапля", de: "+12% сутності з мандрівок.", base: 20, growth: 1.65, max: 12 },
  { id: "spring", emo: "⛲", nm: "Вічне джерело", de: "Старт із +0.3/с пасивної води.", base: 30, growth: 1.8, max: 8 },
  { id: "roots",  emo: "🌱", nm: "Глибокі корінці", de: "+25% швидкості наповнення ґрунту.", base: 22, growth: 1.7, max: 8 },
  { id: "luck",   emo: "🍀", nm: "Прихильність неба", de: "+1 безкоштовний перекрут прогнозу на день.", base: 26, growth: 2.0, max: 4 },
  { id: "moon",   emo: "🌗", nm: "Срібло сутінків", de: "+15% сутності за виживання до ночі.", base: 34, growth: 1.9, max: 8 },
  // глибинні дари — відкриваються лише в довгій грі (рекорд ≥ 8 днів)
  { id: "spring2", emo: "🪨", nm: "Глибинна жила", de: "Старт із +0.4/с пасивної води.", base: 60, growth: 1.85, max: 6, tier: 2 },
  { id: "essflow", emo: "🌫️", nm: "Роса предків", de: "+0.05/с базового збору сутності.", base: 55, growth: 1.8, max: 6, tier: 2 },
  { id: "calmsky", emo: "🌬️", nm: "Пам'ять зливи", de: "−8% до ціни перекруту прогнозу.", base: 70, growth: 1.9, max: 5, tier: 2 },
];
const META_TIER2_DAY = 8; // глибинні дари відкриваються після такого рекорду

/* ---------- prestige: «Велике Випаровування» ---------- */
const PRESTIGE_UNLOCK = 1200; // скільки сутності за все треба заробити, щоб відкрити престиж
const cloudsFrom = (essThisAsc) => Math.floor(Math.sqrt((essThisAsc || 0) / 200));
const PRESTIGE_UPGRADES = [
  { id: "c_ess",    emo: "🌫️", nm: "Небесна пам'ять", de: "+40% сутності за кожен рівень.", base: 1, growth: 2.0, max: 10 },
  { id: "c_full",   emo: "💧", nm: "Повноводний старт", de: "+30 стартової води та +25 об'єму.", base: 1, growth: 1.7, max: 10 },
  { id: "c_spring", emo: "🌧️", nm: "Першоджерело неба", de: "Старт із +0.5/с пасивної води.", base: 2, growth: 1.9, max: 8 },
  { id: "c_cheap",  emo: "🕊️", nm: "Лагідне небо", de: "−6% до ціни «постійних дарів».", base: 2, growth: 1.9, max: 8 },
  { id: "c_silt",   emo: "🪨", nm: "Прадавній мул", de: "Старт із +6% опору спеці.", base: 2, growth: 1.8, max: 6 },
];

/* ---------- events ---------- */
const EVENTS = [
  { t: "Набігла хмара", emo: "☁️", d: "Темна хмара зависла над тобою.", opts: [
    { b: "Розкритись", s: "+60 води, +випар на 12с", fn: g => ({ ...g, water: g.water + 60, evapBoostT: 12 }) },
    { b: "Зібратись", s: "+18 води, безпечно", fn: g => ({ ...g, water: g.water + 18 }) }] },
  { t: "Спрагла пташка", emo: "🐦", art: "bird", d: "Горобець нахилився попити з тебе.", opts: [
    { b: "Напоїти", s: "−16 води, +8 сутності", fn: g => ({ ...g, water: g.water - 16, pending: g.pending + 8 * effEss(g) }), luck: 1 },
    { b: "Завмерти", s: "нічого", fn: g => g }] },
  { t: "Тінь дерева", emo: "🌳", d: "Гілка кинула на тебе прохолоду.", opts: [
    { b: "Сховатись у тіні", s: "−випар на 15с", fn: g => ({ ...g, shadeT: 15 }) },
    { b: "Ловити сонце", s: "+вбирання на 15с", fn: g => ({ ...g, absorbBoostT: 15 }) }] },
  { t: "Тріщина в землі", emo: "🪨", d: "Поряд розверзлась суха тріщина.", opts: [
    { b: "Просочитись глибше", s: "−30% води, +55 об'єму", fn: g => ({ ...g, water: g.water * 0.7, maxWater: g.maxWater + 55 }) },
    { b: "Лишитись", s: "нічого", fn: g => g }] },
  { t: "Калабаня-сусідка", emo: "💧", d: "Інша калабаня майже торкається тебе краєм.", opts: [
    { b: "Злитись воєдино", s: "+40 води, +30 об'єму", fn: g => ({ ...g, water: g.water + 40, maxWater: g.maxWater + 30 }) },
    { b: "Лишитись собою", s: "+14 сутності", fn: g => ({ ...g, pending: g.pending + 14 * effEss(g) }) }] },
  { t: "Опале листя", emo: "🍂", d: "Жовтий лист ліг на тебе, мов покривало.", opts: [
    { b: "Прийняти прихисток", s: "−12% випару до кінця дня", fn: g => ({ ...g, leaf: Math.min(0.6, g.leaf + 0.12) }) },
    { b: "Струсити геть", s: "+10 води", fn: g => ({ ...g, water: g.water + 10 }) }] },
  { t: "Сонячне вікно", emo: "🌤️", tod: [0.30, 0.70], weight: 1.4, d: "Хмари розійшлись — пряме проміння впало на тебе.", opts: [
    { b: "Сховатись у бруд", s: "−випар на 18с", fn: g => ({ ...g, shadeT: 18 }) },
    { b: "Витерпіти", s: "+24 води, +випар на 16с", fn: g => ({ ...g, water: g.water + 24, evapBoostT: 16 }) }] },
  { t: "Жаба-мандрівниця", emo: "🐸", art: "frog", d: "Жаба обрала твою калабаню за прихисток на ніч.", opts: [
    { b: "Прихистити її", s: "−10 води · +дружба з жабою", fn: g => ({ ...g, water: g.water - 10, shadeT: 16 }), meta: m => ({ ...m, frogBond: (m.frogBond || 0) + 1 }), luck: 2 },
    { b: "Прогнати геть", s: "+12 води", fn: g => ({ ...g, water: g.water + 12 }) }] },
  { t: "Дитячий кораблик", emo: "⛵", art: "boat", d: "Дитина пустила паперовий човник твоїми водами.", opts: [
    { b: "Гойдати лагідно", s: "+вбирання на 14с", fn: g => ({ ...g, absorbBoostT: 14 }) },
    { b: "Поглинути човник", s: "+16 води, +6 сутності", fn: g => ({ ...g, water: g.water + 16, pending: g.pending + 6 * effEss(g) }) }] },
  { t: "Нічний приморозок", emo: "🧊", tod: [0, 0.16], weight: 1.8, d: "Досвітній холод скував твою поверхню тонкою кригою.", opts: [
    { b: "Скутися льодом", s: "−випар на 22с", fn: g => ({ ...g, shadeT: 22 }) },
    { b: "Берегти тепло глибин", s: "−8 води, +10 сутності", fn: g => ({ ...g, water: g.water - 8, pending: g.pending + 10 * effEss(g) }) }] },
  { t: "Вітер-пустун", emo: "🍃", d: "Пустотливий вітер заграв над твоєю гладдю.", opts: [
    { b: "Піддатися вітру", s: "−14 води, +вбирання на 16с", fn: g => ({ ...g, water: g.water - 14, absorbBoostT: 16 }) },
    { b: "Притихнути", s: "+8 сутності", fn: g => ({ ...g, pending: g.pending + 8 * effEss(g) }) }] },
  { t: "Через яму — фура", emo: "🚚", art: "truck", d: "Важка фура з гуркотом увігналася просто в яму, де ти лежиш. Колеса здіймають хвилю.", opts: [
    { b: "Дати проїхати", s: "−40% води, +70 об'єму (яма глибшає)", fn: g => ({ ...g, water: g.water * 0.6, maxWater: g.maxWater + 70 }) },
    { b: "Розплескатись навсібіч", s: "−25% води, +14 сутності", fn: g => ({ ...g, water: g.water * 0.75, pending: g.pending + 14 * effEss(g) }) }] },
  { t: "Роса на світанку", emo: "🌅", tod: [0, 0.22], weight: 2.0, d: "Світанкова роса осіла на тобі дрібним сріблом.", opts: [
    { b: "Зібрати росу", s: "+28 води", fn: g => ({ ...g, water: g.water + 28 }) },
    { b: "Лишити блищати", s: "+12 сутності", fn: g => ({ ...g, pending: g.pending + 12 * effEss(g) }) }] },

  /* — гості, що приходять лише з часом (req) та персонажі з пам'яттю (meta) — */
  { t: "Жаба Кума повертається", emo: "🐸", art: "frog", req: (g, m) => (m.frogBond || 0) >= 1, weight: 1.4,
    d: "Знайома жаба впізнала твій блиск і знову прийшла погрітись на твоїм краю.", opts: [
    { b: "Прийняти, як рідну", s: "−випар на 20с · міцніша дружба", fn: g => ({ ...g, shadeT: 20 }), meta: m => ({ ...m, frogBond: (m.frogBond || 0) + 1 }), luck: 2 },
    { b: "Попросити про послугу", s: "+12 сутності", fn: g => ({ ...g, pending: g.pending + 12 * effEss(g) }) }] },
  { t: "Равлик-крамар", emo: "🐌", art: "snail", req: (g) => g.day >= 3, weight: 1.1, timer: 12,
    d: "Равлик зі скойкою-крамницею повз твоїм берегом і розклав на мушлі дрібний крам.", opts: [
    { b: "Виміняти мул на захист", s: "−18 води · +опір спеці", fn: g => ({ ...g, water: g.water - 18, sunResist: clamp(g.sunResist + 0.06, 0, 0.85) }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Купити краплю глибини", s: "−14 води · +35 об'єму", fn: g => ({ ...g, water: g.water - 14, maxWater: g.maxWater + 35 }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Придбати жменю ряски", s: "−16 води · −6% випару (на весь забіг)", fn: g => ({ ...g, water: g.water - 16, mossMult: g.mossMult * 0.94 }), meta: m => ({ ...m, snailMet: true }), luck: 1 },
    { b: "Пройти повз", s: "нічого", fn: g => g }] },
  { t: "Чапля на одній нозі", emo: "🪽", art: "heron", req: (g) => g.day >= 4, weight: 0.9,
    d: "Сіра чапля завмерла над тобою, видивляючись щось у твоїй глибині.", opts: [
    { b: "Поділитися водою", s: "−30 води · +20 сутності", fn: g => ({ ...g, water: g.water - 30, pending: g.pending + 20 * effEss(g) }), luck: 2 },
    { b: "Скаламутитись", s: "безпечно, чапля летить геть", fn: g => g }] },
  { t: "Місячний кіт", emo: "🐈‍⬛", art: "cat", req: (g) => g.day >= 4, tod: [0.74, 1.0], weight: 1.4,
    d: "Чорний кіт прийшов нечутно хлебтати місяць із твоєї поверхні.", opts: [
    { b: "Погладити брижами", s: "+16 сутності · спокій", fn: g => ({ ...g, pending: g.pending + 16 * effEss(g) }), meta: m => ({ ...m, catPet: true }), luck: 2 },
    { b: "Завмерти дзеркалом", s: "−випар на 18с", fn: g => ({ ...g, shadeT: 18 }) }] },
  { t: "Дід-рибалка", emo: "🎣", art: "fisherman", req: (g) => g.day >= 6, weight: 0.8,
    d: "Старий присів поряд і закинув вудку просто в тебе, ніби ти — ціле озеро.", opts: [
    { b: "Підіграти озером", s: "+26 сутності", fn: g => ({ ...g, pending: g.pending + 26 * effEss(g) }) },
    { b: "Віддати глибину", s: "−20% води · +60 об'єму", fn: g => ({ ...g, water: g.water * 0.8, maxWater: g.maxWater + 60 }) }] },
  { t: "Тріщина до водоносу", emo: "⛲", req: (g) => g.maxWater >= 300, weight: 1.0,
    d: "Під тобою з тихим зітханням розкрилася тріщина аж до підземних вод.", opts: [
    { b: "Зрости вглиб", s: "+90 об'єму · +0.3/с", fn: g => ({ ...g, maxWater: g.maxWater + 90, passive: g.passive + 0.3 }) },
    { b: "Запечатати мулом", s: "+45 води", fn: g => ({ ...g, water: Math.min(g.water + 45, g.maxWater) }) }] },
  { t: "Веселка торкнулась води", emo: "🌈", req: (g) => g.day >= 5, weight: 0.7,
    d: "Після короткого дощу веселка вмочила свій край просто в тебе.", opts: [
    { b: "Зачерпнути барв", s: "+50 води · +12 сутності", fn: g => ({ ...g, water: Math.min(g.water + 50, g.maxWater), pending: g.pending + 12 * effEss(g) }) },
    { b: "Лише милуватись", s: "+24 сутності", fn: g => ({ ...g, pending: g.pending + 24 * effEss(g) }) }] },
  { t: "Відлуння старих калабань", emo: "🌌", req: (g, m) => (m.best || 0) >= 10, weight: 0.7,
    d: "У сутінковій тиші ти чуєш шепіт усіх калабань, що висихали тут до тебе.", opts: [
    { b: "Прийняти їхню пам'ять", s: "+42 сутності", fn: g => ({ ...g, pending: g.pending + 42 * effEss(g) }) },
    { b: "Тихо відпустити", s: "−випар на 26с", fn: g => ({ ...g, shadeT: 26 }) }] },

  /* — хитруни: на вигляд вигідно, насправді користуються тобою (таємно мінус Вдача) — */
  { t: "Спритний крук", emo: "🐦‍⬛", art: "crow", cunning: true, req: (g) => g.day >= 3, weight: 1.0, timer: 10,
    d: "Крук схилив голову й зблиснув оком на твоє срібло: «Дай краплин — поверну скарбом, обіцяю».", opts: [
    { b: "Повірити круку", s: "−26 води · обіцяє скарб", fn: g => ({ ...g, water: g.water - 26 }), luck: -3 },
    { b: "Не вестись", s: "нічого", fn: g => g }] },
  { t: "Очеретяний шепіт", emo: "🌾", cunning: true, req: (g) => g.day >= 4, weight: 0.9, timer: 9,
    d: "З очерету тягнеться вкрадливий шепіт: «Розкрийся ширше — і станеш цілим озером…»", opts: [
    { b: "Розкритись на шепіт", s: "обіцяє великий об'єм", fn: g => ({ ...g, water: g.water * 0.7, evapBoostT: 18 }), luck: -2 },
    { b: "Стулитись міцніше", s: "нічого", fn: g => g }] },
  { t: "Лощава п'явка", emo: "🪱", cunning: true, req: (g) => g.day >= 5, weight: 0.8, timer: 9,
    d: "Слизька п'явка лащиться до краю: «Я почищу тебе зсередини, будеш як кришталь».", opts: [
    { b: "Дозволити «почистити»", s: "обіцяє чистоту", fn: g => ({ ...g, water: g.water - 18, evapBoostT: 16 }), luck: -2 },
    { b: "Струсити геть", s: "+8 води", fn: g => ({ ...g, water: g.water + 8 }) }] },
];

/* eligible events filtered by req + час доби (tod), потім зважений вибір */
function pickEvent(g, meta) {
  const tod = g.dayLen ? clamp(g.elapsed / g.dayLen, 0, 1) : 0.5;
  const okReq = e => !e.req || e.req(g, meta);
  const okTod = e => !e.tod || (tod >= e.tod[0] && tod <= e.tod[1]);
  let pool = EVENTS.filter(e => okReq(e) && okTod(e));
  if (!pool.length) pool = EVENTS.filter(okReq); // запас: якщо за часом нічого не підійшло
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
  { emo: "💧", nm: "Повінь", tier: "good", col: "#5fd6e8", w: 2,
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
];

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
// внутрішня «спека» (sun) — ігрова інтенсивність; для показу мапимо у правдоподібний °C
const tempC = (sun) => Math.round(14 + Math.sqrt(clamp(sun, 0, 400) / 400) * 32);

function evapPerSec(g) {
  const w = g.weather || NEUTRAL;
  const sunEff = clamp(g.sun * (1 + w.sunMod), 0, 400);
  const sunMul = 1 + (sunEff / 100) * 2.5 * (1 - clamp(g.sunResist, 0, 0.85));
  let e = g.baseEvap * g.deepenMult * g.mossMult * sunMul * (1 - g.leaf);
  if (g.shadeT > 0) e *= 0.35;
  if (g.evapBoostT > 0) e *= 1.7;
  e *= (1 + w.evapMod);
  return Math.max(0, e);
}

function freshRun(meta) {
  const M = (k) => meta[k] || 0;
  return {
    water: 46 + M("memory") * 22 + 30 * M("c_full"), maxWater: 120 + M("memory") * 22 + 25 * M("c_full"),
    day: 1, elapsed: 0, dayLen: 100, sun: 8,
    baseEvap: 0.95 * Math.pow(0.96, M("cold")),
    deepenMult: 1, mossMult: 1, sunResist: clamp(0.06 * M("c_silt"), 0, 0.85), absorbMult: 1,
    soil: 60, soilMax: 60, soilRegen: 3.8 * (1 + 0.25 * M("roots")),
    passive: 0.3 * M("spring") + 0.4 * M("spring2") + 0.5 * M("c_spring") + ((meta.frogBond || 0) >= 3 ? 0.1 : 0), leaf: 0,
    shadeT: 0, evapBoostT: 0, absorbBoostT: 0,
    essMult: (1 + 0.12 * M("silver")) * (1 + 0.4 * M("c_ess")), essRate: 0.15 + 0.05 * M("essflow"),
    pending: 0, nextEvent: 14,
    levels: { deepen: 0, silt: 0, widen: 0, moss: 0, vein: 0, lake: 0 },
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
const DEFAULT_META = { essence: 0, runs: 0, best: 0, memory: 0, cold: 0, silver: 0, spring: 0, roots: 0, luck: 0, moon: 0, spring2: 0, essflow: 0, calmsky: 0, frogBond: 0, snailMet: false, catPet: false, fate: 0, sound: true, ach: {}, maxVol: 120, clouds: 0, ascensions: 0, essThisAsc: 0, lifeEss: 0, c_ess: 0, c_full: 0, c_spring: 0, c_cheap: 0, c_silt: 0 };

export default function App() {
  const [phase, setPhase] = useState("loading"); // loading|welcome|menu|forecast|playing|dead|survived
  const [g, setG] = useState(() => freshRun({}));
  const [meta, setMeta] = useState(DEFAULT_META);
  const [event, setEvent] = useState(null);
  const [fx, setFx] = useState([]);
  const [result, setResult] = useState(null);
  const [io, setIo] = useState({ open: false, text: "", msg: "" });
  const [popup, setPopup] = useState(null); // null | "codex" | "ach" | "settings"
  const [toasts, setToasts] = useState([]);
  const [scenesOk, setScenesOk] = useState(true); // illustrated backgrounds present?
  const [wheel, setWheel] = useState(null); // null | { stage:"offer"|"spin"|"done", idx }
  const [wheelRot, setWheelRot] = useState(0);
  const [eventT, setEventT] = useState(0); // countdown for timed (passing) guests
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
  const resultRef = useRef(result); resultRef.current = result;
  const bootForecast = useRef(false);

  useEffect(() => { Sfx.setMuted(!meta.sound); }, [meta.sound]);

  /* ---- achievements ---- */
  const unlock = useCallback((id) => {
    if (metaRef.current.ach && metaRef.current.ach[id]) return;
    const def = ACHIEVEMENTS.find(a => a.id === id); if (!def) return;
    setMeta(m => ({ ...m, ach: { ...m.ach, [id]: true } }));
    const tid = Math.random();
    setToasts(t => [...t, { id: tid, def }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== tid)), 5200);
    Sfx.ach();
  }, []);

  /* ---- load ---- */
  useEffect(() => {
    (async () => {
      const raw = await store.load(KEY);
      if (raw) {
        try {
          const d = JSON.parse(raw);
          if (d.meta) setMeta(m => ({ ...m, ...d.meta, ach: { ...(d.meta.ach || {}) } }));
          const resumable = ["playing", "survived", "forecast", "dead"];
          if (d.g && resumable.includes(d.phase)) {
            // якщо перезавантажили під час події/колеса — скидаємо «паузу» таймера подій
            const ne = (d.g.nextEvent == null || d.g.nextEvent >= 9999) ? 6 + Math.random() * 6 : d.g.nextEvent;
            setG(gg => ({ ...gg, ...d.g, weather: d.g.weather || NEUTRAL, nextEvent: ne }));
            if (d.phase === "dead") {
              if (d.result) { setResult(d.result); setPhase("dead"); }
              else setPhase("menu"); // run already banked, just no screen to show
            } else if (d.phase === "forecast") {
              bootForecast.current = true; setPhase("forecast"); // re-open the day's slot
            } else {
              setPhase(d.phase); // playing | survived — continue exactly where we stopped
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
  // persist immediately whenever the phase changes, so a refresh resumes the exact screen
  useEffect(() => {
    if (!loaded.current || phase === "loading") return;
    store.save(KEY, JSON.stringify({ v: 3, meta: metaRef.current, phase, g: gRef.current, result: resultRef.current }));
  }, [phase]);

  /* ---- game loop ---- */
  useEffect(() => {
    if (phase !== "playing") return;
    const dt = 0.1;
    const iv = setInterval(() => {
      setG(prev => {
        if (wheelRef.current) return prev; // Колесо Фортуни ставить день на паузу
        const n = { ...prev };
        n.elapsed += dt;
        const t = clamp(n.elapsed / n.dayLen, 0, 1);
        const peak = 72 + (n.day - 1) * 13 + Math.pow(Math.max(0, n.day - 5), 1.6) * 0.6;
        n.sun = Math.max(6, peak * Math.sin(Math.PI * t));
        n.shadeT = Math.max(0, n.shadeT - dt);
        n.evapBoostT = Math.max(0, n.evapBoostT - dt);
        n.absorbBoostT = Math.max(0, n.absorbBoostT - dt);
        n.soil = clamp(n.soil + n.soilRegen * dt, 0, n.soilMax);
        const w = n.weather || NEUTRAL;
        const evap = evapPerSec(n);
        n.water = Math.min(n.water + (n.passive + w.rainPower - evap) * dt, n.maxWater);
        n.pending += (n.essRate || 0.15) * effEss(n) * dt;
        if (!event) n.nextEvent -= dt; // таймер паузиться, поки відкрите вікно події
        if (n.water >= n.maxWater - 0.5) unlock("rainchild");
        if (n.nextEvent <= 0 && !event) {
          n.nextEvent = 99999; // сентинел: жодних нових подій, доки цю не закриють
          // рідко (раз на пару днів) замість звичайної події випадає Колесо Фортуни
          const wheelReady = n.day >= 2 && (n.day - (n.wheelDay ?? -9)) >= 2 && Math.random() < 0.35;
          if (wheelReady) { n.wheelDay = n.day; setWheel({ stage: "offer" }); }
          else setEvent(pickEvent(n, metaRef.current));
        }
        if (n.elapsed >= n.dayLen) {
          const bonus = 22 * n.day * effEss(n) * (1 + 0.15 * (metaRef.current.moon || 0));
          n.pending += bonus;
          const tapsThisDay = dayTaps.current;
          const waterAtDusk = n.water;
          queueMicrotask(() => {
            unlock("firstdew");
            if (tapsThisDay === 0) unlock("mirror");
            if (waterAtDusk <= 5) unlock("lastdrop");
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
            setResult({ gained, secs: Math.round(n.elapsed), day: n.day });
            setMeta(m => ({ ...m, essence: m.essence + gained, runs: m.runs + 1, best: Math.max(m.best, n.day), essThisAsc: (m.essThisAsc || 0) + gained, lifeEss: (m.lifeEss || 0) + gained }));
            if (n.day >= 7) unlock("sevensuns");
            if (n.day >= 30) unlock("oldpuddle");
            if (n.day >= 50) unlock("eternal");
            Sfx.danger();
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
    if (shown > 0) Sfx.drip();
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
    const lvl = prev.levels[u.id], cost = runCost(u, lvl, prev.maxWater);
    if (prev.water < cost) return prev;
    Sfx.click();
    const n = { ...prev, water: prev.water - cost, levels: { ...prev.levels, [u.id]: lvl + 1 } };
    // additive capacity — помірний ріст об'єму (від софт-локу захищає стеля ціни 92% у runCost)
    if (u.id === "deepen") { n.maxWater += 50 + lvl * 10; n.deepenMult *= 0.97; }
    if (u.id === "silt") n.sunResist = clamp(n.sunResist + 0.08, 0, 0.85);
    if (u.id === "widen") { n.absorbMult += 0.6; n.soilMax += 40; n.maxWater += 30; n.baseEvap += 0.04; }
    if (u.id === "moss") n.mossMult *= 0.93;
    if (u.id === "vein") n.passive += 0.4;
    if (u.id === "lake") { n.maxWater += 150; n.passive += 0.7; queueMicrotask(() => unlock("deepwell")); }
    if (n.maxWater >= 500) unlock("unfathom");
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
      memory: 0, cold: 0, silver: 0, spring: 0, roots: 0, luck: 0, moon: 0, spring2: 0, essflow: 0, calmsky: 0,
      clouds: (m.clouds || 0) + gain,
      ascensions: (m.ascensions || 0) + 1,
    }));
    unlock("ascend");
    Sfx.dusk();
    setPhase("menu");
  };
  const resolveEvent = (opt) => {
    Sfx.click();
    setG(prev => {
      const n = opt.fn ? { ...opt.fn(prev) } : { ...prev };
      n.nextEvent = 13 + Math.random() * 8; // відлік до наступної події стартує лише тепер
      if (n.maxWater >= 500) unlock("unfathom");
      if (n.maxWater > (metaRef.current.maxVol || 0)) setMeta(m => ({ ...m, maxVol: Math.round(n.maxWater) }));
      return n;
    });
    if (opt.meta) setMeta(m => {
      const nm = opt.meta(m);
      if ((nm.frogBond || 0) >= 3) queueMicrotask(() => unlock("kumasya"));
      if (nm.snailMet) queueMicrotask(() => unlock("merchant"));
      if (nm.catPet) queueMicrotask(() => unlock("mooncat"));
      return nm;
    });
    if (opt.luck) setMeta(m => ({ ...m, fate: Math.max(0, (m.fate || 0) + opt.luck) })); // рішення впливають на приховану Вдачу (±)
    setEvent(null);
  };
  resolveEventRef.current = resolveEvent;
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
  const closeWheel = () => { Sfx.click(); setWheel(null); setG(p => ({ ...p, nextEvent: 13 + Math.random() * 8 })); };
  const spinWheel = () => {
    if (!wheel || wheel.stage !== "offer") return;
    const idx = pickWheel(fateLuck(metaRef.current));
    Sfx.spin();
    setWheelRot(prev => Math.ceil(prev / 360) * 360 + 360 * 6 + (360 - (idx * 45 + 22.5)));
    setWheel({ stage: "spin", idx });
    setTimeout(() => {
      const seg = WHEEL[idx];
      setG(p => {
        const n = seg.fn ? { ...seg.fn(p) } : { ...p };
        if (n.maxWater > (metaRef.current.maxVol || 0)) setMeta(m => ({ ...m, maxVol: Math.round(n.maxWater) }));
        return n;
      });
      if (seg.luck) setMeta(m => ({ ...m, fate: (m.fate || 0) + seg.luck }));
      if (seg.tier === "jackpot" || seg.tier === "good") Sfx.win();
      else if (seg.tier === "bad" || seg.tier === "verybad") Sfx.danger();
      setWheel({ stage: "done", idx });
    }, 3300);
  };

  /* ---- slot spin ---- */
  const spin = (cost) => {
    if (spinning) return;
    if (cost > 0) {
      if (freeSpins > 0) { setFreeSpins(s => s - 1); }
      else { if (gRef.current.water < cost) return; setG(p => ({ ...p, water: p.water - cost })); }
      setRespins(r => r + 1);
    }
    Sfx.spin();
    const targets = [pickIdx(), pickIdx(), pickIdx()];
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
      setRespins(0); setFcResult(null); setSpinning(false);
      setFreeSpins(metaRef.current.luck || 0);
      const t = setTimeout(() => spin(0), 350);
      return () => clearTimeout(t);
    }
  }, [phase]); // eslint-disable-line

  const enterForecast = () => {
    setRespins(0); setFcResult(null); setSpinning(false);
    setFreeSpins(meta.luck || 0);
    setPhase("forecast");
    setTimeout(() => spin(0), 350);
  };
  const startJourney = () => { Sfx.click(); dayTaps.current = 0; setG(freshRun(meta)); setEvent(null); setResult(null); enterForecast(); };
  const acceptForecast = () => {
    Sfx.click();
    dayTaps.current = 0;
    setG(prev => ({ ...prev, weather: fcResult || NEUTRAL }));
    setEvent(null); setPhase("playing");
  };
  const continueDay = () => {
    Sfx.click();
    setG(prev => ({ ...prev, day: prev.day + 1, elapsed: 0, sun: 6, dayLen: prev.dayLen + 6, nextEvent: 12 + Math.random() * 6 }));
    enterForecast();
  };
  const endJourney = () => {
    Sfx.click();
    const gained = Math.round(g.pending);
    setResult({ gained, secs: Math.round(g.elapsed), day: g.day, finished: true });
    setMeta(m => ({ ...m, essence: m.essence + gained, runs: m.runs + 1, best: Math.max(m.best, g.day), essThisAsc: (m.essThisAsc || 0) + gained, lifeEss: (m.lifeEss || 0) + gained }));
    if (g.day >= 7) unlock("sevensuns");
    if (g.day >= 30) unlock("oldpuddle");
    if (g.day >= 50) unlock("eternal");
    setPhase("menu");
  };

  /* ---- export / import ---- */
  const exportProgress = () => {
    const data = JSON.stringify({ v: 3, meta, phase: phaseRef.current, g: gRef.current }, null, 0);
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
      setMeta(m => ({ ...m, ...d.meta }));
      if (d.g) { setG(gg => ({ ...gg, ...d.g, weather: d.g.weather || NEUTRAL })); }
      setIo({ open: false, text: "", msg: "" });
      setPhase("menu");
      store.save(KEY, JSON.stringify({ v: 3, meta: { ...metaRef.current, ...d.meta }, phase: "menu", g: d.g || gRef.current }));
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
  const waterCol = mix("#178aa6", "#8a5a3c", dryT * 0.65);
  const waterEdge = mix("#5fd6e8", "#b07a4a", dryT * 0.6);
  const sunT = clamp(g.sun / 130, 0, 1);
  const sunCol = sunT < 0.5 ? mix("#f7c14b", "#f0682f", sunT * 2) : mix("#f0682f", "#d23a2c", (sunT - 0.5) * 2);
  const vaporN = Math.round(clamp(evap / 0.7, 0, 7));
  const rainN = Math.round(clamp(w.rainPower * 10, 0, 36));
  const snowN = phase === "playing" && w.evapMod < -0.18 ? 18 : 0;
  const timeLeft = Math.max(0, Math.ceil(g.dayLen - g.elapsed));
  const respinCost = Math.max(1, Math.round(12 * Math.pow(1.8, respins) * (1 - 0.08 * (meta.calmsky || 0))));
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

  // illustrated scene selection (drop your art into public/scenes/, see README)
  const isNight = sky.star > 0.45;
  const sceneFile = isNight
    ? (ratio > 0.5 ? "night-full.webp" : "night-dry.webp")
    : (ratio > 0.66 ? "day-full.webp" : ratio > 0.33 ? "day-mid.webp" : "day-dry.webp");
  const useScene = scenesOk;

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
        {/* sticky only while playing + on phones; normal flow elsewhere */}
        <div className={"kal-stickytop" + (phase === "playing" ? " playing" : "")}>
        {/* TOP */}
        <div className="kal-top reveal">
          <div>
            <div className="kal-title">КАЛАБАНЯ<span>, що висихає</span></div>
            <div className="kal-sub">slot-roguelike · день {g.day}</div>
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

        {/* STAGE */}
        <div className={"kal-stage reveal" + (phase === "playing" ? " live" : "")} ref={stageRef} onClick={absorb}>
          <div className="kal-sky" style={{ background: sky.gradient }} />
          <div className="kal-stars" style={{ "--star": sky.star, opacity: sky.star }} />
          {!useScene && sky.star > 0.4 && <div className="kal-moon" style={{ opacity: sky.star }} />}

          {/* illustrated scene (auto-used when art is dropped into public/scenes/) */}
          {useScene && (
            <img
              className="kal-scene"
              key={sceneFile}
              src={`${import.meta.env.BASE_URL}scenes/${sceneFile}`}
              alt=""
              draggable={false}
              onError={() => setScenesOk(false)}
              style={{ filter: `brightness(${0.92 + 0.12 * Math.sin(Math.PI * todT)})` }}
            />
          )}

          {/* procedural fallback puddle */}
          {!useScene && <>
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
              <div className="kal-ripple" />
              {r.amt > 0 && <div className="kal-gain kal-num">+{r.amt.toFixed(1)}</div>}
            </div>
          ))}

          {/* water HUD overlay (shown over scene art) */}
          {useScene && phase === "playing" && (
            <div className="kal-hud kal-pmid"><b>{fmt(g.water)}</b><small>/ {fmt(g.maxWater)} води</small></div>
          )}
          {phase === "playing" && <div className="kal-hint">торкайся, щоб вбирати · {net >= 0 ? "▲" : "▼"} {fmt(Math.abs(net))}/с {w.icon}</div>}
        </div>
        </div>{/* end sticky top */}

        {/* PLAY PANELS */}
        {phase === "playing" && (
          <div className="kal-cols reveal">
            <div className="kal-card">
              <h3>Поглиблення <small>ціна у воді</small></h3>
              {RUN_UPGRADES.map(u => {
                const lvl = g.levels[u.id] || 0, cost = runCost(u, lvl, g.maxWater);
                const locked = u.req && !u.req(g);
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13.5 }}>
                <Stat l="Випар" v={`${fmt(evap)}/с`} c="var(--bad)" />
                <Stat l="Приплив" v={`+${fmt(g.passive + w.rainPower)}/с`} c="var(--good)" />
                <Stat l="Вбирання" v={`+${fmt(ABSORB_BASE * g.absorbMult * (g.absorbBoostT > 0 ? 1.9 : 1) * (1 + w.absorbMod))}`} c="var(--water-a)" />
                <Stat l="Волога ґрунту" v={`${Math.round(g.soil)}%`} c="var(--ink)" />
                <Stat l="Опір спеці" v={`${Math.round(g.sunResist * 100)}%`} c="var(--ink)" />
                <Stat l="Сутність ◈" v={`${fmt(g.pending)}${w.essMod ? ` ·${(1 + w.essMod).toFixed(1)}×` : ""}`} c="var(--essence)" />
              </div>
              <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, fontStyle: "italic" }}>
                {g.shadeT > 0 && "У тіні — випар уповільнений. "}
                {g.evapBoostT > 0 && "Поверхня розкрита — сохнеш швидше. "}
                {g.absorbBoostT > 0 && "Брижишся — вбираєш активніше. "}
                {g.shadeT <= 0 && g.evapBoostT <= 0 && g.absorbBoostT <= 0 && "Небо тремтить у твоєму дзеркалі."}
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
              <div className="kal-lore">Кожна калабаня знає, що приречена. Та поки сонце п'є тебе краплю за краплею — ти ще тут, віддзеркалюєш небо. Витрачай <span className="kal-ess">Сутність</span>, що лишили попередні твої «я».</div>
              <div className="seclab">Постійні дари</div>
              {META_UPGRADES.filter(u => u.tier !== 2).map(u => {
                const lvl = meta[u.id] || 0, maxed = lvl >= u.max, cost = Math.round(u.base * Math.pow(u.growth, lvl)), can = !maxed && meta.essence >= cost;
                return (
                  <div key={u.id} className={"kal-up meta clickable" + (can || maxed ? "" : " dis")} onClick={() => can && buyMeta(u)} style={maxed ? { cursor: "default", opacity: 0.7 } : {}}>
                    <div className="emo">{u.emo}</div>
                    <div className="body"><div className="nm">{u.nm}<span className="lvl">{lvl}/{u.max}</span></div><div className="de">{u.de}</div></div>
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
          <div className="opts">{event.opts.map((o, i) => <button key={i} className="kal-btn" onClick={() => resolveEvent(o)}><b>{o.b}</b><small>{o.s}</small></button>)}</div>
        </div>
      )}

      {/* WHEEL OF FORTUNE (rare) */}
      {wheel && (
        <div className="kal-over">
          <div className="kal-panel" style={{ textAlign: "center" }}>
            <span className="kal-tag">рідкісне</span>
            <div className="kal-big" style={{ fontSize: "clamp(24px,6vw,38px)", marginBottom: 4 }}>Колесо Фортуни</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>Крутни — і доля сама вирішить: щось чудове, лихе або нічого. Можна й відмовитись.</div>
            <div className="wheel-wrap">
              <div className="wheel-aura" style={{ opacity: luck * 0.9 }} />
              <div className="wheel-pointer" style={{ borderTopColor: mix("#ffffff", "#ffd05a", luck), filter: `drop-shadow(0 2px 3px rgba(0,0,0,.5)) drop-shadow(0 0 ${luck * 7}px rgba(255,205,90,${luck * 0.9}))` }} />
              <div className="wheel" style={{ transform: `rotate(${wheelRot}deg)`, background: `conic-gradient(${WHEEL.map((s, i) => `${s.col} ${i * 45 - 22.5}deg ${(i + 1) * 45 - 22.5}deg`).join(",")})` }}>
                {WHEEL.map((s, i) => (
                  <div key={i} className="wheel-lbl" style={{ transform: `rotate(${i * 45}deg) translateY(-86px) rotate(${-i * 45}deg)` }}>{s.emo}</div>
                ))}
              </div>
              <div className="wheel-hub" />
            </div>
            {wheel.stage === "done" ? (
              <div className="bannerin">
                <div className="fc-name" style={{ color: WHEEL[wheel.idx].tier === "jackpot" ? "var(--essence)" : WHEEL[wheel.idx].tier === "good" ? "var(--good)" : WHEEL[wheel.idx].tier === "none" ? "var(--muted)" : "var(--bad)" }}>{WHEEL[wheel.idx].emo} {WHEEL[wheel.idx].nm}</div>
                <div style={{ fontSize: 13.5, color: "#cfe6ea", margin: "8px 0 2px", fontStyle: "italic" }}>{WHEEL[wheel.idx].msg}</div>
                <button className="kal-go" onClick={closeWheel}>Далі →</button>
              </div>
            ) : (
              <>
                <button className="kal-go" disabled={wheel.stage === "spin"} onClick={spinWheel} style={{ opacity: wheel.stage === "spin" ? 0.5 : 1 }}>🎡 Крутити колесо</button>
                <button className="kal-go ghost" disabled={wheel.stage === "spin"} onClick={declineWheel} style={{ opacity: wheel.stage === "spin" ? 0.5 : 1 }}>Відмовитися</button>
              </>
            )}
          </div>
        </div>
      )}

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
                <div className="bannerin">
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
            <div className="kal-lore">Остання крапля піднялась у небо парою. На сухій землі лишилось темне коло — пам'ять про те, що тут була вода. З неї проросте нова калабаня.</div>
            <div className="kal-grid2">
              <ResStat l="Прожито" v={`день ${result.day}`} />
              <ResStat l="Трималась" v={`${result.secs}с`} />
              <ResStat l="Зібрано сутності" v={`◈ ${fmt(result.gained)}`} hi />
              <ResStat l="Усього мандрівок" v={meta.runs} />
            </div>
            <button className="kal-go" onClick={() => { Sfx.click(); setPhase("menu"); }}>До вівтаря калабань →</button>
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
            <button className="kal-go" onClick={continueDay}>Зустріти день {g.day + 1} (важче) →</button>
            <button className="kal-go ghost" onClick={endJourney}>Завершити й забрати ◈ {fmt(Math.round(g.pending))}</button>
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
                return (
                  <div key={a.id} className={"ach" + (got ? "" : " locked")}>
                    <div className="ae">{got ? a.e : "🔒"}</div>
                    <div><div className="an">{a.nm}</div><div className="adq">{a.dq}</div></div>
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
            <p>Ти — калюжа, що висихає. Сонце п'є тебе щосекунди. Тримайся до <b>сутінків</b> кожного дня, а тоді обери: ризикнути важчим днем чи забрати <span className="kal-ess">Сутність</span>.</p>
            <h4>Дії</h4>
            <ul>
              <li><b>Торкайся калабані</b> — вбираєш вологу з ґрунту (ґрунт повільно відновлюється).</li>
              <li><b>Поглиблення</b> — витрачай воду на покращення поточної мандрівки.</li>
              <li><b>Постійні дари</b> — між мандрівками витрачай Сутність на вічні бонуси.</li>
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
          </div>
        </div>
      )}

      {/* WELCOME / INTRO */}
      {phase === "welcome" && (
        <div className="kal-welcome">
          {scenesOk && (
            <img className="kal-welcome-bg" src={`${import.meta.env.BASE_URL}scenes/day-full.webp`} alt="" draggable={false} onError={() => setScenesOk(false)} />
          )}
          <div className="kal-welcome-veil" />
          <div className="kal-welcome-inner">
            <span className="kal-tag">поетична інкрементальна roguelike</span>
            <h1 className="kal-welcome-title">КАЛАБАНЯ<span>, що висихає</span></h1>
            <p className="kal-welcome-tag">
              Ти — калюжа на узбіччі польової дороги. Сонце п'є тебе краплю за краплею.
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
