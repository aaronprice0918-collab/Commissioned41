// Desk engine: deal structuring math, Georgia tax/fees, and printable form
// builders. Extracted from app/crm-desk/page.tsx so CRM Desk and the Desking
// tab share one source of truth for payment math and paperwork.

import { type CrmLead as Lead } from "@/components/CrmProvider";
import { canonicalPersonName, currency, displayFullPersonName } from "@/lib/data";
import { assertQuotable, type StateTaxProfile } from "@/lib/states";
import { GA } from "@/lib/states/ga";

// Back-compat for the Georgia print/form builders below — derived from the GA
// profile so there is exactly ONE source of truth for Georgia's numbers.
export const georgiaFees = {
  taxRate: (GA.retail.ratePct ?? 0) / 100,
  docFee: GA.fees.docFee,
  electronicTitleFee: GA.fees.electronicTitleFee,
  titleFee: GA.fees.titleFee,
  registrationFee: GA.fees.registrationFee,
  lemonLawFee: GA.fees.lemonLawFeeNew,
};
export const georgiaFormsPacketUrl = "/forms/georgia-deal-forms.pdf";
export const numberFormat = new Intl.NumberFormat("en-US");

// The retail desk math, driven by a state profile. Defaults to Georgia so every
// existing caller behaves exactly as before. An unverified state throws (via
// assertQuotable) rather than emit a tax number we haven't confirmed.
export function calculateDesk(
  lead: Pick<Lead, "vehicleClass" | "sellingPrice" | "unitCost" | "docFee" | "rebate" | "tradeValue" | "taxCreditEnabled" | "payoff" | "cashDown" | "rate" | "term" | "products">,
  profile: StateTaxProfile = GA,
) {
  assertQuotable(profile, "retail");
  const fees = profile.fees;
  const ratePct = profile.retail.ratePct ?? 0;
  // Respect a legal doc-fee cap if the state sets one (GA: uncapped).
  const rawDocFee = lead.docFee ?? fees.docFee;
  const docFee = fees.docFeeCap != null ? Math.min(rawDocFee, fees.docFeeCap) : rawDocFee;
  // Defensive: a lead missing `products` (hand-imported / partial data) must
  // never crash every screen that desks it — it's just $0 in products.
  const productTotal = Object.values(lead.products ?? {}).reduce((sum, value) => sum + value, 0);
  const frontProfit = lead.sellingPrice + docFee - lead.unitCost;
  // Rebates: GA (O.C.G.A. §48-5C-1) excludes the rebate from a NEW vehicle's
  // TAVT base — $40,000 with a $2,000 rebate taxes $38,000. Profile-driven so
  // other states keep their own rule.
  const rebateRule = profile.retail.rebateReducesTaxable;
  const rebateReduction =
    rebateRule === "all" || (rebateRule === "new" && lead.vehicleClass === "New") ? Math.max(lead.rebate, 0) : 0;
  const preCreditTaxableAmount = Math.max(
    lead.sellingPrice + (profile.retail.taxableIncludesDocFee ? docFee : 0) - rebateReduction,
    0,
  );
  const hasTrade = lead.tradeValue > 0;
  // The trade tax credit applies only when the manager confirms it
  // (taxCreditEnabled) — off for a leased trade, a trade titled in another
  // name, etc. — and never on a lease. How much credit depends on the state.
  const tradeCreditAllowed = lead.taxCreditEnabled && hasTrade && lead.vehicleClass !== "Lease";
  let taxCredit = 0;
  if (tradeCreditAllowed) {
    if (profile.retail.tradeCredit === "full") {
      taxCredit = Math.min(lead.tradeValue, preCreditTaxableAmount);
    } else if (profile.retail.tradeCredit === "capped") {
      taxCredit = Math.min(lead.tradeValue, profile.retail.tradeCreditCap ?? 0, preCreditTaxableAmount);
    }
    // "none" → no credit
  }
  const taxableAmount = Math.max(preCreditTaxableAmount - taxCredit, 0);
  const tax = taxableAmount * (ratePct / 100);
  const feesTotal =
    docFee +
    fees.electronicTitleFee +
    fees.titleFee +
    fees.registrationFee +
    // GA lemon-law fee applies to new motor vehicles — a lease is a new unit too.
    (lead.vehicleClass === "New" || lead.vehicleClass === "Lease" ? fees.lemonLawFeeNew : 0);
  const amountFinanced = Math.max(lead.sellingPrice - lead.rebate - lead.tradeValue + lead.payoff + tax + feesTotal + productTotal - lead.cashDown, 0);
  const payment = estimatePayment(amountFinanced, lead.rate, lead.term);
  return { taxableAmount, taxCredit, tax, fees: feesTotal, productTotal, frontProfit, amountFinanced, payment, docFee };
}

