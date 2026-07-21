// ── Universal Compensation Rules Engine ──────────────────────────────────────
// One engine for EVERY pay plan — flat, tiered, grid, bonus, deduction, penalty,
// draw, true-up, or any hybrid of those. A plan is just a normalized list of
// rules; computePay() runs them against a month of performance and returns the
// full breakdown, the next-tier opportunities, and a plain-English explanation.
// It is role- and document-agnostic: F&I, sales, desk, BDC, or a custom plan all
// flow through the same code. It never returns an empty result without a stated
// reason (see `warnings` + `confidence`).
//
// Plans are pure data, so they can be authored by hand, seeded per store, or
// (next layer) extracted from an uploaded pay-plan document by EILA into this
// exact shape.

import { makeMoney } from "./payFormat";

// ── The base $ a percentage multiplies ───────────────────────────────────────
export type Base = "netProfit" | "frontGross" | "backGross" | "totalGross" | "perUnit";

// ── Conditions (for bonuses / penalties) ─────────────────────────────────────
export type Op = ">" | ">=" | "<" | "<=" | "==";
export type Condition = { metric: string; op: Op; value: number };

// ── Rule kinds ───────────────────────────────────────────────────────────────
export type Axis = { metric: string; tiers: number[] }; // ascending tier breakpoints

export type GridRule = {
  kind: "grid";
  base: Base; // the $ the looked-up % multiplies
  x: Axis; // e.g. { metric: "pvr", tiers: [1050,...,1700] }
  y: Axis; // e.g. { metric: "ppu", tiers: [1.4,...,2.5] }
  cells: number[][]; // cells[yIndex][xIndex] = payout percent
};

export type FlatRule = {
  kind: "flat";
  base: Base;
  pct: number; // percent of base
};

// Month-level tiered rate/flat: pick the highest tier whose `min` <= metric value.
export type TierRule = {
  kind: "tier";
  metric: string; // e.g. "units"
  base?: Base; // present when tiers pay a pct of a base
  tiers: { min: number; pct?: number; flat?: number }[];
  // DEPRECATED, never read: tiers ALWAYS pay the single best rung (non-stacked).
  // Kept only so stored plans with the field still typecheck; authoring
  // stacked tiers is not supported — write cumulative flats into each rung.
  nonStacked?: boolean;
};

// Per-deal commission — the engine's model for plans paid car-by-car (most sales
// consultant plans). Each deal's `value` (e.g. its CGP) is banded, optionally
// segmented by a category (e.g. vehicleClass), to a flat amount or a percent of
// that value, with a floor. Deal rows are passed to computePay; each row's
// commission is multiplied by its `share` (splits) and summed.
export type PerDealSegment = {
  bands?: { min: number; flat?: number; pct?: number }[]; // highest min <= value wins
  pct?: number; // simple percent of value
  highMin?: number; // percent bumps to highPct at/above this value
  highPct?: number;
  minFlat?: number; // per-deal floor ("mini")
};
export type PerDealRule = {
  kind: "perDeal";
  value: string; // per-deal metric to band on, e.g. "cgp"
  segmentBy?: string; // per-deal category, e.g. "vehicleClass"
  segments?: Record<string, PerDealSegment>;
  default?: PerDealSegment; // used when no segment matches
  minFlat?: number; // global per-deal floor
};

export type BonusRule = {
  kind: "bonus";
  id: string;
  label: string;
  when: Condition | Condition[]; // an array means ALL must hold (AND)
  addRatePct?: number; // adds to the base/grid rate (e.g. +0.5%)
  addFlat?: number; // flat dollars added
};

export type PenaltyRule = {
  kind: "penalty";
  id: string;
  label: string;
  when: Condition; // e.g. { metric: "menuUsage", op: "<", value: 95 }
  reduceGrossPct: number; // % of gross commission removed
  consecutiveMetric?: string; // e.g. "csiMonthsBelow"
  addPctPerConsecutive?: number; // extra % for each month beyond the first
};

