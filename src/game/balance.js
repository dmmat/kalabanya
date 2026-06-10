/* AUTO-EXTRACTED from App.jsx — game module. See docs/ARCHITECTURE.md. */

import { clamp } from "./format.js";
import { NEUTRAL } from "./weather.js";

const ABSORB_BASE = 2.5; // water per tap before multipliers (kept in sync logic↔HUD)

/* ---------- адаптація часу: крива дня + промотка раннього грайнду ----------
 * Базова крива (автоматична): день стартує коротким і доростає до стелі — щоб ранній
 * онбординг був швидким, а пізні дні не тяглися нескінченно (раніше dayLen ріс без межі).
 * Промотка (за апгрейди): fast-forward — день СИМУЛЮЄ повну довжину, лише реальний час
 * стискається (economy за день не міняється). Найсильніша на старті забігу й згасає за
 * вікно днів. Підлога — мінімум реальних секунд на день (знижується престижем). */
const DAY_BASE = 30, DAY_STEP = 15, DAY_CAP = 180; // день1=30с … день11=180с, далі 180с
const dayLength = (day) => Math.min(DAY_CAP, DAY_BASE + (Math.max(1, day) - 1) * DAY_STEP);
// мета-апгрейд «warp»: пік % промотки, гіперболічно до ~0.95 (ніколи не досягне)
const accelPeak = (lvl) => (lvl > 0 ? 0.95 * (1 - Math.pow(0.78, lvl)) : 0);
// мета-апгрейд «warpdur»: вікно дії промотки у днях (рів.1 → 5 днів)
const accelWindow = (lvl) => 4 + (lvl || 0);
// престиж-апгрейд «c_warp»: підлога реальних секунд/день, гіперболічно 10 → 5 (ніколи не 5)
const warpFloor = (lvl) => 5 + 5 * Math.pow(0.7, lvl || 0);
// частка промотки на день забігу: peak на старті, плавно (ease-in-out, smoothstep)
// згасає до 0 на межі вікна. warpdur розтягує саму криву ширше. Без різких щоденних стрибків.
const smoothstep = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const dayAccel = (day, peak, window) => (peak > 0 && window > 0 ? peak * (1 - smoothstep((day - 1) / window)) : 0);
// множник до dt: повна довжина / цільовий реальний час (з підлогою). ≥1.
const daySpeed = (day, peak, window, floor) => {
  const len = dayLength(day);
  const wall = Math.max(floor || warpFloor(0), len * (1 - dayAccel(day, peak, window)));
  return len / wall;
};

/* ---------- in-run & meta upgrades ---------- */
const RUN_UPGRADES = [
  { id: "deepen", emo: "🕳️", nm: "Поглибшати", de: "+об'єму, трохи менший випар.", base: 24, growth: 1.4, frac: 0.18 },
  { id: "widen",  emo: "💧", nm: "Розширити русло", de: "+вбирання, +30 об'єму, трохи більший випар.", base: 22, growth: 1.4, frac: 0.10 },
  { id: "vein",   emo: "🌊", nm: "Прокласти жилу", de: "Підземна жила: +0.4 води/с.", base: 40, growth: 1.5, frac: 0.14 },
  { id: "lake",   emo: "🟦", nm: "Підземне озеро", de: "Велике джерело: +об'єму та +1.5 води/с.", base: 1800, growth: 1.7, frac: 0.25, req: g => (g.maxWater || 0) >= 16000, hidden: true },
  { id: "trench", emo: "🌀", nm: "Океанічна западина", de: "Велетенська западина: +об'єму та +4 води/с.", base: 150000, growth: 1.62, frac: 0.22, req: g => (g.maxWater || 0) >= 4000000, hidden: true },
  { id: "moss",   emo: "🌿", nm: "Поростити ряскою", de: "Ряска вкриває гладь: −7% випару.", base: 28, growth: 1.45, frac: 0.10 },
  { id: "silt",   emo: "🟤", nm: "Намулитись", de: "Плівка мулу: +опір спеці. Кожен новий шар лягає тонше.", base: 30, growth: 1.42, frac: 0.12 },
  { id: "summon", emo: "📣", nm: "Гучніший поклик", de: "−6% перезарядки здібностей.", base: 60, growth: 1.5, frac: 0.10, req: g => g.hasFriend, hidden: true },
];
// ціна апгрейду залежить ЛИШЕ від рівня (чиста експонента), а НЕ від об'єму.
// Раніше ціна росла з об'ємом (частка maxWater) → зростати ставало дорого, гравцю
// було вигідно «лишатися малим». Тепер об'єм НЕ дорожчає прокачку — навпаки, велика
// калабаня має більший запас води, тож качати об'єм стало вигідно й бажано.
const runCost = (u, lvl, _maxW, disc = 1) => {
  lvl = lvl || 0; // захист: новододані апгрейди можуть не мати рівня у старих збереженнях → не дати NaN-ціні
  return Math.max(1, Math.round(u.base * Math.pow(u.growth, lvl) * disc));
};

