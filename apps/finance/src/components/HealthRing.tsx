"use client";

import { useEffect, useState } from "react";

export function HealthRing({
  score,
  size = 132,
  stroke = 11,
}: {
  score: number;
  size?: number;
  stroke?: number;
}) {
  const [shown, setShown] = useState(0);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const timeout = window.setTimeout(() => setShown(score), 0);
      return () => window.clearTimeout(timeout);
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / 1300, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(score * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const pct = shown / 100;
  const color = score >= 75 ? "var(--good)" : score >= 60 ? "var(--accent-soft)" : score >= 45 ? "var(--watch)" : "var(--stop)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-4xl font-semibold tracking-tight">{Math.round(shown)}</span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-faint)]">/ 100</span>
      </div>
    </div>
  );
}
