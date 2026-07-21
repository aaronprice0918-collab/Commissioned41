"use client";

import { useEffect } from "react";
import { reportTelemetry } from "@/lib/telemetry";

// Route-segment error boundary: catches React render crashes on a page, reports
// them to EILA's health sensor, and shows a clean recover screen instead of a
// white page.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportTelemetry("render", `${error?.message || "render error"}${error?.digest ? ` [${error.digest}]` : ""}`);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="glass-card max-w-md rounded-[16px] p-8 text-center">
        <div className="font-display text-2xl font-black text-white">Something hit a snag.</div>
        <p className="mt-2 text-sm leading-6 text-white/60">This screen ran into an error. It&apos;s been logged for EILA. Try again — if it keeps happening, EILA will flag it on your HQ.</p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-mission-green px-5 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-mission-navy transition hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
