"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { PayPlan, PlanType } from "@/lib/payplan/types";
import { classifyPlan, money } from "@/lib/payplan/calc";
import { Industry } from "@/lib/types";
import { INDUSTRY_DEAL } from "@/lib/industry";
import { Labeled, NumInput, parseNumericInput as num } from "./ui";

const PLAN_LABEL: Record<PlanType, string> = {
  flat: "Flat %", tiered: "Tiered", grid: "Grid", perDeal: "Per-deal", hybrid: "Hybrid", unknown: "Needs review",
};

export function PlanEditor({
  plan,
  onChange,
  unit = { singular: "sale", plural: "sales" },
  industry = "other",
}: {
  plan: PayPlan;
  onChange: (p: PayPlan) => void;
  unit?: { singular: string; plural: string };
  industry?: Industry;
}) {
  // Single-channel industries never see the secondary-% or per-add-on fields —
  // a realtor's plan is one percentage, not a dealership front/back split.
  const spec = INDUSTRY_DEAL[industry];
  const set = (patch: Partial<PayPlan>) => { const next = { ...plan, ...patch }; onChange({ ...next, type: classifyPlan(next) }); };
  const setBase = (patch: Partial<PayPlan["base"]>) => set({ base: { ...plan.base, ...patch } });

  return (
    <div className="space-y-3">
      {/* plan type + confidence */}
      <div className="flex items-center justify-between px-1">
        <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">{PLAN_LABEL[plan.type]} plan</span>
        <span className="text-xs text-fg/65">{Math.round(plan.confidence * 100)}% confidence{plan.effectiveDate ? ` · eff. ${plan.effectiveDate}` : ""}</span>
      </div>

      {plan.unsupported.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-xs text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>Flagged for review: {plan.unsupported.join("; ")}</span>
        </div>
      )}

      {/* grid (read-only, builds trust) */}
      {plan.grid && (
        <div className="glass overflow-x-auto p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg/70">Commission grid (PPU × PVR)</div>
          <table className="w-full text-center text-[11px] tabnum">
            <thead>
              <tr className="text-fg/65">
                <th className="px-1 py-1 text-left">PPU↓ PVR→</th>
                {plan.grid.x.map((c) => <th key={c} className="px-1 py-1">{c >= 1000 ? `$${(c / 1000).toFixed(c % 1000 ? 2 : 1)}k` : c}</th>)}
              </tr>
            </thead>
            <tbody>
              {plan.grid.y.map((r, ri) => (
                <tr key={r} className="border-t border-fg/5">
                  <td className="px-1 py-1 text-left text-fg/55">{r.toFixed(1)}</td>
                  {plan.grid!.rates[ri].map((rate, ci) => <td key={ci} className="px-1 py-1 text-fg/75">{rate}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* base (flat) fields */}
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Primary commission %" value={plan.base.frontPct} onChange={(v) => setBase({ frontPct: v })} suffix="%" />
        {spec.secondaryLabel && <NumField label="Secondary commission %" value={plan.base.backPct} onChange={(v) => setBase({ backPct: v })} suffix="%" />}
        <NumField label={`Flat $ per ${unit.singular}`} value={plan.base.perUnit} onChange={(v) => setBase({ perUnit: v })} prefix="$" />
        {spec.addonsLabel && <NumField label="Per add-on / bonus item" value={plan.base.perProduct} onChange={(v) => setBase({ perProduct: v })} prefix="$" />}
        <NumField label="Draw / mo" value={plan.draw?.amount ?? 0} onChange={(v) => set({ draw: v ? { amount: v, period: plan.draw?.period ?? "monthly", recoverable: true } : undefined })} prefix="$" />
        {plan.draw && <NumField label="Draw balance carried in" value={plan.drawCarriedIn ?? 0} onChange={(v) => set({ drawCarriedIn: v || undefined })} prefix="$" />}
        <NumField label="Take-home goal / mo" value={plan.takeHomeGoal ?? 0} onChange={(v) => set({ takeHomeGoal: v || undefined })} prefix="$" />
        <NumField label="Guarantee" value={plan.guaranteeFloor ?? 0} onChange={(v) => set({ guaranteeFloor: v || undefined })} prefix="$" />
        <NumField label={`Monthly goal (${unit.plural})`} value={plan.goalUnits} onChange={(v) => set({ goalUnits: v })} />
        <NumField label="Tax % (optional)" value={plan.taxRate} onChange={(v) => set({ taxRate: v })} suffix="%" />
      </div>

      {/* rules summary (read-only) */}
      {(plan.bonuses.length > 0 || plan.penalties.length > 0 || plan.deductions.length > 0) && (
        <div className="glass space-y-2 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg/70">Rules read from your plan</div>
          {plan.bonuses.map((b) => <RuleRow key={b.id} label={b.label} tone="good" />)}
          {plan.penalties.map((p) => <RuleRow key={p.id} label={`${p.label} (−${p.reduceGrossPct}%)`} tone="warn" />)}
          {plan.deductions.map((d) => <RuleRow key={d.id} label={d.label} tone="warn" />)}
        </div>
      )}

      {/* unit tiers (editable) */}
      <div className="glass p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg/70">Volume bonus tiers</span>
          {/* time-based id, NOT tiers.length — length collides after a delete-then-add, and id collisions make one edit hit two tiers */}
          <button onClick={() => set({ tiers: [...plan.tiers, { id: `t${Date.now().toString(36)}`, label: "Unit bonus", metric: "units", threshold: 0, kind: "flat", amount: 0 }] })} className="grid h-7 w-7 place-items-center rounded-lg bg-fg/8 active:scale-95" aria-label="Add tier"><Plus size={15} /></button>
        </div>
        <div className="space-y-2">
          {plan.tiers.filter((t) => t.metric === "units").map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <NumInput className="field tabnum flex-1 !py-2 text-center" value={t.threshold} placeholder={unit.plural}
                onChange={(v) => set({ tiers: plan.tiers.map((x) => x.id === t.id ? { ...x, threshold: v } : x) })} />
              <span className="text-fg/60">→</span>
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/65">$</span>
                <NumInput className="field tabnum !py-2 !pl-7" value={t.amount} placeholder="bonus"
                  onChange={(v) => set({ tiers: plan.tiers.map((x) => x.id === t.id ? { ...x, amount: v } : x) })} />
              </div>
              <button onClick={() => set({ tiers: plan.tiers.filter((x) => x.id !== t.id) })} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-fg/6 text-fg/50 active:scale-95" aria-label="Remove tier"><Trash2 size={15} /></button>
            </div>
          ))}
          {plan.tiers.filter((t) => t.metric === "units").length === 0 && <div className="py-2 text-center text-xs text-fg/60">No volume tiers — tap + to add one.</div>}
        </div>
      </div>
    </div>
  );
}

function RuleRow({ label, tone }: { label: string; tone: "good" | "warn" }) {
  return <div className="flex items-center gap-2 text-sm text-fg/70"><span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", tone === "good" ? "bg-good" : "bg-warn")} />{label}</div>;
}
function NumField({ label, value, onChange, prefix, suffix }: { label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string }) {
  return (
    <Labeled label={label}>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/65">{prefix}</span>}
        {/* !pl-7 — .field's own padding is unlayered CSS and beats a plain utility, which left the $ bleeding under the digits */}
        {/* NumInput, not a bare parse-on-change input: money fields must accept decimals — "22.5%" used to save as 225 */}
        <NumInput className={clsx("field tabnum", prefix && "!pl-7")} value={value} onChange={onChange} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg/65">{suffix}</span>}
      </div>
    </Labeled>
  );
}
export { money };
