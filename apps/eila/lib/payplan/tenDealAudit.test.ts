import { describe, expect, it } from "vitest";
import { calculatePay } from "./calc";
import { makePlan, kennesawFinancePlan } from "./plans";
import { PayPlan } from "./types";
import { forecast, perfFromDeals } from "../engine";
import { Deal, STATUS_WEIGHT } from "../types";

// ============================================================================
// THE TEN-DEAL AUDIT (Aaron, July 8 2026): "I want math tested. I want ten
// deals... front to back, back to front. Tell me the exact truth."
//
// Ten realistic F&I deals run through four plan shapes. The engine is checked
// against an INDEPENDENT oracle — plain arithmetic written here, not shared
// with lib/payplan/calc.ts — so an engine bug can't hide by agreeing with
// itself. Front-to-back: deals land one at a time and every prefix is checked
// to the cent. Back-to-front: every deal is pulled OUT of the finished month
// and the with-vs-without delta (DealDetail's number) is checked to the cent.
// ============================================================================

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

// --- the ten deals: fronts, backs, product counts a real month could hold ---
// Includes the hard cases: a $0-back finance deal (Kenneth — the real deal
// that showed −$44), a $0-front loser, a cash deal, and a monster back.
const TEN: { name: string; front: number; back: number; products: number; day: number }[] = [
  { name: "Marcus Bell", front: 3000, back: 2400, products: 2, day: 1 },
  { name: "Tina Alvarez", front: 1200, back: 1500, products: 1, day: 3 },
  { name: "Kenneth West", front: 3251, back: 0, products: 0, day: 5 }, // $0-back
  { name: "Dwight Soto", front: 0, back: 400, products: 0, day: 8 }, // loser
  { name: "Renee Park", front: 500, back: 3200, products: 3, day: 10 },
  { name: "Jamal Carter", front: 900, back: 0, products: 0, day: 14 }, // cash
  { name: "Priya Nair", front: 2000, back: 1800, products: 2, day: 17 },
  { name: "Ben Whitfield", front: 1500, back: 1100, products: 1, day: 20 },
  { name: "Gloria Mendez", front: 800, back: 2600, products: 2, day: 23 },
  { name: "Tyler Roads", front: 1100, back: 900, products: 1, day: 26 },
];

const NOW = new Date("2026-07-28T12:00:00");
const deal = (t: (typeof TEN)[number], status: Deal["status"] = "delivered"): Deal => ({
  id: `t-${t.name.replace(/\s/g, "")}`,
  date: `2026-07-${String(t.day).padStart(2, "0")}T10:00:00.000Z`,
  customer: t.name,
  item: "CX-5",
  category: undefined,
  amount: t.front,
  secondary: t.back,
  addons: t.products,
  reserve: 0,
  status,
});
const DEALS = TEN.map((t) => deal(t));

// Walk any result object and flag NaN/Infinity anywhere — the "cobwebs" net.
function assertFiniteDeep(o: unknown, path = "result"): void {
  if (typeof o === "number") {
    expect(Number.isFinite(o), `${path} is ${o}`).toBe(true);
  } else if (Array.isArray(o)) {
    o.forEach((v, i) => assertFiniteDeep(v, `${path}[${i}]`));
  } else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) assertFiniteDeep(v, `${path}.${k}`);
  }
}

// ---------------------------------------------------------------------------
// PLAN A — a transparent PVR×PPU grid (back basis) with a +0.5% PVR $1,900+
// kicker, an $8k recoverable draw, 24% tax. Numbers chosen so tier crossings
// are hand-checkable.
// ---------------------------------------------------------------------------
const GX = [0, 800, 1200, 1600, 2000]; // PVR thresholds
const GY = [0, 1, 1.5, 2]; // PPU thresholds
const GR = [
  [8, 9, 10, 11, 12],
  [9, 10, 11, 12, 13],
  [10, 11, 12.5, 14, 15],
  [11, 12, 14, 15.5, 17],
];
const planA = (): PayPlan =>
  makePlan({
    role: "finance",
    grid: { xAxis: "pvr", x: GX, yAxis: "ppt", y: GY, rates: GR, basis: "back" },
    bonuses: [{ id: "pvr1900", label: "PVR $1,900+", condition: { metric: "pvr", op: "gte", value: 1900 }, effect: { kind: "addRatePct", amount: 0.5 } }],
    draw: { amount: 8000, period: "monthly", recoverable: true },
    taxRate: 24,
    goalUnits: 10,
  });

