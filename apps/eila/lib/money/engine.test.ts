import { describe, expect, it } from "vitest";
import {
  addSpend,
  dailyBudget,
  removeSpend,
  applyStatementScan,
  budgetMonth,
  cashFlowSummary,
  billsRemaining,
  billsRemainingTotal,
  cashFlow,
  evaluatePurchase,
  cashFlowLow,
  goalProgress,
  incomeExpectation,
  monthlyAmount,
  monthBills,
  monthChecks,
  safeToSpend,
  seedBudgetsFromProfile,
  totalMonthlyBills,
  upsertBudget,
} from "./engine";
import type { Bill, MoneyConfig } from "./types";

const bill = (over: Partial<Bill>): Bill => ({
  id: "b1", name: "Rent", amount: 1800, cadence: "monthly", dayOfMonth: 1, ...over,
});

// Fixed "today": July 10, 2026 (a Friday), mid-month.
const NOW = new Date(2026, 6, 10);

const cfg = (over: Partial<MoneyConfig> = {}): MoneyConfig => ({
  checkingBalance: 5000,
  cushion: 500, // pre-July-6 default, pinned so long-standing expectations hold
  payday: 15,
  monthlyEssentials: 930, // 31-day July → $30/day burn
  bills: [
    bill({ id: "rent", name: "Rent", amount: 1800, dayOfMonth: 1 }),
    bill({ id: "truck", name: "Truck", amount: 650, dayOfMonth: 20 }),
    bill({ id: "stream", name: "Streaming", amount: 30, dayOfMonth: 25, isSubscription: true }),
  ],
  goals: [{ id: "g1", name: "Emergency fund", target: 10000, saved: 4000 }],
  ...over,
});

describe("monthlyAmount", () => {
  it("normalizes cadences to monthly", () => {
    expect(monthlyAmount(bill({ cadence: "monthly", amount: 120 }))).toBe(120);
    expect(monthlyAmount(bill({ cadence: "yearly", amount: 1200 }))).toBe(100);
    expect(monthlyAmount(bill({ cadence: "quarterly", amount: 300 }))).toBe(100);
    expect(monthlyAmount(bill({ cadence: "weekly", amount: 12 }))).toBe(52);
    expect(monthlyAmount(bill({ cadence: "biweekly", amount: 6 }))).toBe(13);
  });
});

describe("billsRemaining", () => {
  it("only includes bills on/after today, sorted by date", () => {
    const r = billsRemaining(cfg(), NOW);
    // Rent (day 1) already passed; Truck (20) and Streaming (25) remain.
    expect(r.map((u) => u.bill.id)).toEqual(["truck", "stream"]);
    expect(r[0].daysAway).toBe(10);
    expect(billsRemainingTotal(cfg(), NOW)).toBe(680);
  });

  it("expands weekly bills into remaining instances", () => {
    const c = cfg({ bills: [bill({ id: "w", cadence: "weekly", amount: 100, dayOfMonth: 3 })] });
    const r = billsRemaining(c, NOW);
    // weekly from the 3rd: 3,10,17,24,31 → from the 10th: 10,17,24,31
    expect(r.length).toBe(4);
  });
});

describe("incomeExpectation", () => {
  it("targets this month's payday when it hasn't passed", () => {
    const inc = incomeExpectation(8000, 15, NOW);
    expect(inc.nextCheckDate).toBe("2026-07-15");
    expect(inc.nextCheckAmount).toBe(8000);
    expect(inc.remainingThisMonth).toBe(8000);
  });

  it("rolls to next month when payday has passed", () => {
    const late = new Date(2026, 6, 20);
    const inc = incomeExpectation(8000, 15, late);
    expect(inc.nextCheckDate).toBe("2026-08-15");
    expect(inc.remainingThisMonth).toBe(0);
  });

  it("applies the plan tax rate when set", () => {
    const inc = incomeExpectation(10000, 15, NOW, 30);
    expect(inc.nextCheckAmount).toBe(7000);
  });
});

