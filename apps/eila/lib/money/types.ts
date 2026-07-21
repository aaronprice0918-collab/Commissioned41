// The Money area — EILA's CFO side, ported from MissionOS Finance (July 5,
// 2026 founder decision: one fluid app; Finance's brain moves in here, the
// separate app retires). Phase 1 runs entirely on what the rep tells EILA
// plus her own commission forecast — no bank connection required. Bank data
// (Plaid) can hydrate the same shapes later without a model change.

export type BillCadence = "monthly" | "weekly" | "biweekly" | "quarterly" | "yearly";

export interface Bill {
  id: string;
  name: string;
  /** Positive number — it's an outflow. */
  amount: number;
  cadence: BillCadence;
  /** Day of month (1–31) the charge typically lands, for monthly bills. */
  dayOfMonth?: number;
  isSubscription?: boolean;
  /** True when this bill is a debt payment (card, loan, truck note) — shown
   * in the dashboard's DEBT panel instead of BILLS. */
  isDebt?: boolean;
  /** True when this bill is PAYING YOURSELF — a savings transfer treated as
   * a mandatory bill in every calculation (Aaron, July 6 2026: "paying
   * myself has to be a bill"). */
  isSavings?: boolean;
  /** True when EILA found it on a scanned bank statement (vs typed by hand). */
  autoDetected?: boolean;
}

/** EILA's read of spending habits from scanned bank statements — the Plaid
 * bridge. Refreshed whenever the user scans statements again. */
export interface SpendingProfile {
  /** Average monthly variable spend OUTSIDE named bills (food, fuel, life). */
  avgMonthlySpend: number;
  categories: { name: string; monthly: number }[];
  monthsAnalyzed: number;
  /** ISO date of the scan. */
  detectedAt: string;
}

/** A monthly spending budget for one variable-spend category (Food, Gas,
 * Fun…). Bills are NOT budget categories — they're tracked exactly. */
export interface BudgetCategory {
  name: string;
  /** Planned spend per month, dollars. */
  monthly: number;
}

/** One logged real-world purchase — the "actual" side of budget vs actual.
 * Logged by the user on the Money tab or by EILA mid-conversation. */
export interface SpendEntry {
  id: string;
  /** ISO date (YYYY-MM-DD) the money was spent. */
  date: string;
  amount: number;
  category: string;
  note?: string;
  /** "bank" when auto-derived from a synced transaction (rebuilt on every
   * sync); absent for entries the user or EILA logged by hand (preserved). */
  source?: "bank";
}

export interface MoneyGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
  /** ISO target date (optional — some goals are open-ended). */
  targetDate?: string;
  emoji?: string;
}

export interface MoneyConfig {
  /** Rep-entered checking balance — the anchor for safe-to-spend and the
   * cash-flow curve. Optional: without it Money still tracks bills/goals. */
  checkingBalance?: number;
  /** ISO date the balance was last updated (staleness surfacing). */
  balanceAsOf?: string;
  /** Money already saved, across savings/reserve accounts — its OWN bucket
   * (field report, July 7 2026: statement upload understated a rep's real
   * liquid position by ignoring savings). Shown separately, counted in the
   * full liquid picture, deliberately NOT poured into safe-to-spend or the
   * daily budget — saved money stays saved. */
  savingsBalance?: number;
  /** Day of month the commission check lands (1–31). Legacy single value —
   * kept for stored data; `paydays` wins when both exist. */
  payday?: number;
  /** Days of month checks land (1–31 each, up to 4) — semi-monthly reps get
   * two, plus e.g. a wash check on the 10th. */
  paydays?: number[];
  /** Known NET amount per check, aligned with paydays (one value = every
   * check). When set, income uses THESE — the rep knows their checks better
   * than a same-month forecast does (this month's check pays LAST month's
   * work). Absent = fall back to the forecast-derived estimate. */
  checkNets?: number[];
  /** The never-go-below floor: dollars that must remain AVAILABLE in
   * checking at every projected point ahead — after bills, after the
   * pay-yourself savings bill, after everyday burn. Default 1000. */
  cushion?: number;
  /** Must-pay monthly spend outside named bills (groceries, gas, life). */
  monthlyEssentials: number;
  bills: Bill[];
  goals: MoneyGoal[];
  /** Monthly budget per variable-spend category — the PLAN side of budget
   * vs actual. Optional: no budgets = the budget section stays an invite. */
  budgets?: BudgetCategory[];
  /** Logged purchases (rolling ~3 months) — the ACTUAL side. */
  spend?: SpendEntry[];
  /** Set by the bank-statement scan; feeds EILA's habit awareness. */
  spendingProfile?: SpendingProfile;
  /** Live bank connection (Platinum VIP): written by a Plaid sync, replaces
   * the hand-typed balance ritual. Presence = connected. */
  bank?: {
    institutions: string[];
    lastSync: string; // ISO datetime
    accounts: { name: string; mask: string; type: "checking" | "savings" | "credit" | "other"; balance: number }[];
  };
  /** Recent settled bank activity from the last sync (newest first, outflows
   * negative) — EILA's ground truth for "where did it go". */
  bankTransactions?: { date: string; name: string; amount: number }[];
  /** The account holder's name (from their profile at sync time) — lets a
   * re-classify recompute still catch Zelle/transfers to themselves. */
  accountHolder?: string;
  /** Every account across every bank the member has — the multi-account
   * picture. When present, checkingBalance/savingsBalance are DERIVED as the
   * sum of the checking/savings accounts here (so the whole engine runs on the
   * real total, not one connected account). Credit/loan balances are the debt
   * side, shown separately. */
  linkedAccounts?: LinkedAccount[];
  /** What the member (or EILA) taught the app about a merchant — applied to
   * every past AND future transaction from it, so a correction only happens
   * once. This is the "always learning" layer. */
  merchantRules?: MerchantRule[];
}

