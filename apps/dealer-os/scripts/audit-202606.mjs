import fs from "node:fs";

const deals = JSON.parse(fs.readFileSync("data/deals.json", "utf8"));
const DOC_FEE = 899; // defaultDocFee, applied to all New/Used (GM-only line)

const money = (n) => (n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString()})` : Math.round(n).toLocaleString());
const isDelivered = (d) => d.stage === "Delivered" || d.stage === "Funded";
const delivered = deals.filter(isDelivered);
const sum = (arr, f) => arr.reduce((a, d) => a + f(d), 0);

console.log("================ KENNESAW MAZDA — JUNE 2026 FULL AUDIT ================");
console.log("Source: Dealership Deal Log, 6/1–6/30/2026, data as of 6/17/2026 7:06 AM\n");

// 1) Reconciliation vs source report
const front = sum(delivered, (d) => d.frontGross);
const back = sum(delivered, (d) => d.backGrossReserve);
const finRes = sum(delivered, (d) => d.reserve ?? 0);
const commGross = front + back; // commissionable gross (report Total)
const docFees = delivered.length * DOC_FEE;
const gmGross = commGross + docFees;

const report = { units: 39, finRes: 20730, back: 71113, front: -3606, total: 67507 };
const line = (label, got, exp) => {
  const ok = exp === undefined ? "" : got === exp ? "  ✓ matches report" : `  ✗ EXPECTED ${money(exp)}`;
  console.log(`  ${label.padEnd(34)} ${money(got).padStart(10)}${ok}`);
};
console.log("1) RECONCILIATION vs SOURCE REPORT");
line("Delivered/funded units", delivered.length, report.units);
line("Finance reserve", finRes, report.finRes);
line("Back gross", back, report.back);
line("Front gross", front, report.front);
line("Commissionable gross (F+B)", commGross, report.total);
console.log(`  PVR (commissionable / unit)        ${money(commGross / delivered.length).padStart(10)}  (report 1,731)`);
console.log(`  -- GM Command view (adds doc fee) --`);
console.log(`  Doc-fee income (${delivered.length} × $${DOC_FEE})          ${money(docFees).padStart(10)}`);
console.log(`  GM total gross                     ${money(gmGross).padStart(10)}\n`);

// 2) New vs Used
console.log("2) MIX");
for (const cls of ["New", "Used"]) {
  const g = delivered.filter((d) => d.vehicleClass === cls);
  console.log(`  ${cls.padEnd(6)} ${String(g.length).padStart(2)} units   front ${money(sum(g, (d) => d.frontGross)).padStart(8)}   back ${money(sum(g, (d) => d.backGrossReserve)).padStart(8)}   total ${money(sum(g, (d) => d.frontGross + d.backGrossReserve)).padStart(8)}`);
}
const cash = delivered.filter((d) => d.cashDeal);
console.log(`  Cash deals: ${cash.length} of ${delivered.length}\n`);

// 3) F&I manager breakdown
console.log("3) F&I MANAGER (back gross + reserve)");
const byFi = {};
for (const d of delivered) (byFi[d.financeManager] ??= []).push(d);
for (const [name, g] of Object.entries(byFi).sort((a, b) => sum(b[1], (d) => d.backGrossReserve) - sum(a[1], (d) => d.backGrossReserve))) {
  console.log(`  ${name.padEnd(16)} ${String(g.length).padStart(2)} deals   back ${money(sum(g, (d) => d.backGrossReserve)).padStart(8)}   reserve ${money(sum(g, (d) => d.reserve ?? 0)).padStart(7)}`);
}
console.log();

// 4) Salesperson breakdown
console.log("4) SALESPERSON (units + total gross)");
const bySp = {};
for (const d of delivered) (bySp[d.salesperson] ??= []).push(d);
for (const [name, g] of Object.entries(bySp).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${name.padEnd(12)} ${String(g.length).padStart(2)} units   total ${money(sum(g, (d) => d.frontGross + d.backGrossReserve)).padStart(8)}`);
}
console.log();

// 5) Posting / RDR status
console.log("5) POSTING / RDR STATUS");
const punched = deals.filter((d) => d.rdrStatus === "Punched");
const notPunched = deals.filter((d) => d.rdrStatus !== "Punched");
console.log(`  Posted (RDR Punched):     ${punched.length}`);
console.log(`  Not posted (follow-up):   ${notPunched.length}`);
notPunched.forEach((d) => console.log(`    - ${d.id} ${d.customer.padEnd(11)} stat-per-notes  ${d.rdrNotes}`));
console.log();

// 6) 6% manufacturer holdback readiness
console.log("6) 6% NEW-CAR HOLDBACK READINESS");
const newDeals = delivered.filter((d) => d.vehicleClass === "New");
const withInvoice = newDeals.filter((d) => d.invoiceAmount);
console.log(`  New-car deals:                 ${newDeals.length}`);
console.log(`  With invoice entered:          ${withInvoice.length}`);
console.log(`  Holdback computable:          ${money(sum(withInvoice, (d) => d.invoiceAmount * 0.06))}`);
if (withInvoice.length < newDeals.length) {
  console.log(`  ⚠ ${newDeals.length - withInvoice.length} New-car deals still need invoice amounts for the 6% readout.`);
}
console.log();

// 7) Data integrity
console.log("7) DATA INTEGRITY CHECKS");
const flags = [];
for (const d of deals) {
  if (d.frontGross + d.backGrossReserve === 0 && d.reserve === 0 && d.backGrossReserve === 0)
    flags.push(`${d.id} ${d.customer}: zero front+back+reserve`);
  if (d.cashDeal && (d.reserve ?? 0) !== 0) flags.push(`${d.id} ${d.customer}: cash deal but reserve ${d.reserve}`);
  if (d.rdrStatus === "Punched" && !d.rdrDate) flags.push(`${d.id} ${d.customer}: punched but no rdrDate`);
  if (!d.rdrDate && d.fundingStatus === "Funded") flags.push(`${d.id} ${d.customer}: funded but no post date`);
}
const offRoster = [...new Set(deals.map((d) => d.financeManager).concat(deals.map((d) => d.salesperson)))]
  .filter((n) => ["HOUSE EMPLOYEE", "NONE"].includes(n));
if (offRoster.length) flags.push(`Non-roster F&I labels present: ${offRoster.join(", ")} (house/none — expected, no commission)`);
if (flags.length === 0) console.log("  No anomalies.");
else flags.forEach((f) => console.log(`  • ${f}`));
console.log("\n======================================================================");
