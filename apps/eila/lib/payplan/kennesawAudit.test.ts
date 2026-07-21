import { describe, it, expect } from "vitest";
import { calculatePay } from "./calc";
import { makePlan, kennesawFinancePlan } from "./plans";
import { PayPlan, PerfInput } from "./types";

// ══ FULL MATH AUDIT — Kennesaw Mazda sales + F&I plans (July 6, 2026) ═════════
// Aaron: "plug and play with numbers … make sure the math works according to
// the pay plan." The cross-reference is an independent ORACLE transcribed
// line-by-line from the SIGNED plans (dumb, obviously-correct code that shares
// nothing with the engine), checked three ways:
//   1. band-edge tables with the arithmetic written out by hand,
//   2. real anchor months verified by hand (incl. the Rodney Stegall recap),
//   3. seeded fuzz — thousands of random months, engine vs oracle to the cent.
// The dealer repo runs the SAME oracle + seeds against its engine, so the two
// engines are also proven equivalent transitively.

// ── deterministic RNG (no Math.random — reruns must reproduce) ───────────────
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ── ORACLE: the signed SALES plan, verbatim ──────────────────────────────────
// New: CGP ≥ $1 → $400 · CGP ≥ −$300 → $250 · below → $150.
// Used: 25% of CGP (30% at CGP ≥ $3,000), $150 mini. Anything else: $150.
// Volume ladder (highest tier only): 12→$500 15→$1,000 18→$1,300 21→$1,600 24→$1,900.
function oracleSalesDeal(cgp: number, cat: string): number {
  if (cat === "new") return cgp >= 1 ? 400 : cgp >= -300 ? 250 : 150;
  if (cat === "used") return Math.max(cgp * (cgp >= 3000 ? 0.30 : 0.25), 150);
  return 150;
}
function oracleLadder(units: number): number {
  return units >= 24 ? 1900 : units >= 21 ? 1600 : units >= 18 ? 1300 : units >= 15 ? 1000 : units >= 12 ? 500 : 0;
}

// ── ORACLE: the signed F&I plan, verbatim ────────────────────────────────────
// Rate = PVR×PPU grid % of back (net-profit proxy). PVR > $1,900 → +0.5%.
// VSC pen ≥ 50% → +0.5%. Menu < 95% → −5% of gross. CSI below region → −5%
// (+3% per extra consecutive month). Uncashed >20d → $200 each. $8,000 draw.
const COLS = [1050, 1100, 1200, 1300, 1400, 1500, 1600, 1700];
const ROWS = [1.4, 1.6, 1.8, 2.0, 2.2, 2.3, 2.5];
const RATES = [
  [9.5, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0],
  [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5],
  [10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0],
  [11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5],
  [11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0],
  [12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5],
  [12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5, 16.0],
];
function bandIdx(v: number, ts: number[]): number {
  let i = 0;
  for (let k = 0; k < ts.length; k++) if (v >= ts[k]) i = k;
  return i;
}
interface FiMonth { units: number; back: number; products: number; vsc: number; menuUsage: number; csiBelow: boolean; csiMonths: number; uncashed: number }
function oracleFi(m: FiMonth) {
  const pvr = m.units ? m.back / m.units : 0;
  const ppu = m.units ? m.products / m.units : 0;
  let rate = RATES[bandIdx(ppu, ROWS)][bandIdx(pvr, COLS)];
  if (pvr >= 1900) rate += 0.5;
  if (m.vsc >= 50) rate += 0.5;
  const commission = (m.back * rate) / 100;
  let penPct = 0;
  if (m.menuUsage < 95) penPct += 5;
  if (m.csiBelow) penPct += 5 + 3 * Math.max(0, m.csiMonths - 1);
  const grossPay = Math.max(0, commission - (commission * penPct) / 100 - 200 * m.uncashed);
  const drawOffset = Math.min(8000, grossPay);
  return { rate, commission, grossPay, afterDraw: grossPay - drawOffset };
}

