"use client";

import { Check } from "lucide-react";
import { DEAL_STEPS, type DealProgress as Progress, type DealStep } from "@/components/CrmProvider";

// Road-to-the-sale check-off bubbles. The sales manager taps each as the deal
// moves; green means done. At a glance you see exactly where an up stands.
export function DealProgress({ progress, onToggle }: { progress?: Progress; onToggle: (step: DealStep) => void }) {
  const p = progress || {};
  const done = DEAL_STEPS.filter((s) => p[s.key]).length;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Road to the Sale</div>
        <div className="text-xs font-bold text-mission-gold">{done}/{DEAL_STEPS.length}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {DEAL_STEPS.map((s, i) => {
          const checked = Boolean(p[s.key]);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onToggle(s.key)}
              aria-pressed={checked}
              className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                checked
                  ? "border-mission-green/55 bg-mission-green/12 text-white"
                  : "border-white/12 bg-white/[0.03] text-white/55 hover:border-mission-gold/45 hover:text-white"
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-black ${
                  checked ? "border-mission-green bg-mission-green text-mission-navy" : "border-white/25 text-white/40"
                }`}
              >
                {checked ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
