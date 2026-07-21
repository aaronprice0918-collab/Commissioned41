import { type StateTaxProfile } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// FLORIDA — IN REVIEW (NOT verified, cannot quote yet).
// Scaffolded to prove the engine generalizes. Rates are null on purpose:
// assertQuotable() will refuse to produce a number until we fill these in and
// verify them against a real Florida deal, then flip status to "verified".
// Notes below are STARTING POINTS to verify — not trusted values.
// ─────────────────────────────────────────────────────────────────────────
export const FL: StateTaxProfile = {
  code: "FL",
  name: "Florida",
  status: "review",

  retail: {
    ratePct: null, // TODO verify: FL state sales tax on vehicles is commonly cited at 6% (+ county surtax — a later local-rate layer)
    label: "Sales Tax",
    tradeCredit: "full", // TODO verify FL trade-in credit treatment
    taxableIncludesDocFee: true, // TODO verify
    // TODO verify before this state is quotable (status "review" blocks quotes anyway).
    rebateReducesTaxable: "none",
  },

  lease: {
    method: "monthly_payment", // TODO verify: most states tax each monthly lease payment
    ratePct: null,
  },

  fees: {
    docFee: 799, // TODO verify a sane default; FL does not legally cap doc fees
    docFeeCap: null,
    electronicTitleFee: 0, // TODO verify FL title/registration fee schedule
    titleFee: 0,
    registrationFee: 0,
    lemonLawFeeNew: 0,
  },
};