export function personLabel(name: string) {
  return displayFullPersonName(canonicalPersonName(name));
}

export function estimatePayment(amount: number, rate: number, term: number) {
  const monthlyRate = rate / 100 / 12;
  if (!amount || !term) return 0;
  if (!monthlyRate) return amount / term;
  return (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -term));
}

export function printForm(lead: Lead, formName: string) {
  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) return;
  popup.document.write(buildPrintableDocument(lead, [formName]));
  popup.document.close();
}

export function printDealPacket(lead: Lead) {
  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) return;
  popup.document.write(buildPrintableDocument(lead, dealPacketForms(lead)));
  popup.document.close();
}

export function printCustomerWorksheet(lead: Lead) {
  printForm(lead, "Customer Deal Worksheet");
}

// Print an explicit set of forms (used by the Desking tab's grouped packs).
export function printForms(lead: Lead, formNames: string[]) {
  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) return;
  popup.document.write(buildPrintableDocument(lead, formNames));
  popup.document.close();
}

export function buildPrintableDocument(lead: Lead, formNames: string[]) {
  const safeCustomer = escapeHtml(lead.customer || "Customer");
  return `
    <html>
      <head>
        <title>Filled Deal Forms - ${safeCustomer}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #111; margin: 28px; }
          h1 { margin: 0 0 4px; font-size: 28px; line-height: 1.15; }
          h2 { margin: 18px 0 10px; font-size: 16px; border-bottom: 1px solid #222; padding-bottom: 6px; }
          h3 { margin: 14px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
          .muted { color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; }
          .form-page { break-after: page; page-break-after: always; }
          .form-page:last-child { break-after: auto; page-break-after: auto; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
          .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 14px; }
          .line { display: grid; grid-template-columns: 145px 1fr; align-items: start; border-bottom: 1px solid #ddd; padding: 7px 0; gap: 10px; }
          .line strong { font-size: 11px; text-transform: uppercase; letter-spacing: .7px; color: #333; }
          .line span { font-size: 13px; overflow-wrap: anywhere; }
          .box { border: 1px solid #222; min-height: 72px; padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
          .check-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
          .check { border-bottom: 1px solid #ddd; padding: 7px 0; font-size: 13px; }
          .snapshot { margin-top: 16px; border: 2px solid #111; padding: 12px; }
          .note { margin-top: 12px; font-size: 12px; color: #555; }
          .sign { margin-top: 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
          .sigline { border-top: 1px solid #111; padding-top: 8px; font-size: 12px; }
          @media print {
            body { margin: 18px; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        ${formNames.map((formName) => buildFormPage(lead, formName)).join("")}
        <script>window.print();</script>
      </body>
    </html>
  `;
}