export type DeductionRule = {
  kind: "deduction";
  id: string;
  label: string;
  perEventMetric: string; // e.g. "uncashedContracts"
  amountPerEvent: number; // e.g. 200
};

// A draw/advance recouped from commission. `amount` is the draw for ONE pay
// period; `per` records whether that period is a cycle or a month (metadata for
// callers that prorate — computePay itself computes a single period). `monthly`
// is the legacy field, kept so existing plans/tests keep working.
export type DrawRule = { kind: "draw"; id: string; label?: string; monthly?: number; amount?: number; per?: "cycle" | "month" };

export type TrueUpRule = { kind: "trueup"; id: string; label: string; note: string };

export type CompRule = GridRule | FlatRule | TierRule | PerDealRule | BonusRule | PenaltyRule | DeductionRule | DrawRule | TrueUpRule;

// A per-deal row of metrics for perDeal rules (e.g. { cgp: 2400, vehicleClass: "New", share: 1 }).
export type DealRow = Record<string, number | string>;

// ── Pay cycle — how often, and when, a plan pays ─────────────────────────────
// Fully arbitrary so ANY industry's schedule fits: fixed-length (weekly = 7,
// biweekly = 14, or any N), calendar-month, semi-monthly, quarterly, or an
// explicit list of custom period-start dates. `payOffsetDays` /
// `payDayOfNextPeriod` capture the earned-vs-paid gap (e.g. "earned this week,
// check issued 5 days after it closes"). The engine computes ONE period at a
// time; lib/payCycle.ts turns this into concrete start/end/payDate windows.
export type PayCycleMode = "fixedLength" | "calendarMonth" | "semiMonthly" | "quarterly" | "custom";
export type PayCycle = {
  mode: PayCycleMode;
  anchor?: string; // ISO date a known period starts on (fixedLength/custom reference)
  lengthDays?: number; // fixedLength: 7, 14, 10, …
  semiMonthlyDays?: [number, number]; // e.g. [1, 16] — the two period-start days of the month
  customBoundaries?: string[]; // custom: explicit ISO period-start dates (ascending)
  payOffsetDays?: number; // paycheck issued this many days after a period closes
  payDayOfNextPeriod?: number; // …or on the Nth day of the following period (overrides payOffsetDays)
  periodNoun?: string; // wording: "month" | "pay period" | "week" | "sprint"
  timezone?: string; // reserved; windows are computed at local noon today
};

// ── Vocabulary — every user-facing word/number format as data, not code ──────
// Lets one engine speak any industry's language: relabel metrics, change the
// currency/locale, rename the unit noun. Absent → USD / en-US / automotive
// defaults (so existing plans read exactly as before).
export type MetricDef = { key: string; label: string; format?: "money" | "number" | "percent" | "ratio"; hint?: string };
export type PlanVocabulary = {
  currency?: string; // ISO 4217, default "USD"
  locale?: string; // BCP-47, default "en-US"
  unitNoun?: string; // "unit" | "deal" | "placement" | "policy" | "job"
  periodNoun?: string; // "month" | "pay period" | "week"
  metrics?: MetricDef[]; // per-plan metric labels/formats
};

// ── The normalized plan ──────────────────────────────────────────────────────
export type CompPlan = {
  id: string;
  name: string;
  role?: string;
  effectiveDate?: string;
  sourceDoc?: string;
  cycle?: PayCycle; // how/when this plan pays; absent = calendar-month (legacy)
  vocab?: PlanVocabulary; // wording + currency; absent = USD/automotive defaults
  rules: CompRule[];
};

// ── Inputs / outputs ─────────────────────────────────────────────────────────
export type Performance = Record<string, number>; // pvr, ppu, units, backGross, vscPenetration, menuUsage, csiBelow, csiMonthsBelow, uncashedContracts, ...

