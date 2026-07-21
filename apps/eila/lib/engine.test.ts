import { describe, it, expect } from "vitest";
import { forecast, dealTotals, money, monthBounds, isThisMonth, perfFromDeals, dayBounds, followUpQueue, isProductOnly } from "./engine";
import { kennesawFinancePlan, makePlan } from "./payplan/plans";
import { Deal, DealStatus } from "./types";

// ---- fixtures -------------------------------------------------------------

// A simple flat sales plan: 25% of front, 5% of back, $50/product, goal 15.
const salesPlan = makePlan({
  role: "sales",
  base: { salary: 0, frontPct: 25, backPct: 5, perUnit: 0, perProduct: 50, basis: "total" },
  goalUnits: 15,
  confidence: 0.9,
});

// Fixed "now" mid-month so pace math is deterministic. June 15, 2025 → 30-day
// month, day 15, 15 days remaining.
const NOW = new Date("2025-06-15T12:00:00");

let seq = 0;
function deal(p: Partial<Deal> & { status: DealStatus; amount: number; secondary: number; addons: number }): Deal {
  seq += 1;
  return {
    id: `d${seq}`,
    date: "2025-06-05T10:00:00",
    customer: `Cust ${seq}`,
    item: "CX-5",
    category: "new",
    reserve: 0,
    ...p,
  };
}

describe("product-only deals (no core sale)", () => {
  it("flags only deals explicitly marked productOnly (amount 0 alone is an F&I deal, not product-only)", () => {
    expect(isProductOnly(deal({ status: "delivered", amount: 0, secondary: 1100, addons: 2, productOnly: true }))).toBe(true);
    expect(isProductOnly(deal({ status: "delivered", amount: 0, secondary: 1100, addons: 2 }))).toBe(false); // F&I-only deal, still a car
    expect(isProductOnly(deal({ status: "delivered", amount: 2000, secondary: 1000, addons: 1 }))).toBe(false);
  });

  it("counts back gross toward PVR and add-ons toward PPU, but not as a unit", () => {
    const t = dealTotals([
      deal({ status: "delivered", amount: 2000, secondary: 1000, addons: 1 }), // real car
      deal({ status: "delivered", amount: 0, secondary: 1100, addons: 2, productOnly: true }), // product-only
    ]);
    expect(t.units).toBe(1); // product-only is not a unit
    expect(t.secondary).toBe(2100); // 1000 + 1100 back gross both count
    expect(t.avgSecondary).toBe(2100); // PVR = 2100 / 1 car — product income lifts it
    expect(t.addons).toBe(3); // 1 + 2 add-ons both count
    expect(t.addonsPerUnit).toBe(3); // PPU = 3 / 1 car
    expect(t.perUnit).toBe(4100); // (2000 + 2100) / 1
  });
});

describe("money()", () => {
  it("formats whole dollars, no cents", () => {
    expect(money(1625)).toBe("$1,625");
    expect(money(0)).toBe("$0");
  });
  it("uses a minus glyph for negatives", () => {
    expect(money(-400)).toBe("−$400");
  });
});

describe("monthBounds()", () => {
  it("computes day/days-remaining for a 30-day month", () => {
    const b = monthBounds(NOW);
    expect(b.daysInMonth).toBe(30);
    expect(b.dayOfMonth).toBe(15);
    expect(b.daysRemaining).toBe(15);
  });
  it("handles a 31-day month and end-of-month", () => {
    const b = monthBounds(new Date("2025-07-31T12:00:00"));
    expect(b.daysInMonth).toBe(31);
    expect(b.dayOfMonth).toBe(31);
    expect(b.daysRemaining).toBe(0);
  });
});

