import { describe, expect, it } from "vitest";
import { setLinkedAccounts, accountsSummary, safeToSpend, incomeExpectation } from "./engine";
import { defaultMoneyConfig, type LinkedAccount } from "./types";

const ACCTS: LinkedAccount[] = [
  { id: "a1", institution: "LGE Credit Union", name: "High Rewards Checking", mask: "0009", type: "checking", balance: 1102.68 },
  { id: "a2", institution: "Bank of America", name: "Checking", mask: "8714", type: "checking", balance: 82.19 },
  { id: "a3", institution: "Bank of America", name: "Advantage Savings", mask: "8727", type: "savings", balance: 9.12 },
  { id: "a4", institution: "LGE Credit Union", name: "Savings", mask: "0000", type: "savings", balance: 0.05 },
  { id: "a5", institution: "Bank of America", name: "Credit Card", mask: "7334", type: "credit", balance: 65.8 },
  { id: "a6", institution: "LGE Credit Union", name: "Honda Pilot Loan", mask: "0050", type: "loan", balance: 40890.34 },
];

describe("multi-account", () => {
  it("derives checking/savings as the SUM across every bank", () => {
    const cfg = setLinkedAccounts(defaultMoneyConfig(), ACCTS, "2026-07-21T12:00:00Z");
    expect(cfg.checkingBalance).toBe(1184.87); // 1102.68 + 82.19 — the REAL total, not $82
    expect(cfg.savingsBalance).toBe(9.17); // 9.12 + 0.05
    expect(cfg.balanceAsOf).toBe("2026-07-21");
  });

  it("summary rolls up liquid vs debt", () => {
    const cfg = setLinkedAccounts(defaultMoneyConfig(), ACCTS, "2026-07-21T12:00:00Z");
    const s = accountsSummary(cfg);
    expect(s.checking).toBe(1184.87);
    expect(s.savings).toBe(9.17);
    expect(s.liquid).toBe(1194.04);
    expect(s.debt).toBe(40956.14); // 65.80 card + 40890.34 loan
  });

  it("safe-to-spend now runs on the combined balance", () => {
    const base = { ...defaultMoneyConfig(), monthlyEssentials: 0, paydays: [15], cushion: 0 };
    const cfg = setLinkedAccounts(base, ACCTS, "2026-07-21T12:00:00Z");
    const income = incomeExpectation(0, cfg.paydays, new Date("2026-07-21"), 0);
    const sts = safeToSpend(cfg, income, new Date("2026-07-21"));
    // With no bills/essentials/cushion, available reflects the ~$1,185 total, not $82.
    expect(sts?.available).toBeGreaterThan(1000);
  });

  it("leaves single-balance configs untouched when no accounts are linked", () => {
    const cfg = { ...defaultMoneyConfig(), checkingBalance: 500 };
    const s = accountsSummary(cfg);
    expect(s.accounts).toEqual([]);
    expect(cfg.checkingBalance).toBe(500);
  });
});
