 "use client";

import { useState } from "react";
import { ClipboardList, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { countsTowardPpu, currency, dealStageLabel, displayPersonName, productUnits } from "@/lib/data";
import { askIla } from "@/lib/askIla";

export default function DealScorecardPage() {
  const { deals } = useDeals();
  const { settings } = useStoreSettings();
  const targets = settings.targets;
  const [selectedId, setSelectedId] = useState("");
  // Default to the deal that needs the most help (lowest total gross), so the
  // page opens on coaching value instead of an arbitrary first record.
  const defaultFocus = [...deals].sort((a, b) => a.frontGross + a.backGrossReserve - (b.frontGross + b.backGrossReserve))[0];
  const deal = deals.find((d) => d.id === selectedId) ?? defaultFocus;

  if (!deal) {
    return (
      <div>
        <SectionHeader title="Deal Scorecard" kicker="Quality at the deal level" />
        <div className="glass-card rounded-[12px] p-10 text-center">
          <div className="font-display text-3xl font-black text-white">No deals entered yet.</div>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/58">Enter a deal first, then this scorecard will show deal-level quality and pay-impact signals.</p>
        </div>
      </div>
    );
  }
  const total = deal.frontGross + deal.backGrossReserve;
  const products = productUnits(deal);
  const productReady = countsTowardPpu(deal);
  const pvrPass = total >= targets.pvrTotal;
  const frontPass = deal.frontGross >= targets.frontEnd;
  const backPass = deal.backGrossReserve >= targets.backEnd;
  const ppuPass = productReady && products >= targets.ppuElite;

  // EILA's concrete "how to fix this deal" — the move for each failing pillar, so
  // the scorecard coaches instead of just grading.
  const fixes: string[] = [];
  if (!frontPass) fixes.push(`Front is ${currency(targets.frontEnd - deal.frontGross)} under goal — hold gross, add accessories, or protect the price.`);
  if (productReady && !backPass) fixes.push(`Back is ${currency(targets.backEnd - deal.backGrossReserve)} light — present the full menu, lead with VSC + GAP.`);
  if (productReady && !ppuPass) fixes.push(`Only ${products} product${products === 1 ? "" : "s"} on the deal — get to ${targets.ppuElite}+ with a maintenance or appearance add.`);
  if (!pvrPass) fixes.push(`Total gross ${currency(targets.pvrTotal - total)} under target — find it across front and back before delivery.`);

  return (
    <div>
      <SectionHeader title="Deal Scorecard" kicker="Quality at the deal level" />
      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.16em] text-white/42">Deal</label>
        <select value={deal.id} onChange={(event) => setSelectedId(event.target.value)}
          className="h-11 w-full max-w-md rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition focus:border-mission-gold/60">
          {deals.map((d) => (
            <option key={d.id} value={d.id}>{d.id} · {d.customer || "—"}{d.stockNumber ? ` · ${d.stockNumber}` : ""}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <section className="glass-card rounded-[12px] p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <StatusPill tone="gold">{deal.id}</StatusPill>
              <h1 className="mt-4 font-display text-4xl font-black text-white">{deal.customer}</h1>
              <div className="mt-2 text-sm uppercase tracking-[0.18em] text-white/46">{deal.stockNumber} | {deal.vehicleClass} | {displayPersonName(deal.salesperson)}</div>
            </div>
            <StatusPill tone={deal.stage === "Delivered" || deal.stage === "Funded" ? "green" : "blue"}>{dealStageLabel(deal.stage)}</StatusPill>
          </div>
          {/* Tap-to-explain: each deal number hands off to EILA to walk its math. */}
          <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Total Gross" value={currency(total)} detail={`Goal ${currency(targets.pvrTotal)}`} tone={pvrPass ? "green" : "red"} onExplain={() => askIla(`Explain the total gross on ${deal.customer}'s deal — front plus back against the ${currency(targets.pvrTotal)} goal, and how to find what's missing if it's light.`)} />
            <MetricCard label="Front Gross" value={currency(deal.frontGross)} detail={`Goal ${currency(targets.frontEnd)}`} tone={frontPass ? "green" : "red"} onExplain={() => askIla(`Explain the front gross on ${deal.customer}'s deal — the real math against the ${currency(targets.frontEnd)} goal, and the move to protect or raise it.`)} />
            <MetricCard label="Back" value={currency(deal.backGrossReserve)} detail={`Goal ${currency(targets.backEnd)}`} tone={backPass ? "green" : "red"} onExplain={() => askIla(`Explain the back gross on ${deal.customer}'s deal — against the ${currency(targets.backEnd)} goal, and the product or reserve play that raises it.`)} />
            <MetricCard label="Products" value={`${products}`} detail={productReady ? `Elite ${targets.ppuElite}` : "Wholesale excluded from PPU"} tone={ppuPass ? "gold" : productReady ? "blue" : "red"} onExplain={() => askIla(`Explain the product count on ${deal.customer}'s deal — what's on it, whether it counts toward PPU, and what's missing to reach ${targets.ppuElite}.`)} />
          </div>
          <div className={`mt-6 rounded-[12px] border p-5 ${fixes.length ? "border-mission-gold/30 bg-mission-gold/[0.07]" : "border-mission-green/30 bg-mission-green/[0.07]"}`}>
            <div className="mb-3 flex items-center gap-3">
              <Sparkles className={`h-5 w-5 ${fixes.length ? "text-mission-gold" : "text-mission-green"}`} />
              <div className="font-display text-xl font-black text-white">{fixes.length ? "How to fix this deal" : "This deal is clean"}</div>
            </div>
            {fixes.length ? (
              <ul className="space-y-2">
                {fixes.map((fix, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-6 text-white/75">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-mission-gold" aria-hidden />
                    {fix}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-6 text-white/70">Gross, products, and structure all hit target. Protect it through funding and keep the file clean.</p>
            )}
          </div>

          <div className="mt-4 rounded-[12px] border border-white/10 bg-white/[0.035] p-5">
            <div className="mb-4 flex items-center gap-3">
              <ClipboardList className="h-5 w-5 text-mission-gold" />
              <div className="font-display text-xl font-black text-white">Mission Debrief</div>
            </div>
            <p className="text-base leading-7 text-white/64">{deal.missionDebrief}</p>
          </div>
        </section>
        <aside className="space-y-4">
          {[
            { icon: Gauge, label: "PVR", pass: pvrPass },
            { icon: ShieldCheck, label: "Back-End", pass: backPass },
            { icon: Sparkles, label: "Product Depth", pass: ppuPass },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="glass-card rounded-[12px] p-5">
                <div className="flex items-center justify-between">
                  <Icon className="h-6 w-6 text-mission-gold" />
                  <StatusPill tone={item.pass ? "green" : "amber"}>{item.pass ? "Mission Pass" : "Watch"}</StatusPill>
                </div>
                <div className="mt-5 font-display text-2xl font-black text-white">{item.label}</div>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
