"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, Phone, PhoneCall, Snowflake, CalendarClock, Sparkles, Check, Clock } from "lucide-react";
import clsx from "clsx";
import { useMission } from "@/lib/store";
import { useAskIla } from "./AppShell";
import { Deal, Industry, STATUS_LABEL } from "@/lib/types";
import { INDUSTRY_DEAL, statusLabel } from "@/lib/industry";
import { followUpQueue, daysSince } from "@/lib/engine";
import { SectionTitle } from "./ui";

// The follow-up queue — the "nothing goes cold" promise, delivered. Every live
// opportunity lands in exactly one bucket: Overdue, Due today, Going cold
// (live but untouched with nothing scheduled), or Scheduled. One tap hands
// EILA the customer and she drafts the message; Done books the next touch.
// The actual bucketing rules live in lib/engine.ts (followUpQueue) — shared
// with the proactive-nudge cron job, so "who needs you" never drifts between
// what's on screen and what pings your phone.

export function FollowUpQueue() {
  const { data, updateDeal } = useMission();
  const askIla = useAskIla();
  const industry: Industry = data.profile?.industry ?? "other";

  const q = useMemo(() => followUpQueue(data.deals), [data.deals]);

  const draft = (d: Deal) => {
    const spec = INDUSTRY_DEAL[industry];
    const about = d.item || spec.itemLabel.toLowerCase();
    askIla(
      `Draft a short, personal follow-up text to ${d.customer || "this customer"} about the ${about} (currently ${statusLabel(industry, d.status, STATUS_LABEL[d.status]).toLowerCase()}).${d.note ? ` Context: ${d.note}.` : ""} Keep it human — something I can send as-is.`,
    );
  };
  // "Done" = you made the touch; EILA books the next one 3 days out so the
  // thread never dangles. "Tomorrow" pushes a touch you can't make today.
  const done = (d: Deal) => updateDeal(d.id, { followUpAt: inDays(3) });
  const tomorrow = (d: Deal) => updateDeal(d.id, { followUpAt: inDays(1) });

  return (
    <div>
      <div className="px-1">
        <div className="text-xl font-black">Follow-up queue</div>
        <div className="text-xs text-fg/65">
          {q.needsYou ? `${q.needsYou} ${q.needsYou === 1 ? "person needs" : "people need"} you` : "Nothing due — the queue is clean"}
        </div>
      </div>

      <div className="glass mt-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent2">Today&apos;s follow-up pressure</div>
            <div className="mt-1 text-[15px] font-bold leading-snug text-fg/85">
              {q.overdue.length
                ? `Start with ${q.overdue[0].customer || "the oldest overdue touch"}.`
                : q.dueToday.length
                  ? `Start with ${q.dueToday[0].customer || "today's first touch"}.`
                  : q.goingCold.length
                    ? `${q.goingCold[0].customer || "One opportunity"} is going cold. Warm it back up.`
                    : "Clean board. Keep tomorrow from sneaking up."}
            </div>
          </div>
          <div className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black tabnum ${q.needsYou ? "bg-warn/15 text-warn" : "bg-good/15 text-good"}`}>
            {q.needsYou ? `${q.needsYou} now` : "clear"}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 border-t border-fg/6 pt-2 text-center">
          <div className="border-r border-fg/6 px-2">
            <div className={`text-lg font-black tabnum ${q.overdue.length ? "text-warn" : "text-fg/45"}`}>{q.overdue.length}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/45">overdue</div>
          </div>
          <div className="border-r border-fg/6 px-2">
            <div className={`text-lg font-black tabnum ${q.dueToday.length ? "text-accent" : "text-fg/45"}`}>{q.dueToday.length}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/45">today</div>
          </div>
          <div className="px-2">
            <div className={`text-lg font-black tabnum ${q.goingCold.length ? "text-accent2" : "text-fg/45"}`}>{q.goingCold.length}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/45">cold</div>
          </div>
        </div>
      </div>

      <Bucket title="Overdue" icon={<AlertTriangle size={13} />} tone="warn" deals={q.overdue} industry={industry} onDraft={draft} onDone={done} onTomorrow={tomorrow} sub={(d) => `was due ${daysAgo(d.followUpAt!)}`} />
      <Bucket title="Due today" icon={<PhoneCall size={13} />} tone="accent" deals={q.dueToday} industry={industry} onDraft={draft} onDone={done} onTomorrow={tomorrow} sub={() => "today"} />
      <Bucket title="Going cold" icon={<Snowflake size={13} />} tone="cold" deals={q.goingCold} industry={industry} onDraft={draft} onDone={done} onTomorrow={tomorrow} sub={(d) => `no touch scheduled · ${daysSince(d.date)}d old`} />
      <Bucket title="Scheduled" icon={<CalendarClock size={13} />} tone="dim" deals={q.scheduled} industry={industry} onDraft={draft} onDone={done} onTomorrow={tomorrow} sub={(d) => `next touch ${shortDate(d.followUpAt!)}`} quiet />

      {q.needsYou === 0 && q.scheduled.length === 0 && (
        <div className="glass mt-6 p-8 text-center text-sm text-fg/50">
          No live opportunities to work. Add prospects from <span className="text-accent">+</span> and EILA will keep the queue warm.
        </div>
      )}
    </div>
  );
}

function Bucket({ title, icon, tone, deals, industry, onDraft, onDone, onTomorrow, sub, quiet }: {
  title: string; icon: React.ReactNode; tone: "warn" | "accent" | "cold" | "dim";
  deals: Deal[]; industry: Industry;
  onDraft: (d: Deal) => void; onDone: (d: Deal) => void; onTomorrow: (d: Deal) => void;
  sub: (d: Deal) => string; quiet?: boolean;
}) {
  if (!deals.length) return null;
  const toneCls = { warn: "text-warn", accent: "text-accent2", cold: "text-accent2", dim: "text-fg/65" }[tone];
  return (
    <>
      <SectionTitle><span className={clsx("flex items-center gap-1.5", toneCls)}>{icon} {title} · {deals.length}</span></SectionTitle>
      <div className="space-y-2">
        {deals.map((d) => (
          <div key={d.id} className={clsx("glass p-3.5", tone === "warn" && "living-ring")}>
            <Link href={`/deal/${d.id}`} className="flex items-center gap-3 active:opacity-70">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{d.customer || "New opportunity"}</div>
                <div className="truncate text-xs text-fg/70">
                  {itemLine(d, industry)} · {statusLabel(industry, d.status, STATUS_LABEL[d.status])} · <span className={toneCls}>{sub(d)}</span>
                </div>
              </div>
            </Link>
            {!quiet && (
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => onDraft(d)} className="btn btn-primary !flex-1 !py-2 !text-[13px]">
                  <Sparkles size={14} /> Draft with EILA
                </button>
                {d.phone && (
                  <a href={`tel:${d.phone.replace(/[^0-9+]/g, "")}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-good/15 text-good active:scale-95" aria-label={`Call ${d.customer || "customer"}`}>
                    <Phone size={15} />
                  </a>
                )}
                <button onClick={() => onDone(d)} className="flex h-9 items-center gap-1.5 rounded-xl bg-fg/8 px-3 text-[13px] font-semibold text-good active:scale-95" aria-label="Touched — book the next one">
                  <Check size={15} /> Done
                </button>
                <button onClick={() => onTomorrow(d)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fg/6 text-fg/70 active:scale-95" aria-label="Move to tomorrow">
                  <Clock size={15} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function itemLine(d: Deal, industry: Industry): string {
  const spec = INDUSTRY_DEAL[industry];
  if (d.item) return d.item;
  return spec.categories?.find((c) => c.id === d.category)?.label ?? spec.itemLabel;
}
function daysAgo(iso: string): string {
  const n = daysSince(iso);
  return n === 0 ? "earlier today" : n === 1 ? "yesterday" : `${n} days ago`;
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function inDays(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
