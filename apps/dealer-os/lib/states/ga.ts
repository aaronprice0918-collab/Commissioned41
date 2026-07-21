import { type StateTaxProfile } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// GEORGIA — VERIFIED. Self-contained; do not import another state here.
// These are the exact values the desk + lease engines used before the
// multi-state refactor, verified against real Kennesaw Mazda deals (June 2026).
// Locked in: change Georgia ONLY by editing this file.
// ─────────────────────────────────────────────────────────────────────────
export const GA: StateTaxProfile = {
  code: "GA",
  name: "Georgia",
  status: "verified",
  verifiedAt: "2026-06-24",
  verifiedBy: "Aaron Price",

  retail: {
    ratePct: 7, // Georgia TAVT — a one-time title ad valorem tax on the price
    label: "TAVT",
    tradeCredit: "full", // GA credits the full trade value against the taxable amount
    taxableIncludesDocFee: true, // taxed base = selling price + doc fee
    // O.C.G.A. §48-5C-1 (confirmed vs GA DOR guidance, July 2026): a NEW
    // vehicle's TAVT base is the selling price LESS trade-in AND LESS any
    // rebate/cash discount — e.g. $40,000 with a $2,000 rebate taxes $38,000.
    // The engine previously taxed the rebate (~$140 overquote on that deal).
    rebateReducesTaxable: "new",
  },

  lease: {
    method: "payment_sum", // tax (base payment × term) × 7%, leased portion only
    ratePct: 7,
  },

  fees: {
    docFee: 899,
    docFeeCap: null, // GA does not cap the doc fee
    electronicTitleFee: 199,
    titleFee: 18,
    registrationFee: 25,
    lemonLawFeeNew: 3,
  },
};
