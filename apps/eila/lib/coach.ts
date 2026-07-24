import { forecast, monthBounds, money } from "./engine";
import { Deal, Industry, INDUSTRY_UNIT } from "./types";
import { INDUSTRY_DEAL, localizeUnits } from "./industry";
import { PayPlan } from "./payplan/types";

export interface Insight {
  kind: "money" | "push" | "followup" | "win" | "pace";
  text: string;
}

// Rule-based coaching v1 — concrete, money-anchored, driven by the pay-plan
// engine, spoken in the rep's OWN industry language (closings, policies,
// installs — never a generic "unit" and never another industry's word).
export function coach(plan: PayPlan, deals: Deal[], industry: Industry = "automotive", now = new Date(), daysOff: number[] = [], vscId?: string): Insight[] {
  const out: Insight[] = [];
  const unit = INDUSTRY_UNIT[industry];
  const f = forecast(plan, deals, now, daysOff, vscId);
  const { daysRemaining } = monthBounds(now);

  // 1) best money opportunity (grid PPU/PVR, bonus, or volume tier)
  const top = f.current.nextTiers[0];
  if (top && top.addPay > 0) {
    out.push({ kind: "money", text: `${localizeUnits(top.hint, unit)} — about ${money(top.addPay)} more this month.` });
  }

  // 2) pace vs goal
  if (plan.goalUnits > 0) {
    if (f.paceUnits >= plan.goalUnits) {
      out.push({ kind: "win", text: `Pacing ${f.paceUnits} ${unit.plural} — ahead of your ${plan.goalUnits} goal. Nice work; protect the pace.` });
    } else {
      out.push({ kind: "pace", text: `Pacing ${f.paceUnits} vs your ${plan.goalUnits}-${unit.singular} goal. ${plan.goalUnits - f.paceUnits} more in ${daysRemaining} days gets you there.` });
    }
  }

  // 3) data that would sharpen the estimate (CSI, menu, VSC, etc.)
  if (f.current.missingData.length) {
    out.push({ kind: "push", text: `Add your ${f.current.missingData.slice(0, 3).join(", ")} to sharpen the forecast.` });
  }

  // 4) customer touches due today
  const due = deals.filter((d) => d.followUpAt && new Date(d.followUpAt) <= endOfDay(now) && d.status !== "delivered" && d.status !== "dead");
  if (due.length) {
    out.push({ kind: "followup", text: `${due.length} customer ${due.length === 1 ? "touch deserves" : "touches deserve"} attention today: ${due.slice(0, 5).map((d) => d.customer || "a customer").join(", ")}.` });
  }

  // 5) thin live-deal board
  if (f.pipeline.length < 3) {
    out.push({ kind: "push", text: `Live deal board is light (${f.pipeline.length} live). A few fresh prospects or appointments would give next week's check more room.` });
  }

  // 6) momentum
  if (f.totals.units > 0 && !out.some((i) => i.kind === "money")) {
    out.push({ kind: "win", text: `${f.totals.units} ${f.totals.units === 1 ? unit.singular : unit.plural} closed, ${money(f.current.grossPay)} earned. Likely month-end: ${money(f.likely.grossPay)}.` });
  }

  return out.slice(0, 5);
}

export function todaysMission(plan: PayPlan, deals: Deal[], industry: Industry = "automotive", now = new Date(), daysOff: number[] = [], vscId?: string): string {
  const unit = INDUSTRY_UNIT[industry];
  const spec = INDUSTRY_DEAL[industry];
  const f = forecast(plan, deals, now, daysOff, vscId);
  const top = f.current.nextTiers[0];
  if (top && top.addPay > 0) return `${localizeUnits(top.hint, unit)}. That's the best money opportunity today.`;
  if (plan.goalUnits > 0 && f.paceUnits < plan.goalUnits) return `You are still in range of ${plan.goalUnits} ${unit.plural}. Start with the warmest deal, then add one clean appointment.`;
  return `You are in a good lane. Review the live deals and set the next appointment${spec.addonsLabel ? ", then look for the right add-on fit" : ""}.`;
}

function endOfDay(now: Date) { const d = new Date(now); d.setHours(23, 59, 59, 999); return d; }
