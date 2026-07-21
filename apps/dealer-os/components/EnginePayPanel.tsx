"use client";

import { ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import type { CompPlan, CompResult, CompRule, PlanVocabulary } from "@/lib/payEngine";
import { makeMoney, metricLabel } from "@/lib/payFormat";
import { periodFor } from "@/lib/payCycle";

// Plain-English one-liner per rule — shared by the Studio and the live panel.
// Speaks the plan's vocabulary (currency + metric labels) when one is supplied.
export function describeRule(r: CompRule, vocab?: PlanVocabulary): string {
  const money = makeMoney(vocab);
  const label = (key: string) => metricLabel(key, vocab);
  switch (r.kind) {
    case "grid": return `Grid: ${label(r.x.metric)} × ${label(r.y.metric)} → % of ${label(r.base)} (${r.y.tiers.length}×${r.x.tiers.length} cells).`;
    case "flat": return `Flat: ${r.pct}% of ${label(r.base)}.`;
    case "tier": return `Tiered on ${label(r.metric)}: ${r.tiers.map((t) => `${t.min}→${t.pct != null ? `${t.pct}%` : money(t.flat ?? 0)}`).join(", ")}.`;
    case "bonus": {
      const conds = (Array.isArray(r.when) ? r.when : [r.when]).map((c) => `${label(c.metric)} ${c.op} ${c.value}`).join(" AND ");
      return `Bonus "${r.label}": when ${conds} → ${r.addRatePct ? `+${r.addRatePct}%` : ""}${r.addFlat ? ` +${money(r.addFlat)}` : ""}.`;
    }
    case "penalty": return `Penalty "${r.label}": when ${label(r.when.metric)} ${r.when.op} ${r.when.value} → −${r.reduceGrossPct}% of gross${r.addPctPerConsecutive ? ` (+${r.addPctPerConsecutive}%/consecutive period)` : ""}.`;
    case "deduction": return `Deduction "${r.label}": ${money(r.amountPerEvent)} per ${label(r.perEventMetric)}.`;
    case "draw": {
      const amt = r.amount ?? r.monthly ?? 0;
      const per = r.per === "cycle" ? "pay period" : "month";
      return `Draw: ${money(amt)} / ${per}, advanced against commission.`;
    }
    case "trueup": return `True-up "${r.label}": ${r.note}`;
    default: return JSON.stringify(r);
  }
}

// The live, engine-driven pay panel — renders ANY CompPlan's result the same way.
export function EnginePayPanel({ plan, result, monthName }: { plan: CompPlan & { planType?: string; confidence?: string }; result: CompResult; monthName: string }) {
  const money = makeMoney(plan.vocab);
  const per = plan.cycle?.periodNoun || plan.vocab?.periodNoun || "month";
  const cycleInfo = plan.cycle
    ? (() => { const p = periodFor(plan.cycle!, new Date(), plan.vocab?.locale); return `${p.label} · check ${p.payDate.toLocaleDateString(plan.vocab?.locale || "en-US", { month: "short", day: "numeric" })}`; })()
    : null;
  return (
    <section className="rise rounded-[20px] border border-white/8 bg-white/[0.025] p-6" style={{ animationDelay: "160ms" }}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-black text-white">{monthName} Pay — {plan.name}</h2>
          <div className="text-xs text-white/45">Live from the compensation engine · {result.planType} plan{cycleInfo ? ` · ${cycleInfo}` : ""}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="gold">{result.effectiveRatePct.toFixed(1)}% rate</StatusPill>
          <StatusPill tone={result.confidence === "high" ? "green" : result.confidence === "low" ? "red" : "amber"}>{result.confidence} confidence</StatusPill>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Commission EXCLUDES the flat bonuses (they're their own rows below)
            so the visible rows actually sum to net — grossCommission already
            contains them, and showing both double-counted on screen. */}
        <Row label="Commission" value={result.grossCommission - result.bonuses.reduce((s, b) => s + b.amount, 0)} fmt={money} />
        {result.bonuses.filter((b) => b.amount).map((b, i) => <Row key={`b${i}`} label={b.label} value={b.amount} fmt={money} />)}
        {result.penalties.map((p, i) => <Row key={`p${i}`} label={`${p.label} (−${p.pct}%)`} value={-p.amount} fmt={money} />)}
        {result.deductions.map((d, i) => <Row key={`d${i}`} label={d.label} value={-d.amount} fmt={money} />)}
        {result.drawOffset > 0 && <Row label="Draw (advance)" value={-result.drawOffset} fmt={money} />}
        <Row label="Net estimated pay" value={result.netEstimatedPay} highlight fmt={money} />
      </div>

      {result.opportunities.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-mission-gold">Best move this {per}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {result.opportunities.map((o) => (
              <div key={o.label} className="rounded-[12px] border border-mission-gold/25 bg-mission-gold/[0.06] p-3">
                <div className="text-sm font-bold text-white">{o.label}</div>
                <div className="mt-0.5 text-xs text-white/60">{o.detail}</div>
                {o.estAddedPay != null && <div className="mt-1 font-display text-base font-black text-mission-gold">+{money(Math.round(o.estAddedPay))}/{per}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/45 transition hover:text-white/70">
          <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" /> Plan rules &amp; calculation
        </summary>
        <div className="mt-2 space-y-3 border-l border-white/10 pl-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Rules</div>
            <ul className="mt-1 space-y-1 text-xs leading-5 text-white/60">{plan.rules.map((r, i) => <li key={i}>{describeRule(r, plan.vocab)}</li>)}</ul>
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/40">How it calculated</div>
            <ul className="mt-1 space-y-1 text-xs leading-5 text-white/60">
              {result.explanation.map((l, i) => <li key={i}>{l}</li>)}
              {result.warnings.map((w, i) => <li key={`w${i}`} className="text-mission-gold/80">⚠ {w}</li>)}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}

function Row({ label, value, highlight = false, fmt }: { label: string; value: number; highlight?: boolean; fmt: (n: number) => string }) {
  return (
    <div className={`rounded-[12px] border p-4 ${highlight ? "border-mission-gold/40 bg-mission-gold/10" : "border-white/10 bg-white/[0.035]"}`}>
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">{label}</div>
      <div className={`mt-2 font-display text-2xl font-black ${highlight ? "text-mission-gold" : value < 0 ? "text-mission-red" : "text-white"}`}>{fmt(value)}</div>
    </div>
  );
}
