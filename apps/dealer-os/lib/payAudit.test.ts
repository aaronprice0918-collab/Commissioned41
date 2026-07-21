import test from "node:test";
import assert from "node:assert/strict";
import { salesCommissionForDeal, volumeBonus } from "./salesPay.ts";
import { defaultSalesPlan } from "../components/PayPlanProvider.tsx";
import { calculateFinancePay, gridLookup, GRID, PVR_COLS, PPU_ROWS, FINANCE_COMP_PLAN } from "./financePayPlan.ts";
import { KENNESAW_SALES_COMP_PLAN } from "./salesCompPlan.ts";
import { computePay, type DealRow, type PerDealRule, type TierRule } from "./payEngine.ts";
import type { Deal } from "./data.ts";

// ══ FULL MATH AUDIT — Kennesaw sales + F&I, dealer repo (July 6, 2026) ════════
// Same independent oracle + same LCG seeds as missionos-lite's
// lib/payplan/kennesawAudit.test.ts, so the LIVE scorecard math, the universal
// engine, and the lite engine are all proven against one source of truth —
// the signed plans — and therefore against each other.

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ── ORACLE: signed sales plan, verbatim ──────────────────────────────────────
function oracleSalesDeal(cgp: number, klass: string): number {
  if (klass === "New") return cgp >= 1 ? 400 : cgp >= -300 ? 250 : 150;
  if (klass === "Used") return Math.max(cgp * (cgp >= 3000 ? 0.30 : 0.25), 150);
  return 150;
}
function oracleLadder(units: number): number {
  return units >= 24 ? 1900 : units >= 21 ? 1600 : units >= 18 ? 1300 : units >= 15 ? 1000 : units >= 12 ? 500 : 0;
}

// ── ORACLE: signed F&I plan, verbatim ────────────────────────────────────────
function bandIdx(v: number, ts: number[]): number {
  let i = 0;
  for (let k = 0; k < ts.length; k++) if (v >= ts[k]) i = k;
  return i;
}
interface FiMonth { units: number; back: number; products: number; vsc: number; menuOk: boolean; csiOk: boolean; csiMonths: number; uncashed: number }
function oracleFi(m: FiMonth) {
  const pvr = m.units ? m.back / m.units : 0;
  const ppu = m.units ? m.products / m.units : 0;
  let rate = GRID[bandIdx(ppu, PPU_ROWS)][bandIdx(pvr, PVR_COLS)];
  if (pvr > 1900) rate += 0.5;
  if (m.vsc > 50) rate += 0.5;
  const commission = (m.back * rate) / 100;
  let penPct = 0;
  if (!m.menuOk) penPct += 5;
  if (!m.csiOk) penPct += 5 + 3 * Math.max(0, m.csiMonths - 1);
  const afterPenalty = commission - (commission * penPct) / 100 - 200 * m.uncashed;
  // dealer semantics: draw is advanced in full; the estimate may go negative
  return { rate, commission, afterPenalty, estCheck: afterPenalty - 8000 };
}

function deal(p: { vehicleClass: string; frontGross: number }): Deal {
  return {
    id: "t", date: "2026-07-03", customer: "C", vin: "", stock: "", model: "",
    vehicleClass: p.vehicleClass, salesperson: "Rep", manager: "M", financeManager: "F",
    lender: "", tradeInfo: "", frontGross: p.frontGross, backGrossReserve: 0, products: {},
  } as unknown as Deal;
}

const plan = defaultSalesPlan;