describe("dayBounds() / followUpQueue() — timezone-aware bucketing", () => {
  it("anchors the day in the given zone, not UTC", () => {
    // 2026-07-16T01:00Z is still 2026-07-15 in US-Eastern (21:00 EDT).
    const at = new Date("2026-07-16T01:00:00Z");
    const et = dayBounds(at, "America/New_York");
    // ET midnight July 15 = 04:00Z July 15; end = 03:59:59.999Z July 16.
    expect(et.start.toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(et.end.toISOString()).toBe("2026-07-16T03:59:59.999Z");
  });

  it("a touch set for 'tonight ET' is due today under ET, overdue under UTC", () => {
    const now = new Date("2026-07-16T01:00:00Z"); // 9pm ET on the 15th
    // Follow-up at 6pm ET on the 15th (2026-07-15T22:00Z).
    const deals = [{ id: "d1", date: "2026-07-01T12:00:00Z", customer: "A", item: "", amount: 0, secondary: 0, addons: 0, reserve: 0, status: "working" as DealStatus, followUpAt: "2026-07-15T22:00:00Z" }];
    const et = followUpQueue(deals, now, "America/New_York");
    expect(et.dueToday.length).toBe(1); // correct: it's still "today" for the rep
    const utc = followUpQueue(deals, now, "UTC"); // server-UTC bucketing: already rolled to the 16th
    expect(utc.overdue.length).toBe(1); // the drift the fix removes when the rep's zone is used
  });
});

describe("isThisMonth()", () => {
  it("true for same month, false for adjacent months", () => {
    expect(isThisMonth("2025-06-30T23:00:00", NOW)).toBe(true);
    expect(isThisMonth("2025-05-31T23:00:00", NOW)).toBe(false);
    expect(isThisMonth("2025-07-01T01:00:00", NOW)).toBe(false);
  });
});

describe("dealTotals()", () => {
  it("sums units / front / back / products and derives per-copy & PPU & PVR", () => {
    const deals = [
      deal({ status: "delivered", amount: 1000, secondary: 1500, addons: 2 }),
      deal({ status: "delivered", amount: 2000, secondary: 1000, addons: 4 }),
    ];
    const t = dealTotals(deals);
    expect(t.units).toBe(2);
    expect(t.primary).toBe(3000);
    expect(t.secondary).toBe(2500);
    expect(t.gross).toBe(5500);
    expect(t.addons).toBe(6);
    expect(t.perUnit).toBe(2750); // 5500 / 2
    expect(t.addonsPerUnit).toBe(3); // 6 / 2
    expect(t.avgSecondary).toBe(1250); // back 2500 / 2
  });
  it("returns zeros (no divide-by-zero) for an empty list", () => {
    const t = dealTotals([]);
    expect(t).toMatchObject({ units: 0, primary: 0, secondary: 0, gross: 0, addons: 0, perUnit: 0, addonsPerUnit: 0, avgSecondary: 0 });
  });
});

describe("perfFromDeals()", () => {
  it("maps deal aggregates onto the engine PerfInput, deal rows riding along for perDeal rules", () => {
    const deals = [deal({ status: "delivered", amount: 4000, secondary: 2000, addons: 5 })];
    expect(perfFromDeals(deals)).toEqual({
      units: 1, frontGross: 4000, backGross: 2000, products: 5,
      dealRows: [{ front: 4000, category: deals[0].category || undefined }],
      fastStartUnits: Number(deals[0].date.slice(8, 10)) <= 15 ? 1 : 0,
    });
  });
});

describe("forecast() — delivered vs pipeline split", () => {
  it("counts only delivered into totals; everything live but un-delivered is pipeline", () => {
    const deals = [
      deal({ status: "delivered", amount: 2000, secondary: 1000, addons: 3 }),
      deal({ status: "delivered", amount: 2000, secondary: 1000, addons: 3 }),
      deal({ status: "working", amount: 2000, secondary: 1000, addons: 3 }),
      deal({ status: "pending", amount: 2000, secondary: 1000, addons: 3 }),
    ];
    const f = forecast(salesPlan, deals, NOW);
    expect(f.counted.length).toBe(2);
    expect(f.pipeline.length).toBe(2);
    expect(f.totals.units).toBe(2);
  });

  it("excludes dead deals and deals from other months entirely", () => {
    const deals = [
      deal({ status: "delivered", amount: 2000, secondary: 1000, addons: 3 }),
      deal({ status: "dead", amount: 5000, secondary: 5000, addons: 9 }),
      deal({ status: "working", date: "2025-05-10T10:00:00", amount: 9000, secondary: 9000, addons: 9 }), // last month
      deal({ status: "delivered", date: "2025-07-02T10:00:00", amount: 9000, secondary: 9000, addons: 9 }), // next month
    ];
    const f = forecast(salesPlan, deals, NOW);
    expect(f.counted.length).toBe(1);
    expect(f.pipeline.length).toBe(0); // dead excluded, other-month working excluded
    expect(f.totals.gross).toBe(3000);
  });
});

describe("forecast() — banked / likely / best", () => {
  it("current is banked (delivered only); best includes all pipeline; likely sits between", () => {
    const deals = [
      // 1 delivered: front 4000 back 2000 → 25%*4000 + 5%*2000 + 50*2 products = 1000+100+100 = 1200
      deal({ status: "delivered", amount: 4000, secondary: 2000, addons: 2 }),
      // pipeline "pending" (weight 0.8): same economics
      deal({ status: "pending", amount: 4000, secondary: 2000, addons: 2 }),
    ];
    const f = forecast(salesPlan, deals, NOW);
    expect(f.current.grossPay).toBe(1200); // banked, delivered only
    expect(f.best.grossPay).toBe(2400); // both deals fully counted
    // likely = delivered + 0.8 * pipeline = 1200 + 0.8*1200 = 2160
    expect(f.likely.grossPay).toBeCloseTo(2160, 2);
    // ordering invariant: banked <= likely <= best
    expect(f.current.grossPay).toBeLessThanOrEqual(f.likely.grossPay);
    expect(f.likely.grossPay).toBeLessThanOrEqual(f.best.grossPay);
  });

  it("weights pipeline by stage: a 'finance' deal (0.9) contributes more than a 'prospect' (0.1)", () => {
    const base = { amount: 4000, secondary: 2000, addons: 2 };
    const financeDeals = [deal({ status: "delivered", ...base }), deal({ status: "finance", ...base })];
    const prospectDeals = [deal({ status: "delivered", ...base }), deal({ status: "prospect", ...base })];
    const fFin = forecast(salesPlan, financeDeals, NOW);
    const fPro = forecast(salesPlan, prospectDeals, NOW);
    // same banked, but the finance-stage pipeline lifts "likely" higher
    expect(fFin.current.grossPay).toBe(fPro.current.grossPay);
    expect(fFin.likely.grossPay).toBeGreaterThan(fPro.likely.grossPay);
    // finance 0.9: 1200 + 0.9*1200 = 2280 ; prospect 0.1: 1200 + 0.1*1200 = 1320
    expect(fFin.likely.grossPay).toBeCloseTo(2280, 2);
    expect(fPro.likely.grossPay).toBeCloseTo(1320, 2);
  });

  it("with no pipeline, likely and best collapse to current", () => {
    const deals = [deal({ status: "delivered", amount: 4000, secondary: 2000, addons: 2 })];
    const f = forecast(salesPlan, deals, NOW);
    expect(f.likely.grossPay).toBe(f.current.grossPay);
    expect(f.best.grossPay).toBe(f.current.grossPay);
  });

  it("feeds logged VSC penetration into the Kennesaw F&I 50% bonus", () => {
    const backs = [...Array(9).fill(1151.2), 1151.19]; // $11,511.99 total
    const addons = [3, 3, 3, 3, 3, 3, 3, 3, 2, 2]; // 28 products / 10 deals = 2.8 PPU
    const deals = backs.map((secondary, i) =>
      deal({ status: "delivered", amount: 0, secondary, addons: addons[i], ...(i < 5 ? { products: ["vsc"] } : {}) })
    );
    const f = forecast(kennesawFinancePlan(), deals, NOW);
    expect(f.current.rate).toBe(13.5);
    expect(f.current.grossPay).toBe(1554.12);
    expect(f.likely.grossPay).toBe(1554.12);
  });
});

describe("forecast() — pace", () => {
  it("extrapolates delivered units across the full month", () => {
    // 3 delivered by day 15 of a 30-day month → pace 6 units
    const deals = [
      deal({ status: "delivered", amount: 1000, secondary: 500, addons: 1 }),
      deal({ status: "delivered", amount: 1000, secondary: 500, addons: 1 }),
      deal({ status: "delivered", amount: 1000, secondary: 500, addons: 1 }),
    ];
    const f = forecast(salesPlan, deals, NOW);
    expect(f.paceUnits).toBe(6); // round(3/15 * 30)
    // pacePay scales the banked pay by the same factor (2x): banked = 25%*3000 + 5%*1500 + 50*3 = 750+75+150 = 975
    expect(f.current.grossPay).toBe(975);
    expect(f.pacePay).toBeCloseTo(1950, 2);
  });

  it("pace is zero units and pacePay falls back to banked when nothing is delivered", () => {
    const deals = [deal({ status: "working", amount: 4000, secondary: 2000, addons: 2 })];
    const f = forecast(salesPlan, deals, NOW);
    expect(f.paceUnits).toBe(0);
    expect(f.current.grossPay).toBe(0);
    expect(f.pacePay).toBe(0);
  });
});

describe("forecast() — confidence", () => {
  it("rises with more elapsed month and a deeper pipeline, and stays within [0.1, 0.97]", () => {
    const thin = forecast(salesPlan, [deal({ status: "delivered", amount: 1000, secondary: 500, addons: 1 })], NOW);
    const deepPipeline = [
      deal({ status: "delivered", amount: 1000, secondary: 500, addons: 1 }),
      deal({ status: "working", amount: 1000, secondary: 500, addons: 1 }),
      deal({ status: "working", amount: 1000, secondary: 500, addons: 1 }),
      deal({ status: "working", amount: 1000, secondary: 500, addons: 1 }),
      deal({ status: "working", amount: 1000, secondary: 500, addons: 1 }),
      deal({ status: "working", amount: 1000, secondary: 500, addons: 1 }),
    ];
    const deep = forecast(salesPlan, deepPipeline, NOW);
    expect(deep.confidence).toBeGreaterThan(thin.confidence);
    for (const c of [thin.confidence, deep.confidence]) {
      expect(c).toBeGreaterThanOrEqual(0.1);
      expect(c).toBeLessThanOrEqual(0.97);
    }
  });
});
