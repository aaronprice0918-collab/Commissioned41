// Audit: does the Daily Spending Allowance move BACKWARDS (lower money →
// higher allowance)? Drives the REAL engine (no reimplementation) through two
// controlled sweeps and prints the numbers.
import { dailyBudget, cashFlow } from "../lib/money/engine";
import type { MoneyConfig } from "../lib/money/types";

const income = (nextCheckDate: string, amount: number) => ({
  remainingThisMonth: amount,
  nextCheckDate,
  nextCheckAmount: amount,
});

function cfg(balance: number, spendToday: { date: string; amount: number }[] = []): MoneyConfig {
  return {
    checkingBalance: balance,
    balanceAsOf: "2026-07-10",
    payday: 15, // one check, the 15th
    checkNets: [3000],
    cushion: 1000,
    monthlyEssentials: 1200, // $40/day burn
    bills: [{ id: "b1", name: "Truck", amount: 600, cadence: "monthly", dayOfMonth: 20 }],
    goals: [],
    spend: spendToday,
  } as unknown as MoneyConfig;
}

console.log("── SWEEP 1: same day (Jul 10), balance drops $1,900 → $1,100 ──");
console.log("If the math were backwards, allowance would RISE as balance falls.");
for (const bal of [1900, 1700, 1500, 1300, 1100]) {
  const d = dailyBudget(cfg(bal), income("2026-07-15", 3000), new Date("2026-07-10T12:00:00"));
  console.log(`balance $${bal} → perDay $${d?.perDay} · lumpToday $${d?.lumpToday} · tightest ${d?.tightestDate} ($${d?.tightestBalance})`);
}

console.log("\n── SWEEP 2: days pass toward the Jul-15 payday; balance falls by real burn ──");
console.log("(the rep spends nothing extra — balance only falls by the $40/day burn)");
let bal = 1900;
for (let day = 8; day <= 14; day++) {
  const date = `2026-07-${String(day).padStart(2, "0")}`;
  const d = dailyBudget(cfg(Math.round(bal)), income("2026-07-15", 3000), new Date(`${date}T12:00:00`));
  console.log(`${date}: balance $${Math.round(bal)} → perDay $${d?.perDay} · tightest ${d?.tightestDate}`);
  bal -= 40; // the engine's own burn assumption
}

console.log("\n── SWEEP 3: log spending today (balance unchanged) ──");
for (const spent of [0, 50, 120]) {
  const d = dailyBudget(cfg(1812, spent ? [{ date: "2026-07-10", amount: spent }] : []), income("2026-07-15", 3000), new Date("2026-07-10T12:00:00"));
  console.log(`logged $${spent} → perDay $${d?.perDay} · leftToday $${d?.leftToday} (headline the screen shows)`);
}

console.log("\n── SWEEP 4: does logged spend change the projection curve? ──");
const flowNone = cashFlow(cfg(1812), income("2026-07-15", 3000), new Date("2026-07-10T12:00:00"), 5);
const flowSpent = cashFlow(cfg(1812, [{ date: "2026-07-10", amount: 200 }]), income("2026-07-15", 3000), new Date("2026-07-10T12:00:00"), 5);
console.log("no spend logged :", flowNone.map((p) => `${p.date.slice(5)}:$${p.balance}`).join("  "));
console.log("$200 logged today:", flowSpent.map((p) => `${p.date.slice(5)}:$${p.balance}`).join("  "));