describe("safeToSpend", () => {
  it("is null without a balance", () => {
    expect(safeToSpend(cfg({ checkingBalance: undefined }), incomeExpectation(8000, 15, NOW), NOW)).toBeNull();
  });

  it("subtracts upcoming bills, prorated essentials, and the cushion", () => {
    const sts = safeToSpend(cfg(), incomeExpectation(8000, 15, NOW), NOW)!;
    // 5000 - 680 bills - 660 essentials (22/31 days × 930) - 500 cushion = 3160
    expect(sts.available).toBe(3160);
    expect(sts.daysToIncome).toBe(5);
    expect(sts.perDay).toBe(Math.round(3160 / 5));
    // month-end: 5000 - 680 - 660 + 8000 = 11660
    expect(sts.projectedMonthEnd).toBe(11660);
  });

  it("never goes negative on available", () => {
    const sts = safeToSpend(cfg({ checkingBalance: 100 }), incomeExpectation(0, 15, NOW), NOW)!;
    expect(sts.available).toBe(0);
  });
});

describe("cashFlow", () => {
  it("returns empty without a balance", () => {
    expect(cashFlow(cfg({ checkingBalance: undefined }), incomeExpectation(8000, 15, NOW), NOW)).toEqual([]);
  });

  it("drops on bill days and jumps on payday", () => {
    const flow = cashFlow(cfg(), incomeExpectation(8000, 15, NOW), NOW);
    expect(flow.length).toBe(30);
    const payday = flow.find((p) => p.date === "2026-07-15")!;
    expect(payday.events.some((e) => e.includes("Commission"))).toBe(true);
    const truckDay = flow.find((p) => p.date === "2026-07-20")!;
    expect(truckDay.events.some((e) => e.includes("Truck"))).toBe(true);
    // balance right before payday should be lower than right after
    const before = flow.find((p) => p.date === "2026-07-14")!;
    expect(payday.balance).toBeGreaterThan(before.balance);
  });

  it("finds the low point", () => {
    const flow = cashFlow(cfg({ checkingBalance: 900 }), incomeExpectation(8000, 15, NOW), NOW);
    const low = cashFlowLow(flow)!;
    expect(low.balance).toBeLessThanOrEqual(flow[0].balance);
  });
});

describe("goalProgress", () => {
  it("computes and clamps", () => {
    expect(goalProgress({ id: "g", name: "x", target: 10000, saved: 4000 })).toBe(40);
    expect(goalProgress({ id: "g", name: "x", target: 100, saved: 250 })).toBe(100);
    expect(goalProgress({ id: "g", name: "x", target: 0, saved: 50 })).toBe(0);
  });
});

describe("applyStatementScan", () => {
  const scan = {
    bills: [
      { name: "Netflix", amount: 15, dayOfMonth: 25, isSubscription: true },
      { name: "RENT", amount: 1800, dayOfMonth: 1 },
      { name: "Gym", amount: 40, dayOfMonth: 5 },
    ],
    monthlySpend: 1400,
    endingBalance: 6100,
    monthsAnalyzed: 3,
    categories: [{ name: "Food & dining", monthly: 700 }],
  };
  let n = 0;
  const mkId = () => `id-${n++}`;

  it("adds only kept bills, deduping against existing by normalized name", () => {
    const base = cfg(); // already has a "Rent" bill typed by hand
    const kept = scan.bills.filter((b) => b.name !== "Gym");
    const out = applyStatementScan(base, scan, kept, "2026-07-10", mkId);
    const names = out.bills.map((b) => b.name);
    expect(names).toContain("Netflix");
    expect(names).not.toContain("Gym"); // user tapped it off
    expect(names.filter((x) => x.toLowerCase() === "rent").length).toBe(1); // no dupe
    const netflix = out.bills.find((b) => b.name === "Netflix")!;
    expect(netflix.autoDetected).toBe(true);
    expect(netflix.cadence).toBe("monthly");
  });

  it("fills blank balance/essentials but never overwrites user-entered values", () => {
    const withValues = applyStatementScan(cfg(), scan, [], "2026-07-10", mkId);
    expect(withValues.checkingBalance).toBe(5000); // user's value survives
    expect(withValues.monthlyEssentials).toBe(930);
    const blank = applyStatementScan(cfg({ checkingBalance: undefined, monthlyEssentials: 0 }), scan, [], "2026-07-10", mkId);
    expect(blank.checkingBalance).toBe(6100); // statement fills the blank
    expect(blank.monthlyEssentials).toBe(1400);
    expect(blank.balanceAsOf).toBe("2026-07-10"); // no statement date known → fall back to today
  });

  it("dates a scanned balance as of the STATEMENT close, not today, when known", () => {
    // The statement closed June 30 but is being scanned on July 10 — the balance
    // must be stamped as of the close so staleness/safe-to-spend stay honest.
    const dated = applyStatementScan(
      cfg({ checkingBalance: undefined }),
      { ...scan, statementEndDate: "2026-06-30" },
      [], "2026-07-10", mkId,
    );
    expect(dated.checkingBalance).toBe(6100);
    expect(dated.balanceAsOf).toBe("2026-06-30");
  });

  it("records the spending profile", () => {
    const out = applyStatementScan(cfg(), scan, [], "2026-07-10", mkId);
    expect(out.spendingProfile?.avgMonthlySpend).toBe(1400);
    expect(out.spendingProfile?.monthsAnalyzed).toBe(3);
    expect(out.spendingProfile?.categories[0].name).toBe("Food & dining");
  });
});

