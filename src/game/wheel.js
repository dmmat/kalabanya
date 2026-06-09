/* AUTO-EXTRACTED from App.jsx — game module. See docs/ARCHITECTURE.md. */

import { effEss } from "./balance.js";
import { clamp } from "./format.js";

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

export { fateLuck, WHEEL, pickWheel };
