import { metricsFor, type Deal } from "@/lib/data";

// ── Close Month ──────────────────────────────────────────────────────────────
// The board holds ONE live month. "Close the month" archives the current month
// (every deal + a locked month-end summary) so it survives the roll to the next
// month — history, comps, year-over-year — then clears the board. The archive is
// the source of truth: we store the raw deals so any number can be recomputed
// later against the same tested engine, PLUS a frozen summary for fast display.

export type MonthSummary = {
  delivered: number;
  gross: number;
  front: number;
  back: number;
  financeGross: number;
  financePvr: number;
  pvr: number;
  ppu: number;
  newUnits: number;
  usedUnits: number;
  wholesaleUnits: number;
};

export type ClosedMonth = {
  id: string;
  monthKey: string; // YYYY-MM (local), the anchor month
  monthLabel: string; // "June 2026"
  closedAt: string; // ISO timestamp the month was closed
  closedByName: string; // who closed it
  dealCount: number;
  summary: MonthSummary;
  deals: Deal[]; // the full month, verbatim — recomputable against the engine
};

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// LOCAL month, matching lib/data.ts currentMonthPace: the label anchors to the
// LATEST deal date on the board (that's the month the whole app is reading),
// never a raw string slice (a UTC-stored date would shift an evening deal a day).
export function monthAnchor(deals: Deal[]): Date {
  const times = deals
    .map((d) => new Date(`${d.date}T12:00:00`).getTime())
    .filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)) : new Date();
}

export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabelOf(date: Date): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export function summarizeMonth(deals: Deal[]): MonthSummary {
  const m = metricsFor(deals); // the tested engine — never a re-implementation
  return {
    delivered: m.delivered,
    gross: m.gross,
    front: m.front,
    back: m.back,
    financeGross: m.financeGross,
    financePvr: m.financePvr,
    pvr: m.pvr,
    ppu: m.ppu,
    newUnits: m.newUnits,
    usedUnits: m.usedUnits,
    wholesaleUnits: m.wholesaleUnits,
  };
}

/** Build the archive snapshot for the deals currently on the board. */
export function buildClosedMonth(deals: Deal[], closedByName: string): ClosedMonth {
  const anchor = monthAnchor(deals);
  return {
    id: uid(),
    monthKey: monthKeyOf(anchor),
    monthLabel: monthLabelOf(anchor),
    closedAt: new Date().toISOString(),
    closedByName: closedByName || "—",
    dealCount: deals.length,
    summary: summarizeMonth(deals),
    deals: deals.map((d) => ({ ...d })), // detach from live state
  };
}

/** Append (or replace a same-month re-close), newest first. Re-closing the same
 * month key overwrites that archive instead of stacking a duplicate. */
export function upsertClosedMonth(existing: ClosedMonth[], next: ClosedMonth): ClosedMonth[] {
  const withoutSameMonth = existing.filter((c) => c.monthKey !== next.monthKey);
  return [next, ...withoutSameMonth].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}
