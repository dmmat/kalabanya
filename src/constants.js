/* AUTO-EXTRACTED from App.jsx — default meta state + save migration. */

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

export { DEFAULT_META, migrateMeta };