describe("multi-payday (the July 5 in-app EILA report: semi-monthly + wash check)", () => {
  // Rep paid on the 10th (wash), 15th, and 30th. Month expects $9,675 net.
  const paydays = [10, 15, 30];

  it("splits the month's income across all checks and targets the soonest", () => {
    const inc = incomeExpectation(9675, paydays, NOW); // today = July 10
    expect(inc.nextCheckAmount).toBe(3225); // one check's share
    expect(inc.nextCheckDate).toBe("2026-07-10"); // the wash check TODAY
    expect(inc.remainingThisMonth).toBe(9675); // all three still land
  });

  it("counts only remaining checks late in the month", () => {
    const late = new Date(2026, 6, 20);
    const inc = incomeExpectation(9675, paydays, late);
    expect(inc.nextCheckDate).toBe("2026-07-30");
    expect(inc.remainingThisMonth).toBe(3225); // only the 30th left
  });

  it("drops every check on its own day in the cash curve — no false drowning", () => {
    const c = cfg({ paydays, payday: undefined, checkingBalance: 1000 });
    const flow = cashFlow(c, incomeExpectation(9675, paydays, NOW), NOW);
    const checkDays = flow.filter((p) => p.events.some((e) => e.includes("Commission")));
    expect(checkDays.map((p) => p.date)).toEqual(
      expect.arrayContaining(["2026-07-10", "2026-07-15", "2026-07-30"]),
    );
    // With $9,675 landing across the month, a $1,000 start must not end underwater.
    expect(flow[flow.length - 1].balance).toBeGreaterThan(0);
  });

  it("uses the rep's OWN check amount over the forecast when set", () => {
    // Forecast says a weak $912/mo — but the rep KNOWS checks are $3,225 net.
    const inc = incomeExpectation(912, paydays, NOW, undefined, [3225]);
    expect(inc.nextCheckAmount).toBe(3225);
    expect(inc.remainingThisMonth).toBe(3225 * 3);
  });

  it("keeps each check's amount glued to ITS payday (the July 6 owner report)", () => {
    // Paid on the 1st ($3,000), 10th ($800 wash), 15th ($3,000). Today July 6:
    // the 1st already landed; the wash and the 15th are still coming.
    const inc = incomeExpectation(0, [1, 10, 15], new Date(2026, 6, 6), undefined, [3000, 800, 3000]);
    expect(inc.nextCheckDate).toBe("2026-07-10");
    expect(inc.nextCheckAmount).toBe(800); // the wash check, not an average
    expect(inc.remainingThisMonth).toBe(3800);
  });

  it("mismatched nets count falls back to the average — never dropped", () => {
    const inc = incomeExpectation(0, [10, 15, 30], NOW, undefined, [3000, 900]);
    expect(inc.nextCheckAmount).toBe(1950);
    expect(inc.remainingThisMonth).toBe(1950 * 3);
  });

  it("legacy single payday still behaves (backward compatible)", () => {
    const single = incomeExpectation(8000, 15, NOW);
    expect(single.nextCheckDate).toBe("2026-07-15");
    expect(single.nextCheckAmount).toBe(8000);
  });
});

