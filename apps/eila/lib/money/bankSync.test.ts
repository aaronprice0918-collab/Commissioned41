import { describe, expect, it } from "vitest";
import { applyBankSync, budgetMonth, setMerchantRule, type BankSyncPayload } from "./engine";
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

  it("excludes debt, card payments, transfers, self-Zelle, subs, utilities — keeps real spend", () => {
    const next = applyBankSync(
      defaultMoneyConfig(),
      {
        ...SYNC,
        transactions: [
          // NOT everyday — must be excluded:
          { date: "2026-07-13", name: "Ford Credit", amount: -860.65 }, // auto loan
          { date: "2026-07-02", name: "Five Lakes", amount: -175.09 }, // debt consolidation
          { date: "2026-07-13", name: "Mobile Banking payment to CRD 7738 Confirmation# jifgrwaau", amount: -107 }, // card payoff
          { date: "2026-07-03", name: "Online Scheduled Payment to ACCT# 7334 Confirmation# XXXXX35070", amount: -470.15 }, // internal
          { date: "2026-07-13", name: "Zelle payment to AARON PRICE Conf# xbam0m8a7", amount: -420 }, // to self
          { date: "2026-07-01", name: "Georgia Natural", amount: -70.36 }, // gas utility
          { date: "2026-07-01", name: "Flexible Finance", amount: -1503.61 }, // rent/lease
          { date: "2026-07-03", name: "Anthropic", amount: -45 }, // subscription
          // Real everyday spend — must be kept:
          { date: "2026-07-02", name: "Zelle payment to Marina Fitzjerald Conf# yvwcxi5gr", amount: -15 }, // person-to-person
          { date: "2026-07-16", name: "Venmo", amount: -500 },
          { date: "2026-07-06", name: "Kroger", amount: -83.16 },
          { date: "2026-07-10", name: "Murphy USA", amount: -35 },
          { date: "2026-07-10", name: "Outback Steakhouse", amount: -45.59 },
        ],
      },
      "2026-07-13T04:00:00Z",
      "Aaron Price",
    );
    const spend = bankSpend(next);
    // Only the 5 real everyday buys survive.
    expect(spend).toHaveLength(5);
    expect(spend.some((e) => /ford|five lakes|crd|scheduled payment|aaron price|georgia natural|flexible|anthropic/i.test(e.note ?? ""))).toBe(false);
    expect(budgetMonth(next, NOW)?.totalSpent).toBe(679); // 15 + 500 + 83 + 35 + 46
    expect(spend.find((e) => e.note?.includes("Kroger"))?.category).toBe("Groceries");
    expect(spend.find((e) => e.note?.includes("Murphy"))?.category).toBe("Gas");
    expect(spend.find((e) => e.note?.includes("Outback"))?.category).toBe("Dining");
  });
});

describe("merchant rules — the always-learning layer", () => {
  const NOW = "2026-07-13T04:00:00Z";
  const bankSpend = (cfg: ReturnType<typeof defaultMoneyConfig>): SpendEntry[] =>
    (cfg.spend ?? []).filter((e) => e.source === "bank");
  const syncWith = (txns: BankSyncPayload["transactions"]) =>
    applyBankSync(defaultMoneyConfig(), { ...SYNC, transactions: txns }, NOW);

  it("learns to IGNORE a merchant and re-classifies instantly (no re-sync)", () => {
    const synced = syncWith([
      { date: "2026-07-06", name: "Kroger", amount: -83.16 },
      { date: "2026-07-13", name: "River Remedy", amount: -27.45 },
    ]);
    expect(bankSpend(synced)).toHaveLength(2);
    const taught = setMerchantRule(synced, "River Remedy", "ignore", undefined, NOW);
    const spend = bankSpend(taught);
    expect(spend).toHaveLength(1);
    expect(spend[0].note).toContain("Kroger");
  });

  it("learns a word-list merchant IS everyday, with the member's category", () => {
    const synced = syncWith([{ date: "2026-07-01", name: "Apple", amount: -46.46 }]);
    expect(bankSpend(synced)).toHaveLength(0); // auto-excluded as a subscription
    const taught = setMerchantRule(synced, "Apple", "everyday", "Fun", NOW);
    const spend = bankSpend(taught);
    expect(spend).toHaveLength(1);
    expect(spend[0].category).toBe("Fun");
  });

  it("remembers the lesson across the next sync", () => {
    const feed = [{ date: "2026-07-01", name: "Mystery LLC", amount: -200 }];
    let cfg = syncWith(feed);
    expect(bankSpend(cfg)).toHaveLength(1); // unknown merchant defaults to everyday
    cfg = setMerchantRule(cfg, "Mystery LLC", "bill", undefined, NOW);
    expect(bankSpend(cfg)).toHaveLength(0);
    const resynced = applyBankSync(cfg, { ...SYNC, transactions: feed }, "2026-07-14T04:00:00Z");
    expect(bankSpend(resynced)).toHaveLength(0); // rule survived the sync
    expect(resynced.merchantRules).toHaveLength(1);
  });

  it("can forget a rule (back to auto-detect)", () => {
    let cfg = syncWith([{ date: "2026-07-01", name: "Mystery LLC", amount: -200 }]);
    cfg = setMerchantRule(cfg, "Mystery LLC", "ignore", undefined, NOW);
    expect(bankSpend(cfg)).toHaveLength(0);
    cfg = setMerchantRule(cfg, "Mystery LLC", "remove", undefined, NOW);
    expect(bankSpend(cfg)).toHaveLength(1);
    expect(cfg.merchantRules ?? []).toHaveLength(0);
  });
});
