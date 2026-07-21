"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

// The portable "answer what to do next" strip — the standard distilled from
// MorningBrief into one drop-in primitive. Any screen leads with this: a
// one-line EILA read (what's happening / what needs attention) + ONE prominent,
// one-click next-best-action. Keeps every screen passing the 10-Second Rule
// without re-inventing the layout each time. `action` is optional — omit it on a
// pure status read, but prefer giving the user a single clear move.
export function NextActionBar({
  read,
  action,
  tone = "green",
}: {
  read: string;
  action?: { label: string; sub?: string; href: string };
  tone?: "green" | "amber" | "red";
}) {
  const box =
    tone === "red"
      ? "border-mission-red/30 bg-mission-red/[0.08]"
      : tone === "amber"
        ? "border-mission-gold/30 bg-mission-gold/10"
        : "border-mission-green/30 bg-mission-green/10";
  const accent = tone === "red" ? "text-mission-red" : tone === "amber" ? "text-mission-gold" : "text-mission-green";

  return (
    <section className="rise glass-card rounded-[16px] p-5 sm:p-6">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
        <span className={`live-dot h-1.5 w-1.5 rounded-full ${tone === "red" ? "bg-mission-red" : tone === "amber" ? "bg-mission-gold" : "bg-mission-green"}`} aria-hidden />
        EILA read
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">{read}</p>
      {action && (
        <Link
          href={action.href}
          className={`group mt-4 flex items-center justify-between gap-3 rounded-[14px] border ${box} px-5 py-4 transition hover:brightness-110`}
        >
          <div className="min-w-0">
            <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${accent} opacity-90`}>Do this next</div>
            <div className="mt-1 truncate font-display text-xl font-black text-white">{action.label}</div>
            {action.sub && <div className="text-xs text-white/55">{action.sub}</div>}
          </div>
          <ArrowRight className={`h-6 w-6 shrink-0 ${accent} transition group-hover:translate-x-1`} />
        </Link>
      )}
    </section>
  );
}
