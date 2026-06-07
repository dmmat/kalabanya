import React, { useMemo } from "react";

/* =========================================================================
   SvgScene — повністю векторний живий пейзаж калабані.
   Небо за часом доби, хмари що пливуть (і відбиваються у воді), сонце/місяць
   по дузі, мерехтіння води, дощ/сніг. Декоративний шар (pointer-events:none) —
   тапи й логіка лишаються на батьківському .kal-stage.
   ========================================================================= */

const VW = 1000, VH = 460, HORIZON = 205;

// одна пухнаста хмара з кількох еліпсів
function Cloud({ x, y, s = 1, o = 0.9, color = "#ffffff", dur = 70, begin = 0, blur }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o} filter={blur ? "url(#cloudBlur)" : undefined}>
      <animateTransform attributeName="transform" type="translate" additive="sum"
        from={`${-VW - 280} 0`} to={`${VW + 280} 0`} dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
      <g fill={color}>
        <ellipse cx="0" cy="0" rx="60" ry="26" />
        <ellipse cx="42" cy="6" rx="46" ry="22" />
        <ellipse cx="-42" cy="8" rx="42" ry="20" />
        <ellipse cx="14" cy="-14" rx="34" ry="20" />
        <ellipse cx="-18" cy="-10" rx="30" ry="18" />
      </g>
    </g>
  );
}

