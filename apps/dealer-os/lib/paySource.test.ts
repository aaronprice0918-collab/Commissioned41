import test from "node:test";
import assert from "node:assert/strict";
import { manualSource } from "./paySource.ts";
import { computePay, type CompPlan } from "./payEngine.ts";

test("manualSource: sums numeric fields across rows", () => {
  const src = manualSource();
  const perf = src.toPerformance([
    { margin: 5000, placements: 2 },
    { margin: 3000, placements: 1 },
  ]);
  assert.equal(perf.margin, 8000);
  assert.equal(perf.placements, 3);
});

test("manualSource: derived ratios computed from the sums (guarding /0)", () => {
  const src = manualSource({ derived: [
    { key: "marginPerPlacement", num: "margin", den: "placements" },
    { key: "attachPct", num: "products", den: "placements", scale: 100 },
  ] });
  const perf = src.toPerformance([
    { margin: 5000, placements: 2, products: 3 },
    { margin: 3000, placements: 2, products: 1 },
  ]);
  assert.equal(perf.marginPerPlacement, 2000); // 8000 / 4
  assert.equal(perf.attachPct, 100); // 4 / 4 × 100
  // No denominator → 0, not NaN/Infinity.
  assert.equal(manualSource({ derived: [{ key: "x", num: "a", den: "b" }] }).toPerformance([{ a: 5 }]).x, 0);
});

test("manualSource → toDealRows: coerces types, keeps categories as strings", () => {
  const rows = manualSource().toDealRows!([{ cgp: "500", vehicleClass: "New", share: 1 }, { cgp: 0, vehicleClass: "Used" }]);
  assert.equal(rows[0].cgp, 500); // numeric string → number
  assert.equal(rows[0].vehicleClass, "New"); // category stays string
  assert.equal(rows[1].cgp, 0); // real zero preserved (not stringified)
});

test("manualSource feeds a non-automotive plan end-to-end", () => {
  // Staffing recruiter: 8% of total placement margin, per-period.
  const plan: CompPlan = {
    id: "staffing", name: "Recruiter — margin %",
    vocab: { currency: "USD", unitNoun: "placement", metrics: [{ key: "margin", label: "Placement Margin", format: "money" }] },
    rules: [{ kind: "flat", base: "netProfit", pct: 8 }],
  };
  const src = manualSource();
  // Map the recruiter's rows so the plan's `netProfit` base = summed margin.
  const perf = src.toPerformance([{ netProfit: 12000 }, { netProfit: 8000 }]);
  const r = computePay(plan, perf);
  assert.equal(r.grossCommission, 1600); // 8% × 20,000
});
