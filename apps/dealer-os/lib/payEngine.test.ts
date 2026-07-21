import test from "node:test";
import assert from "node:assert/strict";
import { computePay, classifyPlan, referencedMetrics, type CompPlan } from "./payEngine.ts";
import { FINANCE_COMP_PLAN } from "./financePayPlan.ts";
import { KENNESAW_SALES_COMP_PLAN } from "./salesCompPlan.ts";

// ── 1. Flat % plan (backward compatibility — acceptance #9) ───────────────────
test("flat plan: percent of a base", () => {
  const plan: CompPlan = { id: "flat", name: "Flat", rules: [{ kind: "flat", base: "backGross", pct: 12 }] };
  assert.equal(classifyPlan(plan), "flat");
  const r = computePay(plan, { backGross: 50000 });
  assert.equal(r.baseRatePct, 12);
  assert.equal(r.grossCommission, 6000);
  assert.equal(r.netEstimatedPay, 6000);
  assert.equal(r.confidence, "high");
});

// ── 2. Tiered plan ────────────────────────────────────────────────────────────
test("tiered plan: highest qualifying tier (non-stacked)", () => {
  const plan: CompPlan = {
    id: "tier",
    name: "Volume",
    rules: [{ kind: "tier", metric: "units", tiers: [{ min: 12, flat: 500 }, { min: 18, flat: 1300 }, { min: 24, flat: 1800 }] }],
  };
  assert.equal(classifyPlan(plan), "tiered");
  assert.equal(computePay(plan, { units: 25 }).grossCommission, 1800);
  assert.equal(computePay(plan, { units: 19 }).grossCommission, 1300);
  assert.equal(computePay(plan, { units: 14 }).grossCommission, 500);
  assert.equal(computePay(plan, { units: 5 }).grossCommission, 0);
});

// ── 3. Grid plan — Aaron's real F&I grid (acceptance #1–4) ────────────────────
test("grid plan: PVR×PPU lookup + bonus", () => {
  assert.equal(classifyPlan(FINANCE_COMP_PLAN), "grid");
  const r = computePay(FINANCE_COMP_PLAN, { pvr: 1400, ppu: 2.0, vscPenetration: 60, netProfit: 70000, units: 50, menuUsage: 100, csiBelow: 0, csiMonthsBelow: 1, uncashedContracts: 0 });
  assert.equal(r.baseRatePct, 13.0); // grid[2.0][$1400]
  assert.equal(r.effectiveRatePct, 13.5); // +0.5 VSC>50
  assert.equal(r.grossCommission, 9450); // 13.5% × 70k
  assert.equal(r.drawOffset, 8000);
  assert.equal(r.netEstimatedPay, 1450); // 9450 − 8000
  assert.equal(r.confidence, "high");
});

test("grid plan: PVR exactly $1,900 does NOT trigger the >$1,900 bonus", () => {
  const r = computePay(FINANCE_COMP_PLAN, { pvr: 1900, ppu: 2.2, vscPenetration: 20, netProfit: 76000, units: 40, menuUsage: 100, csiBelow: 0, csiMonthsBelow: 1, uncashedContracts: 0 });
  assert.equal(r.baseRatePct, 15.0); // grid clamps PVR to $1700 col, PPU 2.2 row
  assert.equal(r.effectiveRatePct, 15.0); // no bonus
});

// ── 4. Penalties + deductions (acceptance #5) ─────────────────────────────────
test("grid plan: menu + CSI penalties and uncashed-contract deductions", () => {
  const r = computePay(FINANCE_COMP_PLAN, { pvr: 1400, ppu: 2.0, vscPenetration: 20, netProfit: 70000, units: 50, menuUsage: 90, csiBelow: 1, csiMonthsBelow: 2, uncashedContracts: 3 });
  assert.equal(r.grossCommission, 9100); // 13% × 70k, no bonus
  const menu = r.penalties.find((p) => p.label.includes("Menu"));
  const csi = r.penalties.find((p) => p.label.includes("CSI"));
  assert.equal(menu?.pct, 5);
  assert.equal(csi?.pct, 8); // 5 + 3×(2−1)
  assert.equal(menu?.amount, 455); // 5% of 9100
  assert.equal(csi?.amount, 728); // 8% of 9100
  assert.equal(r.deductions[0].amount, 600); // 3 × $200
  assert.equal(r.netEstimatedPay, 9100 - 455 - 728 - 600 - 8000);
});

