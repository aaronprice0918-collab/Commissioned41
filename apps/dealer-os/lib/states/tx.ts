import { type StateTaxProfile } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// TEXAS — IN REVIEW (NOT verified, cannot quote yet).
// Texas is a good stress-test of the engine because its LEASE tax is different
// in kind from Georgia's: TX taxes the full vehicle price upfront, not the
// payment stream. Rates null on purpose until verified.
// ─────────────────────────────────────────────────────────────────────────
export const TX: StateTaxProfile = {
  code: "TX",
  name: "Texas",
  status: "review",

  retail: {
    ratePct: null, // TODO verify: TX motor-vehicle sales tax commonly cited at 6.25%
    label: "Sales Tax",
    tradeCredit: "full", // TODO verify
    taxableIncludesDocFee: true, // TODO verify
    // TODO verify before this state is quotable (status "review" blocks quotes anyway).
    rebateReducesTaxable: "none",
  },

  lease: {
    method: "upfront_full_price", // TODO verify: TX taxes the full price upfront on a lease, not the payments
    ratePct: null,
  },

  fees: {
    docFee: 150, // TODO verify; TX historically caps doc fees low
    docFeeCap: null, // TODO verify the current cap
    electronicTitleFee: 0,
    titleFee: 0,
    registrationFee: 0,
    lemonLawFeeNew: 0,
  },
};
