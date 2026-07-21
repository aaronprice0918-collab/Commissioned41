import type { AccountType, TxnCategory } from "./types";

// ---- Plaid account → our AccountType ---------------------------------------

export function mapAccountType(type: string, subtype?: string | null): AccountType {
  const s = (subtype ?? "").toLowerCase();
  switch (type) {
    case "depository":
      if (s.includes("saving")) return "savings";
      return "checking";
    case "credit":
      return "credit";
    case "loan":
      if (s.includes("mortgage")) return "mortgage";
      if (s.includes("auto")) return "auto_loan";
      return "auto_loan"; // generic loan fallback
    case "investment":
      if (s.includes("401") || s.includes("ira") || s.includes("retirement") || s.includes("pension"))
        return "retirement";
      return "investment";
    default:
      return "checking";
  }
}

/** Our signed balance: assets positive, debts negative. Plaid `current` is the
 *  owed amount for credit/loan and the value for depository/investment. */
export function signedBalance(type: string, current: number | null | undefined): number {
  const v = current ?? 0;
  return type === "credit" || type === "loan" ? -Math.abs(v) : v;
}

// ---- Plaid personal_finance_category → our TxnCategory ----------------------

export function mapCategory(
  primary: string | undefined,
  detailed: string | undefined,
  isInflow: boolean,
): TxnCategory {
  const d = (detailed ?? "").toUpperCase();
  const p = (primary ?? "").toUpperCase();

  if (d.includes("SUBSCRIPTION")) return "subscriptions";
  if (p === "INCOME" || p === "TRANSFER_IN" || (isInflow && p === "")) return "income";

  switch (p) {
    case "FOOD_AND_DRINK":
      return d.includes("GROCER") ? "food" : "restaurants";
    case "GENERAL_MERCHANDISE":
      if (d.includes("ONLINE_MARKETPLACE") || d.includes("AMAZON")) return "amazon";
      return "shopping";
    case "TRANSPORTATION":
      return d.includes("GAS") ? "fuel" : "transportation";
    case "TRAVEL":
      return "travel";
    case "RENT_AND_UTILITIES":
      return d.includes("RENT") || d.includes("MORTGAGE") ? "housing" : "utilities";
    case "LOAN_PAYMENTS":
      return "debt";
    case "ENTERTAINMENT":
      return "entertainment";
    case "MEDICAL":
      return "medical";
    case "HOME_IMPROVEMENT":
      return "shopping";
    case "PERSONAL_CARE":
    case "GENERAL_SERVICES":
      return "business";
    case "BANK_FEES":
      return "business";
    case "GOVERNMENT_AND_NON_PROFIT":
      return "taxes";
    case "TRANSFER_OUT":
      return "transportation";
    default:
      return isInflow ? "income" : "shopping";
  }
}

/** Plaid amount: positive = money OUT of the account. Our convention is the
 *  opposite (negative = outflow), so we flip the sign. */
export function normalizeAmount(plaidAmount: number): number {
  return -plaidAmount;
}
