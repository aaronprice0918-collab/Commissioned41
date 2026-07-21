"use client";

import { useState } from "react";
import Link from "next/link";
import { Car, Factory, ShipWheel } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { DealsModal } from "@/components/DealsModal";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { currency, displayPersonName, isSold, type Deal, type VehicleClass } from "@/lib/data";
import { askIla } from "@/lib/askIla";

const classes: { label: VehicleClass; icon: typeof Car; tone: "green" | "gold" | "blue" }[] = [
  { label: "New", icon: Car, tone: "green" },
  { label: "Used", icon: ShipWheel, tone: "gold" },
  { label: "Wholesale", icon: Factory, tone: "blue" },
];

export default function CommandPage() {
  const { deals } = useDeals();
  const [drill, setDrill] = useState<{ title: string; deals: Deal[] } | null>(null);

  return (
    <div>
      <SectionHeader title="Sales by Type" kicker="New, used &amp; wholesale" />
      <div className="grid gap-5 lg:grid-cols-3">
        {classes.map((command) => {
          const filtered = deals.filter((deal) => isSold(deal) && deal.vehicleClass === command.label);
          const gross = filtered.reduce((sum, deal) => sum + deal.frontGross + deal.backGrossReserve, 0);
          const dealGross = (deal: (typeof filtered)[number]) => deal.frontGross + deal.backGrossReserve;
          const topGrossers = [...filtered].sort((a, b) => dealGross(b) - dealGross(a)).slice(0, 4);
          const Icon = command.icon;
          return (
            <section key={command.label} className="glass-card rounded-[12px] p-5">
              <div className="mb-6 flex items-center justify-between">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-mission-gold/10 text-mission-gold">
                  <Icon className="h-6 w-6" />
                </div>
                <StatusPill tone={command.tone}>{command.label}</StatusPill>
              </div>
              {/* Tap drills into the deals; "ask EILA why" walks the math. */}
              <div className="grid gap-3">
                <MetricCard label="Units" value={`${filtered.length}`} detail="Delivered / funded — tap" tone={command.tone} onClick={() => setDrill({ title: `${command.label} Deals`, deals: filtered })} onExplain={() => askIla(`Explain our ${command.label} units count — which delivered or funded deals are in it, and flag anything miscounted or misclassified.`)} />
                <MetricCard label="Total Gross" value={currency(gross)} detail="Front + back gross — tap" tone={command.tone} onClick={() => setDrill({ title: `${command.label} Deals`, deals: filtered })} onExplain={() => askIla(`Explain our ${command.label} total gross — walk the real math deal by deal in plain words, front vs back, and where we're leaving money.`)} />
              </div>
              <div className="mt-5">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-white/45">Top grossers</div>
                <div className="space-y-3">
                  {topGrossers.map((deal) => (
                    <Link key={deal.id} href={`/deal-entry?id=${deal.id}`} className="group block rounded-[12px] border border-white/10 bg-white/[0.035] p-3 transition hover:border-mission-gold/40 hover:bg-white/[0.06]">
                      <div className="flex items-center justify-between gap-3">
                        <strong className="text-white group-hover:text-mission-gold">{deal.customer}</strong>
                        <span className="text-sm font-bold text-mission-gold">{currency(dealGross(deal))}</span>
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-white/42">{deal.stockNumber} | {displayPersonName(deal.salesperson)}</div>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {drill && <DealsModal title={drill.title} deals={drill.deals} onClose={() => setDrill(null)} />}
    </div>
  );
}
