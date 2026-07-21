// MissionOS Finance — core domain types.
// The AI keeps a live model of the user's financial life; these are its primitives.

export type AccountType =
  | "checking"
  | "savings"
  | "credit"
  | "auto_loan"
  | "mortgage"
  | "investment"
  | "retirement"
  | "real_estate";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  /** Positive for assets, negative for debts (credit/loans). */
  balance: number;
  /** For credit cards: the limit, used for utilization. */
  limit?: number;
  /** APR as a decimal, e.g. 0.2399 — for debts. */
  apr?: number;
  mask: string; // last 4
}

export type TxnCategory =
  | "food"
  | "fuel"
  | "restaurants"
  | "amazon"
  | "kids"
  | "business"
  | "entertainment"
  | "travel"
  | "shopping"
  | "utilities"
  | "subscriptions"
  | "housing"
  | "transportation"
  | "medical"
  | "taxes"
  | "debt"
  | "savings"
  | "investments"
  | "income";

export interface Transaction {
  id: string;
  accountId: string;
  date: string; // ISO yyyy-mm-dd
  name: string;
  amount: number; // negative = outflow, positive = inflow
  category: TxnCategory;
  pending?: boolean;
}

export type BillCadence = "monthly" | "weekly" | "biweekly" | "yearly" | "quarterly";

export interface Bill {
  id: string;
  name: string;
  amount: number; // positive number, it's an outflow
  category: TxnCategory;
  cadence: BillCadence;
  /** Day of month (1-31) the charge typically lands, for monthly bills. */
  dayOfMonth?: number;
  /** Detected automatically from recurring transactions. */
  autoDetected: boolean;
  isSubscription?: boolean;
}

export type IncomeKind =
  | "salary"
  | "hourly"
  | "commission"
  | "bonus"
  | "draw"
  | "spiff";

export interface Paycheck {
  id: string;
  date: string; // ISO expected deposit date
  kind: IncomeKind;
  expectedGross: number;
  expectedNet: number;
  /** 0-1 confidence the AI assigns to this prediction. */
  confidence: number;
  worstCase: number; // net
  bestCase: number; // net
  source: string; // e.g. "Kennesaw Mazda — F&I"
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  /** ISO target date. */
  targetDate: string;
  monthlyContribution: number;
  /** 0-1 probability the AI gives of hitting it on time. */
  probability: number;
  emoji: string;
}

export interface FinancialProfile {
  name: string;
  asOf: string; // ISO date "today" in the model
  accounts: Account[];
  transactions: Transaction[];
  bills: Bill[];
  paychecks: Paycheck[];
  goals: Goal[];
  monthlyEssentials: number; // floor of must-pay spend outside named bills
}
