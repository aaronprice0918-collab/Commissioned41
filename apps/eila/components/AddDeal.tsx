"use client";

import { useRef, useState } from "react";
import { FileScan, Loader2, Minus, Plus, ScanLine } from "lucide-react";
import { Sheet, Labeled, parseNumericInput as num } from "./ui";
import { useMission } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { DealStatus, STATUS_LABEL } from "@/lib/types";
import { INDUSTRY_DEAL, statusLabel } from "@/lib/industry";
import { dealUnits, productDefs, usesProductMenu } from "@/lib/fni";
import clsx from "clsx";

const STATUSES: DealStatus[] = ["working", "pending", "finance", "delivered", "appointment", "prospect"];

// Industry-true deal entry: every label, placeholder, and even WHICH fields
// exist comes from the rep's industry spec — a realtor logs a closing with a
// GCI, a jeweler logs a piece with a sale amount, a car rep still gets
// front/back gross, products, and reserve. <60 seconds to log, always.
export function AddDeal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addDeal, data } = useMission();
  const industry = data.profile?.industry ?? "other";
  const spec = INDUSTRY_DEAL[industry];

  // F&I mode: per-deal product picks off the user's own menu, deal #, bank,
  // funding, salesperson splits — the depth THE LOGG has. Other industries
  // keep the lean form they already had.
  const fni = usesProductMenu(industry);
  const defs = productDefs(data.profile);

  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [item, setItem] = useState("");
  const [category, setCategory] = useState<string | undefined>(spec.categories?.[0]?.id);
  const [status, setStatus] = useState<DealStatus>("delivered");
  const [amount, setAmount] = useState("");
  const [secondary, setSecondary] = useState("");
  const [addons, setAddons] = useState(0);
  const [reserve, setReserve] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [dealNumber, setDealNumber] = useState("");
  const [bank, setBank] = useState("");
  const [funded, setFunded] = useState(true);
  const [salesperson, setSalesperson] = useState("");
  const [salesperson2, setSalesperson2] = useState("");
  const [noQualify, setNoQualify] = useState(false);
  const [productOnly, setProductOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const [recapScanning, setRecapScanning] = useState(false);
  const [recapMsg, setRecapMsg] = useState<string | null>(null);
  const recapInput = useRef<HTMLInputElement>(null);

  function reset() {
    setCustomer(""); setPhone(""); setItem(""); setCategory(spec.categories?.[0]?.id); setStatus("delivered");
    setAmount(""); setSecondary(""); setAddons(0); setReserve(""); setScanMsg(null); setRecapMsg(null);
    setProducts([]); setDealNumber(""); setBank(""); setFunded(true); setSalesperson(""); setSalesperson2(""); setNoQualify(false); setProductOnly(false);
  }

  // Snap the customer's ID → EILA reads it → the name drops in. No typing,
  // no misspells — same scanner the dealership product runs all day.
  async function scan(file: File) {
    setScanning(true); setScanMsg(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch("/api/scan-license", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ image: dataUrl }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.customer) { setScanMsg(j.error || "Couldn't read that — retake it sharp and well-lit."); return; }
      setCustomer(j.customer);
      setScanMsg(`Read ✓ ${j.customer}${j.city ? ` · ${j.city}${j.state ? `, ${j.state}` : ""}` : ""}`);
    } catch {
      setScanMsg("Couldn't read that — retake it sharp and well-lit.");
    } finally {
      setScanning(false);
      if (scanInput.current) scanInput.current.value = "";
    }
  }

  // Snap the deal recap / washout sheet → EILA reads the WHOLE deal — customer,
  // deal #, money, bank, salesperson, products off the user's own menu — and
  // fills every field. The rep glances and hits Save. Review-then-save on
  // purpose: money numbers never enter the log sight-unseen.
  async function scanRecap(file: File) {
    setRecapScanning(true); setRecapMsg(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch("/api/scan-recap", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ image: dataUrl, productMenu: defs.map((p) => p.label) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setRecapMsg(j.error || "Couldn't read that — retake it sharp and well-lit."); return; }
      if (j.customer) setCustomer(j.customer);
      if (j.vehicle) setItem(j.vehicle);
      if (j.category && spec.categories?.some((c) => c.id === j.category)) setCategory(j.category);
      if (j.dealNumber) setDealNumber(j.dealNumber);
      if (j.bank) setBank(j.bank);
      if (j.salesperson) setSalesperson(j.salesperson);
      if (j.salesperson2) setSalesperson2(j.salesperson2);
      if (typeof j.frontGross === "number" && j.frontGross !== 0) setAmount(String(j.frontGross));
      if (typeof j.backGross === "number" && j.backGross !== 0) setSecondary(String(j.backGross));
      if (typeof j.reserve === "number" && j.reserve !== 0) setReserve(String(j.reserve));
      if (Array.isArray(j.products) && j.products.length) {
        setProducts(defs.filter((p) => j.products.includes(p.label)).map((p) => p.id));
      }
      const got = [j.customer, j.vehicle, j.dealNumber && `#${j.dealNumber}`].filter(Boolean).join(" · ");
      setRecapMsg(`Read ✓ ${got || "recap"} — check it over, then save.`);
    } catch {
      setRecapMsg("Couldn't read that — retake it sharp and well-lit.");
    } finally {
      setRecapScanning(false);
      if (recapInput.current) recapInput.current.value = "";
    }
  }

  function save() {
    // In F&I mode the add-on count is DERIVED from the product picks using
    // the user's own unit weights — the pay engine keeps its contract.
    const fniUnits = dealUnits({ products } as never, defs);
    addDeal({
      date: new Date().toISOString(),
      customer: customer.trim(),
      phone: phone.trim() || undefined,
      item: item.trim(),
      category,
      amount: num(amount),
      secondary: spec.secondaryLabel ? num(secondary) : 0,
      addons: fni ? fniUnits : spec.addonsLabel ? addons : 0,
      reserve: spec.hasReserve ? num(reserve) : 0,
      status,
      ...(fni
        ? {
            products,
            dealNumber: dealNumber.trim() || undefined,
            bank: bank.trim() || undefined,
            funded,
            salesperson: salesperson.trim() || undefined,
            salesperson2: salesperson2.trim() || undefined,
            noQualify: noQualify || undefined,
            productOnly: productOnly || undefined,
          }
        : {}),
    });
    reset();
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log a deal">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Customer">
            <input className="field" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name" />
          </Labeled>
          <Labeled label={spec.itemLabel}>
            <input className="field" value={item} onChange={(e) => setItem(e.target.value)} placeholder={spec.itemPlaceholder} />
          </Labeled>
        </div>

        {/* Scan an ID → name drops in. Camera on phones, file picker on desktop. */}
        <input ref={scanInput} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void scan(f); }} />
        {/* F&I: scan the whole DEAL RECAP → EILA fills every field for review. */}
        <input ref={recapInput} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanRecap(f); }} />
        <div className={clsx("grid gap-2", fni ? "grid-cols-2" : "grid-cols-1")}>
          {fni && (
            <button type="button" onClick={() => recapInput.current?.click()} disabled={recapScanning}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-good/30 bg-good/10 px-3 py-2.5 text-sm font-semibold text-good transition active:scale-[0.99] disabled:opacity-60">
              {recapScanning ? <Loader2 size={16} className="animate-spin" /> : <FileScan size={16} />}
              {recapScanning ? "EILA is reading…" : "Scan deal recap"}
            </button>
          )}
          <button type="button" onClick={() => scanInput.current?.click()} disabled={scanning}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 text-sm font-semibold text-accent transition active:scale-[0.99] disabled:opacity-60">
            {scanning ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
            {scanning ? "EILA is reading it…" : "Scan customer ID"}
          </button>
        </div>
        {scanMsg && <p className={clsx("px-1 text-xs", scanMsg.startsWith("Read ✓") ? "text-good" : "text-warn")}>{scanMsg}</p>}
        {recapMsg && <p className={clsx("px-1 text-xs", recapMsg.startsWith("Read ✓") ? "text-good" : "text-warn")}>{recapMsg}</p>}

        <Labeled label="Phone (optional)">
          <input className="field tabnum" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
        </Labeled>

        {spec.categories && (
          <Labeled label="Type">
            <Segmented options={spec.categories.map((c) => ({ value: c.id, label: c.label }))} value={category ?? ""} onChange={setCategory} />
          </Labeled>
        )}

        <Labeled label="Status">
          <Segmented options={STATUSES.map((s) => ({ value: s, label: statusLabel(industry, s, STATUS_LABEL[s]) }))} value={status} onChange={(v) => setStatus(v as DealStatus)} wrap />
        </Labeled>

        <div className={clsx("grid gap-3", spec.secondaryLabel ? "grid-cols-2" : "grid-cols-1")}>
          <Labeled label={spec.amountLabel} hint={spec.secondaryLabel ? undefined : spec.amountHint}>
            <input className="field tabnum" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0" />
          </Labeled>
          {spec.secondaryLabel && (
            <Labeled label={spec.secondaryLabel}>
              <input className="field tabnum" inputMode="numeric" value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="$0" />
            </Labeled>
          )}
        </div>

        {fni ? (
          <>
            {/* Products off the user's own menu — tap what sold. Unit weights
                and spiffs come from Settings, not from any one store's plan. */}
            <Labeled label={`Products sold${products.length ? ` · ${dealUnits({ products } as never, defs)} units` : ""}`}>
              <div className="flex flex-wrap gap-2">
                {defs.map((p) => {
                  const on = products.includes(p.id);
                  return (
                    <button key={p.id} type="button"
                      onClick={() => setProducts((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                      className={clsx("rounded-xl px-3.5 py-2.5 text-sm font-semibold transition active:scale-95",
                        on ? "bg-good/90 text-white" : "bg-fg/6 text-fg/70")}>
                      {p.label}{p.units !== 1 ? ` (${p.units}u)` : ""}
                    </button>
                  );
                })}
              </div>
            </Labeled>

            <div className="grid grid-cols-2 gap-3">
              {spec.hasReserve && (
                <Labeled label="Reserve">
                  <input className="field tabnum" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value)} placeholder="$0" />
                </Labeled>
              )}
              <Labeled label="Deal #">
                <input className="field tabnum" value={dealNumber} onChange={(e) => setDealNumber(e.target.value)} placeholder="1234" />
              </Labeled>
              <Labeled label="Bank / lender">
                <input className="field" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Cash, credit union…" />
              </Labeled>
              <Labeled label="Funding">
                <Segmented options={[{ value: "yes", label: "Funded" }, { value: "no", label: "Waiting" }]} value={funded ? "yes" : "no"} onChange={(v) => setFunded(v === "yes")} />
              </Labeled>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Salesperson">
                <input className="field" value={salesperson} onChange={(e) => setSalesperson(e.target.value)} placeholder="Who sold it" />
              </Labeled>
              <Labeled label="Split with (50/50)">
                <input className="field" value={salesperson2} onChange={(e) => setSalesperson2(e.target.value)} placeholder="Optional" />
              </Labeled>
            </div>

            <button type="button" onClick={() => setNoQualify((v) => !v)}
              className={clsx("flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition active:scale-[0.99]",
                noQualify ? "bg-warn/15 text-warn" : "bg-fg/6 text-fg/60")}>
              <span>Doesn&apos;t qualify (unit counts, $0 F&amp;I credit)</span>
              <span className="tabnum">{noQualify ? "ON" : "off"}</span>
            </button>

            <button type="button" onClick={() => setProductOnly((v) => !v)}
              className={clsx("flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition active:scale-[0.99]",
                productOnly ? "bg-warn/15 text-warn" : "bg-fg/6 text-fg/60")}>
              <span>Product only (no vehicle — counts toward PVR/PPU, not a unit)</span>
              <span className="tabnum">{productOnly ? "ON" : "off"}</span>
            </button>
          </>
        ) : (
          (spec.addonsLabel || spec.hasReserve) && (
            <div className={clsx("grid gap-3", spec.addonsLabel && spec.hasReserve ? "grid-cols-2" : "grid-cols-1")}>
              {spec.addonsLabel && (
                <Labeled label={spec.addonsLabel}>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setAddons((p) => Math.max(0, p - 1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fg/8 active:scale-95" aria-label="One fewer"><Minus size={18} /></button>
                    <div className="flex-1 text-center text-2xl font-black tabnum">{addons}</div>
                    <button onClick={() => setAddons((p) => p + 1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fg/8 active:scale-95" aria-label="One more"><Plus size={18} /></button>
                  </div>
                </Labeled>
              )}
              {spec.hasReserve && (
                <Labeled label="Reserve">
                  <input className="field tabnum" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value)} placeholder="$0" />
                </Labeled>
              )}
            </div>
          )
        )}

        <button className="btn btn-primary btn-block mt-2" onClick={save}>Save deal</button>
      </div>
    </Sheet>
  );
}

function Segmented({ options, value, onChange, wrap }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; wrap?: boolean }) {
  return (
    <div className={clsx("flex gap-2", wrap ? "flex-wrap" : "")}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={clsx("rounded-xl px-3.5 py-2.5 text-sm font-semibold transition active:scale-95",
            value === o.value ? "bg-accent text-white" : "bg-fg/6 text-fg/70")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