// ── the plans under test ─────────────────────────────────────────────────────
const SALES_PLAN: PayPlan = makePlan({
  role: "sales",
  label: "Sales Consultant — Kennesaw Mazda",
  perDeal: {
    segments: {
      new: { bands: [{ min: 1, flat: 400 }, { min: -300, flat: 250 }, { min: -1e9, flat: 150 }] },
      used: { pct: 25, highMin: 3000, highPct: 30, minFlat: 150 },
    },
    default: { minFlat: 150 },
    minFlat: 150,
  },
  tiers: [
    { id: "u12", label: "12 units", metric: "units", threshold: 12, kind: "flat", amount: 500 },
    { id: "u15", label: "15 units", metric: "units", threshold: 15, kind: "flat", amount: 1000 },
    { id: "u18", label: "18 units", metric: "units", threshold: 18, kind: "flat", amount: 1300 },
    { id: "u21", label: "21 units", metric: "units", threshold: 21, kind: "flat", amount: 1600 },
    { id: "u24", label: "24 units", metric: "units", threshold: 24, kind: "flat", amount: 1900 },
  ],
});
const FI_PLAN = kennesawFinancePlan();

type Row = { front: number; category?: string; weight?: number };
function salesPerf(rows: Row[]): PerfInput {
  return { units: rows.length, frontGross: rows.reduce((n, r) => n + r.front, 0), backGross: 0, products: 0, dealRows: rows };
}
function salesPay(rows: Row[]): number {
  return calculatePay(SALES_PLAN, salesPerf(rows)).grossPay;
}
function fiPerf(m: FiMonth): PerfInput {
  return {
    units: m.units, frontGross: 0, backGross: m.back, products: m.products,
    vscPenetration: m.vsc, menuUsage: m.menuUsage, csiBelowRegion: m.csiBelow,
    csiConsecutiveBelow: m.csiMonths, contractsNotCashed: m.uncashed,
  };
}

// ══ SALES — band-edge table (hand-computed) ══════════════════════════════════
describe("AUDIT sales: every band edge, arithmetic by hand", () => {
  const cases: [string, Row[], number][] = [
    // one New deal at each edge
    ["New $5,000 → $400", [{ front: 5000, category: "new" }], 400],
    ["New $1 (exactly the high edge) → $400", [{ front: 1, category: "new" }], 400],
    ["New $0.99 → $250", [{ front: 0.99, category: "new" }], 250],
    ["New $0 → $250", [{ front: 0, category: "new" }], 250],
    ["New −$299.99 → $250", [{ front: -299.99, category: "new" }], 250],
    ["New −$300 (exactly the mid edge) → $250", [{ front: -300, category: "new" }], 250],
    ["New −$300.01 → $150", [{ front: -300.01, category: "new" }], 150],
    ["New −$1,750 (Rodney Stegall) → $150", [{ front: -1750, category: "new" }], 150],
    ["New −$9,999 → $150", [{ front: -9999, category: "new" }], 150],
    // Used edges: 25% below $3,000, 30% at/above, $150 floor
    ["Used $6,000 → 30% = $1,800", [{ front: 6000, category: "used" }], 1800],
    ["Used $3,000 (exactly the kicker) → 30% = $900", [{ front: 3000, category: "used" }], 900],
    ["Used $2,999.99 → 25% = $750.00 (749.9975 → cents)", [{ front: 2999.99, category: "used" }], 750],
    ["Used $2,000 → 25% = $500", [{ front: 2000, category: "used" }], 500],
    ["Used $601 → 25% = $150.25 (just over the mini)", [{ front: 601, category: "used" }], 150.25],
    ["Used $600 → 25% = $150 = the mini exactly", [{ front: 600, category: "used" }], 150],
    ["Used $599 → 25% = $149.75 < mini → $150", [{ front: 599, category: "used" }], 150],
    ["Used $0 → mini $150", [{ front: 0, category: "used" }], 150],
    ["Used −$2,000 → mini $150 (never negative)", [{ front: -2000, category: "used" }], 150],
    // anything else
    ["Wholesale/other $4,000 → mini $150", [{ front: 4000, category: "wholesale" }], 150],
    ["No category $4,000 → mini $150", [{ front: 4000 }], 150],
  ];
  for (const [name, rows, want] of cases) {
    it(name, () => expect(salesPay(rows)).toBeCloseTo(want, 2));
  }
});

