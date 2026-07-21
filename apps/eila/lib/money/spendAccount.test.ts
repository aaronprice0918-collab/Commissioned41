import { describe, expect, it } from "vitest";
import { addSpend, applyBankSync, setSpendAccount, accountLabelFor, setLinkedAccounts, findAccount, type BankSyncPayload } from "./engine";
import { defaultMoneyConfig, type LinkedAccount } from "./types";

const ACCTS: LinkedAccount[] = [
  { id: "lge-chk", institution: "LGE Credit Union", name: "Checking", mask: "0009", type: "checking", balance: 1102.68 },
  { id: "bofa-chk", institution: "Bank of America", name: "Checking", mask: "8714", type: "checking", balance: 82.19 },
  { id: "bofa-card", institution: "Bank of America", name: "Credit Card", mask: "7334", type: "credit", balance: 65.8 },
];

const NOW = "2026-07-21T12:00:00Z";

function baseWithAccounts(): ReturnType<typeof defaultMoneyConfig> {
  return setLinkedAccounts(defaultMoneyConfig(), ACCTS, NOW);
}

describe("transaction → source account", () => {
  it("labels an account in a human, bank·name·last4 form", () => {
    const cfg = baseWithAccounts();
    expect(accountLabelFor(cfg, "bofa-chk")).toBe("Bank of America · Checking ····8714");
    expect(accountLabelFor(cfg, "nope")).toBeUndefined();
    expect(accountLabelFor(cfg, undefined)).toBeUndefined();
    expect(findAccount(cfg, "lge-chk")?.institution).toBe("LGE Credit Union");
  });

  it("carries the account through from a synced transaction", () => {
    const sync: BankSyncPayload = {
      institutions: ["LGE Credit Union"],
      accounts: [],
      checking: 1102.68,
      savings: null,
      transactions: [
        { date: "2026-07-18", name: "SHELL OIL 12345", amount: -40, account: "lge-chk" },
        { date: "2026-07-17", name: "KROGER #778", amount: -85, account: "lge-chk" },
      ],
      asOf: NOW,
    };
    const cfg = applyBankSync(baseWithAccounts(), sync, NOW);
    const spend = cfg.spend ?? [];
    expect(spend.length).toBe(2);
    // Every derived everyday line knows which account it came out of.
    expect(spend.every((e) => e.account === "lge-chk")).toBe(true);
  });

  it("assigns an account to a synced merchant and remembers it across recompute", () => {
    const sync: BankSyncPayload = {
      institutions: ["Bank of America"],
      accounts: [],
      checking: 82.19,
      savings: null,
      transactions: [
        { date: "2026-07-18", name: "COSTCO WHSE #1200", amount: -60 },
        { date: "2026-07-10", name: "COSTCO WHSE #1200", amount: -120 },
        { date: "2026-07-05", name: "SHELL OIL 999", amount: -35 },
      ],
      asOf: NOW,
    };
    let cfg = applyBankSync(baseWithAccounts(), sync, NOW);
    const costco = (cfg.spend ?? []).find((e) => /costco/i.test(e.note || ""));
    expect(costco).toBeTruthy();
    expect(costco!.account).toBeUndefined(); // sync didn't say which account

    // Tell EILA it's the BofA card — she stamps the stored transactions.
    cfg = setSpendAccount(cfg, costco!, "bofa-card", NOW);

    const costcoLines = (cfg.spend ?? []).filter((e) => /costco/i.test(e.note || ""));
    expect(costcoLines.length).toBe(2);
    // BOTH Costco charges (past + the other one) now show the account...
    expect(costcoLines.every((e) => e.account === "bofa-card")).toBe(true);
    // ...but a different merchant is left alone.
    const shell = (cfg.spend ?? []).find((e) => /shell/i.test(e.note || ""));
    expect(shell?.account).toBeUndefined();
    // And it's durable: it lives on the stored transactions, not a rebuilt id.
    expect((cfg.bankTransactions ?? []).filter((t) => /costco/i.test(t.name)).every((t) => t.account === "bofa-card")).toBe(true);
  });

  it("sets and clears the account on a hand-logged entry", () => {
    let cfg = baseWithAccounts();
    cfg = addSpend(cfg, { amount: 42, category: "Dining", note: "lunch", account: "lge-chk" }, "2026-07-21", () => "m1");
    let entry = (cfg.spend ?? [])[0];
    expect(entry.account).toBe("lge-chk");

    // Move it to the BofA card.
    cfg = setSpendAccount(cfg, entry, "bofa-card", NOW);
    entry = (cfg.spend ?? [])[0];
    expect(entry.account).toBe("bofa-card");

    // Clear it.
    cfg = setSpendAccount(cfg, entry, undefined, NOW);
    expect((cfg.spend ?? [])[0].account).toBeUndefined();
  });
});
