/* AUTO-EXTRACTED from App.jsx — game module. See docs/ARCHITECTURE.md. */

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
// погода впливає сильніше: фізичні модифікатори (сонце/випар/дощ/вітер) множимо,
// тож і хороші, і лихі дні відчутно дужчі — більше розмаху, більше напруги (рогалик)
const WEATHER_AMP = 1.45;
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
  // підсилюємо фізичний вплив погоди (назва/tier рахувались на базових значеннях вище,
  // тож ярлики лишаються звичні, а самі ефекти на воду — відчутно сильніші)
  w.rainPower *= WEATHER_AMP; w.sunMod *= WEATHER_AMP; w.absorbMod *= WEATHER_AMP; w.evapMod *= WEATHER_AMP;
  return { ...w, name, icon, idxs, tier, isCombo: all };
}

export { SYMBOLS, WEIGHTS, WEATHER_AMP, NEUTRAL, mulberry32, pickIdxR, rollForecast, computeWeather };
