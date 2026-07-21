// Georgia lease engine. A lease payment is NOT a loan payment — it's
// depreciation (what the car loses over the term) plus a rent charge (the
// lender's money factor). Georgia taxes a lease differently from a purchase:
// the customer pays the full 7% TAVT, but ONLY on the portion he's renting —
// i.e. the sum of his base (pre-tax) payments — NOT the full vehicle value.
// (Aaron Price, Kennesaw Mazda F&I, June 2026.)
//
//   residual value      = MSRP × residual%
//   adjusted cap cost   = (selling price + acq fee) − cap-cost reductions
//   depreciation / mo   = (adjusted cap cost − residual value) ÷ term
//   rent charge / mo    = (adjusted cap cost + residual value) × money factor
//   BASE payment        = depreciation + rent charge            ← pre-tax
//   GA TAVT             = (base payment × term + cash down) × 7%
//
// Per GA DOR (HB 340 / leases since 2022, confirmed July 2026): the lease
// TAVT base is the TOTAL OF BASE PAYMENTS **PLUS ANY DOWN PAYMENT** — the
// customer's cash down is part of what's taxed. (Factory lease cash and trade
// equity are cap-cost reductions, not "down payments", and stay untaxed.)
// The TAVT is figured on the PRE-tax base payment, so capitalizing it never
// re-taxes itself. Collection is the customer's choice: capitalize it into the
// monthly (default) or pay it upfront at signing.

export type LeaseTaxMethod = "capitalize" | "upfront";

export type LeaseInput = {
  msrp: number;            // residual is a % of MSRP
  sellingPrice: number;    // agreed/negotiated price
  acquisitionFee: number;  // bank acq fee — capitalized into the gross cap cost
  // Cap-cost reductions (lower the financed amount → lower the payment):
  rebate: number;          // factory lease cash (not cash from the customer)
  tradeEquity: number;     // positive trade equity applied (ACV − payoff)
  cashDown: number;        // customer's cash down (also due at signing)
  // Lease terms:
  residualPct: number;     // e.g. 58 for 58% of MSRP
  moneyFactor: number;     // e.g. 0.00125
  termMonths: number;      // e.g. 36
  // Upfront fees collected at signing, not capitalized (doc, title, tag…):
  upfrontFees: number;
  // Georgia tax:
  taxRatePct: number;      // 7 (GA TAVT)
  taxMethod: LeaseTaxMethod;
};

