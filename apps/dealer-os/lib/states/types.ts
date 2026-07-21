// ─────────────────────────────────────────────────────────────────────────
// State Tax Profile — the contract every U.S. state fills out to be supported.
//
// HARD RULE (Aaron, June 24 2026): every state is INDIVIDUAL and self-contained.
// One state lives in one file (lib/states/<code>.ts). Nothing is shared between
// states — no common rate constant, no cross-import. Changing Florida's rules
// can NEVER move a Georgia number. A state's math is "locked in" the moment its
// status is "verified"; it only changes if someone edits that state's own file.
//
// SAFETY: a profile can only produce a customer quote when status === "verified"
// AND the rate it needs is non-null. Unverified states are listed as "coming
// soon" but physically cannot return a number (assertQuotable throws). We never
// ship a tax figure we haven't verified.
// ─────────────────────────────────────────────────────────────────────────

export type StateStatus = "verified" | "review";

// How a state credits a trade-in against the taxable amount.
export type TradeCreditRule =
  | "full" // taxable = price − full trade value (Georgia)
  | "none" // no trade credit; tax the full price
  | "capped"; // credit up to a legal cap (uses retail.tradeCreditCap)

// How a state taxes a LEASE. These are genuinely different formulas, not just
// different percentages.
export type LeaseTaxMethod =
  | "payment_sum" // tax (base payment × term) × rate; collect capitalized or upfront (Georgia TAVT)
  | "monthly_payment" // tax each monthly payment at the rate (most states)
  | "upfront_full_price" // tax the full selling price upfront (e.g. Texas-style)
  | "upfront_cap_cost"; // tax the adjusted cap cost upfront

export type StateTaxProfile = {
  code: string; // "GA"
  name: string; // "Georgia"
  status: StateStatus;
  verifiedAt?: string; // ISO date its math was verified against a real deal
  verifiedBy?: string; // who signed off

  retail: {
    // Base STATE rate as a percent (local county/city rates are a later layer).
    // null until verified, which by itself blocks a quote.
    ratePct: number | null;
    label: string; // wording on paperwork: "TAVT", "Sales Tax", …
    tradeCredit: TradeCreditRule;
    tradeCreditCap?: number; // only when tradeCredit === "capped"
    taxableIncludesDocFee: boolean; // is the doc fee part of the taxed base?
    // Does a rebate reduce the taxed base? GA: yes on NEW-vehicle dealer sales
    // (O.C.G.A. §48-5C-1: FMV less trade-in and any rebate/cash discount).
    // "new" = New vehicleClass only · "all" = every class · "none" = rebates taxed.
    rebateReducesTaxable: "new" | "all" | "none";
  };

  lease: {
    method: LeaseTaxMethod;
    ratePct: number | null; // null until verified
  };

  fees: {
    docFee: number;
    docFeeCap: number | null; // legal cap; null = uncapped
    electronicTitleFee: number;
    titleFee: number;
    registrationFee: number;
    lemonLawFeeNew: number; // applied to NEW vehicles only
  };
};

// Throws unless the profile is verified and has the rate the given deal needs.
// Call this before quoting so an unverified state can never emit a number.
export function assertQuotable(p: StateTaxProfile, kind: "retail" | "lease") {
  if (p.status !== "verified") {
    throw new Error(
      `${p.name} (${p.code}) isn't verified yet — Dealer Mission OS won't quote a deal there until its tax math is confirmed.`,
    );
  }
  const rate = kind === "retail" ? p.retail.ratePct : p.lease.ratePct;
  if (rate == null) {
    throw new Error(`${p.name} (${p.code}) has no verified ${kind} tax rate set.`);
  }
}
