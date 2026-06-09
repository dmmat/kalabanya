# Структура коду КАЛАБАНІ

Гра — це React-застосунок (Vite). Раніше **вся логіка жила в одному
`src/App.jsx` (~2600 рядків)**: дані, баланс, ігровий цикл і весь UI були в
одному файлі. Тепер код розкладено по шарах, а `App.jsx` (~200 рядків) — лише
тонкий «диригент»: бере стан із хука `useGame()` і збирає UI-компоненти.

Три шари:

1. **`src/game/`** — чиста ігрова логіка (дані + формули, без React і DOM).
2. **`src/hooks/`** — стан і поведінка гри як React-хуки.
3. **`src/ui/`** — презентаційні компоненти (отримують усе через props).

## Карта модулів

```
src/
├── App.jsx              ← тонкий диригент: const {...} = useGame(); рендерить <Hud/>, оверлеї…
├── main.jsx             ← точка входу
├── WaterPuddle.jsx      ← canvas-візуалізація води (лишилась inline у App як «сцена»)
├── water/waterRenderer.js
├── audio.js             ← Sfx (WebAudio) + Haptics (вібрація)
├── storage.js           ← KEY + store (localStorage → window.storage → пам'ять)
├── constants.js         ← DEFAULT_META + migrateMeta (міграція збережень)
│
├── game/                ← ШАР 1: ЧИСТА логіка (без React/DOM)
│   ├── format.js        ← дрібні хелпери: fmt, clamp, mix, shuffle
│   ├── weather.js       ← слот-машина погоди: SYMBOLS, ваги, computeWeather, rollForecast
│   ├── balance.js       ← ⭐ БАЛАНС: економіка, апгрейди, виклики, випар, старт забігу
│   ├── characters.js    ← друзі: ABILITIES, синергії, PERMA_FRIENDS, friendBaseline
│   ├── events.js        ← випадкові події (EVENTS), загадки (RIDDLES), pickEvent
│   ├── festivals.js     ← святкові дні з квитками (FESTIVALS)
│   ├── wheel.js         ← Колесо Фортуни + прихована Вдача
│   ├── achievements.js  ← визначення досягнень
│   ├── sky.js           ← градієнт неба день/ніч
│   └── engine.js        ← ⚙ чистий рушій: advanceTick (крок дня) + ефекти апгрейдів
│                          (спільний для гри й симулятора — джерело правди логіки)
│
├── hooks/               ← ШАР 2: стан і поведінка
│   ├── useGame.js       ← ⭐ корінь: увесь стан, refs, обробники, похідні візуальні величини;
│   │                       повертає ~130 значень, які App роздає компонентам. Композує:
│   ├── useGameLoop.js   ← ігровий тік (спека, випар, спавн подій, сутінки/смерть)
│   ├── usePersistence.js← завантаження/автозбереження/заголовок вкладки
│   └── useWakeLock.js   ← не гасити екран під час гри (Screen Wake Lock API)
│
└── ui/                  ← ШАР 3: презентаційні компоненти (лише props)
    ├── atoms.jsx        ← SafeImg, Stat, ResStat
    ├── Reel.jsx         ← барабан слота прогнозу
    ├── AltarMenu.jsx, ForecastScreen.jsx, EventModal.jsx, WheelModal.jsx,
    ├── DeathScreen.jsx, SurvivedScreen.jsx, ChallengeScreen.jsx, FestivalScreen.jsx,
    ├── AbilityBar.jsx, PlayPanels.jsx, PlayHeatRow.jsx, PlayTodRow.jsx, Toasts.jsx,
    └── AchievementsPopup.jsx, CodexPopup.jsx, SettingsPopup.jsx, WelcomeScreen.jsx
```

> Заголовок-HUD і «сцена» з водою (`<WaterPuddle/>` + частинки погоди) лишилися
> inline у `App.jsx`: вони зав'язані на ~20 похідних візуальних величин, тож
> винесення лише додало б довжелезний список props без виграшу в читабельності.

## Залежності між модулями (без циклів)

