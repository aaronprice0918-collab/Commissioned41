import {
  Basis, BonusRule, CalcLine, CalcStep, Condition, DealSegment, GridRule, Metric, NextTier,
  PayPlan, PayResult, PenaltyRule, PerDealRule, PerfInput, PlanType, TierRule,
} from "./types";

// ---------- classification ----------
function hasPerDealRule(plan: PayPlan): boolean {
  const pd = plan.perDeal;
  if (!pd) return false;
  return !!(pd.minFlat || pd.default || (pd.segments && Object.keys(pd.segments).length));
}

export function classifyPlan(plan: PayPlan): PlanType {
  const hasGrid = !!plan.grid && plan.grid.rates.length > 0;
  const hasPerDeal = hasPerDealRule(plan);
  const hasTiers = plan.tiers.length > 0;
  const hasFlat = plan.base.frontPct > 0 || plan.base.backPct > 0 || plan.base.perUnit > 0 || plan.base.salary > 0;
  // Tiers alongside a per-deal base are the normal shape of a sales plan (per-
  // deal commission + a monthly volume ladder) — still a "perDeal" plan, not a
  // hybrid of two competing base structures.
  if (hasPerDeal) return hasGrid || hasFlat ? "hybrid" : "perDeal";
  const families = [hasGrid, hasTiers, hasFlat].filter(Boolean).length;
  if (families === 0) return "unknown";
  if (families > 1) return "hybrid";
  if (hasGrid) return "grid";
  if (hasTiers) return "tiered";
  return "flat";
}

// ---------- helpers ----------
function tierIndex(thresholds: number[], v: number): number {
  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) if (v >= thresholds[i]) idx = i;
  return idx;
}
function gridCell(g: GridRule, pvr: number, ppt: number): number {
  return g.rates[tierIndex(g.y, ppt)]?.[tierIndex(g.x, pvr)] ?? 0;
}
function basisGrossOf(basis: Basis, front: number, back: number): number {
  return basis === "front" ? front : basis === "back" ? back : front + back;
}

interface Derived { units: number; front: number; back: number; total: number; pvr: number; ppt: number; basis: Basis; basisGross: number }

function derive(plan: PayPlan, perf: PerfInput): Derived {
  const units = perf.units || 0;
  const front = perf.frontGross || 0;
  const back = perf.backGross || 0;
  const total = front + back;
  const basis: Basis = plan.grid?.basis ?? plan.base.basis ?? "total";
  const basisGross = basisGrossOf(basis, front, back);
  const pvr = units ? basisGross / units : 0;
  const ppt = units ? (perf.products || 0) / units : 0;
  return { units, front, back, total, pvr, ppt, basis, basisGross };
}

// metric value; undefined = not measured (caller flags as missing)
function metricValue(m: Metric, plan: PayPlan, perf: PerfInput, d: Derived): number | undefined {
  switch (m) {
    case "pvr": return d.pvr;
    case "ppt": return d.ppt;
    case "units": return d.units;
    case "frontGross": return d.front;
    case "backGross": return d.back;
    case "totalGross": return d.total;
    case "products": return perf.products || 0;
    case "vscPenetration": return perf.vscPenetration;
    case "menuUsage": return perf.menuUsage;
    case "csiBelowRegion": return perf.csiBelowRegion === undefined ? undefined : perf.csiBelowRegion ? 1 : 0;
    case "csiConsecutiveBelow": return perf.csiConsecutiveBelow;
    case "contractsNotCashed": return perf.contractsNotCashed;
    case "chargebacks": return perf.chargebacks;
    case "backPvr": return d.units ? d.back / d.units : 0;
    case "fastStartUnits": return perf.fastStartUnits;
  }
}
const OPTIONAL_METRICS: Metric[] = ["vscPenetration", "menuUsage", "csiBelowRegion", "csiConsecutiveBelow", "contractsNotCashed", "chargebacks"];

