// Universal compensation rules engine — normalized PayPlan model.
// Plan-agnostic: a flat sales plan, a tiered plan, an F&I PVR×PPU grid, or any
// hybrid all reduce to this shape. The calculator (calc.ts) reads ONLY this.

export type PlanType = "flat" | "tiered" | "grid" | "perDeal" | "hybrid" | "unknown";

// Metrics any rule can condition on or be measured against.
export type Metric =
  | "pvr" // per-vehicle retail (basis gross / units)
  | "ppt" // products per unit (a.k.a. PPU)
  | "units"
  | "frontGross"
  | "backGross"
  | "totalGross"
  | "products"
  | "vscPenetration" // %
  | "menuUsage" // %
  | "csiBelowRegion" // 1 if below region, else 0
  | "csiConsecutiveBelow" // # consecutive months below
  | "contractsNotCashed" // count
  | "chargebacks" // $
  | "backPvr" // back-end gross per unit — independent of the plan's basis (sales plans need back PVR for finance bonuses)
  | "fastStartUnits"; // units delivered by the 15th of the month

export type Op = "gt" | "gte" | "lt" | "lte" | "eq";
export interface Condition { metric: Metric; op: Op; value: number }

export type Basis = "front" | "back" | "total";

// ---- rule kinds ----
export interface BaseRules {
  salary: number; // flat monthly salary
  frontPct: number; // % of front gross
  backPct: number; // % of back gross
  perUnit: number; // $ per unit (mini/flat)
  perProduct: number; // $ per F&I product sold
  basis: Basis; // what % rules apply to by default
}

export interface GridRule {
  xAxis: "pvr";
  x: number[]; // PVR column thresholds, ascending
  yAxis: "ppt";
  y: number[]; // PPU row thresholds, ascending
  rates: number[][]; // rates[yIndex][xIndex] as a percent
  basis: Basis; // net profit basis the rate applies to (F&I = back)
}

export interface TierRule {
  id: string;
  label: string;
  metric: "units" | "totalGross" | "backGross" | "frontGross";
  threshold: number; // metric >= threshold qualifies
  kind: "flat" | "pct"; // flat $ bonus, or % of basis
  amount: number;
  basis?: Basis; // for pct
}

export interface BonusRule {
  id: string;
  label: string;
  // A single condition, or an ARRAY meaning ALL must hold (e.g. the Kennesaw
  // finance bonus: 10+ units AND back PVR ≥ $1,300 — one gate, not two bonuses).
  condition: Condition | Condition[];
  effect:
    | { kind: "addRatePct"; amount: number } // adds to the grid/commission rate %
    | { kind: "pctOfBasis"; amount: number; basis: Basis } // $ = amount% * basis gross
    | { kind: "flat"; amount: number }; // flat $
}

export interface DeductionRule {
  id: string;
  label: string;
  kind: "perOccurrence" | "flat" | "pctOfGrossPay";
  amount: number; // $ per occurrence / flat $ / percent
  metric?: Metric; // count source for perOccurrence (e.g. contractsNotCashed)
}

export interface PenaltyRule {
  id: string;
  label: string;
  condition: Condition; // when it applies
  reduceGrossPct: number; // % reduction of gross pay
  consecutiveMetric?: Metric; // e.g. csiConsecutiveBelow
  consecutiveAdditionalPct?: number; // additional % per consecutive month beyond the first
}

export interface DrawRule { amount: number; period: "monthly" | "semimonthly"; recoverable: boolean }
export interface TrueUpRule { description: string }

