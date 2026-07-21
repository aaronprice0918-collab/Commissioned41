import { describe, it, expect } from "vitest";
import { calculatePay, classifyPlan, perDealPay } from "./calc";
import { makePlan } from "./plans";
import { PerDealRule } from "./types";

// The Kennesaw Mazda sales-consultant plan, per-deal shape (matches the signed
// plan and the dealer repo's KENNESAW_SALES_COMP_PLAN):
// New = flat by the deal's front gross band; Used = 25% (30% ≥ $3,000), $150 mini.
const KENNESAW_PER_DEAL: PerDealRule = {
  segments: {
    new: { bands: [{ min: 1, flat: 400 }, { min: -300, flat: 250 }, { min: -1e9, flat: 150 }] },
    used: { pct: 25, highMin: 3000, highPct: 30, minFlat: 150 },
  },
  default: { minFlat: 150 },
  minFlat: 150,
};

const plan = makePlan({
  role: "sales",
  perDeal: KENNESAW_PER_DEAL,
  tiers: [
    { id: "u12", label: "12 units", metric: "units", threshold: 12, kind: "flat", amount: 500 },
    { id: "u15", label: "15 units", metric: "units", threshold: 15, kind: "flat", amount: 1000 },
  ],
});

describe("perDealPay", () => {
  it("New bands: $400 at $1+, $250 from −$300, $150 below", () => {
    expect(perDealPay(KENNESAW_PER_DEAL, 2000, "new")).toEqual({ pay: 400, mini: false });
    expect(perDealPay(KENNESAW_PER_DEAL, 1, "new")).toEqual({ pay: 400, mini: false });
    expect(perDealPay(KENNESAW_PER_DEAL, -100, "new")).toEqual({ pay: 250, mini: false });
    expect(perDealPay(KENNESAW_PER_DEAL, -300, "new")).toEqual({ pay: 250, mini: false });
  });

  it("REGRESSION — Rodney Stegall: a −$1,750-front New deal pays the $150 bottom band, not $0 and never negative", () => {
    expect(perDealPay(KENNESAW_PER_DEAL, -1750, "new")).toEqual({ pay: 150, mini: false });
    expect(perDealPay(KENNESAW_PER_DEAL, -1360, "new")).toEqual({ pay: 150, mini: false });
  });

  it("Used: 25% of gross, 30% at $3,000+, $150 mini", () => {
    expect(perDealPay(KENNESAW_PER_DEAL, 2000, "used")).toEqual({ pay: 500, mini: false });
    expect(perDealPay(KENNESAW_PER_DEAL, 3000, "used")).toEqual({ pay: 900, mini: false });
    expect(perDealPay(KENNESAW_PER_DEAL, 400, "used")).toEqual({ pay: 150, mini: true });
    expect(perDealPay(KENNESAW_PER_DEAL, -500, "used")).toEqual({ pay: 150, mini: true });
  });

  it("unknown/no category falls to the default segment's mini; category match is case-insensitive", () => {
    expect(perDealPay(KENNESAW_PER_DEAL, 5000)).toEqual({ pay: 150, mini: true });
    expect(perDealPay(KENNESAW_PER_DEAL, 5000, "wholesale")).toEqual({ pay: 150, mini: true });
    expect(perDealPay(KENNESAW_PER_DEAL, 2000, "New")).toEqual({ pay: 400, mini: false });
  });
});

describe("calculatePay with a per-deal plan", () => {
  it("classifies as perDeal (volume ladder included) and pays each deal on its own gross", () => {
    expect(classifyPlan(plan)).toBe("perDeal");
    // 3 New ($2000, −$100, −$1750) + 1 Used $2000 → 400 + 250 + 150 + 500 = 1300.
    const r = calculatePay(plan, {
      units: 4, frontGross: 2150, backGross: 0, products: 0,
      dealRows: [
        { front: 2000, category: "new" }, { front: -100, category: "new" },
        { front: -1750, category: "new" }, { front: 2000, category: "used" },
      ],
    });
    expect(r.grossCommission).toBe(1300);
    expect(r.grossPay).toBe(1300);
  });

  it("the marginal pay of the Rodney deal is +$150 — a loser deal never subtracts from the month", () => {
    const others = [{ front: 2000, category: "new" }, { front: 2000, category: "used" }];
    const without = calculatePay(plan, { units: 2, frontGross: 4000, backGross: 0, products: 0, dealRows: others });
    const withIt = calculatePay(plan, { units: 3, frontGross: 2250, backGross: 0, products: 0, dealRows: [...others, { front: -1750, category: "new" }] });
    expect(withIt.grossPay - without.grossPay).toBe(150);
  });

  it("volume ladder pays the best qualifying tier on top of per-deal money", () => {
    const rows = Array.from({ length: 12 }, () => ({ front: 2000, category: "new" }));
    const r = calculatePay(plan, { units: 12, frontGross: 24000, backGross: 0, products: 0, dealRows: rows });
    expect(r.grossPay).toBe(12 * 400 + 500);
  });

  it("stage-weighted rows scale a deal's contribution (forecast 'likely')", () => {
    const r = calculatePay(plan, {
      units: 1.5, frontGross: 3000, backGross: 0, products: 0,
      dealRows: [{ front: 2000, category: "new" }, { front: 2000, category: "new", weight: 0.5 }],
    });
    expect(r.grossCommission).toBe(400 + 200);
  });

  it("without dealRows, approximates from the monthly average and flags it", () => {
    const r = calculatePay(plan, { units: 2, frontGross: 4000, backGross: 0, products: 0 });
    // two average-$2,000 deals, but no categories → default segment mini ×2
    expect(r.grossCommission).toBe(300);
    expect(r.missingData.some((m) => m.includes("per-deal"))).toBe(true);
  });

  it("plans without perDeal are untouched (no dealRows sensitivity)", () => {
    const flat = makePlan({ role: "sales", base: { frontPct: 25, basis: "front" } });
    const a = calculatePay(flat, { units: 2, frontGross: 4000, backGross: 0, products: 0 });
    const b = calculatePay(flat, { units: 2, frontGross: 4000, backGross: 0, products: 0, dealRows: [{ front: 2000 }, { front: 2000 }] });
    expect(a.grossPay).toBe(1000);
    expect(b.grossPay).toBe(1000);
  });
});
