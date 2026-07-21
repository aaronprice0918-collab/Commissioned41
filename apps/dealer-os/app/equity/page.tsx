"use client";

import Link from "next/link";
import { ArrowRight, CarFront, KeyRound } from "lucide-react";
import { NextActionBar } from "@/components/NextActionBar";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { dealTypeLabel, displayPersonName, isSold, type Deal } from "@/lib/data";
import { askIla } from "@/lib/askIla";

// Equity Mining — a trade-up opportunity radar built on TIMING signals we can
// compute honestly: lease maturities (exact, from the lease term) and retail
// ownership age (the classic trade-up window). We deliberately do NOT invent an
// equity dollar figure — true equity = current value − payoff, and the live
// value lands with the inventory/valuation feed. This surfaces WHO to call and
// WHEN; the rep confirms the number at appraisal.

const MS_DAY = 86_400_000;

function monthsSince(dateStr: string, now: number): number {
  const d = new Date(`${dateStr}T12:00:00`).getTime();
  if (Number.isNaN(d)) return 0;
  return Math.max(0, Math.round((now - d) / (MS_DAY * 30.44)));
}

function leaseMaturity(deal: Deal): { date: Date; daysOut: number } | null {
  const term = deal.leaseTermMonths || 0;
  if (!term) return null;
  const start = new Date(`${deal.date}T12:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const date = new Date(start);
  date.setMonth(date.getMonth() + term);
  return { date, daysOut: Math.round((date.getTime() - Date.now()) / MS_DAY) };
}

const vehicleLabel = (d: Deal) => `${dealTypeLabel(d)}${d.stockNumber ? ` · ${d.stockNumber}` : ""}`;

export default function EquityPage() {
  const { deals } = useDeals();
  const now = Date.now();
  const sold = deals.filter(isSold);

  // Lease maturities — soonest first; we care most about the next ~6 months + any already due.
  const leases = sold
    .map((d) => ({ d, m: leaseMaturity(d) }))
    .filter((x): x is { d: Deal; m: { date: Date; daysOut: number } } => !!x.m)
    .filter((x) => x.m.daysOut <= 210) // ~7 months out and anything past due
    .sort((a, b) => a.m.daysOut - b.m.daysOut);

  // Retail trade-up window — the classic 18–54 month ownership sweet spot.
  const retail = sold
    .filter((d) => !d.isLease && d.vehicleClass !== "Wholesale")
    .map((d) => ({ d, months: monthsSince(d.date, now) }))
    .filter((x) => x.months >= 18 && x.months <= 54)
    .sort((a, b) => b.months - a.months);

  const total = leases.length + retail.length;
  const read =
    total === 0
      ? "No trade-up opportunities surfaced yet — they build as deals age and leases approach maturity."
      : `${leases.length} lease${leases.length === 1 ? "" : "s"} maturing soon · ${retail.length} owner${retail.length === 1 ? "" : "s"} in the trade-up window. Your warmest re-sell list — call before the competition does.`;
  const action = leases[0]
    ? { label: `Reach ${leases[0].d.customer || "your soonest lease maturity"}`, sub: leases[0].m.daysOut < 0 ? "Lease already matured" : `Lease matures in ${leases[0].m.daysOut} days`, href: "/crm-desk" }
    : retail[0]
      ? { label: `Reach ${retail[0].d.customer}`, sub: `Owned ~${retail[0].months} months — prime to trade`, href: "/crm-desk" }
      : undefined;

  return (
    <div>
      <SectionHeader title="Equity Mining" kicker="Trade-up radar — who to re-sell, and when" />

      <div className="mb-5"><NextActionBar read={read} action={action} tone={leases.some((x) => x.m.daysOut <= 60) ? "amber" : "green"} /></div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Lease maturities */}
        <section className="glass-card rounded-[16px] p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-mission-gold" />
            <h2 className="font-display text-lg font-black text-white">Lease Maturities</h2>
            <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-black tabular-nums text-white/70">{leases.length}</span>
          </div>
          {leases.length === 0 ? (
            <Empty>No leases maturing in the next several months.</Empty>
          ) : (
            <div className="space-y-2.5">
              {leases.map(({ d, m }) => (
                <OppCard
                  key={d.id}
                  deal={d}
                  pill={m.daysOut < 0 ? "Matured" : `${m.daysOut}d`}
                  pillTone={m.daysOut <= 0 ? "red" : m.daysOut <= 60 ? "gold" : "blue"}
                  detail={`Lease matures ${m.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                />
              ))}
            </div>
          )}
        </section>

        {/* Retail trade-up window */}
        <section className="glass-card rounded-[16px] p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <CarFront className="h-5 w-5 text-mission-gold" />
            <h2 className="font-display text-lg font-black text-white">Trade-Up Window</h2>
            <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-black tabular-nums text-white/70">{retail.length}</span>
          </div>
          {retail.length === 0 ? (
            <Empty>No owners in the 18–54 month window yet.</Empty>
          ) : (
            <div className="space-y-2.5">
              {retail.map(({ d, months }) => (
                <OppCard key={d.id} deal={d} pill={`${months}mo`} pillTone="blue" detail={`Owned ~${months} months · bought ${new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`} />
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="mt-5 text-center text-xs leading-5 text-white/40">
        Timing radar only — exact equity needs the current vehicle value, which arrives once your inventory list is connected. Confirm the number at appraisal.
      </p>
    </div>
  );
}

function OppCard({ deal, pill, pillTone, detail }: { deal: Deal; pill: string; pillTone: "red" | "gold" | "blue"; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[12px] border border-white/8 bg-white/[0.03] p-3.5">
      <div className="min-w-0">
        <div className="truncate font-bold text-white">{deal.customer || "Customer"}</div>
        <div className="mt-0.5 truncate text-[11px] text-white/45">{vehicleLabel(deal)} · {displayPersonName(deal.salesperson)}</div>
        <div className="mt-1 text-xs text-white/60">{detail}</div>
        <Link href={`/crm-desk?new=1&customer=${encodeURIComponent(deal.customer || "")}&vehicle=${encodeURIComponent(vehicleLabel(deal))}&source=Equity%20Radar`} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-mission-gold/35 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
          Start opportunity <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {/* Tap the timing pill and EILA walks why they're on the radar now. */}
      <button
        type="button"
        onClick={() => askIla(`Explain why ${deal.customer || "this customer"} is on the equity radar (${detail}) — walk the timing math in plain words and give me the play to bring them back in.`)}
        title="Tap — EILA explains this timing"
        className="shrink-0 transition active:scale-95"
      >
        <StatusPill tone={pillTone === "gold" ? "gold" : pillTone === "red" ? "red" : "blue"}>{pill}</StatusPill>
      </button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[12px] border border-white/8 bg-white/[0.02] p-6 text-center text-sm text-white/40">{children}</div>;
}
