"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Car, CheckCircle2, ClipboardCopy, Flag, Phone, Plus, RotateCcw, Wrench, X } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { NextActionBar } from "@/components/NextActionBar";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { askIla } from "@/lib/askIla";
import { currency } from "@/lib/data";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";
import { useRefreshOnWake } from "@/lib/useRefreshOnWake";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import {
  SERVICE_STATUSES,
  isLate,
  laneStats,
  makeServiceVisit,
  moveVisitPatch,
  nextStatus,
  promiseRisk,
  recaptureList,
  recaptureText,
  statusUpdateText,
  updateDue,
  type ServiceStatus,
  type ServiceVisit,
} from "@/lib/service";

const inputClass = "h-11 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-mission-gold/60";

// Service Drive v1 — the lane board. What's in the lane, what's ready, what's
// LATE on its promise time, and which service customers are tomorrow's sales.
// One-tap advance keeps it honest in the drive, phone in hand.
export default function ServicePage() {
  const { profile, isAdmin, isManager } = useAuth();
  const canWork = isAdmin || isManager || profile?.role === "F&I";
  const { managers, financeManagers } = useTeamLists();
  const storeName = useStoreSettings().settings.storeName || "the dealership";
  const advisors = useMemo(() => Array.from(new Set([...managers, ...financeManagers])), [managers, financeManagers]);

  const [visits, setVisits] = useState<ServiceVisit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const readyToSave = useRef(false);
  const fromServer = useRef(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceVisit | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    loadStore<ServiceVisit[]>("serviceLane").then((saved) => {
      if (Array.isArray(saved)) setVisits(saved);
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
    void saveStoreGuarded<ServiceVisit[]>("serviceLane", visits).then((result) => {
      if (result.ok || result.conflict !== true) return;
      if (Array.isArray(result.value)) {
        fromServer.current = true;
        setVisits(result.value);
      }
      setConflicted(true);
    });
  }, [visits, loaded]);

  // Fresh on open: the lane a waking phone shows is the lane as it is NOW.
  useRefreshOnWake(() => {
    if (!loaded) return;
    void loadStore<ServiceVisit[]>("serviceLane").then((saved) => {
      if (!Array.isArray(saved)) return;
      setVisits((current) => {
        if (JSON.stringify(saved) === JSON.stringify(current)) return current;
        fromServer.current = true;
        return saved;
      });
    });
  });

  function updateVisit(id: string, patch: Partial<ServiceVisit>) {
    setVisits((current) => current.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  function advance(visit: ServiceVisit) {
    const to = nextStatus(visit.status);
    if (!to) return;
    const patch = moveVisitPatch(visit, to);
    if (patch) updateVisit(visit.id, patch);
  }

  // Copying the status text IS the update — stamp the silence clock reset.
  async function copyText(id: string, text: string, stampUpdate: boolean) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy the message:", text);
    }
    if (stampUpdate) updateVisit(id, { lastUpdateAt: new Date().toISOString() });
  }

  const stats = laneStats(visits);
  const open = visits.filter((v) => v.status !== "Picked Up");
  const read = open.length
    ? `${stats.inLaneNow} in the lane · ${stats.readyNow} ready for pickup · ${stats.lateNow ? `${stats.lateNow} LATE on the promise time` : "nothing late"}${stats.salesFlags ? ` · ${stats.salesFlags} flagged for sales` : ""}.`
    : "Lane's clear. Book the next appointment and it lands here.";
  const late = open.filter((v) => isLate(v));
  const atRiskSoon = open.filter((v) => promiseRisk(v) === "soon");
  const updatesDue = open.filter((v) => updateDue(v));
  const missions = recaptureList(visits);
  const action = late[0]
    ? { label: `Call ${late[0].customer || "the late RO"} — promise time passed`, sub: "Late and uncalled is how service customers are lost", href: "#lane" }
    : atRiskSoon[0]
      ? { label: `${atRiskSoon[0].customer || "A promise"} is due soon — re-promise BEFORE it blows`, sub: "The Guardian warns you first, not the customer", href: "#lane" }
      : updatesDue[0]
        ? { label: `Text ${updatesDue[0].customer || "the quiet customer"} an update — they haven't heard from us`, sub: "Silence is the #1 service complaint", href: "#lane" }
        : stats.readyNow
          ? { label: "Tell the ready customers their car is done", sub: `${stats.readyNow} vehicle${stats.readyNow === 1 ? " is" : "s are"} sitting ready`, href: "#lane" }
          : missions[0]
            ? { label: `Win back ${missions[0].visit.customer || "declined work"} — ${missions[0].daysSince}d since they said not today`, sub: "Structured follow-up recovers 23-30% of declined work", href: "#recapture" }
            : { label: "Book the next appointment", sub: "A full lane feeds the whole store", href: "#lane" };

  return (
    <div>
      <SectionHeader title="Service Lane" kicker="The drive, live — check in, promise, deliver" />

      {conflicted && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-[12px] border border-mission-red/50 bg-mission-red/10 p-3 text-sm leading-5 text-mission-red">
          <span><span className="font-black">The lane changed on another device</span> — showing the latest. Re-enter your last change if it&apos;s missing.</span>
          <button type="button" onClick={() => setConflicted(false)} className="shrink-0 rounded-full border border-mission-red/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.1em] transition hover:bg-mission-red hover:text-white">Got it</button>
        </div>
      )}

      <div className="mb-5"><NextActionBar read={read} action={action} tone={stats.lateNow ? "red" : atRiskSoon.length || updatesDue.length || stats.readyNow ? "amber" : "green"} /></div>

      <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="In the Lane" value={`${stats.inLaneNow}`} detail={`${stats.arrivedToday} arrived today${stats.scheduledNow ? ` · ${stats.scheduledNow} booked ahead` : ""}`} tone="blue" onExplain={() => askIla("Explain what's in the service lane right now — who's where, and what needs moving.")} />
        <MetricCard label="Ready" value={`${stats.readyNow}`} detail="Done — call the customer" tone="green" onExplain={() => askIla("Which service customers are ready for pickup and how long have they been sitting?")} />
        <MetricCard label="Late" value={`${stats.lateNow}`} detail={atRiskSoon.length ? `${atRiskSoon.length} due soon — re-promise now` : "Past the promise time"} tone={stats.lateNow ? "red" : atRiskSoon.length ? "gold" : "blue"} onExplain={() => askIla("Which ROs are past their promise time, by how much, and what do I tell each customer?")} />
        <MetricCard label="Sales Flags" value={`${stats.salesFlags}`} detail="Service customers worth a trade talk" tone="gold" onExplain={() => askIla("Walk the service customers flagged as sales opportunities — who, what they drive, and the play.")} />
      </section>

      {canWork && (
        <button type="button" onClick={() => setDrawerOpen(true)} className="mb-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
          <Plus className="h-4 w-4" /> New Appointment / Walk-in
        </button>
      )}

      <section id="lane" className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {SERVICE_STATUSES.filter((s) => s !== "Picked Up").map((status) => {
          const column = open.filter((v) => v.status === status);
          return (
            <div key={status} className="glass-card rounded-[16px] p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${status === "Ready" ? "bg-mission-green" : status === "In Service" ? "bg-mission-gold" : "bg-white/40"}`} aria-hidden />
                <h2 className="font-display text-lg font-black text-white">{status}</h2>
                <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-black tabular-nums text-white/70">{column.length}</span>
              </div>
              {column.length === 0 ? (
                <div className="rounded-[12px] border border-white/8 bg-white/[0.02] p-5 text-center text-sm text-white/40">Nothing here.</div>
              ) : (
                <div className="space-y-2.5">
                  {column.map((visit) => (
                    <VisitCard key={visit.id} visit={visit} canWork={canWork} copied={copied === visit.id} onAdvance={() => advance(visit)} onEdit={() => setEditing(visit)} onFlag={() => updateVisit(visit.id, { salesOpportunity: !visit.salesOpportunity })} onStatusText={() => copyText(visit.id, statusUpdateText(visit, storeName), true)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {missions.length > 0 && (
        <section id="recapture" className="glass-card mt-5 rounded-[16px] p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <RotateCcw className="h-5 w-5 text-mission-gold" />
            <h2 className="font-display text-lg font-black text-white">Win-Back List</h2>
            <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-black tabular-nums text-white/70">{missions.length}</span>
          </div>
          <div className="mb-3 text-xs leading-5 text-white/45">Declined work is money already earned and not yet collected — a structured follow-up wins back 23&ndash;30% of it. <button type="button" className="underline decoration-mission-gold/40 underline-offset-2" onClick={() => askIla("Walk the declined-work win-back list — who, what they declined, how long it's been, and the re-contact play for each.")}>Ask EILA the plays</button>.</div>
          <div className="space-y-2.5">
            {missions.map(({ visit, daysSince, cadence }) => (
              <div key={visit.id} className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-white">{visit.customer || "Customer"}</div>
                    <div className="mt-0.5 truncate text-xs text-white/55">{visit.vehicle || ""}</div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {cadence && <StatusPill tone="gold">{cadence}-day</StatusPill>}
                    <StatusPill tone={daysSince >= 30 ? "red" : "blue"}>{daysSince}d ago</StatusPill>
                  </span>
                </div>
                <div className="mt-1.5 text-xs leading-5 text-white/60">Declined: {visit.declinedWork}</div>
                {canWork && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => copyText(visit.id, recaptureText(visit, storeName), false)} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] transition ${copied === visit.id ? "border-mission-green/60 text-mission-green" : "border-white/12 text-white/55 hover:border-mission-gold/50 hover:text-mission-gold"}`}>
                      <ClipboardCopy className="h-3 w-3" /> {copied === visit.id ? "Copied" : "Win-back text"}
                    </button>
                    {visit.customerPhone && (
                      <a href={`tel:${visit.customerPhone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-gold transition hover:border-mission-gold/50"><Phone className="h-3 w-3" /> Call</a>
                    )}
                    <button type="button" onClick={() => updateVisit(visit.id, { recapture: { state: "recovered", at: new Date().toISOString() } })} className="rounded-full border border-mission-green/40 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-green transition hover:bg-mission-green hover:text-mission-navy">
                      Won it back
                    </button>
                    <button type="button" onClick={() => updateVisit(visit.id, { recapture: { state: "dismissed", at: new Date().toISOString() } })} className="rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/45 transition hover:border-white/30 hover:text-white">
                      Let it go
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {drawerOpen && canWork && (
        <VisitForm
          advisors={advisors}
          defaultAdvisor={profile?.employeeName || ""}
          onClose={() => setDrawerOpen(false)}
          onSave={(visit) => {
            setVisits((current) => [visit, ...current]);
            setDrawerOpen(false);
          }}
        />
      )}

      {editing && canWork && (
        <EditVisit
          visit={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            updateVisit(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function VisitCard({ visit, canWork, copied, onAdvance, onEdit, onFlag, onStatusText }: { visit: ServiceVisit; canWork: boolean; copied: boolean; onAdvance: () => void; onEdit: () => void; onFlag: () => void; onStatusText: () => void }) {
  const late = isLate(visit);
  const risk = promiseRisk(visit);
  const quiet = updateDue(visit);
  const next = nextStatus(visit.status);
  return (
    <div className={`rounded-[12px] border p-3.5 ${late ? "border-mission-red/50 bg-mission-red/[0.06]" : risk === "soon" ? "border-mission-gold/50 bg-mission-gold/[0.05]" : "border-white/8 bg-white/[0.03]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-bold text-white">{visit.customer || "Customer"}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/55"><Car className="h-3.5 w-3.5 shrink-0 text-white/35" /> {visit.vehicle || "Vehicle TBD"}</div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {visit.salesOpportunity && <StatusPill tone="gold">Sales</StatusPill>}
          {late && <StatusPill tone="red">Late</StatusPill>}
          {risk === "soon" && <StatusPill tone="gold">Due soon</StatusPill>}
          {quiet && !late && risk !== "soon" && <StatusPill tone="gold">Update due</StatusPill>}
        </span>
      </div>
      <div className="mt-1.5 text-xs leading-5 text-white/60">{visit.concern}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
        {visit.promisedAt && (
          <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> Promised {new Date(visit.promisedAt).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
        )}
        {visit.estimatedTotal ? <span>{currency(visit.estimatedTotal)}</span> : null}
        {visit.advisor && <span>{visit.advisor}</span>}
        {visit.customerPhone && (
          <a href={`tel:${visit.customerPhone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 text-mission-gold"><Phone className="h-3 w-3" /> Call</a>
        )}
      </div>
      {canWork && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {next && (
            <button type="button" onClick={onAdvance} className="inline-flex items-center gap-1.5 rounded-full bg-mission-gold px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-navy transition hover:brightness-110">
              {next === "Picked Up" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />} {next}
            </button>
          )}
          <button type="button" onClick={onFlag} className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] transition ${visit.salesOpportunity ? "border-mission-gold/60 bg-mission-gold/15 text-mission-gold" : "border-white/12 text-white/55 hover:border-mission-gold/50 hover:text-mission-gold"}`}>
            <Flag className="mr-1 inline h-3 w-3" /> {visit.salesOpportunity ? "Flagged" : "Flag for Sales"}
          </button>
          {visit.status !== "Scheduled" && visit.status !== "Picked Up" && (
            <button type="button" onClick={onStatusText} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] transition ${copied ? "border-mission-green/60 text-mission-green" : "border-white/12 text-white/55 hover:border-mission-gold/50 hover:text-mission-gold"}`}>
              <ClipboardCopy className="h-3 w-3" /> {copied ? "Copied" : "Status text"}
            </button>
          )}
          {visit.salesOpportunity && (
            <Link href={`/crm-desk?new=1&customer=${encodeURIComponent(visit.customer)}&vehicle=${encodeURIComponent("")}&source=Service%20Drive`} className="rounded-full border border-mission-green/40 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-green transition hover:bg-mission-green hover:text-mission-navy">
              Start opportunity
            </Link>
          )}
          <button type="button" onClick={onEdit} className="rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/55 transition hover:border-white/30 hover:text-white">Edit</button>
        </div>
      )}
    </div>
  );
}

function VisitForm({ advisors, defaultAdvisor, onClose, onSave }: { advisors: string[]; defaultAdvisor: string; onClose: () => void; onSave: (visit: ServiceVisit) => void }) {
  const [form, setForm] = useState({ customer: "", customerPhone: "", vehicle: "", concern: "", advisor: defaultAdvisor || advisors[0] || "", promisedAt: "", estimatedTotal: "" });
  const set = (key: keyof typeof form, value: string) => setForm((c) => ({ ...c, [key]: value }));
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-panel w-full max-w-md rounded-t-[20px] p-5 sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 font-display text-xl font-black text-white"><Wrench className="h-5 w-5 text-mission-gold" /> New service visit</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3">
          <input className={inputClass} placeholder="Customer name" value={form.customer} onChange={(e) => set("customer", e.target.value)} />
          <input className={inputClass} placeholder="Phone" inputMode="tel" value={form.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} />
          <input className={inputClass} placeholder="Vehicle (year make model)" value={form.vehicle} onChange={(e) => set("vehicle", e.target.value)} />
          <input className={inputClass} placeholder="What are they in for?" value={form.concern} onChange={(e) => set("concern", e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Promise time</span>
              <input className={inputClass} type="datetime-local" value={form.promisedAt} onChange={(e) => set("promisedAt", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Est. total $</span>
              <input className={inputClass} inputMode="decimal" placeholder="0" value={form.estimatedTotal} onChange={(e) => set("estimatedTotal", e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Advisor</span>
            <select className={inputClass} value={form.advisor} onChange={(e) => set("advisor", e.target.value)}>
              {[form.advisor, ...advisors.filter((a) => a !== form.advisor)].filter(Boolean).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        <button
          type="button"
          disabled={!form.customer.trim()}
          onClick={() =>
            onSave(
              makeServiceVisit({
                customer: form.customer.trim(),
                customerPhone: form.customerPhone.trim(),
                vehicle: form.vehicle.trim(),
                concern: form.concern.trim(),
                advisor: form.advisor,
                promisedAt: form.promisedAt || undefined,
                estimatedTotal: form.estimatedTotal ? Number(form.estimatedTotal) || undefined : undefined,
              }),
            )
          }
          className="mt-4 w-full rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-40"
        >
          Put it in the lane
        </button>
      </div>
    </div>
  );
}

function EditVisit({ visit, onClose, onSave }: { visit: ServiceVisit; onClose: () => void; onSave: (patch: Partial<ServiceVisit>) => void }) {
  const [form, setForm] = useState({
    roNumber: visit.roNumber || "",
    estimatedTotal: visit.estimatedTotal != null ? String(visit.estimatedTotal) : "",
    promisedAt: visit.promisedAt || "",
    declinedWork: visit.declinedWork || "",
    notes: visit.notes || "",
    status: visit.status,
  });
  const set = (key: keyof typeof form, value: string) => setForm((c) => ({ ...c, [key]: value }));
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-panel w-full max-w-md rounded-t-[20px] p-5 sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="font-display text-xl font-black text-white">{visit.customer}</div>
            <div className="text-xs text-white/50">{visit.vehicle}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input className={inputClass} placeholder="RO #" value={form.roNumber} onChange={(e) => set("roNumber", e.target.value)} />
            <input className={inputClass} placeholder="Est. total $" inputMode="decimal" value={form.estimatedTotal} onChange={(e) => set("estimatedTotal", e.target.value)} />
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Promise time</span>
            <input className={inputClass} type="datetime-local" value={form.promisedAt} onChange={(e) => set("promisedAt", e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Status</span>
            <select className={inputClass} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {SERVICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <textarea className="min-h-[70px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-mission-gold/60" placeholder="Declined work (part, condition, price) — tomorrow's follow-up call" value={form.declinedWork} onChange={(e) => set("declinedWork", e.target.value)} />
          <textarea className="min-h-[70px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-mission-gold/60" placeholder="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <button
          type="button"
          onClick={() => {
            const statusPatch = form.status !== visit.status ? moveVisitPatch(visit, form.status as ServiceStatus) : null;
            onSave({
              roNumber: form.roNumber.trim() || undefined,
              estimatedTotal: form.estimatedTotal ? Number(form.estimatedTotal) || undefined : undefined,
              promisedAt: form.promisedAt || undefined,
              declinedWork: form.declinedWork.trim() || undefined,
              notes: form.notes.trim() || undefined,
              ...(statusPatch ?? {}),
            });
          }}
          className="mt-4 w-full rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110"
        >
          Save
        </button>
      </div>
    </div>
  );
}
