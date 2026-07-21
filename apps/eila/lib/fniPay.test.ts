import { describe, it, expect } from "vitest";
import { fniPayPicture, isFinanceGridPlan } from "./fniPay";
import { kennesawFinancePlan, defaultPlan } from "./payplan/plans";
import { DEFAULT_AUTO_PRODUCTS, dealUnits } from "./fni";
import type { Deal, DealStatus, Profile } from "./types";

// fniPayPicture is the ASSEMBLY seam — the two money engines are each proven on
// their own (kennesawAudit.test.ts for commission, spiffs.test.ts for spiffs).
// Here we prove the stitch: both flow in, the F&I-grid gate works, and the
// combined totals add up the way THE LOGG reads them.

function financeProfile(): Profile {
  return {
    name: "Aaron",
    role: "finance",
    industry: "automotive",
    plan: kennesawFinancePlan(),
    createdAt: "2026-07-01T00:00:00Z",
  };
}

function deal(secondary: number, products: string[]): Deal {
  const base = {
    id: `d${Math.round(secondary)}${products.join("")}`,
    date: "2026-07-10T12:00:00Z",
    customer: "C",
    item: "",
    amount: 0,
    secondary,
    addons: 0,
    reserve: 0,
    status: "delivered" as DealStatus,
    products,
  };
  // The app keeps addons synced to product-units (AddDeal/DealDetail/ila-hands);
  // the grid engine reads PPU from addons, so mirror that here.
  return { ...base, addons: dealUnits(base, DEFAULT_AUTO_PRODUCTS) };
}

describe("isFinanceGridPlan — only F&I back-end grid plans get the spiff layer", () => {
  it("is true for the Kennesaw finance grid plan", () => {
    expect(isFinanceGridPlan(kennesawFinancePlan())).toBe(true);
  });
  it("is false for a front-end sales plan", () => {
    expect(isFinanceGridPlan(defaultPlan("sales"))).toBe(false);
  });
  it("is false for null", () => {
    expect(isFinanceGridPlan(null)).toBe(false);
  });
});

describe("fniPayPicture — stitches grid commission + spiffs + draw", () => {
  // 4 delivered deals, each $1,600 back gross with VSC + Combo:
  //   PVR $1,600 (clears the $1,550 TWS gate), PPU 2.0 (clears the 2.0 gate).
  //   Grid: PVR col $1,600 × PPU row 2.0 = 14.0% base; VSC pen 100% → +0.5% = 14.5%.
  //   Commission = $6,400 back × 14.5% = $928.
  //   NAS flat: 4 combos × $50 = $200.
  //   VSC spiff (gated): 100% pen → $40 tier × 4 = $160.
  //   Spiffs total = $360.
  const pic = fniPayPicture(financeProfile(), [
    deal(1600, ["vsc", "combo"]),
    deal(1600, ["vsc", "combo"]),
    deal(1600, ["vsc", "combo"]),
    deal(1600, ["vsc", "combo"]),
  ])!;

  it("returns a picture for a finance grid plan", () => {
    expect(pic).not.toBeNull();
    expect(pic.units).toBe(4);
  });
  it("derives PVR $1,600 and PPU 2.0 from the deals", () => {
    expect(pic.pvr).toBeCloseTo(1600, 5);
    expect(pic.ppu).toBeCloseTo(2.0, 5);
  });
  it("reproduces the grid commission — 14.0% base + 0.5% VSC bonus on $6,400", () => {
    expect(pic.pay.rateBreakdown!.base).toBe(14.0);
    expect(pic.pay.rateBreakdown!.bonusRate).toBe(0.5);
    expect(pic.pay.grossCommission).toBeCloseTo(928, 5);
  });
  it("qualifies and pays the spiff layer — NAS $200 + VSC $160 = $360", () => {
    expect(pic.spiffs.gatedQualified).toBe(true);
    expect(pic.spiffs.flatTotal).toBe(200);
    expect(pic.spiffs.lines.find((l) => l.id === "vsc")!.amount).toBe(160);
    expect(pic.spiffs.total).toBe(360);
  });
  it("total earned = commission earned + spiffs (spiffs on top, not advanced)", () => {
    expect(pic.totalEarned).toBeCloseTo(pic.pay.grossPay + 360, 5);
    expect(pic.aboveDrawWithSpiffs).toBeCloseTo(pic.pay.aboveDraw + 360, 5);
  });
});

describe("fniPayPicture — returns null off the F&I grid", () => {
  it("a sales rep has no F&I spiff picture", () => {
    const p: Profile = { ...financeProfile(), role: "sales", plan: defaultPlan("sales") };
    expect(fniPayPicture(p, [deal(1600, ["vsc"])])).toBeNull();
  });
});
