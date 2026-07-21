// ── Dealership performance source ────────────────────────────────────────────
// The automotive implementation of PerformanceSource — it wraps the existing
// deal→metrics builders so the dealership is just one source among many (a
// staffing agency, a SaaS team, or a CSV import each supply their own). Behavior
// is unchanged: this only adapts buildPerformance/buildDealRows to the interface.
import { buildDealRows, buildPerformance } from "../buildPerformance";
import type { Deal } from "../data";
import type { PerformanceSource } from "../paySource";

type DealCtx = { role?: string; name?: string; menuMet?: boolean; csiMet?: boolean; csiMonthsBelow?: number; uncashedContracts?: number };

export const dealershipSource: PerformanceSource<Deal> = {
  id: "dealership",
  label: "Automotive dealership (deals)",
  toPerformance: (deals, ctx) => buildPerformance(deals, (ctx as DealCtx) ?? undefined),
  toDealRows: (deals, ctx) => buildDealRows(deals, (ctx as DealCtx)?.name),
};