describe("evaluatePurchase", () => {
  const income = incomeExpectation(8000, 15, NOW);

  it("is null without a balance or with a bad amount", () => {
    expect(evaluatePurchase(cfg({ checkingBalance: undefined }), income, NOW, 500, 800)).toBeNull();
    expect(evaluatePurchase(cfg(), income, NOW, 0, 800)).toBeNull();
  });

  it("clears a small purchase", () => {
    // safe-to-spend = 3160 (see safeToSpend test); $400 is well inside it
    const v = evaluatePurchase(cfg(), income, NOW, 400, 800)!;
    expect(v.verdict).toBe("clear");
    expect(v.afterPurchase).toBe(2760);
    expect(v.dealsOfWork).toBe(0.5);
  });

  it("flags a purchase that eats most of safe-to-spend as tight", () => {
    const v = evaluatePurchase(cfg(), income, NOW, 2900, 800)!;
    expect(v.verdict).toBe("tight");
    expect(v.afterPurchase).toBe(260);
  });

  it("says WAIT (not no) when the next check covers what today's cash can't", () => {
    // $4,000 doesn't fit today's safe-to-spend, but the $8,000 check on the
    // 15th covers it easily — commission money is timing, not brokeness.
    const v = evaluatePurchase(cfg(), income, NOW, 4000, 800)!;
    expect(v.verdict).toBe("wait");
    expect(v.waitUntil).toBe("2026-07-15");
    expect(v.afterPurchase).toBeLessThan(0);
  });

  it("says no when it does not fit even after the checks land", () => {
    const v = evaluatePurchase(cfg(), income, NOW, 40000, 800)!;
    expect(v.verdict).toBe("no");
    expect(v.waitUntil).toBeUndefined();
  });

  it("says WAIT when buying today drags the curve underwater but the late check covers it", () => {
    // Fits inside today's safe-to-spend but drags the curve under $0 before
    // the (late) payday: low balance, check on the 28th. Buying AFTER that
    // check keeps the month above water → wait, with the date.
    const lateIncome = incomeExpectation(8000, 28, NOW);
    const tightCfg = cfg({ checkingBalance: 2400, payday: 28 });
    const v = evaluatePurchase(tightCfg, lateIncome, NOW, 900, 800)!;
    expect(v.verdict).toBe("wait");
    expect(v.waitUntil).toBe("2026-07-28");
    expect(v.lowAfter).not.toBeNull();
  });

  it("never clears a purchase that dips the curve below the FLOOR (even above $0)", () => {
    // Balance 2000, floor 500, check on the 28th. A $700 buy keeps the curve
    // above $0 but drags it under the floor before payday → WAIT, not clear.
    const lateIncome = incomeExpectation(8000, 28, NOW);
    const v = evaluatePurchase(cfg({ checkingBalance: 2000, payday: 28 }), lateIncome, NOW, 700, 800)!;
    expect(v.verdict).toBe("wait");
    expect(v.floor).toBe(500);
    expect(v.lowAfter).toBeGreaterThan(0);
    expect(v.lowAfter!).toBeLessThan(500);
  });

  it("reports 0 deals-of-work when average pay is unknown", () => {
    const v = evaluatePurchase(cfg(), income, NOW, 400, 0)!;
    expect(v.dealsOfWork).toBe(0);
  });
});

describe("totalMonthlyBills", () => {
  it("sums normalized amounts", () => {
    expect(totalMonthlyBills(cfg())).toBe(2480);
  });
});

