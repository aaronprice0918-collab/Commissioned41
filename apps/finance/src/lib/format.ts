export function currency(n: number, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const { cents = false, sign = false } = opts;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(Math.abs(n));
  if (sign) return `${n < 0 ? "−" : "+"}${formatted}`;
  return n < 0 ? `−${formatted}` : formatted;
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function percent(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shortDate(iso: string): string {
  const d = parseISO(iso);
  return `${MONTH[d.getMonth()]} ${d.getDate()}`;
}

export function dayLabel(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAY[d.getDay()]} ${MONTH[d.getMonth()]} ${d.getDate()}`;
}

export function daysBetween(aIso: string, bIso: string): number {
  const a = parseISO(aIso).getTime();
  const b = parseISO(bIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function relativeDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 0) return `${Math.abs(n)}d ago`;
  return `in ${n} days`;
}
