"use client";

import { useState } from "react";
import { ClipboardCheck, Clock, FileWarning, ShieldCheck } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { DealsModal } from "@/components/DealsModal";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { displayPersonName, type Deal, type RdrStatus } from "@/lib/data";
import { askIla } from "@/lib/askIla";

const statuses: RdrStatus[] = ["Not Punched", "Pending", "Punched"];

export default function RdrCenterPage() {
  const { deals, updateDeal } = useDeals();
  const deliveredDeals = deals.filter((deal) => deal.stage === "Delivered" || deal.stage === "Funded");
  const notPunched = deliveredDeals.filter((deal) => (deal.rdrStatus || "Not Punched") === "Not Punched").length;
  const pending = deliveredDeals.filter((deal) => deal.rdrStatus === "Pending").length;
  const punched = deliveredDeals.filter((deal) => deal.rdrStatus === "Punched").length;
  const punchRate = deliveredDeals.length ? Math.round((punched / deliveredDeals.length) * 100) : 0;
  const notPunchedList = deliveredDeals.filter((deal) => (deal.rdrStatus || "Not Punched") === "Not Punched");
  const pendingList = deliveredDeals.filter((deal) => deal.rdrStatus === "Pending");
  const punchedList = deliveredDeals.filter((deal) => deal.rdrStatus === "Punched");
  const [drill, setDrill] = useState<{ title: string; subtitle?: string; deals: Deal[] } | null>(null);

  function mark(dealId: string, rdrStatus: RdrStatus) {
    updateDeal(dealId, {
      rdrStatus,
      rdrDate: rdrStatus === "Punched" ? new Date().toISOString().slice(0, 10) : "",
    });
  }

  return (
    <div>
      <SectionHeader title="RDR" kicker="Punch tracking" />
      {/* Tap drills into the deals; "ask EILA why" walks the math. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Delivered / Funded" value={`${deliveredDeals.length}`} detail="Deals needing RDR — tap" tone="gold" onClick={() => setDrill({ title: "Delivered / Funded", subtitle: "Needing RDR visibility", deals: deliveredDeals })} onExplain={() => askIla("Explain the delivered-and-funded count on the RDR board — which deals are in it and which still need a punch.")} />
        <MetricCard label="Not Punched" value={`${notPunched}`} detail="Needs action — tap" tone={notPunched > 0 ? "red" : "green"} onClick={() => setDrill({ title: "Not Punched", subtitle: "Needs action", deals: notPunchedList })} onExplain={() => askIla("Explain the not-punched RDR number — which delivered deals aren't punched, why that money's at risk, and which to punch first.")} />
        <MetricCard label="Pending" value={`${pending}`} detail="Waiting on completion — tap" tone="blue" onClick={() => setDrill({ title: "Pending", subtitle: "Waiting on completion", deals: pendingList })} onExplain={() => askIla("Explain the pending-RDR number — which deals are waiting on completion and how long they've been sitting.")} />
        <MetricCard label="Punched" value={`${punchRate}%`} detail={`${punched} completed — tap`} tone="green" onClick={() => setDrill({ title: "Punched", subtitle: `${punched} completed`, deals: punchedList })} onExplain={() => askIla("Explain my RDR punch rate — walk the real math in plain words (punched over delivered and funded) and what it takes to get it to 100%.")} />
      </div>

      <div className="glass-card mt-5 overflow-hidden rounded-[12px]">
        <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-mission-gold/10 text-mission-gold">
              <ClipboardCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="font-display text-2xl font-black text-white">RDR Punch Board</div>
              <div className="text-sm text-white/56">Track every delivered or funded unit until it is punched.</div>
            </div>
          </div>
          <StatusPill tone={notPunched === 0 ? "green" : "amber"}>{notPunched === 0 ? "Clear" : `${notPunched} Open`}</StatusPill>
        </div>

        {deliveredDeals.length === 0 ? (
          <div className="p-10 text-center">
            <FileWarning className="mx-auto h-10 w-10 text-mission-gold" />
            <div className="mt-4 font-display text-3xl font-black text-white">No delivered or funded deals yet.</div>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/58">Once deals are entered as Delivered or Funded, they will appear here for RDR tracking.</p>
          </div>
        ) : (
          <>
          {/* Mobile cards */}
          <div className="divide-y divide-white/8 md:hidden">
            {deliveredDeals.map((deal) => {
              const status = deal.rdrStatus || "Not Punched";
              return (
                <div key={deal.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-white">{deal.customer}</div>
                      <div className="mt-0.5 text-xs text-white/50">{deal.date} · {deal.stockNumber || "—"}</div>
                    </div>
                    <StatusPill tone={status === "Punched" ? "green" : status === "Pending" ? "amber" : "red"}>{status}</StatusPill>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-white/45">Salesperson</span><span className="text-right text-white/80">{displayPersonName(deal.salesperson)}</span>
                    <span className="text-white/45">Manager</span><span className="text-right text-white/80">{displayPersonName(deal.manager)}</span>
                    <span className="text-white/45">VIN</span><span className="text-right font-mono text-xs text-white/60">{deal.vin}</span>
                    <span className="text-white/45">RDR Date</span><span className="text-right text-white/80">{deal.rdrDate || "—"}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {statuses.map((nextStatus) => (
                      <button key={nextStatus} type="button" onClick={() => mark(deal.id, nextStatus)} className={`rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${status === nextStatus ? "border-mission-gold bg-mission-gold text-mission-navy" : "border-white/10 bg-white/[0.04] text-white/58"}`}>
                        {nextStatus === "Pending" && <Clock className="mr-1 inline h-3 w-3" />}
                        {nextStatus === "Punched" && <ShieldCheck className="mr-1 inline h-3 w-3" />}
                        {nextStatus}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead>
                <tr className="border-b border-mission-gold/20 bg-mission-gold/10">
                  {["Date", "Customer", "Stock", "VIN", "Salesperson", "Manager", "Status", "RDR Date", "Quick Action"].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliveredDeals.map((deal) => {
                  const status = deal.rdrStatus || "Not Punched";
                  return (
                    <tr key={deal.id} className="border-b border-white/8 hover:bg-white/[0.04]">
                      <td className="px-4 py-4 text-white/62">{deal.date}</td>
                      <td className="px-4 py-4 font-bold text-white">{deal.customer}</td>
                      <td className="px-4 py-4 text-white/70">{deal.stockNumber}</td>
                      <td className="px-4 py-4 font-mono text-xs text-white/50">{deal.vin}</td>
                      <td className="px-4 py-4 text-white/70">{displayPersonName(deal.salesperson)}</td>
                      <td className="px-4 py-4 text-white/70">{displayPersonName(deal.manager)}</td>
                      <td className="px-4 py-4"><StatusPill tone={status === "Punched" ? "green" : status === "Pending" ? "amber" : "red"}>{status}</StatusPill></td>
                      <td className="px-4 py-4 text-white/62">{deal.rdrDate || "-"}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {statuses.map((nextStatus) => (
                            <button
                              key={nextStatus}
                              type="button"
                              onClick={() => mark(deal.id, nextStatus)}
                              className={`rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${
                                status === nextStatus
                                  ? "border-mission-gold bg-mission-gold text-mission-navy"
                                  : "border-white/10 bg-white/[0.04] text-white/58 hover:border-mission-gold/40 hover:text-white"
                              }`}
                            >
                              {nextStatus === "Pending" && <Clock className="mr-1 inline h-3 w-3" />}
                              {nextStatus === "Punched" && <ShieldCheck className="mr-1 inline h-3 w-3" />}
                              {nextStatus}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {drill && <DealsModal title={drill.title} subtitle={drill.subtitle} deals={drill.deals} onClose={() => setDrill(null)} />}
    </div>
  );
}
