import { describe, it, expect } from "vitest";
import {
  computeSpiffs,
  tierRate,
  fniSpiffInput,
  KENNESAW_SPIFFS,
  type SpiffInput,
  type SpiffTier,
} from "./spiffs";
import type { Deal, DealStatus, ProductDef } from "../types";
import { DEFAULT_AUTO_PRODUCTS } from "../fni";

// The spiff layer is money, so it gets the same treatment the commission engine
// gets: the numbers below are transcribed from THE LOGG (Aaron's Kennesaw Mazda
// F&I pay tracker) and the engine must reproduce them to the dollar.

describe("tierRate — highest penetration tier at/below the % wins, else $0", () => {
  const tiers: SpiffTier[] = [
    { minPct: 40, rate: 25 },
    { minPct: 50, rate: 30 },
    { minPct: 60, rate: 40 },
  ];
  it("pays $0 below the lowest tier", () => {
    expect(tierRate(39.9, tiers)).toBe(0);
    expect(tierRate(0, tiers)).toBe(0);
  });
  it("picks the highest qualifying tier", () => {
    expect(tierRate(40, tiers)).toBe(25);
    expect(tierRate(49.9, tiers)).toBe(25);
    expect(tierRate(50, tiers)).toBe(30);
    expect(tierRate(59.9, tiers)).toBe(30);
    expect(tierRate(60, tiers)).toBe(40);
    expect(tierRate(100, tiers)).toBe(40);
  });
  it("does not depend on tier order in the config array", () => {
    const shuffled: SpiffTier[] = [
      { minPct: 60, rate: 40 },
      { minPct: 40, rate: 25 },
      { minPct: 50, rate: 30 },
    ];
    expect(tierRate(55, shuffled)).toBe(30);
  });
});

describe("computeSpiffs — THE LOGG current month (PVR $1,496)", () => {
  // THE LOGG this month: 22 retail, PPU 3.18, PVR $1,496 — below the $1,550 TWS
  // floor, so ONLY the ungated NAS Combo spiff pays. 10 combos × $50 = $500.
  const input: SpiffInput = {
    ppu: 3.18,
    pvr: 1496,
    counts: { vsc: 11, gap: 3, combo: 10, maint: 6, other: 0 },
    penetrations: { vsc: 50, gap: 13.6, maint: 27.3, other: 0 },
  };
  const r = computeSpiffs(KENNESAW_SPIFFS, input);

  it("pays NAS Combo flat — 10 × $50 = $500", () => {
    expect(r.flatTotal).toBe(500);
  });
  it("locks the TWS package because PVR $1,496 < $1,550", () => {
    expect(r.gatedQualified).toBe(false);
    expect(r.gatedTotal).toBe(0);
  });
  it("totals $500 — matching THE LOGG's spiff line this month", () => {
    expect(r.total).toBe(500);
  });
  it("labels the locked TWS lines so EILA can explain why they're $0", () => {
    const vsc = r.lines.find((l) => l.id === "vsc")!;
    expect(vsc.amount).toBe(0);
    expect(vsc.note).toContain("locked");
    expect(vsc.note).toContain("1,550");
  });
});

