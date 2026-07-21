"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Phone } from "lucide-react";
import { NextActionBar } from "@/components/NextActionBar";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useCrmLeads, type CrmLead } from "@/components/CrmProvider";
import { scoreLead } from "@/lib/leadScore";
import { personLabel } from "@/lib/desk";
import { askIla } from "@/lib/askIla";
import { canContact } from "@/lib/consent";

const SHOWN: CrmLead["status"][] = ["Shown", "Desking", "In Finance", "Won"];
const isShown = (l: CrmLead) => SHOWN.includes(l.status);
const apptDay = (l: CrmLead) => l.appointment.slice(0, 10);
// LOCAL day key — appointment strings are local datetime-local values; a UTC
// key pushed today's evening appointments into "Needs Attention" after ~8pm ET.
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function apptTime(iso: string): string {
  if (iso.length <= 10) return "All day";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// The Appointment Board — every scheduled appointment, organized so a BDC agent
// or manager sees the day at a glance: who's coming in today, who still needs a
// confirmation call (confirmed appointments show), who didn't show and needs a
// reschedule, and who already walked in. One-tap confirm / call / open.
export default function AppointmentsPage() {
  const { leads, updateLead } = useCrmLeads();
  const today = todayIso();

  const withAppt = leads.filter((l) => l.appointment && l.status !== "Lost");
  const todays = withAppt.filter((l) => apptDay(l) === today && !isShown(l));
  const upcoming = withAppt.filter((l) => apptDay(l) > today && !isShown(l)).sort((a, b) => a.appointment.localeCompare(b.appointment));
  const overdue = withAppt.filter((l) => apptDay(l) < today && !isShown(l));
  const showed = withAppt.filter(isShown).sort((a, b) => b.appointment.localeCompare(a.appointment));

  const toConfirm = todays.filter((l) => !l.appointmentConfirmed);

  const read =
    withAppt.length === 0
      ? "No appointments on the board. Set one from the Showroom or Follow-Up and it'll land here."
      : `${todays.length} appointment${todays.length === 1 ? "" : "s"} today · ${toConfirm.length} still to confirm · ${overdue.length} need a reschedule.`;
  const action = overdue[0]
    ? { label: `Reschedule ${overdue[0].customer || "a no-show"}`, sub: "Appointment passed — save the lead", href: `/desking?lead=${overdue[0].id}` }
    : toConfirm[0]
      ? { label: `Confirm ${toConfirm[0].customer || "today's appointment"}`, sub: "Confirmed appointments show", href: `/desking?lead=${toConfirm[0].id}` }
      : todays[0]
        ? { label: `Greet ${todays[0].customer}`, sub: "On the board today", href: `/desking?lead=${todays[0].id}` }
        : undefined;

  return (
    <div>
      <SectionHeader title="Appointments" kicker="The day's board — confirm, show, reschedule" />

      <div className="mb-5"><NextActionBar read={read} action={action} tone={overdue.length ? "red" : toConfirm.length ? "amber" : "green"} /></div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Column title="Today" tone="amber" leads={todays} onConfirm={(id) => updateLead(id, { appointmentConfirmed: true })} />
        <Column title="Needs Attention" subtitle="Passed — no-show or reschedule" tone="red" leads={overdue} />
        <Column title="Upcoming" tone="blue" leads={upcoming} onConfirm={(id) => updateLead(id, { appointmentConfirmed: true })} />
        <Column title="Showed" subtitle="Walked in" tone="green" leads={showed} />
      </div>
    </div>
  );
}

function Column({
  title,
  subtitle,
  tone,
  leads,
  onConfirm,
}: {
  title: string;
  subtitle?: string;
  tone: "amber" | "red" | "blue" | "green";
  leads: CrmLead[];
  onConfirm?: (id: string) => void;
}) {
  const dot = tone === "red" ? "bg-mission-red" : tone === "amber" ? "bg-mission-gold" : tone === "green" ? "bg-mission-green" : "bg-mission-green/60";
  return (
    <section className="glass-card rounded-[16px] p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
        <h2 className="font-display text-lg font-black text-white">{title}</h2>
        <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-black tabular-nums text-white/70">{leads.length}</span>
      </div>
      {subtitle && <div className="-mt-2 mb-3 text-xs text-white/45">{subtitle}</div>}
      {leads.length === 0 ? (
        <div className="rounded-[12px] border border-white/8 bg-white/[0.02] p-6 text-center text-sm text-white/40">Nothing here.</div>
      ) : (
        <div className="space-y-2.5">
          {leads.map((lead) => (
            <ApptCard key={lead.id} lead={lead} onConfirm={onConfirm} />
          ))}
        </div>
      )}
    </section>
  );
}

function ApptCard({ lead, onConfirm }: { lead: CrmLead; onConfirm?: (id: string) => void }) {
  const s = scoreLead(lead);
  const phone = lead.customerPhone?.replace(/[^0-9+]/g, "");
  return (
    <div className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-bold text-white">{lead.customer || "Customer"}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-white/55">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-white/40" /> {apptTime(lead.appointment)}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-white/45">{lead.vehicle || "Vehicle TBD"} · {personLabel(lead.salesperson)}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/* Tap the score and EILA explains it + the pre-arrival play. */}
          <button
            type="button"
            onClick={() => askIla(`Explain ${lead.customer || "this customer"}'s appointment lead score of ${s.score} — how solid is this appointment, and what should we do before they arrive?`)}
            title="Tap — EILA explains this score"
            className="transition active:scale-95"
          >
            <StatusPill tone={s.label === "Hot" ? "red" : s.label === "Warm" ? "gold" : "blue"}>{s.score}</StatusPill>
          </button>
          {lead.appointmentConfirmed && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.1em] text-mission-green"><CheckCircle2 className="h-3 w-3" /> Confirmed</span>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {onConfirm && !lead.appointmentConfirmed && (
          <button type="button" onClick={() => onConfirm(lead.id)} className="inline-flex items-center gap-1.5 rounded-full bg-mission-gold px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-navy transition hover:brightness-110">
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
          </button>
        )}
        {/* TCPA rail (lib/consent.ts): revoked = dead red pill, never a live link. */}
        {phone && (canContact(lead, "call").allowed ? (
          <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 rounded-full border border-mission-gold/35 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        ) : (
          <span title={canContact(lead, "call").reason} className="inline-flex items-center gap-1.5 rounded-full border border-mission-red/50 bg-mission-red/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-red">
            <Phone className="h-3.5 w-3.5" /> Do not call
          </span>
        ))}
        <Link href={`/desking?lead=${lead.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/65 transition hover:border-white/30 hover:text-white">
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
