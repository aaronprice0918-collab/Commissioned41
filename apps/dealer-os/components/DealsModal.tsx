"use client";

import { X } from "lucide-react";
import { currency, dealTypeLabel, displayPersonName, isProductOnly, totalGross, type Deal } from "@/lib/data";

// A shared drill-down: tap a summary stat card → see the deals behind it. Keeps
// Aaron's rule ("if it looks interactive, it must BE interactive") consistent
// across every dashboard instead of a bespoke modal per page.
export function DealsModal({ title, subtitle, deals, onClose }: { title: string; subtitle?: string; deals: Deal[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-card relative mt-2 w-full max-w-2xl rounded-[16px] p-5 sm:mt-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="font-display text-2xl font-black text-white">{title}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-white/45">
              {subtitle ? `${subtitle} · ` : ""}{deals.length} {deals.length === 1 ? "deal" : "deals"}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {deals.length === 0 ? (
          <p className="py-10 text-center text-sm text-white/45">No deals here yet.</p>
        ) : (
          <div className="mt-3 max-h-[62dvh] space-y-2 overflow-y-auto pr-1">
            {deals.map((deal) => {
              const total = totalGross(deal);
              return (
                <div key={deal.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white">{deal.customer || "—"}</div>
                    <div className="truncate text-[11px] text-white/45">
                      {dealTypeLabel(deal)} · {isProductOnly(deal) ? "no vehicle" : (deal.stockNumber || "no stock")} · {displayPersonName(deal.salesperson)}
                      {deal.financeManager ? ` · F&I ${displayPersonName(deal.financeManager)}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-display text-sm font-black ${total >= 0 ? "text-mission-green" : "text-mission-red"}`}>{currency(total)}</div>
                    <div className="text-[10px] text-white/40">F {currency(deal.frontGross)} · B {currency(deal.backGrossReserve)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
