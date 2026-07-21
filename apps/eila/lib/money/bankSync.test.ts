import { describe, expect, it } from "vitest";
import { applyBankSync, budgetMonth, type BankSyncPayload } from "./engine";
import { defaultMoneyConfig, type SpendEntry } from "./types";

const SYNC: BankSyncPayload = {
  institutions: ["Bank of America"],
  accounts: [
    { name: "Adv Plus Banking", mask: "1234", type: "checking", balance: 2431.55 },
    { name: "Rewards Savings", mask: "9876", type: "savings", balance: 5000 },
  ],
  checking: 2431.55,
  savings: 5000,
  transactions: [
    { date: "2026-07-12", name: "QT 714", amount: -42.1 },
    { date: "2026-07-11", name: "Kennesaw Mazda Payroll", amount: 2900 },
  ],
  asOf: "2026-07-13",
};

describe("applyBankSync", () => {
  it("anchors balances, keeps savings its own bucket, stamps freshness", () => {
    const cfg = { ...defaultMoneyConfig(), checkingBalance: 100, balanceAsOf: "2026-07-01" };
    const next = applyBankSync(cfg, SYNC, "2026-07-13T04:00:00Z");
    expect(next.checkingBalance).toBe(2431.55);
    expect(next.savingsBalance).toBe(5000);
    expect(next.balanceAsOf).toBe("2026-07-13");
    expect(next.bank?.institutions).toEqual(["Bank of America"]);
    expect(next.bank?.lastSync).toBe("2026-07-13T04:00:00Z");
    expect(next.bankTransactions).toHaveLength(2);
  });

  it("does not clobber balances the sync could not see", () => {
    const cfg = { ...defaultMoneyConfig(), checkingBalance: 900, savingsBalance: 250 };
    const next = applyBankSync(cfg, { ...SYNC, checking: null, savings: null }, "2026-07-13T04:00:00Z");
    expect(next.checkingBalance).toBe(900);
    expect(next.savingsBalance).toBe(250);
  });

  it("leaves bills, goals, budgets untouched", () => {
    const cfg = {
      ...defaultMoneyConfig(),
      bills: [{ id: "b1", name: "Rent", amount: 1800, cadence: "monthly" as const, dayOfMonth: 1 }],
      monthlyEssentials: 850,
    };
    const next = applyBankSync(cfg, SYNC, "2026-07-13T04:00:00Z");
    expect(next.bills).toEqual(cfg.bills);
    expect(next.monthlyEssentials).toBe(850);
  });

  it("adds forgotten recurring bank outflows as auto-detected bills", () => {
    const cfg = {
      ...defaultMoneyConfig(),
      bills: [{ id: "typed-netflix", name: "Netflix", amount: 15.99, cadence: "monthly" as const, dayOfMonth: 12 }],
    };
    const next = applyBankSync(
      cfg,
      {
        ...SYNC,
        transactions: [
          { date: "2026-05-12", name: "NETFLIX.COM", amount: -15.99 },
          { date: "2026-06-12", name: "NETFLIX.COM", amount: -15.99 },
          { date: "2026-07-12", name: "NETFLIX.COM", amount: -15.99 },
          { date: "2026-05-04", name: "STATE FARM INSURANCE", amount: -182.4 },
          { date: "2026-06-05", name: "STATE FARM INSURANCE", amount: -182.4 },
          { date: "2026-07-05", name: "STATE FARM INSURANCE", amount: -182.4 },
          { date: "2026-05-07", name: "CAPITAL ONE AUTO PAY", amount: -425 },
          { date: "2026-06-07", name: "CAPITAL ONE AUTO PAY", amount: -425 },
          { date: "2026-07-08", name: "CAPITAL ONE AUTO PAY", amount: -425 },
        ],
      },
      "2026-07-13T04:00:00Z",
    );

    expect(next.bills.filter((b) => b.name === "Netflix")).toHaveLength(1);
    const insurance = next.bills.find((b) => b.name === "State Farm Insurance")!;
    expect(insurance).toMatchObject({
      amount: 182.4,
      cadence: "monthly",
      dayOfMonth: 5,
      autoDetected: true,
    });
    expect(insurance.isSubscription).toBeFalsy();

    const truck = next.bills.find((b) => b.name === "Capital One")!;
    expect(truck).toMatchObject({
      amount: 425,
      cadence: "monthly",
      dayOfMonth: 7,
      isDebt: true,
      autoDetected: true,
    });
  });

  it("does not turn repeated everyday merchants into bills", () => {
    const next = applyBankSync(
      defaultMoneyConfig(),
      {
        ...SYNC,
        transactions: [
          { date: "2026-05-10", name: "PUBLIX #1482", amount: -87.12 },
          { date: "2026-06-10", name: "PUBLIX #1482", amount: -88.09 },
          { date: "2026-07-10", name: "PUBLIX #1482", amount: -86.44 },
          { date: "2026-05-06", name: "SHELL OIL", amount: -45 },
          { date: "2026-06-06", name: "SHELL OIL", amount: -45 },
          { date: "2026-07-06", name: "SHELL OIL", amount: -45 },
        ],
      },
      "2026-07-13T04:00:00Z",
    );

    expect(next.bills).toEqual([]);
  });

  it("caps stored transactions at 200", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ date: "2026-07-01", name: `t${i}`, amount: -1 }));
    const next = applyBankSync(defaultMoneyConfig(), { ...SYNC, transactions: many }, "2026-07-13T04:00:00Z");
    expect(next.bankTransactions).toHaveLength(200);
  });
});

