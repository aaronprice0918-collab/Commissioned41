// ── Performance sources — the data-in seam ───────────────────────────────────
// A PerformanceSource maps a set of raw records for ONE person in ONE pay period
// into the engine's inputs (Performance + optional per-deal DealRow[]). This is
// what lets the SAME engine serve any industry: automotive deals, a staffing
// agency's placement rows, a SaaS AE's bookings, or a plain spreadsheet export —
// each just decides how its records become metrics.
import type { DealRow, Performance } from "./payEngine";

export type PerformanceSource<Rec = unknown> = {
  id: string;
  label: string;
  toPerformance(records: Rec[], ctx?: Record<string, unknown>): Performance;
  toDealRows?(records: Rec[], ctx?: Record<string, unknown>): DealRow[];
};

// Derived ratio metric: key = (sum[num] / sum[den]) × (scale ?? 1). Lets a CSV of
// raw counts produce the ratio/percent metrics a grid or tier reads — e.g.
// pvr = backGross/units, attachPct = products/units × 100.
export type DerivedMetric = { key: string; num: string; den: string; scale?: number };

type ManualRec = Record<string, number | string>;

// Coerce a spreadsheet/manual value: numbers stay numbers, numeric strings become
// numbers, everything else (categories like "New") stays a string. Empty → string.
function coerce(v: number | string): number | string {
  if (typeof v === "number") return v;
  const n = Number(v);
  return v !== "" && Number.isFinite(n) ? n : v;
}

// The generic source. Records are already-mapped metric rows — what EILA produces
// after mapping a spreadsheet's columns to the plan's metric keys, or a manual
// per-period entry. Numeric fields are SUMMED across rows; derived ratios are
// computed from those sums; each row also becomes a DealRow for per-deal plans.
export function manualSource(opts?: { derived?: DerivedMetric[] }): PerformanceSource<ManualRec> {
  return {
    id: "manual",
    label: "Manual / spreadsheet import",
    toPerformance(records) {
      const perf: Performance = {};
      for (const row of records) {
        for (const [k, v] of Object.entries(row)) {
          const n = typeof v === "number" ? v : Number(v);
          if (v !== "" && Number.isFinite(n)) perf[k] = (perf[k] ?? 0) + n;
        }
      }
      for (const d of opts?.derived ?? []) {
        const den = perf[d.den] ?? 0;
        perf[d.key] = den ? ((perf[d.num] ?? 0) / den) * (d.scale ?? 1) : 0;
      }
      return perf;
    },
    toDealRows(records) {
      return records.map((row) => {
        const out: DealRow = {};
        for (const [k, v] of Object.entries(row)) out[k] = coerce(v);
        return out;
      });
    },
  };
}
