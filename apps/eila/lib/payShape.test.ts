import { describe, it, expect } from "vitest";
import { payShape, payShapeSentence, grossForTakeHome, takeHomeOf } from "./payShape";
import { calculatePay } from "./engine";
import { kennesawFinancePlan, makePlan } from "./payplan/plans";
import type { PayPlan, PerfInput } from "./payplan/types";

// A perf input that lands on a chosen gross is fiddly through the grid, so drive
// pay directly with a simple flat plan where gross is predictable, and use the
// real kennesaw plan for the "Aaron's shape doesn't move" guard.
function flatPlan(over: Partial<PayPlan> = {}): PayPlan {
  return makePlan({
    role: "sales",
    base: { salary: 0, frontPct: 100, backPct: 0, perUnit: 0, basis: "front" },
    taxRate: 20,
    ...over,
  });
}
const perf = (frontGross: number): PerfInput => ({ units: 1, frontGross, backGross: 0, products: 0 });

describe("payShape — the shape is DERIVED FROM THE PLAN, never assumed", () => {
  it("recoverable draw → a HOLE you dig out of", () => {
    const plan = flatPlan({ draw: { amount: 8000, period: "semimonthly", recoverable: true } });
    const s = payShape(plan, calculatePay(plan, perf(3000)));
    expect(s.kind).toBe("hole");
    expect(s.threshold).toBe(8000);
    expect(s.filled).toBe(3000);
    expect(s.remaining).toBe(5000);
    expect(s.above).toBe(0);
    expect(s.cleared).toBe(false);
    expect(payShapeSentence(s)).toContain("climbing out");
  });

  it("recoverable draw, cleared → the stack above ground is the real money", () => {
    const plan = flatPlan({ draw: { amount: 8000, period: "semimonthly", recoverable: true } });
    const s = payShape(plan, calculatePay(plan, perf(12256)));
    expect(s.cleared).toBe(true);
    expect(s.above).toBe(4256);
    expect(payShapeSentence(s)).toContain("out of the hole");
  });

  it("carried-in balance deepens the hole (a rolling draw)", () => {
    const plan = flatPlan({ draw: { amount: 8000, period: "monthly", recoverable: true }, drawCarriedIn: 3000 });
    const s = payShape(plan, calculatePay(plan, perf(5000)));
    expect(s.threshold).toBe(11000);
    expect(s.remaining).toBe(6000);
    expect(s.thresholdLabel).toContain("carried");
  });

  it("NON-recoverable draw → a PLATFORM you stand on, never a hole", () => {
    // The new-hire guarantee: money the rep KEEPS. Calling this debt would be a lie.
    const plan = flatPlan({ draw: { amount: 5000, period: "monthly", recoverable: false } });
    const s = payShape(plan, calculatePay(plan, perf(2000)));
    expect(s.kind).toBe("platform");
    expect(s.threshold).toBe(5000);
    expect(s.remaining).toBe(0); // nothing is OWED — pay was floored up to the guarantee
    expect(s.above).toBe(0); // earned $2,000 was floored to the $5,000 guarantee
    expect(payShapeSentence(s)).toContain("yours to keep");
    expect(payShapeSentence(s)).not.toContain("hole");
    expect(payShapeSentence(s)).not.toContain("pay back");
  });

  it("guaranteeFloor with no draw → also a platform", () => {
    const plan = flatPlan({ guaranteeFloor: 4000 });
    const s = payShape(plan, calculatePay(plan, perf(1000)));
    expect(s.kind).toBe("platform");
    expect(s.threshold).toBe(4000);
  });

  it("no draw and no guarantee → OPEN: dollar one is yours, no threshold drawn", () => {
    const plan = flatPlan();
    const s = payShape(plan, calculatePay(plan, perf(6000)));
    expect(s.kind).toBe("open");
    expect(s.threshold).toBe(0);
    expect(s.above).toBe(6000);
    expect(s.cleared).toBe(true);
    expect(payShapeSentence(s)).toContain("first one");
  });

  it("month start ($0 earned) doesn't divide by zero or claim progress", () => {
    const plan = flatPlan({ draw: { amount: 8000, period: "monthly", recoverable: true } });
    const s = payShape(plan, calculatePay(plan, perf(0)));
    expect(s.filled).toBe(0);
    expect(s.thresholdPct).toBe(0);
    expect(s.above).toBe(0);
  });

  it("a take-home goal is converted onto the SAME gross axis as the draw", () => {
    const plan = flatPlan({ takeHomeGoal: 20000, taxRate: 16.85, draw: { amount: 8000, period: "semimonthly", recoverable: true } });
    const s = payShape(plan, calculatePay(plan, perf(12256)));
    // $20,000 take-home at 16.85% tax needs ~$24,053 gross — the goal marker must
    // sit on the gross ruler, not be compared against a gross number directly.
    expect(Math.round(s.goalGross!)).toBe(24053);
    expect(s.goalSource).toBe("takeHome");
  });

  it("no goal set → no goal marker (not a phantom zero)", () => {
    const s = payShape(flatPlan(), calculatePay(flatPlan(), perf(1000)));
    expect(s.goalGross).toBeUndefined();
  });

  it("pace projects the stack, and is kept separate from banked earnings", () => {
    const plan = flatPlan({ draw: { amount: 8000, period: "monthly", recoverable: true } });
    const s = payShape(plan, calculatePay(plan, perf(12256)), 18000);
    expect(s.pacedGross).toBe(18000);
    expect(s.pacedAbove).toBe(10000);
    expect(s.above).toBe(4256); // banked stays banked
  });

  it("tax helpers round-trip", () => {
    expect(Math.round(grossForTakeHome(20000, 16.85))).toBe(24053);
    expect(Math.round(takeHomeOf(24053, 16.85))).toBe(20000);
    expect(grossForTakeHome(5000, 0)).toBe(5000); // no tax configured = no conversion
  });
});

describe("Aaron's real plan is unchanged by the recoverable fix", () => {
  it("kennesawFinancePlan (recoverable) still reads as a hole with the same numbers", () => {
    const plan = kennesawFinancePlan();
    const pay = calculatePay(plan, { units: 36, frontGross: 0, backGross: 74000, products: 79, vscPenetration: 83 });
    const s = payShape(plan, pay);
    expect(s.kind).toBe("hole");
    expect(s.threshold).toBe(8000);
    expect(pay.drawOwed).toBe(Math.max(0, 8000 - pay.grossPay));
    expect(pay.aboveDraw).toBe(Math.max(0, pay.grossPay - 8000));
  });
});
