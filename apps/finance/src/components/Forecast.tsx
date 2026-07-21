"use client";

import { useState } from "react";
import type { ForecastPoint } from "@/lib/engine";
import { currency, shortDate } from "@/lib/format";

export function ForecastChart({ points }: { points: ForecastPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const w = 720;
  const h = 220;
  const padX = 8;
  const padY = 24;

  const balances = points.map((p) => p.balance);
  const min = Math.min(...balances, 0);
  const max = Math.max(...balances);
  const span = max - min || 1;

  const x = (i: number) => padX + (i / (points.length - 1)) * (w - padX * 2);
  const y = (b: number) => padY + (1 - (b - min) / span) * (h - padY * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${h - padY} L ${x(0).toFixed(1)} ${h - padY} Z`;

  const zeroY = y(0);
  const events = points.map((p, i) => ({ p, i })).filter((e) => e.p.event);
  const active = hover != null ? points[hover] : points[points.length - 1];

  return (
    <div>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">
            {hover != null ? shortDate(active.date) : "Projected month-end"}
          </div>
          <div className="num mt-0.5 text-2xl font-semibold">{currency(active.balance)}</div>
        </div>
        {active.event && (
          <div className="text-right text-xs text-[var(--text-dim)]">
            <span style={{ color: active.kind === "income" ? "var(--good)" : "var(--watch)" }}>●</span>{" "}
            {active.event}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        preserveAspectRatio="none"
        style={{ height: 220 }}
      >
        <defs>
          <linearGradient id="fcArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="fcLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent-soft)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>

        {/* zero line */}
        {min < 0 && (
          <line x1={padX} x2={w - padX} y1={zeroY} y2={zeroY} stroke="var(--stop)" strokeOpacity="0.35" strokeDasharray="4 5" />
        )}

        <path d={area} fill="url(#fcArea)" />
        <path d={line} fill="none" stroke="url(#fcLine)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* event markers */}
        {events.map((e) => (
          <circle
            key={e.i}
            cx={x(e.i)}
            cy={y(e.p.balance)}
            r="3.5"
            fill={e.p.kind === "income" ? "var(--good)" : "var(--watch)"}
            stroke="var(--bg)"
            strokeWidth="2"
          />
        ))}

        {/* hover hit areas */}
        {points.map((p, i) => (
          <rect
            key={i}
            x={x(i) - (w / points.length) / 2}
            y={0}
            width={w / points.length}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={padY} y2={h - padY} stroke="white" strokeOpacity="0.18" />
        )}
        {hover != null && (
          <circle cx={x(hover)} cy={y(points[hover].balance)} r="4.5" fill="white" stroke="var(--accent)" strokeWidth="2.5" />
        )}
      </svg>

      <div className="mt-2 flex justify-between text-[11px] text-[var(--text-faint)]">
        <span>{shortDate(points[0].date)}</span>
        <span>{shortDate(points[Math.floor(points.length / 2)].date)}</span>
        <span>{shortDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}
