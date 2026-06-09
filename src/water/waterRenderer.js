// Процедурна вода для калабані — Canvas2D, портовано з calushader/iso.html.
// Малює намальований фон ями (день/ніч) + воду в перспективі за картою глибини.
// Рівень води й час доби — параметри, не асети. Без React/DOM-UI.

/* ---- noise (спільний, детермінований) ---- */
const perm = new Uint8Array(512);
(() => {
  let s = 1337 >>> 0;
  const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
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

  // стан параметрів
  const S = { fill: 0.04, target: 0.04, time: 0.5, night: 0, cloud: 0.5, wave: 0.35 };
  const ripples = [];
  let clock = 0, lastIdle = 0;

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

  function buildDepth() {
    const nw = mapImg.naturalWidth || 2000, nh = mapImg.naturalHeight || 1445;
    Wb = BUF_W; Hb = Math.max(1, Math.round(BUF_W * nh / nw));
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
  }

  // xFrac,yFrac — частки стейджа (0..1); переводимо через інверсію cover-кропу
  function addRipple(xFrac, yFrac, amp) {
    if (!tf.dw) return;
    const fx = (xFrac * CW - tf.dx) / tf.dw;
    const fy = (yFrac * CH - tf.dy) / tf.dh;
    ripples.push({ x: fx * Wb, y: fy * Hb, t0: clock, amp: amp || 4 });
    if (ripples.length > 8) ripples.splice(0, ripples.length - 8);
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
    const drift = clock * 0.00004 * 3;
    const RP = [];
    for (const rp of ripples) {
      const age = clock - rp.t0, dec = Math.exp(-age * 0.0014) * rp.amp;
      if (dec < 0.04) continue;
      const rad = age * 0.05, ri = Math.max(0, rad - 46), ro = rad + 46;
      RP.push({ x: rp.x, y: rp.y, rad, dec, ri2: ri * ri, ro2: ro * ro });
    }

    for (let y = 0; y < Hb; y++) {
      const v = y / Hb, v0 = sat((v - vTop) / (vBot - vTop));
      for (let x = 0; x < Wb; x++) {
        const i = y * Wb + x, d = depth[i], o = i * 4;
        if (d <= shoreT) { px[o + 3] = 0; continue; } // суша/сухе дно — видно фон
        const below = d - shoreT;
        const psc = lerp(0.55, 1.55, v0);
        let dx = 0, dy = 0, ring = 0;
        dx += Math.sin(y * 0.20 * psc + clock * 0.0024) * 0.4;
        dy += Math.sin(x * 0.16 * psc - clock * 0.0019) * 0.4;
        dx += (fbm(x * 0.06 * psc + clock * 0.0006, y * 0.06 * psc, 2) - 0.5);
        for (let k = 0; k < RP.length; k++) {
          const r = RP[k], ex = x - r.x, ey = y - r.y, d2 = ex * ex + ey * ey;
          if (d2 < r.ri2 || d2 > r.ro2) continue;
          const dist = Math.sqrt(d2), band = Math.exp(-Math.abs(dist - r.rad) * 0.10) * r.dec;
          const s = Math.sin((dist - r.rad) * 0.45) * band; ring += s;
          const inv = dist > 0.1 ? s * 0.5 / dist : 0; dx += ex * inv; dy += ey * inv;
        }
        let sv = sat(1 - Math.pow(1 - v0, 1.7)); sv = sat(sv + (dy * 0.004 + ring * 0.003));
        let su = (x / Wb) + (dx * 0.01 + ring * 0.004) * 0.3 + drift;
        const r0 = lerp(C.hor[0], C.zen[0], sv), g0 = lerp(C.hor[1], C.zen[1], sv), b0 = lerp(C.hor[2], C.zen[2], sv);
        const cl = fbm(su * 2.4 + drift, (1 - sv) * 1.6 + 7, 3);
        const cm = Math.min(1, smooth(0.5, 0.78, cl) * smooth(0.03, 0.28, sv) * S.cloud * 1.3);
        let cr = lerp(r0, C.cloud[0], cm), cg = lerp(g0, C.cloud[1], cm), cb = lerp(b0, C.cloud[2], cm);
        const grR = smooth(0.14, 0, sv) * 0.7;
        cr = lerp(cr, C.grass[0] * 1.05, grR); cg = lerp(cg, C.grass[1] * 1.05, grR); cb = lerp(cb, C.grass[2] * 1.05, grR);
        cr *= C.amb * 0.95; cg *= C.amb * 0.95; cb *= C.amb * 0.95;
        const crest = sat(ring * 0.5), sheen = crest * crest * 0.13;
        cr += 235 * sheen; cg += 240 * sheen; cb += 245 * sheen;
        const reflect = smooth(0.0, 0.13, below);
        cr = lerp(20 * C.amb, cr, reflect); cg = lerp(18 * C.amb, cg, reflect); cb = lerp(17 * C.amb, cb, reflect);
        const alpha = lerp(0.5, 0.94, reflect);
        px[o] = sat(cr / 255) * 255; px[o + 1] = sat(cg / 255) * 255; px[o + 2] = sat(cb / 255) * 255; px[o + 3] = alpha * 255;
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) if (clock - ripples[i].t0 > 2200) ripples.splice(i, 1);

    bctx.putImageData(img, 0, 0);

    // композит: денний фон → нічний (кросфейд) → вода → грейд доби
    const { dx, dy, dw, dh } = tf;
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bgDay, dx, dy, dw, dh);
    if (S.night > 0.01) { ctx.globalAlpha = S.night; ctx.drawImage(bgNight, dx, dy, dw, dh); ctx.globalAlpha = 1; }
    ctx.drawImage(buf, dx, dy, dw, dh);
    const gr = C.grade, gstr = 1 - 0.6 * S.night; // нічний фон уже темний — не подвоювати грейд
    const rr = lerp(255, gr[0], gstr), gg = lerp(255, gr[1], gstr), bb = lerp(255, gr[2], gstr);
    if (rr < 254 || gg < 254 || bb < 254) {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
      ctx.fillRect(0, 0, CW, CH);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  /* ---- lifecycle ---- */
  let raf = 0, running = false, last = 0, pendingOnce = false;
  function loop(ts) {
    if (!running) return;
    const dt = Math.min(50, ts - last || 16); last = ts;
    if (!document.hidden) render(dt);
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