const META_UPGRADES = [
  { id: "memory", emo: "🫧", nm: "Глибша пам'ять", de: "+22 стартової води.", base: 40, growth: 1.72, max: 12 },
  { id: "cold",   emo: "❄️", nm: "Холодна сутність", de: "−4% базового випару.", base: 55, growth: 1.78, max: 10 },
  { id: "silver", emo: "🌙", nm: "Срібна крапля", de: "+12% сутності з мандрівок.", base: 48, growth: 1.74, max: 12 },
  { id: "spring", emo: "⛲", nm: "Вічне джерело", de: "Старт із +0.3/с пасивної води.", base: 70, growth: 1.85, max: 8 },
  { id: "roots",  emo: "🌱", nm: "Глибокі корінці", de: "+25% швидкості наповнення ґрунту.", base: 52, growth: 1.78, max: 8 },
  { id: "absorb", emo: "🪣", nm: "Спрагле ложе", de: "+10% вбирання вологи за дотик.", base: 50, growth: 1.76, max: 10 },
  { id: "warp",    emo: "⏩", nm: "Адаптація часу", de: "Ранні дні линуть швидше — усе те саме, лиш проминаєш звичне.", base: 200, growth: 1.9, max: 12 },
  { id: "warpdur", emo: "⏳", nm: "Перехідний період", de: "Швидкий проміжок розтягується на більше днів. Без межі.", base: 150, growth: 1.55, max: 9999, inf: true, req: m => (m.warp || 0) >= 1 },
  { id: "luck",   emo: "🍀", nm: "Прихильність неба", de: "+1 безкоштовний перекрут прогнозу за забіг.", base: 70, growth: 2.1, max: 4 },
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
  { id: "c_silt",   emo: "🪨", nm: "Прадавній мул", de: "Старт із плівкою мулу: трохи більше опору спеці.", base: 2, growth: 1.8, max: 6 },
  { id: "c_eco",    emo: "♻️", nm: "Чисте небо", de: "−10% глобального потепління.", base: 2, growth: 1.9, max: 6 },
  { id: "c_warp",   emo: "🕳️", nm: "Згорнутий час", de: "Час згортається тісніше: мінімум на день коротшає (та не зникне зовсім).", base: 2, growth: 1.9, max: 8 },
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

const ABT_CAP = 120; // стеля тривалості тіні/вбирання від стакання (досить високо, щоб щедрі бусти справді складалися)
const addT = (v, a) => Math.min((v || 0) + a, ABT_CAP);

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
// Підкручено: починається раніше (день 8), б'є сильніше й дужче залежить від об'єму —
// це рогалик, тож велика калабаня має таки висихати, а смерть — норма гри.
const warmingDrain = (day, maxWater) => Math.pow(Math.max(0, day - 8), 1.5) * 0.26 * Math.pow(Math.max(1, maxWater || 120) / 120, 0.45);
// опір спеці (Намул) накопичується РЕГРЕСИВНО: кожен рівень закриває частку розриву до
// стелі 0.99 (геометрично спадна віддача — асимптота, ніколи не 100%). Раніше це був
// плаский +8%/рів до капу 0.85 → кілька дешевих рівнів давали майже імунітет (імба).
const RESIST_CAP = 0.99;
const SILT_STEP = 0.085, C_SILT_STEP = 0.065; // частка розриву, що закриває один рівень
const addResist = (cur, step) => RESIST_CAP - (RESIST_CAP - (cur || 0)) * (1 - step); // одна покупка
const stackResist = (n, step) => RESIST_CAP * (1 - Math.pow(1 - step, n || 0)); // n покупок з нуля
// мрія калабані рости: ранг за об'ємом
const RANKS = [[300, "калабаня"], [900, "велика калабаня"], [2500, "ставок"], [6000, "озерце"], [16000, "озеро"], [150000, "велике озеро"], [600000, "море"], [1600000, "велике море"], [4000000, "Північний Льодовитий океан"], [14000000, "Індійський океан"], [50000000, "Атлантичний океан"], [150000000, "Тихий океан"]];
const rankName = (mw) => { for (const [t, n] of RANKS) if (mw < t) return n; return "Світовий океан"; };

function evapPerSec(g) {
  const w = g.weather || NEUTRAL;
  const sunEff = clamp(g.sun * (1 + w.sunMod), 0, 400);
  const sunMul = 1 + (sunEff / 100) * 2.5 * (1 - clamp(g.sunResist, 0, RESIST_CAP));
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
    day: 1, elapsed: 0, dayLen: dayLength(1), sun: 8, rescues: 0,
    accelPeak: accelPeak(M("warp")), accelWindow: accelWindow(M("warpdur")), accelFloor: warpFloor(M("c_warp")),
    speed: daySpeed(1, accelPeak(M("warp")), accelWindow(M("warpdur")), warpFloor(M("c_warp"))),
    baseEvap: 0.95 * Math.pow(0.96, M("cold")) * Math.pow(0.97, M("permafrost")),
    deepenMult: 1, mossMult: 1, sunResist: stackResist(M("c_silt"), C_SILT_STEP), absorbMult: 1 + 0.10 * M("absorb") + 0.12 * M("thirst"),
    soil: 60, soilMax: 60, soilRegen: 3.8 * (1 + 0.25 * M("roots") + 0.25 * M("deeproots")),
    passive: 0.3 * M("spring") + 0.4 * M("spring2") + 0.5 * M("c_spring") + 0.03 * M("abyss") + ((meta.frogBond || 0) >= 3 ? 0.1 : 0), leaf: 0,
    shadeT: 0, evapBoostT: 0, absorbBoostT: 0, cheapT: 0,
    essMult: (1 + 0.12 * M("silver") + 0.15 * M("golddrop")) * (1 + 0.4 * M("c_ess")), essRate: 0.10 + 0.05 * M("essflow"),
    friend: 1 + Math.min(0.6, (meta.frogBond || 0) * 0.05), // дружба з жабою покращує дари подій
    ecoMult: Math.max(0.55, (1 - 0.06 * M("trees")) * (1 - 0.10 * M("c_eco"))), // еко-дари ВІДТЕРМІНОВУЮТЬ потепління (не скасовують)
    abil: { birds: 0, frogs: 0, dog: 0, cat: 0, ducks: 0, snail: 0, bee: 0, hog: 0, heron: 0, fish: 0, fire: 0 },
    hasFriend: !!(meta.birdFriend || (meta.frogBond || 0) >= 1 || meta.dogFriend || meta.catPet || meta.duckFriend || meta.snailMet || meta.beeFriend || meta.hogFriend || meta.heronFriend || meta.fireFriend),
    pending: 0, nextEvent: 14, festival: false, festAt: 0,
    usedRiddles: [], eventCd: {}, crowShoo: 0, crowGagDone: false, // загадки без повторів · кулдауни подій · лічильник приколу з круком

    tickets: { ...(meta.tickets || {}) }, // придбані квитки на фестивалі діють цей забіг
    seed: (Math.random() * 4294967296) >>> 0, // сід забігу для детермінованого прогнозу
    fcIdx: 0, fcFree: 0, // fcIdx — № платного перекруту цього дня; fcFree — скільки безкоштовних витрачено ЗА ЗАБІГ (зберігаються → рефреш не змінює небо)
    levels: { deepen: 0, silt: 0, widen: 0, moss: 0, vein: 0, lake: 0, trench: 0, summon: 0 },
    weather: NEUTRAL,
  };
}

export { ABSORB_BASE, RUN_UPGRADES, runCost, META_UPGRADES, META_TIER2_DAY, PRESTIGE_UNLOCK, cloudsFrom, PRESTIGE_UPGRADES, CHALLENGE_EVERY, CHALLENGES, challengeForDay, nextChallengeDay, applyChallenge, ABT_CAP, addT, effEss, sizeMul, aw, eAmt, tempC, warmingDrain, RANKS, rankName, evapPerSec, freshRun, dayLength, daySpeed, accelPeak, accelWindow, warpFloor, addResist, SILT_STEP };