```
game/format ◄ game/weather ◄ game/balance ◄ { game/events, festivals, characters, wheel, sky }
                                   ▲                          ▲
                  audio, storage, constants                  │
                                   ▲                          │
                              hooks/useGame ◄ { useGameLoop, usePersistence, useWakeLock }
                                   ▲
                                 App.jsx ──► ui/* (props-driven)
```

* `game/*` — чисті функції; беруть стан `g`/`meta` аргументом і повертають новий об'єкт.
* `hooks/*` тримають React-стан і викликають `game/*` формули; `useGame` композує під-хуки.
* `ui/*` нічого не імпортують із `App`/`hooks` — лише `game/*`, `audio`, `atoms`; усі дані приходять props-ами.
* `App.jsx` робить `const { ... } = useGame()` і роздає ці значення компонентам як props
  (імена props збігаються з іменами в `useGame`, тож JSX не змінювався при винесенні).

## Де що міняти

| Хочеш змінити… | Файл |
|---|---|
| ціни апгрейдів, потепління, дохід сутності, випар, старт забігу | `game/balance.js` |
| додати/змінити подію або загадку | `game/events.js` |
| додати/змінити друга, здібність чи синергію | `game/characters.js` |
| фестиваль чи його сценарій | `game/festivals.js` |
| погодні символи й комбо | `game/weather.js` |
| досягнення | `game/achievements.js` |
| вигляд екрана/оверлея (вівтар, смерть, прогноз…) | відповідний файл у `ui/` |
| ігровий цикл, спавн подій, сутінки/смерть | `hooks/useGameLoop.js` |
| збереження/завантаження/заголовок вкладки | `hooks/usePersistence.js` |
| новий стан, обробник чи похідна величина | `hooks/useGame.js` (і додай у props компонента) |

## Рушій і симуляція — спільний код (без дублювання)

Неперервний крок дня і ефекти апгрейдів живуть у **чистому рушії**
`src/game/engine.js` (`advanceTick`, `buyRunUpgrade`, `sunPeak`, `sunCurve`,
`duskBonus`, `abilityCooldown`, `metaCost`). Його викликає і гра
(`hooks/useGameLoop.js`, `useGame.js`), і офлайн-симулятор `sim/`.

**`sim/` тепер ганяє СПРАВЖНЮ гру**, а не копію: імпортує `src/game/*` напряму
(реальні `EVENTS`, `ABILITIES`, `WHEEL`, `FESTIVALS`, виклики, повний вівтар,
престиж) і драйвить їх політиками гравця. Балансних чисел більше **ніде не
дублюємо** — єдине джерело `src/game/balance.js`.

- `sim/run.mjs` — драйвер: повний забіг із політиками (engaged / casual),
  реальні події/здібності/фести/колесо, прокачка й престиж. Детермінізм —
  тимчасовим сідом `Math.random` на час забігу.
- `sim/analyze.mjs` — звіт + **секція «BALANCE ISSUES»**: безсмертя/runaway,
  NaN, мертві апгрейди, домінантні стратегії.

```bash
npm run sim                  # повний звіт по живому балансу
node sim/analyze.mjs --quick # швидше, менше прогонів
```

Щоб перевірити зміну балансу — **відредагуй `src/game/balance.js` і перезапусти
sim**: числа звіту беруться звідти. Детальніше — [`../BALANCE.md`](../BALANCE.md).

## Перевірка після правок

```bash
npm run build   # збірка має пройти без помилок
npm run sim     # перевірити баланс (CURRENT ↔ PROPOSED)
```

Дата-модулі можна виконати й напряму в Node для швидкої перевірки, що логіка
не падає, наприклад:

```js
import { freshRun, evapPerSec } from "./src/game/balance.js";
import { pickEvent } from "./src/game/events.js";
const g = freshRun({});
console.log(evapPerSec(g), pickEvent(g, {}).t);
```

Компоненти можна перевірити SSR-рендером (вони чисті, лише props). Збери
тимчасовий ентрі через `vite build --ssr` і відрендер `renderToString(<Comp .../>)`
у Node — якщо проходить без помилок, JSX і доступ до props коректні. Повноцінну
ж інтерактивність (кліки, тік циклу) дивись у браузері: `npm run dev`.