describe("computeSpiffs — THE LOGG once PVR clears $1,550 (TWS unlocks)", () => {
  // Same product mix, but PVR nudged to the $1,550 floor: the gated package now
  // pays, each product at its penetration tier.
  //   VSC  50% → $30 × 11 = $330
  //   Maint 27.3% → $15 × 6 = $90   (20-39% tier)
  //   GAP  13.6% → $0 × 3  = $0     (below the 30% floor)
  //   Road Hazard 0% → $0
  //   TWS package = $420; + NAS $500 = $920 total.
  const input: SpiffInput = {
    ppu: 3.18,
    pvr: 1550,
    counts: { vsc: 11, gap: 3, combo: 10, maint: 6, other: 0 },
    penetrations: { vsc: 50, gap: 13.6, maint: 27.3, other: 0 },
  };
  const r = computeSpiffs(KENNESAW_SPIFFS, input);

  it("qualifies the TWS package at the $1,550 / PPU 2.0 gate", () => {
    expect(r.gatedQualified).toBe(true);
  });
  it("pays VSC 11 × $30 (50% tier) = $330", () => {
    expect(r.lines.find((l) => l.id === "vsc")!.amount).toBe(330);
  });
  it("pays Maintenance 6 × $15 (20-39% tier) = $90", () => {
    expect(r.lines.find((l) => l.id === "maint")!.amount).toBe(90);
  });
  it("pays GAP $0 — 13.6% is below the 30% floor", () => {
    expect(r.lines.find((l) => l.id === "gap")!.amount).toBe(0);
  });
  it("TWS package totals $420 and grand total is $920", () => {
    expect(r.gatedTotal).toBe(420);
    expect(r.total).toBe(920);
  });
});

describe("computeSpiffs — PPU floor also gates the package", () => {
  it("locks TWS when PVR clears but PPU is under 2.0", () => {
    const r = computeSpiffs(KENNESAW_SPIFFS, {
      ppu: 1.9,
      pvr: 2000,
      counts: { vsc: 11, combo: 10 },
      penetrations: { vsc: 60 },
    });
    expect(r.gatedQualified).toBe(false);
    expect(r.gatedTotal).toBe(0);
    expect(r.flatTotal).toBe(500); // NAS still pays, ungated
  });
});

describe("fniSpiffInput — derives the SpiffInput from a month of deals", () => {
  const defs: ProductDef[] = DEFAULT_AUTO_PRODUCTS;
  function deal(secondary: number, products: string[], noQualify = false): Deal {
    return {
      id: `d${Math.round(secondary)}${products.join("")}${noQualify}`,
      date: "2026-07-10T12:00:00Z",
      customer: "C",
      item: "",
      amount: 0,
      secondary,
      addons: 0,
      reserve: 0,
      status: "delivered" as DealStatus,
      products,
      noQualify,
    };
  }

  it("counts products, computes penetration %, PPU and PVR", () => {
    // 4 deals: back gross 2000/1500/1000/500 = 5000 over 4 = PVR $1,250.
    // vsc on 2 → 50% pen; gap on 1 → 25% pen; combo on 3.
    const deals = [
      deal(2000, ["vsc", "combo"]),
      deal(1500, ["vsc", "gap", "combo"]),
      deal(1000, ["combo"]),
      deal(500, []),
    ];
    const input = fniSpiffInput(deals, defs);
    expect(input.counts.vsc).toBe(2);
    expect(input.counts.gap).toBe(1);
    expect(input.counts.combo).toBe(3);
    expect(input.penetrations.vsc).toBeCloseTo(50, 5);
    expect(input.penetrations.gap).toBeCloseTo(25, 5);
    expect(input.pvr).toBeCloseTo(1250, 5); // 5000 / 4
    // PPU: (2 + 3 + 1 + 0) product units over 4 deals = 1.5
    expect(input.ppu).toBeCloseTo(1.5, 5);
  });

  it("no-qualify deals keep their unit but carry $0 back gross (drags PVR)", () => {
    const deals = [deal(2000, ["vsc"]), deal(0, ["vsc"], true)];
    const input = fniSpiffInput(deals, defs);
    expect(input.pvr).toBeCloseTo(1000, 5); // 2000 / 2, the no-qualify deal adds $0
    expect(input.counts.vsc).toBe(2);
    expect(input.penetrations.vsc).toBeCloseTo(100, 5);
  });

  it("empty month divides by nothing without NaN", () => {
    const input = fniSpiffInput([], defs);
    expect(input.ppu).toBe(0);
    expect(input.pvr).toBe(0);
    expect(input.counts).toEqual({});
  });
});
