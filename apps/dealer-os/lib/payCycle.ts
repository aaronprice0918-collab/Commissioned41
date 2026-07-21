// ── Pay-cycle windows ────────────────────────────────────────────────────────
// Turns a plan's PayCycle (arbitrary: fixed-length, calendar-month, semi-monthly,
// quarterly, or explicit custom boundaries) into concrete period windows and the
// date the check for that period is actually issued. Pure + deterministic so the
// scorecard, EILA, and tests all agree. Dates are handled at local noon to dodge
// DST/timezone edges (matching how the rest of the app parses `deal.date`).
import type { PayCycle } from "./payEngine";

export type Period = {
  start: Date; // first calendar day of the earning window (local noon)
  end: Date; // last calendar day of the earning window (inclusive, local noon)
  label: string; // human label, e.g. "May 2026" or "May 1–15" or "May 5–18"
  payDate: Date; // when the check for this period is issued (earned-vs-paid)
};

const MS_DAY = 86_400_000;

// Parse "YYYY-MM-DD" (or any Date-ish) to a local-noon Date.
function atNoon(input: string | Date): Date {
  if (input instanceof Date) return new Date(input.getFullYear(), input.getMonth(), input.getDate(), 12);
  const [y, m, d] = String(input).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((atNoon(b).getTime() - atNoon(a).getTime()) / MS_DAY);
}
function endOfMonth(y: number, m: number): Date {
  return new Date(y, m + 1, 0, 12); // day 0 of next month = last day of this one
}
function monthName(d: Date, locale: string): string {
  return d.toLocaleString(locale, { month: "long", year: "numeric" });
}
// "May 1–15" style span within a month (or across months if needed).
function spanLabel(start: Date, end: Date, locale: string): string {
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  const mo = (d: Date) => d.toLocaleString(locale, { month: "short" });
  return sameMonth
    ? `${mo(start)} ${start.getDate()}–${end.getDate()}`
    : `${mo(start)} ${start.getDate()} – ${mo(end)} ${end.getDate()}`;
}

// The earning window (start/end) containing `on`, before the pay date is applied.
function windowFor(cycle: PayCycle, on: Date, locale: string): { start: Date; end: Date; label: string } {
  const day = atNoon(on);

  if (cycle.mode === "calendarMonth") {
    const start = new Date(day.getFullYear(), day.getMonth(), 1, 12);
    const end = endOfMonth(day.getFullYear(), day.getMonth());
    return { start, end, label: monthName(start, locale) };
  }

  if (cycle.mode === "quarterly") {
    const q = Math.floor(day.getMonth() / 3); // 0..3
    const start = new Date(day.getFullYear(), q * 3, 1, 12);
    const end = endOfMonth(day.getFullYear(), q * 3 + 2);
    return { start, end, label: `Q${q + 1} ${day.getFullYear()}` };
  }

  if (cycle.mode === "semiMonthly") {
    const [d1, d2] = cycle.semiMonthlyDays && cycle.semiMonthlyDays.length === 2 ? cycle.semiMonthlyDays : [1, 16];
    const [lo, hi] = d1 <= d2 ? [d1, d2] : [d2, d1];
    const dom = day.getDate();
    if (dom < lo) {
      // Before the first split → the trailing period of the previous month.
      const prev = new Date(day.getFullYear(), day.getMonth() - 1, 1, 12);
      const start = new Date(prev.getFullYear(), prev.getMonth(), hi, 12);
      const end = new Date(day.getFullYear(), day.getMonth(), lo - 1, 12);
      return { start, end, label: spanLabel(start, end, locale) };
    }
    if (dom < hi) {
      const start = new Date(day.getFullYear(), day.getMonth(), lo, 12);
      const end = new Date(day.getFullYear(), day.getMonth(), hi - 1, 12);
      return { start, end, label: spanLabel(start, end, locale) };
    }
    const start = new Date(day.getFullYear(), day.getMonth(), hi, 12);
    const end = endOfMonth(day.getFullYear(), day.getMonth());
    return { start, end, label: spanLabel(start, end, locale) };
  }

  if (cycle.mode === "custom") {
    const bounds = (cycle.customBoundaries ?? []).map(atNoon).sort((a, b) => a.getTime() - b.getTime());
    if (bounds.length) {
      let i = 0;
      for (let k = 0; k < bounds.length; k++) if (day.getTime() >= bounds[k].getTime()) i = k;
      const start = bounds[i];
      const next = bounds[i + 1];
      // Final boundary has no explicit next start → mirror the prior period length
      // (or 30 days if it's the only boundary) so the window is still deterministic.
      const end = next
        ? addDays(next, -1)
        : bounds[i - 1]
          ? addDays(start, daysBetween(bounds[i - 1], start) - 1)
          : addDays(start, 29);
      return { start, end, label: spanLabel(start, end, locale) };
    }
    // No boundaries given → degrade to calendar month rather than throw.
    const start = new Date(day.getFullYear(), day.getMonth(), 1, 12);
    return { start, end: endOfMonth(day.getFullYear(), day.getMonth()), label: monthName(start, locale) };
  }

  // fixedLength (default): tile `lengthDays` windows from the anchor.
  const len = Math.max(1, Math.round(cycle.lengthDays || 14));
  const anchor = atNoon(cycle.anchor || `${day.getFullYear()}-01-01`);
  const offset = daysBetween(anchor, day);
  const k = Math.floor(offset / len);
  const start = addDays(anchor, k * len);
  const end = addDays(start, len - 1);
  return { start, end, label: spanLabel(start, end, locale) };
}

