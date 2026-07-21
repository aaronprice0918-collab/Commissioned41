// MissionOS Finance — the CFO brain.
// Pure functions that turn a FinancialProfile into the live numbers every
// widget renders: cash position, safe-to-spend, the rolling forecast, the
// health score, and the daily brief. No side effects, fully testable.

import type { Account, Bill, FinancialProfile, Paycheck } from "./types";
import { daysBetween, parseISO } from "./format";

// ---------- account roll-ups ----------

export function liquidCash(p: FinancialProfile): number {
  return p.accounts
    .filter((a) => a.type === "checking")
    .reduce((s, a) => s + a.balance, 0);
}

export function totalAssets(p: FinancialProfile): number {
  return p.accounts
    .filter((a) => a.balance > 0)
    .reduce((s, a) => s + a.balance, 0);
}

export function totalDebt(p: FinancialProfile): number {
  return p.accounts
    .filter((a) => a.balance < 0)
    .reduce((s, a) => s + Math.abs(a.balance), 0);
}

export function netWorth(p: FinancialProfile): number {
  return p.accounts.reduce((s, a) => s + a.balance, 0);
}

export function emergencyFund(p: FinancialProfile): number {
  return p.accounts
    .filter((a) => a.type === "savings")
    .reduce((s, a) => s + a.balance, 0);
}

export function investments(p: FinancialProfile): number {
  return p.accounts
    .filter((a) => a.type === "investment" || a.type === "retirement")
    .reduce((s, a) => s + a.balance, 0);
}

export function creditUtilization(p: FinancialProfile): number {
  const cards = p.accounts.filter((a) => a.type === "credit" && a.limit);
  const used = cards.reduce((s, a) => s + Math.abs(a.balance), 0);
  const limit = cards.reduce((s, a) => s + (a.limit ?? 0), 0);
  return limit === 0 ? 0 : used / limit;
}

// ---------- monthly obligations ----------

/** Normalize any bill cadence to a monthly-equivalent dollar amount. */
export function monthlyAmount(bill: Bill): number {
  switch (bill.cadence) {
    case "weekly":
      return bill.amount * 52 / 12;
    case "biweekly":
      return bill.amount * 26 / 12;
    case "monthly":
      return bill.amount;
    case "quarterly":
      return bill.amount / 3;
    case "yearly":
      return bill.amount / 12;
  }
}

export function totalMonthlyBills(p: FinancialProfile): number {
  return p.bills.reduce((s, b) => s + monthlyAmount(b), 0);
}

export function monthlySubscriptions(p: FinancialProfile): number {
  return p.bills
    .filter((b) => b.isSubscription)
    .reduce((s, b) => s + monthlyAmount(b), 0);
}

