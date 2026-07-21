"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BadgeDollarSign, Calculator, HandCoins, KeyRound, Landmark, LayoutGrid, ShieldCheck, UserSquare2 } from "lucide-react";
import clsx from "clsx";
import { NextActionBar } from "@/components/NextActionBar";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { LeaseDesk, type LeaseSummary } from "@/components/LeaseDesk";
import { useAuth } from "@/components/AuthProvider";
import { useCrmLeads, type CrmLead } from "@/components/CrmProvider";
import { useDeals } from "@/components/DealProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { OfficeCheckCard } from "@/components/OfficeCheckCard";
import { calculateDesk, personLabel, tradeSummary } from "@/lib/desk";
import { canonicalPersonName, currency, parseMoneyInput, type Deal, type FinanceStatus, type OfficeManualKey } from "@/lib/data";
import { askIla } from "@/lib/askIla";

const PRODUCTS: { key: keyof CrmLead["products"]; label: string }[] = [
  { key: "vsc", label: "VSC" },
  { key: "gap", label: "GAP" },
  { key: "maintenance", label: "Maintenance" },
  { key: "permaplate", label: "Permaplate" },
  { key: "tws", label: "TWS" },
  { key: "utp", label: "UTP" },
];

type FinanceForm = {
  lender: string;
  financeManager: string;
  financeStatus: FinanceStatus;
  cashDeal: boolean;
  frontGross: string;
  reserve: string;
  sellRate: string;
  term: string;
  vsc: string;
  gap: string;
  maintenance: string;
  permaplate: string;
  tws: string;
  utp: string;
  // Back-end recap inputs
  buyRate: string;
  bankFee: string;
  roCharge: string;
  roNumber: string;
  weOwe: string;
};

type FinanceView = "deal" | "recap";

const inputClass = "h-11 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-mission-gold/60";

// Deal dates are LOCAL-day keys: a deal finalized at 9pm Eastern belongs to
// today, not (UTC) tomorrow — a late-evening delivery must never relabel the
// month (monthAnchor keys off the latest deal date).
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function FinanceDeskPage() {
  const { leads } = useCrmLeads();
  const queue = leads.filter((lead) => lead.status === "In Finance");
  const missingFm = queue.filter((lead) => !lead.financeManager).length;
  const fiRead = queue.length
    ? `${queue.length} deal${queue.length === 1 ? "" : "s"} in your F&I queue${missingFm ? ` · ${missingFm} still need a finance manager` : ""}. Close the oldest first and keep funding clean.`
    : "Your F&I queue is clear. Stay ready — the desk pushes deals straight here to finalize.";
  const fiAction = queue.length
    ? { label: `Finalize ${queue[0].customer || "the next deal"}`, sub: "Top of your queue", href: "#fi-queue" }
    : undefined;

  return (
    <div>
      <SectionHeader title="Finance" kicker="Work the deal up front, then flip to the back screen to recap" />
      <div className="mb-5"><NextActionBar read={fiRead} action={fiAction} tone={queue.length ? "amber" : "green"} /></div>

      {queue.length === 0 ? (
        <div className="glass-card mt-5 rounded-[12px] p-10 text-center">
          <HandCoins className="mx-auto h-10 w-10 text-mission-gold" />
          <div className="mt-4 font-display text-2xl font-black text-white">Your F&I queue is clear.</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/58">
            When a deal is structured and the customer agrees to numbers, the desk hits <strong className="text-white">Push to F&I</strong> in{" "}
            <Link href="/desking" className="text-mission-gold underline">Desking</Link> and it lands here to finalize.
          </p>
        </div>
      ) : (
        <FinanceQueue queue={queue} />
      )}
    </div>
  );
}

function FinanceQueue({ queue }: { queue: CrmLead[] }) {
  const [selectedId, setSelectedId] = useState(queue[0]?.id ?? "");
  const selected = queue.find((lead) => lead.id === selectedId) || queue[0];

  return (
    <div id="fi-queue" className="mt-5 grid scroll-mt-24 gap-5 xl:grid-cols-[320px_1fr]">
      <aside className="glass-card h-fit rounded-[12px] p-4">
        <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Deals In Finance</div>
        <div className="space-y-2">
          {queue.map((lead) => {
            const active = lead.id === selected?.id;
            return (
              <button
                key={lead.id}
                type="button"
                onClick={() => setSelectedId(lead.id)}
                className={`w-full rounded-[12px] border p-3 text-left transition ${active ? "border-mission-gold/60 bg-mission-gold/10" : "border-white/10 bg-[#14161c]/70 hover:border-mission-gold/30"}`}
              >
                <div className="font-bold text-white">{lead.customer || "Customer"}</div>
                <div className="mt-1 text-xs text-white/56">{lead.vehicle || "TBD"} | {personLabel(lead.salesperson)}</div>
              </button>
            );
          })}
        </div>
      </aside>

      {selected ? <FinalizePanel key={selected.id} lead={selected} /> : null}
    </div>
  );
}

