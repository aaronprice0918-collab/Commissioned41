import test from "node:test";
import assert from "node:assert/strict";
import { calculateFinancePay, gridLookup } from "./financePayPlan.ts";
import { salesCommissionForDeal, volumeBonus } from "./salesPay.ts";
import { defaultSalesPlan, type SalesPlan } from "../components/PayPlanProvider.tsx";
import type { Deal } from "./data.ts";

// ── F&I grid lookup — coordinates + percent ──────────────────────────────────
test("gridLookup: PVR 1400 × PPU 2.0 lands on 13.0% (row 3, col 4)", () => {
  const g = gridLookup(1400, 2.0);
  assert.equal(g.pct, 13.0);
  assert.equal(g.rowIndex, 3);
  assert.equal(g.colIndex, 4);
  assert.equal(g.belowGrid, false);
});

test("gridLookup: below-grid inputs clamp to the floor cell and flag belowGrid", () => {
  const g = gridLookup(900, 1.2); // both under the lowest band
  assert.equal(g.rowIndex, 0);
  assert.equal(g.colIndex, 0);
  assert.equal(g.pct, 9.5); // GRID[0][0]
  assert.equal(g.belowGrid, true);
});

// ── calculateFinancePay — full money trace on realistic inputs ───────────────
test("calculateFinancePay: 50 units, $70k back, 100 products, 30 VSC → 13.5%, $1,450 check", () => {
  const pay = calculateFinancePay({
    units: 50,
    backGross: 70000,
    products: 100, // PPU 2.0
    vscUnits: 30, // 60% VSC penetration → +0.5% bonus
  });
  assert.equal(pay.pvr, 1400); // 70000 / 50
  assert.equal(pay.ppu, 2.0); // 100 / 50
  assert.equal(pay.vscPenetration, 60);
  assert.equal(pay.basePct, 13.0); // grid[2.0][$1400]
  assert.equal(pay.vscBonusPct, 0.5);
  assert.equal(pay.pvrBonusPct, 0); // 1400 not over 1900
  assert.equal(pay.effectivePct, 13.5);
  assert.equal(pay.commission, 9450); // 13.5% × 70000
  assert.equal(pay.penaltyAmount, 0);
  assert.equal(pay.drawMonthly, 8000);
  assert.equal(pay.estCheck, 1450); // 9450 − 8000
});

test("calculateFinancePay: PVR over $1,900 stacks the +0.5% PVR bonus", () => {
  const pay = calculateFinancePay({
    units: 20,
    backGross: 40000, // PVR 2000
    products: 50, // PPU 2.5
    vscUnits: 0,
  });
  assert.equal(pay.pvr, 2000);
  assert.equal(pay.ppu, 2.5);
  assert.equal(pay.pvrBonusPct, 0.5); // PVR > 1900
  assert.equal(pay.vscBonusPct, 0);
  // base = grid[PPU 2.5 row][PVR 1700 col (clamped)] = 16.0; +0.5 = 16.5
  assert.equal(pay.basePct, 16.0);
  assert.equal(pay.effectivePct, 16.5);
  assert.equal(pay.commission, 6600); // 16.5% × 40000
});

test("calculateFinancePay: menu under 95% applies a −5% penalty of gross", () => {
  const pay = calculateFinancePay({
    units: 40,
    backGross: 60000, // PVR 1500
    products: 92, // PPU 2.3
    vscUnits: 0,
    menuMet: false, // trips the menu penalty
  });
  assert.equal(pay.pvr, 1500);
  assert.equal(pay.ppu, 2.3);
  assert.equal(pay.basePct, 14.5); // grid[2.3][$1500]
  assert.equal(pay.effectivePct, 14.5);
  assert.equal(pay.commission, 8700); // 14.5% × 60000
  assert.equal(pay.menuPenaltyPct, 5);
  assert.equal(pay.penaltyAmount, 435); // 5% × 8700
  assert.equal(pay.commissionAfterPenalty, 8265);
  assert.equal(pay.estCheck, 265); // 8700 − 435 − 8000
});

