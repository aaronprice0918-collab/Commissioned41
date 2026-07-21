import { describe, it, expect } from "vitest";
import { calculatePay, classifyPlan } from "./calc";
import { makePlan, kennesawFinancePlan, defaultPlan } from "./plans";
import { PerfInput } from "./types";

const flat = makePlan({ role: "sales", base: { salary: 0, frontPct: 25, backPct: 5, perUnit: 0, basis: "total" }, goalUnits: 15 });
const tiered = makePlan({
  role: "sales",
  tiers: [
    { id: "u10", label: "10u", metric: "units", threshold: 10, kind: "flat", amount: 500 },
    { id: "u15", label: "15u", metric: "units", threshold: 15, kind: "flat", amount: 1250 },
  ],
});
const grid = kennesawFinancePlan();
const hybrid = makePlan({
  role: "finance",
  grid: grid.grid,
  tiers: [{ id: "u50", label: "50u", metric: "units", threshold: 50, kind: "flat", amount: 1000 }],
});

describe("classification", () => {
  it("flat / tiered / grid / hybrid", () => {
    expect(classifyPlan(flat)).toBe("flat");
    expect(classifyPlan(tiered)).toBe("tiered");
    expect(classifyPlan(grid)).toBe("grid"); // acceptance #1
    expect(classifyPlan(hybrid)).toBe("hybrid");
  });
});

describe("flat plan", () => {
  it("front/back %", () => {
    const r = calculatePay(flat, { units: 5, frontGross: 10000, backGross: 2000, products: 5 });
    expect(r.grossCommission).toBe(2600); // 25%*10000 + 5%*2000
    expect(r.grossPay).toBe(2600);
  });
});

describe("tiered plan", () => {
  it("best qualifying tier", () => {
    expect(calculatePay(tiered, { units: 12, frontGross: 0, backGross: 0, products: 0 }).grossPay).toBe(500);
    expect(calculatePay(tiered, { units: 15, frontGross: 0, backGross: 0, products: 0 }).grossPay).toBe(1250);
  });
  it("shows next tier", () => {
    const r = calculatePay(tiered, { units: 12, frontGross: 0, backGross: 0, products: 0 });
    expect(r.nextTiers.some((t) => t.to === 15 && t.addPay === 1250)).toBe(true);
  });
});

describe("grid plan (acceptance #3)", () => {
  it("looks up PVR 1300 × PPT 2.0 = 12.5%", () => {
    // 10 units, back 13000 → PVR 1300; 20 products → PPT 2.0
    const r = calculatePay(grid, { units: 10, frontGross: 0, backGross: 13000, products: 20 });
    expect(r.rate).toBe(12.5);
    expect(r.grossCommission).toBe(1625); // 12.5% * 13000
  });
  it("PVR $1,900+ adds 0.5% (acceptance #4)", () => {
    const r = calculatePay(grid, { units: 10, frontGross: 0, backGross: 20000, products: 20 });
    // PVR 2000 → col floors to 1700 → base 14.5 + 0.5 = 15.0
    expect(r.rate).toBe(15.0);
    expect(r.grossCommission).toBe(3000);
  });
  it("VSC penetration over 50% adds 0.5%", () => {
    const r = calculatePay(grid, { units: 10, frontGross: 0, backGross: 13000, products: 20, vscPenetration: 60 });
    expect(r.rate).toBe(13.0); // 12.5 + 0.5
  });
});

describe("penalties & deductions (acceptance #5)", () => {
  it("menu < 95% and CSI below region reduce gross pay; consecutive adds more", () => {
    const r = calculatePay(grid, { units: 10, frontGross: 0, backGross: 13000, products: 20, menuUsage: 90, csiBelowRegion: true, csiConsecutiveBelow: 3 });
    // gross 1625; menu -5% = -81.25; CSI -5% -3%*(3-1)= -11% = -178.75
    const menu = r.penalties.find((p) => p.label.includes("Menu"))!.amount;
    const csi = r.penalties.find((p) => p.label.includes("CSI"))!.amount;
    expect(menu).toBeCloseTo(-81.25, 2);
    expect(csi).toBeCloseTo(-178.75, 2); // 11% of 1625
  });
  it("$200 per uncashed contract", () => {
    const r = calculatePay(grid, { units: 10, frontGross: 0, backGross: 13000, products: 20, contractsNotCashed: 2 });
    expect(r.deductions.find((d) => d.label.includes("cashed"))!.amount).toBe(-400);
    expect(r.grossPay).toBe(1225); // 1625 - 400
  });
});

