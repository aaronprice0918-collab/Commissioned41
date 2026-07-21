// Bridges the app's deals to the universal pay-plan engine.
import { Deal, DealStatus, STATUS_WEIGHT } from "./types";
import { PayPlan, PayResult, PerfInput } from "./payplan/types";
import { calculatePay } from "./payplan/calc";

export { money } from "./payplan/calc";
export { calculatePay };

// ---- dates ----
export function monthBounds(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysInMonth = end.getDate();
  const dayOfMonth = Math.min(now.getDate(), daysInMonth);
  return { daysInMonth, dayOfMonth, daysRemaining: daysInMonth - dayOfMonth };
}
export function isThisMonth(iso: string, now = new Date()) {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}
// Deal dates are stored as full UTC ISO timestamps (toISOString at log time),
// but every human bucket — "this month", "by the 15th", "today" — means the
// REP'S LOCAL calendar. Never slice() a deal date for day/month math: an
// evening deal in a US timezone carries TOMORROW'S UTC date and lands in the
// wrong bucket (July 8 audit — the month-end report disagreed with the
// dashboard about which month a 9pm July-31 deal belonged to).
export function localMonthKey(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function localDayKey(iso: string | Date = new Date()): string {
  const d = new Date(iso);
  return `${localMonthKey(d)}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---- display totals (units / gross / per-unit / add-ons-per-unit) ----
// `primary`/`secondary` are the deal's two money channels — labeled per
// industry by lib/industry.ts (auto: front/back gross; most industries use
// primary only). `avgSecondary` is the auto-world PVR (back gross per unit).
// isProductOnly lives in ./productOnly (dependency-free, shared by fni/spiffs/pay).
// Imported for engine's own use and re-exported so existing engine importers work.
import { isProductOnly } from "./productOnly";
export { isProductOnly };

export interface DealTotals { units: number; primary: number; secondary: number; gross: number; addons: number; perUnit: number; addonsPerUnit: number; avgSecondary: number }
export function dealTotals(deals: Deal[]): DealTotals {
  // Units = core sales only. Product-only deals are excluded from the count, but
  // their money + add-ons remain in the sums below, so they raise the per-unit
  // averages (PVR/PPU) instead of diluting them with a phantom unit.
  const units = deals.filter((d) => !isProductOnly(d)).length;
  const primary = sum(deals, (d) => d.amount);
  const secondary = sum(deals, (d) => d.secondary);
  const addons = sum(deals, (d) => d.addons);
  const gross = primary + secondary;
  return { units, primary, secondary, gross, addons, perUnit: units ? gross / units : 0, addonsPerUnit: units ? addons / units : 0, avgSecondary: units ? secondary / units : 0 };
}

// ---- deals → monthly performance input ----
// The pay engine keeps its own channel names (frontGross/backGross) — they're
// the PLAN's primary/secondary channels, mapped here from the neutral deal
// fields. Some measured metrics still come from settings/reporting, but VSC
// penetration is knowable when F&I deals carry product picks.
const VSC_PRODUCT_ID = "vsc";

function productPenetration(deals: Deal[], productId: string): number | undefined {
  // Penetration is "% of CARS carrying this product" — product-only deals aren't
  // cars, so they're out of both the numerator and denominator.
  const cars = deals.filter((d) => !isProductOnly(d));
  if (!cars.length) return undefined;
  if (!cars.some((d) => Array.isArray(d.products))) return undefined;
  return (cars.filter((d) => d.products?.includes(productId)).length / cars.length) * 100;
}

export function perfFromDeals(deals: Deal[]): PerfInput {
  const t = dealTotals(deals);
  // Deal rows ride along so perDeal rules pay each deal on ITS OWN gross —
  // a loser deal pays the plan's mini instead of dragging the month down.
  // Product-only deals (no core sale) aren't per-car rows.
  const dealRows = deals.filter((d) => !isProductOnly(d)).map((d) => ({ front: d.amount, category: d.category || undefined }));
  const vscPenetration = productPenetration(deals, VSC_PRODUCT_ID);
  return {
    units: t.units, frontGross: t.primary, backGross: t.secondary, products: t.addons, dealRows, fastStartUnits: fastStart(deals),
    ...(vscPenetration !== undefined ? { vscPenetration } : {}),
  };
}

// Units delivered by the 15th — fast-start bonuses gate on this. LOCAL day:
// slicing the UTC string pushed evening deals onto tomorrow's date.
function fastStart(deals: Deal[]): number {
  return deals.filter((d) => !isProductOnly(d) && new Date(d.date).getDate() <= 15).length;
}

function scaledPerf(deals: Deal[], factor: number): PerfInput {
  const t = dealTotals(deals);
  const dealRows = deals.filter((d) => !isProductOnly(d)).map((d) => ({ front: d.amount, category: d.category || undefined, weight: factor }));
  const vscPenetration = productPenetration(deals, VSC_PRODUCT_ID);
  return {
    units: t.units * factor, frontGross: t.primary * factor, backGross: t.secondary * factor, products: t.addons * factor, dealRows, fastStartUnits: fastStart(deals) * factor,
    ...(vscPenetration !== undefined ? { vscPenetration } : {}),
  };
}

function combine(a: PerfInput, b: PerfInput): PerfInput {
  const vscPenetration = combinePct(a, b, "vscPenetration");
  return {
    units: a.units + b.units,
    frontGross: a.frontGross + b.frontGross,
    backGross: a.backGross + b.backGross,
    products: a.products + b.products,
    dealRows: a.dealRows || b.dealRows ? [...(a.dealRows ?? []), ...(b.dealRows ?? [])] : undefined,
    fastStartUnits: (a.fastStartUnits ?? 0) + (b.fastStartUnits ?? 0),
    ...(vscPenetration !== undefined ? { vscPenetration } : {}),
  };
}

function combinePct(a: PerfInput, b: PerfInput, key: "vscPenetration"): number | undefined {
  const au = a.units || 0;
  const bu = b.units || 0;
  if (au === 0) return b[key];
  if (bu === 0) return a[key];
  if (a[key] === undefined || b[key] === undefined) return undefined;
  return ((a[key] * au) + (b[key] * bu)) / (au + bu);
}

// ---- forecast ----
export interface Forecast {
  counted: Deal[];
  pipeline: Deal[];
  totals: DealTotals; // of delivered
  current: PayResult; // delivered only (banked)
  likely: PayResult; // delivered + stage-weighted pipeline
  best: PayResult; // delivered + all pipeline
  pace: PayResult; // delivered pace extrapolated across the working month
  paceUnits: number;
  pacePay: number;
  confidence: number;
}

// Working days between day 1 and `upToDay` of the month, skipping the
// weekdays the user doesn't work (0=Sun…6=Sat). Empty daysOff = every day.
export function workingDays(now: Date, upToDay: number, daysOff: number[]): number {
  if (!daysOff.length) return upToDay;
  let n = 0;
  for (let d = 1; d <= upToDay; d++) {
    if (!daysOff.includes(new Date(now.getFullYear(), now.getMonth(), d).getDay())) n++;
  }
  return n;
}

// ---- follow-up queue ----
// The "nothing goes cold" logic, pulled out of components/FollowUpQueue.tsx so
// it has exactly one home and can run server-side too (the nudge cron needs
// the identical rule set the on-screen queue uses — never two definitions of
// "who needs you" that can drift apart).
const LIVE_STATUSES: DealStatus[] = ["prospect", "appointment", "working", "pending", "finance"];
const COLD_AFTER_DAYS = 4;

export interface FollowUpQueueResult {
  overdue: Deal[];
  dueToday: Deal[];
  goingCold: Deal[];
  scheduled: Deal[];
  needsYou: number;
}

export function daysSince(iso: string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

// Start/end of "today" as absolute instants. On the client `now` is the rep's
// device time and setHours gives their local midnight — correct. On the server
// (Vercel = UTC) that midnight is UTC's, which drifts the follow-up buckets by
// the rep's offset, so the nudge cron can pass the rep's timeZone to anchor the
// day in their local calendar instead (matching what's on their screen).
export function dayBounds(now = new Date(), timeZone?: string): { start: Date; end: Date } {
  if (!timeZone) {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
    // Offset = (the zone's wall clock read as if it were UTC) − the real instant.
    const wallAsUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
    const offsetMs = wallAsUTC - now.getTime();
    const midnightWallAsUTC = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
    const start = new Date(midnightWallAsUTC - offsetMs);
    const end = new Date(midnightWallAsUTC - offsetMs + 86_400_000 - 1);
    return { start, end };
  } catch {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
}

export function followUpQueue(deals: Deal[], now = new Date(), timeZone?: string): FollowUpQueueResult {
  const { start: startToday, end: endToday } = dayBounds(now, timeZone);
  const live = deals.filter((d) => LIVE_STATUSES.includes(d.status));

  const overdue = live.filter((d) => d.followUpAt && new Date(d.followUpAt) < startToday);
  const dueToday = live.filter((d) => d.followUpAt && new Date(d.followUpAt) >= startToday && new Date(d.followUpAt) <= endToday);
  const goingCold = live.filter((d) => !d.followUpAt && daysSince(d.date, now) >= COLD_AFTER_DAYS);
  const scheduled = live
    .filter((d) => d.followUpAt && new Date(d.followUpAt) > endToday)
    .sort((a, b) => a.followUpAt!.localeCompare(b.followUpAt!));
  return { overdue, dueToday, goingCold, scheduled, needsYou: overdue.length + dueToday.length + goingCold.length };
}

export function forecast(plan: PayPlan, deals: Deal[], now = new Date(), daysOff: number[] = []): Forecast {
  const month = deals.filter((d) => isThisMonth(d.date, now) && d.status !== "dead");
  const counted = month.filter((d) => d.status === "delivered");
  const pipeline = month.filter((d) => d.status !== "delivered");

  const countedPerf = perfFromDeals(counted);
  const current = calculatePay(plan, countedPerf);
  const best = calculatePay(plan, perfFromDeals([...counted, ...pipeline]));

  // weighted "likely": each pipeline deal scaled by its stage probability
  let weighted = countedPerf;
  for (const d of pipeline) weighted = combine(weighted, scaledPerf([d], STATUS_WEIGHT[d.status]));
  const likely = calculatePay(plan, weighted);

  // pace: extrapolate delivered units over the user's WORKING month — a rep
  // whose store closes Sundays and who's off Tuesdays is paced across the
  // days they can actually sell, not the calendar. Today counts by how much
  // of it has elapsed, so the pace decays smoothly through the day instead
  // of cliffing down at midnight before the rep has had a chance to sell.
  const { dayOfMonth, daysInMonth } = monthBounds(now);
  const todayFraction = daysOff.includes(now.getDay()) ? 0 : (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
  const workedSoFar = Math.max(1, workingDays(now, dayOfMonth - 1, daysOff) + todayFraction);
  const workTotal = Math.max(workedSoFar, workingDays(now, daysInMonth, daysOff));
  const paceUnits = Math.round((counted.length / workedSoFar) * workTotal);
  const factor = counted.length > 0 ? paceUnits / counted.length : 0;
  const pacePerf = factor > 0 ? scaledPerf(counted, factor) : countedPerf;
  const pace = calculatePay(plan, pacePerf);
  const pacePay = pace.grossPay;

  const elapsed = dayOfMonth / daysInMonth;
  const confidence = Math.max(0.1, Math.min(0.97, 0.35 + elapsed * 0.45 + Math.min(pipeline.length / 5, 1) * 0.2));

  return { counted, pipeline, totals: dealTotals(counted), current, likely, best, pace, paceUnits, pacePay, confidence };
}

function sum<T>(arr: T[], f: (x: T) => number) { return arr.reduce((a, x) => a + (f(x) || 0), 0); }
