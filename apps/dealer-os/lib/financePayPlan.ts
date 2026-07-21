// ── F&I Manager pay plan — the REAL Kennesaw Mazda model ──────────────────────
// Finance managers are NOT paid "base + flat + back %". They're paid a
// PERCENTAGE of net profit, where the percentage is looked up on a PVR × PPU
// grid, then adjusted by bonuses and penalties. This models Aaron's actual plan
// (eff. 8/1/2025). Money-correctness is sacred — these numbers are transcribed
// straight from the signed pay plan.
//
// The MONEY now flows through the universal compensation engine (lib/payEngine):
// this file defines Aaron's grid as a CompPlan and delegates the calculation, so
// the F&I plan is just one instance of the same engine every other plan uses.

import { computePay, type CompPlan, type Opportunity, type Confidence } from "@/lib/payEngine";

// Grid axes. Each step right (PVR) or down (PPU) adds 0.5%.
export const PVR_COLS = [1050, 1100, 1200, 1300, 1400, 1500, 1600, 1700];
export const PPU_ROWS = [1.4, 1.6, 1.8, 2.0, 2.2, 2.3, 2.5];

// pct[rowIndex][colIndex] — percent of net profit.
export const GRID: number[][] = [
  [9.5, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0], // 1.4
  [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5], // 1.6
  [10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0], // 1.8
  [11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5], // 2.0
  [11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0], // 2.2
  [12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5], // 2.3
  [12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5, 16.0], // 2.5
];

export const FINANCE_PLAN = {
  drawMonthly: 8000, // $8,000 TOTAL per month, advanced and recouped from commission
  pvrBonusThreshold: 1900,
  pvrBonusPct: 0.5,
  vscBonusThreshold: 50, // % penetration
  vscBonusPct: 0.5,
  menuMin: 95, // under this → −5% of gross (manual; not auto-tracked)
  uncashedFine: 200, // per contract not cashed within 20 days (manual)
};

// Largest index whose threshold is still ≤ value (clamped into the grid).
function bandIndex(value: number, thresholds: number[]): number {
  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]) idx = i;
  }
  return idx;
}

export function gridLookup(pvr: number, ppu: number): { pct: number; rowIndex: number; colIndex: number; belowGrid: boolean } {
  const colIndex = bandIndex(pvr, PVR_COLS);
  const rowIndex = bandIndex(ppu, PPU_ROWS);
  const belowGrid = pvr < PVR_COLS[0] || ppu < PPU_ROWS[0];
  return { pct: GRID[rowIndex][colIndex], rowIndex, colIndex, belowGrid };
}

// Aaron's F&I plan expressed in the universal engine's normalized model.
export const FINANCE_COMP_PLAN: CompPlan = {
  id: "kennesaw-fi-2025",
  name: "F&I Manager — Kennesaw Mazda",
  role: "F&I",
  effectiveDate: "2025-08-01",
  sourceDoc: "Kennesaw Mazda F&I Pay Plan (signed)",
  cycle: { mode: "calendarMonth", periodNoun: "month" },
  vocab: { currency: "USD", unitNoun: "unit", periodNoun: "month" },
  rules: [
    { kind: "grid", base: "netProfit", x: { metric: "pvr", tiers: PVR_COLS }, y: { metric: "ppu", tiers: PPU_ROWS }, cells: GRID },
    { kind: "bonus", id: "pvr-bonus", label: "PVR over $1,900", when: { metric: "pvr", op: ">", value: 1900 }, addRatePct: 0.5 },
    { kind: "bonus", id: "vsc-bonus", label: "VSC over 50%", when: { metric: "vscPenetration", op: ">", value: 50 }, addRatePct: 0.5 },
    { kind: "penalty", id: "menu", label: "Menu usage under 95%", when: { metric: "menuUsage", op: "<", value: 95 }, reduceGrossPct: 5 },
    { kind: "penalty", id: "csi", label: "CSI below region", when: { metric: "csiBelow", op: ">=", value: 1 }, reduceGrossPct: 5, consecutiveMetric: "csiMonthsBelow", addPctPerConsecutive: 3 },
    { kind: "deduction", id: "uncashed", label: "Contracts uncashed > 20 days", perEventMetric: "uncashedContracts", amountPerEvent: 200 },
    { kind: "draw", id: "draw", label: "Monthly draw", monthly: 8000 },
  ],
};

