import { describe, expect, it } from "vitest";
import { applyBankSync, type BankSyncPayload } from "./engine";
import { defaultMoneyConfig } from "./types";

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
