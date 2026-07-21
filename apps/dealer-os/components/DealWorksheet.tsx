"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import clsx from "clsx";
import { KennesawMazdaMark } from "@/components/BrandMarks";
import { type CrmLead } from "@/components/CrmProvider";
import { currency } from "@/lib/data";
import { calculateDesk, estimatePayment, personLabel, georgiaFees } from "@/lib/desk";

// Customer deal worksheet for the Desking tab. Renders the customer commitment
// sheet from a CRM lead and the desk calculation — presentation numbers plus a
// live payment matrix. Term rows and cash-down columns are editable (they change
// deal to deal); each payment cell is CALCULATED from the structured deal, so the
// numbers are trustworthy rather than hand-typed.
//
// Printing: a copy of the sheet is rendered into a portal at document.body, and
// the print stylesheet hides every other body child. That guarantees a single
// clean sheet — the old visibility-hidden trick kept the tall dark app in the
// page flow, which paginated into blank extra pages.

const GOLD = "#9a7a3c"; // brass accent that reads on white paper (theme gold can be near-white)

function tradeDescription(lead: CrmLead) {
  return [lead.tradeYear, lead.tradeMake, lead.tradeModel].filter(Boolean).join(" ");
}

/** Inline label with an underlined value that fills the remaining width. */
function F({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-end gap-1.5 py-[3px]">
      <span className="whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-[0.06em] text-black/55">{label}</span>
      <span className="min-w-0 flex-1 border-b border-black/35 pb-[2px] text-[11.5px] font-bold leading-tight text-black">{value || " "}</span>
    </div>
  );
}

/** Section banner: bold label with a gold hairline running across the row.
 *  Uses a border (not a background) so it prints even with "Background graphics" off. */
function Band({ title }: { title: string }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-black">{title}</span>
      <span className="flex-1" style={{ borderTop: `1px solid ${GOLD}` }} />
    </div>
  );
}

