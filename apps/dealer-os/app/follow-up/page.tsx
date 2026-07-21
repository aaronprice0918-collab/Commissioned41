"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Mail, MessageSquareText, Phone, Timer } from "lucide-react";
import { NextActionBar } from "@/components/NextActionBar";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useCrmLeads, type CrmLead } from "@/components/CrmProvider";
import { isOpenLead, leadCreatedMs, scoreLead, type LeadScore, type LeadScoreLabel } from "@/lib/leadScore";
import { personLabel } from "@/lib/desk";
import { askIla } from "@/lib/askIla";
import { canContact } from "@/lib/consent";
import { appendMessagePatch } from "@/lib/comms";
import { TextThread } from "@/components/TextThread";
import { SpeedToLeadChip } from "@/components/SpeedToLeadChip";

// A live ticking "now" so the speed-to-lead clock counts up on screen.
function useNow(intervalMs = 20_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}


type Filter = "all" | "overdue" | "hot" | "nurture";

// The AI Follow-Up Center — every open lead, scored 0–100 for buying intent and
// sorted so the rep works the right one first, each with the cadence-driven next
// move and one-tap call/email/open. This is the "respond to the right lead next"
// engine the modern CRMs sell — built on data we already have, no black box.
export default function FollowUpPage() {
  const { leads, updateLead } = useCrmLeads();
  const [filter, setFilter] = useState<Filter>("all");
  const [textingId, setTextingId] = useState("");
  const now = useNow();

  const scored = leads
    .filter(isOpenLead)
    .map((lead) => ({ lead, s: scoreLead(lead) }))
    .sort((a, b) => Number(b.s.overdue) - Number(a.s.overdue) || b.s.score - a.s.score);

  const overdue = scored.filter((r) => r.s.overdue);
  const hot = scored.filter((r) => r.s.label === "Hot");
  const nurture = scored.filter((r) => r.s.label === "Nurture" || r.s.label === "Cold");

  const shown =
    filter === "overdue" ? overdue : filter === "hot" ? hot : filter === "nurture" ? nurture : scored;

  const top = (overdue[0] || hot[0] || scored[0]) ?? null;
  const read = scored.length
    ? `${scored.length} open lead${scored.length === 1 ? "" : "s"} · ${hot.length} hot · ${overdue.length} overdue. Work top-down — EILA scored every one for buying intent.`
    : "No open leads to work. Create an opportunity in the Showroom and it'll show up here, scored.";
  const action = top
    ? { label: top.s.recommendedTouch, sub: `${top.lead.customer || "Top lead"} · score ${top.s.score}`, href: `/desking?lead=${top.lead.id}` }
    : undefined;

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: scored.length },
    { key: "overdue", label: "Overdue", count: overdue.length },
    { key: "hot", label: "Hot", count: hot.length },
    { key: "nurture", label: "Nurture", count: nurture.length },
  ];

  return (
    <div>
      <SectionHeader title="Follow-Up" kicker="Who to work next — scored by EILA" />

      <div className="mb-5"><NextActionBar read={read} action={action} tone={overdue.length ? "red" : hot.length ? "amber" : "green"} /></div>

      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black uppercase tracking-[0.1em] transition ${filter === c.key ? "bg-mission-gold text-mission-navy shadow-gold" : "border border-white/12 text-white/60 hover:text-white"}`}
          >
            {c.label} <span className="tabular-nums opacity-70">{c.count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="glass-card rounded-[12px] p-10 text-center text-sm leading-6 text-white/55">Nothing in this bucket right now.</div>
      ) : (
        <div className="space-y-3">
          {shown.map(({ lead, s }) => (
            <FollowUpRow key={lead.id} lead={lead} s={s} now={now} onText={() => setTextingId(lead.id)} />
          ))}
        </div>
      )}

      {textingId && (() => {
        const lead = leads.find((l) => l.id === textingId);
        if (!lead) return null;
        return (
          <TextThread
            lead={lead}
            onClose={() => setTextingId("")}
            onSent={(message) => updateLead(lead.id, { ...appendMessagePatch(lead, message), ...(lead.firstContactAt ? {} : { firstContactAt: message.at }) })}
          />
        );
      })()}
    </div>
  );
}

function FollowUpRow({ lead, s, now, onText }: { lead: CrmLead; s: LeadScore; now: number; onText: () => void }) {
  const phone = lead.customerPhone?.replace(/[^0-9+]/g, "");
  return (
    <article className="glass-card rounded-[14px] p-4 sm:p-5">
      <div className="flex items-start gap-4">
        {/* Tap the score and EILA walks what's driving it. */}
        <ScoreRing
          score={s.score}
          label={s.label}
          onExplain={() => askIla(`Explain ${lead.customer || "this lead"}'s follow-up score of ${s.score} (${s.label}) — walk what's driving it in plain words and the right next touch.${s.overdue ? " It's flagged overdue — how bad is it and what's the save?" : ""}`)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-lg font-black text-white">{lead.customer || "New Lead"}</span>
            <StatusPill tone={s.overdue ? "red" : s.label === "Hot" ? "amber" : "blue"}>{lead.status}</StatusPill>
            {s.overdue && <StatusPill tone="red">Overdue</StatusPill>}
            {lead.status === "New Lead" && <SpeedToLeadChip lead={lead} />}
          </div>
          <div className="mt-0.5 truncate text-xs text-white/50">
            {lead.vehicle || "Vehicle TBD"} · {personLabel(lead.salesperson)} · {s.cadenceStage}
          </div>
          <p className="mt-2 text-sm leading-6 text-white/80">{s.recommendedTouch}</p>
          {s.factors.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.factors.slice(0, 3).map((f) => (
                <span key={f.label} className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${f.points >= 0 ? "border-white/10 text-white/55" : "border-mission-red/30 text-mission-red/80"}`}>
                  {f.label} {f.points > 0 ? `+${f.points}` : f.points}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {/* TCPA rail (lib/consent.ts): a revoked channel gets a dead red pill, not a live link. */}
            {phone && (canContact(lead, "call").allowed ? (
              <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 rounded-full bg-mission-gold px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110">
                <Phone className="h-3.5 w-3.5" /> Call
              </a>
            ) : (
              <span title={canContact(lead, "call").reason} className="inline-flex items-center gap-1.5 rounded-full border border-mission-red/50 bg-mission-red/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mission-red">
                <Phone className="h-3.5 w-3.5" /> Do not call
              </span>
            ))}
            {phone && (
              <button type="button" onClick={onText} className="inline-flex items-center gap-1.5 rounded-full border border-mission-gold/35 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
                <MessageSquareText className="h-3.5 w-3.5" /> Text{(lead.messages?.length ?? 0) > 0 ? ` (${lead.messages!.length})` : ""}
              </button>
            )}
            {lead.customerEmail && (canContact(lead, "email").allowed ? (
              <a href={`mailto:${lead.customerEmail}`} className="inline-flex items-center gap-1.5 rounded-full border border-mission-gold/35 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
                <Mail className="h-3.5 w-3.5" /> Email
              </a>
            ) : (
              <span title={canContact(lead, "email").reason} className="inline-flex items-center gap-1.5 rounded-full border border-mission-red/50 bg-mission-red/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mission-red">
                <Mail className="h-3.5 w-3.5" /> Do not email
              </span>
            ))}
            <Link href={`/desking?lead=${lead.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/65 transition hover:border-white/30 hover:text-white">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

// Tap-to-explain: with onExplain the ring is a button — EILA explains the score.
function ScoreRing({ score, label, onExplain }: { score: number; label: LeadScoreLabel; onExplain?: () => void }) {
  const color =
    label === "Hot" ? "rgb(var(--mission-red))" : label === "Warm" ? "rgb(var(--mission-gold))" : label === "Nurture" ? "rgb(var(--mission-green))" : "rgba(255,255,255,0.35)";
  const body = (
    <>
      <div
        className="grid h-14 w-14 place-items-center rounded-full"
        style={{ background: `conic-gradient(${color} ${score * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
      >
        <div className="grid h-11 w-11 place-items-center rounded-full bg-[#0b0d12]">
          <span className="font-display text-lg font-black tabular-nums text-white">{score}</span>
        </div>
      </div>
      <div className="mt-1 text-[10px] font-black uppercase tracking-[0.1em]" style={{ color }}>{label}</div>
    </>
  );
  if (onExplain) {
    return (
      <button type="button" onClick={onExplain} title="Tap — EILA explains this score" className="shrink-0 text-center transition active:scale-95">
        {body}
      </button>
    );
  }
  return <div className="shrink-0 text-center">{body}</div>;
}
