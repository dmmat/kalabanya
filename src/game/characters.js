/* AUTO-EXTRACTED from App.jsx — game module. See docs/ARCHITECTURE.md. */

import { aw, eAmt, effEss, addT } from "./balance.js";

/* ---------- друзі, їхні активні здібності та приручення ----------
   Активні здібності (ABILITIES) з'являються лише з дружбою — сюрприз.
   Ефекти СТАКАЮТЬСЯ (додають тривалість, з кепом). Кулдаун зменшує дар «Поклик друзів».
   Дружби скидаються щозабігу; за сутність їх можна «приручити назавжди» (PERMA_FRIENDS). */

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
    apply: (g, m) => ({ ...g, shadeT: addT(g.shadeT, 14 + fc3(m)) }), tip: "Прохолодний слиз — велика тінь" },
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

export { FRIEND_KEYS, friendCount, fc3, eMul, PERMA_FRIENDS, PERMA_FLAG, friendBaseline, ABILITIES, SYNERGY, synKey, PREY_ACC, joinUa };