export function buildFormPage(lead: Lead, formName: string) {
  // The full deal recap is its own standalone form ("Complete Deal Recap"),
  // not appended to every individual form.
  const isRecap = formName.toLowerCase().includes("deal recap");
  if (isRecap) {
    return `
    <section class="form-page">
      <div class="muted">Mission | Kennesaw Mazda | Internal Deal Recap</div>
      <h1>${escapeHtml(formName)}</h1>
      <div class="muted">Printed ${escapeHtml(new Date().toLocaleString())}</div>
      ${buildDealDataSnapshot(lead)}
    </section>
  `;
  }

  return `
    <section class="form-page">
      <div class="muted">Mission | Kennesaw Mazda | Filled from CRM Desk</div>
      <h1>${escapeHtml(formName)}</h1>
      <div class="muted">Printed ${escapeHtml(new Date().toLocaleString())}</div>
      ${buildFormSpecificSection(lead, formName)}
      <div class="sign">
        <div class="sigline">Customer Signature / Date</div>
        <div class="sigline">Dealer / Manager Signature / Date</div>
      </div>
    </section>
  `;
}

export function buildFormSpecificSection(lead: Lead, formName: string) {
  const desk = calculateDesk(lead);
  const products = productLines(lead);
  const lowerName = formName.toLowerCase();

  if (lowerName.includes("worksheet")) {
    const paymentSpread = [desk.payment, desk.payment + lead.paymentSpreadStep, desk.payment + lead.paymentSpreadStep * 2];
    return `
      <h2>Customer Presentation Numbers</h2>
      <div class="grid">
        ${fieldLine("Selling Price", currency(lead.sellingPrice))}
        ${fieldLine("Rebate", `-${currency(lead.rebate)}`)}
        ${fieldLine("Trade Allowance", currency(lead.tradeValue))}
        ${fieldLine("Trade Tax Credit", lead.taxCreditEnabled ? currency(desk.taxCredit) : "Not Applied")}
        ${fieldLine("Payoff", currency(lead.payoff))}
        ${fieldLine("Cash Down", currency(lead.cashDown))}
        ${fieldLine("GA Tax", currency(desk.tax))}
        ${fieldLine("Amount Financed", currency(desk.amountFinanced))}
        ${fieldLine("Estimated Payment", currency(desk.payment))}
      </div>
      <h2>Georgia Taxes And Fees</h2>
      <div class="grid">
        ${fieldLine("Doc Fee", currency(desk.docFee))}
        ${fieldLine("Electronic Title", currency(georgiaFees.electronicTitleFee))}
        ${fieldLine("Title", currency(georgiaFees.titleFee))}
        ${fieldLine("Registration", currency(georgiaFees.registrationFee))}
        ${fieldLine("Lemon Law", lead.vehicleClass === "New" || lead.vehicleClass === "Lease" ? currency(georgiaFees.lemonLawFee) : "Not applicable")}
        ${fieldLine("Total Fees", currency(desk.fees))}
      </div>
      <div class="note">Customer copy intentionally excludes interest rate. Payment is an estimate until final approval, lender terms, and signed contract.</div>
      ${
        lead.showPaymentSpread
          ? `<h2>Payment Spread</h2><div class="grid-3">${paymentSpread.map((payment, index) => fieldLine(`Option ${index + 1}`, currency(payment))).join("")}</div>`
          : ""
      }
      ${
        lead.showProductsOnWorksheet
          ? `<h2>Selected Products</h2><div class="grid">${products.length ? products.map((product) => fieldLine(product.label, currency(product.value))).join("") : fieldLine("Products", currency(0))}</div>`
          : ""
      }
    `;
  }

  if (lowerName.includes("credit")) {
    return `
      <h2>Credit Application Data Entered</h2>
      <div class="grid">
        ${fieldLine("Customer", lead.customer)}
        ${fieldLine("Phone", lead.customerPhone || "Not entered")}
        ${fieldLine("Email", lead.customerEmail || "Not entered")}
        ${fieldLine("Address", formatAddress(lead) || "Not entered")}
        ${fieldLine("Credit Status", lead.creditStatus)}
        ${fieldLine("Credit Snapshot", formatCreditSnapshot(lead) || "Not entered")}
        ${fieldLine("Employer", lead.employer || "Not entered")}
        ${fieldLine("Monthly Income", lead.monthlyIncome || "Not entered")}
        ${fieldLine("Residence", lead.residenceStatus || "Not entered")}
        ${fieldLine("Finance Manager", personLabel(lead.financeManager))}
      </div>
    `;
  }

  if (lowerName.includes("we owe")) {
    return `
      <h2>We Owe / Nothing Owed</h2>
      <div class="box">${escapeHtml(lead.weOwe || "Nothing promised unless written here and approved.")}</div>
      <h2>Vehicle</h2>
      <div class="grid">${fieldLine("Vehicle", lead.vehicle || "TBD")}${fieldLine("Stock", lead.stockNumber || "TBD")}${fieldLine("Miles", lead.vehicleMiles ? `${numberFormat.format(lead.vehicleMiles)} mi` : "Not entered")}</div>
    `;
  }

  if (lowerName.includes("trade") || lowerName.includes("payoff")) {
    return `
      <h2>Trade / Payoff Details</h2>
      <div class="grid">
        ${fieldLine("Trade", tradeSummary(lead) || "No trade entered")}
        ${fieldLine("Year", lead.tradeYear || "Not entered")}
        ${fieldLine("Make", lead.tradeMake || "Not entered")}
        ${fieldLine("Model", lead.tradeModel || "Not entered")}
        ${fieldLine("Miles", lead.tradeMiles ? `${numberFormat.format(lead.tradeMiles)} mi` : "Not entered")}
        ${fieldLine("Payoff", currency(lead.payoff))}
        ${fieldLine("Payoff Source", lead.tradePayoffSource || "Not entered")}
        ${fieldLine("ACV", currency(lead.tradeAcv))}
        ${fieldLine("Allowance", currency(lead.tradeValue))}
      </div>
      <h2>Trade Notes</h2>
      <div class="box">${escapeHtml(lead.tradeNotes || lead.tradeDetails || "No trade details entered.")}</div>
    `;
  }

  if (lowerName.includes("mv-1") || lowerName.includes("title") || lowerName.includes("tag") || lowerName.includes("tavt")) {
    return `
      <h2>Title / Tag / TAVT Data</h2>
      <div class="grid">
        ${fieldLine("Customer", lead.customer)}
        ${fieldLine("Address", formatAddress(lead) || "Not entered")}
        ${fieldLine("Vehicle", lead.vehicle || "TBD")}
        ${fieldLine("Stock", lead.stockNumber || "TBD")}
        ${fieldLine("Vehicle Type", lead.vehicleClass)}
        ${fieldLine("Miles", lead.vehicleMiles ? `${numberFormat.format(lead.vehicleMiles)} mi` : "Not entered")}
        ${fieldLine("Taxable Amount", currency(desk.taxableAmount))}
        ${fieldLine("GA Tax", currency(desk.tax))}
        ${fieldLine("Title Fee", currency(georgiaFees.titleFee))}
        ${fieldLine("Registration", currency(georgiaFees.registrationFee))}
        ${fieldLine("Lemon Law", lead.vehicleClass === "New" || lead.vehicleClass === "Lease" ? currency(georgiaFees.lemonLawFee) : "Not applicable")}
      </div>
    `;
  }

  if (lowerName.includes("buyers guide")) {
    return `
      <h2>Used Vehicle Buyer Guide Data</h2>
      <div class="grid">
        ${fieldLine("Vehicle", lead.vehicle || "TBD")}
        ${fieldLine("Stock", lead.stockNumber || "TBD")}
        ${fieldLine("Miles", lead.vehicleMiles ? `${numberFormat.format(lead.vehicleMiles)} mi` : "Not entered")}
        ${fieldLine("Customer", lead.customer)}
        ${fieldLine("Salesperson", personLabel(lead.salesperson))}
        ${fieldLine("Notes", lead.notes || "Not entered")}
      </div>
    `;
  }

  if (lowerName.includes("rdr")) {
    return `
      <h2>RDR Data</h2>
      <div class="grid">
        ${fieldLine("Vehicle", lead.vehicle || "TBD")}
        ${fieldLine("Stock", lead.stockNumber || "TBD")}
        ${fieldLine("Vehicle Type", lead.vehicleClass)}
        ${fieldLine("Customer", lead.customer)}
        ${fieldLine("Salesperson", personLabel(lead.salesperson))}
        ${fieldLine("Finance Manager", personLabel(lead.financeManager))}
      </div>
    `;
  }

  return `
    <h2>Form Data</h2>
    <div class="grid">
      ${fieldLine("Customer", lead.customer)}
      ${fieldLine("Address", formatAddress(lead) || "Not entered")}
      ${fieldLine("Phone", lead.customerPhone || "Not entered")}
      ${fieldLine("Email", lead.customerEmail || "Not entered")}
      ${fieldLine("Vehicle", lead.vehicle || "TBD")}
      ${fieldLine("Stock", lead.stockNumber || "TBD")}
      ${fieldLine("Salesperson", personLabel(lead.salesperson))}
      ${fieldLine("F&I Manager", personLabel(lead.financeManager))}
    </div>
  `;
}