// When the check for a closed period is issued.
function payDateFor(cycle: PayCycle, win: { start: Date; end: Date }): Date {
  if (cycle.payDayOfNextPeriod != null) {
    // Nth day COUNTED WITHIN the following period (uniform across modes).
    // The old month-anchored version paid semi-monthly first halves BEFORE
    // the period closed: Jun 1–15 with N=5 returned Jun 5. Now: Jun 20.
    // For calendarMonth/quarterly this is identical to "day N of next month".
    const nextStart = addDays(win.end, 1);
    return addDays(nextStart, Math.max(1, cycle.payDayOfNextPeriod) - 1);
  }
  if (cycle.payOffsetDays != null) return addDays(win.end, cycle.payOffsetDays);
  return win.end; // paid at period close
}

// The period (with pay date) containing `on`.
export function periodFor(cycle: PayCycle, on: Date, vocabLocale?: string): Period {
  const locale = vocabLocale || "en-US";
  const win = windowFor(cycle, on, locale);
  return { ...win, payDate: payDateFor(cycle, win) };
}

// Every period whose earning window overlaps [from, to], oldest first.
export function periodsBetween(cycle: PayCycle, from: Date, to: Date, vocabLocale?: string): Period[] {
  const out: Period[] = [];
  let cursor = atNoon(from);
  const end = atNoon(to);
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard++ < 5000) {
    const p = periodFor(cycle, cursor, vocabLocale);
    out.push(p);
    cursor = addDays(p.end, 1);
  }
  return out;
}

// Keep only the rows whose date falls inside the period's earning window.
export function filterToPeriod<T>(rows: T[], dateOf: (row: T) => string | undefined, period: Period): T[] {
  const lo = period.start.getTime();
  const hi = period.end.getTime();
  return rows.filter((row) => {
    const raw = dateOf(row);
    if (!raw) return false;
    const t = atNoon(raw).getTime();
    return t >= lo && t <= hi;
  });
}

// Default cycle = calendar month — the app's historical behavior.
export const CALENDAR_MONTH_CYCLE: PayCycle = { mode: "calendarMonth", periodNoun: "month" };

// A one-line, human summary of a cycle (for the Studio / plan review). Covers
// both how often it pays and the earned-vs-paid timing, in plain words.
export function describeCycle(cycle: PayCycle): string {
  let how: string;
  switch (cycle.mode) {
    case "fixedLength": {
      const n = cycle.lengthDays || 14;
      how = n === 7 ? "Pays weekly" : n === 14 ? "Pays every two weeks" : `Pays every ${n} days`;
      break;
    }
    case "semiMonthly": {
      const [a, b] = cycle.semiMonthlyDays ?? [1, 16];
      how = `Pays twice a month (periods start on the ${a}${ordinal(a)} & ${b}${ordinal(b)})`;
      break;
    }
    case "quarterly": how = "Pays quarterly"; break;
    case "custom": how = `Pays on ${(cycle.customBoundaries?.length ?? 0)} custom period${(cycle.customBoundaries?.length ?? 0) === 1 ? "" : "s"}`; break;
    case "calendarMonth":
    default: how = "Pays monthly (calendar month)"; break;
  }
  let when = "";
  if (cycle.payDayOfNextPeriod != null) when = `, check issued on day ${cycle.payDayOfNextPeriod} of the following period`;
  else if (cycle.payOffsetDays != null) when = `, check issued ${cycle.payOffsetDays} day${cycle.payOffsetDays === 1 ? "" : "s"} after each period closes`;
  return how + when + ".";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