/** One account at one bank — checking, savings, a card, or a loan. */
export interface LinkedAccount {
  id: string;
  /** Bank/credit-union name, e.g. "LGE Credit Union". */
  institution: string;
  /** Account nickname, e.g. "High Rewards Checking". */
  name: string;
  /** Last 4, for display. */
  mask?: string;
  type: "checking" | "savings" | "credit" | "loan" | "other";
  /** Dollars. For checking/savings: what you have. For credit/loan: what you
   * OWE (stored positive; it's the debt side). */
  balance: number;
  /** ISO date the balance was last confirmed. */
  updatedAt?: string;
}

/** A learned correction for one merchant: "these charges are actually X."
 * Tapping a synced line (or telling EILA) writes one of these; every sync then
 * classifies that merchant this way automatically. */
export interface MerchantRule {
  /** Normalized merchant key (matches how transactions are keyed). */
  key: string;
  /** Friendly merchant name to show the member. */
  label: string;
  /** What this merchant's charges really are:
   *  - "everyday": real spending (optionally with a category)
   *  - "bill": a recurring bill (kept out of everyday)
   *  - "debt": a loan/card payment (kept out of everyday)
   *  - "ignore": not spending at all (transfer between own accounts) */
  kind: "everyday" | "bill" | "debt" | "ignore";
  /** For "everyday": which bucket (Groceries, Gas, Dining, Fun…). */
  category?: string;
}

export function defaultMoneyConfig(): MoneyConfig {
  return { monthlyEssentials: 0, bills: [], goals: [] };
}

// ---- computed shapes the engine returns ----

export interface UpcomingBill {
  bill: Bill;
  /** ISO date this instance lands. */
  date: string;
  daysAway: number;
}

export interface SafeToSpend {
  /** Dollars spendable today without touching bills/essentials/cushion. */
  available: number;
  /** available spread across days until the next paycheck. */
  perDay: number;
  /** Projected checking balance at month end. */
  projectedMonthEnd: number;
  /** Days until the next expected commission check. */
  daysToIncome: number;
}

export interface CashFlowPoint {
  /** ISO date. */
  date: string;
  /** Projected checking balance end of that day. */
  balance: number;
  /** What lands that day, for the chart tooltip ("Rent −$1,800"). */
  events: string[];
}

export interface MoneyBriefLine {
  text: string;
  tone: "good" | "neutral" | "watch";
}

/** One category's month scorecard — plan, actual, what's left. */
export interface BudgetLine {
  name: string;
  budget: number;
  actual: number;
  /** budget − actual; negative = over. */
  left: number;
  /** Percent of budget spent (0 when no budget set for the category). */
  pct: number;
}

/** One check this calendar month — planned amount + whether it landed yet. */
export interface MonthCheck {
  /** ISO date the check lands/landed. */
  date: string;
  day: number;
  amount: number;
  landed: boolean;
}

/** One bill instance this calendar month — landed = its day has passed. */
export interface MonthBill {
  bill: Bill;
  date: string;
  landed: boolean;
}

/** One row of the dashboard's cash-flow summary (budget vs actual). */
export interface LedgerRow {
  label: "Income" | "Expenses" | "Bills" | "Debt" | "Leftover";
  budget: number;
  actual: number;
}

/** The month's budget picture — the screenshot-vision numbers ("left to
 * spend", "days left", budget vs actual per category). */
export interface BudgetMonth {
  lines: BudgetLine[];
  totalBudget: number;
  totalSpent: number;
  /** totalBudget − totalSpent; negative = the month is over budget. */
  leftToSpend: number;
  /** Calendar days left in the month, today included. */
  daysLeft: number;
  /** Spendable per remaining day to land on budget (0 when over). */
  perDayLeft: number;
}

/** Today's guilt-free number — how much can be spent right now with every
 * future day still clearing the floor. */
export interface DailyBudgetInfo {
  /** Steady allowance: spend this much EVERY day and never breach the floor. */
  perDay: number;
  /** Blow-it-once ceiling: the most that can go out today alone. */
  lumpToday: number;
  floor: number;
  /** The projected day the money runs tightest (the binding constraint). */
  tightestDate: string | null;
  tightestBalance: number | null;
  /** Logged spend dated today. */
  spentToday: number;
  /** perDay − spentToday, floored at 0 — allowance left to spend today. */
  leftToday: number;
  /** Days since the balance was last updated (0 = today). */
  staleDays: number;
}
