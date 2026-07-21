"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Calculator, KeyRound, Send, UserSquare2 } from "lucide-react";
import clsx from "clsx";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { MetricCard } from "@/components/MetricCard";
import { Tilt } from "@/components/Tilt";
import { DealWorksheet } from "@/components/DealWorksheet";
import { LeaseDesk } from "@/components/LeaseDesk";
import { useCrmLeads, makeScratchLead, type CrmLead } from "@/components/CrmProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { currency } from "@/lib/data";
import { askIla } from "@/lib/askIla";
import { calculateDesk, personLabel, georgiaFees } from "@/lib/desk";


export default function DeskingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-white/56">Loading desk…</div>}>
      <DeskingInner />
    </Suspense>
  );
}

function DeskingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const leadId = params.get("lead") || "";
  const { leads, updateLead, addLead } = useCrmLeads();
  const lead = leads.find((item) => item.id === leadId);

  if (!lead) {
    return <LeadPicker leads={leads} addLead={addLead} router={router} />;
  }
  return <DeskWorkspace key={lead.id} lead={lead} updateLead={updateLead} router={router} />;
}

function LeadPicker({ leads, addLead, router }: { leads: CrmLead[]; addLead: (lead: CrmLead) => void; router: ReturnType<typeof useRouter> }) {
  const open = leads.filter((lead) => !["Won", "Lost"].includes(lead.status));
  const inFinance = leads.filter((lead) => lead.status === "In Finance");

  // Start a blank retail deal and jump straight into the desk — no customer
  // record required first. This IS the "regular desking tool": punch numbers now.
  function startQuickDesk() {
    const scratch = makeScratchLead();
    addLead(scratch);
    router.push(`/desking?lead=${scratch.id}`);
  }

  return (
    <div>
      <SectionHeader title="Desking" kicker="Structure the deal" />
      {/* Tap-to-explain: each board count hands off to EILA to walk who's in it. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricCard label="Open Customers" value={`${open.length}`} detail="On the board to desk" tone="gold" onExplain={() => askIla("Explain the open-customers count on the desking board — who's on it, where each one stands, and who to desk first.")} />
        <MetricCard label="In Finance" value={`${inFinance.length}`} detail="Pushed to F&I" tone="blue" onExplain={() => askIla("Explain the in-finance count — whose deals are with F&I right now and how long each has been there.")} />
        <MetricCard label="Showroom" value={`${leads.filter((l) => ["Shown", "Desking"].includes(l.status)).length}`} detail="Currently in process" tone="green" onExplain={() => askIla("Explain the showroom count — who's shown or at the desk right now and the next move with each.")} />
      </div>

      <button type="button" onClick={startQuickDesk} className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-[16px] bg-mission-gold px-5 py-4 text-[15px] font-black uppercase tracking-[0.08em] text-mission-navy shadow-gold transition hover:brightness-110">
        <Calculator className="h-5 w-5" /> New Retail Deal
      </button>
      <p className="mt-2 text-center text-xs text-white/45">Structure numbers now — no customer record needed.</p>

      <section className="glass-card mt-5 overflow-hidden rounded-[12px]">
        <div className="border-b border-white/10 p-5 font-display text-2xl font-black text-white">Or pick a customer to desk</div>
        {open.length === 0 ? (
          <div className="p-8 text-center text-sm leading-6 text-white/58">
            No customers on the board yet. Tap <span className="font-bold text-mission-gold">New Retail Deal</span> above to desk a deal now, or add one in <Link href="/crm-desk" className="text-mission-gold underline">CRM Desk</Link>.
          </div>
        ) : (
          <ul className="divide-y divide-white/8">
            {open.map((lead) => (
              <li key={lead.id}>
                <Link href={`/desking?lead=${lead.id}`} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-white/[0.04]">
                  <div>
                    <div className="font-bold text-white">{lead.customer || "Customer"}</div>
                    <div className="text-xs text-white/56">{personLabel(lead.salesperson)} | {lead.vehicle || "TBD"}{lead.stockNumber ? ` | ${lead.stockNumber}` : ""}</div>
                  </div>
                  <StatusPill tone={lead.status === "Desking" || lead.status === "In Finance" ? "gold" : "blue"}>{lead.status}</StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type FormState = {
  deskManager: string;
  sellingPrice: string;
  unitCost: string;
  docFee: string;
  rebate: string;
  tradeValue: string;
  tradeAcv: string;
  payoff: string;
  cashDown: string;
  buyRate: string;
  sellRate: string;
  term: string;
  taxCreditEnabled: boolean;
  showPaymentSpread: boolean;
  paymentSpreadStep: 10 | 20;
  vsc: string;
  gap: string;
  maintenance: string;
  permaplate: string;
  tws: string;
  utp: string;
};

function leadToForm(lead: CrmLead): FormState {
  return {
    deskManager: lead.deskManager || "",
    sellingPrice: String(lead.sellingPrice || ""),
    unitCost: String(lead.unitCost || ""),
    docFee: String(lead.docFee ?? ""),
    rebate: String(lead.rebate || ""),
    tradeValue: String(lead.tradeValue || ""),
    tradeAcv: String(lead.tradeAcv || ""),
    payoff: String(lead.payoff || ""),
    cashDown: String(lead.cashDown || ""),
    buyRate: String(lead.buyRate || ""),
    sellRate: String(lead.sellRate || ""),
    term: String(lead.term || ""),
    taxCreditEnabled: lead.taxCreditEnabled !== false,
    showPaymentSpread: Boolean(lead.showPaymentSpread),
    paymentSpreadStep: lead.paymentSpreadStep === 20 ? 20 : 10,
    vsc: String(lead.products.vsc || ""),
    gap: String(lead.products.gap || ""),
    maintenance: String(lead.products.maintenance || ""),
    permaplate: String(lead.products.permaplate || ""),
    tws: String(lead.products.tws || ""),
    utp: String(lead.products.utp || ""),
  };
}

function formToLeadPatch(form: FormState): Partial<CrmLead> {
  const num = (v: string) => Number(v) || 0;
  const sellRate = num(form.sellRate);
  return {
    deskManager: form.deskManager,
    sellingPrice: num(form.sellingPrice),
    unitCost: num(form.unitCost),
    docFee: num(form.docFee),
    rebate: num(form.rebate),
    tradeValue: num(form.tradeValue),
    tradeAcv: num(form.tradeAcv),
    payoff: num(form.payoff),
    cashDown: num(form.cashDown),
    buyRate: num(form.buyRate),
    sellRate,
    rate: sellRate,
    term: num(form.term) || 72,
    taxCreditEnabled: form.taxCreditEnabled,
    showPaymentSpread: form.showPaymentSpread,
    paymentSpreadStep: form.paymentSpreadStep,
    products: {
      vsc: num(form.vsc),
      gap: num(form.gap),
      maintenance: num(form.maintenance),
      permaplate: num(form.permaplate),
      tws: num(form.tws),
      utp: num(form.utp),
    },
  };
}

function DeskWorkspace({ lead, updateLead, router }: { lead: CrmLead; updateLead: (id: string, updates: Partial<CrmLead>) => void; router: ReturnType<typeof useRouter> }) {
  const { managers } = useTeamLists();
  const [form, setForm] = useState<FormState>(() => leadToForm(lead));
  const [saved, setSaved] = useState(false);
  // Desking ALWAYS opens on Retail (Aaron's rule) — every deal starts retail and
  // you push the Lease button to turn it into a lease. The toggle drives the
  // deal type from there (a lease persists as vehicleClass "New" flagged Lease).
  const [dealType, setDealType] = useState<"retail" | "lease">("retail");

  function chooseType(t: "retail" | "lease") {
    setDealType(t);
    if (t === "lease" && lead.vehicleClass !== "Lease") updateLead(lead.id, { vehicleClass: "Lease" });
    if (t === "retail" && lead.vehicleClass === "Lease") updateLead(lead.id, { vehicleClass: "New" });
  }

  // Opening a customer from the showroom log moves them to Desking.
  useEffect(() => {
    if (["Shown", "Appointment Set", "Working", "New Lead"].includes(lead.status)) {
      updateLead(lead.id, { status: "Desking" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Structured lead = the saved lead overlaid with the live desk edits, so the
  // worksheet, figures, and paperwork all read one consistent set of numbers.
  const structured = useMemo<CrmLead>(() => ({ ...lead, ...formToLeadPatch(form) }), [lead, form]);
  const desk = useMemo(() => calculateDesk(structured), [structured]);

  function saveStructure() {
    updateLead(lead.id, formToLeadPatch(form));
    setSaved(true);
  }

  function pushToFinance() {
    updateLead(lead.id, { ...formToLeadPatch(form), status: "In Finance" });
    router.push("/finance-desk");
  }

  return (
    <div>
      <SectionHeader title="Desking" kicker="Structure the deal" />

      {/* Customer header */}
      <section className="rise glass-living relative flex flex-wrap items-center justify-between gap-4 rounded-[14px] p-5">
        <div className="flex items-center gap-3">
          <UserSquare2 className="h-7 w-7 text-mission-gold" />
          <div>
            <div className="font-display text-2xl font-black text-white">{lead.customer || "Customer"}</div>
            <div className="text-sm text-white/56">{personLabel(lead.salesperson)} | {lead.vehicle || "TBD"}{lead.stockNumber ? ` | ${lead.stockNumber}` : ""} | {lead.vehicleClass}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={lead.status === "In Finance" ? "gold" : "blue"}>{lead.status}</StatusPill>
          <Link href="/crm-desk" className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/70 transition hover:border-mission-gold/40 hover:text-white">Back to CRM</Link>
          <button type="button" onClick={pushToFinance} className="inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
            <Send className="h-4 w-4" />
            Push to F&I
          </button>
        </div>
      </section>

      {/* Retail | Lease — the deal's headline; details swap behind it */}
      <div className="mt-4 inline-flex rounded-full border border-white/10 bg-black/30 p-1">
        {([["retail", "Retail", Calculator], ["lease", "Lease", KeyRound]] as const).map(([key, label, Icon]) => {
          const active = dealType === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => chooseType(key)}
              className={clsx(
                "inline-flex items-center gap-2 rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.12em] transition-all duration-300",
                active ? "bg-mission-gold text-mission-navy shadow-gold" : "text-white/55 hover:text-white/85"
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          );
        })}
      </div>

      {dealType === "lease" && (
        <div className="mt-5">
          <LeaseDesk
            initialCustomer={lead.customer}
            initialVehicle={lead.vehicle}
            initialSellingPrice={lead.sellingPrice || undefined}
          />
        </div>
      )}

      {dealType === "retail" && (
      <div className="mt-5 grid gap-5 xl:grid-cols-[420px_1fr]">
        {/* Structuring panel */}
        <aside className="rise glass-living relative rounded-[14px] p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-display text-xl font-black text-white">
              <Calculator className="h-5 w-5 text-mission-gold" />
              Structure
            </div>
            <button type="button" onClick={saveStructure} className="rounded-full border border-mission-gold/45 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
              {saved ? "Saved" : "Save to Lead"}
            </button>
          </div>
          <label className="mb-3 flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.07] bg-black/20 px-3 py-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-white/45">Desk Manager</span>
            <select className="h-8 max-w-[60%] bg-transparent text-right text-sm font-bold text-white outline-none" value={form.deskManager} onChange={(e) => set("deskManager", e.target.value)}>
              <option value="" className="bg-mission-navy">Unassigned</option>
              {managers.map((person) => <option key={person} value={person} className="bg-mission-navy">{personLabel(person)}</option>)}
            </select>
          </label>

          <LedgerGroup title="The Vehicle">
            <MoneyRow label="Selling Price" value={form.sellingPrice} onChange={(v) => set("sellingPrice", v)} />
            <MoneyRow label="Unit Cost" value={form.unitCost} onChange={(v) => set("unitCost", v)} />
            <MoneyRow label="Doc Fee" value={form.docFee} onChange={(v) => set("docFee", v)} />
          </LedgerGroup>

          <LedgerGroup title="Trade & Payoff">
            <MoneyRow label="Trade Allowance" value={form.tradeValue} onChange={(v) => set("tradeValue", v)} />
            <MoneyRow label="Trade ACV" value={form.tradeAcv} onChange={(v) => set("tradeAcv", v)} />
            <MoneyRow label="Payoff" value={form.payoff} onChange={(v) => set("payoff", v)} />
            <label className="flex cursor-pointer items-start gap-2.5 py-2">
              <input type="checkbox" checked={form.taxCreditEnabled && lead.vehicleClass !== "Lease"} disabled={lead.vehicleClass === "Lease"} onChange={(e) => set("taxCreditEnabled", e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-mission-gold" />
              <span className="text-[11.5px] leading-tight text-white/55">
                Customer gets the trade tax credit
                <span className="mt-0.5 block text-[10px] text-white/35">{lead.vehicleClass === "Lease" ? "Not applicable on a lease" : "Uncheck if they don't own the trade outright"}</span>
              </span>
            </label>
          </LedgerGroup>

          <LedgerGroup title="Customer Cash & Rate">
            <MoneyRow label="Rebate" value={form.rebate} onChange={(v) => set("rebate", v)} />
            <MoneyRow label="Cash Down" value={form.cashDown} onChange={(v) => set("cashDown", v)} />
            <UnitRow label="Buy Rate" suffix="%" value={form.buyRate} onChange={(v) => set("buyRate", v)} />
            <UnitRow label="Sell Rate" suffix="%" value={form.sellRate} onChange={(v) => set("sellRate", v)} />
            <UnitRow label="Term" suffix="mo" value={form.term} onChange={(v) => set("term", v)} />
          </LedgerGroup>

          <LedgerGroup title="Back-End Products">
            <MoneyRow label="VSC" value={form.vsc} onChange={(v) => set("vsc", v)} />
            <MoneyRow label="GAP" value={form.gap} onChange={(v) => set("gap", v)} />
            <MoneyRow label="Maintenance" value={form.maintenance} onChange={(v) => set("maintenance", v)} />
            <MoneyRow label="Permaplate" value={form.permaplate} onChange={(v) => set("permaplate", v)} />
            <MoneyRow label="TWS" value={form.tws} onChange={(v) => set("tws", v)} />
            <MoneyRow label="UTP" value={form.utp} onChange={(v) => set("utp", v)} />
          </LedgerGroup>

          <LedgerGroup title="Georgia Fees" subtitle="GA resident · auto-applied">
            <StaticRow label="Electronic Title" value={currency(georgiaFees.electronicTitleFee)} />
            <StaticRow label="Title Fee" value={currency(georgiaFees.titleFee)} />
            <StaticRow label="Registration" value={currency(georgiaFees.registrationFee)} />
            {(lead.vehicleClass === "New" || lead.vehicleClass === "Lease") && <StaticRow label="Lemon Law" value={currency(georgiaFees.lemonLawFee)} />}
          </LedgerGroup>

          {/* Live readout — the living quote, same language as the lease desk */}
          <Tilt max={4} className="living-border relative mt-4 rounded-[14px] bg-mission-gold/[0.07] p-5">
            <div className="readable-text mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-mission-gold/80">
              Estimated payment <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-mission-gold" />
            </div>
            <div className="glass-num-xl font-display text-[clamp(2.4rem,9vw,3.2rem)] font-black leading-none tracking-tight tabular-nums">{currency(desk.payment)}</div>
            <div className="mt-1.5 text-[11px] text-white/40">{form.term || 0} months @ {form.sellRate || 0}%</div>
            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2">
              {([
                ["Front", currency(desk.frontProfit), desk.frontProfit >= 0 ? "pos" : "neg"],
                ["Products", currency(desk.productTotal), "hot"],
                ["Tax credit", currency(desk.taxCredit), "plain"],
                ["GA tax", currency(desk.tax), "plain"],
                ["Fees", currency(desk.fees), "plain"],
                ["Amount financed", currency(desk.amountFinanced), "hot"],
              ] as const).map(([label, val, tone], i) => (
                <div key={i} className="flex items-baseline justify-between gap-2 border-b border-white/[0.07] pb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/45">{label}</span>
                  <span className={clsx("font-display text-sm font-black tabular-nums", tone === "neg" ? "text-mission-red" : tone === "pos" ? "text-mission-green" : tone === "hot" ? "glass-num" : "text-white/90")}>{val}</span>
                </div>
              ))}
            </div>
          </Tilt>
        </aside>

        {/* Worksheet */}
        <div className="space-y-5">
          <DealWorksheet lead={structured} />
        </div>
      </div>
      )}
    </div>
  );
}

// A labeled group of ledger rows — a bordered glass card with a section eyebrow.
function LedgerGroup({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 px-0.5">
        <span className="readable-text text-[11px] font-black uppercase tracking-[0.14em] text-white/45">{title}</span>
        {subtitle ? <span className="text-[10px] font-medium text-white/30">{subtitle}</span> : null}
      </div>
      <div className="divide-y divide-white/[0.06] rounded-[12px] border border-white/[0.07] bg-black/20 px-3">
        {children}
      </div>
    </div>
  );
}

// Ledger money row: label on the left, a compact $-prefixed input on the right.
function MoneyRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12.5px] font-medium text-white/60">{label}</span>
      <div className="flex h-9 w-[7.5rem] items-center gap-1 rounded-[9px] border border-white/10 bg-black/30 pl-2.5 pr-2 transition-colors focus-within:border-mission-gold/55 focus-within:bg-black/45">
        <span className="text-[12px] font-bold text-white/30">$</span>
        <input className="w-full bg-transparent text-right text-[13px] font-bold tabular-nums text-white outline-none" inputMode="decimal" value={value} placeholder="0" onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}

// Ledger row with a trailing unit (% or mo) instead of a leading $.
function UnitRow({ label, suffix, value, onChange }: { label: string; suffix: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12.5px] font-medium text-white/60">{label}</span>
      <div className="flex h-9 w-[7.5rem] items-center gap-1 rounded-[9px] border border-white/10 bg-black/30 pl-2.5 pr-2 transition-colors focus-within:border-mission-gold/55 focus-within:bg-black/45">
        <input className="w-full bg-transparent text-right text-[13px] font-bold tabular-nums text-white outline-none" inputMode="decimal" value={value} placeholder="0" onChange={(event) => onChange(event.target.value)} />
        <span className="text-[11px] font-bold uppercase text-white/30">{suffix}</span>
      </div>
    </div>
  );
}

// Read-only ledger row (the auto-applied Georgia fees).
function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12.5px] font-medium text-white/50">{label}</span>
      <span className="text-[13px] font-bold tabular-nums text-white/80">{value}</span>
    </div>
  );
}
