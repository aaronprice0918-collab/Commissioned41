import test from "node:test";
import assert from "node:assert/strict";
import { buildPerformance } from "./buildPerformance.ts";
import type { Deal } from "./data.ts";

// buildPerformance feeds computePay — the pay engine's own tests construct
// Performance by hand, so they never exercise this adapter's three load-bearing
// rules: the retail-only unit gate (Wholesale must not inflate units), split
// share-weighting for Sales, and the fast-start delivery-day cutoff.

function deal(o: Partial<Deal>): Deal {
  const base = { vehicleClass: "New", salesperson: "", salesperson2: "", frontGross: 0, backGrossReserve: 0, date: "2026-07-10", stage: "Delivered", products: {} };
  return { ...base, ...(o as object) } as unknown as Deal;
}

test("Wholesale units are excluded from the retail gate", () => {
  const deals = [
    deal({ vehicleClass: "New", salesperson: "Alice", frontGross: 2000, backGrossReserve: 1000 }),
    deal({ vehicleClass: "Wholesale", salesperson: "Alice", frontGross: 5000, backGrossReserve: 4000 }),
  ];
  const perf = buildPerformance(deals);
  assert.equal(perf.units, 1); // only the New unit
  assert.equal(perf.frontGross, 2000); // Wholesale $5,000 excluded
  assert.equal(perf.backGross, 1000);
});

test("Sales split deals are weighted to the rep's share", () => {
  const deals = [
    deal({ vehicleClass: "New", salesperson: "Alice", frontGross: 2000, backGrossReserve: 1000, date: "2026-07-10" }),
    deal({ vehicleClass: "Used", salesperson: "Alice", salesperson2: "Bob", frontGross: 2000, backGrossReserve: 1000, date: "2026-07-20" }),
  ];
  const perf = buildPerformance(deals, { role: "Sales", name: "Alice" });
  assert.equal(perf.units, 1.5); // solo 1 + split 0.5
  assert.equal(perf.frontGross, 3000); // 2000 + 2000*0.5
  assert.equal(perf.backGross, 1500); // 1000 + 1000*0.5
  assert.equal(perf.pvr, 1500 / 1.5); // back per weighted unit
});

test("without a Sales role, every retail deal counts fully (no share-weighting)", () => {
  const deals = [deal({ vehicleClass: "New", salesperson: "Alice", salesperson2: "Bob", frontGross: 2000, backGrossReserve: 1000 })];
  const perf = buildPerformance(deals); // no opts
  assert.equal(perf.units, 1); // full unit, not 0.5
  assert.equal(perf.frontGross, 2000);
});

test("fast-start counts only units delivered on/before the plan's cutoff day", () => {
  const deals = [
    deal({ vehicleClass: "New", salesperson: "Alice", date: "2026-07-08" }), // day 8
    deal({ vehicleClass: "New", salesperson: "Alice", date: "2026-07-22" }), // day 22
  ];
  const perf = buildPerformance(deals, { role: "Sales", name: "Alice", fastStartByDay: 15 });
  assert.equal(perf.units, 2);
  assert.equal(perf.fastStartUnits, 1); // only the day-8 delivery
});

test("empty / retail-less input yields all zeros and no divide-by-zero", () => {
  const perf = buildPerformance([deal({ vehicleClass: "Wholesale", salesperson: "Alice", frontGross: 9000 })]);
  assert.equal(perf.units, 0);
  assert.equal(perf.pvr, 0);
  assert.equal(perf.totalGross, 0);
});