describe("budgetMonth", () => {
  const budgeted = () =>
    cfg({
      budgets: [
        { name: "Food", monthly: 350 },
        { name: "Gas", monthly: 110 },
        { name: "Fun", monthly: 200 },
      ],
      spend: [
        { id: "s1", date: "2026-07-02", amount: 80, category: "Food" },
        { id: "s2", date: "2026-07-08", amount: 66.76, category: "food " }, // case/space-insensitive match
        { id: "s3", date: "2026-07-05", amount: 33, category: "Gas" },
        { id: "s4", date: "2026-07-09", amount: 99, category: "Golf" }, // unplanned category
        { id: "s5", date: "2026-06-28", amount: 500, category: "Food" }, // LAST month — excluded
      ],
    });

  it("scores each category: actual, left, pct — this month only", () => {
    const bm = budgetMonth(budgeted(), NOW)!;
    const food = bm.lines.find((l) => l.name === "Food")!;
    expect(food.actual).toBe(147);
    expect(food.left).toBe(203);
    expect(food.pct).toBe(42);
    const gas = bm.lines.find((l) => l.name === "Gas")!;
    expect(gas.pct).toBe(30);
    // Untouched budget still shows (Fun 0/200), unplanned spend rides along.
    expect(bm.lines.find((l) => l.name === "Fun")!.actual).toBe(0);
    const golf = bm.lines.find((l) => l.name === "Golf")!;
    expect(golf.budget).toBe(0);
    expect(golf.left).toBe(-99);
  });

  it("computes left-to-spend, days left, and per-day", () => {
    const bm = budgetMonth(budgeted(), NOW)!;
    expect(bm.totalBudget).toBe(660);
    expect(bm.totalSpent).toBe(279); // 80 + 66.76 + 33 + 99, rounded
    expect(bm.leftToSpend).toBe(381);
    expect(bm.daysLeft).toBe(22); // July 10 → 22 days incl today
    expect(bm.perDayLeft).toBe(Math.round(381 / 22));
  });

  it("is null with no budgets and no spend; present with spend only", () => {
    expect(budgetMonth(cfg(), NOW)).toBeNull();
    const spendOnly = cfg({ spend: [{ id: "s", date: "2026-07-03", amount: 40, category: "Food" }] });
    const bm = budgetMonth(spendOnly, NOW)!;
    expect(bm.totalBudget).toBe(0);
    expect(bm.totalSpent).toBe(40);
  });

  it("goes negative (over budget), per-day floors at 0", () => {
    const over = cfg({
      budgets: [{ name: "Food", monthly: 100 }],
      spend: [{ id: "s", date: "2026-07-04", amount: 260, category: "Food" }],
    });
    const bm = budgetMonth(over, NOW)!;
    expect(bm.leftToSpend).toBe(-160);
    expect(bm.perDayLeft).toBe(0);
    expect(bm.lines[0].pct).toBe(260);
  });

});

describe("addSpend / upsertBudget / seedBudgets", () => {
  it("logs a purchase today by default and prunes entries older than ~3 months", () => {
    const base = cfg({ spend: [{ id: "old", date: "2026-03-01", amount: 20, category: "Food" }] });
    const next = addSpend(base, { amount: 45.5, category: "  Gas " }, "2026-07-10", () => "new1");
    expect(next.spend).toHaveLength(1); // March entry pruned
    expect(next.spend![0]).toMatchObject({ id: "new1", date: "2026-07-10", amount: 46, category: "Gas" });
  });

  it("respects an explicit date and rejects a malformed one", () => {
    const a = addSpend(cfg(), { amount: 10, category: "Food", date: "2026-07-01" }, "2026-07-10", () => "a");
    expect(a.spend![0].date).toBe("2026-07-01");
    const b = addSpend(cfg(), { amount: 10, category: "Food", date: "yesterday" }, "2026-07-10", () => "b");
    expect(b.spend![0].date).toBe("2026-07-10");
  });

  it("upsertBudget adds, replaces by normalized name, and removes on null", () => {
    let c = upsertBudget(cfg(), "Food", 350);
    c = upsertBudget(c, "food", 400); // replaces, no duplicate
    expect(c.budgets).toHaveLength(1);
    expect(c.budgets![0].monthly).toBe(400);
    c = upsertBudget(c, "Food", null);
    expect(c.budgets).toHaveLength(0);
  });

  it("seeds budgets from the scanned spending pattern, rounded up to $10", () => {
    const withScan = cfg({
      spendingProfile: {
        avgMonthlySpend: 900,
        monthsAnalyzed: 2,
        detectedAt: "2026-07-01",
        categories: [
          { name: "Food", monthly: 342 },
          { name: "Gas", monthly: 104 },
        ],
      },
    });
    expect(seedBudgetsFromProfile(withScan)).toEqual([
      { name: "Food", monthly: 350 },
      { name: "Gas", monthly: 110 },
    ]);
    expect(seedBudgetsFromProfile(cfg())).toEqual([]);
  });
});