// ── 5. Opportunities / next-tier gaps (acceptance #7) ─────────────────────────
test("grid plan: next-tier opportunities with added rate + TRUE est pay", () => {
  const r = computePay(FINANCE_COMP_PLAN, { pvr: 1400, ppu: 2.0, vscPenetration: 20, netProfit: 70000, units: 50, menuUsage: 100, csiBelow: 0, csiMonthsBelow: 1, uncashedContracts: 0 });
  assert.equal(r.opportunities.length, 2);
  const pvrOpp = r.opportunities.find((o) => o.label.includes("PVR"))!;
  const ppuOpp = r.opportunities.find((o) => !o.label.includes("PVR"))!;
  assert.equal(pvrOpp.addedRatePct, 0.5);
  // Lifting PVR to $1,500 lifts the BASE too: 13.5% × (1,500×50) − 13% × 70,000
  // = 10,125 − 9,100 = $1,025. (The old base×Δrate math said $350 — a 3x
  // understatement of what the move is worth.)
  assert.equal(pvrOpp.estAddedPay, 1025);
  // PPU doesn't drive the base — plain Δrate × base holds there.
  assert.equal(ppuOpp.addedRatePct, 0.5);
  assert.equal(ppuOpp.estAddedPay, 350);
});

// ── 6. Hybrid plan (grid base + tier flat bonus) ──────────────────────────────
test("hybrid plan: grid base + volume tier", () => {
  const plan: CompPlan = {
    id: "hybrid",
    name: "Hybrid",
    rules: [
      { kind: "grid", base: "netProfit", x: { metric: "pvr", tiers: [1000, 2000] }, y: { metric: "ppu", tiers: [1, 2] }, cells: [[10, 11], [12, 13]] },
      { kind: "tier", metric: "units", tiers: [{ min: 10, flat: 500 }] },
    ],
  };
  assert.equal(classifyPlan(plan), "hybrid");
  const r = computePay(plan, { pvr: 2000, ppu: 2, netProfit: 50000, units: 12 });
  assert.equal(r.baseRatePct, 13); // grid[2][2000]
  assert.equal(r.grossCommission, 50000 * 0.13 + 500); // 7000
});

// ── 7. Never silently empty (acceptance #8) ───────────────────────────────────
test("unsupported plan: flagged, never silently empty", () => {
  const plan: CompPlan = { id: "x", name: "No base", rules: [{ kind: "draw", id: "d", monthly: 8000 }] };
  const r = computePay(plan, { backGross: 1000 });
  assert.equal(r.planType, "unsupported");
  assert.ok(r.warnings.length > 0, "must explain why there's no commission");
  assert.equal(r.grossCommission, 0);
});

test("missing grid input lowers confidence and warns, not crashes", () => {
  const r = computePay(FINANCE_COMP_PLAN, { netProfit: 50000 }); // no pvr/ppu
  assert.equal(r.confidence, "low");
  assert.ok(r.warnings.some((w) => w.toLowerCase().includes("missing")));
});

