import type {
  Account,
  Bill,
  FinancialProfile,
  Goal,
  Paycheck,
  Transaction,
  TxnCategory,
} from "./types";

// The model's "today". Everything else is computed relative to this so the
// dashboard is deterministic and demo-able without a live clock.
export const TODAY = "2026-06-26";

const accounts: Account[] = [
  {
    id: "acc_checking",
    name: "Everyday Checking",
    institution: "Truist",
    type: "checking",
    balance: 6420.18,
    mask: "4471",
  },
  {
    id: "acc_savings",
    name: "Emergency Fund",
    institution: "Ally",
    type: "savings",
    balance: 11850.0,
    apr: 0.041,
    mask: "9920",
  },
  {
    id: "acc_amex",
    name: "Amex Gold",
    institution: "American Express",
    type: "credit",
    balance: -2140.55,
    limit: 15000,
    apr: 0.2399,
    mask: "1003",
  },
  {
    id: "acc_visa",
    name: "Chase Sapphire",
    institution: "Chase",
    type: "credit",
    balance: -3890.0,
    limit: 12000,
    apr: 0.2174,
    mask: "7782",
  },
  {
    id: "acc_auto",
    name: "Mazda CX-90 Loan",
    institution: "Mazda Financial",
    type: "auto_loan",
    balance: -38450.0,
    apr: 0.0689,
    mask: "5521",
  },
  {
    id: "acc_mortgage",
    name: "Home Mortgage",
    institution: "Rocket Mortgage",
    type: "mortgage",
    balance: -312500.0,
    apr: 0.0625,
    mask: "0098",
  },
  {
    id: "acc_home",
    name: "Home — Market Value",
    institution: "Zillow estimate",
    type: "real_estate",
    balance: 455000.0,
    mask: "0098",
  },
  {
    id: "acc_brokerage",
    name: "Brokerage",
    institution: "Fidelity",
    type: "investment",
    balance: 24300.0,
    mask: "3340",
  },
  {
    id: "acc_401k",
    name: "401(k)",
    institution: "Fidelity",
    type: "retirement",
    balance: 68900.0,
    mask: "1190",
  },
];

const bills: Bill[] = [
  { id: "b_mortgage", name: "Mortgage", amount: 2310, category: "housing", cadence: "monthly", dayOfMonth: 1, autoDetected: true },
  { id: "b_auto", name: "Mazda CX-90 Payment", amount: 712, category: "transportation", cadence: "monthly", dayOfMonth: 5, autoDetected: true },
  { id: "b_power", name: "Cobb EMC Power", amount: 214, category: "utilities", cadence: "monthly", dayOfMonth: 12, autoDetected: true },
  { id: "b_water", name: "Water & Sewer", amount: 86, category: "utilities", cadence: "monthly", dayOfMonth: 18, autoDetected: true },
  { id: "b_internet", name: "Xfinity Internet", amount: 95, category: "utilities", cadence: "monthly", dayOfMonth: 9, autoDetected: true },
  { id: "b_phone", name: "Verizon", amount: 168, category: "utilities", cadence: "monthly", dayOfMonth: 22, autoDetected: true },
  { id: "b_insurance", name: "Auto + Home Insurance", amount: 268, category: "transportation", cadence: "monthly", dayOfMonth: 15, autoDetected: true },
  { id: "b_daycare", name: "Kids — Aftercare", amount: 540, category: "kids", cadence: "monthly", dayOfMonth: 3, autoDetected: true },
  { id: "b_amex", name: "Amex Gold (min)", amount: 65, category: "debt", cadence: "monthly", dayOfMonth: 25, autoDetected: true },
  { id: "b_visa", name: "Chase Sapphire (min)", amount: 95, category: "debt", cadence: "monthly", dayOfMonth: 27, autoDetected: true },
  // Subscriptions
  { id: "s_netflix", name: "Netflix", amount: 22.99, category: "subscriptions", cadence: "monthly", dayOfMonth: 14, autoDetected: true, isSubscription: true },
  { id: "s_spotify", name: "Spotify Family", amount: 16.99, category: "subscriptions", cadence: "monthly", dayOfMonth: 8, autoDetected: true, isSubscription: true },
  { id: "s_icloud", name: "iCloud 2TB", amount: 9.99, category: "subscriptions", cadence: "monthly", dayOfMonth: 11, autoDetected: true, isSubscription: true },
  { id: "s_chatgpt", name: "OpenAI / ChatGPT", amount: 20, category: "subscriptions", cadence: "monthly", dayOfMonth: 19, autoDetected: true, isSubscription: true },
  { id: "s_gym", name: "Crunch Fitness", amount: 39.99, category: "subscriptions", cadence: "monthly", dayOfMonth: 6, autoDetected: true, isSubscription: true },
  { id: "s_vercel", name: "Vercel Pro (MissionOS)", amount: 20, category: "business", cadence: "monthly", dayOfMonth: 21, autoDetected: true, isSubscription: true },
];