// ══ Drift guard: the engine's plan constants === the live plan constants ═════
test("AUDIT drift-guard: KENNESAW_SALES_COMP_PLAN carries the same numbers as defaultSalesPlan", () => {
  const pd = KENNESAW_SALES_COMP_PLAN.rules.find((r): r is PerDealRule => r.kind === "perDeal")!;
  assert.deepEqual(pd.segments!.New.bands, [
    { min: plan.newHighMin, flat: plan.newHighFlat },
    { min: plan.newMidMin, flat: plan.newMidFlat },
    { min: -1e9, flat: plan.newMiniFlat },
  ]);
  assert.deepEqual(pd.segments!.Used, { pct: plan.usedPct, highMin: plan.usedHighMin, highPct: plan.usedHighPct, minFlat: plan.usedMinCommission });
  assert.equal(pd.minFlat, plan.miniCommission);
  const tier = KENNESAW_SALES_COMP_PLAN.rules.find((r): r is TierRule => r.kind === "tier")!;
  assert.deepEqual(
    [...tier.tiers].sort((a, b) => a.min - b.min).map((t) => [t.min, t.flat]),
    [...plan.volumeTiers].sort((a, b) => a.units - b.units).map((t) => [t.units, t.bonus]),
  );
});

// ══ LIVE sales path: every band edge vs the oracle ═══════════════════════════
test("AUDIT live salesCommissionForDeal: full band-edge table", () => {
  const edges: [string, number, number][] = [
    ["New", 5000, 400], ["New", 1, 400], ["New", 0.99, 250], ["New", 0, 250],
    ["New", -299.99, 250], ["New", -300, 250], ["New", -300.01, 150],
    ["New", -1750, 150], // Rodney Stegall — the DMS printed $150, the plan says $150
    ["New", -9999, 150],
    ["Used", 6000, 1800], ["Used", 3000, 900], ["Used", 2999.99, 749.9975],
    ["Used", 2000, 500], ["Used", 601, 150.25], ["Used", 600, 150], ["Used", 599, 150],
    ["Used", 0, 150], ["Used", -2000, 150],
    ["Wholesale", 4000, 150], ["Fleet", -500, 150],
  ];
  for (const [klass, cgp, want] of edges) {
    assert.equal(salesCommissionForDeal(deal({ vehicleClass: klass, frontGross: cgp }), plan), want, `${klass} $${cgp}`);
    assert.equal(oracleSalesDeal(cgp, klass), want, `oracle self-check ${klass} $${cgp}`);
  }
});

test("AUDIT live volumeBonus: exact ladder edges incl. fractional split units", () => {
  const cases: [number, number][] = [
    [0, 0], [11, 0], [11.5, 0], [12, 500], [14.5, 500], [15, 1000], [17.5, 1000],
    [18, 1300], [20.5, 1300], [21, 1600], [23.5, 1600], [24, 1900], [40, 1900],
  ];
  for (const [units, want] of cases) {
    assert.equal(volumeBonus(units, plan), want, `${units} units`);
    assert.equal(oracleLadder(Math.floor(units)), want, `oracle self-check ${units}`); // ladder is >=, floor matches for these cases
  }
});

test("AUDIT live sales fuzz: 3,000 deals vs the oracle (same seed as lite)", () => {
  const rnd = lcg(41);
  const edgy = [-300.01, -300, -299.99, -1, 0, 0.99, 1, 599, 600, 601, 2999.99, 3000, 3000.01];
  for (let i = 0; i < 3000; i++) {
    const r = rnd();
    const klass = r < 0.5 ? "New" : r < 0.9 ? "Used" : "Wholesale";
    const cgp = rnd() < 0.25 ? edgy[Math.floor(rnd() * edgy.length)] : Math.round((rnd() * 10000 - 4000) * 100) / 100;
    const got = salesCommissionForDeal(deal({ vehicleClass: klass, frontGross: cgp }), plan);
    const want = oracleSalesDeal(cgp, klass);
    assert.ok(Math.abs(got - want) < 1e-9, `${klass} $${cgp}: engine ${got} vs oracle ${want}`);
    assert.ok(got >= 150, `no deal ever pays under the $150 mini (${klass} $${cgp} → ${got})`);
  }
});