describe("draw (acceptance) & explanations", () => {
  it("draw offsets the check; steps explain each line", () => {
    const r = calculatePay(grid, { units: 10, frontGross: 0, backGross: 13000, products: 20 });
    expect(r.draw).toBe(8000);
    expect(r.drawOffset).toBe(1625);
    expect(r.remainderAfterDraw).toBe(0);
    expect(r.drawShortfall).toBe(6375); // 8000 advance - 1625 earned = still in the hole this month
    expect(r.drawOwed).toBe(6375); // no carried balance → the hole is just this month's shortfall
    expect(r.aboveDraw).toBe(0); // earned less than the advance → nothing above the draw
    expect(r.steps.length).toBeGreaterThan(2); // acceptance #6
  });
  it("carried-in draw balance rolls into the hole", () => {
    const r = calculatePay({ ...grid, drawCarriedIn: 2000 }, { units: 10, frontGross: 0, backGross: 13000, products: 20 });
    // earned 1625 against 2000 carried + 8000 advanced = 10000 owed → 8375 still owed
    expect(r.drawOwed).toBe(8375);
    expect(r.aboveDraw).toBe(0);
  });
  it("earning past the draw shows real money above the draw", () => {
    const r = calculatePay(grid, { units: 30, frontGross: 0, backGross: 100000, products: 90 });
    expect(r.grossPay).toBeGreaterThan(8000); // sanity: this scenario clears the draw
    expect(r.drawOwed).toBe(0); // hole is closed
    expect(r.drawShortfall).toBe(0);
    expect(r.aboveDraw).toBeCloseTo(Math.max(0, r.grossPay - 8000), 2); // the rest is a real check
  });
});

describe("next-tier opportunities (acceptance #7)", () => {
  it("suggests next PPU and PVR tiers with added pay", () => {
    const r = calculatePay(grid, { units: 10, frontGross: 0, backGross: 13000, products: 20 });
    const ppt = r.nextTiers.find((t) => t.axis === "ppt");
    const pvr = r.nextTiers.find((t) => t.axis === "pvr");
    expect(ppt && ppt.to).toBe(2.2);
    expect(pvr && pvr.to).toBe(1400);
    expect(ppt!.addPay).toBeGreaterThan(0);
  });
});

describe("never silently empty (acceptance #8)", () => {
  it("returns a structured result + missingData even with sparse perf", () => {
    const r = calculatePay(grid, { units: 0, frontGross: 0, backGross: 0, products: 0 });
    expect(r).toHaveProperty("grossPay");
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.missingData.length).toBeGreaterThan(0);
  });
});

describe("hybrid plan", () => {
  it("grid commission + a unit tier bonus both apply", () => {
    const r = calculatePay(hybrid, { units: 50, frontGross: 0, backGross: 65000, products: 100 });
    // PVR 1300, PPT 2.0 → 12.5% * 65000 = 8125; + 50u $1000
    expect(r.grossCommission).toBe(8125);
    expect(r.tierBonuses.find((t) => t.label === "50u")!.amount).toBe(1000);
    expect(r.grossPay).toBe(9125);
  });
});

describe("role defaults (acceptance #9 — existing flat plans still work)", () => {
  it("every role default calculates without error", () => {
    for (const role of ["sales", "finance", "sales_manager", "bdc"] as const) {
      const r = calculatePay(defaultPlan(role), { units: 12, frontGross: 18000, backGross: 14000, products: 22 } as PerfInput);
      expect(r.grossPay).toBeGreaterThanOrEqual(0);
    }
  });
});
