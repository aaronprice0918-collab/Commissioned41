"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Car, Receipt, Landmark, Printer, FileText, User } from "lucide-react";
import clsx from "clsx";
import { StatusPill } from "@/components/StatusPill";
import { Tilt } from "@/components/Tilt";
import { useAuth } from "@/components/AuthProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { loadStore } from "@/lib/storeClient";
import { calculateGeorgiaLease, mfToApr, buildLeaseWorksheetHtml, buildLeaseCustomerSheetHtml, type LeaseTaxMethod } from "@/lib/lease";
import { GA } from "@/lib/states/ga";
import { georgiaFees } from "@/lib/desk";
import type { MonthlySetup, ResidualRow } from "@/lib/monthlySetup";

// The Georgia lease structuring desk — money factor + residual → payment, taxed
// the Georgia way. Used standalone on /lease and embedded under the Lease tab on
// the Desking screen, so the math + look are identical in both places.

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);

type Field = { key: keyof Inputs; label: string; hint?: string; step?: string };
type Inputs = {
  msrp: number; sellingPrice: number; acquisitionFee: number;
  residualPct: number; moneyFactor: number; termMonths: number; milesPerYear: number;
  rebate: number; tradeEquity: number; cashDown: number; upfrontFees: number;
  taxRatePct: number;
};

const VEHICLE_FIELDS: Field[] = [
  { key: "msrp", label: "MSRP", hint: "Residual is a % of this" },
  { key: "sellingPrice", label: "Selling price" },
  { key: "acquisitionFee", label: "Acquisition fee" },
];
const TERM_FIELDS: Field[] = [
  { key: "residualPct", label: "Residual %", step: "0.5" },
  { key: "moneyFactor", label: "Money factor", step: "0.00001" },
  { key: "termMonths", label: "Term (months)", hint: "Usually 24–36" },
  { key: "milesPerYear", label: "Miles / yr" },
];
const REDUCTION_FIELDS: Field[] = [
  { key: "rebate", label: "Lease cash / rebate" },
  { key: "tradeEquity", label: "Trade equity" },
  { key: "cashDown", label: "Cash down" },
  { key: "upfrontFees", label: "Upfront fees", hint: "Doc + GA e-title $199, title $18, reg $25, lemon law $3" },
];

export type LeaseSummary = { monthlyPayment: number; dueAtSigning: number; termMonths: number };

export type LeaseDeskProps = {
  initialCustomer?: string;
  initialVehicle?: string;
  initialSellingPrice?: number;
  initialMsrp?: number;
  // Fires whenever the computed lease changes, so an embedder (the Finance desk)
  // can capture the live lease summary onto the deal when it finalizes.
  onResult?: (summary: LeaseSummary) => void;
};

