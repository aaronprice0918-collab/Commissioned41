// Server-side money sanitization for the generic KV store write path.
// SOC 2 PI1.2/PI1.3 (processing integrity). A car-deal OS lives or dies on
// correct pay/desking math: a client bug, a replayed/edited request, or a
// compromised in-tenant session must not be able to persist `NaN`, `"1e9"`,
// Infinity, or a negative-absurd money value that then flows into the pay
// engine, leaderboards, and EILA's audits. We coerce the KNOWN money fields to
// finite, sane numbers on write and leave every non-money field untouched.

// Money-bearing fields that appear on a deal object (front/back gross, reserve,
// fees, trade, payoff, invoice). Anything not listed is left exactly as-is.
const DEAL_MONEY_FIELDS = [
  "frontGross",
  "backGrossReserve",
  "reserve",
  "docFee",
  "invoiceAmount",
  "tradeAllowance",
  "tradeAcv",
  "tradePayoff",
  "payoff",
  "rebate",
  "downPayment",
] as const;

// Config money fields on storeSettings (rates/fees). Percentages and dollar
// amounts alike just need to be finite and non-absurd.
const SETTINGS_MONEY_FIELDS = ["docFee", "taxRate", "holdbackPercent", "holdback", "packFee", "pvrTarget"] as const;

// A single money value: coerce to a finite number; reject NaN/Infinity/garbage.
// Non-finite → 0 (safe for downstream sums; better a visible 0 than a poisoned
// NaN that corrupts every aggregate it touches). Clamped to a sane envelope so a
// fat-fingered/hostile 1e9 can't blow up a leaderboard.
export function finiteMoney(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  // A single retail auto deal's money fields live well inside ±$10M.
  if (n > 10_000_000) return 10_000_000;
  if (n < -10_000_000) return -10_000_000;
  return n;
}

function sanitizeDeal(deal: any): any {
  if (!deal || typeof deal !== "object") return deal;
  const out = { ...deal };
  for (const f of DEAL_MONEY_FIELDS) {
    if (f in out && out[f] !== undefined && out[f] !== null && out[f] !== "") {
      out[f] = finiteMoney(out[f]);
    }
  }
  return out;
}

/** Sanitize the value about to be written for `key`. Only touches money-bearing
 *  shapes; every other key/value passes through unchanged. */
export function sanitizeStoreValue(key: string, value: any): any {
  if (key === "deals" || key === "deals_backup") {
    return Array.isArray(value) ? value.map(sanitizeDeal) : value;
  }
  if (key === "closedMonths") {
    return Array.isArray(value)
      ? value.map((month: any) =>
          month && Array.isArray(month.deals)
            ? { ...month, deals: month.deals.map(sanitizeDeal) }
            : month,
        )
      : value;
  }
  if (key === "storeSettings" && value && typeof value === "object" && !Array.isArray(value)) {
    const out = { ...value };
    for (const f of SETTINGS_MONEY_FIELDS) {
      if (f in out && out[f] !== undefined && out[f] !== null && out[f] !== "") {
        out[f] = finiteMoney(out[f]);
      }
    }
    return out;
  }
  return value;
}
