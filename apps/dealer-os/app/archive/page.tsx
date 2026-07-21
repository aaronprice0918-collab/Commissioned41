"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ChevronLeft, FileClock, Loader2 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { askIla } from "@/lib/askIla";
import { currency, displayPersonName } from "@/lib/data";
import { loadStore } from "@/lib/storeClient";
import type { ClosedMonth } from "@/lib/closeMonth";

// The month archive — every closed month, with its locked recap and the full
// deal log. Read-only history: the live board is always the current month; this
// is where June (and every month before it) lives after the roll.
export default function ArchivePage() {
  const [months, setMonths] = useState<ClosedMonth[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    loadStore<ClosedMonth[]>("closedMonths").then((saved) => setMonths(Array.isArray(saved) ? saved : []));
  }, []);

  const open = useMemo(() => months?.find((m) => m.id === openId) ?? null, [months, openId]);

  if (months === null) {
    return (
      <div className="grid place-items-center py-20 text-white/50">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (open) {
    return (
      <div>
        <button type="button" onClick={() => setOpenId(null)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white/55 transition hover:text-white">
          <ChevronLeft className="h-4 w-4" /> All closed months
        </button>
        <SectionHeader title={open.monthLabel} kicker="Closed month — locked recap" icon={FileClock} />

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Units" value={String(open.summary.delivered)} onExplain={() => askIla(`Explain the archived ${open.monthKey} month\u2019s Units of ${String(open.summary.delivered)} — the real math behind that locked number.`)} />
          <Stat label="Total Gross" value={currency(open.summary.gross)} onExplain={() => askIla(`Explain the archived ${open.monthKey} month\u2019s Total Gross of ${currency(open.summary.gross)} — the real math behind that locked number.`)} />
          <Stat label="Front" value={currency(open.summary.front)} onExplain={() => askIla(`Explain the archived ${open.monthKey} month\u2019s Front of ${currency(open.summary.front)} — the real math behind that locked number.`)} />
          <Stat label="Back" value={currency(open.summary.back)} onExplain={() => askIla(`Explain the archived ${open.monthKey} month\u2019s Back of ${currency(open.summary.back)} — the real math behind that locked number.`)} />
          <Stat label="F&I Gross" value={currency(open.summary.financeGross)} onExplain={() => askIla(`Explain the archived ${open.monthKey} month\u2019s F&I Gross of ${currency(open.summary.financeGross)} — the real math behind that locked number.`)} />
          <Stat label="F&I PVR" value={currency(open.summary.financePvr)} onExplain={() => askIla(`Explain the archived ${open.monthKey} month\u2019s F&I PVR of ${currency(open.summary.financePvr)} — the real math behind that locked number.`)} />
          <Stat label="PVR" value={currency(open.summary.pvr)} onExplain={() => askIla(`Explain the archived ${open.monthKey} month\u2019s PVR of ${currency(open.summary.pvr)} — the real math behind that locked number.`)} />
          <Stat label="PPU" value={open.summary.ppu.toFixed(2)} onExplain={() => askIla(`Explain the archived ${open.monthKey} month\u2019s PPU of ${open.summary.ppu.toFixed(2)} — the real math behind that locked number.`)} />
        </div>

        <div className="mb-5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/45">
          <span>New {open.summary.newUnits} · Used {open.summary.usedUnits} · Wholesale {open.summary.wholesaleUnits}</span>
          <span>Closed {new Date(open.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} by {open.closedByName}</span>
        </div>

        <div className="glass-card overflow-hidden rounded-[14px]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-[0.12em] text-white/45">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Salesperson</th>
                  <th className="px-4 py-3 text-right">Front</th>
                  <th className="px-4 py-3 text-right">Back</th>
                </tr>
              </thead>
              <tbody>
                {open.deals.map((d) => (
                  <tr key={d.id} className="border-b border-white/5 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-white/70">{new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}</td>
                    <td className="px-4 py-2.5 text-white/90">{d.customer || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-white/60">{d.stockNumber || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-white/70">{displayPersonName(d.salesperson) || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-white/80">{currency(d.frontGross)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-white/80">{currency(d.backGrossReserve)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Month Archive" kicker="Every closed month, kept" icon={Archive} />
      {months.length === 0 ? (
        <div className="glass-card rounded-[14px] p-10 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-mission-gold/30 bg-mission-gold/10 text-mission-gold">
            <Archive className="h-7 w-7" />
          </div>
          <div className="mt-5 font-display text-2xl font-black text-white">No closed months yet.</div>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/58">
            When you close a month from the Deal Center, it&apos;s locked in here — the full deal log and the month-end numbers — so nothing is lost on the roll to the next month.
          </p>
          <Link href="/deal-center" className="mt-5 inline-flex items-center gap-2 rounded-[12px] bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
            Go to Deal Center
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {months.map((m) => (
            <button key={m.id} type="button" onClick={() => setOpenId(m.id)} className="glass-card rounded-[14px] p-5 text-left transition hover:border-mission-gold/40">
              <div className="flex items-center justify-between">
                <div className="font-display text-xl font-black text-white">{m.monthLabel}</div>
                <FileClock className="h-4 w-4 text-white/35" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <MiniStat label="Units" value={String(m.summary.delivered)} />
                <MiniStat label="Gross" value={currency(m.summary.gross)} />
                <MiniStat label="F&I" value={currency(m.summary.financeGross)} />
              </div>
              <div className="mt-4 text-[11px] text-white/40">
                {m.dealCount} deals · closed {new Date(m.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Every glass tile in the app taps — these explain their locked month via EILA.
function Stat({ label, value, onExplain }: { label: string; value: string; onExplain?: () => void }) {
  const body = (
    <>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</div>
      <div className="mt-1 font-display text-xl font-black text-white">{value}</div>
      {onExplain && <div className="mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/25">ask EILA why</div>}
    </>
  );
  if (!onExplain) return <div className="glass-card rounded-[12px] p-4 text-center">{body}</div>;
  return (
    <button type="button" onClick={onExplain} className="glass-card w-full rounded-[12px] p-4 text-center transition hover:border-mission-gold/30">
      {body}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-white/8 bg-white/[0.03] p-2 text-center">
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">{label}</div>
      <div className="mt-0.5 text-sm font-black text-white">{value}</div>
    </div>
  );
}