// The independent oracle: its own tier lookup, its own arithmetic.
const idx = (ths: number[], v: number) => { let i = 0; for (let k = 0; k < ths.length; k++) if (v >= ths[k]) i = k; return i; };
function oracleGrid(ds: Deal[], x: number[], y: number[], rates: number[][], pvrKicker: number): number {
  const u = ds.length;
  const back = sum(ds.map((d) => d.secondary));
  const prods = sum(ds.map((d) => d.addons));
  const pvr = u ? back / u : 0;
  const ppu = u ? prods / u : 0;
  const rate = (rates[idx(y, ppu)]?.[idx(x, pvr)] ?? 0) + (pvr >= 1900 ? pvrKicker : 0);
  return r2(Math.max(0, (back * rate) / 100));
}
const oracleA = (ds: Deal[]) => oracleGrid(ds, GX, GY, GR, 0.5);

// ---------------------------------------------------------------------------
// PLAN B — flat: 25% front + 5% back + $50/unit. Perfectly linear, so every
// deal's marginal value is exact: 0.25·front + 0.05·back + 50.
// ---------------------------------------------------------------------------
const planB = (): PayPlan => makePlan({ role: "sales", base: { frontPct: 25, backPct: 5, perUnit: 50, basis: "total" } });
const oracleB = (ds: Deal[]) => r2(sum(ds.map((d) => 0.25 * d.amount + 0.05 * d.secondary + 50)));

// ---------------------------------------------------------------------------
// PLAN C — per-deal bands (each deal paid on ITS OWN front, floored at a $150
// mini) + a 10-unit $500 volume bonus.
// ---------------------------------------------------------------------------
const planC = (): PayPlan =>
  makePlan({
    role: "sales",
    perDeal: { minFlat: 150, default: { bands: [{ min: 1000, pct: 20 }, { min: 2000, pct: 25 }] } },
    tiers: [{ id: "u10", label: "10-unit bonus", metric: "units", threshold: 10, kind: "flat", amount: 500 }],
  });
function oracleCPerDeal(front: number): number {
  const pay = front >= 2000 ? front * 0.25 : front >= 1000 ? front * 0.2 : undefined;
  return pay === undefined || pay < 150 ? 150 : pay;
}
const oracleC = (ds: Deal[]) => r2(sum(ds.map((d) => oracleCPerDeal(d.amount))) + (ds.length >= 10 ? 500 : 0));

// ---------------------------------------------------------------------------
// PLAN D — Aaron's REAL Kennesaw Mazda F&I plan, exactly as shipped
// (lib/payplan/plans.ts). Oracle re-implements its grid + PVR kicker.
// VSC/menu/CSI aren't measured per-deal, so those rules stay dormant — same
// as production.
// ---------------------------------------------------------------------------
const KX = [1050, 1100, 1200, 1300, 1400, 1500, 1600, 1700];
const KY = [1.4, 1.6, 1.8, 2.0, 2.2, 2.3, 2.5];
const KR = [
  [9.5, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0],
  [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5],
  [10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0],
  [11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5],
  [11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0],
  [12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5],
  [12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5, 16.0],
];
const oracleD = (ds: Deal[]) => oracleGrid(ds, KX, KY, KR, 0.5);

const pay = (plan: PayPlan, ds: Deal[]) => calculatePay(plan, perfFromDeals(ds)).grossPay;

// ============================================================================

