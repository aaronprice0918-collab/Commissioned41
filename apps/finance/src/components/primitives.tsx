"use client";

import { useEffect, useRef, useState } from "react";

/** Count-up that respects reduced motion and eases out. */
export function AnimatedNumber({
  value,
  format,
  durationMs = 1100,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const timeout = window.setTimeout(() => setDisplay(value), 0);
      return () => window.clearTimeout(timeout);
    }
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setDisplay(from + (value - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return <span className="num">{format(display)}</span>;
}

export function Card({
  children,
  className = "",
  delay = 0,
  hover = true,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  hover?: boolean;
}) {
  return (
    <div
      className={`glass rise ${hover ? "glass-hover" : ""} ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">
      {children}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "watch" | "stop" | "accent";
}) {
  const map: Record<string, string> = {
    neutral: "bg-white/5 text-[var(--text-dim)] border-white/10",
    good: "bg-[var(--good)]/12 text-[var(--good)] border-[var(--good)]/25",
    watch: "bg-[var(--watch)]/12 text-[var(--watch)] border-[var(--watch)]/25",
    stop: "bg-[var(--stop)]/12 text-[var(--stop)] border-[var(--stop)]/25",
    accent: "bg-[var(--accent)]/15 text-[var(--accent-soft)] border-[var(--accent)]/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: "good" | "watch" | "stop" | "accent" | "neutral" }) {
  const c: Record<string, string> = {
    good: "var(--good)",
    watch: "var(--watch)",
    stop: "var(--stop)",
    accent: "var(--accent)",
    neutral: "var(--text-faint)",
  };
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: c[tone], boxShadow: `0 0 8px ${c[tone]}` }}
    />
  );
}
