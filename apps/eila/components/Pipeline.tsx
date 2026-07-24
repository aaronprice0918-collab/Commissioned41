"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight, PhoneCall, Trash2, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { useMission } from "@/lib/store";
import { Deal, DealStatus, Industry, STATUS_LABEL } from "@/lib/types";
import { INDUSTRY_DEAL, statusLabel } from "@/lib/industry";
import { calculatePay, localMonthKey, money, perfFromDeals } from "@/lib/engine";
import { vscIdOf } from "@/lib/fni";
import { SectionTitle } from "./ui";

// the order a deal advances through
const FLOW: DealStatus[] = ["prospect", "appointment", "working", "pending", "finance", "delivered"];
// prospect included: a freshly added prospect used to be invisible on every
// screen for its first 4 days (until "going cold") while still inflating the
// projections (July 8 audit).
const LIVE: DealStatus[] = ["prospect", "appointment", "working", "pending", "finance"];

export function Pipeline() {
  const { data, updateDeal, removeDeal } = useMission();
  const industry: Industry = data.profile?.industry ?? "other";
  const isFinance = data.profile?.role === "finance";
  const plan = data.profile!.plan;
  const spec = INDUSTRY_DEAL[industry];

  const groups = useMemo(() => {
    const monthKey = localMonthKey(new Date().toISOString());
    const live = data.deals.filter((d) => LIVE.includes(d.status));
    const byStage: Record<string, Deal[]> = {};
    LIVE.forEach((s) => (byStage[s] = live.filter((d) => d.status === s)));
    const monthDeals = data.deals.filter((d) => localMonthKey(d.date) === monthKey && d.status !== "dead");
    const deliveredThisMonth = monthDeals.filter((d) => d.status === "delivered").sort((a, b) => b.date.localeCompare(a.date));
    const pay = calculatePay(plan, perfFromDeals(deliveredThisMonth, vscIdOf(data.profile)));
    const followDue = data.deals.filter(
      (d) => d.followUpAt && new Date(d.followUpAt) <= endToday() && d.status !== "delivered" && d.status !== "dead"
    );
    return { byStage, monthDeals, deliveredThisMonth, pay, followDue };
  }, [data.deals, plan]);

  const advance = (d: Deal) => {
    const i = FLOW.indexOf(d.status);
    const next = FLOW[Math.min(i + 1, FLOW.length - 1)];
    updateDeal(d.id, { status: next });
  };
  const followToday = (d: Deal) => updateDeal(d.id, { followUpAt: new Date().toISOString() });

  const liveCount = LIVE.reduce((n, s) => n + groups.byStage[s].length, 0);

  return (
    <div>
      <div className="flex items-center justify-between px-1">
        <div>
          <div className="text-xl font-black">Deals</div>
          <div className="text-xs text-fg/65">This month&apos;s log. Tap any deal for its report card.</div>
        </div>
        {isFinance && (
          <Link href="/finance" className="flex items-center gap-1 text-xs font-semibold text-accent2 active:opacity-70">
            Finance queue <ChevronRight size={13} />
          </Link>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Link href="/report" className="glass p-3 text-center active:opacity-75">
          <div className="text-[10px] font-bold uppercase tracking-wider text-fg/50">Closed</div>
          <div className="mt-0.5 text-xl font-black tabnum text-fg">{groups.deliveredThisMonth.length}</div>
        </Link>
        <Link href="/report" className="glass p-3 text-center active:opacity-75">
          <div className="text-[10px] font-bold uppercase tracking-wider text-fg/50">Made</div>
          <div className="mt-0.5 text-xl font-black tabnum text-good">{money(groups.pay.grossPay)}</div>
        </Link>
        <div className="glass p-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-fg/50">Live</div>
          <div className="mt-0.5 text-xl font-black tabnum text-accent">{liveCount}</div>
        </div>
      </div>

      {groups.deliveredThisMonth.length > 0 && (
        <>
          <SectionTitle action={<Link href="/report" className="text-xs font-bold text-accent2">Report</Link>}>Delivered this month</SectionTitle>
          <div className="space-y-2">
            {groups.deliveredThisMonth.map((d) => (
              <div key={d.id} className="glass flex items-center gap-3 p-3.5">
                <CheckCircle2 size={18} className="shrink-0 text-good" />
                <Link href={`/deal/${d.id}`} className="min-w-0 flex-1 active:opacity-70">
                  <div className="truncate text-sm font-semibold">{d.customer || "Customer"} · {dealSub(d, industry)}</div>
                  <div className="text-xs text-fg/65 tabnum">
                    {money(d.amount + d.secondary)}{spec.addonsLabel ? ` · ${d.addons} ${spec.addonsLabel.toLowerCase()}` : ""} · report card
                  </div>
                </Link>
                <button onClick={() => removeDeal(d.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg/60 active:scale-95" aria-label="Delete"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </>
      )}

      {groups.followDue.length > 0 && (
        <>
          <SectionTitle>
            <span className="flex items-center gap-1.5 text-accent2"><PhoneCall size={13} /> Customer reminders</span>
          </SectionTitle>
          <div className="space-y-2">
            {groups.followDue.map((d) => <Card key={d.id} d={d} industry={industry} onAdvance={advance} onFollow={followToday} onDelete={removeDeal} highlight />)}
          </div>
        </>
      )}

      {liveCount > 0 && <SectionTitle>Live deals</SectionTitle>}
      {LIVE.map((stage) =>
        groups.byStage[stage].length ? (
          <div key={stage}>
            <SectionTitle>{statusLabel(industry, stage, STATUS_LABEL[stage])} · {groups.byStage[stage].length}</SectionTitle>
            <div className="space-y-2">
              {groups.byStage[stage].map((d) => <Card key={d.id} d={d} industry={industry} onAdvance={advance} onFollow={followToday} onDelete={removeDeal} />)}
            </div>
          </div>
        ) : null
      )}

      {liveCount === 0 && (
        <div className="glass mt-6 p-8 text-center text-sm text-fg/50">
          No live opportunities yet. Tap <span className="text-accent">+</span> to add a prospect or appointment.
        </div>
      )}
    </div>
  );
}

// A deal's one-line descriptor: the item if named, else its category label,
// else the industry's item noun — never a bare internal id.
function dealSub(d: Deal, industry: Industry): string {
  const spec = INDUSTRY_DEAL[industry];
  if (d.item) return d.item;
  const cat = spec.categories?.find((c) => c.id === d.category)?.label;
  return cat ?? spec.itemLabel;
}

function Card({ d, industry, onAdvance, onFollow, onDelete, highlight }: {
  d: Deal; industry: Industry; onAdvance: (d: Deal) => void; onFollow: (d: Deal) => void; onDelete: (id: string) => void; highlight?: boolean;
}) {
  return (
    <div className={clsx("glass p-3.5", highlight && "living-ring")}>
      <Link href={`/deal/${d.id}`} className="flex items-center gap-3 active:opacity-70">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{d.customer || "New opportunity"}</div>
          <div className="truncate text-xs text-fg/70">{dealSub(d, industry)}{d.note ? ` · ${d.note}` : ""}</div>
        </div>
        <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent">{statusLabel(industry, d.status, STATUS_LABEL[d.status])}</span>
      </Link>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => onAdvance(d)} className="btn btn-primary !flex-1 !py-2 !text-[13px]">
          Advance <ChevronRight size={14} />
        </button>
        <button onClick={() => onFollow(d)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fg/8 text-accent2 active:scale-95" aria-label="Set customer reminder for today"><PhoneCall size={16} /></button>
        <button onClick={() => onDelete(d.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fg/6 text-fg/65 active:scale-95" aria-label="Delete"><Trash2 size={16} /></button>
      </div>
    </div>
  );
}

function endToday() { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