function cmp(op: Condition["op"], a: number, b: number): boolean {
  return op === "gt" ? a > b : op === "gte" ? a >= b : op === "lt" ? a < b : op === "lte" ? a <= b : a === b;
}
function condMet(cond: Condition | Condition[], plan: PayPlan, perf: PerfInput, d: Derived): { met: boolean; missing: boolean } {
  // An array of conditions means ALL must hold (AND) — how real plans gate
  // bonuses ("10+ units AND back PVR ≥ $1,300").
  let met = true, missing = false;
  for (const c of conds(cond)) {
    const v = metricValue(c.metric, plan, perf, d);
    if (v === undefined) { missing = true; met = false; continue; }
    if (!cmp(c.op, v, c.value)) met = false;
  }
  return { met, missing };
}
function conds(c: Condition | Condition[]): Condition[] {
  return Array.isArray(c) ? c : [c];
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function metricLabel(m: Metric): string {
  return ({ pvr: "PVR", ppt: "products per deal", vscPenetration: "VSC penetration", menuUsage: "menu usage",
    csiBelowRegion: "CSI vs region", csiConsecutiveBelow: "consecutive low-CSI months", contractsNotCashed: "uncashed contracts",
    chargebacks: "chargebacks", units: "units", frontGross: "front gross", backGross: "back gross", totalGross: "total gross", products: "products",
    backPvr: "back-end PVR", fastStartUnits: "units by the 15th" } as Record<Metric, string>)[m];
}

// ---------- per-deal commission ----------
function segmentFor(rule: PerDealRule, category?: string): DealSegment {
  if (category && rule.segments) {
    const key = Object.keys(rule.segments).find((k) => k.toLowerCase() === category.toLowerCase());
    if (key) return rule.segments[key];
  }
  return rule.default ?? {};
}

// One deal's commission under a per-deal rule. Bands: highest band whose min ≤
// the deal's front gross wins. `mini` reports that the per-deal minimum is
// what paid (so the UI can say "mini deal" instead of a bare number).
export function perDealPay(rule: PerDealRule, front: number, category?: string): { pay: number; mini: boolean } {
  const seg = segmentFor(rule, category);
  let pay: number | undefined;
  if (seg.bands?.length) {
    let best: { min: number; flat?: number; pct?: number } | undefined;
    for (const b of seg.bands) if (front >= b.min && (!best || b.min > best.min)) best = b;
    if (best) pay = best.flat ?? (typeof best.pct === "number" ? (front * best.pct) / 100 : undefined);
  } else if (typeof seg.pct === "number") {
    const pct = typeof seg.highMin === "number" && typeof seg.highPct === "number" && front >= seg.highMin ? seg.highPct : seg.pct;
    pay = (front * pct) / 100;
  }
  const floor = seg.minFlat ?? rule.minFlat;
  if (pay === undefined) return { pay: floor ?? 0, mini: floor !== undefined };
  if (floor !== undefined && pay < floor) return { pay: floor, mini: true };
  return { pay, mini: false };
}

// ---------- the calculator ----------
export function calculatePay(plan: PayPlan, perf: PerfInput): PayResult {
  const d = derive(plan, perf);
  const steps: CalcStep[] = [];
  const missing = new Set<string>();

  // 1) base commission + effective rate
  let grossCommission = 0;
  let baseRate = 0;
  let bonusRate = 0;
  const bonuses: CalcLine[] = [];

  // rate-add bonuses first (they lift the grid/commission rate)
  for (const b of plan.bonuses) {
    if (b.effect.kind !== "addRatePct") continue;
    const { met, missing: miss } = condMet(b.condition, plan, perf, d);
    if (miss) for (const c of conds(b.condition)) missing.add(metricLabel(c.metric));
    if (met) bonusRate += b.effect.amount;
  }

  if (plan.grid && plan.grid.rates.length) {
    baseRate = gridCell(plan.grid, d.pvr, d.ppt);
    const effRate = baseRate + bonusRate;
    grossCommission = (d.basisGross * effRate) / 100;
    steps.push({ label: "Commission rate", detail: `${plan.grid.yAxis.toUpperCase()} ${round2(d.ppt)} × ${plan.grid.xAxis.toUpperCase()} ${money(d.pvr)} → ${baseRate}%${bonusRate ? ` + ${bonusRate}% bonus = ${round2(effRate)}%` : ""}` });
    steps.push({ label: "Gross commission", detail: `${round2(effRate)}% of ${money(d.basisGross)} ${d.basis}-end gross = ${money(grossCommission)}` });
  } else {
    const fc = (d.front * plan.base.frontPct) / 100;
    const bc = (d.back * plan.base.backPct) / 100;
    const pu = d.units * plan.base.perUnit;
    const pp = (perf.products || 0) * plan.base.perProduct;
    const extraRate = bonusRate ? (d.basisGross * bonusRate) / 100 : 0;
    grossCommission = plan.base.salary + fc + bc + pu + pp + extraRate;
    if (plan.base.salary) steps.push({ label: "Base salary", detail: money(plan.base.salary) });
    if (fc) steps.push({ label: "Front commission", detail: `${plan.base.frontPct}% of ${money(d.front)} = ${money(fc)}` });
    if (bc) steps.push({ label: "Back commission", detail: `${plan.base.backPct}% of ${money(d.back)} = ${money(bc)}` });
    if (pu) steps.push({ label: "Per-unit", detail: `${d.units} × ${money(plan.base.perUnit)} = ${money(pu)}` });
    if (pp) steps.push({ label: "Product bonus", detail: `${perf.products} × ${money(plan.base.perProduct)} = ${money(pp)}` });
    if (extraRate) steps.push({ label: "Rate bonus", detail: `+${bonusRate}% of ${money(d.basisGross)} = ${money(extraRate)}` });
    // Effective rate = ALL base pay (salary, per-unit, per-product dollars
    // too, not just the %-of-gross pieces) expressed as a % of gross — a
    // pure per-unit/salary plan otherwise silently showed "0% rate" here
    // (audit finding, July 5: it only counted frontPct/backPct commission,
    // ignoring the rest of the plan's dollar components). bonusRate is
    // excluded from this — it's added back separately below so it isn't
    // double-counted.
    const nonBonusEarnings = plan.base.salary + fc + bc + pu + pp;
    baseRate = d.basisGross ? (nonBonusEarnings / d.basisGross) * 100 : 0;
  }

  // Per-deal commission (how most sales plans pay): every deal is paid on ITS
  // OWN front gross — banded flats or a % — floored at the plan's mini. A
  // loser deal pays the mini; it never claws money back from the month.
  if (hasPerDealRule(plan)) {
    const rule = plan.perDeal!;
    let rows = perf.dealRows;
    if (!rows && d.units > 0) {
      // No per-deal detail (manual what-if input) — approximate every deal at
      // the month's average front. Band precision is lost; flag it.
      rows = Array.from({ length: Math.max(1, Math.round(d.units)) }, () => ({ front: d.front / d.units }));
      missing.add("per-deal gross detail (estimated from the monthly average)");
    }
    if (rows?.length) {
      let pd = 0;
      let minis = 0;
      for (const r of rows) {
        const one = perDealPay(rule, r.front, r.category);
        pd += one.pay * (r.weight ?? 1);
        if (one.mini) minis++;
      }
      pd = round2(pd);
      grossCommission += pd;
      steps.push({ label: "Per-deal commission", detail: `${rows.length} deal${rows.length === 1 ? "" : "s"} paid on their own gross${minis ? ` (${minis} at the mini)` : ""} = ${money(pd)}` });
      // Fold per-deal dollars into the effective rate the way the other flat-$
      // components are (skip when a grid rate owns the headline number).
      if (!plan.grid && d.basisGross) baseRate += (pd / d.basisGross) * 100;
    }
  }
  const effectiveRate = baseRate + bonusRate;

  // 2) $ bonuses (flat / pct-of-basis)
  for (const b of plan.bonuses) {
    if (b.effect.kind === "addRatePct") continue;
    const { met, missing: miss } = condMet(b.condition, plan, perf, d);
    if (miss) for (const c of conds(b.condition)) missing.add(metricLabel(c.metric));
    if (!met) continue;
    const amt = b.effect.kind === "flat" ? b.effect.amount : (basisGrossOf(b.effect.basis, d.front, d.back) * b.effect.amount) / 100;
    bonuses.push({ label: b.label, amount: round2(amt) });
    steps.push({ label: b.label, detail: `+${money(amt)}` });
  }

  // 3) tier bonuses — best qualifying tier per metric group
  const tierBonuses: CalcLine[] = [];
  const byMetric = new Map<string, TierRule[]>();
  for (const t of plan.tiers) { const a = byMetric.get(t.metric) || []; a.push(t); byMetric.set(t.metric, a); }
  for (const [, group] of byMetric) {
    let best: TierRule | null = null;
    for (const t of group) {
      const val = tierMetric(t.metric, d);
      if (val >= t.threshold && (!best || t.threshold > best.threshold)) best = t;
    }
    if (best) {
      const amt = best.kind === "flat" ? best.amount : (basisGrossOf(best.basis ?? d.basis, d.front, d.back) * best.amount) / 100;
      tierBonuses.push({ label: best.label, amount: round2(amt) });
      steps.push({ label: best.label, detail: `+${money(amt)}` });
    }
  }

  const grossBeforePenalty = grossCommission + sum(bonuses) + sum(tierBonuses);

  // 4) penalties (% reductions of gross pay)
  const penalties: CalcLine[] = [];
  for (const p of plan.penalties) {
    const { met, missing: miss } = condMet(p.condition, plan, perf, d);
    if (miss) { missing.add(metricLabel(p.condition.metric)); continue; }
    if (!met) continue;
    let pct = p.reduceGrossPct;
    if (p.consecutiveMetric && p.consecutiveAdditionalPct) {
      const c = metricValue(p.consecutiveMetric, plan, perf, d) ?? 0;
      if (c > 1) pct += p.consecutiveAdditionalPct * (c - 1);
    }
    const amt = -(grossBeforePenalty * pct) / 100;
    penalties.push({ label: p.label, amount: round2(amt) });
    steps.push({ label: p.label, detail: `−${pct}% of gross pay = ${money(amt)}` });
  }

  // 5) deductions ($)
  const deductions: CalcLine[] = [];
  for (const dd of plan.deductions) {
    let amt = 0;
    if (dd.kind === "flat") amt = -dd.amount;
    else if (dd.kind === "pctOfGrossPay") amt = -(grossBeforePenalty * dd.amount) / 100;
    else {
      const count = dd.metric ? metricValue(dd.metric, plan, perf, d) : undefined;
      if (count === undefined) { if (dd.metric) missing.add(metricLabel(dd.metric)); continue; }
      amt = -dd.amount * count;
    }
    if (amt !== 0) { deductions.push({ label: dd.label, amount: round2(amt) }); steps.push({ label: dd.label, detail: money(amt) }); }
  }

  let grossPay = Math.max(0, grossBeforePenalty + sum(penalties) + sum(deductions));
  if (plan.guaranteeFloor && grossPay < plan.guaranteeFloor) {
    steps.push({ label: "Guarantee floor", detail: `Earned ${money(grossPay)} → raised to guarantee ${money(plan.guaranteeFloor)}` });
    grossPay = plan.guaranteeFloor;
  }
  steps.push({ label: "Earned this month", detail: money(grossPay) });

  // 6) draw — a recoverable draw is an ADVANCE against earnings that rolls over:
  // earnings pay down (prior balance carried in + this month's advance), and any
  // shortfall becomes next month's carried balance. "The hole" is what's still owed.
  const draw = plan.draw?.amount ?? 0;
  const carriedIn = plan.drawCarriedIn ?? 0;
  const drawOffset = Math.min(draw, grossPay);
  const remainderAfterDraw = round2(grossPay - drawOffset);
  const drawShortfall = round2(Math.max(0, draw - grossPay)); // this month's unrecouped advance
  const drawOwed = round2(Math.max(0, carriedIn + draw - grossPay)); // total still owed = the hole
  const aboveDraw = round2(Math.max(0, grossPay - draw - carriedIn)); // real earnings beyond every advance
  if (draw) steps.push({ label: "Draw already paid", detail: `${money(draw)} advance → remaining check ≈ ${money(remainderAfterDraw)}` });

  const netAfterTax = plan.taxRate ? grossPay * (1 - plan.taxRate / 100) : grossPay;

  // 7) next-tier opportunities
  const nextTiers = computeNextTiers(plan, perf, d, effectiveRate, bonusRate);

  // 8) missing data + confidence
  const missingData = Array.from(missing);
  let confidence = plan.confidence || 0.5;
  if (d.units === 0) confidence = Math.min(confidence, 0.4);
  confidence = Math.max(0.1, confidence - 0.06 * missingData.length);

  return {
    planType: plan.type,
    rate: round2(effectiveRate),
    rateBreakdown: plan.grid ? { base: baseRate, bonusRate, pvr: round2(d.pvr), ppt: round2(d.ppt) } : undefined,
    grossCommission: round2(grossCommission),
    bonuses, tierBonuses, penalties, deductions,
    grossPay: round2(grossPay),
    draw, drawOffset: round2(drawOffset), remainderAfterDraw, drawShortfall, drawOwed, aboveDraw,
    net: round2(grossPay), netAfterTax: round2(netAfterTax),
    steps, nextTiers, missingData, confidence: round2(confidence),
  };
}

function tierMetric(m: TierRule["metric"], d: Derived): number {
  return m === "units" ? d.units : m === "totalGross" ? d.total : m === "backGross" ? d.back : d.front;
}

function computeNextTiers(plan: PayPlan, perf: PerfInput, d: Derived, effRate: number, bonusRate: number): NextTier[] {
  const out: NextTier[] = [];
  if (plan.grid && plan.grid.rates.length && d.units > 0) {
    const g = plan.grid;
    const row = tierIndex(g.y, d.ppt), col = tierIndex(g.x, d.pvr);
    if (row + 1 < g.y.length) {
      const newRate = (g.rates[row + 1]?.[col] ?? g.rates[row][col]) + bonusRate;
      out.push({ axis: "ppt", label: "Products per deal", from: round2(d.ppt), to: g.y[row + 1],
        addRatePct: round2(newRate - effRate), addPay: round2((d.basisGross * (newRate - effRate)) / 100),
        hint: `Sell ${g.y[row + 1]} products a deal on average` });
    }
    if (col + 1 < g.x.length) {
      const newRate = (g.rates[row]?.[col + 1] ?? g.rates[row][col]) + bonusRate;
      out.push({ axis: "pvr", label: "PVR", from: Math.round(d.pvr), to: g.x[col + 1],
        addRatePct: round2(newRate - effRate), addPay: round2((d.basisGross * (newRate - effRate)) / 100),
        hint: `Get your average gross per deal up to ${money(g.x[col + 1])}` });
    }
  }
  // rate-add bonuses not yet earned (e.g. PVR>$1900, VSC>50%)
  for (const b of plan.bonuses) {
    if (b.effect.kind !== "addRatePct") continue;
    const { met } = condMet(b.condition, plan, perf, d);
    if (met) continue;
    // For AND-bonuses, coach toward the first unmet condition.
    const target = conds(b.condition).find((c) => { const v = metricValue(c.metric, plan, perf, d); return v === undefined || !cmp(c.op, v, c.value); }) ?? conds(b.condition)[0];
    const addPay = (d.basisGross * b.effect.amount) / 100;
    out.push({ axis: target.metric === "pvr" ? "pvr" : "penetration", label: b.label, from: 0, to: target.value,
      addRatePct: b.effect.amount, addPay: round2(addPay),
      hint: `${b.label} — get your ${metricLabel(target.metric)} ${target.op === "gt" ? "over" : "to"} ${target.metric === "pvr" ? money(target.value) : target.value + "%"}` });
  }
  // tier bonuses not yet earned
  const byMetric = new Map<string, TierRule[]>();
  for (const t of plan.tiers) { const a = byMetric.get(t.metric) || []; a.push(t); byMetric.set(t.metric, a); }
  for (const [, group] of byMetric) {
    const sorted = [...group].sort((a, b) => a.threshold - b.threshold);
    const val = tierMetric(sorted[0].metric, d);
    const next = sorted.find((t) => val < t.threshold);
    if (next) {
      const amt = next.kind === "flat" ? next.amount : (basisGrossOf(next.basis ?? d.basis, d.front, d.back) * next.amount) / 100;
      out.push({ axis: next.metric === "units" ? "units" : "gross", label: next.label, from: Math.round(val), to: next.threshold,
        addPay: round2(amt), hint: `Reach ${next.metric === "units" ? `${next.threshold} units` : `${money(next.threshold)} in gross`}` });
    }
  }
  return out.sort((a, b) => b.addPay - a.addPay).slice(0, 4);
}

function sum(lines: CalcLine[]): number { return lines.reduce((a, l) => a + l.amount, 0); }
export function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return neg ? `−${s}` : s;
}