describe("month ledger (monthChecks / monthBills / cashFlowSummary)", () => {
  // July 10: paydays 1, 10, 15 with nets 3000/800/3000 → 1st and 10th landed.
  const ledgerCfg = () =>
    cfg({
      paydays: [1, 10, 15],
      checkNets: [3000, 800, 3000],
      budgets: [{ name: "Food", monthly: 350 }],
      spend: [{ id: "s1", date: "2026-07-02", amount: 150, category: "Food" }],
      bills: [
        bill({ id: "rent", name: "Rent", amount: 1800, dayOfMonth: 1 }),
        bill({ id: "truck", name: "Truck", amount: 650, dayOfMonth: 20, isDebt: true }),
      ],
    });
  const inc = () => incomeExpectation(0, [1, 10, 15], NOW, undefined, [3000, 800, 3000]);

  it("lists every check this month with its own amount, landed through today", () => {
    const checks = monthChecks(ledgerCfg(), inc(), NOW);
    expect(checks).toHaveLength(3);
    expect(checks.map((c) => [c.day, c.amount, c.landed])).toEqual([
      [1, 3000, true],
      [10, 800, true], // payday today = landed
      [15, 3000, false],
    ]);
  });

  it("lists the month's bill instances with landed flags", () => {
    const bills = monthBills(ledgerCfg(), NOW);
    expect(bills.map((b) => [b.bill.id, b.landed])).toEqual([
      ["rent", true],
      ["truck", false],
    ]);
  });

  it("summarizes income/expenses/bills/debt budget-vs-actual with a leftover row", () => {
    const rows = cashFlowSummary(ledgerCfg(), inc(), NOW);
    const by = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(by.Income).toMatchObject({ budget: 6800, actual: 3800 });
    expect(by.Expenses).toMatchObject({ budget: 350, actual: 150 });
    expect(by.Bills).toMatchObject({ budget: 1800, actual: 1800 });
    expect(by.Debt).toMatchObject({ budget: 650, actual: 0 });
    expect(by.Leftover).toMatchObject({ budget: 6800 - 350 - 1800 - 650, actual: 3800 - 150 - 1800 });
  });

  it("falls back to essentials as the expenses budget when no budgets are set", () => {
    const c = cfg({ paydays: [15], checkNets: [3000], monthlyEssentials: 900 });
    const rows = cashFlowSummary(c, incomeExpectation(0, 15, NOW, undefined, [3000]), NOW);
    expect(rows.find((r) => r.label === "Expenses")!.budget).toBe(900);
  });
});

