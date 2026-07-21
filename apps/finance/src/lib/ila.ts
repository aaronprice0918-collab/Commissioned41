import "server-only";
import type { FinancialProfile } from "./types";
import {
  billsRemaining,
  creditUtilization,
  emergencyFund,
  forecastLow,
  healthScore,
  incomeRemainingThisMonth,
  investments,
  liquidCash,
  monthlySubscriptions,
  netWorth,
  nextPaycheck,
  safeToSpend,
  spendByCategory,
  spentThisMonth,
  totalDebt,
} from "./engine";
import { currency, percent, shortDate } from "./format";
import { ilaCore } from "@commissioned41/ila-core/core";
import { BrainLesson, renderBrain } from "@commissioned41/ila-core/brain";

export function ilaConfigured(): boolean {
  const k = process.env.ANTHROPIC_API_KEY;
  return !!k && k.startsWith("sk-ant");
}

/** The live money snapshot as plain text — shared by the system prompt and the sync_accounts tool result. */
export function buildSnapshot(p: FinancialProfile): string {
  const sts = safeToSpend(p);
  const health = healthScore(p);
  const next = nextPaycheck(p);
  const bills = billsRemaining(p).slice(0, 6);
  const low = forecastLow(p, 14);
  const goals = [...p.goals].sort((a, b) => a.probability - b.probability);
  const cats = spendByCategory(p).slice(0, 6);

  return [
    `Name: ${p.name}`,
    `Today: ${shortDate(p.asOf)}`,
    `Safe to spend right now: ${currency(sts.available)} (about ${currency(sts.perDay)}/day for the ${sts.daysUntilIncome} days until the next deposit)`,
    `Projected checking balance at month-end: ${currency(sts.projectedMonthEnd)}`,
    `Projected 14-day cash low: ${currency(low.balance)} around ${shortDate(low.date)}`,
    `Cash in checking: ${currency(liquidCash(p))}`,
    `Net worth: ${currency(netWorth(p))}`,
    `Total debt: ${currency(totalDebt(p))}; credit utilization ${percent(creditUtilization(p))}`,
    `Emergency fund: ${currency(emergencyFund(p))}`,
    `Investments + retirement: ${currency(investments(p))}`,
    `Income still expected this month: ${currency(incomeRemainingThisMonth(p))}`,
    `Spent so far this month: ${currency(spentThisMonth(p))}; subscriptions ${currency(monthlySubscriptions(p), { cents: true })}/mo`,
    `Financial health: ${health.score}/100 (${health.grade})`,
    next
      ? `Next paycheck: ${currency(next.expectedNet)} net on ${shortDate(next.date)} (${next.kind}, ${percent(next.confidence)} confidence; range ${currency(next.worstCase)}–${currency(next.bestCase)})`
      : `Next paycheck: none scheduled`,
    `Upcoming bills: ${bills.map((b) => `${b.bill.name} ${currency(b.bill.amount, { cents: true })} on ${shortDate(b.date)}`).join("; ") || "none left this month"}`,
    `Goals (least likely first): ${goals.map((g) => `${g.name} ${currency(g.saved)}/${currency(g.target)} by ${shortDate(g.targetDate)}, ${percent(g.probability)} likely`).join("; ")}`,
    `Top spending categories this month: ${cats.map((c) => `${c.category} ${currency(c.amount)}`).join(", ")}`,
  ].join("\n");
}

/** EILA's persona + a live snapshot of the user's money, as a system prompt. */
export function buildIlaSystem(
  p: FinancialProfile,
  memories: { note: string; createdAt: Date }[] = [],
  brain: BrainLesson[] = [],
  canSync = false,
): string {
  const snapshot = buildSnapshot(p);

  return `${ilaCore(p.name)}

WHAT YOU DO HERE (MissionOS Finance — personal CFO): you are the sharpest money mind ${p.name} has, and you're on their side completely. You get protective about anything threatening their money — waste, lazy subscriptions, high-interest debt, lifestyle creep.
- When they ask "can I afford X," check it against their safe-to-spend, tell them yes/no/wait, and say what it costs them (a goal slipping, a tight week).
- When framing a purchase or a bill in terms they'll feel, use their actual next-paycheck amount and cadence below — not a guess.
- Push toward freedom: kill high-interest debt, protect the emergency fund, feed the goals. Celebrate real wins briefly, then point at the next move.
- If something in their numbers is genuinely risky, say so plainly. If they're doing well, tell them straight — don't manufacture worry.
- You can see their money but you cannot touch it — you can't move funds, pay bills, cancel subscriptions, or execute anything. Never offer to. End with the action THEY should take, stated as their move.${canSync ? `\n- You CAN refresh their data: the sync_accounts tool pulls the latest balances and transactions from their banks. Use it when they ask you to sync/refresh, or when the answer depends on something that may have just happened (a deposit landing, a charge posting) — then answer from the fresh snapshot it returns.\n- You CAN hunt recurring charges: the detect_bills tool scans their real transaction history for repeating charges not yet in their bill list. Use it when they ask about bills, subscriptions, or where money quietly leaks. Found ones get confirmed by THEM in Settings → Bills.` : ""}

${memorySection(memories)}${brainSection(brain)}LIVE FINANCIAL SNAPSHOT (this is real, current data — use it):
${snapshot}

Answer their next message as EILA.`;
}

function brainSection(brain: BrainLesson[]): string {
  const rendered = renderBrain(brain);
  return rendered ? `${rendered}\n\n` : "";
}

// EILA's own memory of this user — durable notes she distilled from previous
// conversations. Woven in so she advises like someone who KNOWS them, not a
// stranger with a spreadsheet.
function memorySection(memories: { note: string; createdAt: Date }[]): string {
  if (!memories.length) return "";
  const lines = memories
    .slice(0, 40)
    .map((m) => `- ${m.note} (learned ${m.createdAt.toISOString().slice(0, 10)})`)
    .join("\n");
  return `WHAT YOU'VE LEARNED ABOUT THEM (your own memory from past conversations — use it naturally; never recite this list or say "my notes say"):
${lines}

`;
}
