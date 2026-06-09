// Процедурна вода для калабані — Canvas2D, портовано з calushader/iso.html.
// Малює намальований фон ями (день/ніч) + воду в перспективі за картою глибини.
// Рівень води й час доби — параметри, не асети. Без React/DOM-UI.
//
// СИНХРОНІЗОВАНО зі стендом calushader (2026-06-09) — єдине джерело правди.
// У грі активні: еліптичні кільця, celestial (відбиток на 100%), lowGfx.
// Решта FX лишаються вимкненими (дефолт 0).
//
// FX — необовʼязкові ефекти (усі дефолт 0 = базовий вигляд). Per-pixel ефекти
// guarded прапорцями (вимкнено = нуль вартості); спрайт/overlay — окремі проходи.

/* ---- noise / rng (спільні, детерміновані) ---- */
function mkrng(s) { s = (s >>> 0) || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const perm = new Uint8Array(512);
(() => {
  const r = mkrng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0;[p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const sat = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => { const t = sat((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
function vnoise(x, y) {
  const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
  const g = h => (h & 7) / 7;
  const tl = g(perm[perm[xi] + yi]), tr = g(perm[perm[xi + 1] + yi]),
        bl = g(perm[perm[xi] + yi + 1]), br = g(perm[perm[xi + 1] + yi + 1]);
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
}
function fbm(x, y, o) { let a = 0, amp = 0.5, f = 1; o = o || 4; for (let i = 0; i < o; i++) { a += amp * vnoise(x * f, y * f); f *= 2; amp *= 0.5; } return a; }

/* ---- палітра доби ---- t:0 північ .5 полудень 1 північ ---- */
function dayCols(t) {
  const K = [
    { t: 0.00, zen: [18, 26, 46], hor: [34, 40, 60], cloud: [70, 76, 104], grass: [26, 40, 30], grade: [58, 68, 108], amb: 0.42 },
    { t: 0.22, zen: [60, 60, 96], hor: [150, 110, 110], cloud: [210, 170, 165], grass: [60, 80, 46], grade: [235, 180, 150], amb: 0.7 },
    { t: 0.50, zen: [70, 135, 205], hor: [160, 200, 228], cloud: [240, 244, 250], grass: [82, 124, 54], grade: [255, 255, 255], amb: 1.0 },
    { t: 0.74, zen: [80, 100, 150], hor: [220, 160, 120], cloud: [245, 205, 180], grass: [70, 100, 52], grade: [255, 180, 135], amb: 0.8 },
    { t: 0.84, zen: [40, 44, 82], hor: [120, 70, 80], cloud: [150, 110, 120], grass: [44, 58, 40], grade: [150, 110, 130], amb: 0.52 },
    { t: 1.00, zen: [18, 26, 46], hor: [34, 40, 60], cloud: [70, 76, 104], grass: [26, 40, 30], grade: [58, 68, 108], amb: 0.42 },
  ];
  let a = K[0], b = K[K.length - 1];
  for (let i = 0; i < K.length - 1; i++) { if (t >= K[i].t && t <= K[i + 1].t) { a = K[i]; b = K[i + 1]; break; } }
  const k = (t - a.t) / ((b.t - a.t) || 1), m = (p, q) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)];
  return { zen: m(a.zen, b.zen), hor: m(a.hor, b.hor), cloud: m(a.cloud, b.cloud), grass: m(a.grass, b.grass), grade: m(a.grade, b.grade), amb: lerp(a.amb, b.amb, k) };
}

const BUF_W = 420;          // ширина буфера води (висота — за пропорцією карти)
const ANCHOR = 0.72;        // вертикальний якір cover-кропу (яму тримати в кадрі)
const FALLBACK_AR = 2000 / 1445;

// перелік FX-ключів (інтенсивності 0..1; дефолт 0)
const FX_KEYS = ["glitter", "murk", "caustics", "fresnel", "rain", "wind", "duckweed", "leaves", "worms", "celestial", "mist"];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{bgDayUrl:string, bgNightUrl:string, mapUrl:string, onError?:Function}} opts
 */
export function createWaterRenderer(canvas, { bgDayUrl, bgNightUrl, mapUrl, onError }) {
  const ctx = canvas.getContext("2d");

  // буфер води (простір джерела-зображення; не залежить від розміру canvas)
  let Wb = BUF_W, Hb = Math.round(BUF_W / FALLBACK_AR);
  let buf = document.createElement("canvas");
  let bctx = buf.getContext("2d");
  let img = null, px = null;
  let depth = null, depthReady = false, vTop = 0.32, vBot = 0.86;

  // стан параметрів (база + FX, усі FX дефолт 0)
  const S = { fill: 0.04, target: 0.04, time: 0.5, night: 0, cloud: 0.5, wave: 0.35, windSpeed: 0.3, lowGfx: false };
  for (const k of FX_KEYS) S[k] = 0;
  let baseW = BUF_W;          // ширина буфера води (low-gfx режим зменшує її)

  const ripples = [];
  let clock = 0, lastIdle = 0;

  // seeded точки для overlay-ефектів (заповнюються після карти глибини)
  let leafPts = [], duckPts = [], wormPts = [];
  const rainPool = []; let rainAcc = 0;

  // cover-трансформ (display-пікселі)
  let CW = 0, CH = 0;
  const tf = { dx: 0, dy: 0, dw: 0, dh: 0 };

  // ассети
  const bgDay = new Image(), bgNight = new Image(), mapImg = new Image();
  let dayOk = false, nightOk = false, failed = false;
  const ready = () => dayOk && nightOk && depthReady && !failed;

  function fail() { if (!failed) { failed = true; onError && onError(); } }
  function imgRefW() { return bgDay.naturalWidth || mapImg.naturalWidth || 2000; }
  function imgRefH() { return bgDay.naturalHeight || mapImg.naturalHeight || 1445; }

  function depthAtUV(u, v) {
    const xx = Math.min(Wb - 1, Math.max(0, u * Wb | 0)), yy = Math.min(Hb - 1, Math.max(0, v * Hb | 0));
    return depth[yy * Wb + xx];
  }
  // розкидати n точок усередині ями з глибиною у [lo,hi]
  function scatter(n, lo, hi, seed) {
    const r = mkrng(seed), out = []; let tries = 0;
    while (out.length < n && tries < n * 60) {
      tries++;
      const u = 0.08 + r() * 0.84, v = 0.16 + r() * 0.76, d = depthAtUV(u, v);
      if (d > lo && d < hi) out.push({ u, v, a: r() * 6.283, s: 0.55 + r() * 0.9, ph: r() * 6.283, dr: r() - 0.5 });
    }
    return out;
  }

  function buildDepth() {
    const nw = mapImg.naturalWidth || 2000, nh = mapImg.naturalHeight || 1445;
    Wb = baseW; Hb = Math.max(1, Math.round(baseW * nh / nw));
    buf.width = Wb; buf.height = Hb;
    img = bctx.createImageData(Wb, Hb); px = img.data;
    const oc = document.createElement("canvas"); oc.width = Wb; oc.height = Hb;
    const octx = oc.getContext("2d"); octx.drawImage(mapImg, 0, 0, Wb, Hb);
    const md = octx.getImageData(0, 0, Wb, Hb).data;
    depth = new Float32Array(Wb * Hb); let mx = 0;
    for (let i = 0; i < Wb * Hb; i++) { const d = md[i * 4] / 255; depth[i] = d; if (d > mx) mx = d; }
    if (mx > 0) for (let i = 0; i < depth.length; i++) { const d = depth[i] / mx; depth[i] = d < 0.05 ? 0 : d; } // норм. + обнулення шуму фону карти
    let t = 1, b = 0;
    for (let y = 0; y < Hb; y++) for (let x = 0; x < Wb; x++) if (depth[y * Wb + x] > 0.06) { const v = y / Hb; if (v < t) t = v; if (v > b) b = v; }
    vTop = t; vBot = b; depthReady = true;
    // seeded точки
    leafPts = scatter(16, 0.18, 1.01, 13);
    wormPts = scatter(16, 0.45, 1.01, 41);          // центральне (глибше) дно, не на схилах обідка
    // ряска — дрібні цятки міні-розсипами навколо кількох центрів
    duckPts = []; const dr = mkrng(27); let cl = 0, tr = 0;
    while (cl < 16 && tr < 600) {
      tr++; const cu = 0.1 + dr() * 0.8, cv = 0.2 + dr() * 0.7;
      if (depthAtUV(cu, cv) < 0.22) continue; cl++;
      const m = 5 + (dr() * 9 | 0);
      for (let j = 0; j < m; j++) duckPts.push({ u: cu + (dr() - 0.5) * 0.07, v: cv + (dr() - 0.5) * 0.05, s: 0.5 + dr() * 0.6, ph: dr() * 6.283, t: dr() < 0.3 ? 1 : 0 });
    }
  }

  function computeCover() {
    const iw = imgRefW(), ih = imgRefH();
    const scale = Math.max(CW / iw, CH / ih);
    tf.dw = iw * scale; tf.dh = ih * scale;
    tf.dx = (CW - tf.dw) / 2; tf.dy = (CH - tf.dh) * ANCHOR;
  }

  /* ---- публічні ---- */

  function resize(cssW, cssH, dpr) {
    dpr = Math.min(dpr || 1, 1.5);
    CW = Math.max(1, Math.round(cssW * dpr));
    CH = Math.max(1, Math.round(cssH * dpr));
    canvas.width = CW; canvas.height = CH;
    computeCover();
  }

  function setParams(p) {
    if (!p) return;
    if (p.fill != null) S.target = sat(p.fill);
    if (p.tod != null) S.time = sat(p.tod);
    if (p.night != null) S.night = sat(p.night);
    if (p.cloud != null) S.cloud = sat(p.cloud);
    if (p.wave != null) S.wave = sat(p.wave);
    if (p.windSpeed != null) S.windSpeed = sat(p.windSpeed);
    if (p.lowGfx != null) {                               // швидкий тогл спрощення графіки
      const v = !!p.lowGfx;
      if (v !== S.lowGfx) { S.lowGfx = v; baseW = v ? 252 : BUF_W; if (mapImg.naturalWidth) buildDepth(); }
    }
    for (const k of FX_KEYS) if (p[k] != null) S[k] = sat(p[k]);
  }

  // xFrac,yFrac — частки стейджа (0..1); переводимо через інверсію cover-кропу
  function addRipple(xFrac, yFrac, amp) {
    if (!tf.dw) return;
    const fx = (xFrac * CW - tf.dx) / tf.dw;
    const fy = (yFrac * CH - tf.dy) / tf.dh;
    ripples.push({ x: fx * Wb, y: fy * Hb, t0: clock, amp: amp || 4 });
    if (ripples.length > 8) ripples.splice(0, ripples.length - 8);
  }

  /* ---- per-pixel вода ---- */
  function renderWater(C, shoreT, drift, RP, bodies, ws) {
    const WETLAND = 0.05;
    for (let y = 0; y < Hb; y++) {
      const v = y / Hb, v0 = sat((v - vTop) / (vBot - vTop));
      for (let x = 0; x < Wb; x++) {
        const i = y * Wb + x, d = depth[i], o = i * 4;
        if (d <= shoreT) {                              // суша/сухе дно — видно фон
          const dryB = shoreT - d;
          if (d > 0.001 && dryB < WETLAND) {            // волога темна губа на схилі ями біля води
            const wet = 1 - dryB / WETLAND, a = wet * wet * 0.42;
            px[o] = 30 * C.amb; px[o + 1] = 24 * C.amb; px[o + 2] = 18 * C.amb; px[o + 3] = a * 255;
          } else px[o + 3] = 0;
          continue;
        }
        const below = d - shoreT;
        const psc = lerp(0.55, 1.55, v0);
        let dx = 0, dy = 0, ring = 0;
        dx += Math.sin(y * 0.20 * psc + clock * 0.0024) * 0.4;
        dy += Math.sin(x * 0.16 * psc - clock * 0.0019) * 0.4;
        dx += (fbm(x * 0.06 * psc + clock * 0.0006, y * 0.06 * psc, 2) - 0.5);
        for (let k = 0; k < RP.length; k++) {
          // ey стиснений по вертикалі → кільця еліптичні в перспективі (як дощові)
          const r = RP[k], ex = x - r.x, eyr = y - r.y, ey = eyr / 0.55, d2 = ex * ex + ey * ey;
          if (d2 < r.ri2 || d2 > r.ro2) continue;
          const dist = Math.sqrt(d2), band = Math.exp(-Math.abs(dist - r.rad) * 0.10) * r.dec;
          const s = Math.sin((dist - r.rad) * 0.45) * band; ring += s;
          const inv = dist > 0.1 ? s * 0.5 / dist : 0; dx += ex * inv; dy += eyr * inv;
        }
        // [6] вітрові смуги («котячі лапки») — горизонтально-витягнутий шум, матові пасма
        let windDull = 0;
        if (S.wind) {
          const w = S.wind;
          const streak = fbm(x * 0.05 + clock * 0.005 * ws, y * 0.22 + 3, 2); // x повільно, y швидко → горизонтальні смуги (темп від вітру)
          dx += (streak - 0.5) * w * 2.4;
          windDull = smooth(0.5, 0.78, streak) * w;
        }
        let sv = sat(1 - Math.pow(1 - v0, 1.7)); sv = sat(sv + (dy * 0.004 + ring * 0.003));
        let su = (x / Wb) + (dx * 0.01 + ring * 0.004) * 0.3 + drift;
        const r0 = lerp(C.hor[0], C.zen[0], sv), g0 = lerp(C.hor[1], C.zen[1], sv), b0 = lerp(C.hor[2], C.zen[2], sv);
        const cl = fbm(su * 2.4 + drift, (1 - sv) * 1.6 + 7, S.lowGfx ? 1 : 3);
        const cm = Math.min(1, smooth(0.5, 0.78, cl) * smooth(0.03, 0.28, sv) * S.cloud * 1.3);
        let cr = lerp(r0, C.cloud[0], cm), cg = lerp(g0, C.cloud[1], cm), cb = lerp(b0, C.cloud[2], cm);
        const grR = smooth(0.14, 0, sv) * 0.7;
        cr = lerp(cr, C.grass[0] * 1.05, grR); cg = lerp(cg, C.grass[1] * 1.05, grR); cb = lerp(cb, C.grass[2] * 1.05, grR);
        cr *= C.amb * 0.95; cg *= C.amb * 0.95; cb *= C.amb * 0.95;
        const crest = sat(ring * 0.5), sheen = crest * crest * 0.13;
        cr += 235 * sheen; cg += 240 * sheen; cb += 245 * sheen;

        // зонний модулятор (RandomFade з pixel-water-shader): повільний великий шум,
        // що нерівномірно гасить/проявляє поверхневі FX → менше «рівномірно-плоско»
        let zone = 1;
        if (S.glitter || S.caustics) {
          const zf = fbm(x * 0.013 + clock * 0.00012, y * 0.013 - clock * 0.00008, 3);
          zone = 0.3 + 1.25 * smooth(0.32, 0.72, zf);   // ~0.3..1.55 плямами
        }
        // [9] відбиток сонця/місяця — світловий стовп-доріжка (не диск)
        if (S.celestial) {
          for (let bi = 0; bi < bodies.length; bi++) {
            const b = bodies[bi];
            const cdu = (x / Wb - b.x) + dx * 0.012, cdv = (v0 - b.rv);
            const horiz = Math.exp(-(cdu * cdu) / (0.05 * 0.05));
            const vert = smooth(b.vext, 0, Math.abs(cdv));
            const pil = horiz * vert * b.vis * (0.5 + 0.6 * sat(0.5 + ring * 0.5));
            const k = pil * S.celestial * 0.9;
            cr += b.col[0] * k; cg += b.col[1] * k; cb += b.col[2] * k;
          }
        }
        // [1] сонячний блик — нерегулярні іскри вздовж доріжки світила
        if (S.glitter) {
          for (let bi = 0; bi < bodies.length; bi++) {
            const b = bodies[bi];
            const cdu = (x / Wb - b.x);
            const gprox = Math.exp(-(cdu * cdu) / (0.11 * 0.11)) * smooth(b.vext + 0.14, 0, Math.abs(v0 - b.rv));
            if (gprox < 0.02) continue;
            // два шари шуму повзуть різно (specular з pixel-water-shader): перетин → блиск переливається
            // вища частота = дрібніший «піксель» блиску; темп руху від швидкості вітру
            const n1 = fbm(x * 0.95 + clock * 0.020 * ws, y * 0.95, 2);
            const n2 = fbm(x * 0.82 - clock * 0.013 * ws, y * 1.05 + 5, 2);
            const tw = sat(n1 * n2 * 3.6 - 0.62 + ring * 0.5);
            const spark = Math.pow(tw, 4) * gprox * b.vis * zone;
            const k = spark * S.glitter * 3.0;
            cr += 255 * k; cg += 250 * k; cb += 238 * k;
          }
        }
        // [3] каустика на мілкому дні (крізь чисту воду)
        if (S.caustics) {
          const shallow = smooth(0.30, 0.03, below);
          const cc = Math.sin(x * 0.22 + clock * 0.0030) + Math.sin(y * 0.19 - clock * 0.0026) + Math.sin((x + y) * 0.13 + clock * 0.0020);
          const cau = Math.pow(sat(Math.abs(cc) * 0.42), 3.0);
          const k = cau * shallow * S.caustics * (1 - S.murk) * C.amb * zone;
          cr += 150 * k; cg += 160 * k; cb += 120 * k;
        }
        // [2] каламуть (зелено-бурий тон, менше відбиття)
        if (S.murk) {
          const m = S.murk;
          cr = lerp(cr, 66 * C.amb, m * 0.5); cg = lerp(cg, 92 * C.amb, m * 0.5); cb = lerp(cb, 60 * C.amb, m * 0.5);
        }
        // [6] приглушення відбитку вітром (сіріші смуги)
        if (windDull) { const g = (cr + cg + cb) / 3; cr = lerp(cr, g, windDull * 0.3); cg = lerp(cg, g, windDull * 0.3); cb = lerp(cb, g, windDull * 0.3); }

        const reflect = smooth(0.0, 0.16, below);       // ширший мʼякий перехід берега
        cr = lerp(32 * C.amb, cr, reflect); cg = lerp(26 * C.amb, cg, reflect); cb = lerp(20 * C.amb, cb, reflect); // мокрий бурий край
        const men = smooth(0.055, 0, Math.abs(below - 0.022)) * reflect; // тонкий світлий меніск при кромці
        cr += 190 * men * 0.35 * C.amb; cg += 205 * men * 0.35 * C.amb; cb += 215 * men * 0.35 * C.amb;
        let alpha = lerp(0.4, 0.95, reflect);
        // [4] френель/глибина: мілина прозора (видно дно) → глибина дзеркало; +дальній край дзеркальніший
        if (S.fresnel) {
          const deep = smooth(0.03, 0.32, below);        // 0 мілко .. 1 глибоко
          let wa = lerp(0.28, 0.99, deep);
          wa = lerp(wa, Math.max(wa, 0.96), sat(1 - v0) * 0.5); // далекий/похилий край ще дзеркальніший
          alpha = lerp(alpha, wa, S.fresnel);
        }
        // [2] каламуть робить воду майже непрозорою (ховає дно)
        if (S.murk) alpha = lerp(alpha, 0.99, S.murk * smooth(0.0, 0.06, below));

        px[o] = sat(cr / 255) * 255; px[o + 1] = sat(cg / 255) * 255; px[o + 2] = sat(cb / 255) * 255; px[o + 3] = alpha * 255;
      }
    }
  }

  /* ---- overlay-проходи (на display ctx через tf) ---- */
  function drawWorms(C, shoreT) {                       // [8] хробачки на дні — і на сухому, і під водою
    const n = Math.round(S.worms * wormPts.length); if (!n) return;
    const sc = tf.dw / Wb;
    ctx.lineCap = "round";
    for (let k = 0; k < n; k++) {
      const p = wormPts[k], d = depthAtUV(p.u, p.v);
      if (d < 0.02) continue;                            // лише в межах ями
      const submerged = d > shoreT;
      const x = tf.dx + p.u * tf.dw, y = tf.dy + p.v * tf.dh;
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.a + Math.sin(clock * 0.0005 + p.ph) * 0.12); // ледь хитається
      const al = submerged ? 0.5 : 0.85;
      const L = 12 * sc * p.s, wig = 2.4 * sc, mt = clock * 0.0011; // майже статична хвиляста форма
      // тіло — приглушений бурий (близько до кольору дна)
      ctx.strokeStyle = `rgba(${96 * C.amb | 0},${68 * C.amb | 0},${50 * C.amb | 0},${al})`; ctx.lineWidth = 2.8 * sc;
      ctx.beginPath();
      for (let j = 0; j <= 7; j++) { const t = j / 7, ax = (t - 0.5) * L, ay = Math.sin(t * 11 + mt + p.ph) * wig; j ? ctx.lineTo(ax, ay) : ctx.moveTo(ax, ay); }
      ctx.stroke();
      // мʼякий блік згори
      ctx.strokeStyle = `rgba(${146 * C.amb | 0},${114 * C.amb | 0},${84 * C.amb | 0},${al * 0.5})`; ctx.lineWidth = 1.0 * sc;
      ctx.beginPath();
      for (let j = 0; j <= 7; j++) { const t = j / 7, ax = (t - 0.5) * L, ay = Math.sin(t * 11 + mt + p.ph) * wig - 0.8 * sc; j ? ctx.lineTo(ax, ay) : ctx.moveTo(ax, ay); }
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawDuck(C, shoreT) {                         // [7a] ряска — дрібні цятки розсипами
    const n = Math.round(S.duckweed * duckPts.length); if (!n) return;
    const sc = tf.dw / Wb;
    for (let k = 0; k < n; k++) {
      const p = duckPts[k]; if (depthAtUV(p.u, p.v) <= shoreT) continue;
      const x = tf.dx + p.u * tf.dw + Math.sin(clock * 0.001 + p.ph) * 1.2;
      const y = tf.dy + p.v * tf.dh + Math.cos(clock * 0.0012 + p.ph) * 0.8;
      ctx.fillStyle = p.t
        ? `rgba(${118 * C.amb | 0},${158 * C.amb | 0},${78 * C.amb | 0},0.9)`   // світліші вкраплення
        : `rgba(${64 * C.amb | 0},${108 * C.amb | 0},${46 * C.amb | 0},0.9)`;
      ctx.beginPath(); ctx.arc(x, y, (0.7 + p.s * 0.7) * sc, 0, 6.283); ctx.fill();
    }
  }
  function drawLeaves(C, shoreT) {                       // [7b] листя — дрейфує на поверхні
    const n = Math.round(S.leaves * leafPts.length); if (!n) return;
    const sc = tf.dw / Wb;
    for (let k = 0; k < n; k++) {
      const p = leafPts[k];
      let u = p.u + clock * 0.0000045 * p.dr; u = ((u % 1) + 1) % 1;
      if (depthAtUV(u, p.v) <= shoreT) continue;
      const x = tf.dx + u * tf.dw, y = tf.dy + p.v * tf.dh + Math.sin(clock * 0.0016 + p.ph) * 2;
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.a + Math.sin(clock * 0.0012 + p.ph) * 0.2);
      ctx.fillStyle = `rgba(${96 * C.amb | 0},${112 * C.amb | 0},${56 * C.amb | 0},0.92)`;
      ctx.beginPath(); ctx.ellipse(0, 0, 6 * sc * p.s, 3 * sc * p.s, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = `rgba(${52 * C.amb | 0},${72 * C.amb | 0},${36 * C.amb | 0},0.8)`;
      ctx.lineWidth = 0.8 * sc; ctx.beginPath(); ctx.moveTo(-6 * sc * p.s, 0); ctx.lineTo(6 * sc * p.s, 0); ctx.stroke();
      ctx.restore();
    }
  }
  function updRain(dt, shoreT) {                         // [5] дощові кола — пул крапель
    if (S.rain) {
      rainAcc += dt * S.rain * 0.08;
      while (rainAcc > 1) {
        rainAcc -= 1;
        let u, v, d, tries = 0;
        // спавн ближче до центру і лише в глибшій воді — щоб кільця не вилазили за край
        do { u = 0.5 + (Math.random() - 0.5) * 0.6; v = 0.5 + (Math.random() - 0.5) * 0.54; d = depthAtUV(u, v); tries++; } while (d <= shoreT + 0.14 && tries < 8);
        if (d > shoreT + 0.14) rainPool.push({ u, v, t0: clock, s: 0.5 + Math.random() * 0.8, life: 600 + Math.random() * 350 });
      }
    }
    for (let i = rainPool.length - 1; i >= 0; i--) if (clock - rainPool[i].t0 > rainPool[i].life) rainPool.splice(i, 1);
    if (rainPool.length > 90) rainPool.splice(0, rainPool.length - 90);
  }
  function drawRain() {
    if (!rainPool.length) return;
    const sc = tf.dw / Wb;
    for (const dp of rainPool) {
      const t = (clock - dp.t0) / dp.life, e = 1 - (1 - t) * (1 - t); // easeOut
      const x = tf.dx + dp.u * tf.dw, y = tf.dy + dp.v * tf.dh;
      const persp = 0.55 + dp.v * 0.95;                  // ближче (нижче) — більші кільця
      const rad = (2 + e * 15 * dp.s) * persp * sc, ry = rad * 0.5; // менші компактніші еліпси
      ctx.strokeStyle = `rgba(226,239,250,${(1 - t) * 0.52})`; ctx.lineWidth = 1 * sc; // щільніші (менша прозорість)
      ctx.beginPath(); ctx.ellipse(x, y, rad, ry, 0, 0, 6.283); ctx.stroke();
      if (t > 0.28) { ctx.strokeStyle = `rgba(226,239,250,${(1 - t) * 0.28})`; ctx.beginPath(); ctx.ellipse(x, y, rad * 0.55, ry * 0.55, 0, 0, 6.283); ctx.stroke(); } // друге кільце
      if (t < 0.16) { const sp = (0.16 - t) / 0.16; ctx.fillStyle = `rgba(242,248,255,${sp * 0.7})`; ctx.beginPath(); ctx.ellipse(x, y, 2 * sc * persp, 1.2 * sc * persp, 0, 0, 6.283); ctx.fill(); } // сплеск
    }
  }
  function drawMist() {                                  // [10] туман/пара — поверх усього
    if (!S.mist) return;
    const sc = tf.dw / Wb, n = Math.round(2 + S.mist * 6), col = S.night > 0.4 ? "200,215,235" : "236,239,243";
    for (let k = 0; k < n; k++) {
      const u = 0.2 + 0.6 * ((k / n + clock * 0.00002 * (1 + (k & 1))) % 1);
      const rise = (clock * 0.00003 + k * 0.13) % 1;
      const x = tf.dx + u * tf.dw, y = tf.dy + (0.8 - rise * 0.5) * tf.dh, r = (40 + k * 10) * sc, a = S.mist * 0.10 * (1 - rise);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
  }

  function render(dt) {
    clock += dt;
    S.fill += (S.target - S.fill) * (1 - Math.exp(-dt * 0.006)); // плавний ease
    if (!ready()) return;

    // ненав'язливі фонові брижі
    if (clock - lastIdle > 2800) {
      lastIdle = clock; const a = (clock * 0.013) % 6.283;
      ripples.push({ x: 0.46 * Wb + Math.cos(a) * Wb * 0.1, y: 0.6 * Hb + Math.sin(a) * Hb * 0.07, t0: clock, amp: 2.0 });
    }

    const C = dayCols(S.time), L = S.fill, shoreT = 1 - Math.min(L, 0.98); // макс 98% — запас над шумом фону карти
    const ws = lerp(0.25, 2.4, S.windSpeed);              // глобальний темп: смуги/блиск/хмари
    const drift = clock * 0.00004 * 3 * ws;               // дрейф хмар у відображенні — від швидкості вітру
    // світила: сонце видиме вдень, місяць — вночі (взаємодоповнюються; на сутінках/світанку крос-фейд)
    const day = smooth(0.13, 0.22, S.time) * smooth(0.88, 0.79, S.time); // 1 удень, 0 вночі
    const bodies = [];
    { // сонце
      const alt = Math.max(0, Math.sin(Math.PI * S.time));
      if (day > 0.02) bodies.push({ x: lerp(0.20, 0.80, S.time), rv: lerp(0.12, 0.55, alt), vext: lerp(0.40, 0.16, alt), vis: day, col: [255, lerp(150, 250, alt), lerp(88, 232, alt)] });
    }
    { // місяць (протифаза)
      const mt = (S.time + 0.5) % 1, alt = Math.max(0, Math.sin(Math.PI * mt)), mv = 1 - day;
      if (mv > 0.02) bodies.push({ x: lerp(0.20, 0.80, mt), rv: lerp(0.12, 0.55, alt), vext: lerp(0.40, 0.16, alt), vis: mv, col: [222, 230, 246] });
    }
    const RP = [];
    for (const rp of ripples) {
      const age = clock - rp.t0, dec = Math.exp(-age * 0.0014) * rp.amp;
      if (dec < 0.04) continue;
      const rad = age * 0.05, ri = Math.max(0, rad - 46), ro = rad + 46;
      RP.push({ x: rp.x, y: rp.y, rad, dec, ri2: ri * ri, ro2: ro * ro });
    }

    renderWater(C, shoreT, drift, RP, bodies, ws);
    for (let i = ripples.length - 1; i >= 0; i--) if (clock - ripples[i].t0 > 2200) ripples.splice(i, 1);
    updRain(dt, shoreT);
    bctx.putImageData(img, 0, 0);

    // композит: фон → ніч → [хробачки під водою] → вода → [ряска/листя/дощ] → грейд → [туман]
    const { dx, dy, dw, dh } = tf;
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bgDay, dx, dy, dw, dh);
    if (S.night > 0.01) { ctx.globalAlpha = S.night; ctx.drawImage(bgNight, dx, dy, dw, dh); ctx.globalAlpha = 1; }
    if (S.worms) drawWorms(C, shoreT);
    ctx.drawImage(buf, dx, dy, dw, dh);
    if (S.duckweed) drawDuck(C, shoreT);
    if (S.leaves) drawLeaves(C, shoreT);
    if (rainPool.length) drawRain();
    const gr = C.grade, gstr = 1 - 0.6 * S.night; // нічний фон уже темний — не подвоювати грейд
    const rr = lerp(255, gr[0], gstr), gg = lerp(255, gr[1], gstr), bb = lerp(255, gr[2], gstr);
    if (rr < 254 || gg < 254 || bb < 254) {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
      ctx.fillRect(0, 0, CW, CH);
      ctx.globalCompositeOperation = "source-over";
    }
    if (S.mist) drawMist();
  }

  /* ---- lifecycle ---- */
  let raf = 0, running = false, last = 0, pendingOnce = false, fcap = 0;
  function loop(ts) {
    if (!running) return;
    const dt = Math.min(50, ts - last || 16); last = ts;
    if (!document.hidden) {
      if (S.lowGfx) { fcap += dt; if (fcap >= 32) { render(fcap); fcap = 0; } } // кеп ~30fps
      else render(dt);
    }
    raf = requestAnimationFrame(loop);
  }
  function start() { if (running) return; running = true; last = 0; pendingOnce = false; raf = requestAnimationFrame(loop); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  // намалювати ОДИН статичний кадр на паузі (напр. у вівтарі/після рефрешу). Якщо зображення
  // ще не завантажились — запам'ятовуємо намір і малюємо, щойно вони будуть готові (tryStatic).
  function renderOnce() {
    if (running) return;
    S.fill = S.target; // без плавного ease — одразу цільовий рівень води
    if (ready()) { render(0); pendingOnce = false; }
    else pendingOnce = true;
  }
  function tryStatic() { if (pendingOnce && !running && ready()) { S.fill = S.target; render(0); pendingOnce = false; } }
  function onVis() { last = 0; } // уникнути стрибка dt після повернення вкладки
  document.addEventListener("visibilitychange", onVis);

  function destroy() {
    stop();
    document.removeEventListener("visibilitychange", onVis);
    bgDay.onload = bgNight.onload = mapImg.onload = null;
    bgDay.onerror = bgNight.onerror = mapImg.onerror = null;
    buf = bctx = img = px = depth = null;
  }

  // старт завантаження
  bgDay.onload = () => { dayOk = true; computeCover(); tryStatic(); };
  bgNight.onload = () => { nightOk = true; tryStatic(); };
  mapImg.onload = () => { buildDepth(); tryStatic(); };
  bgDay.onerror = bgNight.onerror = mapImg.onerror = fail;
  bgDay.src = bgDayUrl; bgNight.src = bgNightUrl; mapImg.src = mapUrl;

  return { setParams, addRipple, resize, start, stop, renderOnce, destroy };
}