describe("applyBankSync — everyday spend from the feed", () => {
  const NOW = new Date("2026-07-13T12:00:00Z");
  const bankSpend = (cfg: ReturnType<typeof defaultMoneyConfig>): SpendEntry[] =>
    (cfg.spend ?? []).filter((e) => e.source === "bank");

  it("counts everyday purchases as spend so 'money out' reflects reality", () => {
    const next = applyBankSync(
      defaultMoneyConfig(),
      {
        ...SYNC,
        transactions: [
          { date: "2026-07-02", name: "PUBLIX #1482", amount: -100 },
          { date: "2026-07-05", name: "SHELL OIL", amount: -50 },
          { date: "2026-07-08", name: "TARGET T-2201", amount: -75 },
          { date: "2026-07-09", name: "CHIPOTLE 0420", amount: -18 },
        ],
      },
      "2026-07-13T04:00:00Z",
    );
    const spend = bankSpend(next);
    expect(spend).toHaveLength(4);
    // The whole point: everyday spend now lands in the budget's "actual".
    expect(budgetMonth(next, NOW)?.totalSpent).toBe(243);
    expect(spend.find((e) => e.note?.includes("Publix"))?.category).toBe("Groceries");
    expect(spend.find((e) => e.note?.includes("Shell"))?.category).toBe("Gas");
    expect(spend.find((e) => e.note?.includes("Chipotle"))?.category).toBe("Dining");
  });

  it("excludes bills, debt, subscriptions, transfers, and income", () => {
    const next = applyBankSync(
      { ...defaultMoneyConfig(), bills: [{ id: "rent", name: "Rent", amount: 1800, cadence: "monthly" as const, dayOfMonth: 1 }] },
      {
        ...SYNC,
        transactions: [
          { date: "2026-07-01", name: "RENT PAYMENT", amount: -1800 }, // known bill
          { date: "2026-07-05", name: "STATE FARM INSURANCE", amount: -182 }, // household bill word
          { date: "2026-07-07", name: "CAPITAL ONE AUTO PAY", amount: -425 }, // debt word
          { date: "2026-07-12", name: "NETFLIX.COM", amount: -15.99 }, // subscription word
          { date: "2026-07-10", name: "ONLINE TRANSFER TO SAVINGS", amount: -500 }, // transfer word
          { date: "2026-07-11", name: "KENNESAW MAZDA PAYROLL", amount: 2900 }, // income (positive)
          { date: "2026-07-09", name: "KROGER #55", amount: -60 }, // the one real everyday buy
        ],
      },
      "2026-07-13T04:00:00Z",
    );
    const spend = bankSpend(next);
    expect(spend).toHaveLength(1);
    expect(spend[0]).toMatchObject({ amount: 60, category: "Groceries" });
    expect(budgetMonth(next, NOW)?.totalSpent).toBe(60);
  });

  it("rebuilds bank spend idempotently and preserves manual logs", () => {
    const cfg = {
      ...defaultMoneyConfig(),
      spend: [{ id: "manual-1", date: "2026-07-03", amount: 40, category: "Fun" }] as SpendEntry[],
    };
    const sync: BankSyncPayload = {
      ...SYNC,
      transactions: [
        { date: "2026-07-04", name: "STARBUCKS 123", amount: -6 },
        { date: "2026-07-06", name: "COSTCO WHSE", amount: -220 },
      ],
    };
    const once = applyBankSync(cfg, sync, "2026-07-13T04:00:00Z");
    const twice = applyBankSync(once, sync, "2026-07-14T04:00:00Z"); // re-sync same feed

    // Manual entry survives exactly once; bank slice not duplicated.
    expect((twice.spend ?? []).filter((e) => e.id === "manual-1")).toHaveLength(1);
    expect(bankSpend(twice)).toHaveLength(2);
    expect(budgetMonth(twice, NOW)?.totalSpent).toBe(266); // 40 + 6 + 220
  });
});
