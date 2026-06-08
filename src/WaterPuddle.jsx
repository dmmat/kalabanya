import { useEffect, useRef } from "react";
import { createWaterRenderer } from "./water/waterRenderer.js";

// Тонкий React-врапер над процедурним водяним рендером.
// Керується живими props (fill 0..1, tod 0..1, night 0..1); брижі — з fxEvents гри.
export default function WaterPuddle({
  fill, tod, night = 0, active = true, fxEvents = [],
  bgDayUrl, bgNightUrl, mapUrl, cloud = 0.5, wave = 0.35, onError,
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const seenFxRef = useRef(new Set());

  // створення/знищення рендера + ресайз-спостерігач
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = createWaterRenderer(canvas, { bgDayUrl, bgNightUrl, mapUrl, onError });
    rendererRef.current = r;

    const parent = canvas.parentElement || canvas;
    const doResize = () => {
      const rect = parent.getBoundingClientRect();
      if (rect.width && rect.height) {
        r.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      }
    };
    doResize();
    const ro = new ResizeObserver(doResize);
    ro.observe(parent);

    r.setParams({ fill, tod, night, cloud, wave });
    if (active) r.start();

    return () => { ro.disconnect(); r.destroy(); rendererRef.current = null; };
    // навмисно лише по URL-ах: зміна арту = новий рендер; решта йде через окремі ефекти
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgDayUrl, bgNightUrl, mapUrl]);

  // живі параметри — без рестарту rAF
  useEffect(() => {
    rendererRef.current?.setParams({ fill, tod, night, cloud, wave });
  }, [fill, tod, night, cloud, wave]);

  // пауза/старт за фазою гри
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (active) r.start(); else r.stop();
  }, [active]);

  // брижі з існуючого клік-пайплайну (fx: {id, amt, x%, y%})
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !fxEvents) return;
    const seen = seenFxRef.current;
    for (const f of fxEvents) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      r.addRipple(f.x / 100, f.y / 100, 3 + Math.min(f.amt || 0, 6) * 0.4);
    }
    // тримати множину компактною
    if (seen.size > 64) {
      const keep = new Set(fxEvents.map(f => f.id));
      seenFxRef.current = keep;
    }
  }, [fxEvents]);

  return <canvas ref={canvasRef} className="kal-water" />;
}
