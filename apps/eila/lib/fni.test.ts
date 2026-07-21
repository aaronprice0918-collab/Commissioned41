import { describe, expect, it } from "vitest";
import { dealUnits, penetration, salespersonReport, spiffTotal } from "./fni";
import { Deal, ProductDef } from "./types";

const DEFS: ProductDef[] = [
  { id: "vsc", label: "VSC", units: 1, spiff: 120 },
  { id: "gap", label: "GAP", units: 1, spiff: 0 },
  { id: "nas", label: "NAS Combo", units: 5, spiff: 50 },
  { id: "maint", label: "Maintenance", units: 1, spiff: 25 },
];

function deal(p: Partial<Deal>): Deal {
  return {
    id: Math.random().toString(36).slice(2), date: "2026-07-10T12:00:00Z", customer: "C",
    item: "26 CX-5", amount: 1000, secondary: 2000, addons: 0, reserve: 300, status: "delivered",
    ...p,
  };
}

describe("dealUnits", () => {
  it("weights products by the user's own unit settings", () => {
    expect(dealUnits(deal({ products: ["vsc", "gap", "nas"] }), DEFS)).toBe(7);
  });
  it("falls back to the plain add-on count for older deals", () => {
    expect(dealUnits(deal({ addons: 3 }), DEFS)).toBe(3);
  });
  it("unknown product ids count as 1, not 0", () => {
    expect(dealUnits(deal({ products: ["mystery"] }), DEFS)).toBe(1);
  });
});

describe("spiffTotal", () => {
  it("sums flat spiffs per product sold", () => {
    const deals = [deal({ products: ["vsc", "nas"] }), deal({ products: ["vsc", "maint"] })];
    expect(spiffTotal(deals, DEFS)).toBe(120 + 50 + 120 + 25);
  });
});

describe("penetration", () => {
  it("computes share of deals carrying each product", () => {
    const deals = [deal({ products: ["vsc"] }), deal({ products: ["vsc", "gap"] }), deal({ products: [] }), deal({})];
    const p = penetration(deals, DEFS);
    expect(p.find((x) => x.def.id === "vsc")?.pct).toBeCloseTo(0.5);
    expect(p.find((x) => x.def.id === "gap")?.pct).toBeCloseTo(0.25);
  });
});

describe("salespersonReport", () => {
  it("credits split deals 50/50 to both names", () => {
    const rows = salespersonReport(
      [deal({ salesperson: "Noel", salesperson2: "Shaun", secondary: 4000, reserve: 0, products: ["nas"] })],
      DEFS,
    );
    const noel = rows.find((r) => r.name === "Noel")!;
    const shaun = rows.find((r) => r.name === "Shaun")!;
    expect(noel.retail).toBe(0.5);
    expect(shaun.retail).toBe(0.5);
    expect(noel.fniGross).toBe(2000);
    expect(noel.productUnits).toBe(2.5);
  });

  it("no-qualify deals keep the unit but carry $0 F&I credit", () => {
    const rows = salespersonReport([deal({ salesperson: "Rick", noQualify: true, secondary: 3000, reserve: 500 })], DEFS);
    expect(rows[0].retail).toBe(1);
    expect(rows[0].fniGross).toBe(0);
  });

  it("merges the same name regardless of case/spacing and ranks by gross", () => {
    const rows = salespersonReport(
      [
        deal({ salesperson: "tony", secondary: 1000, reserve: 0 }),
        deal({ salesperson: "Tony ", secondary: 2000, reserve: 0 }),
        deal({ salesperson: "Joshua", secondary: 9000, reserve: 0 }),
      ],
      DEFS,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Joshua");
    expect(rows[1].retail).toBe(2);
    expect(rows[1].fniGross).toBe(3000);
  });

  it("credits back gross only — reserve is informational, never double-counted", () => {
    const rows = salespersonReport([deal({ salesperson: "Watson", secondary: 1400, reserve: 300 })], DEFS);
    expect(rows[0].fniGross).toBe(1400);
  });
});

// Pace over WORKING days — Aaron's month: closed Sundays, off Tuesdays.
import { forecast, workingDays } from "./engine";
import { defaultPlan } from "./payplan/plans";
describe("working-day pace", () => {
  const july3 = new Date(2026, 6, 3, 20, 0, 0); // Fri July 3, 2026
  const sevenDeals = Array.from({ length: 7 }, (_, i) => deal({ id: String(i), date: "2026-07-02T12:00:00Z" }));
  const plan = defaultPlan("sales");
  it("counts July 2026 working days for Sun+Tue off", () => {
    expect(workingDays(july3, 31, [0, 2])).toBe(23);
    expect(workingDays(july3, 3, [0, 2])).toBe(3);
    expect(workingDays(july3, 31, [])).toBe(31);
  });
  it("paces over working days, not the calendar, with today counted by clock time", () => {
    // Fri 8pm: 2 full days worked + 20/24 of today = 2.83 → 7/2.83 ≈ 2.47/day.
    expect(forecast(plan, sevenDeals, july3, [0, 2]).paceUnits).toBe(57); // × 23 working days
    expect(forecast(plan, sevenDeals, july3, []).paceUnits).toBe(77); // × 31 calendar days
  });
  it("does not cliff at midnight — Sat 12:00am matches Fri 11:59pm", () => {
    const friNight = forecast(plan, sevenDeals, new Date(2026, 6, 3, 23, 59, 0), [0, 2]).paceUnits;
    const satMidnight = forecast(plan, sevenDeals, new Date(2026, 6, 4, 0, 0, 0), [0, 2]).paceUnits;
    expect(friNight).toBe(54);
    expect(satMidnight).toBe(54);
  });
  it("Sat July 4 12:41pm: 7 sold reads ~46, not the old full-day 40", () => {
    // 3 full days + 761/1440 of today = 3.53 worked → 7/3.53 × 23 ≈ 45.6.
    expect(forecast(plan, sevenDeals, new Date(2026, 6, 4, 12, 41, 0), [0, 2]).paceUnits).toBe(46);
  });
  it("an off day adds nothing as it elapses", () => {
    // Sun July 5 is off: pace holds all day at Saturday's close-of-day rate.
    const sunday = forecast(plan, sevenDeals, new Date(2026, 6, 5, 15, 0, 0), [0, 2]).paceUnits;
    expect(sunday).toBe(forecast(plan, sevenDeals, new Date(2026, 6, 4, 23, 59, 0), [0, 2]).paceUnits);
  });
});