describe("dailyBudget — the daily spending allowance", () => {
  // Balance 5000, floor 1000. Bills ahead: Truck 650 (20th), Streaming 30
  // (25th). Essentials $30/day. Check +3000 on the 15th.
  const inc = () => incomeExpectation(0, 15, NOW, undefined, [3000]);

  it("holds every projected day above the floor (steady + lump)", () => {
    const db = dailyBudget(cfg({ cushion: 1000, checkNets: [3000] }), inc(), NOW)!;
    expect(db.floor).toBe(1000);
    expect(db.lumpToday).toBeGreaterThan(0);
    expect(db.perDay).toBeGreaterThan(0);
    // Steady allowance respects the WORST day, so it must never exceed the
    // lump ceiling divided across at least one day.
    expect(db.perDay).toBeLessThanOrEqual(db.lumpToday);
    // Simulate: spend perDay every day on top of the curve — never below floor.
    const flow = cashFlow(cfg({ cushion: 1000, checkNets: [3000] }), inc(), NOW);
    flow.forEach((p, i) => expect(p.balance - db.perDay * (i + 1)).toBeGreaterThanOrEqual(db.floor - 1));
  });

  it("defaults the floor to $1,000 when no cushion is set", () => {
    const { cushion: _drop, ...noCushion } = cfg({ checkNets: [3000] });
    const db = dailyBudget(noCushion as MoneyConfig, inc(), NOW)!;
    expect(db.floor).toBe(1000);
  });

  it("tallies today's logged spend against the allowance", () => {
    const c = cfg({ cushion: 1000, checkNets: [3000], spend: [
      { id: "a", date: "2026-07-10", amount: 25, category: "Fun" },
      { id: "b", date: "2026-07-09", amount: 500, category: "Fun" }, // yesterday — not today's tally
    ]});
    const db = dailyBudget(c, inc(), NOW)!;
    expect(db.spentToday).toBe(25);
    expect(db.leftToday).toBe(Math.max(0, db.perDay - 25));
  });

  it("goes to zero (never negative) when the account can't clear the floor", () => {
    const broke = cfg({ checkingBalance: 900, cushion: 1000, checkNets: [3000] });
    const db = dailyBudget(broke, inc(), NOW)!;
    expect(db.perDay).toBe(0);
    expect(db.lumpToday).toBe(0);
    expect(db.leftToday).toBe(0);
  });

  it("a pay-yourself savings bill reduces the allowance like any bill", () => {
    const base = cfg({ cushion: 1000, checkNets: [3000] });
    const withSave = cfg({ cushion: 1000, checkNets: [3000], bills: [
      ...base.bills,
      { id: "me", name: "Pay myself", amount: 500, cadence: "monthly", dayOfMonth: 16, isSavings: true },
    ]});
    const a = dailyBudget(base, inc(), NOW)!;
    const b = dailyBudget(withSave, inc(), NOW)!;
    expect(b.lumpToday).toBeLessThan(a.lumpToday);
  });

  it("reports balance staleness in full days (9pm today is still today)", () => {
    const db = dailyBudget(cfg({ balanceAsOf: "2026-07-07", checkNets: [3000] }), inc(), NOW)!;
    expect(db.staleDays).toBe(3);
    const tonight = new Date(2026, 6, 10, 21, 30); // 9:30pm on the 10th
    const fresh = dailyBudget(cfg({ balanceAsOf: "2026-07-10", checkNets: [3000] }), inc(), tonight)!;
    expect(fresh.staleDays).toBe(0);
  });
});

describe("removeSpend", () => {
  it("removes exactly the one entry and recomputes downstream", () => {
    const c = cfg({
      budgets: [{ name: "Fun", monthly: 200 }],
      spend: [
        { id: "keep", date: "2026-07-05", amount: 50, category: "Fun" },
        { id: "returned", date: "2026-07-08", amount: 175, category: "Fun", note: "golf clubs" },
      ],
    });
    const next = removeSpend(c, "returned");
    expect(next.spend!.map((e) => e.id)).toEqual(["keep"]);
    expect(budgetMonth(next, NOW)!.lines[0].actual).toBe(50);
    expect(removeSpend(c, "nope").spend).toHaveLength(2); // unknown id = no-op
  });
});

describe("July 8 audit fixes", () => {
  it("quarterly/yearly bills reduce safe-to-spend and the cash curve (amortized reserve)", () => {
    const withYearly = cfg({ bills: [{ id: "ins", name: "Insurance", amount: 1200, cadence: "yearly", dayOfMonth: 12 }] });
    const withoutIt = cfg({ bills: [] });
    const inc = incomeExpectation(0, 15, NOW);
    const a = safeToSpend(withYearly, inc, NOW)!;
    const b = safeToSpend(withoutIt, inc, NOW)!;
    expect(a.available).toBeLessThan(b.available); // $100/mo reserve, scaled to days left
    const fa = cashFlow(withYearly, inc, NOW);
    const fb = cashFlow(withoutIt, inc, NOW);
    expect(fa[fa.length - 1].balance).toBeLessThan(fb[fb.length - 1].balance);
  });

  it("daysToIncome uses ceil — the evening before a payday still counts as a spending day", () => {
    const evening = new Date(2026, 6, 13, 21, 0); // 9pm July 13, payday the 15th
    const sts = safeToSpend(cfg(), incomeExpectation(8000, 15, evening), evening)!;
    expect(sts.daysToIncome).toBe(2); // Math.round gave 1 → perDay overstated 2×
  });

  it("evaluatePurchase says WAIT (not no) when the next check is ~a month out but covers it", () => {
    // single monthly payday on the 1st, today July 10 → next check Aug 1 (22d);
    // stretch further: payday on the 9th, today July 10 → next check Aug 9 (30+d)
    const c = cfg({ checkingBalance: 1400, monthlyEssentials: 300, bills: [], cushion: 1000 });
    const inc = incomeExpectation(0, 9, NOW, undefined, [5000]);
    expect(inc.nextCheckDate).toBe("2026-08-09");
    const v = evaluatePurchase(c, inc, NOW, 900, 1000)!;
    expect(v.verdict).toBe("wait"); // the old 30-day window never reached Aug 9 → "no"
    expect(v.waitUntil).toBe("2026-08-09");
  });
});

