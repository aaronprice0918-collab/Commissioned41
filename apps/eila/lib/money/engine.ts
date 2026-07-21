// Pure money math — ported from MissionOS Finance's engine and re-anchored
// on EILA's own commission forecast instead of a typed-in paycheck list.
// Everything here is a pure function of (MoneyConfig, income expectation,
// today) — no I/O, no side effects, unit-testable.

import type {
  Bill,
  BudgetCategory,
  BudgetMonth,
  CashFlowPoint,
  DailyBudgetInfo,
  LedgerRow,
  MoneyConfig,
  LinkedAccount,
  MerchantRule,
  MonthBill,
  MonthCheck,
  MoneyGoal,
  SafeToSpend,
  SpendEntry,
  SpendingProfile,
  UpcomingBill,
} from "./types";

const DAY = 86_400_000;

function iso(d: Date): string {
  // LOCAL date, never toISOString (UTC) — after 8pm ET the UTC date is
  // tomorrow, which shifted every payday/bill/curve comparison by a day.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Parse a YYYY-MM-DD as a LOCAL date (new Date(string) parses UTC). */
function fromIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function clampDay(day: number, d: Date): number {
  return Math.min(Math.max(1, Math.round(day)), daysInMonth(d));
}

/** What the rep still expects to get paid this month, derived from the
 * commission forecast: likely month-end pay minus what's already banked.
 * The caller passes forecast numbers in so this module stays pure. */
export interface IncomeExpectation {
  /** Net-ish dollars still expected this month (>= 0). */
  remainingThisMonth: number;
  /** ISO date the next check is expected to land. */
  nextCheckDate: string;
  /** Dollars expected on that check. */
  nextCheckAmount: number;
}

/** Normalize the payday setting: reps can be paid several times a month
 * (semi-monthly checks, a wash check on the 10th…). Accepts the legacy
 * single number or an array; returns 1–4 sorted unique days. */
export function resolvePaydays(payday: number | number[] | undefined): number[] {
  const arr = Array.isArray(payday) ? payday : payday != null ? [payday] : [1];
  const clean = [...new Set(arr.map((d) => Math.round(d)).filter((d) => d >= 1 && d <= 31))].sort((a, b) => a - b);
  return clean.length ? clean.slice(0, 4) : [1];
}

export interface ScheduledCheck {
  date: Date;
  /** Expected NET dollars on this specific check. */
  amount: number;
}

/** Pair each payday with ITS check amount. checkNets aligns with the paydays
 * by position AS ENTERED (a wash check on the 10th isn't the same money as
 * the semi-monthly check on the 15th): one net = every check that amount;
 * a count mismatch = every check gets the average (never silently dropped).
 * `fallbackNet` covers the no-nets case (forecast-derived share). */
export function scheduledChecks(
  payday: number | number[] | undefined,
  checkNets: number[] | undefined,
  fallbackNet: number,
  now: Date,
  days: number,
): ScheduledCheck[] {
  const raw = (Array.isArray(payday) ? payday : payday != null ? [payday] : [1])
    .map((d) => Math.round(d))
    .filter((d) => d >= 1 && d <= 31)
    .slice(0, 4);
  const rawDays = raw.length ? raw : [1];
  const nets = (checkNets ?? []).map((n) => Math.round(n)).filter((n) => n > 0);
  const netFor = (i: number): number => {
    if (!nets.length) return fallbackNet;
    if (nets.length === 1) return nets[0];
    if (nets.length === rawDays.length) return nets[i];
    return Math.round(nets.reduce((s, n) => s + n, 0) / nets.length);
  };
  // Pair by entry position FIRST, then dedupe by day (first entry wins) and sort.
  const seen = new Set<number>();
  const pairs: { day: number; net: number }[] = [];
  rawDays.forEach((day, i) => {
    if (!seen.has(day)) { seen.add(day); pairs.push({ day, net: netFor(i) }); }
  });
  pairs.sort((a, b) => a.day - b.day);

  const out: ScheduledCheck[] = [];
  for (let m = 0; m < 2; m++) {
    const anchor = new Date(now.getFullYear(), now.getMonth() + m, 1);
    for (const p of pairs) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth(), clampDay(p.day, anchor));
      if (iso(d) >= iso(now) && d.getTime() < now.getTime() + days * DAY) out.push({ date: d, amount: p.net });
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Build the income expectation from forecast outputs + the payday setting.
 * The month's expected income splits EQUALLY across that month's paydays;
 * the next check is the soonest upcoming one (this month or next). The
 * estimate rides on likelyMonthEndPay or the user's own checkNets. */
export function incomeExpectation(
  likelyMonthEndPay: number,
  payday: number | number[] | undefined,
  now: Date,
  taxRate?: number,
  checkNets?: number[],
): IncomeExpectation {
  const paydays = resolvePaydays(payday);
  const keep = taxRate && taxRate > 0 && taxRate < 100 ? 1 - taxRate / 100 : 1;
  const monthlyNet = Math.round(Math.max(0, likelyMonthEndPay) * keep);
  // The rep's OWN check amounts beat a same-month forecast (this month's
  // checks pay last month's work) — and each payday keeps ITS amount (the
  // wash check on the 10th isn't the semi-monthly check on the 15th).
  const fallback = Math.round(monthlyNet / paydays.length);
  const checks = scheduledChecks(payday, checkNets, fallback, now, 62);
  const next = checks[0];
  const nextDate = next
    ? next.date
    : new Date(now.getFullYear(), now.getMonth() + 1, clampDay(paydays[0], new Date(now.getFullYear(), now.getMonth() + 1, 1)));
  const thisMonth = iso(now).slice(0, 7);
  return {
    remainingThisMonth: checks.filter((c) => iso(c.date).slice(0, 7) === thisMonth).reduce((s, c) => s + c.amount, 0),
    nextCheckDate: iso(nextDate),
    nextCheckAmount: next?.amount ?? fallback,
  };
}

/** Convert any cadence to a monthly-equivalent amount. */
export function monthlyAmount(bill: Bill): number {
  switch (bill.cadence) {
    case "weekly": return (bill.amount * 52) / 12;
    case "biweekly": return (bill.amount * 26) / 12;
    case "quarterly": return bill.amount / 3;
    case "yearly": return bill.amount / 12;
    default: return bill.amount;
  }
}

export function totalMonthlyBills(cfg: MoneyConfig): number {
  return cfg.bills.reduce((s, b) => s + monthlyAmount(b), 0);
}

/** Bills that still land this month, sorted by date. Non-monthly cadences
 * are treated as landing on their monthly-equivalent share only when a
 * dayOfMonth is set; otherwise they're excluded from date math (still in
 * totals). Simple by design — Phase 1 is a planning view, not a ledger. */
export function billsRemaining(cfg: MoneyConfig, now: Date): UpcomingBill[] {
  const out: UpcomingBill[] = [];
  const today = now.getDate();
  for (const b of cfg.bills) {
    // Quarterly/yearly have no anchor MONTH on the Bill shape, so they can't
    // be placed as dated instances — they reach safe-to-spend and the cash
    // curve as an amortized per-day reserve instead (see amortizedMonthly).
    if (b.cadence === "quarterly" || b.cadence === "yearly") continue;
    if (b.cadence === "monthly") {
      const day = clampDay(b.dayOfMonth ?? 1, now);
      if (day >= today) {
        const d = new Date(now.getFullYear(), now.getMonth(), day);
        out.push({ bill: b, date: iso(d), daysAway: Math.round((d.getTime() - now.getTime()) / DAY) });
      }
    } else {
      // weekly/biweekly: instances every 7/14 days from dayOfMonth (or the 1st)
      const step = b.cadence === "weekly" ? 7 : 14;
      let day = clampDay(b.dayOfMonth ?? 1, now);
      const dim = daysInMonth(now);
      while (day <= dim) {
        if (day >= today) {
          const d = new Date(now.getFullYear(), now.getMonth(), day);
          out.push({ bill: b, date: iso(d), daysAway: Math.round((d.getTime() - now.getTime()) / DAY) });
        }
        day += step;
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function billsRemainingTotal(cfg: MoneyConfig, now: Date): number {
  return billsRemaining(cfg, now).reduce((s, u) => s + u.bill.amount, 0);
}

/** Quarterly/yearly bills, as a monthly-equivalent reserve. They can't land
 * as dated hits (no anchor month on the Bill shape), but ignoring them let a
 * $1,200 yearly premium never touch safe-to-spend or the cash curve (July 8
 * audit) — so they ride the same per-day treatment as everyday essentials:
 * the reserve builds continuously, and it's there when the big bill hits. */
function amortizedMonthly(cfg: MoneyConfig): number {
  return cfg.bills
    .filter((b) => b.cadence === "quarterly" || b.cadence === "yearly")
    .reduce((s, b) => s + monthlyAmount(b), 0);
}

/** The core number: what can be spent today without endangering bills,
 * essentials, or a $500 cushion. Mirrors Finance's formula, income side
 * re-anchored on the commission forecast. */
export function safeToSpend(cfg: MoneyConfig, income: IncomeExpectation, now: Date): SafeToSpend | null {
  if (cfg.checkingBalance == null) return null;
  const dim = daysInMonth(now);
  const daysLeft = Math.max(1, dim - now.getDate() + 1);
  const essentialsLeft = ((cfg.monthlyEssentials + amortizedMonthly(cfg)) * daysLeft) / dim;
  const upcomingBills = billsRemainingTotal(cfg, now);
  const cushion = cfg.cushion ?? 1000;
  const available = Math.max(0, cfg.checkingBalance - upcomingBills - essentialsLeft - cushion);
  // ceil, not round: the evening before a payday is still a spending day.
  // round() shrank the divisor and overstated perDay by up to 2× at night.
  const daysToIncome = Math.max(
    1,
    Math.ceil((fromIso(income.nextCheckDate).getTime() - now.getTime()) / DAY),
  );
  const projectedMonthEnd =
    cfg.checkingBalance - upcomingBills - essentialsLeft + income.remainingThisMonth;
  return {
    available: Math.round(available),
    perDay: Math.round(available / daysToIncome),
    projectedMonthEnd: Math.round(projectedMonthEnd),
    daysToIncome,
  };
}

/** Day-by-day projected checking balance for the next `days` days. */
export function cashFlow(
  cfg: MoneyConfig,
  income: IncomeExpectation,
  now: Date,
  days = 30,
): CashFlowPoint[] {
  if (cfg.checkingBalance == null) return [];
  const burnPerDay = (cfg.monthlyEssentials + amortizedMonthly(cfg)) / daysInMonth(now);
  // Collect dated events over the window: bills (this month + rolling into
  // next month) and the next expected check.
  const events = new Map<string, { delta: number; labels: string[] }>();
  const add = (dateIso: string, delta: number, label: string) => {
    const e = events.get(dateIso) ?? { delta: 0, labels: [] };
    e.delta += delta;
    e.labels.push(label);
    events.set(dateIso, e);
  };
  for (let m = 0; m < 2; m++) {
    const monthAnchor = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const from = m === 0 ? now : monthAnchor;
    for (const u of billsRemaining(cfg, from)) add(u.date, -u.bill.amount, `${u.bill.name} −$${Math.round(u.bill.amount)}`);
  }
  // Every expected check in the window, each on its own day AND at its own
  // amount — semi-monthly reps and wash checks land as separate, correctly
  // sized up-ticks, not one lump or a flattened average.
  if (income.nextCheckAmount > 0) {
    for (const c of scheduledChecks(cfg.paydays ?? cfg.payday, cfg.checkNets, income.nextCheckAmount, now, days)) {
      add(iso(c.date), c.amount, `Commission check +$${Math.round(c.amount)}`);
    }
  }

  // Logged spending must LOWER the curve, or the daily allowance rebounds at
  // midnight as if the money was never spent (Aaron's July 10 field report:
  // "the lower my money goes the higher it goes"). But the curve already
  // models everyday burn — so only spending IN EXCESS of the modeled burn
  // since the balance was entered moves the anchor. Groceries inside the
  // burn: no change. A $500 day: the curve drops by what the model missed.
  // Re-entering a fresh balance (balanceAsOf = today) resets the window.
  const asOf = cfg.balanceAsOf ?? iso(now);
  const todayKey = iso(now);
  const spentSinceAsOf = (cfg.spend ?? [])
    .filter((e) => e.date >= asOf && e.date <= todayKey)
    .reduce((t, e) => t + e.amount, 0);
  const staleDays = Math.max(0, Math.floor((now.getTime() - fromIso(asOf).getTime()) / DAY));
  const modeledBurnSinceAsOf = burnPerDay * (staleDays + 1); // incl. today (the loop burns today below)
  const excessSpend = Math.max(0, spentSinceAsOf - modeledBurnSinceAsOf);

  const out: CashFlowPoint[] = [];
  let bal = cfg.checkingBalance - excessSpend;
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = iso(d);
    const e = events.get(key);
    bal += (e?.delta ?? 0) - burnPerDay;
    out.push({ date: key, balance: Math.round(bal), events: e?.labels ?? [] });
  }
  return out;
}

export function cashFlowLow(points: CashFlowPoint[]): CashFlowPoint | null {
  if (!points.length) return null;
  return points.reduce((lo, p) => (p.balance < lo.balance ? p : lo), points[0]);
}

/** What a statement scan found, after server-side sanitizing. */
export interface StatementScan {
  bills: { name: string; amount: number; dayOfMonth: number; isSubscription?: boolean }[];
  monthlySpend: number;
  endingBalance: number;
  /** Combined savings/reserve balance seen on the statements (0 = none shown). */
  savingsBalance?: number;
  /** Closing/period-end date (YYYY-MM-DD) the endingBalance was true — often
   *  weeks before today. Absent when the scan couldn't read it. */
  statementEndDate?: string;
  monthsAnalyzed: number;
  categories: { name: string; monthly: number }[];
}

/** Fold approved scan results into the existing config. Suggest-then-approve:
 * the caller passes only the bills the user KEPT in the review sheet. Dedupes
 * against hand-entered bills by normalized name (a scanned "Netflix" doesn't
 * duplicate a typed "netflix"), refreshes balance/essentials/profile. */
export function applyStatementScan(
  cfg: MoneyConfig,
  scan: StatementScan,
  keptBills: StatementScan["bills"],
  todayIso: string,
  makeId: () => string,
): MoneyConfig {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(com|net|org|inc|llc)$/, "");
  const existing = new Set(cfg.bills.map((b) => norm(b.name)));
  const added: Bill[] = keptBills
    .filter((b) => b.name && b.amount > 0 && !existing.has(norm(b.name)))
    .map((b) => ({
      id: makeId(),
      name: b.name,
      amount: b.amount,
      cadence: "monthly" as const,
      dayOfMonth: b.dayOfMonth,
      isSubscription: !!b.isSubscription,
      autoDetected: true,
    }));
  const profile: SpendingProfile | undefined =
    scan.monthlySpend > 0 || scan.categories.length
      ? {
          avgMonthlySpend: scan.monthlySpend,
          categories: scan.categories,
          monthsAnalyzed: scan.monthsAnalyzed,
          detectedAt: todayIso,
        }
      : cfg.spendingProfile;
  return {
    ...cfg,
    // The statement's ending balance only fills a BLANK balance — a balance
    // the user typed today is fresher than a statement's month-end close.
    checkingBalance: cfg.checkingBalance ?? (scan.endingBalance > 0 ? scan.endingBalance : undefined),
    savingsBalance: cfg.savingsBalance ?? ((scan.savingsBalance ?? 0) > 0 ? scan.savingsBalance : undefined),
    // Stamp the balance as of the STATEMENT's closing date, not today — a
    // statement's month-end close can be weeks stale, and dating it "today"
    // made safe-to-spend treat old cash as current and the UI read "updated
    // today". Fall back to today only when the scan couldn't read the date.
    balanceAsOf: cfg.checkingBalance != null ? cfg.balanceAsOf : scan.endingBalance > 0 ? (scan.statementEndDate ?? todayIso) : cfg.balanceAsOf,
    // Same rule for essentials: scanned average fills a zero, never overwrites.
    monthlyEssentials: cfg.monthlyEssentials > 0 ? cfg.monthlyEssentials : scan.monthlySpend,
    bills: [...cfg.bills, ...added],
    goals: cfg.goals,
    spendingProfile: profile,
  };
}

/** CFO verdict on "can I afford this?" — ported from Finance's decision
 * engine, reframed for commission earners: a purchase costs DEALS, not
 * hours. Judged against the never-go-below FLOOR (Aaron, July 6 2026: the
 * one-shot ceiling exists only as the answer to "can I afford $X today?"),
 * so a "clear" here is the same promise the Daily Budget makes — every
 * projected day ahead stays above the floor. Pure data out; EILA narrates. */
export interface PurchaseVerdict {
  /** "clear" = fits inside safe-to-spend; "tight" = fits but eats most of it
   * or drags the month's low point under $250; "wait" = doesn't fit TODAY but
   * fits once the next check lands (commission money is timing, not wealth);
   * "no" = doesn't fit even with the checks that are coming. */
  verdict: "clear" | "tight" | "no" | "wait";
  amount: number;
  safeAvailable: number;
  /** Safe-to-spend left after the purchase (can be negative). */
  afterPurchase: number;
  /** How many average deals of pay this purchase costs (0 if unknown). */
  dealsOfWork: number;
  /** The month's projected low point if they buy it today. */
  lowAfter: number | null;
  /** The never-go-below floor the verdict was judged against. */
  floor: number;
  daysToIncome: number;
  /** For "wait": ISO date of the check that makes it work. */
  waitUntil?: string;
}

export function evaluatePurchase(
  cfg: MoneyConfig,
  income: IncomeExpectation,
  now: Date,
  amount: number,
  avgPayPerDeal: number,
): PurchaseVerdict | null {
  const sts = safeToSpend(cfg, income, now);
  if (!sts || !(amount > 0)) return null;
  const floor = cfg.cushion ?? 1000;
  const after = sts.available - amount;
  const flowAfter =
    cfg.checkingBalance != null
      ? cashFlow({ ...cfg, checkingBalance: cfg.checkingBalance - amount }, income, now)
      : [];
  const low = cashFlowLow(flowAfter);
  let verdict: PurchaseVerdict["verdict"];
  let waitUntil: string | undefined;
  // "Fits today" = every projected day ahead still clears the FLOOR with the
  // purchase in — the same promise the Daily Budget makes (amount ≤ lumpToday).
  if (after >= 0 && (!low || low.balance >= floor)) {
    verdict = after < sts.available * 0.25 || (low != null && low.balance < floor + 250) ? "tight" : "clear";
  } else {
    // Doesn't fit today. A commission rep isn't broke — money is TIMED. If
    // buying it right after the next check keeps the whole curve above the
    // floor, the honest answer is "wait for the check", not "no". The window
    // must actually REACH that check: a single monthly payday just past put
    // the next one ~31 days out, beyond the default 30-day curve, turning
    // every honest "wait" into a "no" (July 8 audit).
    const daysToCheck = Math.ceil((fromIso(income.nextCheckDate).getTime() - now.getTime()) / DAY);
    const base = cashFlow(cfg, income, now, Math.min(62, Math.max(30, daysToCheck + 7)));
    const deferOk =
      base.length > 0 &&
      base.some((p) => p.date >= income.nextCheckDate) &&
      base.every((p) => (p.date >= income.nextCheckDate ? p.balance - amount : p.balance) >= floor);
    if (deferOk) { verdict = "wait"; waitUntil = income.nextCheckDate; }
    else verdict = "no";
  }
  return {
    verdict,
    amount: Math.round(amount),
    safeAvailable: sts.available,
    afterPurchase: Math.round(after),
    dealsOfWork: avgPayPerDeal > 0 ? Math.round((amount / avgPayPerDeal) * 10) / 10 : 0,
    lowAfter: low ? low.balance : null,
    floor,
    daysToIncome: sts.daysToIncome,
    waitUntil,
  };
}

// ---- Budget vs actual (the Money-tab budget vision, July 6 2026) ----
// Budgets score VARIABLE spend against a plan. They deliberately do NOT feed
// safe-to-spend or the cash curve — those stay anchored on real cash math
// (balance, bills, essentials). The budget is the scorekeeping lens on top.

const normCat = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Spend entries that land in `now`'s calendar month. */
export function monthSpend(cfg: MoneyConfig, now: Date): SpendEntry[] {
  const ym = iso(now).slice(0, 7);
  return (cfg.spend ?? []).filter((e) => e.date.slice(0, 7) === ym);
}

/** The month's budget scorecard: every budgeted category (even untouched
 * ones) plus any category money actually went to that has no budget line —
 * spending never hides just because it wasn't planned. Null until the user
 * has budgets or logged spend (the section stays an invite). */
export function budgetMonth(cfg: MoneyConfig, now: Date): BudgetMonth | null {
  const budgets = cfg.budgets ?? [];
  const spent = monthSpend(cfg, now);
  if (!budgets.length && !spent.length) return null;

  const actualBy = new Map<string, { name: string; actual: number }>();
  for (const e of spent) {
    const key = normCat(e.category || "Other");
    const cur = actualBy.get(key) ?? { name: e.category?.trim() || "Other", actual: 0 };
    cur.actual += e.amount;
    actualBy.set(key, cur);
  }

  const lines = budgets.map((b) => {
    const actual = Math.round(actualBy.get(normCat(b.name))?.actual ?? 0);
    actualBy.delete(normCat(b.name));
    return {
      name: b.name,
      budget: Math.round(b.monthly),
      actual,
      left: Math.round(b.monthly) - actual,
      pct: b.monthly > 0 ? Math.round((actual / b.monthly) * 100) : 0,
    };
  });
  // Unplanned categories ride along with budget 0, sorted biggest first.
  const unplanned = [...actualBy.values()]
    .map((u) => ({ name: u.name, budget: 0, actual: Math.round(u.actual), left: -Math.round(u.actual), pct: 0 }))
    .sort((a, b) => b.actual - a.actual);

  const totalBudget = lines.reduce((s, l) => s + l.budget, 0);
  const totalSpent = Math.round(spent.reduce((s, e) => s + e.amount, 0));
  const leftToSpend = totalBudget - totalSpent;
  const daysLeft = Math.max(1, daysInMonth(now) - now.getDate() + 1);
  return {
    lines: [...lines, ...unplanned],
    totalBudget,
    totalSpent,
    leftToSpend,
    daysLeft,
    perDayLeft: Math.max(0, Math.round(leftToSpend / daysLeft)),
  };
}

/** Log one purchase. Keeps the ledger small (rolling ~3 months) — this is a
 * budget scorecard, not a bank archive. */
export function addSpend(
  cfg: MoneyConfig,
  entry: { amount: number; category: string; note?: string; date?: string; account?: string },
  todayIso: string,
  makeId: () => string,
): MoneyConfig {
  const date = entry.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : todayIso;
  const cutoff = iso(new Date(fromIso(todayIso).getTime() - 92 * DAY));
  const kept = (cfg.spend ?? []).filter((e) => e.date >= cutoff);
  return {
    ...cfg,
    spend: [
      ...kept,
      {
        id: makeId(),
        date,
        amount: Math.round(Math.abs(entry.amount)),
        category: entry.category.trim() || "Other",
        note: entry.note?.trim() || undefined,
        account: entry.account || undefined,
      },
    ],
  };
}

/** Take a logged purchase back out (returned it, fat-fingered it). */
export function removeSpend(cfg: MoneyConfig, id: string): MoneyConfig {
  return { ...cfg, spend: (cfg.spend ?? []).filter((e) => e.id !== id) };
}

/** Add/replace/remove one budget category by (normalized) name. */
export function upsertBudget(cfg: MoneyConfig, name: string, monthly: number | null): MoneyConfig {
  const budgets = (cfg.budgets ?? []).filter((b) => normCat(b.name) !== normCat(name));
  if (monthly != null && monthly > 0) budgets.push({ name: name.trim(), monthly: Math.round(monthly) });
  return { ...cfg, budgets };
}

/** Seed budgets from the scanned spending pattern — one tap from "EILA knows
 * my habits" to "EILA holds me to a plan". Rounded up to a clean $10. */
export function seedBudgetsFromProfile(cfg: MoneyConfig): BudgetCategory[] {
  return (cfg.spendingProfile?.categories ?? [])
    .filter((c) => c.monthly > 0)
    .slice(0, 8)
    .map((c) => ({ name: c.name, monthly: Math.ceil(c.monthly / 10) * 10 }));
}

// ---- The month ledger (dashboard panels: Income / Bills / Debt / summary) ----

/** Every check this CALENDAR month, planned-vs-landed. A check whose day is
 * today counts as landed (it's payday). */
export function monthChecks(cfg: MoneyConfig, income: IncomeExpectation, now: Date): MonthCheck[] {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const fallback = income.nextCheckAmount > 0 ? income.nextCheckAmount : 0;
  return scheduledChecks(cfg.paydays ?? cfg.payday, cfg.checkNets, fallback, first, daysInMonth(now))
    .filter((c) => c.date.getMonth() === now.getMonth())
    .map((c) => ({
      date: iso(c.date),
      day: c.date.getDate(),
      amount: c.amount,
      landed: iso(c.date) <= iso(now),
    }));
}

/** Every dated bill instance this CALENDAR month, landed = day has passed.
 * Same cadence rules as billsRemaining (quarterly/yearly stay out of the
 * dated view); non-debt vs debt is the caller's split. */
export function monthBills(cfg: MoneyConfig, now: Date): MonthBill[] {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return billsRemaining(cfg, first)
    .filter((u) => u.date.slice(0, 7) === iso(now).slice(0, 7))
    .map((u) => ({ bill: u.bill, date: u.date, landed: u.date <= iso(now) }));
}

/** The dashboard's CASH FLOW SUMMARY — budget vs actual for Income /
 * Expenses / Bills / Debt, closed by a Leftover row (income − outflows).
 * Expenses budget = category budgets (or essentials when no budget is set);
 * expenses actual = logged spend. Bills/Debt actual = instances landed. */
export function cashFlowSummary(cfg: MoneyConfig, income: IncomeExpectation, now: Date): LedgerRow[] {
  const checks = monthChecks(cfg, income, now);
  const bm = budgetMonth(cfg, now);
  const instances = monthBills(cfg, now);
  const sum = (xs: number[]) => Math.round(xs.reduce((s, n) => s + n, 0));
  const rows: LedgerRow[] = [
    {
      label: "Income",
      budget: sum(checks.map((c) => c.amount)),
      actual: sum(checks.filter((c) => c.landed).map((c) => c.amount)),
    },
    {
      label: "Expenses",
      budget: bm && bm.totalBudget > 0 ? bm.totalBudget : Math.round(cfg.monthlyEssentials),
      actual: bm ? bm.totalSpent : 0,
    },
    {
      label: "Bills",
      budget: sum(instances.filter((i) => !i.bill.isDebt).map((i) => i.bill.amount)),
      actual: sum(instances.filter((i) => !i.bill.isDebt && i.landed).map((i) => i.bill.amount)),
    },
    {
      label: "Debt",
      budget: sum(instances.filter((i) => i.bill.isDebt).map((i) => i.bill.amount)),
      actual: sum(instances.filter((i) => i.bill.isDebt && i.landed).map((i) => i.bill.amount)),
    },
  ];
  rows.push({
    label: "Leftover",
    budget: rows[0].budget - rows[1].budget - rows[2].budget - rows[3].budget,
    actual: rows[0].actual - rows[1].actual - rows[2].actual - rows[3].actual,
  });
  return rows;
}

// ---- The daily budget ("Daily spending allowance", Aaron's July 6 2026 spec) ----
// How much can go out TODAY with every projected day ahead still clearing
// the floor? The cash curve already carries bills (incl. the pay-yourself
// savings bill), everyday-essentials burn, and every check landing — so the
// answer falls out of it directly:
//  - lumpToday: spending X today lowers EVERY future point by X, so the
//    ceiling is (lowest projected balance − floor).
//  - perDay: spending s every day lowers day i by s·(i+1), so the steady
//    allowance is min over days of (balance_i − floor)/(i+1).
export function dailyBudget(cfg: MoneyConfig, income: IncomeExpectation, now: Date): DailyBudgetInfo | null {
  if (cfg.checkingBalance == null) return null;
  const floor = cfg.cushion ?? 1000;
  const flow = cashFlow(cfg, income, now, 30);
  if (!flow.length) return null;
  let minBal = Infinity;
  let perDay = Infinity;
  let tight: CashFlowPoint = flow[0];
  flow.forEach((p, i) => {
    if (p.balance < minBal) { minBal = p.balance; tight = p; }
    perDay = Math.min(perDay, (p.balance - floor) / (i + 1));
  });
  const todayKey = iso(now);
  const spentToday = Math.round((cfg.spend ?? []).filter((e) => e.date === todayKey).reduce((t, e) => t + e.amount, 0));
  const perDayF = Math.max(0, Math.floor(perDay));
  // floor, not round: a balance entered at 9pm is still TODAY's balance.
  const staleDays = cfg.balanceAsOf
    ? Math.max(0, Math.floor((now.getTime() - fromIso(cfg.balanceAsOf).getTime()) / DAY))
    : 0;
  return {
    perDay: perDayF,
    lumpToday: Math.max(0, Math.round(minBal - floor)),
    floor,
    tightestDate: tight ? tight.date : null,
    tightestBalance: tight ? tight.balance : null,
    spentToday,
    leftToday: Math.max(0, perDayF - spentToday),
    staleDays,
  };
}

/** The pay-yourself savings bill, if one is set up. */
export function payYourselfBill(cfg: MoneyConfig): Bill | null {
  return cfg.bills.find((b) => b.isSavings) ?? null;
}

export function goalProgress(g: MoneyGoal): number {
  if (g.target <= 0) return 0;
  return Math.min(100, Math.round((g.saved / g.target) * 100));
}

// ---- Platinum VIP: applying a live bank sync ----

export interface BankSyncPayload {
  institutions: string[];
  accounts: { name: string; mask: string; type: "checking" | "savings" | "credit" | "other"; balance: number }[];
  checking: number | null;
  savings: number | null;
  transactions: { date: string; name: string; amount: number; account?: string }[];
  asOf: string;
}

const MIN_BANK_BILL_AMOUNT = 5;
const MAX_BANK_DETECTED_BILLS = 20;

const SUBSCRIPTION_WORDS = [
  "adobe",
  "amazon prime",
  "anthropic",
  "apple",
  "audible",
  "chatgpt",
  "claude",
  "disney",
  "dropbox",
  "google",
  "gym",
  "hbo",
  "hulu",
  "icloud",
  "microsoft",
  "netflix",
  "openai",
  "paramount",
  "patreon",
  "peacock",
  "planet fitness",
  "spotify",
  "storage",
  "subscription",
  "youtube",
  "zoom",
];

const DEBT_WORDS = [
  "ally",
  "amex",
  "american express",
  "auto loan",
  "capital one",
  "car payment",
  "card payment",
  "chase card",
  "citi card",
  "credit card",
  "discover",
  "gm financial",
  "honda financial",
  "loan",
  "santander",
  "synchrony",
  "td auto finance",
  "toyota financial",
  "truck payment",
  "ford credit",
  "ford motor",
  "five lakes", // debt-consolidation lender
  "debt consolidation",
];

const HOUSEHOLD_BILL_WORDS = [
  "at&t",
  "att",
  "childcare",
  "comcast",
  "duke energy",
  "electric",
  "geico",
  "insurance",
  "internet",
  "mortgage",
  "power",
  "rent",
  "spectrum",
  "state farm",
  "t-mobile",
  "utility",
  "verizon",
  "water",
  "xfinity",
  "natural gas",
  "georgia natural",
  "flexible finance", // lease/finance company (rent)
];

const VARIABLE_SPEND_WORDS = [
  "airbnb",
  "amazon marketplace",
  "atm",
  "bp",
  "chevron",
  "chick-fil-a",
  "chipotle",
  "coffee",
  "costco",
  "delta",
  "doordash",
  "dunkin",
  "exxon",
  "gas",
  "grocery",
  "hotel",
  "kroger",
  "lyft",
  "mcdonald",
  "publix",
  "qt",
  "quiktrip",
  "restaurant",
  "sam's",
  "shell",
  "shopping",
  "starbucks",
  "target",
  "uber eats",
  "uber trip",
  "walmart",
];

// Money that LEAVES checking but isn't everyday consumption — internal moves
// and credit-card payoffs. Excluded from everyday spend so "money out" isn't
// inflated by cash you still have (savings) or debt already tracked elsewhere.
const TRANSFER_WORDS = [
  "internal transfer",
  "online transfer",
  "transfer to",
  "to savings",
  "savings transfer",
  "xfer",
  "cash app transfer",
  "keep the change", // BofA round-up sweep to savings
];

// Money moved to pay a credit card or another account — a real outflow, but
// debt/transfer, NOT everyday consumption. (When only checking is synced, the
// card PAYMENT is the only signal, so it belongs in Debt, not Everyday.)
const PAYMENT_TRANSFER_WORDS = [
  "payment to crd",
  "payment to card",
  "payment to acct",
  "scheduled payment to",
  "online payment to",
  "mobile banking payment",
  "bill pay to",
];

// Coarse everyday-spend category from a merchant name, so budget-vs-actual has
// useful buckets instead of one "Everyday" lump. Falls back to "Everyday".
const EVERYDAY_CATEGORIES: { category: string; words: string[] }[] = [
  { category: "Gas", words: ["gas", "fuel", "shell", "chevron", "exxon", "bp", "qt", "quiktrip", "marathon", "circle k", "murphy usa", "texaco", "76 gas", "sunoco", "racetrac"] },
  { category: "Groceries", words: ["grocery", "kroger", "publix", "walmart", "target", "costco", "sam's", "aldi", "trader joe", "whole foods", "instacart", "food lion", "sprouts"] },
  { category: "Dining", words: ["restaurant", "mcdonald", "chipotle", "chick-fil-a", "starbucks", "dunkin", "coffee", "doordash", "uber eats", "grubhub", "steakhouse", "cafe", "grill", "pizza", "zaxby", "whataburger", "arby", "panda express", "outback", "buffalo", "wing"] },
  { category: "Travel", words: ["uber trip", "lyft", "delta", "airbnb", "hotel", "airlines", "marriott", "hilton"] },
];

// Find the learned rule for a merchant, if the member taught the app one.
function matchMerchantRule(name: string, rules?: MerchantRule[]): MerchantRule | undefined {
  if (!rules?.length) return undefined;
  const key = bankBillCompact(bankBillKey(name));
  return rules.find((r) => {
    const rk = bankBillCompact(r.key);
    return rk.length >= 3 && (key === rk || key.includes(rk) || rk.includes(key));
  });
}

function everydayCategoryFor(name: string, rules?: MerchantRule[]): string {
  const rule = matchMerchantRule(name, rules);
  if (rule?.kind === "everyday" && rule.category) return rule.category;
  for (const { category, words } of EVERYDAY_CATEGORIES) {
    if (hasBankWord(name, words)) return category;
  }
  return "Everyday";
}

// A Zelle/transfer/payment to the account holder's OWN name is moving money
// between their accounts, not spending. Paying another person still counts as
// spend (the member's rule). Needs the holder's name, so it's best-effort.
function isSelfTransfer(name: string, holderName?: string): boolean {
  if (!holderName) return false;
  const holder = bankBillCompact(holderName);
  if (holder.length < 4) return false;
  if (!hasBankWord(name, ["zelle", "transfer", "payment to", "ext trnsfr"])) return false;
  return bankBillCompact(name).includes(holder);
}

// True when a bank outflow is real everyday consumption — NOT a bill, debt
// payment, subscription, internal transfer, credit-card payoff, a self-transfer,
// or a known named bill. This is the money that was silently vanishing: counted
// against the balance but never against "money out".
function isEverydaySpend(name: string, knownBills: Bill[], holderName?: string, rules?: MerchantRule[]): boolean {
  // A learned rule ALWAYS wins — it's the member's explicit correction.
  const rule = matchMerchantRule(name, rules);
  if (rule) return rule.kind === "everyday";
  if (hasBankWord(name, DEBT_WORDS)) return false;
  if (hasBankWord(name, HOUSEHOLD_BILL_WORDS)) return false;
  if (hasBankWord(name, SUBSCRIPTION_WORDS)) return false;
  if (hasBankWord(name, TRANSFER_WORDS)) return false;
  if (hasBankWord(name, PAYMENT_TRANSFER_WORDS)) return false;
  if (isSelfTransfer(name, holderName)) return false;
  if (knownBills.some((b) => sameBankBillName(b.name, name))) return false;
  return true;
}

// Rebuild the bank-derived everyday spend from a transaction window. Only real
// outflows within the last 92 days, deduped by a stable per-transaction id so
// re-syncing replaces (never duplicates) and manual logs are untouched.
function everydaySpendFromBank(
  transactions: BankSyncPayload["transactions"],
  knownBills: Bill[],
  nowISO: string,
  holderName?: string,
  rules?: MerchantRule[],
): SpendEntry[] {
  const cutoff = iso(new Date(fromIso(nowISO.slice(0, 10)).getTime() - 92 * DAY));
  const out: SpendEntry[] = [];
  let seq = 0;
  for (const tx of transactions) {
    if (!tx.name || tx.amount >= 0) continue; // income/refunds are positive
    const amount = Math.round(Math.abs(tx.amount));
    if (amount < 1) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date) || tx.date < cutoff) continue;
    if (!isEverydaySpend(tx.name, knownBills, holderName, rules)) continue;
    out.push({
      id: `bank-tx-${seq++}-${bankBillCompact(tx.name).slice(0, 32)}`,
      date: tx.date,
      amount,
      category: everydayCategoryFor(tx.name, rules),
      note: bankBillDisplayName(tx.name),
      source: "bank",
      // Carry the source account through from the stored transaction, so the
      // spend line keeps showing which bank it came out of after every recompute.
      account: tx.account,
    });
  }
  return out;
}

function bankBillCompact(input: string): string {
  return input.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function bankBillKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pos|debit|card|purchase|recurring|autopay|auto pay|online|web|ach|withdrawal|bill pay)\b/g, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/\b(com|net|org|inc|llc|corp|corporation)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function hasBankWord(name: string, words: string[]): boolean {
  const compact = bankBillCompact(name);
  return words.some((word) => compact.includes(bankBillCompact(word)));
}

function bankBillDisplayName(name: string): string {
  const cleaned = name
    .replace(/\b(pos|debit|purchase|recurring|autopay|auto pay|online|web|ach|withdrawal)\b/gi, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\.(com|net|org)\b/gi, " ")
    .replace(/[^a-z0-9&'+ -]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || name.trim();
  if (base === base.toUpperCase()) {
    return base
      .toLowerCase()
      .replace(/\b\w/g, (m) => m.toUpperCase())
      .replace(/\bAt&T\b/g, "AT&T")
      .replace(/\bHbo\b/g, "HBO");
  }
  return base;
}

function sameBankBillName(a: string, b: string): boolean {
  const left = bankBillCompact(bankBillKey(a));
  const right = bankBillCompact(bankBillKey(b));
  return left === right || (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left)));
}

function average(nums: number[]): number {
  return nums.reduce((sum, n) => sum + n, 0) / Math.max(1, nums.length);
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}

function amountClusters<T extends { amount: number }>(items: T[]): T[][] {
  const clusters: T[][] = [];
  for (const item of [...items].sort((a, b) => a.amount - b.amount)) {
    const cluster = clusters.find((c) => Math.abs(item.amount - average(c.map((x) => x.amount))) <= Math.max(2, item.amount * 0.12));
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }
  return clusters;
}

function detectRecurringBankBills(transactions: BankSyncPayload["transactions"]): Bill[] {
  type Tx = { amount: number; date: string; day: number; month: string; name: string; key: string };
  const groups = new Map<string, Tx[]>();

  for (const tx of transactions) {
    if (!tx.name || tx.amount > -MIN_BANK_BILL_AMOUNT) continue;
    const date = fromIso(tx.date);
    if (Number.isNaN(date.getTime())) continue;
    const key = bankBillKey(tx.name);
    if (key.length < 3) continue;
    const item: Tx = {
      amount: Math.abs(tx.amount),
      date: tx.date,
      day: date.getDate(),
      month: tx.date.slice(0, 7),
      name: tx.name,
      key,
    };
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const bills: Bill[] = [];
  for (const [key, items] of groups) {
    const sampleName = items[0]?.name ?? key;
    const isSubscriptionWord = hasBankWord(sampleName, SUBSCRIPTION_WORDS);
    const isDebt = hasBankWord(sampleName, DEBT_WORDS);
    const isHousehold = hasBankWord(sampleName, HOUSEHOLD_BILL_WORDS);
    const isVariableSpend = hasBankWord(sampleName, VARIABLE_SPEND_WORDS);
    if (isVariableSpend && !(isSubscriptionWord || isDebt || isHousehold)) continue;

    for (const cluster of amountClusters(items)) {
      const byMonth = new Map<string, Tx[]>();
      cluster.forEach((tx) => byMonth.set(tx.month, [...(byMonth.get(tx.month) ?? []), tx]));
      if (byMonth.size < 2) continue;
      if ([...byMonth.values()].some((monthItems) => monthItems.length > 1)) continue;

      const amounts = cluster.map((tx) => tx.amount);
      const days = cluster.map((tx) => tx.day);
      const avg = average(amounts);
      const amountSpread = Math.max(...amounts) - Math.min(...amounts);
      const daySpread = Math.max(...days) - Math.min(...days);
      const looksLikeKnownBill = isSubscriptionWord || isDebt || isHousehold;
      const amountIsStable = amountSpread <= Math.max(6, avg * 0.18);
      const dayIsStable = daySpread <= 7;
      if (!looksLikeKnownBill && (!amountIsStable || !dayIsStable)) continue;

      const dayOfMonth = Math.min(31, Math.max(1, Math.round(median(days))));
      const display = bankBillDisplayName(sampleName);
      bills.push({
        id: `bank-bill-${key.slice(0, 56)}-${dayOfMonth}`,
        name: display,
        amount: Math.round(avg * 100) / 100,
        cadence: "monthly",
        dayOfMonth,
        isSubscription: isSubscriptionWord || (!isDebt && !isHousehold),
        isDebt: isDebt || undefined,
        autoDetected: true,
      });
    }
  }

  return bills
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
    .slice(0, MAX_BANK_DETECTED_BILLS);
}

function addMissingBankBills(existing: Bill[], detected: Bill[]): Bill[] {
  const missing = detected.filter((bill) => !existing.some((known) => sameBankBillName(known.name, bill.name) || known.id === bill.id));
  return missing.length ? [...existing, ...missing] : existing;
}

/**
 * Fold a Plaid sync into the member's money config. Balances become the new
 * anchor (same fields the hand-typed ritual sets, so every downstream number —
 * safe-to-spend, cash flow, daily budget — just works). Savings stays its own
 * bucket. Bank truth wins over stale hand entry, and repeated monthly outflows
 * become missing bills so quiet drafts do not keep sneaking past the forecast.
 */
export function applyBankSync(cfg: MoneyConfig, sync: BankSyncPayload, nowISO: string, holderName?: string): MoneyConfig {
  const next: MoneyConfig = { ...cfg };
  if (holderName) next.accountHolder = holderName;
  if (sync.checking != null) next.checkingBalance = Math.round(sync.checking * 100) / 100;
  if (sync.savings != null) next.savingsBalance = Math.round(sync.savings * 100) / 100;
  next.balanceAsOf = sync.asOf;
  next.bank = {
    institutions: sync.institutions,
    lastSync: nowISO,
    accounts: sync.accounts,
  };
  next.bankTransactions = sync.transactions.slice(0, 200);
  // Merchant rules are the ONE brain: don't auto-detect a bill the member said
  // isn't one, and honor "this is debt" on the ones we do keep.
  const detected = detectRecurringBankBills(sync.transactions).filter((b) => {
    const r = matchMerchantRule(b.name, cfg.merchantRules);
    return !(r && (r.kind === "everyday" || r.kind === "ignore"));
  });
  next.bills = applyRulesToBills(addMissingBankBills(cfg.bills, detected), cfg.merchantRules);
  // Everyday spend from the feed. Without this, variable purchases (gas,
  // groceries, dining, shopping) hit the balance but never "money out", so the
  // budget shows $0 spent while the account is actually empty. Bills/debt are
  // excluded here (they're counted as landed bill instances) using the merged
  // bill set, so nothing is double-counted. Manual logs are kept as-is; only
  // the bank-derived slice is rebuilt each sync.
  const manualSpend = (cfg.spend ?? []).filter((e) => e.source !== "bank");
  const bankSpend = everydaySpendFromBank(sync.transactions, next.bills, nowISO, holderName, cfg.merchantRules);
  next.spend = [...manualSpend, ...bankSpend];
  return next;
}

// ---- Multi-account (every bank in one picture) ----

const sumBy = (accts: LinkedAccount[], type: LinkedAccount["type"]) =>
  Math.round(accts.filter((a) => a.type === type).reduce((s, a) => s + (Number.isFinite(a.balance) ? a.balance : 0), 0) * 100) / 100;

/** Set the full list of accounts and DERIVE the aggregate balances, so the whole
 * engine (safe-to-spend, cash flow, daily budget) runs on the real total across
 * every bank instead of one connected account. Checking = sum of checking;
 * savings = sum of savings; credit/loan are the debt side (not spendable). */
export function setLinkedAccounts(cfg: MoneyConfig, accounts: LinkedAccount[], nowISO: string): MoneyConfig {
  const next: MoneyConfig = { ...cfg, linkedAccounts: accounts };
  if (accounts.some((a) => a.type === "checking")) next.checkingBalance = sumBy(accounts, "checking");
  if (accounts.some((a) => a.type === "savings")) next.savingsBalance = sumBy(accounts, "savings");
  next.balanceAsOf = nowISO.slice(0, 10);
  return next;
}

/** The whole-life account rollup for display: totals per bucket + the list. */
export function accountsSummary(cfg: MoneyConfig): {
  checking: number; savings: number; liquid: number; debt: number;
  accounts: LinkedAccount[];
} {
  const accts = cfg.linkedAccounts ?? [];
  const checking = sumBy(accts, "checking");
  const savings = sumBy(accts, "savings");
  const debt = Math.round((sumBy(accts, "credit") + sumBy(accts, "loan")) * 100) / 100;
  return { checking, savings, liquid: Math.round((checking + savings) * 100) / 100, debt, accounts: accts };
}

/** Find one linked account by id. */
export function findAccount(cfg: MoneyConfig, accountId?: string): LinkedAccount | undefined {
  if (!accountId) return undefined;
  return (cfg.linkedAccounts ?? []).find((a) => a.id === accountId);
}

/** A short, human label for the account a charge came from — e.g.
 * "Bank of America · Checking ····8714". Returns undefined when the account
 * isn't known/linked, so the UI can show a "Set account" affordance instead. */
export function accountLabelFor(cfg: MoneyConfig, accountId?: string): string | undefined {
  const a = findAccount(cfg, accountId);
  if (!a) return undefined;
  const tail = a.mask ? ` ····${a.mask}` : "";
  return `${a.institution} · ${a.name}${tail}`;
}

/** Tell the app which account a charge came out of — the "which bank was this?"
 * write path. For a synced line it stamps the source account onto every stored
 * transaction from that merchant (so it survives every recompute and applies to
 * past + future charges from it), then re-derives the bank spend. For a
 * hand-logged entry it just sets the account on that one entry. Passing a falsy
 * accountId clears the attribution. Mirrors the merchant-rule "learn once"
 * model so a correction only happens once. */
export function setSpendAccount(
  cfg: MoneyConfig,
  entry: { id: string; source?: "bank"; note?: string; category: string },
  accountId: string | undefined,
  nowISO: string,
): MoneyConfig {
  const account = accountId || undefined;
  if (entry.source === "bank") {
    const key = merchantKeyFor(entry.note || entry.category);
    if (key.length < 3 || !cfg.bankTransactions?.length) {
      // No durable transaction to stamp — fall back to setting this one entry.
      return { ...cfg, spend: (cfg.spend ?? []).map((e) => (e.id === entry.id ? { ...e, account } : e)) };
    }
    const bankTransactions = cfg.bankTransactions.map((tx) =>
      merchantKeyFor(tx.name) === key ? { ...tx, account } : tx,
    );
    return recomputeBankSpend({ ...cfg, bankTransactions }, nowISO);
  }
  return { ...cfg, spend: (cfg.spend ?? []).map((e) => (e.id === entry.id ? { ...e, account } : e)) };
}

// The merchant key used for a learned rule — same normalization the matcher
// uses, so a rule set from any one charge catches every charge from that name.
export function merchantKeyFor(name: string): string {
  return bankBillCompact(bankBillKey(name));
}

// Apply merchant rules to a bill set — the same brain that governs everyday
// spend also governs bills: drop an AUTO-detected bill the member reclassified
// as everyday/ignore (a hand-added bill is theirs to keep), and mark a
// rule-flagged debt as debt.
function applyRulesToBills(bills: Bill[], rules?: MerchantRule[]): Bill[] {
  if (!rules?.length) return bills;
  const out: Bill[] = [];
  for (const b of bills) {
    const rule = matchMerchantRule(b.name, rules);
    if (rule && (rule.kind === "everyday" || rule.kind === "ignore")) {
      if (b.autoDetected) continue; // member said it's not a bill
      out.push(b);
    } else if (rule && rule.kind === "debt") {
      out.push({ ...b, isDebt: true });
    } else {
      out.push(b);
    }
  }
  return out;
}

/**
 * Teach the app what a merchant's charges really are — the "always learning"
 * write path. Upserts one rule (keyed by merchant) and INSTANTLY re-derives the
 * bank-spend slice from the stored transactions, so a tap or an EILA correction
 * updates every past and future charge with no re-sync. kind "remove" forgets
 * the rule (back to auto-detection).
 */
export function setMerchantRule(
  cfg: MoneyConfig,
  merchantName: string,
  kind: MerchantRule["kind"] | "remove",
  category: string | undefined,
  nowISO: string,
  opts?: { amount?: number; date?: string },
): MoneyConfig {
  const key = merchantKeyFor(merchantName);
  if (key.length < 3) return cfg;
  const others = (cfg.merchantRules ?? []).filter((r) => merchantKeyFor(r.key) !== key);
  const merchantRules =
    kind === "remove"
      ? others
      : [...others, { key, label: bankBillDisplayName(merchantName), kind, category: kind === "everyday" ? category : undefined }];

  // Keep the bills list in lockstep with the rule (the ONE brain).
  const matches = (b: Bill) => merchantKeyFor(b.name) === key || sameBankBillName(b.name, merchantName);
  let bills = cfg.bills;
  if (kind === "everyday" || kind === "ignore") {
    // Not a bill — drop any auto-detected bill so it stops showing there. (The
    // recompute below then counts it as everyday, or ignores it entirely.)
    bills = bills.filter((b) => !(b.autoDetected && matches(b)));
  } else if (kind === "bill" || kind === "debt") {
    if (bills.some(matches)) {
      // Already tracked — just make sure the debt flag matches.
      bills = bills.map((b) => (matches(b) ? { ...b, isDebt: kind === "debt" ? true : b.isDebt } : b));
    } else if (opts?.amount && opts.amount > 0) {
      // Reclassified from a real charge — create the bill so "money out" still
      // counts it (as a bill/debt), instead of it vanishing from the picture.
      const day = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? Math.min(31, Math.max(1, Number(opts.date.slice(8, 10)))) : 1;
      bills = [...bills, {
        id: `rule-bill-${key.slice(0, 48)}`,
        name: bankBillDisplayName(merchantName),
        amount: Math.round(Math.abs(opts.amount) * 100) / 100,
        cadence: "monthly",
        dayOfMonth: day,
        isDebt: kind === "debt" ? true : undefined,
        autoDetected: true,
      }];
    }
  }

  const withRule: MoneyConfig = { ...cfg, merchantRules, bills };
  return recomputeBankSpend(withRule, nowISO);
}

/** Re-run bank-spend classification over the stored transactions with the
 * current rules/bills — used after a rule change so the dashboard updates now. */
export function recomputeBankSpend(cfg: MoneyConfig, nowISO: string): MoneyConfig {
  const txns = cfg.bankTransactions;
  if (!txns?.length) return cfg;
  const manualSpend = (cfg.spend ?? []).filter((e) => e.source !== "bank");
  const bankSpend = everydaySpendFromBank(txns, cfg.bills, nowISO, cfg.accountHolder, cfg.merchantRules);
  return { ...cfg, spend: [...manualSpend, ...bankSpend] };
}
