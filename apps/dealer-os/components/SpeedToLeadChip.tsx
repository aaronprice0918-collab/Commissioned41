"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { type CrmLead } from "@/components/CrmProvider";
import { speedClock } from "@/lib/speedToLead";

// The 5:00 clock on a fresh up (lib/speedToLead.ts is the brain). Gold and
// counting while there's still time, red with minutes-over once breached,
// invisible once the lead's been contacted. Ticks every second on the clock
// (it's a countdown — it should feel alive), every 30s after the breach.
export function SpeedToLeadChip({ lead, onContacted }: { lead: CrmLead; onContacted?: () => void }) {
  // Mount-gate + tick: the clock reads Date.now(), so SSR/first paint must not
  // render it (hydration), and re-render is driven by this counter.
  const [, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const clock = mounted ? speedClock(lead) : { state: "not_applicable" as const };

  useEffect(() => {
    if (clock.state !== "on_clock" && clock.state !== "breached") return;
    const interval = setInterval(() => setTick((t) => t + 1), clock.state === "on_clock" ? 1000 : 30000);
    return () => clearInterval(interval);
  }, [clock.state]);

  if (clock.state === "on_clock") {
    const m = Math.floor(clock.secondsLeft / 60);
    const s = String(clock.secondsLeft % 60).padStart(2, "0");
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-mission-gold/50 bg-mission-gold/10 px-2.5 py-1 text-[11px] font-black tabular-nums text-mission-gold">
        <Timer className="h-3.5 w-3.5" /> {m}:{s}
        {onContacted && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onContacted(); }} className="ml-1 rounded-full bg-mission-gold px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-mission-navy">
            Contacted ✓
          </button>
        )}
      </span>
    );
  }
  if (clock.state === "breached") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-mission-red/60 bg-mission-red/15 px-2.5 py-1 text-[11px] font-black tabular-nums text-mission-red">
        <Timer className="h-3.5 w-3.5" /> OVER {clock.minutesOver < 60 ? `${clock.minutesOver}m` : `${Math.floor(clock.minutesOver / 60)}h`}
        {onContacted && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onContacted(); }} className="ml-1 rounded-full bg-mission-red px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-white">
            Contacted ✓
          </button>
        )}
      </span>
    );
  }
  return null;
}
