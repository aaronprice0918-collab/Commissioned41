"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Animated number — counts up from 0 on mount, and tweens to the new value on
// change (so the paycheck "climbs" when a deal is added). Reduced-motion → snaps.
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  durationMs = 950,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const shown = from + (value - from) * easeOut(t);
      // Track the DISPLAYED value every frame — committing only on completion
      // made a mid-flight value change restart from the previous SETTLED
      // number, visibly snapping backwards before re-climbing (July 8 audit).
      fromRef.current = shown;
      setDisplay(shown);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return <span className={clsx("tabnum", className)}>{format(display)}</span>;
}

// Animated SVG progress ring. The arc sweeps to its value on mount / change via
// a CSS transition. Optional center content (e.g. a CountUp %).
export function ProgressRing({
  pct,
  size = 72,
  stroke = 7,
  className,
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
    setReduced(prefersReducedMotion());
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const value = shown || reduced ? clamped : 0;
  const offset = c * (1 - value / 100);
  const done = clamped >= 100;

  return (
    <div className={clsx("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--fg) / 0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? "rgb(var(--good))" : "rgb(var(--accent))"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{
            transition: reduced ? "none" : "stroke-dashoffset 1.1s cubic-bezier(0.2,0.8,0.2,1), stroke 0.4s",
            filter: `drop-shadow(0 0 6px ${done ? "rgb(var(--good) / 0.6)" : "rgb(var(--accent) / 0.55)"})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
