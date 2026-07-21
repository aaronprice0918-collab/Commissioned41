// ── Vocabulary-aware formatting ──────────────────────────────────────────────
// One place that turns numbers + metric keys into the words a given plan speaks.
// A plan with no `vocab` formats exactly like the app always has (USD, en-US,
// automotive metric labels), so nothing changes for existing dealership plans.
import type { MetricDef, PlanVocabulary } from "./payEngine";

const DEFAULT_LOCALE = "en-US";
const DEFAULT_CURRENCY = "USD";

// Built-in labels for the automotive metric keys the app has always used, so
// explanations/UI read the same when a plan defines no custom vocabulary.
const DEFAULT_METRIC_LABELS: Record<string, string> = {
  pvr: "PVR",
  frontPvr: "Front PVR",
  totalPvr: "Total PVR",
  ppu: "PPU",
  units: "Units",
  products: "Products",
  frontGross: "Front Gross",
  backGross: "Back Gross",
  totalGross: "Total Gross",
  netProfit: "Net Profit",
  vscPenetration: "VSC %",
  menuUsage: "Menu %",
};

// A currency formatter for the plan's currency/locale (whole units, like the
// engine's historical `$` helper). Falls back to USD/en-US.
export function makeMoney(vocab?: PlanVocabulary): (n: number) => string {
  const locale = vocab?.locale || DEFAULT_LOCALE;
  const currency = vocab?.currency || DEFAULT_CURRENCY;
  let fmt: Intl.NumberFormat;
  try {
    fmt = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    fmt = new Intl.NumberFormat(DEFAULT_LOCALE, { style: "currency", currency: DEFAULT_CURRENCY, maximumFractionDigits: 0 });
  }
  return (n: number) => fmt.format(Math.round(Number.isFinite(n) ? n : 0));
}

// The human label for a metric key: plan vocab wins, then built-in automotive
// labels, then a readable fallback (the key upper-cased, matching old behavior).
export function metricLabel(key: string, vocab?: PlanVocabulary): string {
  const def = vocab?.metrics?.find((m) => m.key === key);
  if (def?.label) return def.label;
  return DEFAULT_METRIC_LABELS[key] || key.toUpperCase();
}

// A metric's declared format ("money" | "number" | "percent" | "ratio"), if the
// plan defined one — used to render test inputs and breakdowns correctly.
export function metricDef(key: string, vocab?: PlanVocabulary): MetricDef | undefined {
  return vocab?.metrics?.find((m) => m.key === key);
}

// Format a metric value per its declared format (money/percent/ratio/number).
export function formatMetric(value: number, def?: MetricDef, vocab?: PlanVocabulary): string {
  const v = Number.isFinite(value) ? value : 0;
  switch (def?.format) {
    case "money":
      return makeMoney(vocab)(v);
    case "percent":
      return `${v.toFixed(1)}%`;
    case "ratio":
      return v.toFixed(2);
    case "number":
    default:
      return v.toLocaleString(vocab?.locale || DEFAULT_LOCALE);
  }
}
