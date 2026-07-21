import { strict as assert } from "node:assert";
import test from "node:test";
import { calculateDesk, estimatePayment } from "./desk";
import { calculateGeorgiaLease } from "./lease";

// The tax/desk engine had no tests until the July 2026 A-to-Z audit — these
// lock in the verified Georgia math so it can never drift silently again.

const baseLead = {
  vehicleClass: "New" as const,
  sellingPrice: 40000,
  unitCost: 38000,
  docFee: 899,
  rebate: 0,
  tradeValue: 0,
  taxCreditEnabled: true,
  payoff: 0,
  cashDown: 0,
  rate: 6,
  term: 72,
  products: { vsc: 0, gap: 0, maintenance: 0, permaplate: 0, tws: 0, utp: 0 },
};

test("payment formula is a textbook annuity", () => {
  assert.equal(Math.round(estimatePayment(30000, 6, 60) * 100) / 100, 579.98);
  assert.equal(estimatePayment(12000, 0, 60), 200); // 0% degrades to amount/term
  assert.equal(estimatePayment(0, 6, 60), 0);
});

test("GA TAVT: base = price + doc fee, at 7%", () => {
  const d = calculateDesk(baseLead);
  assert.equal(d.taxableAmount, 40899);
  assert.equal(Math.round(d.tax * 100) / 100, 2862.93);
});

test("GA TAVT: a NEW vehicle's rebate reduces the taxed base (O.C.G.A. §48-5C-1)", () => {
  const d = calculateDesk({ ...baseLead, rebate: 2000 });
  assert.equal(d.taxableAmount, 38899); // 40,000 + 899 − 2,000
  assert.equal(Math.round(d.tax * 100) / 100, 2722.93);
});

test("GA TAVT: a USED vehicle's rebate does NOT reduce the base (statute covers new)", () => {
  const d = calculateDesk({ ...baseLead, vehicleClass: "Used", rebate: 2000 });
  assert.equal(d.taxableAmount, 40899);
});

test("GA TAVT: trade credit applies only when enabled, on top of the rebate reduction", () => {
  const withTrade = calculateDesk({ ...baseLead, rebate: 2000, tradeValue: 10000 });
  assert.equal(withTrade.taxableAmount, 28899); // 40,899 − 2,000 rebate − 10,000 trade
  const gated = calculateDesk({ ...baseLead, rebate: 2000, tradeValue: 10000, taxCreditEnabled: false });
  assert.equal(gated.taxableAmount, 38899); // trade credit off, rebate still applies
});

test("amount financed nets rebate/trade/cash and adds tax + fees + products", () => {
  const d = calculateDesk({ ...baseLead, rebate: 2000, cashDown: 3000 });
  // 40,000 − 2,000 − 3,000 + tax + fees
  assert.equal(Math.round(d.amountFinanced), Math.round(35000 + d.tax + d.fees));
});

test("GA lease TAVT base = base payments × term PLUS cash down (GA DOR lease rule)", () => {
  const lease = calculateGeorgiaLease({
    msrp: 35000,
    sellingPrice: 33000,
    acquisitionFee: 0,
    rebate: 0,
    tradeEquity: 0,
    cashDown: 3000,
    residualPct: 58,
    moneyFactor: 0.00125,
    termMonths: 36,
    upfrontFees: 0,
    taxRatePct: 7,
    taxMethod: "upfront",
  });
  assert.equal(lease.taxBase, Math.round((lease.basePayment * 36 + 3000) * 100) / 100);
  const noDown = calculateGeorgiaLease({
    msrp: 35000, sellingPrice: 33000, acquisitionFee: 0, rebate: 0, tradeEquity: 0,
    cashDown: 0, residualPct: 58, moneyFactor: 0.00125, termMonths: 36,
    upfrontFees: 0, taxRatePct: 7, taxMethod: "upfront",
  });
  // The down payment itself is taxed — bases differ by more than the payment shift alone.
  assert.ok(lease.tavt !== noDown.tavt);
});

test("lease + New both carry the lemon-law fee in the desk fee total", () => {
  const newDeal = calculateDesk(baseLead);
  const leaseDeal = calculateDesk({ ...baseLead, vehicleClass: "Lease" });
  const usedDeal = calculateDesk({ ...baseLead, vehicleClass: "Used" });
  assert.equal(newDeal.fees, leaseDeal.fees);
  assert.equal(usedDeal.fees, newDeal.fees - 3);
});