test("calculateFinancePay: CSI below region for 3 consecutive months escalates the penalty", () => {
  const pay = calculateFinancePay({
    units: 40,
    backGross: 60000,
    products: 92,
    vscUnits: 0,
    csiMet: false,
    csiMonthsBelow: 3, // 5% + 3%×(3−1) = 11%
  });
  assert.equal(pay.csiPenaltyPct, 11);
  assert.equal(pay.penaltyAmount, 957); // 11% × 8700
});

test("calculateFinancePay: zero units never divides by zero and pays nothing", () => {
  const pay = calculateFinancePay({ units: 0, backGross: 0, products: 0, vscUnits: 0 });
  assert.equal(pay.pvr, 0);
  assert.equal(pay.ppu, 0);
  assert.equal(pay.vscPenetration, 0);
  assert.equal(pay.commission, 0);
  // draw still recoups, so the check is negative (owes the draw back)
  assert.equal(pay.estCheck, -8000);
});

// ── Sales per-deal commission ────────────────────────────────────────────────
const plan: SalesPlan = defaultSalesPlan;

function deal(p: { vehicleClass: Deal["vehicleClass"]; frontGross: number }): Deal {
  return {
    id: "d1",
    date: "2025-06-10",
    customer: "C",
    stockNumber: "S1",
    vin: "V1",
    vehicleClass: p.vehicleClass,
    salesperson: "Rep",
    manager: "M",
    financeManager: "F",
    lender: "",
    tradeInfo: "",
    frontGross: p.frontGross,
    backGrossReserve: 0,
    products: {},
  } as Deal;
}

test("salesCommissionForDeal: NEW unit pays the high/mid/mini flat by gross band", () => {
  // defaultSalesPlan: newHighMin 1 → $400; newMidMin -300 → $250; below → $150
  assert.equal(salesCommissionForDeal(deal({ vehicleClass: "New", frontGross: 2500 }), plan), 400);
  assert.equal(salesCommissionForDeal(deal({ vehicleClass: "New", frontGross: 0 }), plan), 250);
  assert.equal(salesCommissionForDeal(deal({ vehicleClass: "New", frontGross: -500 }), plan), 150);
});

test("salesCommissionForDeal: USED pays a percent with a high-gross kicker and a floor", () => {
  // usedPct 25, usedHighPct 30, usedHighMin 3000, floor 150
  assert.equal(salesCommissionForDeal(deal({ vehicleClass: "Used", frontGross: 2000 }), plan), 500); // 25% × 2000
  assert.equal(salesCommissionForDeal(deal({ vehicleClass: "Used", frontGross: 4000 }), plan), 1200); // 30% × 4000 (>= 3000)
  assert.equal(salesCommissionForDeal(deal({ vehicleClass: "Used", frontGross: 100 }), plan), 150); // floor
});

test("salesCommissionForDeal: anything else (Wholesale) pays the flat mini", () => {
  assert.equal(salesCommissionForDeal(deal({ vehicleClass: "Wholesale", frontGross: 9999 }), plan), 150);
});

// ── Sales volume bonus ladder ────────────────────────────────────────────────
test("volumeBonus: highest qualifying tier wins, not stacked", () => {
  // ladder: 12→500, 15→1000, 18→1300, 21→1600, 24→1900 (signed plan; corrected from 1800 July 6)
  assert.equal(volumeBonus(11, plan), 0);
  assert.equal(volumeBonus(12, plan), 500);
  assert.equal(volumeBonus(14, plan), 500);
  assert.equal(volumeBonus(15, plan), 1000);
  assert.equal(volumeBonus(20, plan), 1300);
  assert.equal(volumeBonus(24, plan), 1900);
  assert.equal(volumeBonus(100, plan), 1900); // caps at the top tier
});