describe("TEN-DEAL AUDIT — front to back (deals land one at a time)", () => {
  const plans: [string, () => PayPlan, (ds: Deal[]) => number][] = [
    ["A grid+draw+tax", planA, oracleA],
    ["B flat linear", planB, oracleB],
    ["C per-deal+mini+tier", planC, oracleC],
    ["D Kennesaw (real plan)", kennesawFinancePlan, oracleD],
  ];

  for (const [label, mkPlan, oracle] of plans) {
    it(`${label}: every prefix matches the independent oracle, to the cent`, () => {
      const plan = mkPlan();
      let prev = 0;
      for (let i = 0; i <= DEALS.length; i++) {
        const slice = DEALS.slice(0, i);
        const res = calculatePay(plan, perfFromDeals(slice));
        assertFiniteDeep(res, `${label}@${i}`);
        expect(res.grossPay, `${label} after ${i} deals`).toBeCloseTo(oracle(slice), 2);
        // netAfterTax honors the plan's tax rate at every step
        expect(res.netAfterTax).toBeCloseTo(res.grossPay * (1 - (plan.taxRate || 0) / 100), 2);
        prev = res.grossPay;
      }
      expect(prev).toBeCloseTo(oracle(DEALS), 2);
    });
  }

  it("A: hand-checked literals at the tier crossings (not oracle-derived)", () => {
    const plan = planA();
    // 1 deal: PVR 2400, PPU 2 → 17% + 0.5% kicker = 17.5% × $2,400 = $420.00
    expect(pay(plan, DEALS.slice(0, 1))).toBeCloseTo(420.0, 2);
    // 2 deals: PVR 1950, PPU 1.5 → 14% + 0.5% = 14.5% × $3,900 = $565.50
    expect(pay(plan, DEALS.slice(0, 2))).toBeCloseTo(565.5, 2);
    // 3 deals (+Kenneth $0-back): PVR 1300, PPU 1 → 11%, kicker LOST → $429.00
    expect(pay(plan, DEALS.slice(0, 3))).toBeCloseTo(429.0, 2);
  });

  it("A: Kenneth's $0-back deal has a NEGATIVE marginal at landing — the −$44 class, real and shown", () => {
    const plan = planA();
    const with3 = pay(plan, DEALS.slice(0, 3));
    const with2 = pay(plan, DEALS.slice(0, 2));
    expect(with3 - with2).toBeCloseTo(-136.5, 2); // dragged PVR 1950→1300 and PPU 1.5→1
  });

  it("A: Jamal's $0-back deal costs exactly $0 when no tier line is crossed", () => {
    const plan = planA();
    const with6 = pay(plan, DEALS.slice(0, 6));
    const with5 = pay(plan, DEALS.slice(0, 5));
    expect(with6 - with5).toBeCloseTo(0, 2); // PVR 1500→1250 stays inside the same cell
  });

  it("A: full month literal — $1,529.00 gross, $6,471 still owed on the $8k draw, $1,162.04 take-home", () => {
    const res = calculatePay(planA(), perfFromDeals(DEALS));
    expect(res.grossPay).toBeCloseTo(1529.0, 2);
    expect(res.drawOwed).toBeCloseTo(6471.0, 2); // 8,000 − 1,529
    expect(res.remainderAfterDraw).toBeCloseTo(0, 2); // nothing beyond the advance yet
    expect(res.aboveDraw).toBeCloseTo(0, 2);
    expect(res.netAfterTax).toBeCloseTo(1529 * 0.76, 2);
  });

  it("D (real Kennesaw plan): full month literal + Kenneth honesty on the REAL grid", () => {
    const plan = kennesawFinancePlan();
    const res = calculatePay(plan, perfFromDeals(DEALS));
    // PVR $1,390 → $1,300 column; PPU 1.2 < 1.4 → bottom row → 11.0% × $13,900
    expect(res.grossPay).toBeCloseTo(1529.0, 2);
    expect(res.drawOwed).toBeCloseTo(6471.0, 2);
    // Pull Kenneth OUT of the finished month: without him PVR is $1,544 → 12.0%
    const withoutK = DEALS.filter((d) => d.customer !== "Kenneth West");
    expect(pay(plan, withoutK)).toBeCloseTo(1668.0, 2);
    // So the deal's true value to the month is −$139 — shown, never hidden.
    expect(res.grossPay - pay(plan, withoutK)).toBeCloseTo(-139.0, 2);
  });

  it("C: per-deal minis pay $150 (never negative), bands pay on each deal's own gross, 10th unit lands the $500", () => {
    const plan = planC();
    // hand math: 750 + 240 + 812.75 + 150 + 150 + 150 + 500 + 300 + 150 + 220 = 3,422.75 (+500 tier)
    expect(pay(plan, DEALS)).toBeCloseTo(3922.75, 2);
    // 9 deals: tier not yet reached — hand math 3,422.75 minus Tyler's 220
    expect(pay(plan, DEALS.slice(0, 9))).toBeCloseTo(3202.75, 2);
    // the 10th deal's marginal includes its own $220 AND the $500 bonus
    expect(pay(plan, DEALS) - pay(plan, DEALS.slice(0, 9))).toBeCloseTo(720.0, 2);
    // a loser deal on its own: the mini, positive, exactly $150
    expect(pay(plan, [DEALS[3]])).toBeCloseTo(150.0, 2);
  });

  it("B: guarantee floor variant holds the line early, releases when earned pay passes it", () => {
    const plan = { ...planB(), guaranteeFloor: 3000 };
    for (let i = 1; i <= DEALS.length; i++) {
      const slice = DEALS.slice(0, i);
      const earned = oracleB(slice);
      const res = calculatePay(plan, perfFromDeals(slice));
      expect(res.grossPay).toBeCloseTo(Math.max(3000, earned), 2);
    }
  });
});

