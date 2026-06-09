/* AUTO-EXTRACTED from App.jsx — small presentational atoms. */
import { useState } from "react";

// renders an optional image; if the file is missing it simply disappears (graceful fallback)
function SafeImg({ src, className, alt = "", style }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img className={className} src={src} alt={alt} style={style} draggable={false} onError={() => setOk(false)} />;
}

function Stat({ l, v, c }) {
  return <div><div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>{l}</div><div className="kal-num" style={{ fontSize: 16, color: c }}>{v}</div></div>;
}
function ResStat({ l, v, hi }) {
  return <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", textAlign: "left" }}><div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{l}</div><div className="kal-num" style={{ fontSize: 20, color: hi ? "var(--essence)" : "var(--ink)" }}>{v}</div></div>;
}

export { SafeImg, Stat, ResStat };