// ── 8. Per-deal commission (sales-style plan) ─────────────────────────────────
test("per-deal: New CGP bands, Used %, and mini floor", () => {
  const one = (cgp: number, vehicleClass: string) =>
    computePay(KENNESAW_SALES_COMP_PLAN, { units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp, vehicleClass, share: 1 }]).grossCommission;
  assert.equal(one(500, "New"), 400); // CGP ≥ $1
  assert.equal(one(-100, "New"), 250); // −$300..$0
  assert.equal(one(-400, "New"), 150); // below −$300 → mini floor
  assert.equal(one(2000, "Used"), 500); // 25% of $2,000
  assert.equal(one(4000, "Used"), 1200); // 30% at ≥ $3,000
  assert.equal(one(200, "Used"), 150); // 25% = $50 → $150 mini
  assert.equal(one(5000, "Wholesale"), 150); // default → $150 mini
});

test("per-deal full month: commission + volume tier + AND-bonuses", () => {
  const rows = Array.from({ length: 12 }, () => ({ cgp: 500, vehicleClass: "New", share: 1 }));
  const r = computePay(KENNESAW_SALES_COMP_PLAN, { units: 12, pvr: 1400, fastStartUnits: 12 }, rows);
  // 12×$400 per-deal + $500 volume(12) + $500 finance(≥10u & PVR≥1300) + $500 fast-start.
  assert.equal(r.grossCommission, 4800 + 500 + 500 + 500);
  assert.equal(classifyPlan(KENNESAW_SALES_COMP_PLAN), "hybrid"); // perDeal + tier
});

test("per-deal split shares are honored", () => {
  const r = computePay(KENNESAW_SALES_COMP_PLAN, { units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp: 500, vehicleClass: "New", share: 0.5 }]);
  assert.equal(r.grossCommission, 200); // $400 × 0.5
});

test("AND-condition bonus needs BOTH conditions", () => {
  const rows = [{ cgp: 500, vehicleClass: "New", share: 1 }];
  const r = computePay(KENNESAW_SALES_COMP_PLAN, { units: 12, pvr: 1200, fastStartUnits: 0 }, rows);
  assert.equal(r.grossCommission, 400 + 500); // per-deal + volume; finance NOT paid (PVR < 1300)
});

// ── 9. Draw: legacy `monthly` and new per-cycle `amount` ──────────────────────
test("draw: `amount` takes precedence over legacy `monthly`", () => {
  const plan: CompPlan = { id: "d", name: "Draw", rules: [{ kind: "flat", base: "backGross", pct: 10 }, { kind: "draw", id: "dr", amount: 1500, per: "cycle" }] };
  const r = computePay(plan, { backGross: 50000 });
  assert.equal(r.drawOffset, 1500);
  assert.equal(r.netEstimatedPay, 5000 - 1500);
});
test("draw: legacy `monthly` still honored when no `amount`", () => {
  const plan: CompPlan = { id: "d", name: "Draw", rules: [{ kind: "flat", base: "backGross", pct: 10 }, { kind: "draw", id: "dr", monthly: 8000 }] };
  assert.equal(computePay(plan, { backGross: 100000 }).drawOffset, 8000);
});

// ── 10. Vocabulary: a non-automotive plan formats in its own currency ─────────
test("vocab: explanation uses the plan's currency", () => {
  const plan: CompPlan = {
    id: "eu", name: "EU flat", vocab: { currency: "EUR", locale: "de-DE" },
    rules: [{ kind: "flat", base: "totalGross", pct: 20 }],
  };
  const r = computePay(plan, { totalGross: 10000 });
  assert.equal(r.grossCommission, 2000);
  assert.ok(r.explanation.some((line) => /€/.test(line)), "explanation should be in euros");
});

// ── 11. referencedMetrics: the exact perf inputs a plan reads ─────────────────
test("referencedMetrics: collects grid axes, bases, condition + counter metrics", () => {
  const m = referencedMetrics(FINANCE_COMP_PLAN);
  for (const key of ["pvr", "ppu", "netProfit", "vscPenetration", "menuUsage", "csiBelow", "csiMonthsBelow", "uncashedContracts"]) {
    assert.ok(m.includes(key), `expected ${key} in referenced metrics`);
  }
});
