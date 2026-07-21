// ── Sales consultant pay — the per-deal commission + volume-bonus core ────────
// Sales reps are paid a flat by commissionable-front-gross band on NEW units, a
// percent (with a high-gross kicker and a floor) on USED, a flat mini on anything
// else, plus a monthly volume bonus off a units→bonus ladder. These two pure
// functions are the money-math heart of the scorecard's sales calc; they live
// here (not the page) so they are unit-testable in isolation and reused as a
// single source of truth.
import { commissionableFrontGross, type Deal } from "@/lib/data";
import type { SalesPlan } from "@/components/PayPlanProvider";

// Front-end commission for ONE delivered deal under the rep's plan.
export function salesCommissionForDeal(deal: Deal, plan: SalesPlan) {
  const payGross = commissionableFrontGross(deal);

  if (deal.vehicleClass === "New") {
    if (payGross >= plan.newHighMin) return plan.newHighFlat;
    if (payGross >= plan.newMidMin) return plan.newMidFlat;
    return plan.newMiniFlat;
  }

  if (deal.vehicleClass === "Used") {
    const percent = (payGross >= plan.usedHighMin ? plan.usedHighPct : plan.usedPct) / 100;
    return Math.max(payGross * percent, plan.usedMinCommission);
  }

  return plan.miniCommission;
}

// Monthly volume bonus for a unit count — highest qualifying tier wins (not
// stacked). The ladder is evaluated from the top down.
export function volumeBonus(units: number, plan: SalesPlan) {
  const ladder = [...plan.volumeTiers].sort((a, b) => b.units - a.units);
  for (const tier of ladder) {
    if (units >= tier.units) return tier.bonus;
  }
  return 0;
}