// Commission-based F&I income: a modest semi-monthly draw plus the real money,
// a monthly commission deposit that the AI predicts from the pay plan.
const paychecks: Paycheck[] = [
  {
    id: "pc_draw_1",
    date: "2026-06-30",
    kind: "draw",
    expectedGross: 1500,
    expectedNet: 1180,
    confidence: 0.99,
    worstCase: 1180,
    bestCase: 1180,
    source: "Kennesaw Mazda — Draw",
  },
  {
    id: "pc_commission",
    date: "2026-07-10",
    kind: "commission",
    expectedGross: 11800,
    expectedNet: 8420,
    confidence: 0.78,
    worstCase: 6100,
    bestCase: 10250,
    source: "Kennesaw Mazda — F&I Commission",
  },
];

const goals: Goal[] = [
  { id: "g_ef", name: "6-Month Emergency Fund", target: 24000, saved: 11850, targetDate: "2027-02-01", monthlyContribution: 900, probability: 0.82, emoji: "🛡️" },
  { id: "g_missionos", name: "MissionOS Launch Fund", target: 15000, saved: 4200, targetDate: "2026-12-01", monthlyContribution: 750, probability: 0.64, emoji: "🚀" },
  { id: "g_vacation", name: "Family Trip — Disney", target: 6000, saved: 2300, targetDate: "2026-11-01", monthlyContribution: 500, probability: 0.71, emoji: "🏖️" },
  { id: "g_truck", name: "Truck Down Payment", target: 10000, saved: 1500, targetDate: "2027-08-01", monthlyContribution: 400, probability: 0.58, emoji: "🛻" },
];

// A few weeks of recent transactions across categories. Dates are within the
// current month so spend-this-month math works.
function txn(
  id: string,
  date: string,
  name: string,
  amount: number,
  category: TxnCategory,
  accountId = "acc_checking",
  pending = false,
): Transaction {
  return { id, accountId, date, name, amount, category, pending };
}

const transactions: Transaction[] = [
  txn("t1", "2026-06-25", "Publix", -142.37, "food"),
  txn("t2", "2026-06-25", "Shell", -61.2, "fuel"),
  txn("t3", "2026-06-24", "Amazon", -88.41, "amazon", "acc_amex"),
  txn("t4", "2026-06-24", "Chick-fil-A", -27.84, "restaurants"),
  txn("t5", "2026-06-23", "Costco", -218.9, "food", "acc_amex"),
  txn("t6", "2026-06-22", "Verizon", -168.0, "utilities"),
  txn("t7", "2026-06-21", "Vercel", -20.0, "business"),
  txn("t8", "2026-06-21", "Target", -94.12, "shopping", "acc_visa"),
  txn("t9", "2026-06-20", "Kids Haircuts", -48.0, "kids"),
  txn("t10", "2026-06-19", "OpenAI", -20.0, "subscriptions"),
  txn("t11", "2026-06-18", "Water & Sewer", -86.0, "utilities"),
  txn("t12", "2026-06-18", "QuikTrip", -58.7, "fuel"),
  txn("t13", "2026-06-17", "The Optimist (dinner)", -164.5, "restaurants", "acc_amex"),
  txn("t14", "2026-06-16", "Home Depot", -212.33, "shopping", "acc_visa"),
  txn("t15", "2026-06-15", "Auto + Home Insurance", -268.0, "transportation"),
  txn("t16", "2026-06-15", "Draw Deposit", 1180.0, "income"),
  txn("t17", "2026-06-14", "Netflix", -22.99, "subscriptions"),
  txn("t18", "2026-06-13", "Publix", -119.4, "food"),
  txn("t19", "2026-06-12", "Cobb EMC", -214.0, "utilities"),
  txn("t20", "2026-06-11", "iCloud", -9.99, "subscriptions"),
  txn("t21", "2026-06-10", "F&I Commission", 8650.0, "income"),
  txn("t22", "2026-06-09", "Xfinity", -95.0, "utilities"),
  txn("t23", "2026-06-08", "Spotify", -16.99, "subscriptions"),
  txn("t24", "2026-06-07", "Delta (flights)", -612.0, "travel", "acc_visa"),
  txn("t25", "2026-06-06", "Crunch Fitness", -39.99, "subscriptions"),
  txn("t26", "2026-06-05", "Mazda Financial", -712.0, "transportation"),
  txn("t27", "2026-06-03", "Kids Aftercare", -540.0, "kids"),
  txn("t28", "2026-06-01", "Rocket Mortgage", -2310.0, "housing"),
];

export const profile: FinancialProfile = {
  name: "Aaron",
  asOf: TODAY,
  accounts,
  transactions,
  bills,
  paychecks,
  goals,
  monthlyEssentials: 850, // groceries/fuel floor not captured as named bills
};