// ---- per-deal commission ----
// How most SALES plans actually pay: each deal is commissioned on ITS OWN
// front gross, with a minimum ("mini") per deal — a loser deal pays the mini,
// it does NOT claw money back from the month (the Rodney Stegall bug, July 6:
// a −$1,750-front deal showed $0 pay instead of the plan's $150 mini).
export interface DealBand { min: number; flat?: number; pct?: number } // highest band whose min ≤ the deal's gross wins
export interface DealSegment {
  bands?: DealBand[]; // flat-$ (or %) by gross band, e.g. New: ≥$1→$400, ≥−$300→$250, below→$150
  pct?: number; // ...or a % of the deal's gross, e.g. Used: 25%
  highMin?: number; // gross at/above which highPct applies (Used: ≥$3,000 → 30%)
  highPct?: number;
  minFlat?: number; // per-deal minimum for this segment
}
export interface PerDealRule {
  segments?: Record<string, DealSegment>; // keyed by the deal's category ("new"/"used"/"lease"…)
  default?: DealSegment; // deals with no/unknown category
  minFlat?: number; // plan-wide per-deal minimum unless the segment overrides
}

export interface PayPlan {
  version: 1;
  role: string;
  type: PlanType; // classified by classifyPlan()
  label?: string;
  effectiveDate?: string;
  sourceRef?: string; // uploaded filename
  base: BaseRules;
  grid?: GridRule;
  perDeal?: PerDealRule;
  tiers: TierRule[];
  bonuses: BonusRule[];
  deductions: DeductionRule[];
  penalties: PenaltyRule[];
  draw?: DrawRule;
  trueUp?: TrueUpRule;
  guaranteeFloor?: number; // monthly minimum earned pay (0/undefined = none)
  goalUnits: number;
  taxRate: number;
  takeHomeGoal?: number; // monthly take-home ($, after tax) income target — the rep sets their own
  drawCarriedIn?: number; // recoverable-draw balance still OWED at the start of this month (rolls over from prior months)
  unsupported: string[]; // structures we couldn't map → flagged for review, never silently dropped
  confidence: number; // 0..1 parse confidence
}

// ---- performance input for a month ----
export interface PerfInput {
  units: number;
  frontGross: number;
  backGross: number;
  products: number;
  fastStartUnits?: number; // units delivered by the 15th (fast-start bonuses)
  // Each counted deal's own numbers, when known — required for perDeal rules
  // (a monthly total can't tell a $2,000 deal + a loser from two $1,000 deals).
  // `weight` scales a deal's contribution (stage-weighted pipeline, pace).
  dealRows?: { front: number; category?: string; weight?: number }[];
  vscPenetration?: number; // %
  menuUsage?: number; // %
  csiBelowRegion?: boolean;
  csiConsecutiveBelow?: number;
  contractsNotCashed?: number;
  chargebacks?: number;
}

// ---- calculation result ----
export interface CalcLine { label: string; amount: number } // signed $
export interface CalcStep { label: string; detail: string }
export interface NextTier {
  axis: "ppt" | "pvr" | "units" | "gross" | "penetration";
  label: string; // "Products per deal"
  from: number;
  to: number; // the next threshold
  addRatePct?: number;
  addPay: number; // estimated added $ this month
  hint: string; // plain-English "what to do"
}

export interface PayResult {
  planType: PlanType;
  rate: number; // effective commission rate % (0 for pure flat-$ plans)
  rateBreakdown?: { base: number; bonusRate: number; pvr: number; ppt: number };
  grossCommission: number;
  bonuses: CalcLine[];
  tierBonuses: CalcLine[];
  penalties: CalcLine[]; // negative
  deductions: CalcLine[]; // negative
  grossPay: number; // total earned this month (after bonuses/penalties/deductions, before draw)
  draw: number;
  drawOffset: number; // how much draw is recouped from this month
  remainderAfterDraw: number; // grossPay - drawOffset (the back-half check)
  drawShortfall: number; // THIS month's unrecouped draw = max(0, draw - grossPay)
  drawOwed: number; // TOTAL recoverable-draw balance owed after this month = max(0, drawCarriedIn + draw - grossPay) — "the hole"
  aboveDraw: number; // earnings beyond ALL advances owed = max(0, grossPay - draw - drawCarriedIn) — the real check building
  net: number; // = grossPay (what you earned); take-home if taxRate via netAfterTax
  netAfterTax: number;
  steps: CalcStep[]; // plain-English explanation of every line
  nextTiers: NextTier[];
  missingData: string[]; // metrics that would refine the estimate
  confidence: number; // 0..1
}
