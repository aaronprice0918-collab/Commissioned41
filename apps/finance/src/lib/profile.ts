import "server-only";
import { prisma, dbConfigured } from "./db";
import { mapAccountType } from "./mappers";
import { profile as mockProfile } from "./mockData";
import type { Account, Bill, FinancialProfile, Goal, Paycheck, Transaction, TxnCategory } from "./types";

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface LoadedProfile {
  profile: FinancialProfile;
  isLive: boolean; // true once real accounts are synced
}

/**
 * The single entry point the dashboard uses. Returns live data when a bank is
 * connected, otherwise the demo profile so the app always renders something
 * beautiful. goals / paychecks / bills come from UserConfig (seeded from the
 * demo) until the Plaid-recurring and pay-plan-AI phases replace them.
 */
export async function loadProfile(): Promise<LoadedProfile> {
  if (!dbConfigured()) return { profile: mockProfile, isLive: false };

  try {
    const dbAccounts = await prisma.account.findMany({ include: { item: true } });
    if (dbAccounts.length === 0) return { profile: mockProfile, isLive: false };

    const dbTxns = await prisma.transaction.findMany({ orderBy: { date: "desc" }, take: 500 });
    const cfg = await prisma.userConfig.findUnique({ where: { id: "singleton" } });

    const accounts: Account[] = dbAccounts.map((a) => ({
      id: a.id,
      name: a.name,
      institution: a.item.institution,
      type: mapAccountType(a.type, a.subtype),
      balance: a.currentBalance,
      limit: a.creditLimit ?? undefined,
      mask: a.mask ?? "",
    }));

    const transactions: Transaction[] = dbTxns.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      date: toISO(t.date),
      name: t.name,
      amount: t.amount,
      category: t.category as TxnCategory,
      pending: t.pending,
    }));

    // Config-backed pieces, with demo fallback so the dashboard stays rich.
    const goals = (cfg?.goals as Goal[] | undefined) ?? [];
    const paychecks = (cfg?.paychecks as Paycheck[] | undefined) ?? [];
    const bills = (cfg?.bills as Bill[] | undefined) ?? [];

    const profile: FinancialProfile = {
      name: cfg?.name ?? mockProfile.name,
      asOf: todayISO(),
      accounts,
      transactions,
      bills: bills.length ? bills : mockProfile.bills,
      paychecks: paychecks.length ? paychecks : mockProfile.paychecks,
      goals: goals.length ? goals : mockProfile.goals,
      monthlyEssentials: cfg?.monthlyEssentials ?? mockProfile.monthlyEssentials,
    };

    return { profile, isLive: true };
  } catch (e) {
    console.error("loadProfile failed, falling back to demo:", e);
    return { profile: mockProfile, isLive: false };
  }
}
