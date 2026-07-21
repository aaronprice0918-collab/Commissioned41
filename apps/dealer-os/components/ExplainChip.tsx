"use client";

import { askIla } from "@/lib/askIla";

// The tap-to-explain affordance: a small, always-visible "ask EILA why" chip
// (phones don't hover, so it can't be hover-only). Stops propagation so it
// never steals the surrounding card's own tap. Nest it only inside non-button
// wrappers (div role="button") — a real <button>/<a> can't legally contain it.
export function ExplainChip({ prompt, className = "" }: { prompt: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); askIla(prompt); }}
      className={`relative z-10 text-[10px] font-black uppercase tracking-[0.18em] text-white/30 transition hover:text-mission-gold ${className}`}
    >
      ask EILA why
    </button>
  );
}