export function buildDealDataSnapshot(lead: Lead) {
  const desk = calculateDesk(lead);
  const products = productLines(lead);
  return `
    <div class="snapshot">
      <h2>Complete Deal Data Snapshot</h2>
      <h3>Customer</h3>
      <div class="grid">
        ${fieldLine("Customer", lead.customer || "Not entered")}
        ${fieldLine("Phone", lead.customerPhone || "Not entered")}
        ${fieldLine("Email", lead.customerEmail || "Not entered")}
        ${fieldLine("Address", formatAddress(lead) || "Not entered")}
        ${fieldLine("Source", lead.source || "Not entered")}
        ${fieldLine("Credit App", lead.creditStatus)}
        ${fieldLine("Credit Snapshot", formatCreditSnapshot(lead) || "Not entered")}
        ${fieldLine("Appointment", lead.appointment ? lead.appointment.replace("T", " ") : "Not set")}
      </div>
      <h3>Vehicle / Team</h3>
      <div class="grid">
        ${fieldLine("Vehicle", lead.vehicle || "TBD")}
        ${fieldLine("Stock", lead.stockNumber || "TBD")}
        ${fieldLine("Vehicle Type", lead.vehicleClass)}
        ${fieldLine("Miles", lead.vehicleMiles ? `${numberFormat.format(lead.vehicleMiles)} mi` : "Not entered")}
        ${fieldLine("Salesperson", personLabel(lead.salesperson))}
        ${fieldLine("Desk Manager", lead.deskManager ? personLabel(lead.deskManager) : "Unassigned")}
        ${fieldLine("F&I Manager", personLabel(lead.financeManager))}
        ${fieldLine("Next Action", lead.nextAction || "Not entered")}
        ${fieldLine("Status", lead.status)}
      </div>
      <h3>Numbers</h3>
      <div class="grid">
        ${fieldLine("Selling Price", currency(lead.sellingPrice))}
        ${fieldLine("Unit Cost", currency(lead.unitCost))}
        ${fieldLine("Front Profit", currency(desk.frontProfit))}
        ${fieldLine("Rebate", currency(lead.rebate))}
        ${fieldLine("Trade Allowance", currency(lead.tradeValue))}
        ${fieldLine("Trade Tax Credit", lead.taxCreditEnabled ? currency(desk.taxCredit) : "Not Applied")}
        ${fieldLine("Payoff", currency(lead.payoff))}
        ${fieldLine("Cash Down", currency(lead.cashDown))}
        ${fieldLine("GA Tax", currency(desk.tax))}
        ${fieldLine("Fees", currency(desk.fees))}
        ${fieldLine("Products", currency(desk.productTotal))}
        ${fieldLine("Amount Financed", currency(desk.amountFinanced))}
        ${fieldLine("Buy Rate", `${lead.buyRate.toFixed(2)}%`)}
        ${fieldLine("Sell Rate", `${lead.sellRate.toFixed(2)}%`)}
        ${fieldLine("Term", `${lead.term} months`)}
        ${fieldLine("Payment", currency(desk.payment))}
      </div>
      <h3>Products</h3>
      <div class="grid">
        ${products.length ? products.map((product) => fieldLine(product.label, currency(product.value))).join("") : fieldLine("Products", currency(0))}
      </div>
      <h3>Trade</h3>
      <div class="grid">
        ${fieldLine("Trade", tradeSummary(lead) || "No trade entered")}
        ${fieldLine("Payoff Source", lead.tradePayoffSource || "Not entered")}
        ${fieldLine("ACV", currency(lead.tradeAcv))}
        ${fieldLine("Allowance", currency(lead.tradeValue))}
      </div>
      <div class="box">${escapeHtml(lead.tradeNotes || lead.tradeDetails || "No trade notes entered.")}</div>
      <h3>We Owe / Notes</h3>
      <div class="box">${escapeHtml(`We Owe: ${lead.weOwe || "Nothing promised unless written here and approved."}\n\nNotes: ${lead.notes || "No notes entered."}`)}</div>
    </div>
  `;
}

