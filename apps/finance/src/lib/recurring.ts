import type { Bill, BillCadence, Transaction, TxnCategory } from "./types";

// Recurring-bill detection: study real synced transactions, find outflows that
// repeat on a rhythm with a stable amount, and propose them as bills. Pure
// functions — the /api/bills/detect route and EILA's detect_bills tool both
// call detectRecurringBills so there is exactly one brain.

export interface BillCandidate {
  name: string;
  amount: number; // positive — median of observed charges
  category: TxnCategory;
  cadence: BillCadence;
  dayOfMonth?: number;
  occurrences: number;
  lastDate: string; // ISO date of the most recent charge
  confidence: "high" | "medium";
}

/** Collapse merchant noise so "VERIZON WRLS 08221" and "Verizon Wireless" group together. */
export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pos|ach|web|pmt|payment|autopay|debit|withdrawal|purchase)\b/g, " ")
    .replace(/[#*]?\d{3,}/g, " ") // store numbers, reference ids
    .replace(/[^a-z& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3) // first few words carry the identity
    .join(" ");
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function cadenceFromInterval(days: number): BillCadence | null {
  if (days >= 5 && days <= 9) return "weekly";
  if (days >= 12 && days <= 17) return "biweekly";
  if (days >= 25 && days <= 36) return "monthly";
  if (days >= 80 && days <= 100) return "quarterly";
  if (days >= 340 && days <= 390) return "yearly";
  return null;
}

const SUBSCRIPTION_HINTS = /netflix|spotify|hulu|disney|apple|youtube|prime|audible|peacock|paramount|max|icloud|dropbox|adobe|openai|anthropic|gym|fitness/;

// Variable everyday spending — repeat visits to the same grocery store or gas
// station are habits, not bills.
const NON_BILL_CATEGORIES: ReadonlySet<TxnCategory> = new Set([
  "food",
  "restaurants",
  "fuel",
  "amazon",
  "shopping",
  "entertainment",
  "travel",
  "kids",
] as TxnCategory[]);

/** Same merchant if either normalized name leads with the other's first word (4+ chars). */
function matchesKnown(key: string, known: string[]): boolean {
  const first = key.split(" ")[0];
  return known.some((k) => {
    const kFirst = k.split(" ")[0];
    if (k === key) return true;
    return first.length >= 4 && kFirst.length >= 4 && (first === kFirst || key.startsWith(k) || k.startsWith(key));
  });
}

/**
 * Find recurring charges in the transaction history that aren't already bills.
 * Requires 2+ occurrences on a recognizable rhythm with a stable amount.
 */
export function detectRecurringBills(transactions: Transaction[], existingBills: Bill[]): BillCandidate[] {
  const known = existingBills.map((b) => normalizeMerchant(b.name));

  // Group settled outflows by normalized merchant.
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.pending || t.category === "income" || NON_BILL_CATEGORIES.has(t.category)) continue;
    const key = normalizeMerchant(t.name);
    if (!key || matchesKnown(key, known)) continue;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }

  const candidates: BillCandidate[] = [];
  for (const txns of groups.values()) {
    if (txns.length < 2) continue;
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));

    // De-dupe same-day charges (split tenders), then measure the rhythm.
    const dates = [...new Set(sorted.map((t) => t.date))];
    if (dates.length < 2) continue;
    const intervals = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const cadence = cadenceFromInterval(median(intervals));
    if (!cadence) continue;

    // Every interval must roughly agree with the rhythm (±40% of the median).
    const med = median(intervals);
    if (!intervals.every((iv) => Math.abs(iv - med) <= Math.max(3, med * 0.4))) continue;

    // Amount must be stable: within 20% of the median charge (or $2 for small subs).
    const amounts = sorted.map((t) => Math.abs(t.amount));
    const amt = median(amounts);
    const tolerance = Math.max(2, amt * 0.2);
    if (!amounts.every((a) => Math.abs(a - amt) <= tolerance)) continue;

    const last = sorted[sorted.length - 1];
    const isSub = last.category === "subscriptions" || SUBSCRIPTION_HINTS.test(normalizeMerchant(last.name));
    candidates.push({
      name: titleCase(normalizeMerchant(last.name)),
      amount: Math.round(amt * 100) / 100,
      category: isSub && last.category !== "subscriptions" ? "subscriptions" : last.category,
      cadence,
      dayOfMonth: cadence === "monthly" ? Math.min(28, Math.round(median(dates.map((d) => Number(d.slice(8, 10)))))) : undefined,
      occurrences: dates.length,
      lastDate: last.date,
      confidence: dates.length >= 3 ? "high" : "medium",
    });
  }

  // Biggest money first — that's what the user should confirm first.
  return candidates.sort((a, b) => b.amount - a.amount);
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Turn a confirmed candidate into a Bill row for UserConfig. */
export function candidateToBill(c: BillCandidate): Bill {
  return {
    id: `b_auto_${normalizeMerchant(c.name).replace(/ /g, "_")}`,
    name: c.name,
    amount: c.amount,
    category: c.category,
    cadence: c.cadence,
    dayOfMonth: c.dayOfMonth,
    autoDetected: true,
    isSubscription: c.category === "subscriptions" || undefined,
  };
}