// ══ Universal engine (feat branch): fuzzed months incl. splits + bonuses ═════
test("AUDIT engine computePay: 1,500 fuzzed months (splits, ladder, finance bonus, fast start) vs the oracle", () => {
  const rnd = lcg(4141);
  for (let i = 0; i < 1500; i++) {
    const n = 1 + Math.floor(rnd() * 26);
    let units = 0, front = 0, back = 0, fastStartUnits = 0, wantDeals = 0;
    const rows: DealRow[] = [];
    for (let k = 0; k < n; k++) {
      const r = rnd();
      const klass = r < 0.5 ? "New" : r < 0.9 ? "Used" : "Wholesale";
      const cgp = Math.round((rnd() * 10000 - 4000) * 100) / 100;
      const share = rnd() < 0.15 ? 0.5 : 1; // some split deals
      const bg = Math.round(rnd() * 3000);
      rows.push({ cgp, vehicleClass: klass, share });
      units += share; front += cgp * share; back += bg * share;
      if (rnd() < 0.5) fastStartUnits += share;
      wantDeals += oracleSalesDeal(cgp, klass) * share;
    }
    const backPvr = units ? back / units : 0;
    const perf = { units, frontGross: front, backGross: back, pvr: backPvr, fastStartUnits };
    const r = computePay(KENNESAW_SALES_COMP_PLAN, perf, rows);
    const want =
      wantDeals +
      oracleLadder(units) + // engine tier uses >= on the (possibly fractional) unit count — ladder(min) semantics
      (units >= 10 && backPvr >= 1300 ? 500 : 0) +
      (fastStartUnits >= 7 ? 500 : 0);
    assert.ok(Math.abs(r.grossCommission - want) < 0.02, `month ${i}: engine ${r.grossCommission} vs oracle ${want}`);
  }
});

// ══ F&I — full 56-cell grid sweep through the LIVE path ══════════════════════
test("AUDIT F&I gridLookup: every cell at threshold, just above, and just under the next", () => {
  for (let yi = 0; yi < PPU_ROWS.length; yi++) {
    for (let xi = 0; xi < PVR_COLS.length; xi++) {
      const probes: [number, number][] = [
        [PVR_COLS[xi], PPU_ROWS[yi]],
        [PVR_COLS[xi] + 0.01, PPU_ROWS[yi] + 0.001],
        [xi < PVR_COLS.length - 1 ? PVR_COLS[xi + 1] - 0.01 : PVR_COLS[xi] + 500, yi < PPU_ROWS.length - 1 ? PPU_ROWS[yi + 1] - 0.001 : PPU_ROWS[yi] + 0.4],
      ];
      for (const [pvr, ppu] of probes) {
        const g = gridLookup(pvr, ppu);
        assert.equal(g.pct, GRID[yi][xi], `pvr ${pvr} ppu ${ppu}`);
        assert.equal(g.rowIndex, yi);
        assert.equal(g.colIndex, xi);
      }
    }
  }
  assert.equal(gridLookup(900, 1.0).pct, 9.5);
  assert.equal(gridLookup(900, 1.0).belowGrid, true);
});

// ══ F&I — anchors + fuzz through calculateFinancePay ═════════════════════════
test("AUDIT F&I ANCHOR: 50u / $70k back / 100 products / VSC 60% → 13.5% = $9,450; est check $1,450", () => {
  const r = calculateFinancePay({ units: 50, backGross: 70000, products: 100, vscUnits: 30 });
  assert.equal(r.basePct, 13.0);
  assert.equal(r.effectivePct, 13.5); // VSC 60% > 50 → +0.5
  assert.equal(r.commission, 9450);
  assert.equal(r.estCheck, 1450); // 9,450 − 8,000 draw
});

