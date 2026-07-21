"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, CalendarCheck, Loader2, ShieldCheck, X } from "lucide-react";
import { useDeals } from "@/components/DealProvider";
import { useAuth } from "@/components/AuthProvider";
import { currency, type Deal } from "@/lib/data";
import { loadStore, saveStore } from "@/lib/storeClient";
import {
  buildClosedMonth,
  monthAnchor,
  monthLabelOf,
  summarizeMonth,
  upsertClosedMonth,
  type ClosedMonth,
} from "@/lib/closeMonth";

// "Close the month" — archive the live month (deals + a locked recap) so it
// survives the roll, THEN clear the board. The archive write is verified before
// anything is cleared: if the backup fails, the month is never lost.
export function CloseMonthButton({ deals }: { deals: Deal[] }) {
  const { clearDeals } = useDeals();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const label = monthLabelOf(monthAnchor(deals));
  const s = summarizeMonth(deals);

  async function closeMonth() {
    setBusy(true);
    setError("");
    try {
      const snapshot = buildClosedMonth(deals, profile?.employeeName || profile?.displayName || "");
      const existing = (await loadStore<ClosedMonth[]>("closedMonths")) || [];
      const nextArchive = upsertClosedMonth(Array.isArray(existing) ? existing : [], snapshot);
      // Verify the archive LANDED before touching the live board — a failed
      // backup must never cost the month.
      const saved = await saveStore("closedMonths", nextArchive);
      if (!saved) {
        setError("Couldn't save the archive — nothing was cleared. Check your connection and try again.");
        setBusy(false);
        return;
      }
      clearDeals(); // board -> zero, app re-anchors to the new month
      setDone(snapshot.monthLabel);
    } catch {
      setError("Something went wrong — nothing was cleared. Try again.");
      setBusy(false);
    }
  }

  if (deals.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setDone(null); setError(""); }}
        className="inline-flex items-center gap-2 rounded-[12px] border border-mission-green/40 bg-mission-green/10 px-4 py-2 text-sm font-bold text-mission-green transition hover:border-mission-green/70 hover:bg-mission-green/15"
      >
        <CalendarCheck className="h-4 w-4" /> Close the Month
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="glass-card w-full max-w-lg rounded-[18px] p-6">
            {done ? (
              <div className="text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-mission-green/40 bg-mission-green/10 text-mission-green">
                  <ShieldCheck className="h-7 w-7" />
                </div>
                <div className="mt-4 font-display text-2xl font-black text-white">{done} is closed.</div>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-white/60">
                  It&apos;s archived and safe. The board is clear and now reads the new month — set your goals and load this month&apos;s deals.
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Link href="/archive" className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
                    <Archive className="h-4 w-4" /> View the archive
                  </Link>
                  <button type="button" onClick={() => { setOpen(false); setBusy(false); }} className="rounded-[12px] border border-white/12 px-5 py-2.5 text-sm font-bold text-white/75 transition hover:bg-white/5">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-mission-green">Close the Month</div>
                    <h2 className="mt-1 font-display text-2xl font-black text-white">{label}</h2>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full text-white/50 transition hover:bg-white/5 hover:text-white" aria-label="Cancel">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <p className="mt-3 text-sm leading-6 text-white/62">
                  This locks {label} into the archive — every deal plus these month-end numbers — then clears the board for the new month. You can open the archive any time.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Recap label="Units" value={String(s.delivered)} />
                  <Recap label="Total Gross" value={currency(s.gross)} />
                  <Recap label="F&I Gross" value={currency(s.financeGross)} />
                  <Recap label="Deals on board" value={String(deals.length)} />
                </div>

                {error && (
                  <div className="mt-4 rounded-[12px] border border-mission-red/30 bg-mission-red/10 p-3 text-sm font-semibold text-mission-red">
                    {error}
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-[12px] border border-white/12 px-5 py-2.5 text-sm font-bold text-white/75 transition hover:bg-white/5 disabled:opacity-50">
                    Cancel
                  </button>
                  <button type="button" onClick={closeMonth} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-mission-green px-5 py-2.5 text-sm font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110 disabled:opacity-60">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
                    {busy ? "Archiving…" : `Close ${label}`}
                  </button>
                </div>
                <p className="mt-3 text-center text-[11px] text-white/35">
                  The month is saved to the archive first — if that fails, nothing is cleared.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3 text-center">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</div>
      <div className="mt-1 font-display text-lg font-black text-white">{value}</div>
    </div>
  );
}
