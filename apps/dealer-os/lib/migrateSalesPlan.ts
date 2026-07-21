// ── Legacy SalesPlan → CompPlan ──────────────────────────────────────────────
// Converts a structured per-rep SalesPlan (authored in the admin editor, stored
// by PayPlanProvider) into a normalized CompPlan, so the SAME engine drives sales
// pay as every other role. It mirrors KENNESAW_SALES_COMP_PLAN's shape but reads
// the plan's OWN numbers, so a store's customized figures carry over exactly.
// This is the bridge that lets us retire the bespoke sales calc in a follow-up
// once engine parity is proven (the legacy path stays as a safety net until then).
//
// `type SalesPlan` is imported type-only, so this module has no runtime
// dependency on the client PayPlanProvider component.
import type { CompPlan, CompRule } from "./payEngine";
import type { SalesPlan } from "@/components/PayPlanProvider";

export function salesPlanToCompPlan(sales: SalesPlan, opts?: { id?: string; name?: string; role?: string }): { plan: CompPlan; notes: string[] } {
  const notes: string[] = [];
  // `bonusEligible` (a manager's rare monthly-bonus forfeiture) isn't an engine
  // concept — flag it rather than drop it silently.
  if (sales.bonusEligible === false) notes.push("This plan's monthly bonuses were marked forfeited (bonusEligible=false) — the engine doesn't model that gate; set it on the source month instead.");
  // fastStartByDay drives how buildPerformance counts fastStartUnits, not a rule.
  if (sales.fastStartByDay && sales.fastStartByDay !== 15) notes.push(`Fast-start cutoff is day ${sales.fastStartByDay}; make sure the performance source counts fast-start units by that day.`);

  const rules: CompRule[] = [
    {
      kind: "perDeal",
      value: "cgp",
      segmentBy: "vehicleClass",
      segments: {
        // New: flat by commissionable-front-gross band (highest qualifying min wins).
        New: { bands: [
          { min: sales.newHighMin, flat: sales.newHighFlat },
          { min: sales.newMidMin, flat: sales.newMidFlat },
          { min: -1e9, flat: sales.newMiniFlat },
        ] },
        // Used: percent of CGP, higher rate above a threshold, with a floor.
        Used: { pct: sales.usedPct, highMin: sales.usedHighMin, highPct: sales.usedHighPct, minFlat: sales.usedMinCommission },
      },
      default: { minFlat: sales.miniCommission }, // any other class → mini
      minFlat: sales.miniCommission,
    },
    // Monthly volume ladder (non-stacked; engine takes the highest qualifying tier).
    { kind: "tier", metric: "units", tiers: sales.volumeTiers.map((t) => ({ min: t.units, flat: t.bonus })) },
    // Finance PVR bonus: units AND back-PVR both clear their thresholds.
    { kind: "bonus", id: "finance", label: "Finance PVR bonus", when: [
      { metric: "units", op: ">=", value: sales.financeBonusUnits },
      { metric: "pvr", op: ">=", value: sales.financeBonusBackPvr },
    ], addFlat: sales.financeBonusAmount },
    // Fast start: enough units delivered by the cutoff day.
    { kind: "bonus", id: "faststart", label: "Fast Start", when: { metric: "fastStartUnits", op: ">=", value: sales.fastStartUnits }, addFlat: sales.fastStartAmount },
  ];

  const plan: CompPlan = {
    id: opts?.id ?? "sales-migrated",
    name: opts?.name ?? "Sales Consultant",
    role: opts?.role ?? "Sales",
    cycle: { mode: "calendarMonth", periodNoun: "month" },
    vocab: { currency: "USD", unitNoun: "unit", periodNoun: "month" },
    rules,
  };
  return { plan, notes };
}
