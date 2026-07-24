"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useMission } from "@/lib/store";
import { useAskIla } from "./AppShell";
import { forecast, dealTotals, isProductOnly } from "@/lib/engine";
import { vscIdOf } from "@/lib/fni";
import { INDUSTRY_UNIT } from "@/lib/types";

// Your daily sales tracker — the individual version of Aaron's Kennesaw
// "DAILY SALES TRACKER" sheet: the four numbers a rep lives by (Total · %
// Goal · Still Need · Pace) over a month calendar of units-per-day, with a
// weekly target line and per-week totals. Same board he already trusts, now
// personal and live in EILA, so the 10-second answer to "where am I this
// month" is the first thing on the page.

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function DailyTracker() {
  const { data } = useMission();
  const askIla = useAskIla();
  const profile = data.profile!;
  const plan = profile.plan;
  const unit = INDUSTRY_UNIT[profile.industry];
  const daysOff = profile.daysOff ?? [];

  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(t);
  }, []);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const f = useMemo(() => forecast(plan, data.deals, now, daysOff, vscIdOf(profile)), [plan, data.deals, daysOff]); // eslint-disable-line react-hooks/exhaustive-deps

  // Units per day-of-month (vehicle units only — product-only deals sell no car
  // and never count toward the daily board, same rule as everywhere else).
  const byDay = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of f.counted) {
      if (isProductOnly(d)) continue;
      const day = new Date(d.date).getDate();
      m.set(day, (m.get(day) ?? 0) + 1);
    }
    return m;
  }, [f.counted]);

  const goal = plan.goalUnits || 0;
  const total = useMemo(() => dealTotals(f.counted).units, [f.counted]);
  const weeklyTarget = goal ? (goal * 7) / daysInMonth : 0;
  const pctGoal = goal ? Math.round((total / goal) * 100) : 0;
  const stillNeed = Math.max(0, goal - total);
  const pace = f.paceUnits;

  // Calendar grid, Sunday-first, padded to whole weeks.
  const weeks = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const cells: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [year, month, daysInMonth]);

  const weekTotals = useMemo(
    () => weeks.map((w) => w.reduce<number>((s, day) => s + (day ? byDay.get(day) ?? 0 : 0), 0)),
    [weeks, byDay],
  );

  const paceTone = !goal ? "text-fg/70" : pace >= goal ? "text-good" : "text-warn";

  return (
    <button
      onClick={() =>
        askIla(
          `Walk me through my daily sales tracker for ${monthName}: units per day, this week vs my weekly target, and exactly what daily pace I need to hit ${goal || "my goal"} ${unit.plural}.`,
        )
      }
      className="glass rise block w-full p-4 text-left active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65">
          <CalendarDays size={13} /> Your month · {monthName}
        </div>
        <span className="rounded-full bg-fg/6 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fg/55">daily tracker</span>
      </div>

      {/* The four numbers from the sheet */}
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <StatTile label="Total" value={`${round1(total)}`} tone="text-fg" />
        <StatTile label="% Goal" value={goal ? `${pctGoal}%` : "—"} tone={pctGoal >= 100 ? "text-good" : "text-fg"} />
        <StatTile label="Still Need" value={goal ? `${round1(stillNeed)}` : "—"} tone={stillNeed === 0 && goal ? "text-good" : "text-fg"} />
        <StatTile label="Pace" value={`${round1(pace)}`} tone={paceTone} />
      </div>

      {goal > 0 && (
        <div className="mt-2 text-[11px] text-fg/55">
          Goal <b className="text-fg/80 tabnum">{goal}</b> {unit.plural} · weekly target <b className="text-fg/80 tabnum">{weeklyTarget.toFixed(1)}</b>
        </div>
      )}

      {/* Weekday header */}
      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-semibold uppercase text-fg/40">{d}</div>
        ))}
      </div>

      {/* Calendar grid + a per-week total rail */}
      <div className="mt-1 space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex items-stretch gap-1.5">
            <div className="grid flex-1 grid-cols-7 gap-1">
              {week.map((day, di) => {
                if (day === null) return <div key={di} />;
                const u = byDay.get(day) ?? 0;
                const weekday = new Date(year, month, day).getDay();
                const off = daysOff.includes(weekday);
                const isToday = day === today;
                const isFuture = day > today;
                return (
                  <div
                    key={di}
                    className={[
                      "relative flex aspect-square flex-col items-center justify-center rounded-md text-center transition-colors",
                      isToday ? "ring-1 ring-accent" : "",
                      cellBg(u, off, isFuture, on),
                    ].join(" ")}
                  >
                    <span className="absolute left-1 top-0.5 text-[8px] font-semibold text-fg/35 tabnum">{day}</span>
                    {u > 0 ? <span className={`text-[13px] font-black tabnum ${u >= 2 ? "text-good" : "text-accent2"}`}>{round1(u)}</span> : null}
                  </div>
                );
              })}
            </div>
            {/* Week total vs weekly target — his WK / WK TGT columns */}
            <div
              className={[
                "flex w-11 shrink-0 flex-col items-center justify-center rounded-md px-1 text-center",
                goal && weekTotals[wi] >= weeklyTarget ? "bg-good/12" : "bg-fg/[0.04]",
              ].join(" ")}
            >
              <span className={`text-[12px] font-black tabnum ${goal && weekTotals[wi] >= weeklyTarget ? "text-good" : "text-fg/70"}`}>{round1(weekTotals[wi])}</span>
              {goal > 0 && <span className="text-[8px] text-fg/40 tabnum">/ {weeklyTarget.toFixed(1)}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 text-[11px] leading-snug text-fg/45">
        {goal > 0
          ? pace >= goal
            ? `On pace for ${round1(pace)} — ahead of your ${goal} goal. Tap for EILA to walk your week.`
            : `On pace for ${round1(pace)} of ${goal}. Tap and EILA gives you the daily number to catch up.`
          : "Set a monthly goal and this board tracks your pace to it. Tap to ask EILA."}
      </div>
    </button>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg bg-fg/[0.04] px-1 py-2 text-center">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-fg/45">{label}</div>
      <div className={`mt-0.5 text-[17px] font-black leading-none tabnum ${tone}`}>{value}</div>
    </div>
  );
}

// Day-cell background: greener with more units, faint when empty, dimmed on a
// day off, barely-there in the future so the month's shape reads at a glance.
function cellBg(units: number, off: boolean, future: boolean, on: boolean): string {
  if (!on) return "bg-fg/[0.03]";
  if (units >= 2) return "bg-good/25";
  if (units >= 1) return "bg-accent/20";
  if (off) return "bg-fg/[0.015]";
  if (future) return "bg-fg/[0.02]";
  return "bg-fg/[0.05]";
}

// Split deals produce .5 units; show one decimal only when needed.
function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