export default function SvgScene({ todT, ratio, star, skyA, skyB, sunCol, sunT, weather, phase, rainN, snowN }) {
  const isNight = star > 0.45;
  const w = weather || {};
  const cloudColor = isNight ? "#9fb0cc" : "#ffffff";
  const cloudOpa = isNight ? 0.5 : 0.92;

  // sun / moon along the daily arc
  const sunX = 150 + todT * 700;
  const sunY = 60 + (1 - Math.sin(Math.PI * todT)) * 120;
  const sunR = 30 + sunT * 16;

  // puddle geometry from water ratio
  const cx = 500, cy = 332;
  const rx = 150 + ratio * 155;
  const ry = rx * 0.42;

  const stars = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    x: (i * 137.5) % VW, y: 14 + ((i * 53) % 150), r: 0.8 + (i % 3) * 0.5, d: 2 + (i % 4),
  })), []);

  const clouds = useMemo(() => ([
    { x: 120, y: 56, s: 1.05, dur: 88, begin: -10, blur: false },
    { x: 480, y: 38, s: 0.8, dur: 120, begin: -60, blur: true },
    { x: 720, y: 92, s: 1.25, dur: 70, begin: -30, blur: false },
    { x: 300, y: 120, s: 0.7, dur: 150, begin: -100, blur: true },
  ]), []);

  const rainCount = Math.min(rainN || 0, 40);
  const snowCount = Math.min(snowN || 0, 26);

  return (
    <svg className="kal-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skyA} />
          <stop offset="80%" stopColor={skyB} />
          <stop offset="100%" stopColor={skyB} />
        </linearGradient>
        <radialGradient id="sunGrad" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fff7e0" />
          <stop offset="55%" stopColor={sunCol} />
          <stop offset="100%" stopColor={sunCol} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="moonGrad" cx="38%" cy="36%" r="65%">
          <stop offset="0%" stopColor="#f4f7ff" />
          <stop offset="60%" stopColor="#cdd8ec" />
          <stop offset="100%" stopColor="#8b9bb5" />
        </radialGradient>
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skyB} />
          <stop offset="55%" stopColor={isNight ? "#0c1c2c" : "#1c4a5a"} />
          <stop offset="100%" stopColor={isNight ? "#06121c" : "#0c3340"} />
        </linearGradient>
        <radialGradient id="lightCol" cx="50%" cy="0%" r="90%">
          <stop offset="0%" stopColor={isNight ? "#fff3c8" : "#dff3ff"} stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="cloudBlur"><feGaussianBlur stdDeviation="4" /></filter>
        <clipPath id="puddleClip"><ellipse cx={cx} cy={cy} rx={rx} ry={ry} /></clipPath>
        <style>{`
          @keyframes svgrain { from { transform: translateY(-40px); } to { transform: translateY(${VH}px); } }
          @keyframes svgsnow { from { transform: translateY(-20px) translateX(0); } to { transform: translateY(${VH}px) translateX(26px); } }
          @keyframes svgtwinkle { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
          .svg-rain { stroke: ${cloudColor}; stroke-width: 2; opacity:.5; animation: svgrain linear infinite; }
          .svg-snow { fill: #eaf6fb; opacity:.85; animation: svgsnow linear infinite; }
          .svg-star { animation: svgtwinkle ease-in-out infinite; }
        `}</style>
      </defs>

      {/* sky */}
      <rect x="0" y="0" width={VW} height={VH} fill="url(#sky)" />

      {/* stars */}
      <g opacity={star}>
        {stars.map((s, i) => (
          <circle key={i} className="svg-star" cx={s.x} cy={s.y} r={s.r} fill="#ffffff" style={{ animationDuration: `${s.d}s`, animationDelay: `${(i % 5) * 0.4}s` }} />
        ))}
      </g>

      {/* sun (day) / moon (night) */}
      {!isNight && (
        <>
          <circle cx={sunX} cy={sunY} r={sunR * 2.4} fill="url(#sunGrad)" opacity={0.5 + sunT * 0.4} />
          <circle cx={sunX} cy={sunY} r={sunR} fill="#fff7e0" opacity={0.7 + sunT * 0.3} />
        </>
      )}
      {isNight && (
        <g opacity={star}>
          <circle cx="180" cy="80" r="60" fill="url(#moonGrad)" opacity="0.25" />
          <circle cx="180" cy="80" r="34" fill="url(#moonGrad)" />
        </g>
      )}

      {/* drifting clouds */}
      <g>{clouds.map((c, i) => <Cloud key={i} {...c} color={cloudColor} o={cloudOpa} />)}</g>

      {/* distant treeline */}
      <path d={`M0 ${HORIZON} q60 -26 130 -10 q70 16 150 -6 q90 -24 180 -4 q120 18 220 -10 q140 -20 240 -2 L${VW} ${HORIZON + 8} L${VW} ${VH} L0 ${VH} Z`}
        fill={isNight ? "#0c2230" : "#2c5f3a"} opacity={isNight ? 0.85 : 0.9} />

      {/* ground: grass verge, gravel rim, asphalt road */}
      <path d={`M0 ${HORIZON - 4} L360 ${HORIZON + 6} L150 ${VH} L0 ${VH} Z`} fill={isNight ? "#16361f" : "#3f7b3a"} />
      <path d={`M360 ${HORIZON + 6} L1000 ${HORIZON} L1000 ${VH} L150 ${VH} Z`} fill={isNight ? "#2a3138" : "#8a9098"} opacity={isNight ? 1 : 0.95} />
      <path d={`M330 ${HORIZON + 8} L420 ${HORIZON + 8} L300 ${VH} L120 ${VH} Z`} fill={isNight ? "#241a12" : "#6b5340"} opacity="0.9" />

      {/* streetlight pole + glow (right side) */}
      <g opacity={isNight ? 1 : 0.8}>
        <rect x="852" y="70" width="5" height="150" fill={isNight ? "#23303c" : "#6b6f74"} />
        <path d="M852 74 q-34 2 -38 28" fill="none" stroke={isNight ? "#23303c" : "#6b6f74"} strokeWidth="5" />
        {isNight && <circle cx="812" cy="104" r="22" fill="#ffe9a8" opacity="0.5" />}
        <circle cx="812" cy="104" r="6" fill={isNight ? "#fff3c8" : "#cfd2d6"} />
      </g>

      {/* puddle */}
      <g>
        {/* wet halo */}
        <ellipse cx={cx} cy={cy} rx={rx + 18} ry={ry + 12} fill={isNight ? "#0a1620" : "#23323a"} opacity="0.5" />
        {/* water base */}
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#water)" />
        {/* reflection layer (clipped) */}
        <g clipPath="url(#puddleClip)">
          {/* reflected sky tint */}
          <rect x="0" y={cy - ry} width={VW} height={ry * 2} fill="url(#sky)" opacity="0.5" />
          {/* reflected clouds, flipped + slower */}
          <g transform={`translate(0 ${cy * 2}) scale(1 -1)`} opacity={isNight ? 0.3 : 0.5}>
            {clouds.map((c, i) => <Cloud key={i} {...c} y={cy - 40 - (c.y * 0.18)} dur={c.dur * 1.5} color={cloudColor} o={cloudOpa} />)}
          </g>
          {/* light column reflection (sun or streetlight) */}
          <rect x={(isNight ? 812 : sunX) - 26} y={cy - ry} width="52" height={ry * 2} fill="url(#lightCol)">
            <animate attributeName="opacity" values="0.55;0.9;0.55" dur="3.5s" repeatCount="indefinite" />
          </rect>
          {/* shimmer lines */}
          {[0.25, 0.5, 0.72, 0.88].map((p, i) => (
            <rect key={i} x={cx - rx} y={cy - ry + ry * 2 * p} width={rx * 2} height="2.2" fill="#ffffff" opacity={isNight ? 0.18 : 0.28}>
              <animate attributeName="x" values={`${cx - rx};${cx - rx + 22};${cx - rx}`} dur={`${3 + i}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values={`0;${isNight ? 0.18 : 0.3};0`} dur={`${3 + i}s`} repeatCount="indefinite" />
            </rect>
          ))}
        </g>
        {/* wet rim + near highlight */}
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={isNight ? "#0a1c26" : "#123038"} strokeWidth="4" opacity="0.7" />
        <path d={`M${cx - rx * 0.7} ${cy + ry * 0.7} a${rx} ${ry} 0 0 0 ${rx * 1.4} 0`} fill="none" stroke="#bfeaf5" strokeWidth="2" opacity="0.35" />
        <ellipse cx={cx - rx * 0.32} cy={cy - ry * 0.4} rx={rx * 0.22} ry={ry * 0.16} fill="#ffffff" opacity={0.35 * ratio} />
      </g>

      {/* weather: rain / snow */}
      {phase === "playing" && Array.from({ length: rainCount }).map((_, i) => (
        <rect key={"r" + i} className="svg-rain" x={(i * 53) % VW} y="-20" width="2" height="16"
          style={{ animationDuration: `${0.5 + (i % 5) * 0.12}s`, animationDelay: `${(i % 7) * 0.13}s` }} />
      ))}
      {Array.from({ length: snowCount }).map((_, i) => (
        <circle key={"s" + i} className="svg-snow" cx={(i * 79) % VW} cy="-10" r="2.6"
          style={{ animationDuration: `${2.6 + (i % 4) * 0.7}s`, animationDelay: `${(i % 6) * 0.4}s` }} />
      ))}
    </svg>
  );
}
