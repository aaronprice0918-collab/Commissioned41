"use client";

import { useMemo, useState } from "react";
import { evaluatePurchase } from "@/lib/engine";
import type { FinancialProfile } from "@/lib/types";
import { currency } from "@/lib/format";
import { Label, Pill } from "./primitives";

const QUICK = [50, 200, 800, 2400];

export function DecisionEngine({ profile }: { profile: FinancialProfile }) {
  const [raw, setRaw] = useState("800");
  const amount = Math.max(Number(raw.replace(/[^0-9.]/g, "")) || 0, 0);
  const verdict = useMemo(() => evaluatePurchase(profile, amount), [profile, amount]);

  const toneColor =
    verdict.tone === "good" ? "var(--good)" : verdict.tone === "watch" ? "var(--watch)" : "var(--stop)";
  const headline =
    verdict.tone === "good" ? "Clear to buy" : verdict.tone === "watch" ? "Think twice" : "Hold off";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <Label>Decision Engine</Label>
        <Pill tone="accent">Mission Mode</Pill>
      </div>

      <p className="mt-2 text-sm text-[var(--text-dim)]">Before you buy — ask EILA.</p>

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
        <span className="text-2xl font-light text-[var(--text-faint)]">$</span>
        <input
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="num w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-[var(--text-faint)]"
          placeholder="0"
          aria-label="Purchase amount"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => setRaw(String(q))}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-[var(--text-dim)] transition hover:border-white/25 hover:text-white"
          >
            {currency(q)}
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border p-4" style={{ borderColor: `${toneColor}40`, background: `${toneColor}0d` }}>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: toneColor, boxShadow: `0 0 10px ${toneColor}` }} />
          <span className="text-base font-semibold" style={{ color: toneColor }}>
            {headline}
          </span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-dim)]">{verdict.recommendation}</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="Safe after" value={currency(verdict.safeAfter)} tone={verdict.safeAfter < 0 ? "stop" : "neutral"} />
        <Metric label="Hours of work" value={`${verdict.hoursOfWork.toFixed(1)}h`} />
        <Metric label="Deals to replace" value={verdict.dealsToReplace.toFixed(1)} />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
        Buying this slips your top goal by about{" "}
        <span className="text-[var(--text-dim)]">{Math.round(verdict.goalImpactDays)} days</span>. Invested instead at
        8%, it&apos;s ~{currency(amount * 1.08)} in a year.
      </p>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "stop" }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">{label}</div>
      <div className="num mt-1 text-lg font-semibold" style={{ color: tone === "stop" ? "var(--stop)" : undefined }}>
        {value}
      </div>
    </div>
  );
}