function FinalizePanel({ lead }: { lead: CrmLead }) {
  const router = useRouter();
  const { profile } = useAuth();
  const { updateLead } = useCrmLeads();
  const { addDeal } = useDeals();
  const { lienholders, financeManagers } = useTeamLists();
  const { settings } = useStoreSettings();

  const desk = useMemo(() => calculateDesk(lead), [lead]);
  const defaultFm = financeManagers.includes(canonicalPersonName(profile?.employeeName || ""))
    ? canonicalPersonName(profile?.employeeName || "")
    : lead.financeManager || financeManagers[0] || "";

  const [form, setForm] = useState<FinanceForm>({
    lender: "",
    financeManager: defaultFm,
    financeStatus: "Classified",
    cashDeal: false,
    frontGross: String(lead.sellingPrice - lead.unitCost || ""), // a front-end LOSER must show negative, never a silent $0
    reserve: "",
    sellRate: String(lead.sellRate || lead.rate || ""),
    term: String(lead.term || 72),
    vsc: String(lead.products.vsc || ""),
    gap: String(lead.products.gap || ""),
    maintenance: String(lead.products.maintenance || ""),
    permaplate: String(lead.products.permaplate || ""),
    tws: String(lead.products.tws || ""),
    utp: String(lead.products.utp || ""),
    buyRate: String(lead.buyRate || ""),
    bankFee: "",
    roCharge: "",
    roNumber: "",
    weOwe: lead.weOwe || "",
  });
  const [view, setView] = useState<FinanceView>("deal");
  // Finance AUTO-KNOWS the deal type — it carries over from how it was desked
  // (vehicleClass "Lease" was set at the Retail/Lease tab). The FM lands on the
  // right desk without re-picking, but can override if the desk got it wrong.
  const [dealType, setDealType] = useState<"retail" | "lease">(lead.vehicleClass === "Lease" ? "lease" : "retail");
  // Latest lease summary from the embedded lease desk (captured for finalize).
  const leaseSummaryRef = useRef<LeaseSummary | null>(null);
  const [done, setDone] = useState(false);
  const [office, setOffice] = useState<{ checklist: Partial<Record<OfficeManualKey, boolean>>; ready: boolean }>({ checklist: {}, ready: false });

  function set<K extends keyof FinanceForm>(key: K, value: FinanceForm[K]) {
    setDone(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  const productTotal = PRODUCTS.reduce((sum, p) => sum + parseMoneyInput(form[p.key]), 0);
  const reserve = parseMoneyInput(form.reserve);
  const grossFront = parseMoneyInput(form.frontGross);
  const bankFee = parseMoneyInput(form.bankFee);
  const roCharge = parseMoneyInput(form.roCharge);
  // Back-end charges pull OUT of the FRONT gross (Aaron's accounting): bank fee
  // and RO / we-owe both reduce the front. Back gross = product profit + reserve.
  const frontGross = grossFront - bankFee - roCharge;
  const backGross = productTotal + reserve;
  const totalGross = frontGross + backGross;
  const buyRate = parseMoneyInput(form.buyRate);
  const sellRateNum = parseMoneyInput(form.sellRate);
  const spread = Math.max(sellRateNum - buyRate, 0);
  const productCount = PRODUCTS.filter((p) => parseMoneyInput(form[p.key]) > 0).length;

  // Live preview deal so the office-clean gate reflects the numbers as they're
  // keyed. Mirrors the Deal built in finalize(); the manual checks + Ready flag
  // live in `office` and are persisted into the real deal on Finalize.
  const previewDeal: Deal = useMemo(
    () => ({
      id: "preview",
      date: localDateKey(),
      customer: lead.customer || "Customer",
      stockNumber: lead.stockNumber || "Pending",
      vin: lead.vin || "Pending",
      vehicleClass: lead.vehicleClass === "Lease" ? "New" : lead.vehicleClass,
      salesperson: lead.salesperson,
      manager: lead.deskManager || "Desk Manager",
      financeManager: form.financeManager,
      lender: form.cashDeal ? "Cash" : form.lender,
      tradeInfo: "",
      frontGross,
      docFee: lead.docFee ?? settings.docFee, // the STORE's doc fee, never a hardcoded 899
      backGrossReserve: backGross,
      reserve,
      buyRate: buyRate || undefined,
      sellRate: sellRateNum || undefined,
      bankFee: bankFee || undefined,
      weOwe: form.weOwe || undefined,
      roNumber: form.roNumber || undefined,
      products: {
        vsc: parseMoneyInput(form.vsc) > 0,
        gap: parseMoneyInput(form.gap) > 0,
        maintenance: parseMoneyInput(form.maintenance) > 0,
        permaplate: parseMoneyInput(form.permaplate) > 0,
        tws: parseMoneyInput(form.tws) > 0,
        utp: parseMoneyInput(form.utp) > 0,
      },
      financeStatus: form.financeStatus,
      cashDeal: form.cashDeal,
      stage: "Delivered",
      missionDebrief: "",
      officeChecklist: office.checklist,
      readyToPost: office.ready,
      isLease: dealType === "lease",
    }),
    [form, frontGross, backGross, reserve, buyRate, sellRateNum, bankFee, lead, office, dealType, settings.docFee],
  );

  function finalize() {
    if (!form.cashDeal && !form.lender) {
      window.alert("Pick the bank / lienholder, or mark this a cash deal.");
      return;
    }
    if (!form.financeManager) {
      window.alert("Select the F&I manager finalizing this deal.");
      return;
    }
    const deal: Deal = {
      id: `FI-${Date.now().toString(36).toUpperCase()}-${lead.id}`,
      date: localDateKey(),
      customer: lead.customer || "Customer",
      stockNumber: lead.stockNumber || "Pending",
      vin: lead.vin || "Pending",
      vehicleClass: lead.vehicleClass === "Lease" ? "New" : lead.vehicleClass,
      salesperson: lead.salesperson,
      manager: lead.deskManager || "Desk Manager",
      financeManager: form.financeManager,
      lender: form.cashDeal ? "Cash" : form.lender,
      tradeInfo: tradeSummary(lead) || lead.tradeNotes || "No trade entered",
      tradeYear: lead.tradeYear || undefined,
      tradeMake: lead.tradeMake || undefined,
      tradeModel: lead.tradeModel || undefined,
      tradeAcv: lead.tradeAcv || undefined,
      tradePayoff: lead.payoff || undefined,
      frontGross,
      docFee: lead.docFee ?? settings.docFee, // the STORE's doc fee, never a hardcoded 899
      backGrossReserve: backGross,
      reserve,
      buyRate: buyRate || undefined,
      sellRate: sellRateNum || undefined,
      bankFee: bankFee || undefined,
      weOwe: form.weOwe || undefined,
      roNumber: form.roNumber || undefined,
      products: {
        vsc: parseMoneyInput(form.vsc) > 0,
        gap: parseMoneyInput(form.gap) > 0,
        maintenance: parseMoneyInput(form.maintenance) > 0,
        permaplate: parseMoneyInput(form.permaplate) > 0,
        tws: parseMoneyInput(form.tws) > 0,
        utp: parseMoneyInput(form.utp) > 0,
      },
      financeStatus: form.financeStatus,
      cashDeal: form.cashDeal,
      stage: "Delivered",
      rdrStatus: "Not Punched",
      missionDebrief: lead.notes || "Finalized in F&I.",
      officeChecklist: office.checklist,
      readyToPost: office.ready,
      readyToPostAt: office.ready ? new Date().toISOString() : undefined,
      isLease: dealType === "lease",
      leaseMonthlyPayment: dealType === "lease" ? leaseSummaryRef.current?.monthlyPayment : undefined,
      leaseTermMonths: dealType === "lease" ? leaseSummaryRef.current?.termMonths : undefined,
      leaseDueAtSigning: dealType === "lease" ? leaseSummaryRef.current?.dueAtSigning : undefined,
    };
    addDeal(deal);
    updateLead(lead.id, { status: "Won", financeManager: form.financeManager, products: {
      vsc: parseMoneyInput(form.vsc), gap: parseMoneyInput(form.gap), maintenance: parseMoneyInput(form.maintenance),
      permaplate: parseMoneyInput(form.permaplate), tws: parseMoneyInput(form.tws), utp: parseMoneyInput(form.utp),
    } });
    setDone(true);
    router.push("/deal-center");
  }

  return (
    <div className="space-y-5">
      <section className="glass-card flex flex-wrap items-center justify-between gap-4 rounded-[12px] p-5">
        <div className="flex items-center gap-3">
          <UserSquare2 className="h-7 w-7 text-mission-gold" />
          <div>
            <div className="font-display text-2xl font-black text-white">{lead.customer || "Customer"}</div>
            <div className="text-sm text-white/56">{personLabel(lead.salesperson)} | {lead.vehicle || "TBD"}{lead.stockNumber ? ` | ${lead.stockNumber}` : ""} | {lead.vehicleClass}</div>
          </div>
        </div>
        <Link href={`/desking?lead=${lead.id}`} className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/70 transition hover:border-mission-gold/40 hover:text-white">Back to Desk</Link>
      </section>

      {/* Retail | Lease — auto-set from how the deal was desked; FM can override */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border border-white/10 bg-black/30 p-1">
          {([["retail", "Retail", Calculator], ["lease", "Lease", KeyRound]] as const).map(([key, label, Icon]) => {
            const active = dealType === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDealType(key)}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-full px-5 py-1.5 text-xs font-black uppercase tracking-[0.12em] transition-all duration-300",
                  active ? "bg-mission-gold text-mission-navy shadow-gold" : "text-white/55 hover:text-white/85"
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] text-white/35">{dealType === "lease" ? "Pushed as a lease — opened on the lease desk" : "Pushed as a retail deal"}</span>
      </div>

      {dealType === "lease" && (
        <section className="glass-card rounded-[12px] p-5">
          <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-white"><KeyRound className="h-5 w-5 text-mission-gold" /> Lease — structure &amp; present</div>
          <LeaseDesk
            initialCustomer={lead.customer}
            initialVehicle={lead.vehicle}
            initialSellingPrice={lead.sellingPrice || undefined}
            onResult={(s) => { leaseSummaryRef.current = s; }}
          />
        </section>
      )}

      {/* F&I close — front gross, products, reserve, office gate, finalize. Shared
          by retail and lease; a lease finalizes as a New unit flagged isLease. */}
      {/* Front (Deal) ↔ Back (Recap) — one screen, flip to the back to true up costs */}
      <div className="flex gap-2">
        {([
          { v: "deal", label: "Deal", sub: "Sell & structure", Icon: Landmark },
          { v: "recap", label: "Recap", sub: "Back-end costs", Icon: Calculator },
        ] as const).map(({ v, label, sub, Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-[12px] border px-4 py-3 text-sm font-black uppercase tracking-[0.1em] transition ${
              view === v ? "border-mission-gold/60 bg-mission-gold/15 text-white" : "border-white/10 bg-[#14161c]/60 text-white/50 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
            <span className="hidden text-[10px] font-bold normal-case tracking-normal text-white/40 sm:inline">· {sub}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {view === "deal" ? (
          <>
          {/* Bank + finance */}
          <section className="glass-card rounded-[12px] p-5">
            <div className="mb-4 flex items-center gap-2 font-display text-lg font-black text-white"><Landmark className="h-5 w-5 text-mission-gold" /> Bank &amp; Finance</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Bank / Lienholder">
                <select className={inputClass} value={form.lender} onChange={(e) => set("lender", e.target.value)} disabled={form.cashDeal} required>
                  <option value="">— Select bank —</option>
                  {lienholders.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="F&I Manager">
                <select className={inputClass} value={form.financeManager} onChange={(e) => set("financeManager", e.target.value)}>
                  <option value="">— Select —</option>
                  {financeManagers.map((m) => <option key={m} value={m}>{personLabel(m)}</option>)}
                </select>
              </Field>
              <Field label="Finance Status">
                <select className={inputClass} value={form.financeStatus} onChange={(e) => set("financeStatus", e.target.value as FinanceStatus)}>
                  <option value="Classified">Finance</option>
                  <option value="Not Classified">Cash</option>
                  <option value="DNQ">DNQ</option>
                </select>
              </Field>
              <Field label="Sell Rate %"><input className={inputClass} inputMode="decimal" value={form.sellRate} onChange={(e) => set("sellRate", e.target.value)} placeholder="8.99" /></Field>
              <Field label="Term (months)"><input className={inputClass} inputMode="numeric" value={form.term} onChange={(e) => set("term", e.target.value)} placeholder="72" /></Field>
              <label className="flex h-full min-h-[44px] items-center gap-3 rounded-[12px] border border-white/10 bg-[#14161c]/70 px-3 text-sm font-bold text-white/70">
                <input type="checkbox" checked={form.cashDeal} onChange={(e) => set("cashDeal", e.target.checked)} className="h-5 w-5 accent-mission-gold" />
                Cash deal
              </label>
            </div>
          </section>

          {/* Products */}
          <section className="glass-card rounded-[12px] p-5">
            <div className="mb-4 flex items-center gap-2 font-display text-lg font-black text-white"><ShieldCheck className="h-5 w-5 text-mission-gold" /> Products Added</div>
            <div className="grid gap-3 sm:grid-cols-3">
              {PRODUCTS.map((p) => (
                <Field key={p.key} label={`${p.label} ($ profit)`}>
                  <input className={inputClass} inputMode="decimal" value={form[p.key]} onChange={(e) => set(p.key, e.target.value)} placeholder="0" />
                </Field>
              ))}
            </div>
            <div className="mt-3 text-xs text-white/48">{productCount} product{productCount === 1 ? "" : "s"} on the car · product profit {currency(productTotal)}</div>
          </section>

          {/* Front gross */}
          <section className="glass-card rounded-[12px] p-5">
            <div className="mb-4 flex items-center gap-2 font-display text-lg font-black text-white"><BadgeDollarSign className="h-5 w-5 text-mission-gold" /> Front Gross</div>
            <Field label="Front Gross (before doc, before back-end charges)"><input className={inputClass} inputMode="decimal" value={form.frontGross} onChange={(e) => set("frontGross", e.target.value)} placeholder="0" /></Field>
            <p className="mt-2 text-xs text-white/45">Bank fee and RO / we-owe charges come out of this on the Recap tab.</p>
          </section>

          {/* Menu seam — a third-party menu (e.g. Darwin) plugs in here later */}
          <section className="glass-card rounded-[12px] border-dashed border-white/15 p-5">
            <div className="mb-2 flex items-center gap-2 font-display text-lg font-black text-white/80"><LayoutGrid className="h-5 w-5 text-mission-gold" /> Product Menu</div>
            <p className="text-sm leading-6 text-white/55">Your product menu (e.g. Darwin) plugs in here.</p>
          </section>
          </>
          ) : (
          /* Back-end Recap — the "back screen" */
          <section className="glass-card rounded-[12px] p-5">
            <div className="mb-1 flex items-center gap-2 font-display text-lg font-black text-white"><Calculator className="h-5 w-5 text-mission-gold" /> Back-End Recap</div>
            <p className="mb-4 text-xs leading-5 text-white/45">Done after the deal — true up the cost side. Reserve adds to back gross; bank fee and RO / we-owe pull out of the front. Numbers sync to the Deal tab.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Buy Rate %"><input className={inputClass} inputMode="decimal" value={form.buyRate} onChange={(e) => set("buyRate", e.target.value)} placeholder="6.49" /></Field>
              <Field label="Sell Rate %"><input className={inputClass} inputMode="decimal" value={form.sellRate} onChange={(e) => set("sellRate", e.target.value)} placeholder="8.99" /></Field>
              <Field label="Finance Reserve"><input className={inputClass} inputMode="decimal" value={form.reserve} onChange={(e) => set("reserve", e.target.value)} placeholder="0" /></Field>
              <Field label="Bank / Acq Fee"><input className={inputClass} inputMode="decimal" value={form.bankFee} onChange={(e) => set("bankFee", e.target.value)} placeholder="0" /></Field>
              <Field label="RO / We-Owe Charge"><input className={inputClass} inputMode="decimal" value={form.roCharge} onChange={(e) => set("roCharge", e.target.value)} placeholder="0" /></Field>
              <Field label="RO #"><input className={inputClass} value={form.roNumber} onChange={(e) => set("roNumber", e.target.value)} placeholder="RO-1234" /></Field>
            </div>
            <div className="mt-3"><Field label="We-Owe (notes)"><input className={inputClass} value={form.weOwe} onChange={(e) => set("weOwe", e.target.value)} placeholder="Second key, touch-up, ..." /></Field></div>
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-[12px] border border-white/10 bg-white/[0.03] p-3 text-sm">
              <div className="text-white/55">Rate Spread</div><div className="text-right font-bold text-white">{spread ? `${spread.toFixed(2)}%` : "—"}</div>
              <div className="text-white/55">Amount Financed</div><div className="text-right font-bold text-white">{currency(desk.amountFinanced)}</div>
            </div>
          </section>
          )}
        </div>

        {/* Summary rail */}
        <aside className="space-y-5">
          <section className="glass-card rounded-[12px] p-5">
            <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Desked Numbers</div>
            <SummaryLine label="Selling Price" value={currency(lead.sellingPrice)} />
            <SummaryLine label="Unit Cost" value={currency(lead.unitCost)} />
            <SummaryLine label="Trade Allowance" value={currency(lead.tradeValue)} />
            <SummaryLine label="Payoff" value={currency(lead.payoff)} />
            <SummaryLine label="Amount Financed" value={currency(desk.amountFinanced)} />
            {/* Tap-to-explain — this worksheet isn't saved yet, so the live
                numbers ride inside the prompt for EILA to walk. */}
            <SummaryLine
              label="Est. Payment"
              value={currency(desk.payment)}
              onExplain={() => askIla(`I'm working ${lead.customer || "a customer"}'s deal at the F&I desk. Explain the estimated payment of ${currency(desk.payment)} — amount financed ${currency(desk.amountFinanced)} at ${form.sellRate || "the sell rate"}% for ${form.term || "?"} months. Walk the math in plain words and flag anything off.`)}
            />
          </section>

          <section className="glass-card rounded-[12px] p-5">
            <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Gross Recap</div>
            <SummaryLine label="Front Gross" value={currency(grossFront)} />
            {bankFee > 0 && <SummaryLine label="− Bank / Acq Fee" value={`(${currency(bankFee)})`} />}
            {roCharge > 0 && <SummaryLine label="− RO / We-Owe" value={`(${currency(roCharge)})`} />}
            <SummaryLine label="Net Front" value={currency(frontGross)} />
            <SummaryLine label="Product Profit" value={currency(productTotal)} />
            <SummaryLine label="Reserve" value={currency(reserve)} />
            <SummaryLine label="Back Gross" value={currency(backGross)} />
            <button
              type="button"
              onClick={() => askIla(`I'm recapping ${lead.customer || "a customer"}'s deal at the F&I desk. Explain the total gross of ${currency(totalGross)}: front ${currency(grossFront)}${bankFee > 0 ? ` minus bank fee ${currency(bankFee)}` : ""}${roCharge > 0 ? ` minus RO/we-owe ${currency(roCharge)}` : ""} = net front ${currency(frontGross)}, plus products ${currency(productTotal)} and reserve ${currency(reserve)} = back ${currency(backGross)}. Check my math in plain words and flag anything off.`)}
              title="Tap — EILA checks this recap"
              className="mt-2 flex w-full items-center justify-between border-t border-white/10 pt-3 text-left"
            >
              <span className="text-sm font-bold text-white/70">Total Gross <span className="ml-1 text-[9px] font-black uppercase tracking-[0.18em] text-white/25">ask EILA why</span></span>
              <strong className="font-display text-xl font-black text-mission-gold">{currency(totalGross)}</strong>
            </button>
          </section>

          <OfficeCheckCard
            deal={previewDeal}
            onToggleManual={(key) => setOffice((o) => ({ ...o, checklist: { ...o.checklist, [key]: !o.checklist[key] } }))}
            onMarkReady={(ready) => setOffice((o) => ({ ...o, ready }))}
          />

          <button
            type="button"
            onClick={finalize}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110"
          >
            <HandCoins className="h-4 w-4" />
            Finalize Deal
          </button>
          {done && <div className="rounded-[12px] border border-mission-green/30 bg-mission-green/10 p-3 text-center text-sm font-bold text-mission-green">Deal finalized.</div>}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-white/42">{label}</span>
      {children}
    </label>
  );
}

// Tap-to-explain: pass onExplain and the line renders as a button — EILA walks
// the number. Plain div otherwise.
function SummaryLine({ label, value, onExplain }: { label: string; value: string; onExplain?: () => void }) {
  const body = (
    <>
      <span className="text-sm text-white/56">{label}{onExplain && <span className="ml-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-white/25">ask EILA why</span>}</span>
      <strong className="text-sm font-bold text-white">{value}</strong>
    </>
  );
  if (onExplain) {
    return (
      <button type="button" onClick={onExplain} title="Tap — EILA explains this number" className="flex w-full items-center justify-between gap-3 border-b border-white/8 py-2 text-left last:border-b-0">
        {body}
      </button>
    );
  }
  return <div className="flex items-center justify-between gap-3 border-b border-white/8 py-2 last:border-b-0">{body}</div>;
}
