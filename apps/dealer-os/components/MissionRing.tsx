"use client";

import { useEffect, useState } from "react";

// Animated progress ring for the Dealer command center. The arc sweeps to its
// value on mount / change via a CSS transition; gold normally, green when the
// goal is met. Center content (a count-up number) is passed as children.
// Reduced-motion safe. Uses the app's --mission-* tokens.
export function MissionRing({
  pct,
  size = 70,
  stroke = 6,
  className = "",
  children,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const [shown, setShown] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(
      typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    );
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const value = shown || reduced ? clamped : 0;
  const offset = c * (1 - value / 100);
  const done = clamped >= 100;
  const color = done ? "rgb(74 222 128)" : "rgb(var(--mission-gold))";

  return (
    <div className={`relative grid place-items-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{
            transition: reduced ? "none" : "stroke-dashoffset 1.1s cubic-bezier(0.2,0.8,0.2,1), stroke 0.4s",
            filter: `drop-shadow(0 0 5px ${done ? "rgb(74 222 128 / 0.6)" : "rgb(var(--mission-gold) / 0.6)"})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