export type LeaseResult = {
  residualValue: number;
  grossCapCost: number;
  capCostReduction: number;
  adjustedCapCost: number;
  monthlyDepreciation: number;
  monthlyRentCharge: number;
  basePayment: number;        // pre-tax monthly
  equivalentApr: number;      // money factor × 2400, for reference
  taxBase: number;            // base payment × term + cash down (GA lease TAVT base)
  tavt: number;               // GA tax on the leased portion
  monthlyTax: number;         // capitalize → tavt ÷ term; upfront → 0
  monthlyPayment: number;     // base payment + monthly tax
  dueAtSigning: number;       // cash down + upfront fees + first payment + (upfront ? tavt : 0)
  totalOfPayments: number;    // monthly payment × term
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calculateGeorgiaLease(i: LeaseInput): LeaseResult {
  const term = i.termMonths > 0 ? i.termMonths : 1;

  const residualValue = round2(i.msrp * (i.residualPct / 100));
  const grossCapCost = i.sellingPrice + i.acquisitionFee;
  const capCostReduction = i.rebate + Math.max(i.tradeEquity, 0) + i.cashDown;
  const adjustedCapCost = Math.max(grossCapCost - capCostReduction, 0);

  const monthlyDepreciation = round2((adjustedCapCost - residualValue) / term);
  const monthlyRentCharge = round2((adjustedCapCost + residualValue) * i.moneyFactor);
  const basePayment = round2(monthlyDepreciation + monthlyRentCharge);
  const equivalentApr = round2(i.moneyFactor * 2400);

  // GA TAVT base = total of base payments PLUS the customer's down payment
  // (GA DOR lease rule — the old math skipped the cash down, undercollecting
  // ~$210 on $3,000 down at 7%).
  const taxBase = round2(basePayment * term + Math.max(i.cashDown, 0));
  const tavt = round2(taxBase * (i.taxRatePct / 100));

  const monthlyTax = i.taxMethod === "capitalize" ? round2(tavt / term) : 0;
  const monthlyPayment = round2(basePayment + monthlyTax);

  const dueAtSigning = round2(
    i.cashDown + i.upfrontFees + monthlyPayment + (i.taxMethod === "upfront" ? tavt : 0)
  );
  const totalOfPayments = round2(monthlyPayment * term);

  return {
    residualValue,
    grossCapCost: round2(grossCapCost),
    capCostReduction: round2(capCostReduction),
    adjustedCapCost: round2(adjustedCapCost),
    monthlyDepreciation,
    monthlyRentCharge,
    basePayment,
    equivalentApr,
    taxBase,
    tavt,
    monthlyTax,
    monthlyPayment,
    dueAtSigning,
    totalOfPayments,
  };
}

// ---- Multi-state lease entry point -----------------------------------------
// Routes a lease to the correct per-state method. Georgia ("payment_sum") uses
// the verified engine above, unchanged. Other methods exist in the type system
// but are not verified yet, so they throw rather than emit an unverified number.
// assertQuotable() blocks any state that isn't verified before we get here.
import { assertQuotable, type StateTaxProfile } from "@/lib/states";

export function calculateLease(
  input: Omit<LeaseInput, "taxRatePct">,
  profile: StateTaxProfile,
): LeaseResult {
  assertQuotable(profile, "lease");
  const taxRatePct = profile.lease.ratePct as number; // non-null guaranteed by assertQuotable

  switch (profile.lease.method) {
    case "payment_sum":
      return calculateGeorgiaLease({ ...input, taxRatePct });
    default:
      throw new Error(
        `${profile.name} lease method "${profile.lease.method}" isn't implemented/verified yet.`,
      );
  }
}

// ---- CUSTOMER presentation sheet -------------------------------------------
// What the salesperson hands the customer: payment, due at signing, term, miles,
// selling price, rebate — and NOTHING else. No money factor, residual, or cost
// build-up (that's the manager recap only). Mirrors the retail rule that the
// customer copy never shows the rate/markup.
export type LeaseCustomerSheet = {
  sellingPrice: number;
  rebate: number;
  termMonths: number;
  milesPerYear: number;
  monthlyPayment: number;
  dueAtSigning: number;
};

export function buildLeaseCustomerSheetHtml(d: LeaseCustomerSheet, meta: LeaseWorksheetMeta): string {
  const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
  const usd0 = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] as string));
  const miles = d.milesPerYear >= 1000 ? `${Math.round(d.milesPerYear / 1000)}k mi/yr` : `${d.milesPerYear} mi/yr`;
  const line = (label: string, value: string) => `<tr><td class="l">${esc(label)}</td><td class="v">${esc(value)}</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Lease Proposal${meta.customer ? ` — ${esc(meta.customer)}` : ""}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:40px;font-size:14px}
  h1{margin:0 0 2px;font-size:24px} .muted{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1.5px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:18px}
  .veh{font-size:18px;font-weight:800;margin:6px 0 18px}
  .heroes{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 0 22px}
  .hero{border:1px solid #111;border-radius:10px;padding:18px;text-align:center}
  .hero .k{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#555}
  .hero .b{font-size:38px;font-weight:800;line-height:1.1;margin-top:6px}
  table{width:100%;border-collapse:collapse;max-width:420px} td{padding:9px 0;border-bottom:1px solid #eee}
  td.l{color:#444;font-size:13px;text-transform:uppercase;letter-spacing:.5px} td.v{text-align:right;font-weight:700;font-size:15px}
  .note{margin-top:22px;font-size:11px;color:#777;line-height:1.5;max-width:560px}
  .sign{margin-top:46px;display:grid;grid-template-columns:1fr 1fr;gap:30px}
  .sig{border-top:1px solid #111;padding-top:6px;font-size:11px;color:#444}
  @media print{body{margin:20px}button{display:none}}
</style></head><body>
  <div class="hdr">
    <div><h1>${esc(meta.storeName || "Lease Proposal")}</h1><div class="muted">Lease Proposal${meta.customer ? ` · ${esc(meta.customer)}` : ""}</div></div>
    <div style="text-align:right" class="muted">${esc(meta.printedAt)}${meta.preparedBy ? `<br>${esc(meta.preparedBy)}` : ""}</div>
  </div>
  ${meta.vehicle ? `<div class="veh">${esc(meta.vehicle)}</div>` : ""}
  <div class="heroes">
    <div class="hero"><div class="k">Monthly Payment</div><div class="b">${usd(d.monthlyPayment)}</div><div class="muted" style="margin-top:6px">${d.termMonths} months · ${miles}</div></div>
    <div class="hero"><div class="k">Due at Signing</div><div class="b">${usd(d.dueAtSigning)}</div></div>
  </div>
  <table>
    ${line("Selling Price", usd0(d.sellingPrice))}
    ${line("Rebate", d.rebate ? `−${usd0(d.rebate)}` : "—")}
    ${line("Term", `${d.termMonths} months`)}
    ${line("Mileage", miles)}
  </table>
  <p class="note">Estimated lease figures for presentation. Final terms are subject to credit approval, lender program, and the signed lease agreement. Excess mileage and wear charges may apply at lease end.</p>
  <div class="sign"><div class="sig">Customer Signature / Date</div><div class="sig">Salesperson / Date</div></div>
  <script>window.print()</script>
</body></html>`;
}

