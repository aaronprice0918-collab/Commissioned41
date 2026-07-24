import { classifyPlan } from "./calc";
import { BaseRules, GridRule, PayPlan } from "./types";

// Fill a partial plan into a complete, classified PayPlan. Used by defaults,
// the AI parser output, and migrations — so every plan is well-formed.
export function makePlan(p: Omit<Partial<PayPlan>, "base"> & { role: string; base?: Partial<BaseRules> }): PayPlan {
  const base = {
    version: 1 as const,
    role: p.role,
    type: "unknown" as const,
    label: p.label,
    effectiveDate: p.effectiveDate,
    sourceRef: p.sourceRef,
    base: { salary: 0, frontPct: 0, backPct: 0, perUnit: 0, perProduct: 0, basis: "total" as const, ...(p.base || {}) },
    grid: p.grid,
    perDeal: p.perDeal,
    tiers: p.tiers ?? [],
    bonuses: p.bonuses ?? [],
    deductions: p.deductions ?? [],
    penalties: p.penalties ?? [],
    draw: p.draw,
    trueUp: p.trueUp,
    guaranteeFloor: p.guaranteeFloor, // was silently dropped — parsed/migrated plans lost their guarantee (July 5 audit)
    goalUnits: p.goalUnits ?? 0,
    taxRate: p.taxRate ?? 0,
    // Same silent-drop bug as guaranteeFloor above (found July 24): rebuilding a
    // plan through makePlan wiped the rep's OWN take-home goal (the Climb summit)
    // and their carried-in draw balance — so a re-parsed or migrated plan quietly
    // forgot advance money still owed, and the goal they set for themselves.
    takeHomeGoal: p.takeHomeGoal,
    drawCarriedIn: p.drawCarriedIn,
    unsupported: p.unsupported ?? [],
    confidence: p.confidence ?? 0.7,
  };
  return { ...base, type: classifyPlan(base) };
}

export const KENNESAW_GRID: GridRule = {
  xAxis: "pvr",
  x: [1050, 1100, 1200, 1300, 1400, 1500, 1600, 1700],
  yAxis: "ppt",
  y: [1.4, 1.6, 1.8, 2.0, 2.2, 2.3, 2.5],
  rates: [
    [9.5, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0],
    [10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5],
    [10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0],
    [11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5],
    [11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0],
    [12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5],
    [12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5, 16.0],
  ],
  basis: "back",
};

// Aaron's real Kennesaw Mazda F&I pay plan, fully modeled.
export function kennesawFinancePlan(): PayPlan {
  return makePlan({
    role: "finance",
    label: "Kennesaw Mazda — Finance Manager",
    effectiveDate: "2025-08-01",
    grid: { ...KENNESAW_GRID },
    bonuses: [
      { id: "pvr1900", label: "PVR $1,900+", condition: { metric: "pvr", op: "gte", value: 1900 }, effect: { kind: "addRatePct", amount: 0.5 } },
      { id: "vsc50", label: "VSC penetration 50%+", condition: { metric: "vscPenetration", op: "gte", value: 50 }, effect: { kind: "addRatePct", amount: 0.5 } },
    ],
    penalties: [
      { id: "menu", label: "Menu usage below 95%", condition: { metric: "menuUsage", op: "lt", value: 95 }, reduceGrossPct: 5 },
      { id: "csi", label: "CSI below region", condition: { metric: "csiBelowRegion", op: "gte", value: 1 }, reduceGrossPct: 5, consecutiveMetric: "csiConsecutiveBelow", consecutiveAdditionalPct: 3 },
    ],
    deductions: [
      { id: "uncashed", label: "Contracts not cashed in 20 days ($200 ea)", kind: "perOccurrence", amount: 200, metric: "contractsNotCashed" },
    ],
    draw: { amount: 8000, period: "semimonthly", recoverable: true },
    trueUp: { description: "Trued up to actual accounting statement; net profit = gross less chargebacks (trailing 12 mo)." },
    goalUnits: 60,
  });
}

// Role defaults (a reasonable starting plan the user then tweaks).
export function defaultPlan(role: string): PayPlan {
  if (role === "finance") return kennesawFinancePlan();
  if (role === "sales") {
    return makePlan({
      role,
      base: { salary: 0, frontPct: 25, backPct: 5, perUnit: 0, perProduct: 50, basis: "total" },
      tiers: [
        { id: "u10", label: "10-unit bonus", metric: "units", threshold: 10, kind: "flat", amount: 500 },
        { id: "u15", label: "15-unit bonus", metric: "units", threshold: 15, kind: "flat", amount: 1250 },
        { id: "u20", label: "20-unit bonus", metric: "units", threshold: 20, kind: "flat", amount: 2500 },
      ],
      goalUnits: 15, confidence: 0.9,
    });
  }
  if (role === "sales_manager") {
    return makePlan({ role, base: { salary: 0, frontPct: 3, backPct: 1, perUnit: 0, basis: "total" }, draw: { amount: 6000, period: "monthly", recoverable: true },
      tiers: [{ id: "v70", label: "70-unit store bonus", metric: "units", threshold: 70, kind: "flat", amount: 1500 }, { id: "v90", label: "90-unit store bonus", metric: "units", threshold: 90, kind: "flat", amount: 4000 }],
      goalUnits: 80, confidence: 0.85 });
  }
  // bdc
  return makePlan({ role, base: { salary: 0, frontPct: 0, backPct: 0, perUnit: 125, basis: "total" },
    tiers: [{ id: "a20", label: "20-unit spiff", metric: "units", threshold: 20, kind: "flat", amount: 400 }, { id: "a30", label: "30-unit spiff", metric: "units", threshold: 30, kind: "flat", amount: 900 }],
    goalUnits: 30, confidence: 0.85 });
}
