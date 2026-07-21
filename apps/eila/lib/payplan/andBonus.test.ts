import { describe, it, expect } from "vitest";
import { calculatePay } from "./calc";
import { makePlan } from "./plans";
import { perfFromDeals } from "../engine";
import { Deal } from "../types";
import { PayPlan } from "./types";

// July 6 field regression (Tony, Kennesaw): his re-uploaded plan parsed the
// finance bonus as a SINGLE condition (pvr ≥ 1300) because BonusRule couldn't
// hold "10+ units AND back PVR ≥ $1,300". With basis "front", pvr derived from
// FRONT gross — so a negative-front deal knocked a phantom $500 bonus off and
// the Stegall deal read −$350 instead of +$150. These tests pin the fix:
// AND-condition bonuses, the basis-independent backPvr metric, and
// fastStartUnits derived from deal dates.

const TONY_PLAN: PayPlan = makePlan({
  role: "sales",
  base: { salary: 0, frontPct: 0, backPct: 0, perUnit: 0, perProduct: 0, basis: "front" },
  perDeal: {
    default: { minFlat: 150 },
    minFlat: 150,
    segments: {
      new: { bands: [{ min: -99999, flat: 150 }, { min: -300, flat: 250 }, { min: 1, flat: 400 }], minFlat: 150 },
      used: { pct: 25, highMin: 3000, highPct: 30, minFlat: 150 },
    },
  },
  tiers: [
    { id: "t0", kind: "flat", label: "12 units", amount: 500, metric: "units", threshold: 12 },
    { id: "t1", kind: "flat", label: "15 units", amount: 1000, metric: "units", threshold: 15 },
    { id: "t2", kind: "flat", label: "18 units", amount: 1300, metric: "units", threshold: 18 },
    { id: "t3", kind: "flat", label: "21 units", amount: 1600, metric: "units", threshold: 21 },
    { id: "t4", kind: "flat", label: "24 units", amount: 1900, metric: "units", threshold: 24 },
  ],
  bonuses: [
    // THE fix: one bonus, BOTH legs — exactly how the signed plan reads.
    { id: "b0", label: "Finance Bonus", condition: [{ metric: "units", op: "gte", value: 10 }, { metric: "backPvr", op: "gte", value: 1300 }], effect: { kind: "flat", amount: 500 } },
    { id: "b1", label: "Fast Start", condition: { metric: "fastStartUnits", op: "gte", value: 7 }, effect: { kind: "flat", amount: 500 } },
  ],
});

function perf(rows: { front: number; back: number }[], fastStartUnits = 0) {
  return {
    units: rows.length,
    frontGross: rows.reduce((n, r) => n + r.front, 0),
    backGross: rows.reduce((n, r) => n + r.back, 0),
    products: 0,
    fastStartUnits,
    dealRows: rows.map((r) => ({ front: r.front, category: "new" })),
  };
}

describe("REGRESSION — the −$350 Stegall reading", () => {
  // Tony's actual July month: three delivered New deals + Stegall (−$1,360 front, $1,525 back).
  const others = [{ front: 2032.19, back: 75.96 }, { front: 2032.19, back: 75.96 }, { front: 527, back: 3050 }];
  const stegall = { front: -1360, back: 1525 };

  it("the deal's marginal pay is +$150 — the phantom finance bonus no longer swings it", () => {
    const without = calculatePay(TONY_PLAN, perf(others, 3));
    const withIt = calculatePay(TONY_PLAN, perf([...others, stegall], 4));
    expect(withIt.grossPay - without.grossPay).toBe(150);
  });

  it("finance bonus stays OFF at 4 units even with high back PVR (needs BOTH legs)", () => {
    const r = calculatePay(TONY_PLAN, perf([...others, stegall], 4));
    expect(r.bonuses.find((b) => b.label === "Finance Bonus")).toBeUndefined();
  });

  it("finance bonus fires with 10 units AND back PVR ≥ $1,300 — and never on front PVR", () => {
    const tenGood = Array.from({ length: 10 }, () => ({ front: 2000, back: 1400 }));
    expect(calculatePay(TONY_PLAN, perf(tenGood, 0)).bonuses.some((b) => b.label === "Finance Bonus")).toBe(true);
    // high FRONT per unit, weak back → no bonus (the old bug fired here)
    const tenFrontHeavy = Array.from({ length: 10 }, () => ({ front: 3000, back: 500 }));
    expect(calculatePay(TONY_PLAN, perf(tenFrontHeavy, 0)).bonuses.some((b) => b.label === "Finance Bonus")).toBe(false);
  });

  it("fast start pays at 7 units by the 15th, not before", () => {
    const rows = Array.from({ length: 8 }, () => ({ front: 2000, back: 500 }));
    expect(calculatePay(TONY_PLAN, perf(rows, 6)).bonuses.some((b) => b.label === "Fast Start")).toBe(false);
    expect(calculatePay(TONY_PLAN, perf(rows, 7)).bonuses.some((b) => b.label === "Fast Start")).toBe(true);
  });
});

describe("fastStartUnits derives from deal dates", () => {
  const deal = (day: string, over: Partial<Deal>): Deal => ({
    id: Math.random().toString(36).slice(2), date: `2026-07-${day}T12:00:00.000Z`, customer: "c",
    item: "", category: "new", amount: 1000, secondary: 0, addons: 0, reserve: 0, status: "delivered",
    ...over,
  } as Deal);
  it("counts only units delivered on/before the 15th", () => {
    const deals = [deal("03", {}), deal("15", {}), deal("16", {}), deal("28", {})];
    expect(perfFromDeals(deals).fastStartUnits).toBe(2);
  });
});
