"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ClipboardCopy, Package, PhoneOutgoing, Plus, Undo2, Wrench, X } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { NextActionBar } from "@/components/NextActionBar";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { askIla } from "@/lib/askIla";
import { currency } from "@/lib/data";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";
import { useRefreshOnWake } from "@/lib/useRefreshOnWake";
import {
  SOP_AGING_DAYS,
  counterStats,
  makeLostSale,
  makePartsRequest,
  makeSpecialOrder,
  moveRequestPatch,
  moveSopPatch,
  nextRequestStatus,
  nextSopStatus,
  normalizePartsData,
  sopAgeDays,
  sopPickupText,
  stockSuggestions,
  type LostSaleChannel,
  type PartsCounterData,
  type PartsRequest,
  type SpecialOrder,
} from "@/lib/parts";

const inputClass = "h-11 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-mission-gold/60";

const LOST_CHANNELS: LostSaleChannel[] = ["Retail", "Shop", "Phone", "Wholesale"];

// Parts Counter v1 — SOP Mission Control, the tech request queue, and the
// lost-sale one-tap. The three fights the research says every parts
// department is losing, none of which need the DMS.
export default function PartsPage() {
  const { profile, isAdmin, isManager } = useAuth();
  const canWork = isAdmin || isManager || profile?.role === "F&I";
  const storeName = useStoreSettings().settings.storeName || "the dealership";

  const [data, setData] = useState<PartsCounterData>({ sops: [], requests: [], lostSales: [] });
  const [loaded, setLoaded] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const readyToSave = useRef(false);
  const fromServer = useRef(false);
  const [sopFormOpen, setSopFormOpen] = useState(false);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [editing, setEditing] = useState<SpecialOrder | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    loadStore<PartsCounterData>("partsCounter").then((saved) => {
      setData(normalizePartsData(saved));
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!readyToSave.current) {
      readyToSave.current = true;
      return;
    }
    if (fromServer.current) {
      fromServer.current = false;
      return;
    }
    // Same CAS contract as every board: lose the race → adopt the server copy.
    void saveStoreGuarded<PartsCounterData>("partsCounter", data).then((result) => {
      if (result.ok || result.conflict !== true) return;
      if (result.value && typeof result.value === "object") {
        fromServer.current = true;
        setData(normalizePartsData(result.value));
      }
      setConflicted(true);
    });
  }, [data, loaded]);

  // Fresh on open: the counter a waking phone shows is the counter as it is NOW.
  useRefreshOnWake(() => {
    if (!loaded) return;
    void loadStore<PartsCounterData>("partsCounter").then((saved) => {
      if (saved == null) return;
      setData((current) => {
        const next = normalizePartsData(saved);
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        fromServer.current = true;
        return next;
      });
    });
  });

  function updateSop(id: string, patch: Partial<SpecialOrder>) {
    setData((current) => ({ ...current, sops: current.sops.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  }

  function advanceSop(sop: SpecialOrder) {
    const to = nextSopStatus(sop.status);
    if (!to) return;
    const patch = moveSopPatch(sop, to);
    if (patch) updateSop(sop.id, patch);
  }

  function advanceRequest(request: PartsRequest) {
    const to = nextRequestStatus(request.status);
    if (!to) return;
    const patch = moveRequestPatch(request, to);
    if (patch) {
      setData((current) => ({ ...current, requests: current.requests.map((r) => (r.id === request.id ? { ...r, ...patch } : r)) }));
    }
  }

  async function copyPickupText(sop: SpecialOrder) {
    const text = sopPickupText(sop, storeName);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(sop.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy the pickup text:", text);
    }
  }

  const stats = counterStats(data);
  const suggestions = stockSuggestions(data.lostSales);
  const openSops = data.sops.filter((s) => s.status !== "Picked Up" && s.status !== "Returned");
  const openRequests = data.requests.filter((r) => r.status !== "Delivered");
  const agingList = openSops.filter((s) => (sopAgeDays(s) ?? 0) >= SOP_AGING_DAYS);

  const read = openSops.length || openRequests.length
    ? `${stats.queueWaiting ? `${stats.queueWaiting} tech${stats.queueWaiting === 1 ? "" : "s"} waiting` : "no techs waiting"} · ${stats.sopsWaiting} special order${stats.sopsWaiting === 1 ? "" : "s"} on the shelf (${currency(stats.sopsWaitingValue)})${stats.sopsAging ? ` · ${stats.sopsAging} AGING past ${SOP_AGING_DAYS} days` : ""}.`
    : "Counter's clear. Special orders, tech requests, and lost sales all land here.";
  const action = stats.queueWaiting
    ? { label: "Pull for the waiting techs first", sub: "Every minute at the counter is unbilled wrench time", href: "#queue" }
    : agingList[0]
      ? { label: `Call ${agingList[0].customer || "the oldest special order"} — the part's been sitting ${sopAgeDays(agingList[0])} days`, sub: "Unclaimed special orders are how obsolescence starts", href: "#sops" }
      : stats.sopsWaiting
        ? { label: "Tell the waiting customers their parts are in", sub: `${currency(stats.sopsWaitingValue)} sitting on the SOP shelf`, href: "#sops" }
        : { label: "Log lost sales as they happen", sub: "Three asks in ninety days = stock it", href: "#lost" };

  return (
    <div>
      <SectionHeader title="Parts Counter" kicker="Special orders owned, techs unblocked, lost sales counted" />

      {conflicted && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-[12px] border border-mission-red/50 bg-mission-red/10 p-3 text-sm leading-5 text-mission-red">
          <span><span className="font-black">The counter changed on another device</span> — showing the latest. Re-enter your last change if it&apos;s missing.</span>
          <button type="button" onClick={() => setConflicted(false)} className="shrink-0 rounded-full border border-mission-red/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.1em] transition hover:bg-mission-red hover:text-white">Got it</button>
        </div>
      )}

      <div className="mb-5"><NextActionBar read={read} action={action} tone={stats.sopsAging || stats.queueWaiting ? "red" : stats.sopsWaiting ? "amber" : "green"} /></div>

      <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Techs Waiting" value={`${stats.queueWaiting}`} detail={stats.avgFillMinutes != null ? `${stats.avgFillMinutes} min avg fill (30d)` : "No requests filled yet"} tone={stats.queueWaiting ? "red" : "blue"} onExplain={() => askIla("Who's waiting on parts at the counter right now, and how fast are we filling tech requests?")} />
        <MetricCard label="On the Shelf" value={`${stats.sopsWaiting}`} detail={`${currency(stats.sopsWaitingValue)} in special orders`} tone="blue" onExplain={() => askIla("Walk the special orders sitting on the shelf — who they're for, the money, and who still needs the call.")} />
        <MetricCard label={`Sitting ${SOP_AGING_DAYS}+ Days`} value={`${stats.sopsAging}`} detail="Part came in, customer never did" tone={stats.sopsAging ? "red" : "green"} onExplain={() => askIla("Which special orders are aging past a week since they arrived, and what's the re-contact play for each?")} />
        <MetricCard label="Lost Sales (30 Days)" value={currency(stats.lostValue30d)} detail={`${stats.lostSales30d} logged${stats.suggestions ? ` · ${stats.suggestions} stock-it` : ""}`} tone="gold" onExplain={() => askIla("What did we lose at the parts counter in the last 30 days, and what is it telling us to stock?")} />
      </section>

      {canWork && (
        <div className="mb-5 flex flex-wrap gap-2.5">
          <button type="button" onClick={() => setSopFormOpen(true)} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
            <Plus className="h-4 w-4" /> Special Order
          </button>
          <button type="button" onClick={() => setRequestFormOpen(true)} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-white/75 transition hover:border-mission-gold/50 hover:text-mission-gold">
            <Wrench className="h-4 w-4" /> Tech Request
          </button>
        </div>
      )}

      <section id="queue" className="mb-5">
        <div className="glass-card rounded-[16px] p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <Wrench className="h-5 w-5 text-mission-gold" />
            <h2 className="font-display text-lg font-black text-white">Tech Queue</h2>
            <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-black tabular-nums text-white/70">{openRequests.length}</span>
          </div>
          {openRequests.length === 0 ? (
            <div className="rounded-[12px] border border-white/8 bg-white/[0.02] p-5 text-center text-sm text-white/40">No open requests — the bays are covered.</div>
          ) : (
            <div className="space-y-2.5">
              {openRequests.map((request) => {
                const next = nextRequestStatus(request.status);
                return (
                  <div key={request.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border p-3.5 ${request.status === "Waiting" ? "border-mission-red/40 bg-mission-red/[0.05]" : "border-white/8 bg-white/[0.03]"}`}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-white">{request.description || "Part"}</div>
                      <div className="mt-0.5 text-xs text-white/55">{request.tech || "Tech"} · RO {request.roNumber || "—"} · in {new Date(request.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
                    </div>
                    <StatusPill tone={request.status === "Waiting" ? "red" : "gold"}>{request.status}</StatusPill>
                    {canWork && next && (
                      <button type="button" onClick={() => advanceRequest(request)} className="inline-flex items-center gap-1.5 rounded-full bg-mission-gold px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-navy transition hover:brightness-110">
                        {next === "Delivered" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />} {next}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section id="sops" className="mb-5 grid gap-4 lg:grid-cols-3">
        {(["Ordered", "Received", "Notified"] as const).map((status) => {
          const column = openSops.filter((s) => s.status === status);
          return (
            <div key={status} className="glass-card rounded-[16px] p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${status === "Notified" ? "bg-mission-green" : status === "Received" ? "bg-mission-gold" : "bg-white/40"}`} aria-hidden />
                <h2 className="font-display text-lg font-black text-white">{status === "Notified" ? "Customer Told" : status}</h2>
                <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-black tabular-nums text-white/70">{column.length}</span>
              </div>
              {column.length === 0 ? (
                <div className="rounded-[12px] border border-white/8 bg-white/[0.02] p-5 text-center text-sm text-white/40">Nothing here.</div>
              ) : (
                <div className="space-y-2.5">
                  {column.map((sop) => (
                    <SopCard key={sop.id} sop={sop} canWork={canWork} copied={copied === sop.id} onAdvance={() => advanceSop(sop)} onCopyText={() => copyPickupText(sop)} onEdit={() => setEditing(sop)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section id="lost" className="glass-card rounded-[16px] p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <Package className="h-5 w-5 text-mission-gold" />
          <h2 className="font-display text-lg font-black text-white">Lost Sales</h2>
          <span className="ml-auto text-xs font-black tabular-nums text-white/60">{currency(stats.lostValue30d)} last 30 days</span>
        </div>
        {canWork && <LostSaleQuickAdd by={profile?.employeeName || ""} onAdd={(sale) => setData((current) => ({ ...current, lostSales: [sale, ...current.lostSales] }))} />}
        {suggestions.length > 0 && (
          <div className="mt-3 rounded-[12px] border border-mission-gold/30 bg-mission-gold/[0.06] p-3 text-sm leading-6 text-white/70">
            <span className="font-black text-mission-gold">Stock it:</span>{" "}
            {suggestions.slice(0, 3).map((s) => `${s.label} (asked ${s.demands}× in 90 days)`).join(" · ")}
            {" — "}
            <button type="button" className="underline decoration-mission-gold/40 underline-offset-2" onClick={() => askIla("What are the lost-sale patterns at the parts counter telling us to stock, and what's the money case for each?")}>ask EILA the money case</button>
          </div>
        )}
        {data.lostSales.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {data.lostSales.slice(0, 8).map((sale) => (
              <div key={sale.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-white/8 bg-white/[0.02] px-3 py-2 text-xs text-white/60">
                <span className="font-bold text-white/80">{sale.partNumber || sale.description}</span>
                {sale.partNumber && sale.description ? <span className="truncate">{sale.description}</span> : null}
                <span className="ml-auto flex items-center gap-3">
                  <span>{sale.channel}</span>
                  {sale.value ? <span className="font-black text-mission-gold">{currency(sale.value)}</span> : null}
                  <span className="text-white/35">{new Date(sale.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {sopFormOpen && canWork && (
        <SopForm
          defaultCounterperson={profile?.employeeName || ""}
          onClose={() => setSopFormOpen(false)}
          onSave={(sop) => {
            setData((current) => ({ ...current, sops: [sop, ...current.sops] }));
            setSopFormOpen(false);
          }}
        />
      )}

      {requestFormOpen && canWork && (
        <RequestForm
          onClose={() => setRequestFormOpen(false)}
          onSave={(request) => {
            setData((current) => ({ ...current, requests: [request, ...current.requests] }));
            setRequestFormOpen(false);
          }}
        />
      )}

      {editing && canWork && (
        <EditSop
          sop={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            updateSop(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SopCard({ sop, canWork, copied, onAdvance, onCopyText, onEdit }: { sop: SpecialOrder; canWork: boolean; copied: boolean; onAdvance: () => void; onCopyText: () => void; onEdit: () => void }) {
  const age = sopAgeDays(sop);
  const aging = age != null && age >= SOP_AGING_DAYS;
  const next = nextSopStatus(sop.status);
  return (
    <div className={`rounded-[12px] border p-3.5 ${aging ? "border-mission-red/50 bg-mission-red/[0.06]" : "border-white/8 bg-white/[0.03]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-bold text-white">{sop.customer || "Customer"}</div>
          <div className="mt-0.5 truncate text-xs text-white/55">{sop.partNumber ? `${sop.partNumber} · ` : ""}{sop.description || "Part"}</div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {sop.deposit ? <StatusPill tone="green">Deposit</StatusPill> : sop.status !== "Ordered" ? <StatusPill tone="gold">No deposit</StatusPill> : null}
          {aging && <StatusPill tone="red">{age}d old</StatusPill>}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
        {sop.price ? <span>{currency(sop.price)}</span> : null}
        {sop.bin && <span>Bin {sop.bin}</span>}
        {sop.roNumber && <span>RO {sop.roNumber}</span>}
        {age != null && !aging && <span>{age === 0 ? "Landed today" : `${age}d on the shelf`}</span>}
        {sop.customerPhone && (
          <a href={`tel:${sop.customerPhone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 text-mission-gold"><PhoneOutgoing className="h-3 w-3" /> Call</a>
        )}
      </div>
      {canWork && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {next && (
            <button type="button" onClick={onAdvance} className="inline-flex items-center gap-1.5 rounded-full bg-mission-gold px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-navy transition hover:brightness-110">
              {next === "Picked Up" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />} {next === "Notified" ? "Told Customer" : next}
            </button>
          )}
          {(sop.status === "Received" || sop.status === "Notified") && (
            <button type="button" onClick={onCopyText} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] transition ${copied ? "border-mission-green/60 text-mission-green" : "border-white/12 text-white/55 hover:border-mission-gold/50 hover:text-mission-gold"}`}>
              <ClipboardCopy className="h-3 w-3" /> {copied ? "Copied" : "Pickup text"}
            </button>
          )}
          <button type="button" onClick={onEdit} className="rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/55 transition hover:border-white/30 hover:text-white">Edit</button>
        </div>
      )}
    </div>
  );
}

function LostSaleQuickAdd({ by, onAdd }: { by: string; onAdd: (sale: ReturnType<typeof makeLostSale>) => void }) {
  const [form, setForm] = useState({ description: "", partNumber: "", channel: "Retail" as LostSaleChannel, value: "" });
  const set = (key: keyof typeof form, value: string) => setForm((c) => ({ ...c, [key]: value }));
  const submit = () => {
    if (!form.description.trim() && !form.partNumber.trim()) return;
    onAdd(
      makeLostSale({
        description: form.description.trim() || form.partNumber.trim(),
        partNumber: form.partNumber.trim() || undefined,
        channel: form.channel,
        value: form.value ? Number(form.value) || undefined : undefined,
        by: by || undefined,
      }),
    );
    setForm({ description: "", partNumber: "", channel: form.channel, value: "" });
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_150px_120px_110px_auto]">
      <input className={inputClass} placeholder="Didn't have it — what did they ask for?" value={form.description} onChange={(e) => set("description", e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <input className={inputClass} placeholder="Part # (optional)" value={form.partNumber} onChange={(e) => set("partNumber", e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <select className={inputClass} value={form.channel} onChange={(e) => set("channel", e.target.value as LostSaleChannel)}>
        {LOST_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className={inputClass} placeholder="$ lost" inputMode="decimal" value={form.value} onChange={(e) => set("value", e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button type="button" onClick={submit} disabled={!form.description.trim() && !form.partNumber.trim()} className="min-h-11 rounded-full bg-mission-gold px-5 text-sm font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110 disabled:opacity-40">
        Log it
      </button>
    </div>
  );
}

function SopForm({ defaultCounterperson, onClose, onSave }: { defaultCounterperson: string; onClose: () => void; onSave: (sop: SpecialOrder) => void }) {
  const [form, setForm] = useState({ customer: "", customerPhone: "", partNumber: "", description: "", price: "", deposit: "", roNumber: "", bin: "" });
  const set = (key: keyof typeof form, value: string) => setForm((c) => ({ ...c, [key]: value }));
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-panel w-full max-w-md rounded-t-[20px] p-5 sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 font-display text-xl font-black text-white"><Package className="h-5 w-5 text-mission-gold" /> New special order</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3">
          <input className={inputClass} placeholder="Customer name" value={form.customer} onChange={(e) => set("customer", e.target.value)} />
          <input className={inputClass} placeholder="Phone" inputMode="tel" value={form.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className={inputClass} placeholder="Part #" value={form.partNumber} onChange={(e) => set("partNumber", e.target.value)} />
            <input className={inputClass} placeholder="RO # (if for a job)" value={form.roNumber} onChange={(e) => set("roNumber", e.target.value)} />
          </div>
          <input className={inputClass} placeholder="What is it, in plain words" value={form.description} onChange={(e) => set("description", e.target.value)} />
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Price $</span>
              <input className={inputClass} inputMode="decimal" placeholder="0" value={form.price} onChange={(e) => set("price", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Deposit $</span>
              <input className={inputClass} inputMode="decimal" placeholder="0" value={form.deposit} onChange={(e) => set("deposit", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Bin</span>
              <input className={inputClass} placeholder="A-3" value={form.bin} onChange={(e) => set("bin", e.target.value)} />
            </label>
          </div>
          {!form.deposit && <div className="text-xs leading-5 text-white/45">No deposit? Nine times out of ten a no-deposit special order never gets picked up — take one when you can.</div>}
        </div>
        <button
          type="button"
          disabled={!form.customer.trim() || (!form.partNumber.trim() && !form.description.trim())}
          onClick={() =>
            onSave(
              makeSpecialOrder({
                customer: form.customer.trim(),
                customerPhone: form.customerPhone.trim(),
                partNumber: form.partNumber.trim(),
                description: form.description.trim(),
                price: form.price ? Number(form.price) || undefined : undefined,
                deposit: form.deposit ? Number(form.deposit) || undefined : undefined,
                roNumber: form.roNumber.trim() || undefined,
                bin: form.bin.trim() || undefined,
                counterperson: defaultCounterperson || undefined,
              }),
            )
          }
          className="mt-4 w-full rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-40"
        >
          Order it
        </button>
      </div>
    </div>
  );
}

function RequestForm({ onClose, onSave }: { onClose: () => void; onSave: (request: PartsRequest) => void }) {
  const [form, setForm] = useState({ tech: "", roNumber: "", description: "" });
  const set = (key: keyof typeof form, value: string) => setForm((c) => ({ ...c, [key]: value }));
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-panel w-full max-w-md rounded-t-[20px] p-5 sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 font-display text-xl font-black text-white"><Wrench className="h-5 w-5 text-mission-gold" /> Tech parts request</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input className={inputClass} placeholder="Tech" value={form.tech} onChange={(e) => set("tech", e.target.value)} />
            <input className={inputClass} placeholder="RO #" value={form.roNumber} onChange={(e) => set("roNumber", e.target.value)} />
          </div>
          <input className={inputClass} placeholder="Part number or plain words" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <button
          type="button"
          disabled={!form.description.trim()}
          onClick={() => onSave(makePartsRequest({ tech: form.tech.trim(), roNumber: form.roNumber.trim(), description: form.description.trim() }))}
          className="mt-4 w-full rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-40"
        >
          Put it in the queue
        </button>
      </div>
    </div>
  );
}

function EditSop({ sop, onClose, onSave }: { sop: SpecialOrder; onClose: () => void; onSave: (patch: Partial<SpecialOrder>) => void }) {
  const [form, setForm] = useState({
    price: sop.price != null ? String(sop.price) : "",
    deposit: sop.deposit != null ? String(sop.deposit) : "",
    bin: sop.bin || "",
    notes: sop.notes || "",
  });
  const set = (key: keyof typeof form, value: string) => setForm((c) => ({ ...c, [key]: value }));
  const open = sop.status !== "Picked Up" && sop.status !== "Returned";
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-panel w-full max-w-md rounded-t-[20px] p-5 sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="font-display text-xl font-black text-white">{sop.customer}</div>
            <div className="text-xs text-white/50">{sop.partNumber ? `${sop.partNumber} · ` : ""}{sop.description}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <input className={inputClass} placeholder="Price $" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} />
            <input className={inputClass} placeholder="Deposit $" inputMode="decimal" value={form.deposit} onChange={(e) => set("deposit", e.target.value)} />
            <input className={inputClass} placeholder="Bin" value={form.bin} onChange={(e) => set("bin", e.target.value)} />
          </div>
          <textarea className="min-h-[70px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-mission-gold/60" placeholder="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() =>
              onSave({
                price: form.price ? Number(form.price) || undefined : undefined,
                deposit: form.deposit ? Number(form.deposit) || undefined : undefined,
                bin: form.bin.trim() || undefined,
                notes: form.notes.trim() || undefined,
              })
            }
            className="w-full rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110"
          >
            Save
          </button>
          {open && (
            <button
              type="button"
              onClick={() => {
                const patch = moveSopPatch(sop, "Returned");
                onSave(patch ?? {});
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-mission-red/40 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-red transition hover:bg-mission-red hover:text-white"
            >
              <Undo2 className="h-4 w-4" /> Return to vendor
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
