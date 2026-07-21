import type { CompPlan } from "@/lib/payEngine";

// Kennesaw Mazda's sales-consultant plan expressed for the universal engine —
// the PROOF that a per-deal plan runs through the same engine as the F&I grid.
// Per-deal commission (New = flat by CGP band, Used = % of CGP with a high tier +
// mini) + the monthly volume ladder + the finance-PVR and fast-start bonuses.
// Numbers match the signed plan (and the verified calculateSalesPay).
export const KENNESAW_SALES_COMP_PLAN: CompPlan = {
  id: "kennesaw-sales-2025",
  name: "Sales Consultant — Kennesaw Mazda",
  role: "Sales",
  effectiveDate: "2025-08-01",
  sourceDoc: "Kennesaw Mazda Sales Pay Plan (signed)",
  cycle: { mode: "calendarMonth", periodNoun: "month" },
  vocab: { currency: "USD", unitNoun: "unit", periodNoun: "month" },
  rules: [
    {
      kind: "perDeal",
      value: "cgp",
      segmentBy: "vehicleClass",
      segments: {
        // New: $400 at CGP ≥ $1, $250 from −$300, $150 below (the −$1e9 floor band).
        New: { bands: [{ min: 1, flat: 400 }, { min: -300, flat: 250 }, { min: -1e9, flat: 150 }] },
        // Used: 25% of CGP, 30% at ≥ $3,000, $150 mini.
        Used: { pct: 25, highMin: 3000, highPct: 30, minFlat: 150 },
      },
      default: { minFlat: 150 }, // wholesale / other → $150 mini
      minFlat: 150,
    },
    // Monthly volume ladder (non-stacked — the engine takes the highest tier).
    { kind: "tier", metric: "units", tiers: [
      { min: 12, flat: 500 }, { min: 15, flat: 1000 }, { min: 18, flat: 1300 }, { min: 21, flat: 1600 }, { min: 24, flat: 1900 },
    ] },
    // Finance PVR bonus: ≥10 units AND back PVR ≥ $1,300 → $500 (AND = array of conditions).
    { kind: "bonus", id: "finance", label: "Finance PVR bonus", when: [{ metric: "units", op: ">=", value: 10 }, { metric: "pvr", op: ">=", value: 1300 }], addFlat: 500 },
    // Fast start: 7 units by the 15th → $500.
    { kind: "bonus", id: "faststart", label: "Fast Start", when: { metric: "fastStartUnits", op: ">=", value: 7 }, addFlat: 500 },
  ],
};