function FigureRow({ label, value, bold = false }: { label: string; value?: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${bold ? "border-y-2 border-black py-[6px]" : "border-b border-black/12 py-[5px]"}`}>
      <span className={`text-[11px] ${bold ? "font-black uppercase tracking-[0.04em]" : "font-medium text-black/75"} text-black`}>{label}</span>
      <span className={`min-w-[92px] text-right ${bold ? "text-[13px] font-black" : "text-[12px] font-bold"} text-black`}>{value || " "}</span>
    </div>
  );
}

const editClass = "w-full bg-[#fbf8f1] text-center outline-none focus:bg-[#f1ead8]";

/** The white letter sheet itself. `editable` renders the matrix as inputs (screen); otherwise as static text (print copy). */
export function Sheet({
  lead,
  terms,
  downs,
  zeroDownAmount,
  rate,
  editable,
  onTerm,
  onDown,
}: {
  lead: CrmLead;
  terms: number[];
  downs: number[];
  zeroDownAmount: number;
  rate: number;
  editable: boolean;
  onTerm?: (i: number, value: string) => void;
  onDown?: (j: number, value: string) => void;
}) {
  const desk = calculateDesk(lead);
  const cellPayment = (term: number, down: number) => estimatePayment(Math.max(zeroDownAmount - down, 0), rate, term);

  return (
    <div className="mx-auto w-full max-w-[860px] bg-white px-9 py-7 text-black">
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-8">
        <KennesawMazdaMark className="h-14 w-48" priority />
        <div className="w-[320px] max-w-[55%]">
          <F label="Date" value={new Date().toLocaleDateString()} />
          <F label="Salesperson" value={lead.salesperson ? personLabel(lead.salesperson) : ""} />
          <F label="Manager" value={lead.deskManager ? personLabel(lead.deskManager) : ""} />
        </div>
      </div>
      <div className="mt-2.5 w-full" style={{ borderTop: `2px solid ${GOLD}` }} />
      <div className="py-1.5 text-center text-[11px] font-black uppercase tracking-[0.28em] text-black">For Internal Use Only</div>
      <div className="w-full" style={{ borderTop: "1px solid rgba(0,0,0,0.7)" }} />

      {/* CUSTOMER */}
      <Band title="Customer" />
      <div className="grid grid-cols-[1.55fr_1fr] gap-x-8">
        <div>
          <F label="Name" value={lead.customer} />
          <F label="Address" value={lead.customerAddress} />
          <F label="City / State / Zip" value={[lead.customerCity, lead.customerState, lead.customerZip].filter(Boolean).join(" ")} />
          <F label="E-Mail" value={lead.customerEmail} />
        </div>
        <div>
          <F label="Cell Phone" value={lead.customerPhone} />
          <F label="Home Phone" />
          <F label="Work Phone" />
        </div>
      </div>

      {/* VEHICLE */}
      <Band title="Vehicle" />
      <div className="grid grid-cols-4 gap-x-6">
        <F label="Stock #" value={lead.stockNumber} />
        <F label="New / Used" value={lead.vehicleClass} />
        <F label="Miles" value={lead.vehicleMiles ? lead.vehicleMiles.toLocaleString() : ""} />
        <F label="VIN" />
      </div>
      <div className="grid grid-cols-[2fr_1fr] gap-x-6">
        <F label="Vehicle" value={lead.vehicle} />
        <F label="Color" />
      </div>

      {/* TRADE IN */}
      <Band title="Trade In" />
      <div className="grid grid-cols-3 gap-x-6">
        <F label="Vehicle" value={tradeDescription(lead)} />
        <F label="Miles" value={lead.tradeMiles ? lead.tradeMiles.toLocaleString() : ""} />
        <F label="Payoff" value={lead.payoff ? currency(lead.payoff) : ""} />
      </div>
      <div className="grid grid-cols-3 gap-x-6">
        <F label="Allowance" value={lead.tradeValue ? currency(lead.tradeValue) : ""} />
        <F label="ACV" value={lead.tradeAcv ? currency(lead.tradeAcv) : ""} />
        <F label="Payoff Source" value={lead.tradePayoffSource} />
      </div>

      {/* Payments + figures */}
      <div className="mt-5 grid grid-cols-[1.12fr_1fr] gap-7">
        {/* Loan payments matrix */}
        <div className="self-start rounded-[6px] border border-black/55 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[12px] font-black uppercase tracking-[0.08em] text-black">Loan Payments</span>
            <span className="text-[10px] font-bold italic text-black/55">Estimated</span>
          </div>
          <table className="w-full table-fixed border-collapse text-center">
            <thead>
              <tr>
                <th className="w-[34%] border border-black/45 px-2 py-1.5 text-left text-[9.5px] font-bold uppercase tracking-[0.06em] text-black/65" style={{ backgroundColor: "#f3eee2" }}>Cash Down</th>
                {downs.map((down, j) => (
                  <th key={j} className="border border-black/45 px-1 py-1.5" style={{ backgroundColor: "#f3eee2" }}>
                    {editable ? (
                      <input aria-label={`Cash down column ${j + 1}`} className={`${editClass} text-[11px] font-black`} style={{ backgroundColor: "transparent" }} inputMode="numeric" value={down} onChange={(e) => onDown?.(j, e.target.value)} />
                    ) : (
                      <span className="text-[11px] font-black text-black">{currency(down)}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {terms.map((term, i) => (
                <tr key={i}>
                  <td className="border border-black/45 px-1.5 py-2">
                    <div className="flex items-baseline gap-1">
                      {editable ? (
                        <input aria-label={`Term row ${i + 1}`} className={`${editClass} text-left text-[11px] font-bold`} inputMode="numeric" value={term} onChange={(e) => onTerm?.(i, e.target.value)} />
                      ) : (
                        <span className="text-[11px] font-bold text-black">{term}</span>
                      )}
                      <span className="text-[9px] font-bold uppercase text-black/45">mo</span>
                    </div>
                  </td>
                  {downs.map((down, j) => (
                    <td key={j} className="border border-black/45 px-1 py-2 text-[12px] font-semibold text-black">
                      {currency(cellPayment(term, down))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[8.5px] italic leading-tight text-black/55">
            Payments estimated at {rate ? `${rate.toFixed(2)}% APR` : "the quoted rate"}. A.P.R. subject to equity and credit requirements.
          </p>
        </div>

        {/* Figures — presentation numbers */}
        <div className="self-start">
          <FigureRow label="Selling Price" value={currency(lead.sellingPrice)} />
          <FigureRow label="Rebate" value={lead.rebate ? `-${currency(lead.rebate)}` : currency(0)} />
          <FigureRow label="Trade Allowance" value={currency(lead.tradeValue)} />
          <FigureRow label="Trade Tax Credit" value={lead.taxCreditEnabled ? currency(desk.taxCredit) : "Not Applied"} />
          <FigureRow label="Payoff" value={currency(lead.payoff)} />
          <FigureRow label="Cash Down" value={currency(lead.cashDown)} />
          <FigureRow label="GA Tax" value={currency(desk.tax)} />
          <FigureRow label="Doc Fee" value={currency(desk.docFee)} />
          <FigureRow label="Amount Financed" value={currency(desk.amountFinanced)} bold />
          <div className="mt-1 flex items-center justify-between gap-3 py-[5px]">
            <span className="text-[11px] font-medium text-black/75">Estimated Payment</span>
            <span className="text-[13px] font-black text-black">{currency(desk.payment)}</span>
          </div>
        </div>
      </div>

      {/* Approvals */}
      <div className="mt-8 grid grid-cols-2 gap-10">
        <div className="border-t border-black/55 pt-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-black/60">Customer Approval</div>
        <div className="border-t border-black/55 pt-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-black/60">Management Approval</div>
      </div>

      <p className="mt-3 text-[7.5px] leading-[1.45] text-black/50">
        Customer copy intentionally excludes interest rate detail. Payment is an estimate until final lender approval, verified
        equity, taxes, fees, and a signed contract. By signing, you authorize the release of credit and employment information
        and consent to be contacted about this or future vehicles by phone, text, email, and mail. For information only. This is
        not an offer or contract for sale. Kennesaw Mazda — for internal use only.
      </p>
    </div>
  );
}

/** The on-screen worksheet: dark living glass, built around the payment matrix
 *  (terms × cash-down) and the figures — the parts a desk manager works live.
 *  The full white letter sheet (customer/vehicle/trade/approvals) is print-only. */
function DarkSheet({
  lead, terms, downs, zeroDownAmount, rate, onTerm, onDown,
}: {
  lead: CrmLead;
  terms: number[];
  downs: number[];
  zeroDownAmount: number;
  rate: number;
  onTerm: (i: number, value: string) => void;
  onDown: (j: number, value: string) => void;
}) {
  const desk = calculateDesk(lead);
  const cell = (term: number, down: number) => estimatePayment(Math.max(zeroDownAmount - down, 0), rate, term);
  const pays = terms.flatMap((t) => downs.map((d) => cell(t, d))).filter((n) => n > 0);
  const minPay = pays.length ? Math.min(...pays) : 0;

  const downInput = "w-full rounded-[8px] border border-white/12 bg-black/40 px-1 py-1.5 text-center text-[13px] font-black text-white tabular-nums outline-none transition-colors focus:border-mission-gold/55 focus:bg-black/60";

  return (
    <div className="space-y-4">
      {/* Payment matrix — the four-square */}
      <div className="rounded-[12px] border border-white/10 bg-black/25 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="readable-text text-xs font-black uppercase tracking-[0.14em] text-white/55">Payment Matrix</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-mission-gold/75">{rate ? `Est. ${rate.toFixed(2)}% APR` : "Estimated"}</span>
        </div>
        <div className="mb-1.5 flex items-center justify-between px-1 text-[9px] font-black uppercase tracking-[0.14em] text-white/35">
          <span>Term</span><span>Cash down →</span>
        </div>
        <table className="w-full table-fixed border-separate border-spacing-1 text-center">
          <thead>
            <tr>
              <th className="w-[26%]" />
              {downs.map((down, j) => (
                <th key={j} className="p-0">
                  <input aria-label={`Cash down column ${j + 1}`} className={downInput} inputMode="numeric" value={down} onChange={(e) => onDown(j, e.target.value)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {terms.map((term, i) => (
              <tr key={i}>
                <td className="p-0">
                  <div className="flex items-center gap-1 rounded-[8px] border border-white/12 bg-white/[0.03] px-2 py-1.5">
                    <input aria-label={`Term row ${i + 1}`} className="w-full bg-transparent text-left text-[13px] font-bold text-white tabular-nums outline-none" inputMode="numeric" value={term} onChange={(e) => onTerm(i, e.target.value)} />
                    <span className="text-[9px] font-bold uppercase text-white/35">mo</span>
                  </div>
                </td>
                {downs.map((down, j) => {
                  const p = cell(term, down);
                  const lowest = p > 0 && p === minPay;
                  return (
                    <td key={j} className={clsx("rounded-[8px] border py-2 text-[13px] font-black tabular-nums", lowest ? "border-mission-green/45 bg-mission-green/12 text-mission-green" : "border-white/[0.07] bg-black/20 text-white/90")}>
                      {currency(p)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] italic leading-tight text-white/35">
          Payments estimated{rate ? ` at ${rate.toFixed(2)}% APR` : ""}. Subject to verified equity and credit approval.
        </p>
      </div>

      {/* The figures */}
      <div className="rounded-[12px] border border-white/10 bg-black/25 p-4">
        <div className="readable-text mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/55">The Figures</div>
        {([
          ["Selling Price", currency(lead.sellingPrice), false],
          ["Rebate", lead.rebate ? `−${currency(lead.rebate)}` : currency(0), false],
          ["Trade Allowance", currency(lead.tradeValue), false],
          ["Trade Tax Credit", lead.taxCreditEnabled ? currency(desk.taxCredit) : "Not Applied", false],
          ["Payoff", currency(lead.payoff), false],
          ["Cash Down", currency(lead.cashDown), false],
          ["GA Tax (TAVT)", currency(desk.tax), false],
          ["Doc Fee", currency(desk.docFee), false],
          ["Electronic Title", currency(georgiaFees.electronicTitleFee), true],
          ["Title Fee", currency(georgiaFees.titleFee), true],
          ["Registration", currency(georgiaFees.registrationFee), true],
          ...(lead.vehicleClass === "New" || lead.vehicleClass === "Lease" ? [["Lemon Law", currency(georgiaFees.lemonLawFee), true] as [string, string, boolean]] : []),
        ] as [string, string, boolean][]).map(([label, value, fee], i) => (
          <div key={i} className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-1.5">
            <span className={clsx("text-[12px]", fee ? "text-white/40" : "text-white/55")}>{label}</span>
            <span className={clsx("text-[12px] font-bold tabular-nums", fee ? "text-white/70" : "text-white/90")}>{value}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between gap-3 border-y border-white/15 py-2">
          <span className="text-[12px] font-black uppercase tracking-[0.04em] text-white">Amount Financed</span>
          <span className="font-display text-sm font-black tabular-nums text-white">{currency(desk.amountFinanced)}</span>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/55">Estimated Payment</span>
          <span className="glass-num font-display text-2xl font-black tabular-nums">{currency(desk.payment)}</span>
        </div>
      </div>
    </div>
  );
}

export function DealWorksheet({ lead }: { lead: CrmLead }) {
  const desk = calculateDesk(lead);
  // Amount financed if the customer put zero down — every column is this minus
  // its cash-down figure, so payments recompute live as the desk edits terms.
  const zeroDownAmount = desk.amountFinanced + lead.cashDown;

  const seedDown = lead.cashDown > 0 ? lead.cashDown : 2000;
  const [terms, setTerms] = useState<number[]>([48, 54, 60]);
  const [downs, setDowns] = useState<number[]>([seedDown, seedDown + 1000, seedDown + 2000]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function setTerm(i: number, value: string) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    setTerms((prev) => prev.map((v, idx) => (idx === i ? n : v)));
  }
  function setDown(j: number, value: string) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    setDowns((prev) => prev.map((v, idx) => (idx === j ? n : v)));
  }

  const sheetProps = { lead, terms, downs, zeroDownAmount, rate: lead.rate };

  return (
    <div className="glass-living relative rounded-[14px] p-5">
      <style>{`
        @media print {
          @page { size: letter; margin: 0.45in; }
          html, body { background: #ffffff !important; }
          body > *:not(#worksheet-print-portal) { display: none !important; }
          #worksheet-print-portal { display: block !important; }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.24em] text-mission-gold">Paperwork</div>
          <div className="mt-1 font-display text-xl font-black text-white">Customer Deal Worksheet</div>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full border border-mission-gold/50 px-5 py-2.5 text-sm font-black uppercase tracking-[0.14em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy"
        >
          <Printer className="h-4 w-4" />
          Print Worksheet
        </button>
      </div>

      {/* On-screen worksheet — dark living glass; the white letter sheet is print-only */}
      <DarkSheet {...sheetProps} onTerm={setTerm} onDown={setDown} />


      {/* Print-only copy at the body root, isolated from the dark app chrome */}
      {mounted &&
        createPortal(
          <div id="worksheet-print-portal" style={{ display: "none" }}>
            <Sheet {...sheetProps} editable={false} />
          </div>,
          document.body
        )}
    </div>
  );
}