// ══ SALES — volume ladder edges (11 through 25 units, hand-computed) ═════════
describe("AUDIT sales: volume ladder — highest tier only, exact edges", () => {
  // months of N New deals at $2,000 each (each pays $400): N×400 + ladder(N)
  const ladder: [number, number][] = [
    [11, 0], [12, 500], [13, 500], [14, 500], [15, 1000], [17, 1000],
    [18, 1300], [20, 1300], [21, 1600], [23, 1600], [24, 1900], [25, 1900],
  ];
  for (const [units, bonus] of ladder) {
    it(`${units} units → deals ${units}×$400 + $${bonus} ladder = $${units * 400 + bonus}`, () => {
      const rows = Array.from({ length: units }, () => ({ front: 2000, category: "new" }));
      expect(salesPay(rows)).toBe(units * 400 + bonus);
    });
  }
});

// ══ SALES — hand-verified anchor months ══════════════════════════════════════
describe("AUDIT sales: realistic months, verified by hand", () => {
  it("Tony's July so far: Rodney (−$1,750 New) + $2,200 New + $1,500 Used + $3,400 Used", () => {
    // 150 + 400 + max(375,150) + 30%×3400=1020 → 1,945; 4 units → no ladder.
    expect(salesPay([
      { front: -1750, category: "new" }, { front: 2200, category: "new" },
      { front: 1500, category: "used" }, { front: 3400, category: "used" },
    ])).toBe(150 + 400 + 375 + 1020);
  });

  it("a 15-unit grinder month: 9 New winners, 2 New minis, 3 Used, 1 wholesale", () => {
    // 9×400 + 2×150 + (25%×2400=600) + (25%×800=200) + (30%×5000=1500) + 150 + ladder 1000
    const rows: Row[] = [
      ...Array.from({ length: 9 }, () => ({ front: 1200, category: "new" })),
      { front: -800, category: "new" }, { front: -3000, category: "new" },
      { front: 2400, category: "used" }, { front: 800, category: "used" }, { front: 5000, category: "used" },
      { front: 900, category: "wholesale" },
    ];
    expect(rows.length).toBe(15);
    expect(salesPay(rows)).toBe(3600 + 300 + 600 + 200 + 1500 + 150 + 1000);
  });

  it("all-loser month can never pay less than minis: 5 disasters → 5×$150", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ front: -1000 * (i + 1), category: i % 2 ? "new" : "used" }));
    expect(salesPay(rows)).toBe(750);
  });
});

// ══ SALES — seeded fuzz: 3,000 random months vs the oracle ═══════════════════
describe("AUDIT sales: 3,000 fuzzed months match the oracle to the cent", () => {
  it("engine === oracle on every month; every deal's marginal ≥ $150", () => {
    const rnd = lcg(41);
    const edgy = [-300.01, -300, -299.99, -1, 0, 0.99, 1, 599, 600, 601, 2999.99, 3000, 3000.01];
    let worstDiff = 0;
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rnd() * 28);
      const rows: Row[] = Array.from({ length: n }, () => {
        const r = rnd();
        const category = r < 0.5 ? "new" : r < 0.9 ? "used" : "wholesale";
        const front = rnd() < 0.25 ? edgy[Math.floor(rnd() * edgy.length)] : Math.round((rnd() * 10000 - 4000) * 100) / 100;
        return { front, category };
      });
      const expected = rows.reduce((s, r) => s + oracleSalesDeal(r.front, r.category!), 0) + oracleLadder(n);
      const got = salesPay(rows);
      worstDiff = Math.max(worstDiff, Math.abs(got - expected));
      // engine rounds to cents; a raw oracle total of $x.xx5 legitimately
      // differs by exactly half a cent — anything ≥ a cent is a real bug
      if (Math.abs(got - expected) > 0.0051) expect(got).toBeCloseTo(expected, 2);

      // marginal property: landing one more deal NEVER pays less than the mini
      if (i % 10 === 0) {
        const extra: Row = { front: Math.round((rnd() * 10000 - 4000) * 100) / 100, category: rnd() < 0.5 ? "new" : "used" };
        const delta = salesPay([...rows, extra]) - got;
        expect(delta).toBeGreaterThanOrEqual(149.99);
      }
    }
    expect(worstDiff).toBeLessThan(0.011); // nothing beyond cent-rounding
  });
});

