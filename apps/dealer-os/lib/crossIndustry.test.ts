import test from "node:test";
import assert from "node:assert/strict";
import { computePay, type CompPlan } from "./payEngine.ts";
import { manualSource } from "./paySource.ts";
import { periodFor } from "./payCycle.ts";
import { makeMoney } from "./payFormat.ts";

// The whole point of the rebuild: the SAME engine + cycle + vocab pay correctly
// for industries that have nothing to do with cars — no automotive terms, no
// calendar-month assumption. Two realistic non-dealership plans, end to end.

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("staffing agency: 8% of placement margin, WEEKLY, check issued 5 days after the week closes", () => {
  const plan: CompPlan = {
    id: "staffing-recruiter", name: "Recruiter — margin %", role: "Recruiter",
    cycle: { mode: "fixedLength", anchor: "2026-01-05", lengthDays: 7, payOffsetDays: 5, periodNoun: "week" },
    vocab: { currency: "USD", unitNoun: "placement", periodNoun: "week", metrics: [
      { key: "netProfit", label: "Placement Margin", format: "money" },
      { key: "placements", label: "Placements", format: "number" },
    ] },
    rules: [{ kind: "flat", base: "netProfit", pct: 8 }],
  };
  // A week of placement rows, mapped so the plan's base metric = summed margin.
  const perf = manualSource().toPerformance([
    { netProfit: 12000, placements: 2 },
    { netProfit: 8000, placements: 1 },
  ]);
  const r = computePay(plan, perf);
  assert.equal(r.grossCommission, 1600); // 8% × 20,000
  assert.equal(r.netEstimatedPay, 1600);
  // The explanation speaks dollars, and there is no automotive metric in sight.
  assert.ok(r.explanation.some((l) => /\$/.test(l)));

  // Weekly window + earned-vs-paid: the week of Jan 8 pays out Jan 16.
  const p = periodFor(plan.cycle!, new Date("2026-01-08T12:00:00"));
  assert.equal(iso(p.start), "2026-01-05");
  assert.equal(iso(p.end), "2026-01-11");
  assert.equal(iso(p.payDate), "2026-01-16");
});

test("SaaS AE: tiered rate on ARR, SEMI-MONTHLY, EUR", () => {
  const plan: CompPlan = {
    id: "saas-ae", name: "Account Exec — ARR tiers", role: "AE",
    cycle: { mode: "semiMonthly", semiMonthlyDays: [1, 16], payDayOfNextPeriod: 5, periodNoun: "pay period" },
    vocab: { currency: "EUR", locale: "de-DE", unitNoun: "deal", periodNoun: "pay period", metrics: [
      { key: "totalGross", label: "ARR Booked", format: "money" },
      { key: "deals", label: "Deals Closed", format: "number" },
    ] },
    // Rate climbs with deals closed; paid on booked ARR (mapped to totalGross).
    rules: [{ kind: "tier", metric: "deals", base: "totalGross", tiers: [{ min: 0, pct: 8 }, { min: 5, pct: 10 }, { min: 10, pct: 12 }] }],
  };
  const perf = manualSource().toPerformance([
    { totalGross: 120000, deals: 4 },
    { totalGross: 80000, deals: 3 },
  ]);
  const r = computePay(plan, perf); // 7 deals → 10% tier, ARR 200,000
  assert.equal(r.effectiveRatePct, 10);
  assert.equal(r.grossCommission, 20000);
  // Money reads in euros (de-DE), proving currency is data, not hardcoded.
  assert.ok(r.explanation.some((l) => /€/.test(l)), "explanation should be in euros");
  assert.equal(makeMoney(plan.vocab)(20000), new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(20000));

  // Semi-monthly window: the 2nd-half period pays on the 5th of the next month.
  const p = periodFor(plan.cycle!, new Date("2026-05-20T12:00:00"));
  assert.equal(iso(p.start), "2026-05-16");
  assert.equal(iso(p.end), "2026-05-31");
  assert.equal(iso(p.payDate), "2026-06-05");
});

test("home-services tech: per-job % with a mini, tracked in a custom 10-day cycle", () => {
  const plan: CompPlan = {
    id: "hs-tech", name: "Service Tech — per job", role: "Tech",
    cycle: { mode: "fixedLength", anchor: "2026-01-01", lengthDays: 10, periodNoun: "cycle" },
    vocab: { currency: "USD", unitNoun: "job", metrics: [{ key: "jobRevenue", label: "Job Revenue", format: "money" }] },
    rules: [{ kind: "perDeal", value: "jobRevenue", default: { pct: 15, minFlat: 40 } }],
  };
  const rows = manualSource().toDealRows!([{ jobRevenue: 800 }, { jobRevenue: 100 }, { jobRevenue: 2000 }]);
  const r = computePay(plan, { units: 3 }, rows);
  // 15% of 800 = 120; 15% of 100 = 15 → mini 40; 15% of 2000 = 300 → 460 total.
  assert.equal(r.grossCommission, 460);
});