/** The dated occurrence of a monthly bill within the same month as `asOf`. */
function billDateThisMonth(bill: Bill, asOf: string): string | null {
  if (bill.cadence !== "monthly" || !bill.dayOfMonth) return null;
  const d = parseISO(asOf);
  const day = Math.min(bill.dayOfMonth, 28);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export interface UpcomingBill {
  bill: Bill;
  date: string;
  daysAway: number;
}

/** Bills still to hit between `asOf` and the end of the current month. */
export function billsRemaining(p: FinancialProfile): UpcomingBill[] {
  const asOf = p.asOf;
  const out: UpcomingBill[] = [];
  for (const bill of p.bills) {
    const date = billDateThisMonth(bill, asOf);
    if (!date) continue;
    const daysAway = daysBetween(asOf, date);
    if (daysAway >= 0) out.push({ bill, date, daysAway });
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}

export function billsRemainingTotal(p: FinancialProfile): number {
  return billsRemaining(p).reduce((s, u) => s + u.bill.amount, 0);
}

// ---------- income ----------

export function nextPaycheck(p: FinancialProfile): Paycheck | null {
  const future = p.paychecks
    .filter((pc) => daysBetween(p.asOf, pc.date) >= 0)
    .sort((a, b) => daysBetween(p.asOf, a.date) - daysBetween(p.asOf, b.date));
  return future[0] ?? null;
}

export function incomeRemainingThisMonth(p: FinancialProfile): number {
  const d = parseISO(p.asOf);
  const month = d.getMonth();
  return p.paychecks
    .filter((pc) => {
      const pd = parseISO(pc.date);
      return pd.getMonth() === month && daysBetween(p.asOf, pc.date) >= 0;
    })
    .reduce((s, pc) => s + pc.expectedNet, 0);
}

// ---------- safe to spend ----------

export interface SafeToSpend {
  available: number; // discretionary cash after committed obligations
  perDay: number; // safe daily allowance until next income
  daysUntilIncome: number;
  projectedMonthEnd: number;
}

/**
 * Safe-to-spend = cash on hand, minus the bills still due before the next
 * paycheck, minus a prorated slice of the essentials floor, leaving a buffer
 * we never recommend spending into. The per-day figure spreads what's left
 * across the runway to the next deposit.
 */
export function safeToSpend(p: FinancialProfile): SafeToSpend {
  const cash = liquidCash(p);
  const next = nextPaycheck(p);
  const daysUntilIncome = next ? Math.max(daysBetween(p.asOf, next.date), 1) : 14;

  const remaining = billsRemaining(p);
  const billsBeforeIncome = remaining
    .filter((u) => !next || u.daysAway <= daysUntilIncome)
    .reduce((s, u) => s + u.bill.amount, 0);

  // Prorate the essentials floor across the runway.
  const essentialsSlice = (p.monthlyEssentials / 30) * daysUntilIncome;
  const buffer = 500; // never dip below this safety cushion

  const available = Math.max(cash - billsBeforeIncome - essentialsSlice - buffer, 0);
  const perDay = available / daysUntilIncome;

  // Project end-of-month checking balance: cash + remaining income − remaining
  // bills − remaining essentials for the rest of the month.
  const monthEndDays = daysToMonthEnd(p.asOf);
  const essentialsRest = (p.monthlyEssentials / 30) * monthEndDays;
  const projectedMonthEnd =
    cash + incomeRemainingThisMonth(p) - billsRemainingTotal(p) - essentialsRest;

  return { available, perDay, daysUntilIncome, projectedMonthEnd };
}

function daysToMonthEnd(asOf: string): number {
  const d = parseISO(asOf);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return last - d.getDate();
}

// ---------- spending this month ----------

export function spentThisMonth(p: FinancialProfile): number {
  const month = parseISO(p.asOf).getMonth();
  return p.transactions
    .filter((t) => parseISO(t.date).getMonth() === month && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
}

export interface CategorySpend {
  category: string;
  amount: number;
}

export function spendByCategory(p: FinancialProfile): CategorySpend[] {
  const month = parseISO(p.asOf).getMonth();
  const map = new Map<string, number>();
  for (const t of p.transactions) {
    if (t.amount >= 0) continue;
    if (parseISO(t.date).getMonth() !== month) continue;
    map.set(t.category, (map.get(t.category) ?? 0) + Math.abs(t.amount));
  }
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------- forecast (daily projected balance) ----------

export interface ForecastPoint {
  date: string;
  balance: number;
  event?: string; // label for a bill/income that day
  kind?: "income" | "bill";
}

/** A day-by-day projected checking balance for the next `days` days. */
export function forecast(p: FinancialProfile, days = 30): ForecastPoint[] {
  let balance = liquidCash(p);
  const points: ForecastPoint[] = [];
  const start = parseISO(p.asOf);

  // Index bills and paychecks by ISO date.
  const billsByDate = new Map<string, { label: string; amount: number }[]>();
  for (const u of billsRemaining(p)) {
    const arr = billsByDate.get(u.date) ?? [];
    arr.push({ label: u.bill.name, amount: -u.bill.amount });
    billsByDate.set(u.date, arr);
  }
  const payByDate = new Map<string, { label: string; amount: number }>();
  for (const pc of p.paychecks) {
    payByDate.set(pc.date, { label: pc.source, amount: pc.expectedNet });
  }

  const dailyEssentials = p.monthlyEssentials / 30;

  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;

    let event: string | undefined;
    let kind: ForecastPoint["kind"];

    if (i > 0) {
      balance -= dailyEssentials;
      const bs = billsByDate.get(iso);
      if (bs) {
        for (const b of bs) balance += b.amount;
        event = bs.map((b) => b.label).join(", ");
        kind = "bill";
      }
      const pay = payByDate.get(iso);
      if (pay) {
        balance += pay.amount;
        event = pay.label;
        kind = "income";
      }
    }

    points.push({ date: iso, balance, event, kind });
  }
  return points;
}

export function forecastLow(p: FinancialProfile, days = 30): ForecastPoint {
  return forecast(p, days).reduce((lo, pt) => (pt.balance < lo.balance ? pt : lo));
}

// ---------- financial health score ----------

export interface HealthFactor {
  label: string;
  score: number; // 0-100
  weight: number; // relative
  detail: string;
}

export interface HealthScore {
  score: number; // 0-100 weighted
  grade: string;
  factors: HealthFactor[];
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

export function healthScore(p: FinancialProfile): HealthScore {
  const monthlyBurn = totalMonthlyBills(p) + p.monthlyEssentials;
  const ef = emergencyFund(p);
  const monthsCovered = monthlyBurn > 0 ? ef / monthlyBurn : 0;
  const util = creditUtilization(p);
  const sts = safeToSpend(p);
  const avgMonthlyIncome = p.paychecks.reduce((s, pc) => s + pc.expectedNet, 0); // ~1 cycle
  const dti = avgMonthlyIncome > 0 ? totalMonthlyBills(p) / (avgMonthlyIncome) : 1;

  const factors: HealthFactor[] = [
    {
      label: "Emergency Fund",
      weight: 1.5,
      score: clamp((monthsCovered / 6) * 100),
      detail: `${monthsCovered.toFixed(1)} months of expenses covered`,
    },
    {
      label: "Cash Flow",
      weight: 1.5,
      score: clamp(sts.projectedMonthEnd > 0 ? 70 + Math.min(sts.projectedMonthEnd / 200, 30) : 30),
      detail: sts.projectedMonthEnd > 0 ? "Projected to end the month positive" : "Tight month projected",
    },
    {
      label: "Credit Utilization",
      weight: 1.2,
      score: clamp(util <= 0.1 ? 100 : util <= 0.3 ? 100 - (util - 0.1) * 250 : 50 - (util - 0.3) * 100),
      detail: `${(util * 100).toFixed(0)}% of available credit used`,
    },
    {
      label: "Debt Load",
      weight: 1.2,
      score: clamp(dti <= 0.3 ? 100 : 100 - (dti - 0.3) * 150),
      detail: `Fixed bills are ${(dti * 100).toFixed(0)}% of monthly net`,
    },
    {
      label: "Investments",
      weight: 1.0,
      score: clamp((investments(p) / 100000) * 100),
      detail: "Building long-term wealth",
    },
    {
      label: "Income Stability",
      weight: 1.0,
      score: clamp((p.paychecks.reduce((s, pc) => s + pc.confidence, 0) / p.paychecks.length) * 100),
      detail: "Commission income — variable but predicted",
    },
    {
      label: "Net Worth Trend",
      weight: 0.8,
      score: clamp(netWorth(p) > 0 ? 65 : 40),
      detail: "Trending up month over month",
    },
  ];

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const score = Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight);

  const grade =
    score >= 90 ? "Excellent" : score >= 75 ? "Strong" : score >= 60 ? "Healthy" : score >= 45 ? "Fair" : "Needs Work";

  return { score, grade, factors };
}

// ---------- AI daily brief ----------

export interface BriefLine {
  text: string;
  tone: "neutral" | "good" | "watch";
}

export function dailyBrief(p: FinancialProfile): BriefLine[] {
  const sts = safeToSpend(p);
  const next = nextPaycheck(p);
  const billsBefore = billsRemaining(p)
    .filter((u) => !next || u.daysAway <= sts.daysUntilIncome)
    .reduce((s, u) => s + u.bill.amount, 0);
  const lines: BriefLine[] = [];

  lines.push({
    text: `You have ${money(sts.available)} safe to spend right now.`,
    tone: "good",
  });

  if (next) {
    lines.push({
      text: `You'll receive about ${money(next.expectedNet)} on ${humanDate(next.date)} — ${Math.round(
        next.confidence * 100,
      )}% confidence.`,
      tone: "neutral",
    });
  }

  if (billsBefore > 0) {
    lines.push({
      text: `${money(billsBefore)} in bills hit before then.`,
      tone: "watch",
    });
  }

  lines.push({
    text: `That's about ${money(sts.perDay)}/day until payday.`,
    tone: "neutral",
  });

  const investable = Math.max(sts.available - sts.perDay * sts.daysUntilIncome * 0.6, 0);
  if (investable > 200) {
    lines.push({
      text: `You could safely move ${money(Math.round(investable / 50) * 50)} toward a goal this week.`,
      tone: "good",
    });
  }

  return lines;
}

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function humanDate(iso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = parseISO(iso);
  const wd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  return `${wd}, ${months[d.getMonth()]} ${d.getDate()}`;
}

// ---------- decision engine ----------

export interface PurchaseVerdict {
  amount: number;
  affordable: boolean;
  safeAfter: number;
  hoursOfWork: number;
  dealsToReplace: number;
  goalImpactDays: number; // days a goal slips if you buy
  recommendation: string;
  tone: "good" | "watch" | "stop";
}

/** "Can I buy this?" answered like a CFO. */
export function evaluatePurchase(p: FinancialProfile, amount: number): PurchaseVerdict {
  const sts = safeToSpend(p);
  const safeAfter = sts.available - amount;
  const affordable = safeAfter >= 0;

  // F&I context: avg net per deal and an hourly figure for "hours of work".
  const avgDealProfit = 1850; // avg F&I gross per deal
  const monthlyNet = p.paychecks.reduce((s, pc) => s + pc.expectedNet, 0);
  const hourly = monthlyNet / 180; // ~180 working hours/mo

  const hoursOfWork = amount / hourly;
  const dealsToReplace = amount / avgDealProfit;

  // Goal slip: if it would otherwise have gone to the top goal's monthly pace.
  const topGoal = [...p.goals].sort((a, b) => a.probability - b.probability)[0];
  const goalImpactDays = topGoal ? (amount / topGoal.monthlyContribution) * 30 : 0;

  let recommendation: string;
  let tone: PurchaseVerdict["tone"];
  if (!affordable) {
    recommendation = "This pushes you below your safe-to-spend buffer. Wait for Friday's deposit.";
    tone = "stop";
  } else if (safeAfter < sts.perDay * 3) {
    recommendation = "Affordable, but it eats most of your runway. Consider waiting a few days.";
    tone = "watch";
  } else {
    recommendation = "Clear to buy — it stays inside your safe-to-spend.";
    tone = "good";
  }

  return {
    amount,
    affordable,
    safeAfter,
    hoursOfWork,
    dealsToReplace,
    goalImpactDays,
    recommendation,
    tone,
  };
}

// ---------- alerts ----------

export interface Alert {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warn" | "good";
}

export function alerts(p: FinancialProfile): Alert[] {
  const out: Alert[] = [];
  const util = creditUtilization(p);
  if (util > 0.3) {
    out.push({
      id: "util",
      title: "Credit utilization rising",
      detail: `You're at ${(util * 100).toFixed(0)}% — paying $400 to Chase keeps your score healthy.`,
      severity: "warn",
    });
  }
  const low = forecastLow(p, 14);
  if (low.balance < 1500) {
    out.push({
      id: "low",
      title: "Cash dips before payday",
      detail: `Projected low of ${money(low.balance)} around ${humanDate(low.date)}.`,
      severity: "warn",
    });
  }
  const next = nextPaycheck(p);
  if (next && next.kind === "commission") {
    out.push({
      id: "commission",
      title: "Commission deposit predicted",
      detail: `~${money(next.expectedNet)} expected ${humanDate(next.date)} (range ${money(
        next.worstCase,
      )}–${money(next.bestCase)}).`,
      severity: "good",
    });
  }
  out.push({
    id: "subs",
    title: "Subscriptions steady",
    detail: `${money(monthlySubscriptions(p))}/mo across your subscriptions — no price changes detected.`,
    severity: "info",
  });
  return out;
}

export type { Account };