// Money factor ↔ APR helpers (F&I managers think in both).
export const mfToApr = (mf: number) => round2(mf * 2400);
export const aprToMf = (apr: number) => Math.round((apr / 2400) * 1e6) / 1e6;

// ---- Printable lease worksheet ---------------------------------------------
// A clean, customer-facing recap of the lease the office can key from. Mirrors
// the on-screen breakdown so the printed numbers always match the desk.
export type LeaseWorksheetMeta = {
  storeName: string;
  customer?: string;
  vehicle?: string;
  preparedBy?: string;
  printedAt: string;
};

export function buildLeaseWorksheetHtml(i: LeaseInput, r: LeaseResult, meta: LeaseWorksheetMeta): string {
  const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] as string));
  const taxLine = i.taxMethod === "capitalize"
    ? `Capitalized into the payment (+${usd(r.monthlyTax)}/mo)`
    : `Paid upfront at signing (${usd(r.tavt)})`;
  const row = (label: string, value: string, note = "") =>
    `<tr><td class="l">${esc(label)}${note ? `<span class="n">${esc(note)}</span>` : ""}</td><td class="v">${esc(value)}</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Lease Worksheet${meta.customer ? ` — ${esc(meta.customer)}` : ""}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:34px;font-size:13px}
  h1{margin:0 0 2px;font-size:24px} .muted{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1.5px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px}
  .heroes{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0 18px}
  .hero{border:1px solid #111;border-radius:8px;padding:14px} .hero .k{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#555}
  .hero .b{font-size:30px;font-weight:800;line-height:1.1;margin-top:4px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #ccc;padding-bottom:5px;margin:18px 0 8px}
  table{width:100%;border-collapse:collapse} td{padding:6px 0;border-bottom:1px solid #eee;vertical-align:top}
  td.l{color:#333} td.v{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .n{display:block;font-size:10px;color:#999;font-weight:400;letter-spacing:.3px}
  .note{margin-top:16px;font-size:11px;color:#666;line-height:1.5}
  .sign{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:30px}
  .sig{border-top:1px solid #111;padding-top:6px;font-size:11px;color:#444}
  @media print{body{margin:18px}button{display:none}}
</style></head><body>
  <div class="hdr">
    <div><h1>${esc(meta.storeName || "Lease Worksheet")}</h1><div class="muted">Georgia Lease Worksheet</div></div>
    <div style="text-align:right" class="muted">${esc(meta.printedAt)}${meta.preparedBy ? `<br>Prepared by ${esc(meta.preparedBy)}` : ""}</div>
  </div>
  <table>
    ${row("Customer", meta.customer || "—")}
    ${row("Vehicle", meta.vehicle || "—")}
    ${row("Term", `${i.termMonths} months`)}
  </table>
  <div class="heroes">
    <div class="hero"><div class="k">Monthly Payment</div><div class="b">${usd(r.monthlyPayment)}</div></div>
    <div class="hero"><div class="k">Due at Signing</div><div class="b">${usd(r.dueAtSigning)}</div></div>
  </div>
  <h2>How the payment is built</h2>
  <table>
    ${row("MSRP", usd(i.msrp))}
    ${row("Selling price", usd(i.sellingPrice))}
    ${row("Acquisition fee", usd(i.acquisitionFee))}
    ${row("Residual value", usd(r.residualValue), `${i.residualPct}% of MSRP`)}
    ${row("Money factor", `${i.moneyFactor} (${mfToApr(i.moneyFactor).toFixed(2)}% APR equiv)`)}
    ${row("Gross cap cost", usd(r.grossCapCost), "Price + acq fee")}
    ${row("Cap-cost reduction", `−${usd(r.capCostReduction)}`, "Rebate + trade + cash down")}
    ${row("Adjusted cap cost", usd(r.adjustedCapCost))}
    ${row("Depreciation / mo", usd(r.monthlyDepreciation), "(cap − residual) ÷ term")}
    ${row("Rent charge / mo", usd(r.monthlyRentCharge), "(cap + residual) × money factor")}
    ${row("Base payment (pre-tax)", usd(r.basePayment))}
  </table>
  <h2>Georgia tax (TAVT)</h2>
  <table>
    ${row("Tax base (leased portion)", usd(r.taxBase), "Base payment × term — not the full vehicle value")}
    ${row(`TAVT @ ${i.taxRatePct}%`, usd(r.tavt))}
    ${row("Collection", taxLine)}
    ${row("Total of payments", usd(r.totalOfPayments))}
  </table>
  <p class="note">Georgia taxes a lease on the portion the customer leases (the payment stream), not the full value of the vehicle. Figures are an estimate for presentation; final terms are subject to lender approval and the signed lease agreement.</p>
  <div class="sign"><div class="sig">Customer Signature / Date</div><div class="sig">Manager Signature / Date</div></div>
  <script>window.print()</script>
</body></html>`;
}
