"use client";

import { AlertTriangle, Check, ClipboardCheck, ShieldCheck } from "lucide-react";
import { officeCheckSummary, type Deal, type OfficeManualKey } from "@/lib/data";

// The office-clean "Ready to Post" gate. Advisory only: it surfaces warnings on a
// deal before it's keyed into the DMS/accounting, but the F&I manager can always
// mark it Ready to Post — warnings or not. Dealer Mission OS is the clean gate in front of
// the DMS, not the DMS. Auto checks reflect the deal data; the three manual checks
// (taxes, stips, docs) are tapped off by the office.
export function OfficeCheckCard({
  deal,
  onToggleManual,
  onMarkReady,
}: {
  deal: Deal;
  onToggleManual: (key: OfficeManualKey) => void;
  onMarkReady: (ready: boolean) => void;
}) {
  const { checks, passed, total, open, clean } = officeCheckSummary(deal);
  const ready = Boolean(deal.readyToPost);

  function handleMarkReady() {
    if (open.length > 0) {
      const ok = window.confirm(
        `${open.length} item${open.length === 1 ? "" : "s"} still flagged:\n\n` +
          open.map((c) => `• ${c.label}`).join("\n") +
          `\n\nMark this deal Ready to Post anyway?`,
      );
      if (!ok) return;
    }
    onMarkReady(true);
  }

  return (
    <section className="glass-card rounded-[12px] p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-display text-lg font-black text-white">
          <ClipboardCheck className="h-5 w-5 text-mission-gold" /> Office Clean
        </div>
        <div className={`text-xs font-black ${clean ? "text-mission-green" : "text-mission-gold"}`}>
          {passed}/{total} clean
        </div>
      </div>
      <p className="mb-4 text-xs leading-5 text-white/45">
        A quick office-clean pass before this deal posts to accounting. Warnings only — you can post anyway.
      </p>

      <div className="space-y-2">
        {checks.map((c) => {
          const inner = (
            <>
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  c.ok ? "border-mission-green bg-mission-green text-mission-navy" : "border-mission-gold/60 text-mission-gold"
                }`}
              >
                {c.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  {c.label}
                  {c.manual && <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-white/40">tap</span>}
                </span>
                <span className={`block text-xs leading-5 ${c.ok ? "text-white/42" : "text-mission-gold/80"}`}>{c.detail}</span>
              </span>
            </>
          );
          if (c.manual && c.manualKey) {
            const key = c.manualKey;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onToggleManual(key)}
                aria-pressed={c.ok}
                className={`flex w-full items-start gap-3 rounded-[12px] border px-3 py-2.5 text-left transition ${
                  c.ok ? "border-mission-green/45 bg-mission-green/10" : "border-white/12 bg-white/[0.03] hover:border-mission-gold/45"
                }`}
              >
                {inner}
              </button>
            );
          }
          return (
            <div
              key={c.key}
              className={`flex items-start gap-3 rounded-[12px] border px-3 py-2.5 ${
                c.ok ? "border-white/8 bg-white/[0.02]" : "border-mission-gold/25 bg-mission-gold/[0.06]"
              }`}
            >
              {inner}
            </div>
          );
        })}
      </div>

      {ready ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-center gap-2 rounded-full border border-mission-green/40 bg-mission-green/12 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-mission-green">
            <ShieldCheck className="h-4 w-4" /> Ready to Post
          </div>
          <button
            type="button"
            onClick={() => onMarkReady(false)}
            className="w-full text-center text-xs font-bold uppercase tracking-[0.14em] text-white/40 transition hover:text-white/70"
          >
            Undo
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleMarkReady}
          className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.12em] transition ${
            clean
              ? "bg-mission-green text-mission-navy hover:brightness-110"
              : "border border-mission-gold/50 bg-mission-gold/10 text-mission-gold hover:bg-mission-gold/20"
          }`}
        >
          <ShieldCheck className="h-4 w-4" /> {clean ? "Mark Ready to Post" : `Mark Ready (${open.length} flagged)`}
        </button>
      )}
    </section>
  );
}
