"use client";

import { useEffect, useMemo, useState, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ClipboardCheck, Pencil, Save } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { currency, displayPersonName, financeStatusLabel, manufacturerMoney, parseMoneyInput, productUnits, type Deal, type DealStage, type FinanceStatus, type RdrStatus, type VehicleClass } from "@/lib/data";
import { decodeVin, isValidVin } from "@/lib/vin";

type ProductKey = keyof Deal["products"];

const productKeys: ProductKey[] = ["vsc", "gap", "maintenance", "permaplate", "tws", "utp"];

const inputClass = "h-11 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-mission-gold/60";
const labelClass = "mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-white/42";

const blankForm = {
  date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })(), // LOCAL day — a 9pm deal is today's, not UTC-tomorrow's
  dealNumber: "",
  customer: "",
  customerAddress: "",
  stockNumber: "",
  vin: "",
  vehicleClass: "New" as VehicleClass,
  salesperson: "",
  salesperson2: "",
  manager: "",
  financeManager: "",
  lender: "",
  tradeInfo: "",
  tradeYear: "",
  tradeMake: "",
  tradeModel: "",
  tradeVin: "",
  tradeAcv: "",
  tradePayoff: "",
  frontGross: "",
  docFee: "899",
  backGrossReserve: "",
  reserve: "",
  invoiceAmount: "",
  financeStatus: "Classified" as FinanceStatus,
  cashDeal: false,
  stage: "Delivered" as DealStage,
  rdrStatus: "Not Punched" as RdrStatus,
  rdrDate: "",
  rdrNotes: "",
  missionDebrief: "",
  products: {
    vsc: false,
    gap: false,
    maintenance: false,
    permaplate: false,
    tws: false,
    utp: false,
  },
};

function DealEntryInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id") ?? null;
  const { deals, addDeal, updateDeal } = useDeals();
  const { salespeople, managers, financeManagers, lienholders } = useTeamLists();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(blankForm);
  const editLoaded = useRef(false);
  // The doc-fee default is the STORE's configured fee — the "899" in blankForm
  // is only the pre-settings placeholder (Kennesaw's number). Sync it once the
  // org's settings land, unless the user already typed their own.
  const { settings } = useStoreSettings();
  useEffect(() => {
    if (editId) return;
    setForm((current) => (current.docFee === blankForm.docFee ? { ...current, docFee: String(settings.docFee) } : current));
  }, [settings.docFee, editId]);
  // NHTSA VIN decode feedback — sold unit gets a confirmation line, trade VIN
  // auto-fills year/make/model. "idle" until a full 17-char VIN is typed.
  const [vinRead, setVinRead] = useState<{ status: "idle" | "decoding" | "ok" | "fail"; vehicle?: string }>({ status: "idle" });
  const [tradeVinRead, setTradeVinRead] = useState<{ status: "idle" | "decoding" | "ok" | "fail"; vehicle?: string }>({ status: "idle" });

  const editDeal = editId ? deals.find((d) => d.id === editId) ?? null : null;

  // Load edit deal into form once teams are available
  useEffect(() => {
    if (!editDeal || editLoaded.current || !salespeople.length) return;
    editLoaded.current = true;
    setForm({
      date: editDeal.date,
      dealNumber: editDeal.dealNumber || "",
      customer: editDeal.customer,
      customerAddress: editDeal.customerAddress || "",
      stockNumber: editDeal.stockNumber,
      vin: editDeal.vin,
      vehicleClass: editDeal.vehicleClass,
      salesperson: editDeal.salesperson,
      salesperson2: editDeal.salesperson2 || "",
      manager: editDeal.manager,
      financeManager: editDeal.financeManager,
      lender: editDeal.cashDeal ? (lienholders[0] || "") : editDeal.lender,
      tradeInfo: editDeal.tradeInfo === "No trade entered" ? "" : editDeal.tradeInfo,
      tradeYear: editDeal.tradeYear || "",
      tradeMake: editDeal.tradeMake || "",
      tradeModel: editDeal.tradeModel || "",
      tradeVin: editDeal.tradeVin || "",
      tradeAcv: typeof editDeal.tradeAcv === "number" ? String(editDeal.tradeAcv) : "",
      tradePayoff: typeof editDeal.tradePayoff === "number" ? String(editDeal.tradePayoff) : "",
      frontGross: editDeal.frontGross ? String(editDeal.frontGross) : "",
      docFee: editDeal.docFee != null ? String(editDeal.docFee) : "899",
      backGrossReserve: editDeal.backGrossReserve ? String(editDeal.backGrossReserve) : "",
      reserve: editDeal.reserve ? String(editDeal.reserve) : "",
      invoiceAmount: editDeal.invoiceAmount ? String(editDeal.invoiceAmount) : "",
      financeStatus: editDeal.financeStatus,
      cashDeal: editDeal.cashDeal ?? false,
      stage: editDeal.stage,
      rdrStatus: editDeal.rdrStatus || "Not Punched",
      rdrDate: editDeal.rdrDate || "",
      rdrNotes: editDeal.rdrNotes || "",
      missionDebrief: editDeal.missionDebrief === "No debrief entered." ? "" : editDeal.missionDebrief,
      products: {
        vsc: editDeal.products.vsc ?? false,
        gap: editDeal.products.gap ?? false,
        maintenance: editDeal.products.maintenance ?? false,
        permaplate: editDeal.products.permaplate ?? false,
        tws: editDeal.products.tws ?? false,
        utp: editDeal.products.utp ?? false,
      },
    });
  }, [editDeal, salespeople, lienholders]);

  // Set team defaults only when not in edit mode
  useEffect(() => {
    if (editLoaded.current) return;
    setForm((current) => ({
      ...current,
      // Salesperson + F&I Manager are required and must be picked explicitly so a
      // deal is never silently credited to the first name in the list.
      salesperson: salespeople.includes(current.salesperson) ? current.salesperson : "",
      manager: managers.includes(current.manager) ? current.manager : managers[0] || "",
      financeManager: financeManagers.includes(current.financeManager) ? current.financeManager : "",
      lender: lienholders.includes(current.lender) ? current.lender : lienholders[0] || "",
    }));
  }, [financeManagers, lienholders, managers, salespeople]);

  const preview = useMemo<Deal>(() => ({
    id: editDeal?.id ?? "D41-NEW",
    date: form.date,
    dealNumber: form.dealNumber.trim() || undefined,
    customer: form.customer || "Customer name required",
    customerAddress: form.customerAddress.trim() || undefined,
    stockNumber: form.stockNumber || "Pending",
    vin: form.vin || "Pending",
    vehicleClass: form.vehicleClass,
    salesperson: form.salesperson,
    salesperson2: form.salesperson2 || undefined,
    manager: form.manager,
    financeManager: form.financeManager,
    lender: form.cashDeal ? "Cash" : form.lender,
    tradeInfo: form.tradeInfo || "No trade entered",
    tradeYear: form.tradeYear || undefined,
    tradeMake: form.tradeMake || undefined,
    tradeModel: form.tradeModel || undefined,
    tradeVin: form.tradeVin || undefined,
    tradeAcv: form.tradeAcv ? parseMoneyInput(form.tradeAcv) : undefined,
    tradePayoff: form.tradePayoff ? parseMoneyInput(form.tradePayoff) : undefined,
    frontGross: parseMoneyInput(form.frontGross),
    backGrossReserve: parseMoneyInput(form.backGrossReserve),
    reserve: parseMoneyInput(form.reserve),
    docFee: form.vehicleClass === "Wholesale" ? 0 : parseMoneyInput(form.docFee),
    invoiceAmount: form.vehicleClass === "New" ? parseMoneyInput(form.invoiceAmount) || undefined : undefined,
    products: form.products,
    financeStatus: form.financeStatus,
    cashDeal: form.cashDeal,
    stage: form.stage,
    rdrStatus: form.rdrStatus,
    rdrDate: form.rdrDate,
    rdrNotes: form.rdrNotes,
    missionDebrief: form.missionDebrief || "No debrief entered.",
  }), [editDeal, form]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Decode the moment a full 17-char VIN lands (same brain as CRM Desk). The
  // sold unit shows a confirmation line; the trade fills year/make/model —
  // decoder values only overwrite when they exist, so manual edits survive.
  async function handleVinChange(raw: string) {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17);
    update("vin", v);
    if (v.length !== 17 || !isValidVin(v)) {
      setVinRead({ status: "idle" });
      return;
    }
    setVinRead({ status: "decoding" });
    const decoded = await decodeVin(v);
    setVinRead(decoded ? { status: "ok", vehicle: decoded.vehicle } : { status: "fail" });
  }

  async function handleTradeVinChange(raw: string) {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17);
    update("tradeVin", v);
    if (v.length !== 17 || !isValidVin(v)) {
      setTradeVinRead({ status: "idle" });
      return;
    }
    setTradeVinRead({ status: "decoding" });
    const decoded = await decodeVin(v);
    if (!decoded) {
      setTradeVinRead({ status: "fail" });
      return;
    }
    setForm((current) => ({
      ...current,
      tradeVin: v,
      tradeYear: decoded.year || current.tradeYear,
      tradeMake: decoded.make || current.tradeMake,
      tradeModel: [decoded.model, decoded.trim].filter(Boolean).join(" ") || current.tradeModel,
    }));
    setTradeVinRead({ status: "ok", vehicle: decoded.vehicle });
  }

  function toggleProduct(key: ProductKey) {
    setSaved(false);
    setForm((current) => ({
      ...current,
      products: { ...current.products, [key]: !current.products[key] },
    }));
  }

  function submitDeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.salesperson2 && form.salesperson2 === form.salesperson) {
      window.alert("A split deal needs two different salespeople. Clear Salesperson 2 for a solo deal.");
      return;
    }
    if (editId) {
      updateDeal(editId, preview);
    } else {
      addDeal({ ...preview, id: makeDealId() });
    }
    setSaved(true);
    router.push("/deal-center");
  }

  const isEditing = !!editId;

  return (
    <div>
      <SectionHeader
        title={isEditing ? `Editing ${editDeal?.customer ?? "Deal"}` : "Deal Entry Console"}
        kicker={isEditing ? `Deal ID: ${editId}` : "Launching a mission"}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <form onSubmit={submitDeal} className="glass-card rounded-[12px] p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.24em] text-mission-gold">
                {isEditing ? "Edit Mode" : "Mission Form"}
              </div>
              <div className="mt-2 font-display text-2xl font-black text-white">
                {isEditing ? "Update the deal." : "Enter the deal. Launch the mission."}
              </div>
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110"
            >
              {isEditing ? <Pencil className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {isEditing ? "Update Deal" : "Save Deal"}
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-4 font-display text-lg font-black text-white">Customer + Vehicle</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date"><input className={inputClass} type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></Field>
                <Field label="Deal #"><input className={inputClass} value={form.dealNumber} onChange={(event) => update("dealNumber", event.target.value)} placeholder="DMS deal number" /></Field>
                <Field label="Customer"><input className={inputClass} value={form.customer} onChange={(event) => update("customer", event.target.value)} placeholder="Customer name" required /></Field>
                <Field label="Customer Address"><input className={inputClass} value={form.customerAddress} onChange={(event) => update("customerAddress", event.target.value)} placeholder="Street, city, state, ZIP" autoComplete="off" /></Field>
                <Field label="Stock Number"><input className={inputClass} value={form.stockNumber} onChange={(event) => update("stockNumber", event.target.value)} placeholder="MZ24051" required /></Field>
                <Field label="VIN">
                  <input className={inputClass} value={form.vin} onChange={(event) => handleVinChange(event.target.value)} placeholder="17-character VIN" required />
                  <VinReadout read={vinRead} />
                </Field>
                <Field label="Vehicle Class">
                  <select className={inputClass} value={form.vehicleClass} onChange={(event) => update("vehicleClass", event.target.value as VehicleClass)}>
                    <option>New</option>
                    <option>Used</option>
                    <option>Wholesale</option>
                  </select>
                </Field>
                <Field label="Stage">
                  <select className={inputClass} value={form.stage} onChange={(event) => update("stage", event.target.value as DealStage)}>
                    <option value="Desk">Desk</option>
                    <option value="Contracted">Contracted</option>
                    <option value="Funded">Funded</option>
                    <option value="Delivered">Finalized</option>
                  </select>
                </Field>
                <Field label="RDR Status">
                  <select className={inputClass} value={form.rdrStatus} onChange={(event) => update("rdrStatus", event.target.value as RdrStatus)}>
                    <option>Not Punched</option>
                    <option>Pending</option>
                    <option>Punched</option>
                  </select>
                </Field>
                <Field label="RDR Date"><input className={inputClass} type="date" value={form.rdrDate} onChange={(event) => update("rdrDate", event.target.value)} /></Field>
              </div>
            </div>

            <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-4 font-display text-lg font-black text-white">Team + Finance</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Salesperson"><Select value={form.salesperson} options={salespeople} onChange={(value) => update("salesperson", value)} required placeholder="— Select salesperson —" /></Field>
                <Field label="Salesperson 2 (Split)">
                  <select
                    className={inputClass}
                    value={form.salesperson2}
                    onChange={(event) => update("salesperson2", event.target.value)}
                  >
                    <option value="">— Solo Deal —</option>
                    {salespeople.map((sp) => (
                      <option key={sp} value={sp}>{displayPersonName(sp)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Manager"><Select value={form.manager} options={managers} onChange={(value) => update("manager", value)} /></Field>
                <Field label="F&I Manager"><Select value={form.financeManager} options={financeManagers} onChange={(value) => update("financeManager", value)} required placeholder="— Select F&I manager —" /></Field>
                <Field label="Lienholder / Bank">
                  <Select value={form.cashDeal ? "Cash" : form.lender} options={lienholders} onChange={(value) => update("lender", value)} disabled={form.cashDeal} />
                </Field>
                <Field label="Finance Status">
                  <select className={inputClass} value={form.financeStatus} onChange={(event) => update("financeStatus", event.target.value as FinanceStatus)}>
                    <option value="Classified">Finance</option>
                    <option value="Not Classified">Cash</option>
                    <option value="DNQ">DNQ</option>
                  </select>
                </Field>
                <label className="flex h-full min-h-[44px] items-center gap-3 rounded-[12px] border border-white/10 bg-[#14161c]/70 px-3 text-sm font-bold text-white/70 col-span-2">
                  <input type="checkbox" checked={form.cashDeal} onChange={(event) => update("cashDeal", event.target.checked)} className="h-5 w-5 accent-mission-gold" />
                  Cash deal
                </label>
              </div>
            </div>

            <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-4 font-display text-lg font-black text-white">Gross + Products</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Front Gross Before Doc"><input className={inputClass} inputMode="decimal" value={form.frontGross} onChange={(event) => update("frontGross", event.target.value)} placeholder="0" required /></Field>
                <Field label="Doc Fee"><input className={inputClass} inputMode="decimal" value={form.docFee} onChange={(event) => update("docFee", event.target.value)} placeholder="899" /></Field>
                <Field label="Back Gross (incl. reserve)"><input className={inputClass} inputMode="decimal" value={form.backGrossReserve} onChange={(event) => update("backGrossReserve", event.target.value)} placeholder="0" required /></Field>
                <Field label="Finance Reserve (reference only)"><input className={inputClass} inputMode="decimal" value={form.reserve} onChange={(event) => update("reserve", event.target.value)} placeholder="0" /></Field>
                {form.vehicleClass === "New" && (
                  <Field label={`New Car Invoice (${Math.round(settings.holdbackPct * 100)}% holdback)`}><input className={inputClass} inputMode="decimal" value={form.invoiceAmount} onChange={(event) => update("invoiceAmount", event.target.value)} placeholder="Invoice amount" required /></Field>
                )}
              </div>
              {form.vehicleClass === "New" && parseMoneyInput(form.invoiceAmount) > 0 && (
                <div className="mt-3 flex items-center justify-between rounded-[12px] border border-mission-green/30 bg-mission-green/10 px-4 py-2.5 text-sm">
                  <span className="font-semibold text-white/70">Manufacturer {Math.round(settings.holdbackPct * 100)}% holdback</span>
                  <strong className="font-display text-base font-semibold text-mission-green">{currency(manufacturerMoney(preview))}</strong>
                </div>
              )}
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {productKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleProduct(key)}
                    className={`min-w-0 rounded-[12px] border px-2 py-3 text-[13px] font-black uppercase leading-tight tracking-[0.06em] transition ${
                      form.products[key] ? "border-mission-gold bg-mission-gold text-mission-navy" : "border-white/10 bg-[#14161c]/80 text-white/56 hover:text-white"
                    }`}
                  >
                    {key === "maintenance" ? "MAINT" : key.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-4 font-display text-lg font-black text-white">Trade + Debrief</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Trade Year"><input className={inputClass} value={form.tradeYear} onChange={(event) => update("tradeYear", event.target.value)} placeholder="2021" /></Field>
                <Field label="Make"><input className={inputClass} value={form.tradeMake} onChange={(event) => update("tradeMake", event.target.value)} placeholder="Mazda" /></Field>
                <Field label="Model"><input className={inputClass} value={form.tradeModel} onChange={(event) => update("tradeModel", event.target.value)} placeholder="CX-5" /></Field>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Trade VIN">
                  <input className={inputClass} value={form.tradeVin} onChange={(event) => handleTradeVinChange(event.target.value)} placeholder="VIN" />
                  <VinReadout read={tradeVinRead} />
                </Field>
                <Field label="ACV"><input className={inputClass} inputMode="decimal" value={form.tradeAcv} onChange={(event) => update("tradeAcv", event.target.value)} placeholder="0" /></Field>
                <Field label="Payoff"><input className={inputClass} inputMode="decimal" value={form.tradePayoff} onChange={(event) => update("tradePayoff", event.target.value)} placeholder="0" /></Field>
              </div>
              {(form.tradeAcv || form.tradePayoff) && (
                <div className="mt-3 flex items-center justify-between rounded-[12px] border border-mission-gold/30 bg-mission-gold/10 px-4 py-2.5 text-sm">
                  <span className="font-semibold text-white/70">Trade Equity (ACV − Payoff)</span>
                  <strong className="font-display text-base font-semibold text-mission-gold">{currency(parseMoneyInput(form.tradeAcv) - parseMoneyInput(form.tradePayoff))}</strong>
                </div>
              )}
              <label className="mt-3 block">
                <span className={labelClass}>Trade Notes</span>
                <textarea className="min-h-[84px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none focus:border-mission-gold/60" value={form.tradeInfo} onChange={(event) => update("tradeInfo", event.target.value)} placeholder="Appraisal notes, condition, source" />
              </label>
              <label className="mt-3 block">
                <span className={labelClass}>RDR Notes</span>
                <textarea className="min-h-[64px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none focus:border-mission-gold/60" value={form.rdrNotes} onChange={(event) => update("rdrNotes", event.target.value)} placeholder="RDR hold, missing info, punch note" />
              </label>
              <label className="mt-3 block">
                <span className={labelClass}>Mission Debrief</span>
                <textarea className="min-h-[84px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none focus:border-mission-gold/60" value={form.missionDebrief} onChange={(event) => update("missionDebrief", event.target.value)} placeholder="What happened? What needs attention?" />
              </label>
            </div>
          </div>
        </form>

        <aside className="space-y-5">
          <div className="glass-card rounded-[12px] p-5">
            <div className="flex items-center gap-3">
              <CalendarDays className="h-5 w-5 text-mission-gold" />
              <div className="font-display text-xl font-black text-white">Live Preview</div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-white/48">Customer</span><strong>{preview.customer}</strong></div>
              <div className="flex justify-between gap-4"><span className="text-white/48">Salesperson</span><strong>{displayPersonName(preview.salesperson)}{preview.salesperson2 ? ` / ${displayPersonName(preview.salesperson2)}` : ""}</strong></div>
              <div className="flex justify-between gap-4"><span className="text-white/48">Total Gross</span><strong>{currency(preview.frontGross + preview.backGrossReserve)}</strong></div>
              {preview.vehicleClass === "New" && (
                <div className="flex justify-between gap-4"><span className="text-white/48">Mfr {Math.round(settings.holdbackPct * 100)}% Holdback</span><strong className="text-mission-green">{currency(manufacturerMoney(preview))}</strong></div>
              )}
              <div className="flex justify-between gap-4"><span className="text-white/48">Products</span><strong>{productUnits(preview)}</strong></div>
              <div className="flex justify-between gap-4"><span className="text-white/48">Status</span><StatusPill tone={preview.financeStatus === "Classified" ? "green" : "blue"}>{financeStatusLabel(preview.financeStatus)}</StatusPill></div>
            </div>
            {saved && <div className="mt-4 rounded-[12px] border border-mission-green/30 bg-mission-green/10 p-3 text-sm font-bold text-mission-green">{isEditing ? "Deal updated." : "Deal saved."}</div>}
          </div>
          <div className="glass-card rounded-[12px] p-5">
            <div className="flex items-center gap-3">
              <ClipboardCheck className="h-5 w-5 text-mission-green" />
              <div className="font-display text-xl font-black text-white">Deal Center</div>
            </div>
            <Link href="/deal-center" className="mt-4 inline-flex rounded-full border border-mission-gold/40 px-4 py-2 text-sm font-bold text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
              View Deal Center
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function DealEntryPage() {
  return (
    <Suspense fallback={null}>
      <DealEntryInner />
    </Suspense>
  );
}

// Collision-safe unique id. The old `deals.length + 1` scheme reused ids after
// any deletion, which made edit/delete operations hit the wrong deal.
function makeDealId() {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `D41-${uuid.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

// One-line NHTSA decode readout under a VIN field: what the VIN actually is,
// so a fat-fingered character gets caught before the deal saves.
function VinReadout({ read }: { read: { status: "idle" | "decoding" | "ok" | "fail"; vehicle?: string } }) {
  if (read.status === "idle") return null;
  if (read.status === "decoding") return <span className="mt-1 block text-xs font-semibold text-white/45">Decoding VIN…</span>;
  if (read.status === "fail") return <span className="mt-1 block text-xs font-semibold text-mission-red">VIN didn&apos;t decode — double-check it</span>;
  return <span className="mt-1 block text-xs font-semibold text-mission-green">✓ {read.vehicle}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function Select({ value, options, onChange, disabled = false, required = false, placeholder }: { value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean; required?: boolean; placeholder?: string }) {
  return (
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {displayPersonName(option)}
        </option>
      ))}
    </select>
  );
}
