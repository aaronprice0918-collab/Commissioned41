"use client";

import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { DEFAULT_AUTO_PRODUCTS, usesProductMenu } from "@/lib/fni";
import { INDUSTRY_UNIT, type Industry, type ProductDef } from "@/lib/types";
import type { Condition, Op, PayPlan } from "@/lib/payplan/types";
import type { MoneyConfig } from "@/lib/money/types";
import { money } from "@/lib/payplan/calc";

export function PayPlanReview({
  plan,
  industry,
  products,
  moneyConfig,
}: {
  plan: PayPlan;
  industry: Industry;
  products?: ProductDef[];
  moneyConfig?: MoneyConfig;
}) {
  const productMenu = products?.length ? products : usesProductMenu(industry) ? DEFAULT_AUTO_PRODUCTS : [];
  const vsc = findVscRule(plan);
  const vscProduct = productMenu.find((p) => p.id === "vsc");
  const unit = INDUSTRY_UNIT[industry];
  const paydays = formatPaydays(moneyConfig);
  const basis = plan.grid
    ? `${basisLabel(plan.grid.basis)} x PPU/PVR grid`
    : plan.perDeal
      ? "Each deal pays by its own rule"
      : plan.base.frontPct || plan.base.backPct
        ? `${pct(plan.base.frontPct)} front / ${pct(plan.base.backPct)} back`
        : plan.base.perUnit
          ? `${money(plan.base.perUnit)} per sale`
          : "Needs review";

  return (
    <div className="glass p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-accent2">Pay setup review</div>
          <div className="mt-1 text-sm font-bold text-fg">Inputs behind EILA's money math</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${plan.confidence >= 0.75 ? "bg-good/12 text-good" : "bg-warn/12 text-warn"}`}>
          {Math.round(plan.confidence * 100)}% read
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <ReviewItem label="Pay basis" value={basis} tone={basis === "Needs review" ? "warn" : "ok"} />
        <ReviewItem label="Monthly goal" value={plan.goalUnits ? `${plan.goalUnits} ${unit.plural}` : "Not set yet"} tone={plan.goalUnits ? "ok" : "neutral"} />
        <ReviewItem label="VSC bonus" value={vsc ? vsc : usesProductMenu(industry) ? "No VSC bonus found" : "Not used for this plan"} tone={vsc ? "ok" : usesProductMenu(industry) ? "warn" : "neutral"} />
        {usesProductMenu(industry) && (
          <ReviewItem label="VSC product mapping" value={vscProduct ? `${vscProduct.label} drives VSC %` : "Needs the built-in VSC product row"} tone={vscProduct ? "ok" : "warn"} />
        )}
        <ReviewItem label="Draw" value={plan.draw ? `${money(plan.draw.amount)} ${plan.draw.period}${plan.drawCarriedIn ? ` + ${money(plan.drawCarriedIn)} carried` : ""}` : "No draw saved"} tone={plan.draw ? "ok" : "neutral"} />
        <ReviewItem label="Tax" value={plan.taxRate ? `${plan.taxRate}% take-home estimate` : "Not set yet"} tone={plan.taxRate ? "ok" : "neutral"} />
        <ReviewItem label="Paydays" value={paydays} tone={paydays === "Not set yet" ? "warn" : "ok"} />
        <ReviewItem label="Plan rules" value={ruleCount(plan)} tone={plan.unsupported.length ? "warn" : "ok"} />
      </div>

      {plan.unsupported.length > 0 && (
        <div className="mt-3 rounded-xl bg-warn/10 p-3 text-xs leading-relaxed text-warn">
          <span className="font-bold">Review needed:</span> {plan.unsupported.join("; ")}
        </div>
      )}
    </div>
  );
}

function ReviewItem({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "neutral" }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : CircleDashed;
  return (
    <div className="rounded-xl bg-fg/[0.035] p-3">
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${tone === "ok" ? "text-good" : tone === "warn" ? "text-warn" : "text-fg/50"}`}>
        <Icon size={12} /> {label}
      </div>
      <div className="mt-1 text-sm font-semibold leading-snug text-fg/85">{value}</div>
    </div>
  );
}

function findVscRule(plan: PayPlan): string | null {
  const bonus = plan.bonuses.find((b) => conditions(b.condition).some((c) => c.metric === "vscPenetration"));
  if (!bonus) return null;
  const condition = conditions(bonus.condition).find((c) => c.metric === "vscPenetration");
  if (!condition) return null;
  const add = bonus.effect.kind === "addRatePct" ? ` adds ${bonus.effect.amount}%` : "";
  return `VSC ${opText(condition.op)} ${condition.value}%${add}`;
}

function conditions(condition: Condition | Condition[]): Condition[] {
  return Array.isArray(condition) ? condition : [condition];
}

function opText(op: Op): string {
  if (op === "gt") return "over";
  if (op === "gte") return "at least";
  if (op === "lt") return "under";
  if (op === "lte") return "at most";
  return "=";
}

function formatPaydays(cfg?: MoneyConfig): string {
  const days = cfg?.paydays?.length ? cfg.paydays : cfg?.payday ? [cfg.payday] : [];
  if (!days.length) return "Not set yet";
  const nets = cfg?.checkNets ?? [];
  return days.map((day, i) => {
    const net = nets.length === 1 ? nets[0] : nets[i];
    return net ? `${ordinal(day)} (${money(net)} net)` : ordinal(day);
  }).join(", ");
}

function ruleCount(plan: PayPlan): string {
  const count = plan.bonuses.length + plan.tiers.length + plan.penalties.length + plan.deductions.length;
  if (plan.unsupported.length) return `${count} modeled, ${plan.unsupported.length} flagged`;
  return count ? `${count} rules modeled` : "No extra rules";
}

function basisLabel(basis: "front" | "back" | "total"): string {
  if (basis === "back") return "F&I gross";
  if (basis === "front") return "Front gross";
  return "Total gross";
}

function pct(n: number): string {
  return n ? `${n}%` : "0%";
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const suffix = mod10 === 1 && mod100 !== 11 ? "st" : mod10 === 2 && mod100 !== 12 ? "nd" : mod10 === 3 && mod100 !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}