// ── Spend-aware cash flow (July 10 2026 audit: "the lower my money goes the
// higher it goes"). Logged spending above the modeled burn must LOWER the
// projection — no more midnight rebound where spent money reappears. ──
describe("cashFlow spend-awareness", () => {
  const NOW = new Date("2026-07-10T12:00:00");
  const base = (spend: MoneyConfig["spend"]): MoneyConfig =>
    ({
      checkingBalance: 1800,
      balanceAsOf: "2026-07-10",
      payday: 15,
      checkNets: [3000],
      cushion: 1000,
      monthlyEssentials: 1200, // ≈ $40/day modeled burn (31-day July)
      bills: [],
      goals: [],
      spend,
    }) as unknown as MoneyConfig;

  it("spending inside the modeled burn does not move the curve", () => {
    const a = cashFlow(base([]), { remainingThisMonth: 3000, nextCheckDate: "2026-07-15", nextCheckAmount: 3000 }, NOW, 5);
    const b = cashFlow(base([{ id: "s1", date: "2026-07-10", amount: 30, category: "Food" }]), { remainingThisMonth: 3000, nextCheckDate: "2026-07-15", nextCheckAmount: 3000 }, NOW, 5);
    expect(b.map((p) => p.balance)).toEqual(a.map((p) => p.balance));
  });

  it("spending above the burn lowers every projected day by the excess", () => {
    const a = cashFlow(base([]), { remainingThisMonth: 3000, nextCheckDate: "2026-07-15", nextCheckAmount: 3000 }, NOW, 5);
    const b = cashFlow(base([{ id: "s1", date: "2026-07-10", amount: 300, category: "Other" }]), { remainingThisMonth: 3000, nextCheckDate: "2026-07-15", nextCheckAmount: 3000 }, NOW, 5);
    const excess = 300 - 1200 / 31; // per-point rounding in the engine → ±1 tolerance
    b.forEach((p, i) => expect(a[i].balance - p.balance).toBeCloseTo(excess, -1));
  });

  it("no midnight rebound: yesterday's big spend still lowers TODAY's allowance until the balance is re-entered", () => {
    const income = { remainingThisMonth: 3000, nextCheckDate: "2026-07-15", nextCheckAmount: 3000 };
    const TOMORROW = new Date("2026-07-11T09:00:00");
    // Balance entered July 10; $300 spent July 10; nothing re-entered.
    const withSpend = dailyBudget(base([{ id: "s1", date: "2026-07-10", amount: 300, category: "Other" }]), income, TOMORROW)!;
    const withoutSpend = dailyBudget(base([]), income, TOMORROW)!;
    expect(withSpend.perDay).toBeLessThan(withoutSpend.perDay);
    // And re-entering a FRESH balance today clears the double-count window.
    const refreshed = dailyBudget(
      { ...base([{ id: "s1", date: "2026-07-10", amount: 300, category: "Other" }]), checkingBalance: 1500, balanceAsOf: "2026-07-11" } as MoneyConfig,
      income,
      TOMORROW,
    )!;
    const cleanRefreshed = dailyBudget({ ...base([]), checkingBalance: 1500, balanceAsOf: "2026-07-11" } as MoneyConfig, income, TOMORROW)!;
    expect(refreshed.perDay).toBe(cleanRefreshed.perDay);
  });

  it("allowance stays monotonic in balance (lower money never raises it)", () => {
    const income = { remainingThisMonth: 3000, nextCheckDate: "2026-07-15", nextCheckAmount: 3000 };
    let last = Infinity;
    for (const bal of [1900, 1700, 1500, 1300, 1100]) {
      const d = dailyBudget({ ...base([]), checkingBalance: bal } as MoneyConfig, income, NOW)!;
      expect(d.perDay).toBeLessThanOrEqual(last);
      last = d.perDay;
    }
  });
});