export function LeaseDesk({ initialCustomer, initialVehicle, initialSellingPrice, initialMsrp, onResult }: LeaseDeskProps) {
  const { profile } = useAuth();
  const { settings } = useStoreSettings();

  const [inputs, setInputs] = useState<Inputs>({
    msrp: initialMsrp || 35000,
    sellingPrice: initialSellingPrice || 33000,
    acquisitionFee: 650,
    residualPct: 58, moneyFactor: 0.00125, termMonths: 36, milesPerYear: 12000,
    rebate: 0, tradeEquity: 0, cashDown: 0,
    upfrontFees: (settings.docFee ?? 899) + georgiaFees.electronicTitleFee + georgiaFees.titleFee + georgiaFees.registrationFee + georgiaFees.lemonLawFee,
    taxRatePct: GA.lease.ratePct ?? 7, // ONE source of truth for GA's rate — never a screen literal
  });
  const [taxMethod, setTaxMethod] = useState<LeaseTaxMethod>("capitalize");
  const [customer, setCustomer] = useState(initialCustomer ?? "");
  const [vehicle, setVehicle] = useState(initialVehicle ?? "");
  const [residuals, setResiduals] = useState<ResidualRow[]>([]);

  // If the admin has loaded lease residuals in Monthly Setup, offer to apply one.
  useEffect(() => {
    void loadStore<MonthlySetup>("monthlySetup").then((s) => setResiduals(s?.residuals?.rows ?? []));
  }, []);

  const set = (key: keyof Inputs, raw: string) =>
    setInputs((p) => ({ ...p, [key]: raw === "" ? 0 : Number(raw) }));

  const result = useMemo(
    () => calculateGeorgiaLease({ ...inputs, taxMethod }),
    [inputs, taxMethod]
  );

  // Report the live lease summary up to an embedder (e.g. the Finance desk).
  // Held in a ref so a non-memoized parent callback can't cause a render loop.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  useEffect(() => {
    onResultRef.current?.({ monthlyPayment: result.monthlyPayment, dueAtSigning: result.dueAtSigning, termMonths: inputs.termMonths });
  }, [result.monthlyPayment, result.dueAtSigning, inputs.termMonths]);

  function meta() {
    return {
      storeName: settings.storeName || "Mission",
      customer: customer.trim() || undefined,
      vehicle: vehicle.trim() || undefined,
      preparedBy: profile?.employeeName || profile?.displayName || undefined,
      printedAt: new Date().toLocaleString(),
    };
  }
  function printHtml(html: string) {
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  }
  // What the salesperson hands the customer — payment, due, term, miles, price,
  // rebate. No money factor / residual / cost build-up.
  function printCustomerSheet() {
    printHtml(buildLeaseCustomerSheetHtml(
      {
        sellingPrice: inputs.sellingPrice,
        rebate: inputs.rebate,
        termMonths: inputs.termMonths,
        milesPerYear: inputs.milesPerYear,
        monthlyPayment: result.monthlyPayment,
        dueAtSigning: result.dueAtSigning,
      },
      meta()
    ));
  }
  // The manager's recap — the full build-up incl. money factor, residual, tax.
  function printManagerRecap() {
    printHtml(buildLeaseWorksheetHtml({ ...inputs, taxMethod }, result, meta()));
  }

  const field = (f: Field) => (
    <label key={f.key} className="flex flex-col">
      <span className="readable-text mb-1 flex min-h-[2.5em] items-start text-[11px] font-black uppercase leading-[1.15] tracking-[0.12em] text-white/45">{f.label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={f.step}
        value={inputs[f.key] === 0 ? "" : inputs[f.key]}
        placeholder="0"
        onChange={(e) => set(f.key, e.target.value)}
        className="w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-semibold text-white/90 tabular-nums outline-none transition-colors focus:border-mission-gold/50 focus:bg-black/40"
      />
      {f.hint ? <span className="mt-0.5 block text-[10px] text-white/35">{f.hint}</span> : null}
    </label>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
      {/* INPUTS */}
      <div className="space-y-4">
        <div className="rise glass-living relative overflow-hidden p-5">
          <div className="readable-text mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
            <User className="h-4 w-4 text-mission-gold/70" /> Customer &amp; vehicle <span className="font-medium normal-case tracking-normal text-white/30">— for the worksheet</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name"
              className="w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white/90 outline-none transition-colors focus:border-mission-gold/50" />
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Vehicle (e.g. 2026 CX-50)"
              className="w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white/90 outline-none transition-colors focus:border-mission-gold/50" />
          </div>
        </div>

        {residuals.length > 0 && (
          <div className="rise glass-living relative overflow-hidden p-4">
            <div className="readable-text mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              <Landmark className="h-4 w-4 text-mission-gold/70" /> Mazda residual — pull from Monthly Setup
            </div>
            <select
              onChange={(e) => {
                const r = residuals[Number(e.target.value)];
                if (!r) return;
                setInputs((p) => ({ ...p, residualPct: r.residualPct, termMonths: r.termMonths, moneyFactor: r.moneyFactor ?? p.moneyFactor }));
              }}
              defaultValue=""
              className="w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white/90 outline-none focus:border-mission-gold/50"
            >
              <option value="" disabled>Pick a model / term…</option>
              {residuals.map((r, idx) => (
                <option key={idx} value={idx}>
                  {r.model} · {r.termMonths}mo · {r.mileage}k → {r.residualPct}%{r.moneyFactor ? ` · MF ${r.moneyFactor}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="rise glass-living relative overflow-hidden p-5" style={{ animationDelay: "60ms" }}>
          <div className="readable-text mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
            <Car className="h-4 w-4 text-mission-gold/70" /> Vehicle &amp; lease terms
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{VEHICLE_FIELDS.map(field)}{TERM_FIELDS.map(field)}</div>
          <div className="mt-2 text-[11px] text-white/40">Money factor {inputs.moneyFactor} ≈ <span className="glass-accent font-bold">{mfToApr(inputs.moneyFactor).toFixed(2)}% APR</span></div>
        </div>

        <div className="rise glass-living relative overflow-hidden p-5" style={{ animationDelay: "120ms" }}>
          <div className="readable-text mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
            <Receipt className="h-4 w-4 text-mission-gold/70" /> Reductions &amp; fees
          </div>
          <div className="grid grid-cols-2 gap-3">{REDUCTION_FIELDS.map(field)}</div>
        </div>

        {/* GA TAX METHOD */}
        <div className="rise glass-living relative overflow-hidden p-5" style={{ animationDelay: "180ms" }}>
          <div className="readable-text mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">Georgia TAVT</div>
          <p className="mb-3 text-xs text-white/55">
            Full {inputs.taxRatePct}% on the <span className="text-white/85">leased portion plus cash down</span> (base payment × term + down), not the whole vehicle.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {([["capitalize", "Capitalize into payment", "Spread across the monthly (default)"], ["upfront", "Pay upfront", "Cash at signing, out of the payment"]] as const).map(([key, label, blurb]) => {
              const active = taxMethod === key;
              return (
                <button
                  key={key}
                  onClick={() => setTaxMethod(key)}
                  className={clsx(
                    "relative overflow-hidden rounded-[12px] border p-3 text-left transition-all duration-300",
                    active ? "glass-tactile border-mission-gold/55 bg-mission-gold/[0.08] shadow-[0_0_22px_-6px_rgb(var(--mission-gold)/0.5)]" : "border-white/10 hover:border-white/25"
                  )}
                >
                  <div className={clsx("text-sm font-black", active ? "glass-accent" : "text-white/85")}>{label}</div>
                  <div className="mt-0.5 text-[11px] text-white/45">{blurb}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* RESULT — sticky alongside the inputs */}
      <div className="space-y-4 lg:sticky lg:top-4">
        <Tilt max={4} className="rise glass-living glass-live relative overflow-hidden p-6" style={{ animationDelay: "80ms" }}>
          <div className="readable-text mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
            Live quote <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-mission-gold" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="readable-text text-[11px] font-black uppercase tracking-[0.14em] text-white/45">Monthly payment</div>
              <div className="glass-num-xl mt-1 font-display text-[clamp(2rem,4vw,3rem)] font-black leading-none tracking-tight tabular-nums">{usd(result.monthlyPayment)}</div>
              <div className="mt-1 text-[11px] text-white/40">{inputs.termMonths} months</div>
            </div>
            <div>
              <div className="readable-text text-[11px] font-black uppercase tracking-[0.14em] text-white/45">Due at signing</div>
              <div className="glass-num mt-1 font-display text-[clamp(2rem,4vw,3rem)] font-black leading-none tracking-tight tabular-nums">{usd(result.dueAtSigning)}</div>
              <div className="mt-1 text-[11px] text-white/40">{taxMethod === "upfront" ? "Incl. TAVT upfront" : "First payment + cash + fees"}</div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <StatusPill tone="gold">GA TAVT {usd(result.tavt)}</StatusPill>
            <StatusPill tone="blue">{taxMethod === "capitalize" ? `+${usd(result.monthlyTax)}/mo tax` : "tax paid upfront"}</StatusPill>
            <StatusPill tone="blue">{mfToApr(inputs.moneyFactor).toFixed(2)}% APR equiv</StatusPill>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              onClick={printCustomerSheet}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-white to-white/80 px-5 py-2.5 text-sm font-black text-black transition hover:from-white hover:to-white"
            >
              <Printer className="h-4 w-4" /> Customer sheet
            </button>
            <button
              onClick={printManagerRecap}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-black text-white/75 transition hover:border-white/40 hover:text-white"
            >
              <FileText className="h-4 w-4" /> Manager recap
            </button>
          </div>
        </Tilt>

        <div className="rise glass-living relative overflow-hidden p-5" style={{ animationDelay: "140ms" }}>
          <div className="readable-text mb-3 text-xs font-black uppercase tracking-[0.14em] text-white/45">How it&apos;s figured</div>
          <div className="space-y-0.5">
            {([
              ["Residual value", usd(result.residualValue), `${inputs.residualPct}% of MSRP`, false],
              ["Gross cap cost", usd(result.grossCapCost), "Price + acq fee", false],
              ["Cap-cost reduction", `−${usd(result.capCostReduction)}`, "Rebate + trade + cash down", false],
              ["Adjusted cap cost", usd(result.adjustedCapCost), "", false],
              ["Depreciation / mo", usd(result.monthlyDepreciation), "(cap − residual) ÷ term", false],
              ["Rent charge / mo", usd(result.monthlyRentCharge), "(cap + residual) × MF", false],
              ["Base payment (pre-tax)", usd(result.basePayment), "Depreciation + rent", true],
              ["Tax base (leased portion)", usd(result.taxBase), "Base payment × term", false],
              [`GA TAVT @ ${inputs.taxRatePct}%`, usd(result.tavt), "Base payments + cash down", true],
              [taxMethod === "capitalize" ? "Tax in payment / mo" : "Tax due upfront", taxMethod === "capitalize" ? usd(result.monthlyTax) : usd(result.tavt), "", false],
              ["Total of payments", usd(result.totalOfPayments), "", false],
            ] as const).map(([label, value, note, hot], i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-1.5 last:border-0">
                <span className="text-sm text-white/70">{label}{note ? <span className="ml-2 text-[10px] text-white/30">{note}</span> : null}</span>
                <span className={clsx("font-display text-sm font-black tabular-nums", hot ? "glass-num" : "text-white/90")}>{value}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-white/35">
            Georgia taxes a lease on what the customer rents (the payment stream), not the full vehicle value like a purchase. Tax is figured on the pre-tax base payment, so capitalizing it never re-taxes itself.
          </p>
        </div>
      </div>
    </div>
  );
}
