"use client";

import { CalendarClock, CircleDot, Flag, Sparkles, XCircle } from "lucide-react";
import type { CrmLead } from "@/components/CrmProvider";
import { leadCreatedMs } from "@/lib/leadScore";

// The customer's journey — a real, timestamped lifecycle built from the lead's
// status-history log (created → each move → appointment → won/lost). Honest by
// construction: it shows what actually happened and when. Detailed history
// accrues from the moment status logging shipped, so older leads show their
// creation + current state and fill in as they move.
type Event = { when: number; label: string; sub?: string; tone: "blue" | "gold" | "green" | "red" };

function fmt(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function CustomerJourney({ lead }: { lead?: CrmLead }) {
  if (!lead) {
    return <div className="rounded-[12px] border border-white/8 bg-white/[0.02] p-6 text-center text-sm text-white/45">Save the opportunity to start its journey.</div>;
  }

  const events: Event[] = [{ when: leadCreatedMs(lead), label: "Lead created", tone: "blue" }];

  for (const h of lead.statusHistory || []) {
    const t = new Date(h.at).getTime();
    if (Number.isNaN(t)) continue;
    events.push({
      when: t,
      label: h.status === "Lost" ? "Marked Lost" : h.status === "Won" ? "Sold" : `Moved to ${h.status}`,
      sub: h.status === "Lost" && lead.lostReason ? `Reason: ${lead.lostReason}` : undefined,
      tone: h.status === "Won" ? "green" : h.status === "Lost" ? "red" : "gold",
    });
  }

  if (lead.appointment) {
    const t = new Date(lead.appointment).getTime();
    if (!Number.isNaN(t)) events.push({ when: t, label: "Appointment", sub: t > Date.now() ? "Scheduled" : "Was scheduled", tone: "blue" });
  }

  events.sort((a, b) => a.when - b.when);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Customer Journey</div>
        <div className="text-xs font-bold text-mission-gold">{lead.status}</div>
      </div>
      <ol className="relative ml-1 space-y-4 border-l border-white/12 pl-5">
        {events.map((e, i) => {
          const Icon = e.tone === "green" ? Sparkles : e.tone === "red" ? XCircle : e.label === "Appointment" ? CalendarClock : e.label === "Lead created" ? Flag : CircleDot;
          const color = e.tone === "green" ? "text-mission-green" : e.tone === "red" ? "text-mission-red" : e.tone === "gold" ? "text-mission-gold" : "text-mission-green";
          return (
            <li key={i} className="relative">
              <span className={`absolute -left-[27px] grid h-5 w-5 place-items-center rounded-full border border-white/15 bg-[#0b0d12] ${color}`}>
                <Icon className="h-3 w-3" />
              </span>
              <div className="text-sm font-bold text-white">{e.label}</div>
              {e.sub && <div className="text-xs text-white/55">{e.sub}</div>}
              <div className="mt-0.5 text-[11px] text-white/40">{fmt(e.when)}</div>
            </li>
          );
        })}
      </ol>
      {(lead.statusHistory || []).length === 0 && (
        <p className="mt-4 text-xs leading-5 text-white/40">Step-by-step history starts logging from each status change — moves before then aren&apos;t shown.</p>
      )}
    </div>
  );
}