export function fieldLine(label: string, value: string) {
  return `<div class="line"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`;
}

export function productLines(lead: Pick<Lead, "products">) {
  return [
    { label: "VSC", value: lead.products.vsc },
    { label: "GAP", value: lead.products.gap },
    { label: "Maintenance", value: lead.products.maintenance },
    { label: "Permaplate", value: lead.products.permaplate },
    { label: "TWS", value: lead.products.tws },
    { label: "UTP", value: lead.products.utp },
  ].filter((product) => product.value > 0);
}

export function dealPacketForms(lead: Pick<Lead, "vehicleClass" | "tradeYear" | "tradeMake" | "tradeModel" | "tradeValue" | "payoff">) {
  const hasTrade = Boolean(lead.tradeYear || lead.tradeMake || lead.tradeModel || lead.tradeValue || lead.payoff);
  return [
    "Customer Deal Worksheet",
    "Privacy Notice",
    "Credit Application",
    "We Owe / Nothing Owed",
    "GA MV-1 Title/Tag Application",
    "GA MV-7D TAVT Worksheet",
    "GA T-8 Limited Power of Attorney",
    "Odometer Disclosure",
    "Agreement to Provide Insurance",
    ...(lead.vehicleClass === "New" ? ["Georgia Lemon Law Statement of Rights", "Mazda RDR Form"] : ["FTC Used Car Buyers Guide"]),
    ...(hasTrade ? ["Trade Appraisal / Payoff Verification"] : []),
    "Complete Deal Recap",
  ];
}