describe("TEN-DEAL AUDIT — back to front (every deal pulled out of the finished month)", () => {
  const plans: [string, () => PayPlan, (ds: Deal[]) => number][] = [
    ["A", planA, oracleA],
    ["B", planB, oracleB],
    ["C", planC, oracleC],
    ["D Kennesaw", kennesawFinancePlan, oracleD],
  ];
  for (const [label, mkPlan, oracle] of plans) {
    it(`${label}: with-vs-without delta (DealDetail's number) matches the oracle for all 10 deals`, () => {
      const plan = mkPlan();
      const full = pay(plan, DEALS);
      for (const d of DEALS) {
        const without = DEALS.filter((x) => x.id !== d.id);
        const engineDelta = full - pay(plan, without);
        const oracleDelta = oracle(DEALS) - oracle(without);
        expect(engineDelta, `${label}: ${d.customer}`).toBeCloseTo(oracleDelta, 2);
      }
    });

    it(`${label}: peeling deals off the end retraces the front-to-back numbers exactly`, () => {
      const plan = mkPlan();
      for (let i = DEALS.length; i >= 0; i--) {
        expect(pay(plan, DEALS.slice(0, i))).toBeCloseTo(oracle(DEALS.slice(0, i)), 2);
      }
    });
  }

  it("order invariance: any arrival order of the same 10 deals pays the same month", () => {
    const shuffles = [
      [...DEALS].reverse(),
      [DEALS[5], DEALS[0], DEALS[9], DEALS[2], DEALS[7], DEALS[1], DEALS[4], DEALS[8], DEALS[3], DEALS[6]],
      [DEALS[9], DEALS[8], DEALS[0], DEALS[1], DEALS[7], DEALS[6], DEALS[2], DEALS[3], DEALS[5], DEALS[4]],
    ];
    for (const [label, mkPlan] of [["A", planA], ["C", planC], ["D", kennesawFinancePlan]] as const) {
      const plan = mkPlan();
      const base = pay(plan, DEALS);
      for (const s of shuffles) expect(pay(plan, s), label).toBeCloseTo(base, 2);
    }
  });

  it("determinism: the same month computed twice is identical, field for field", () => {
    const a = calculatePay(planA(), perfFromDeals(DEALS));
    const b = calculatePay(planA(), perfFromDeals(DEALS));
    expect(a).toEqual(b);
  });
});

describe("TEN-DEAL AUDIT — the app wiring around the engine", () => {
  it("perfFromDeals maps every field the engine reads", () => {
    const p = perfFromDeals(DEALS);
    expect(p.units).toBe(10);
    expect(p.frontGross).toBe(14251);
    expect(p.backGross).toBe(13900);
    expect(p.products).toBe(12);
    expect(p.dealRows).toHaveLength(10);
    expect(p.dealRows![2].front).toBe(3251); // Kenneth rides on his own gross
    expect(p.fastStartUnits).toBe(6); // deals dated on or before the 15th
  });

  it("forecast: banked counts ONLY delivered; pipeline weights land between banked and best", () => {
    const pipeline = [
      { ...deal({ name: "Appt Lead", front: 1500, back: 1400, products: 1, day: 27 }, "appointment"), id: "p1" },
      { ...deal({ name: "In Finance", front: 2000, back: 1900, products: 2, day: 27 }, "finance"), id: "p2" },
    ];
    const dead = { ...deal({ name: "Dead Deal", front: 9999, back: 9999, products: 3, day: 27 }, "dead"), id: "p3" };
    const f = forecast(planA(), [...DEALS, ...pipeline, dead], NOW, []);
    expect(f.counted).toHaveLength(10);
    expect(f.pipeline).toHaveLength(2); // dead is excluded everywhere
    expect(f.current.grossPay).toBeCloseTo(oracleA(DEALS), 2); // banked = delivered only
    expect(f.best.grossPay).toBeCloseTo(oracleA([...DEALS, ...pipeline]), 2);
    expect(f.likely.grossPay).toBeGreaterThanOrEqual(f.current.grossPay);
    expect(f.likely.grossPay).toBeLessThanOrEqual(f.best.grossPay);
    expect(STATUS_WEIGHT.finance).toBeGreaterThan(STATUS_WEIGHT.appointment); // sanity on the weights themselves
    assertFiniteDeep(f, "forecast");
  });

  it("draw ledger identities hold at every prefix (A: $8k draw; and with a $1,500 carried balance)", () => {
    for (const carried of [0, 1500]) {
      const plan = { ...planA(), drawCarriedIn: carried || undefined };
      for (let i = 0; i <= DEALS.length; i++) {
        const res = calculatePay(plan, perfFromDeals(DEALS.slice(0, i)));
        expect(res.drawOwed).toBeCloseTo(Math.max(0, carried + 8000 - res.grossPay), 2);
        expect(res.aboveDraw).toBeCloseTo(Math.max(0, res.grossPay - 8000 - carried), 2);
        expect(res.remainderAfterDraw).toBeCloseTo(res.grossPay - Math.min(8000, res.grossPay), 2);
        // you can't simultaneously owe on the draw AND have money above it
        expect(res.drawOwed > 0 && res.aboveDraw > 0).toBe(false);
      }
    }
  });

  it("empty month: $0 everywhere, full draw owed, nothing NaN", () => {
    const res = calculatePay(planA(), perfFromDeals([]));
    expect(res.grossPay).toBe(0);
    expect(res.drawOwed).toBe(8000);
    expect(res.netAfterTax).toBe(0);
    assertFiniteDeep(res, "empty");
  });
});