// ══ F&I — full grid sweep: every cell, at/above/below each threshold ═════════
describe("AUDIT F&I: all 56 grid cells at exact thresholds and just past them", () => {
  it("rate at (threshold, threshold), (threshold+ε, threshold+ε), and mid-band", () => {
    for (let yi = 0; yi < ROWS.length; yi++) {
      for (let xi = 0; xi < COLS.length; xi++) {
        for (const [pvr, ppu] of [
          [COLS[xi], ROWS[yi]],
          [COLS[xi] + 0.01, ROWS[yi] + 0.001],
          [xi < COLS.length - 1 ? COLS[xi + 1] - 0.01 : COLS[xi] + 50, yi < ROWS.length - 1 ? ROWS[yi + 1] - 0.001 : ROWS[yi] + 0.05],
        ] as const) {
          const units = 50;
          const m: FiMonth = { units, back: pvr * units, products: ppu * units, vsc: 0, menuUsage: 100, csiBelow: false, csiMonths: 1, uncashed: 0 };
          const r = calculatePay(FI_PLAN, fiPerf(m));
          expect(r.rate, `pvr ${pvr} ppu ${ppu}`).toBe(RATES[yi][xi]);
          expect(r.grossPay).toBeCloseTo((m.back * RATES[yi][xi]) / 100, 1);
        }
      }
    }
  });

  it("below the grid floor pays the lowest band (PVR $900 / PPU 1.0 → 9.5%)", () => {
    const m: FiMonth = { units: 40, back: 36000, products: 40, vsc: 0, menuUsage: 100, csiBelow: false, csiMonths: 1, uncashed: 0 };
    const r = calculatePay(FI_PLAN, fiPerf(m));
    expect(r.rate).toBe(9.5);
    expect(r.grossPay).toBeCloseTo(3420, 2); // 9.5% × 36,000
  });
});