export type FinancePayInput = {
  units: number; // countable F&I units (ex fleet/wholesale)
  backGross: number; // net F&I profit proxy (chargebacks not tracked → uses gross)
  products: number; // total product units
  vscUnits: number; // units with a VSC sold
  menuMet?: boolean; // default true; false → −5% of gross
  csiMet?: boolean; // default true; false → −5% (+3% per extra consecutive month)
  csiMonthsBelow?: number; // consecutive months below region (1 = this month)
};

export type FinancePay = {
  pvr: number;
  ppu: number;
  vscPenetration: number;
  basePct: number;
  pvrBonusPct: number;
  vscBonusPct: number;
  effectivePct: number;
  netProfit: number;
  commission: number;
  menuPenaltyPct: number;
  csiPenaltyPct: number;
  penaltyAmount: number;
  commissionAfterPenalty: number;
  drawMonthly: number;
  estCheck: number; // commission (after penalties) net of the month's draws
  belowGrid: boolean;
  rowIndex: number;
  colIndex: number;
  // From the universal engine — surfaced in the UI.
  opportunities: Opportunity[];
  explanation: string[];
  confidence: Confidence;
  warnings: string[];
};

export function calculateFinancePay(input: FinancePayInput): FinancePay {
  const pvr = input.units ? input.backGross / input.units : 0;
  const ppu = input.units ? input.products / input.units : 0;
  const vscPenetration = input.units ? (input.vscUnits / input.units) * 100 : 0;

  // Translate the F&I inputs into the engine's performance metrics, then let the
  // universal engine do the math (grid lookup → bonuses → penalties → draw).
  const r = computePay(FINANCE_COMP_PLAN, {
    pvr,
    ppu,
    vscPenetration,
    netProfit: input.backGross,
    units: input.units,
    menuUsage: input.menuMet === false ? 0 : 100, // <95 trips the penalty
    csiBelow: input.csiMet === false ? 1 : 0,
    csiMonthsBelow: input.csiMonthsBelow ?? 1,
    uncashedContracts: 0,
  });

  // Table-highlight coordinates come from the same grid.
  const { rowIndex, colIndex, belowGrid } = gridLookup(pvr, ppu);

  const pvrBonusPct = r.bonuses.find((b) => b.label.includes("PVR"))?.pct ?? 0;
  const vscBonusPct = r.bonuses.find((b) => b.label.includes("VSC"))?.pct ?? 0;
  const menuPenaltyPct = r.penalties.find((p) => p.label.toLowerCase().includes("menu"))?.pct ?? 0;
  const csiPenaltyPct = r.penalties.find((p) => p.label.toLowerCase().includes("csi"))?.pct ?? 0;
  const penaltyAmount = r.penalties.reduce((s, p) => s + p.amount, 0) + r.deductions.reduce((s, d) => s + d.amount, 0);

  return {
    pvr,
    ppu,
    vscPenetration,
    basePct: r.baseRatePct,
    pvrBonusPct,
    vscBonusPct,
    effectivePct: r.effectiveRatePct,
    netProfit: r.base,
    commission: r.grossCommission,
    menuPenaltyPct,
    csiPenaltyPct,
    penaltyAmount,
    commissionAfterPenalty: r.grossCommission - penaltyAmount,
    drawMonthly: r.drawOffset,
    estCheck: r.netEstimatedPay,
    belowGrid,
    rowIndex,
    colIndex,
    opportunities: r.opportunities,
    explanation: r.explanation,
    confidence: r.confidence,
    warnings: r.warnings,
  };
}