export function tradeSummary(lead: Pick<Lead, "tradeYear" | "tradeMake" | "tradeModel" | "tradeMiles" | "tradeValue" | "payoff">) {
  const vehicle = [lead.tradeYear, lead.tradeMake, lead.tradeModel].filter(Boolean).join(" ");
  const miles = lead.tradeMiles ? `${numberFormat.format(lead.tradeMiles)} mi` : "";
  const values = [lead.tradeValue ? `Allowance ${currency(lead.tradeValue)}` : "", lead.payoff ? `Payoff ${currency(lead.payoff)}` : ""].filter(Boolean).join(" | ");
  return [vehicle, miles, values].filter(Boolean).join(" | ");
}

export function formatAddress(lead: Pick<Lead, "customerAddress" | "customerCity" | "customerState" | "customerZip">) {
  const cityLine = [lead.customerCity, lead.customerState, lead.customerZip].filter(Boolean).join(" ");
  return [lead.customerAddress, cityLine].filter(Boolean).join(", ");
}

export function formatCreditSnapshot(lead: Pick<Lead, "creditScore" | "monthlyIncome" | "employer" | "residenceStatus">) {
  return [
    lead.creditScore ? `Score ${lead.creditScore}` : "",
    lead.monthlyIncome ? `Income ${lead.monthlyIncome}` : "",
    lead.employer ? `Employer ${lead.employer}` : "",
    lead.residenceStatus ? `Residence ${lead.residenceStatus}` : "",
  ].filter(Boolean).join(" | ");
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