// ══ F&I — bonus / penalty / deduction / draw edges (hand-computed) ═══════════
describe("AUDIT F&I: bonus, penalty, deduction, draw — exact edges", () => {
  // Aaron's anchor month: 50 units, $70k back (PVR $1,400), 100 products (PPU 2.0), VSC 60%.
  it("ANCHOR: 13.0% grid + 0.5% VSC = 13.5% × $70,000 = $9,450; check after $8k draw = $1,450", () => {
    const m: FiMonth = { units: 50, back: 70000, products: 100, vsc: 60, menuUsage: 100, csiBelow: false, csiMonths: 1, uncashed: 0 };
    const r = calculatePay(FI_PLAN, fiPerf(m));
    expect(r.rate).toBe(13.5);
    expect(r.grossPay).toBe(9450);
    expect(r.drawOffset).toBe(8000);
    expect(r.remainderAfterDraw).toBe(1450);
  });

  it("PVR bonus starts at $1,900: exactly $1,900 → +0.5%; below $1,900 → no bonus", () => {
    const at = calculatePay(FI_PLAN, fiPerf({ units: 10, back: 19000, products: 25, vsc: 0, menuUsage: 100, csiBelow: false, csiMonths: 1, uncashed: 0 }));
    expect(at.rate).toBe(16.5); // PVR 1900 qualifies: base 16.0 + 0.5
    const below = calculatePay(FI_PLAN, fiPerf({ units: 10, back: 18999, products: 25, vsc: 0, menuUsage: 100, csiBelow: false, csiMonths: 1, uncashed: 0 }));
    expect(below.rate).toBe(16.0);
  });

  // PVR $30,000/20 = $1,500 → column 6 of the grid; PPU 40/20 = 2.0 → row 4.
  // Signed grid row for 2.0 is [11.0 11.5 12.0 12.5 13.0 13.5 14.0 14.5] → 13.5%.
  // (First draft of this audit hand-read this cell as 13.0% — the ENGINE was
  // right and the auditor was wrong; kept here as a note since it proves the
  // sweep+fuzz catch what a human misreads.)
  it("VSC bonus starts at 50%: 49.9% → no; 50% → +0.5%", () => {
    const base: FiMonth = { units: 20, back: 30000, products: 40, vsc: 50, menuUsage: 100, csiBelow: false, csiMonths: 1, uncashed: 0 };
    expect(calculatePay(FI_PLAN, fiPerf({ ...base, vsc: 49.9 })).rate).toBe(13.5); // PVR 1500 / PPU 2.0
    expect(calculatePay(FI_PLAN, fiPerf(base)).rate).toBe(14.0);
  });

  it("menu penalty at the edge: 95% → none; 94.9% → −5% of gross", () => {
    const m: FiMonth = { units: 20, back: 30000, products: 40, vsc: 0, menuUsage: 95, csiBelow: false, csiMonths: 1, uncashed: 0 };
    expect(calculatePay(FI_PLAN, fiPerf(m)).grossPay).toBeCloseTo(4050, 2); // 13.5% × 30k
    expect(calculatePay(FI_PLAN, fiPerf({ ...m, menuUsage: 94.9 })).grossPay).toBeCloseTo(4050 * 0.95, 2); // 3,847.50
  });

  it("CSI penalty escalates: 1 month −5%, 2 months −8%, 3 months −11%", () => {
    const m: FiMonth = { units: 20, back: 30000, products: 40, vsc: 0, menuUsage: 100, csiBelow: true, csiMonths: 1, uncashed: 0 };
    expect(calculatePay(FI_PLAN, fiPerf(m)).grossPay).toBeCloseTo(4050 * 0.95, 2); // 3,847.50
    expect(calculatePay(FI_PLAN, fiPerf({ ...m, csiMonths: 2 })).grossPay).toBeCloseTo(4050 * 0.92, 2); // 3,726
    expect(calculatePay(FI_PLAN, fiPerf({ ...m, csiMonths: 3 })).grossPay).toBeCloseTo(4050 * 0.89, 2); // 3,604.50
  });

  it("uncashed contracts: 3 × $200 = −$600", () => {
    const m: FiMonth = { units: 20, back: 30000, products: 40, vsc: 0, menuUsage: 100, csiBelow: false, csiMonths: 1, uncashed: 3 };
    expect(calculatePay(FI_PLAN, fiPerf(m)).grossPay).toBeCloseTo(4050 - 600, 2); // 3,450
  });

  it("draw never exceeds what was earned: $5,000 month → offset $5,000, remainder $0", () => {
    const m: FiMonth = { units: 30, back: 36000, products: 60, vsc: 0, menuUsage: 100, csiBelow: false, csiMonths: 1, uncashed: 0 };
    const r = calculatePay(FI_PLAN, fiPerf(m)); // PVR 1200 / PPU 2.0 → 12% × 36k = 4,320
    expect(r.grossPay).toBeCloseTo(4320, 2);
    expect(r.drawOffset).toBeCloseTo(4320, 2);
    expect(r.remainderAfterDraw).toBe(0);
  });
});

// ══ F&I — seeded fuzz: 3,000 random months vs the oracle ═════════════════════
describe("AUDIT F&I: 3,000 fuzzed months match the oracle", () => {
  it("rate, gross pay, and after-draw check all agree", () => {
    const rnd = lcg(1900);
    for (let i = 0; i < 3000; i++) {
      const units = 1 + Math.floor(rnd() * 80);
      const pvrish = 800 + rnd() * 1600; // spans below-grid → over the PVR bonus
      const ppuish = 1.0 + rnd() * 2.0;
      const m: FiMonth = {
        units,
        back: Math.round(pvrish * units * 100) / 100,
        products: Math.round(ppuish * units * 10) / 10,
        vsc: Math.round(rnd() * 100 * 10) / 10,
        menuUsage: rnd() < 0.2 ? Math.round(rnd() * 100) : 100,
        csiBelow: rnd() < 0.2,
        csiMonths: 1 + Math.floor(rnd() * 4),
        uncashed: rnd() < 0.15 ? 1 + Math.floor(rnd() * 5) : 0,
      };
      const want = oracleFi(m);
      const got = calculatePay(FI_PLAN, fiPerf(m));
      expect(got.rate, `month ${i}: ${JSON.stringify(m)}`).toBe(want.rate);
      expect(got.grossPay).toBeCloseTo(want.grossPay, 1);
      expect(got.remainderAfterDraw).toBeCloseTo(want.afterDraw, 1);
    }
  });
});