test("AUDIT F&I edges through the engine: PVR/VSC strict >, menu <95, CSI escalation, uncashed", () => {
  // exactly at the PVR bonus line — no bonus; a dollar over — +0.5%
  const at = computePay(FINANCE_COMP_PLAN, { pvr: 1900, ppu: 2.5, netProfit: 19000, units: 10, menuUsage: 100, csiBelow: 0, csiMonthsBelow: 1, uncashedContracts: 0, vscPenetration: 0 });
  assert.equal(at.effectiveRatePct, 16.0);
  const over = computePay(FINANCE_COMP_PLAN, { pvr: 1900.1, ppu: 2.5, netProfit: 19001, units: 10, menuUsage: 100, csiBelow: 0, csiMonthsBelow: 1, uncashedContracts: 0, vscPenetration: 0 });
  assert.equal(over.effectiveRatePct, 16.5);
  // menu edge: 95 exactly → no penalty; 94.9 → −5%
  const menuOk = computePay(FINANCE_COMP_PLAN, { pvr: 1400, ppu: 2.0, netProfit: 28000, units: 20, menuUsage: 95, csiBelow: 0, csiMonthsBelow: 1, uncashedContracts: 0, vscPenetration: 0 });
  assert.equal(menuOk.penalties.length, 0);
  const menuBad = computePay(FINANCE_COMP_PLAN, { pvr: 1400, ppu: 2.0, netProfit: 28000, units: 20, menuUsage: 94.9, csiBelow: 0, csiMonthsBelow: 1, uncashedContracts: 0, vscPenetration: 0 });
  assert.equal(menuBad.penalties[0].pct, 5); // 13% × 28,000 = 3,640 → −182
  assert.ok(Math.abs(menuBad.penalties[0].amount - 182) < 0.01);
  // CSI escalation: 1 → −5%, 3 consecutive → −11%
  const csi3 = computePay(FINANCE_COMP_PLAN, { pvr: 1400, ppu: 2.0, netProfit: 28000, units: 20, menuUsage: 100, csiBelow: 1, csiMonthsBelow: 3, uncashedContracts: 0, vscPenetration: 0 });
  assert.equal(csi3.penalties[0].pct, 11);
  // uncashed contracts: 4 × $200
  const un = computePay(FINANCE_COMP_PLAN, { pvr: 1400, ppu: 2.0, netProfit: 28000, units: 20, menuUsage: 100, csiBelow: 0, csiMonthsBelow: 1, uncashedContracts: 4, vscPenetration: 0 });
  assert.equal(un.deductions[0].amount, 800);
});

test("AUDIT F&I fuzz: 3,000 months through calculateFinancePay vs the oracle (same seed as lite)", () => {
  const rnd = lcg(1900);
  for (let i = 0; i < 3000; i++) {
    const units = 1 + Math.floor(rnd() * 80);
    const pvrish = 800 + rnd() * 1600;
    const ppuish = 1.0 + rnd() * 2.0;
    const back = Math.round(pvrish * units * 100) / 100;
    const products = Math.round(ppuish * units * 10) / 10;
    const vscUnits = Math.round(rnd() * units);
    const menuOk = !(rnd() < 0.2);
    const csiOk = !(rnd() < 0.2);
    const csiMonths = 1 + Math.floor(rnd() * 4);
    // calculateFinancePay doesn't take uncashed (defaults 0) — engine-level test above covers it
    const m: FiMonth = { units, back, products, vsc: (vscUnits / units) * 100, menuOk, csiOk, csiMonths, uncashed: 0 };
    const want = oracleFi(m);
    const got = calculateFinancePay({ units, backGross: back, products, vscUnits, menuMet: menuOk, csiMet: csiOk, csiMonthsBelow: csiMonths });
    assert.equal(got.effectivePct, want.rate, `month ${i} rate: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(got.commission - want.commission) < 0.02, `month ${i} commission: ${got.commission} vs ${want.commission}`);
    assert.ok(Math.abs(got.estCheck - want.estCheck) < 0.02, `month ${i} estCheck: ${got.estCheck} vs ${want.estCheck}`);
  }
});