export type PlanType = "flat" | "tiered" | "grid" | "hybrid" | "unsupported";
export type Confidence = "high" | "medium" | "low";

export type Opportunity = { label: string; detail: string; addedRatePct?: number; estAddedPay?: number };
export type LineItem = { label: string; amount: number; pct?: number };

export type CompResult = {
  planType: PlanType;
  baseRatePct: number; // base/grid rate before bonuses
  effectiveRatePct: number; // after bonus rate adds
  base: number; // the $ amount the rate multiplied
  grossCommission: number;
  bonuses: LineItem[];
  penalties: LineItem[];
  deductions: LineItem[];
  drawOffset: number;
  netEstimatedPay: number;
  opportunities: Opportunity[];
  explanation: string[];
  confidence: Confidence;
  warnings: string[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────
// Default (USD) money formatter — used where no plan vocab is in scope. Inside
// computePay a vocab-aware formatter shadows this so any currency reads right.
const money = makeMoney();

function tierIndex(value: number, tiers: number[]): number {
  // Largest index whose breakpoint is <= value; clamps to 0 (below-grid floor).
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) if (value >= tiers[i]) idx = i;
  return idx;
}

function testOne(c: Condition, perf: Performance): boolean {
  const v = perf[c.metric];
  if (v == null || Number.isNaN(v)) return false;
  switch (c.op) {
    case ">": return v > c.value;
    case ">=": return v >= c.value;
    case "<": return v < c.value;
    case "<=": return v <= c.value;
    case "==": return v === c.value;
  }
}
// An array of conditions means ALL must hold (AND).
function testCondition(when: Condition | Condition[], perf: Performance): boolean {
  return Array.isArray(when) ? when.every((c) => testOne(c, perf)) : testOne(when, perf);
}

function baseAmount(base: Base | undefined, perf: Performance): number {
  if (!base) return 0;
  if (base === "perUnit") return perf.units || 0;
  return perf[base] ?? 0;
}

// Commission for ONE deal under a perDeal rule (before its split share).
function perDealAmount(rule: PerDealRule, row: DealRow): number {
  const value = Number(row[rule.value]) || 0;
  const seg = (rule.segmentBy && rule.segments?.[String(row[rule.segmentBy])]) || rule.default;
  let amount = 0;
  if (seg) {
    if (seg.bands && seg.bands.length) {
      const band = [...seg.bands].filter((b) => value >= b.min).sort((a, b) => b.min - a.min)[0] ?? seg.bands[seg.bands.length - 1];
      amount = band.flat != null ? band.flat : value * ((band.pct ?? 0) / 100);
    } else if (seg.pct != null) {
      const pct = seg.highMin != null && value >= seg.highMin ? seg.highPct ?? seg.pct : seg.pct;
      amount = value * (pct / 100);
    }
    if (seg.minFlat != null) amount = Math.max(amount, seg.minFlat);
  }
  if (rule.minFlat != null) amount = Math.max(amount, rule.minFlat);
  return amount;
}

// ── Classification ───────────────────────────────────────────────────────────
export function classifyPlan(plan: CompPlan): PlanType {
  const hasGrid = plan.rules.some((r) => r.kind === "grid");
  const hasTier = plan.rules.some((r) => r.kind === "tier");
  const hasFlat = plan.rules.some((r) => r.kind === "flat");
  const hasPerDeal = plan.rules.some((r) => r.kind === "perDeal");
  const baseKinds = [hasGrid, hasTier, hasFlat, hasPerDeal].filter(Boolean).length;
  if (baseKinds === 0) return "unsupported";
  if (baseKinds > 1) return "hybrid";
  if (hasGrid) return "grid";
  if (hasPerDeal) return "tiered"; // per-deal banded — closest of the labels
  if (hasTier) return "tiered";
  return "flat";
}

// ── The calculation service ──────────────────────────────────────────────────
// dealRows (optional) power per-deal rules — each row is one deal's metrics.
export function computePay(plan: CompPlan, perf: Performance, dealRows?: DealRow[]): CompResult {
  const money = makeMoney(plan.vocab); // speak the plan's currency/locale (default USD)
  const explanation: string[] = [];
  const warnings: string[] = [];
  const bonuses: LineItem[] = [];
  const penalties: LineItem[] = [];
  const deductions: LineItem[] = [];

  const planType = classifyPlan(plan);
  if (planType === "unsupported") {
    warnings.push("No base commission rule (flat, tier, grid, or per-deal) found in this plan — it can't be calculated until one is added.");
  }

  // 1) Base commission — from the first grid / flat / tier / per-deal rule present.
  let baseRatePct = 0;
  let base = 0;
  let grossFromTierFlat = 0; // tier flats + per-deal commission (flat dollars, not a rate)
  const grid = plan.rules.find((r): r is GridRule => r.kind === "grid");
  const flat = plan.rules.find((r): r is FlatRule => r.kind === "flat");
  const tiers = plan.rules.filter((r): r is TierRule => r.kind === "tier");
  const perDeal = plan.rules.find((r): r is PerDealRule => r.kind === "perDeal");

  // Per-deal commission — sum each deal's banded amount × its split share.
  if (perDeal) {
    if (!dealRows) {
      warnings.push("This plan pays per deal but no deal rows were provided — per-deal commission is 0.");
    } else {
      let sum = 0;
      for (const row of dealRows) sum += perDealAmount(perDeal, row) * (Number(row.share) || 1);
      grossFromTierFlat += sum;
      explanation.push(`Per-deal commission across ${dealRows.length} deal${dealRows.length === 1 ? "" : "s"} = ${money(sum)}.`);
    }
  }

  if (grid) {
    const xv = perf[grid.x.metric];
    const yv = perf[grid.y.metric];
    if (xv == null) warnings.push(`Missing ${grid.x.metric.toUpperCase()} — grid rate can't be located on the X-axis.`);
    if (yv == null) warnings.push(`Missing ${grid.y.metric.toUpperCase()} — grid rate can't be located on the Y-axis.`);
    const xi = tierIndex(xv || 0, grid.x.tiers);
    const yi = tierIndex(yv || 0, grid.y.tiers);
    baseRatePct = grid.cells[yi]?.[xi] ?? 0;
    base = baseAmount(grid.base, perf);
    explanation.push(
      `${grid.x.metric.toUpperCase()} ${xv != null ? money(xv) : "—"} and ${grid.y.metric.toUpperCase()} ${yv != null ? (yv).toFixed(1) : "—"} land on the grid at ${baseRatePct.toFixed(1)}%.`,
    );
    if ((xv || 0) < grid.x.tiers[0] || (yv || 0) < grid.y.tiers[0]) {
      warnings.push("Performance is below the grid floor — using the lowest band.");
    }
  } else if (flat) {
    baseRatePct = flat.pct;
    base = baseAmount(flat.base, perf);
    explanation.push(`Flat rate of ${flat.pct.toFixed(1)}% on ${flat.base} (${money(base)}).`);
  }

  for (const t of tiers) {
    const v = perf[t.metric] ?? 0;
    // Best (highest-min) qualifying tier.
    const qualifying = [...t.tiers].filter((x) => v >= x.min).sort((a, b) => b.min - a.min)[0];
    if (!qualifying) continue;
    if (qualifying.pct != null) {
      // A tiered RATE — only used as the base when no grid/flat set one.
      if (!grid && !flat) {
        baseRatePct = qualifying.pct;
        base = baseAmount(t.base, perf);
        explanation.push(`${t.metric} of ${v} qualifies for the ${qualifying.pct.toFixed(1)}% tier on ${t.base}.`);
      }
    } else if (qualifying.flat != null) {
      grossFromTierFlat += qualifying.flat;
      explanation.push(`${t.metric} of ${v} earns a ${money(qualifying.flat)} tier bonus.`);
    }
  }

  // 2) Bonuses that bump the rate or add flat dollars.
  let effectiveRatePct = baseRatePct;
  for (const r of plan.rules) {
    if (r.kind !== "bonus") continue;
    if (!testCondition(r.when, perf)) continue;
    if (r.addRatePct) {
      effectiveRatePct += r.addRatePct;
      bonuses.push({ label: r.label, pct: r.addRatePct, amount: 0 });
      explanation.push(`${r.label}: +${r.addRatePct.toFixed(1)}% to the rate.`);
    }
    if (r.addFlat) {
      bonuses.push({ label: r.label, amount: r.addFlat });
      explanation.push(`${r.label}: +${money(r.addFlat)}.`);
    }
  }

  const flatBonusDollars = bonuses.reduce((s, b) => s + b.amount, 0);
  const grossCommission = base * (effectiveRatePct / 100) + grossFromTierFlat + flatBonusDollars;
  if (base > 0 || effectiveRatePct > 0) {
    explanation.push(`Gross commission = ${effectiveRatePct.toFixed(1)}% × ${money(base)}${grossFromTierFlat || flatBonusDollars ? ` + ${money(grossFromTierFlat + flatBonusDollars)} bonus` : ""} = ${money(grossCommission)}.`);
  }

  // 3) Penalties — % of gross, with consecutive-month escalation.
  let penaltyTotalPct = 0;
  for (const r of plan.rules) {
    if (r.kind !== "penalty") continue;
    if (!testCondition(r.when, perf)) continue;
    let pct = r.reduceGrossPct;
    if (r.consecutiveMetric && r.addPctPerConsecutive) {
      const months = perf[r.consecutiveMetric] ?? 1;
      pct += r.addPctPerConsecutive * Math.max(0, months - 1);
    }
    penaltyTotalPct += pct;
    const amount = grossCommission * (pct / 100);
    penalties.push({ label: r.label, pct, amount });
    explanation.push(`${r.label}: −${pct.toFixed(1)}% of gross (${money(amount)}).`);
  }
  const penaltyDollars = penalties.reduce((s, p) => s + p.amount, 0);

  // 4) Deductions — flat $ per counted event (chargebacks, uncashed contracts…).
  for (const r of plan.rules) {
    if (r.kind !== "deduction") continue;
    const events = perf[r.perEventMetric] ?? 0;
    if (events <= 0) continue;
    const amount = events * r.amountPerEvent;
    deductions.push({ label: `${r.label} (${events} × ${money(r.amountPerEvent)})`, amount });
    explanation.push(`${r.label}: ${events} × ${money(r.amountPerEvent)} = −${money(amount)}.`);
  }
  const deductionDollars = deductions.reduce((s, d) => s + d.amount, 0);

  // 5) Draw offset (advance recouped from commission).
  const drawRule = plan.rules.find((r): r is DrawRule => r.kind === "draw");
  const drawOffset = drawRule?.amount ?? drawRule?.monthly ?? 0;
  if (drawOffset) explanation.push(`Monthly draw of ${money(drawOffset)} is advanced and recouped.`);

  // 6) True-ups — informational; surfaced as a warning so they're never ignored.
  for (const r of plan.rules) {
    if (r.kind === "trueup") warnings.push(`True-up: ${r.note}`);
  }

  const netEstimatedPay = grossCommission - penaltyDollars - deductionDollars - drawOffset;

  // 7) Opportunities — what to do to earn more (grid: next X / Y tier).
  const opportunities: Opportunity[] = grid ? gridOpportunities(grid, perf, base, money) : [];

  // 8) Confidence — driven by missing inputs.
  const confidence: Confidence = warnings.some((w) => w.toLowerCase().includes("missing")) ? "low" : warnings.length ? "medium" : "high";

  return {
    planType,
    baseRatePct,
    effectiveRatePct,
    base,
    grossCommission,
    bonuses,
    penalties,
    deductions,
    drawOffset,
    netEstimatedPay,
    opportunities,
    explanation,
    confidence,
    warnings,
  };
}

// Next-tier opportunity gaps for a two-axis grid.
function gridOpportunities(grid: GridRule, perf: Performance, base: number, money: (n: number) => string): Opportunity[] {
  const out: Opportunity[] = [];
  const xv = perf[grid.x.metric] ?? 0;
  const yv = perf[grid.y.metric] ?? 0;
  const xi = tierIndex(xv, grid.x.tiers);
  const yi = tierIndex(yv, grid.y.tiers);
  const current = grid.cells[yi]?.[xi] ?? 0;

  if (xi + 1 < grid.x.tiers.length) {
    const nextX = grid.x.tiers[xi + 1];
    const added = (grid.cells[yi]?.[xi + 1] ?? current) - current;
    // TRUE gain, not just rate-delta-on-today's-base: when the axis metric IS
    // base-per-unit (pvr = netProfit/units), lifting it lifts the base too —
    // pay at the next tier = nextRate × implied base'. The old base×Δrate math
    // understated the move ~3x on Aaron's real grid.
    const nextRate = grid.cells[yi]?.[xi + 1] ?? current;
    const impliedBase = grid.x.metric === "pvr" && perf.units > 0 ? nextX * perf.units : base;
    out.push({
      label: `Lift ${grid.x.metric.toUpperCase()} to ${money(nextX)}`,
      detail: `+${added.toFixed(1)}% rate (${money(nextX - xv)} more ${grid.x.metric.toUpperCase()}/unit)`,
      addedRatePct: added,
      estAddedPay: Math.max(0, (nextRate / 100) * impliedBase - (current / 100) * base),
    });
  }
  if (yi + 1 < grid.y.tiers.length) {
    const nextY = grid.y.tiers[yi + 1];
    const added = (grid.cells[yi + 1]?.[xi] ?? current) - current;
    out.push({
      label: `Lift ${grid.y.metric.toUpperCase()} to ${nextY.toFixed(1)}`,
      detail: `+${added.toFixed(1)}% rate (${(nextY - yv).toFixed(2)} more ${grid.y.metric.toUpperCase()})`,
      addedRatePct: added,
      estAddedPay: base * (added / 100),
    });
  }
  // Best move first.
  out.sort((a, b) => (b.estAddedPay ?? 0) - (a.estAddedPay ?? 0));
  return out;
}

// ── Introspection ────────────────────────────────────────────────────────────
// Every performance-level metric a plan reads (grid axes, bases, tier/condition
// metrics, deduction counters). The Pay Plan Studio uses this to render exactly
// the test inputs a plan needs — for ANY plan, not a hardcoded automotive list.
// Per-deal metrics live on deal rows, not `perf`, so they're excluded here.
export function referencedMetrics(plan: CompPlan): string[] {
  const keys = new Set<string>();
  const addBase = (b?: Base) => { if (b) keys.add(b === "perUnit" ? "units" : b); };
  const addWhen = (when: Condition | Condition[]) => (Array.isArray(when) ? when : [when]).forEach((c) => keys.add(c.metric));
  for (const r of plan.rules) {
    switch (r.kind) {
      case "grid": addBase(r.base); keys.add(r.x.metric); keys.add(r.y.metric); break;
      case "flat": addBase(r.base); break;
      case "tier": keys.add(r.metric); addBase(r.base); break;
      case "bonus": addWhen(r.when); break;
      case "penalty": addWhen(r.when); if (r.consecutiveMetric) keys.add(r.consecutiveMetric); break;
      case "deduction": keys.add(r.perEventMetric); break;
      case "perDeal": break; // deal-row metrics, supplied as rows not perf
    }
  }
  return Array.from(keys);
}
