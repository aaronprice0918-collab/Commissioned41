"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BarChart3, CheckCircle2, CircleAlert, CircleDashed, FileText, Layers, ReceiptText, Sparkles, Target, TrendingUp, Trophy, Users } from "lucide-react";
import { useMission } from "@/lib/store";
import { useAskIla } from "./AppShell";
import { DailyTracker } from "./DailyTracker";
import { ProgressBoard } from "./ProgressBoard";
import { fniPayDeals, forecast, isProductOnly, localMonthKey, money, perfFromDeals } from "@/lib/engine";
import { Deal, DealStatus, INDUSTRY_UNIT, STATUS_LABEL } from "@/lib/types";
import { INDUSTRY_DEAL, localizeUnits, statusLabel } from "@/lib/industry";
import { dealMoneyOf, moneyBasis, penetration, productDefs, round1, salespersonReport, spiffTotal, usesProductMenu, vscIdOf, vscPenetrationPct } from "@/lib/fni";
import { fniPayPicture, isFinanceGridPlan, type FniPayPicture } from "@/lib/fniPay";
import type { BonusRule, Condition, Metric, PayPlan, PayResult, PerfInput } from "@/lib/payplan/types";

// The Performance dashboard — a full analytics page in the spirit of a
// Monday-style widget board (number cards, battery, trend, funnel, bars,
// donut, table) rendered in EILA's own glass language. Every chart is
// hand-rolled SVG so it inherits the design tokens and animates in;
// prefers-reduced-motion is honored by the global .rise override and the
// mount-transition pattern (widths/offsets simply land at their target).

const FUNNEL_STAGES: DealStatus[] = ["prospect", "appointment", "working", "pending", "finance", "delivered"];
const STAGE_COLOR: Record<DealStatus, string> = {
  prospect: "rgb(var(--fg) / 0.30)",
  appointment: "rgb(var(--accent-2) / 0.55)",
  working: "rgb(var(--accent-2) / 0.85)",
  pending: "rgb(var(--accent) / 0.9)",
  finance: "rgb(var(--accent))",
  delivered: "rgb(var(--good))",
  dead: "rgb(var(--fg) / 0.15)",
};
const DONUT_COLORS = ["rgb(var(--accent))", "rgb(var(--good))", "rgb(var(--accent-2))", "rgb(var(--warn))", "rgb(var(--fg) / 0.35)"];
// Funnel bar count label color, per stage — a single fixed color fails WCAG AA
// (4.5:1) against half these bars: the paler stages (prospect/dead/appointment)
// need dark ink, the saturated ones (pending/finance/delivered) need white; a
// flat #06101f (audit finding, July 5) read fine on light stages but as low as
// 3.34:1 on "delivered". "working" is right at the edge (4.56 dark / 4.18
// white) so dark wins there too — computed against the actual composited bar
// colors above, not just the raw token.
const STAGE_TEXT: Record<DealStatus, string> = {
  prospect: "rgb(var(--fg))",
  appointment: "rgb(var(--fg))",
  working: "rgb(var(--fg))",
  pending: "#ffffff",
  finance: "#ffffff",
  delivered: "#ffffff",
  dead: "rgb(var(--fg))",
};

export function Performance() {
  const { data } = useMission();
  const askIla = useAskIla();
  const profile = data.profile!;
  const plan = profile.plan;
  const industry = profile.industry;
  const spec = INDUSTRY_DEAL[industry];
  const unit = INDUSTRY_UNIT[industry];

  // One mount tick flips every chart from zero to its target so widths,
  // heights and dash offsets glide in on CSS transitions.
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(t);
  }, []);

  const now = new Date();
  const f = useMemo(() => forecast(plan, data.deals, now, profile.daysOff ?? [], vscIdOf(profile)), [plan, data.deals, profile.daysOff]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthName = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Money is counted on whatever channel the USER'S plan pays on — back
  // gross for an F&I grid, front for a front-paid rep, the whole deal
  // otherwise. Read from the plan, never assumed from the role.
  const basis = moneyBasis(profile);
  const dealMoney = useMemo(() => dealMoneyOf(basis), [basis]);

  const live = useMemo(() => {
    const gross = f.pipeline.reduce((s, d) => s + dealMoney(d), 0);
    return { gross, count: f.pipeline.length };
  }, [f.pipeline, dealMoney]);

  const goalPct = plan.goalUnits ? Math.min(100, (f.totals.units / plan.goalUnits) * 100) : 0;

  // Cumulative closed gross by day-of-month (the trend widget).
  const trend = useMemo(() => {
    const today = now.getDate();
    const byDay = new Array(today + 1).fill(0);
    for (const d of f.counted) {
      const day = Math.min(today, Math.max(1, new Date(d.date).getDate()));
      byDay[day] += dealMoney(d);
    }
    let run = 0;
    return byDay.slice(1).map((v) => (run += v));
  }, [f.counted, dealMoney]); // eslint-disable-line react-hooks/exhaustive-deps

  // Volume buckets: months when there's history, weeks of this month when not.
  const volume = useMemo(() => {
    // Retail cars only (New/Used/CPO) — DNQ and product-only aren't delivered units.
    const delivered = data.deals.filter((d) => d.status === "delivered" && !d.noQualify && !isProductOnly(d));
    const monthsSeen = new Set(delivered.map((d) => localMonthKey(d.date))); // LOCAL month, same rule as the dashboard
    if (monthsSeen.size >= 2) {
      const buckets: { label: string; value: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = localMonthKey(m);
        buckets.push({
          label: m.toLocaleDateString(undefined, { month: "short" }),
          value: delivered.filter((d) => localMonthKey(d.date) === key).length,
        });
      }
      return { title: `${cap(unit.plural)} by month`, buckets };
    }
    const buckets = [1, 2, 3, 4, 5].map((w) => ({
      label: `W${w}`,
      value: f.counted.filter((d) => !isProductOnly(d) && Math.ceil(new Date(d.date).getDate() / 7) === w).length,
    }));
    while (buckets.length > 4 && buckets[buckets.length - 1].value === 0) buckets.pop();
    return { title: `${cap(unit.plural)} by week`, buckets };
  }, [data.deals, f.counted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Category mix of everything live or delivered this month.
  const mix = useMemo(() => {
    if (!spec.categories) return null;
    const monthDeals = [...f.counted, ...f.pipeline];
    const slices = spec.categories
      .map((c) => ({ label: c.label, value: monthDeals.filter((d) => d.category === c.id).length }))
      .filter((s) => s.value > 0);
    const total = slices.reduce((s, x) => s + x.value, 0);
    return total ? { slices, total } : null;
  }, [spec.categories, f.counted, f.pipeline]);

  const topDeals = useMemo(
    () => [...f.pipeline].sort((a, b) => dealMoney(b) - dealMoney(a)).slice(0, 5),
    [f.pipeline, dealMoney],
  );

  // F&I depth (product-menu industries): penetration, spiffs, salespeople.
  const fni = usesProductMenu(industry);
  const defs = useMemo(() => productDefs(profile), [profile]);
  const pen = useMemo(() => (fni ? penetration(f.counted, defs).filter((p) => p.count > 0) : []), [fni, f.counted, defs]);
  const spiffs = useMemo(() => (fni ? spiffTotal(f.counted, defs) : 0), [fni, f.counted, defs]);
  // Salesperson report keeps DNQ units (the salesperson gets the unit even on a
  // house deal), so it reads the RAW delivered set, not the retail-touch `counted`.
  const reps = useMemo(() => (fni ? salespersonReport(f.delivered, defs).filter((r) => r.retail > 0).slice(0, 6) : []), [fni, f.delivered, defs]);

  // THE LOGG pay picture — the full finance-manager check (grid commission +
  // draw + spiffs) for THIS month's counted deals, computed by the same audited
  // engine that reproduces THE LOGG to the dollar. Only F&I back-end grid plans.
  const payPic = useMemo(() => fniPayPicture(profile, f.counted), [profile, f.counted]);
  // Resolve VSC against the user's own menu — a custom menu's VSC id isn't the
  // literal "vsc", which read a false 0% (July 23).
  const vscPct = useMemo(() => vscPenetrationPct(f.counted, defs), [f.counted, defs]);

  // Funnel counts retail cars — product-only deals lift gross, not the delivered
  // vehicle bar, so the funnel's "Delivered" matches the headline unit count.
  const funnelDeals = f.counted.filter((d) => !isProductOnly(d)).concat(f.pipeline);
  const funnelMax = Math.max(1, ...FUNNEL_STAGES.map((s) => funnelDeals.filter((d) => d.status === s).length));
  // Pay-plan status (PVR/PPU/bonus checks) must read the SAME retail basis the
  // grid pays on — else it shows PVR $1,580 (all cars) next to a base rate on
  // $1,733 (retail). fniPayDeals drops no-qualify for an F&I grid.
  const currentPerf = useMemo(() => perfFromDeals(fniPayDeals(plan, f.counted), vscIdOf(profile)), [plan, f.counted, profile]);
  const statusRows = useMemo(() => payStatusRows(plan, f.current, currentPerf), [plan, f.current, currentPerf]);
  const bestMove = f.current.nextTiers[0];

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between px-1">
        <h1 className="font-display text-2xl font-black">Performance</h1>
        <span className="pb-0.5 text-xs font-semibold text-fg/65">{monthName}</span>
      </div>

      {/* Your daily sales tracker — the individual version of THE LOGG's daily
          tracker (Total · % Goal · Still Need · Pace over a month calendar). The
          10-second answer to "where am I this month" before any chart. */}
      <DailyTracker />

      {/* Quality board — PVR/PPU/VSC vs their plan targets, labeled rows. */}
      <ProgressBoard />

      {/* One tap → the printable month-end report (THE LOGG's closing ritual) */}
      <Link href="/report" className="glass rise flex items-center justify-between p-4 transition active:scale-[0.99]">
        <span className="flex items-center gap-2.5 text-sm font-bold"><FileText size={16} className="text-accent2" /> Month-end report</span>
        <span className="text-xs text-fg/65">print / save PDF →</span>
      </Link>

      {/* Number widgets */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* On a draw plan these two are EARNED COMMISSION, not the cash check —
            the draw is an advance against them. Say so right on the card
            (Aaron, July 8: "if I'm still in the draw shouldn't banked be 0?"
            — no: earned commission is what's chipping away at the draw; hiding it would
            hide the climb out). Same language as the Home climb. */}
        <Kpi delay={0} icon={<Sparkles size={13} />} tone="text-accent2" label="Pace forecast" value={f.pacePay} money on={on}
          hint={plan.draw ? `gross, if this pace holds · after your ${money(plan.draw.amount)} ${plan.draw.period} draw, the check beyond advances ≈ ${money(f.pace.aboveDraw)}` : "gross, if this pace holds through month-end"}
          onExplain={() => askIla("Explain my pace forecast on the Performance page — how you projected month-end pay from closed deals so far, and how my draw affects what actually hits my bank. Plain words.")} />
        <Kpi delay={60} icon={<Trophy size={13} />} tone="text-good" label="Earned commission" value={f.current.grossPay} money on={on}
          hint={plan.draw ? (f.current.drawOwed > 0 ? `earned against your ${plan.drawCarriedIn ? "draw + carried balance" : "draw"} · ${money(f.current.drawOwed)} left to clear` : "advances cleared — this builds your real check") : undefined}
          onExplain={() => askIla("Explain my earned commission number — which closed deals are in it, what each one paid, and how it offsets my draw.")} />
        <Kpi delay={120} icon={<Target size={13} />} tone="text-fg/50" label={cap(unit.plural)} value={f.totals.units} suffix={plan.goalUnits ? ` / ${plan.goalUnits}` : ""} hint={plan.goalUnits ? "closed / goal" : "closed"} on={on} onExplain={() => askIla(`Which ${unit.plural} count as closed this month? List them and flag anything that looks miscounted.`)} />
        <Kpi delay={180} icon={<Layers size={13} />} tone="text-accent2" label="Live pipeline" value={live.gross} money hint={`${live.count} ${live.count === 1 ? unit.singular : unit.plural} working`} on={on} onExplain={() => askIla("Explain my live-pipeline gross — which working deals are in it and on what money channel.")} />
      </div>

      {/* THE LOGG pay picture — the finance manager's whole check in one card,
          reproducing their own pay tracker to the dollar (grid + draw + spiffs) */}
      {payPic && (
        <LoggPayCard pic={payPic} vscPct={vscPct} monthName={monthName} projected={f.pacePay}
          onAsk={() => askIla("Walk me through my pay card on the Performance page like my LOGG: F&I gross, PVR, PPU, VSC %, base grid and bonuses, gross commission, my draw, and every spiff. Use the exact numbers shown.")} />
      )}

      <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
        <PayPlanStatus rows={statusRows} bestMove={bestMove} unit={unit} onAsk={() => askIla("Review my pay plan status on the Performance page. Tell me which bonuses are already qualified, which are not, and the best opportunity to improve my check from here.")} />
        <PayReceipt result={f.pace} plan={plan} onAsk={() => askIla("Show me the receipt for my projected pay. Use the exact numbers from the Performance page: current gross, PVR, product pace, base rate, bonuses, draw impact, and final projected real check.")} />
      </div>

      {/* Goal battery */}
      {plan.goalUnits > 0 && (
        <div className="glass rise p-4" style={{ animationDelay: "90ms" }}>
          <WidgetTitle icon={<Target size={13} />}>Monthly goal</WidgetTitle>
          <div className="mt-3 flex h-7 gap-1 overflow-hidden rounded-lg">
            {Array.from({ length: Math.min(plan.goalUnits, 20) }, (_, i) => {
              const filled = i < Math.round((goalPct / 100) * Math.min(plan.goalUnits, 20));
              return (
                <span key={i} className="h-full flex-1 rounded-[3px] transition-all duration-700"
                  style={{ background: filled && on ? (goalPct >= 100 ? "rgb(var(--good))" : "rgb(var(--accent))") : "rgb(var(--fg) / 0.08)", transitionDelay: `${i * 45}ms` }} />
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-xs text-fg/50">
            <span>
              <b className="tabnum text-fg">{f.totals.units}</b> of {plan.goalUnits} {unit.plural}
            </span>
            <span className={goalPct >= 100 ? "font-bold text-good" : "tabnum"}>
              {goalPct >= 100 ? "Goal hit 🎉" : `${Math.round(goalPct)}%`}
            </span>
          </div>
        </div>
      )}

      {/* Closed-gross trend */}
      <div className="glass rise p-4" style={{ animationDelay: "150ms" }}>
        <WidgetTitle icon={<TrendingUp size={13} />}>Closed gross this month</WidgetTitle>
        <Trend points={trend} on={on} />
        <div className="mt-1 flex justify-between text-[11px] text-fg/60 tabnum"><span>Day 1</span><span>Today · {money(trend[trend.length - 1] ?? 0)} gross</span></div>
      </div>

      {/* Funnel */}
      <div className="glass rise p-4" style={{ animationDelay: "210ms" }}>
        <WidgetTitle icon={<BarChart3 size={13} />}>Pipeline funnel</WidgetTitle>
        <div className="mt-3 space-y-2">
          {FUNNEL_STAGES.map((s) => {
            const stage = funnelDeals.filter((d) => d.status === s);
            const gross = stage.reduce((t, d) => t + dealMoney(d), 0);
            return (
              <div key={s} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[11px] font-semibold text-fg/55">{statusLabel(industry, s, STATUS_LABEL[s])}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-md bg-fg/5">
                  <div className="flex h-full items-center rounded-md pl-2 text-[11px] font-bold transition-[width] duration-700"
                    style={{ width: on ? `${Math.max(stage.length ? 9 : 0, (stage.length / funnelMax) * 100)}%` : "0%", background: STAGE_COLOR[s], color: STAGE_TEXT[s] }}>
                    {stage.length > 0 && stage.length}
                  </div>
                </div>
                <span className="w-16 shrink-0 text-right text-[11px] text-fg/65 tabnum">{gross ? money(gross) : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Volume bars */}
      <div className="glass rise p-4" style={{ animationDelay: "270ms" }}>
        <WidgetTitle icon={<BarChart3 size={13} />}>{volume.title}</WidgetTitle>
        <Bars buckets={volume.buckets} on={on} />
      </div>

      {/* Category mix */}
      {mix && (
        <div className="glass rise p-4" style={{ animationDelay: "330ms" }}>
          <WidgetTitle icon={<Layers size={13} />}>Mix this month</WidgetTitle>
          <div className="mt-3 flex items-center gap-5">
            <Donut slices={mix.slices} total={mix.total} on={on} />
            <div className="min-w-0 flex-1 space-y-1.5">
              {mix.slices.map((s, i) => (
                <div key={s.label} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="min-w-0 flex-1 truncate text-fg/70">{s.label}</span>
                  <span className="text-fg/70 tabnum">{s.value} · {Math.round((s.value / mix.total) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Product penetration (F&I) */}
      {fni && f.totals.units > 0 && (
        <div className="glass rise p-4" style={{ animationDelay: "300ms" }}>
          <WidgetTitle icon={<Layers size={13} />}>Product penetration{spiffs > 0 ? ` · ${money(spiffs)} spiffs earned` : ""}</WidgetTitle>
          <div className="mt-3 space-y-2">
            {pen.map(({ def, count, pct }) => (
              <div key={def.id} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[11px] font-semibold text-fg/55">{def.label}</span>
                <div className="h-5 flex-1 overflow-hidden rounded-md bg-fg/5">
                  <div className="h-full rounded-md bg-gradient-to-r from-accent/50 to-accent transition-[width] duration-700"
                    style={{ width: on ? `${Math.max(pct > 0 ? 6 : 0, pct * 100)}%` : "0%" }} />
                </div>
                <span className="w-16 shrink-0 text-right text-[11px] text-fg/70 tabnum">{Math.round(pct * 100)}% · {round1(count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Salesperson product report (F&I) */}
      {fni && reps.length > 0 && (
        <div className="glass rise p-4" style={{ animationDelay: "350ms" }}>
          <WidgetTitle icon={<Users size={13} />}>Salespeople · who feeds F&amp;I</WidgetTitle>
          <div className="mt-2 divide-y divide-fg/5">
            {reps.map((r) => (
              <div key={r.name} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.name}</div>
                  <div className="text-[11px] text-fg/65 tabnum">{round1(r.retail)} units · {r.perUnit.toFixed(1)} products/unit</div>
                </div>
                <span className="shrink-0 text-sm font-bold tabnum text-good">{money(r.fniGross)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Biggest live deals */}
      {topDeals.length > 0 && (
        <div className="glass rise p-4" style={{ animationDelay: "390ms" }}>
          <WidgetTitle icon={<Trophy size={13} />}>Biggest live {unit.plural}</WidgetTitle>
          <div className="mt-2 divide-y divide-fg/5">
            {topDeals.map((d) => (
              <Link href={`/deal/${d.id}`} key={d.id} className="flex items-center gap-3 py-2.5 active:opacity-70">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{d.customer}</div>
                  <div className="truncate text-[11px] text-fg/65">{d.item}</div>
                </div>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: "rgb(var(--fg) / 0.06)", color: STAGE_COLOR[d.status] }}>
                  {statusLabel(industry, d.status, STATUS_LABEL[d.status])}
                </span>
                <span className="w-20 shrink-0 text-right text-sm font-bold tabnum">{money(dealMoney(d))}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65">
      {icon} {children}
    </div>
  );
}

type StatusTone = "ok" | "warn" | "neutral";
interface PayStatusRow { label: string; value: string; detail: string; tone: StatusTone }

function PayPlanStatus({ rows, bestMove, unit, onAsk }: { rows: PayStatusRow[]; bestMove?: { hint: string; addPay: number; addRatePct?: number }; unit: typeof INDUSTRY_UNIT[keyof typeof INDUSTRY_UNIT]; onAsk: () => void }) {
  return (
    <button className="glass rise block w-full p-4 text-left active:scale-[0.99]" style={{ animationDelay: "45ms" }} onClick={onAsk}>
      <div className="flex items-start justify-between gap-3">
        <WidgetTitle icon={<CheckCircle2 size={13} />}>Pay plan status</WidgetTitle>
        <span className="rounded-full bg-fg/6 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fg/55">live</span>
      </div>
      <div className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <div key={`${r.label}-${r.value}`} className="flex items-start gap-2.5">
            <StatusIcon tone={r.tone} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-bold text-fg/85">{r.label}</span>
                <span className={`shrink-0 text-xs font-black tabnum ${r.tone === "ok" ? "text-good" : r.tone === "warn" ? "text-warn" : "text-fg/55"}`}>{r.value}</span>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-fg/55">{r.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {bestMove && (
        <div className="mt-3 border-t border-fg/5 pt-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent2"><ArrowUpRight size={13} /> Next best move</div>
          <div className="mt-1 flex items-start justify-between gap-3">
            <div className="min-w-0 text-[13px] font-semibold leading-snug text-fg/80">{localizeUnits(bestMove.hint, unit)}</div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-black tabnum text-good">+{money(bestMove.addPay)}</div>
              {bestMove.addRatePct ? <div className="text-[10px] text-fg/55">+{bestMove.addRatePct}%</div> : null}
            </div>
          </div>
        </div>
      )}
    </button>
  );
}

function PayReceipt({ result, plan, onAsk }: { result: PayResult; plan: PayPlan; onAsk: () => void }) {
  const realCheck = plan.draw ? result.aboveDraw : result.grossPay;
  return (
    <button className="glass rise block w-full p-4 text-left active:scale-[0.99]" style={{ animationDelay: "75ms" }} onClick={onAsk}>
      <div className="flex items-start justify-between gap-4">
        <WidgetTitle icon={<ReceiptText size={13} />}>Why this number?</WidgetTitle>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/45">{plan.draw ? "projected real check" : "projected pay"}</div>
          <div className="text-xl font-black tabnum text-fg">{money(realCheck)}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ReceiptLine label="Projected commission" value={money(result.grossPay)} />
        {result.rateBreakdown ? <ReceiptLine label="Base grid" value={`${fmtPct(result.rateBreakdown.base)}%`} detail={`PVR ${money(result.rateBreakdown.pvr)} · PPU ${result.rateBreakdown.ppt.toFixed(1)}`} /> : null}
        {result.rateBreakdown?.bonusRate ? <ReceiptLine label="Rate bonuses" value={`+${fmtPct(result.rateBreakdown.bonusRate)}%`} /> : null}
        {plan.draw ? <ReceiptLine label="Draw impact" value={result.aboveDraw > 0 ? money(result.aboveDraw) : `${money(result.drawOwed)} left`} detail={result.aboveDraw > 0 ? "beyond advances" : "to clear before a check builds"} /> : null}
      </div>

      <div className="mt-3 divide-y divide-fg/5 border-t border-fg/5 pt-1">
        {result.steps.slice(0, 6).map((s, i) => (
          <div key={`${s.label}-${i}`} className="flex items-center justify-between gap-3 py-2">
            <span className="text-xs font-semibold text-fg/60">{s.label}</span>
            <span className="text-right text-[11px] leading-snug text-fg/65 tabnum">{s.detail}</span>
          </div>
        ))}
      </div>
    </button>
  );
}

function ReceiptLine({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg bg-fg/[0.035] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/45">{label}</div>
      <div className="mt-0.5 text-sm font-black tabnum text-fg/85">{value}</div>
      {detail ? <div className="mt-0.5 text-[11px] text-fg/50">{detail}</div> : null}
    </div>
  );
}

// THE LOGG pay card — the finance manager's whole check in one panel, laid out
// like their own pay tracker: commission-before-draw + grid % up top, the four
// numbers that set the grid (F&I gross · PVR · PPU · VSC%), the grid math, the
// draw, every spiff, and the month's total. Fed by fniPayPicture, the same
// audited engine that reproduces THE LOGG to the dollar.
function LoggPayCard({ pic, vscPct, monthName, projected, onAsk }: {
  pic: FniPayPicture; vscPct: number; monthName: string; projected: number; onAsk: () => void;
}) {
  const rb = pic.pay.rateBreakdown;
  const base = rb?.base ?? pic.pay.rate;
  const bonus = rb?.bonusRate ?? 0;
  const total = base + bonus;
  const fniGross = pic.pvr * pic.units;
  const above = pic.pay.aboveDraw;
  const spiffLines = pic.spiffs.lines.filter((l) => l.amount > 0);
  const g = pic.spiffPlan.gatedQualifier;
  return (
    <button onClick={onAsk} className="glass rise block w-full p-4 text-left active:scale-[0.99]">
      <div className="flex items-center justify-between">
        <WidgetTitle icon={<ReceiptText size={13} />}>Your pay · {monthName}</WidgetTitle>
        <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent2">your LOGG</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/45">Commission so far · before draw</div>
          <div className="text-[28px] font-black leading-none tabnum">{money(pic.pay.grossCommission)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/45">Pay grid</div>
          <div className="text-2xl font-black leading-none tabnum text-accent2">{fmtPct(total)}%</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <LoggStat label="F&amp;I gross" value={money(fniGross)} />
        <LoggStat label="PVR" value={money(pic.pvr)} />
        <LoggStat label="PPU" value={pic.ppu.toFixed(2)} />
        <LoggStat label="VSC" value={`${Math.round(vscPct)}%`} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg/60">
        <span>Base {fmtPct(base)}%</span>
        {bonus > 0 && <span className="font-semibold text-good">+ bonus {fmtPct(bonus)}%</span>}
        <span className="text-fg/35">→</span>
        <span className="font-bold text-fg/80">{fmtPct(total)}% of {money(fniGross)}</span>
      </div>

      <div className="mt-3 space-y-2 border-t border-fg/8 pt-3 text-[13px]">
        {pic.pay.draw > 0 && (
          <div className="flex items-baseline justify-between">
            <span className="text-fg/70">Draw · {money(pic.pay.draw)} advanced</span>
            <span className="tabnum text-fg/60">{above > 0 ? `${money(above)} beyond it` : "still inside the draw"}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-fg/80">Spiffs (paid on top)</span>
          <span className="tabnum font-bold text-good">{money(pic.spiffs.total)}</span>
        </div>
        {spiffLines.map((l) => (
          <div key={l.id} className="flex items-baseline justify-between pl-3 text-[11.5px] text-fg/55">
            <span>{l.label}</span>
            <span className="tabnum">{money(l.amount)}</span>
          </div>
        ))}
        {!pic.spiffs.gatedQualified && (
          <div className="pl-3 text-[11px] text-fg/40">TWS package locked — needs PPU ≥ {g.ppu} and PVR ≥ {money(g.pvr)}</div>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between border-t border-fg/10 pt-2.5">
        <span className="text-sm font-black">This month · pay + spiffs</span>
        <span className="text-lg font-black tabnum text-good">{money(pic.totalEarned)}</span>
      </div>
      <div className="mt-1 text-[10.5px] leading-snug text-fg/40">On pace for about {money(projected)} in commission by month-end if this keeps up · tap for EILA to walk it through.</div>
    </button>
  );
}

function LoggStat({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="rounded-lg bg-fg/[0.04] px-1 py-1.5 text-center">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-fg/45">{label}</div>
      <div className="mt-0.5 text-[13px] font-black tabnum text-fg/85">{value}</div>
    </div>
  );
}

function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === "ok") return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" />;
  if (tone === "warn") return <CircleAlert size={16} className="mt-0.5 shrink-0 text-warn" />;
  return <CircleDashed size={16} className="mt-0.5 shrink-0 text-fg/35" />;
}

function payStatusRows(plan: PayPlan, result: PayResult, perf: PerfInput): PayStatusRow[] {
  const rows: PayStatusRow[] = [];
  if (result.rateBreakdown) {
    rows.push({
      label: "Base grid rate",
      value: `${fmtPct(result.rateBreakdown.base)}%`,
      detail: `PVR ${money(result.rateBreakdown.pvr)} · PPU ${result.rateBreakdown.ppt.toFixed(1)}`,
      tone: "neutral",
    });
  }

  for (const bonus of plan.bonuses.filter((b) => b.effect.kind === "addRatePct")) {
    rows.push(rateBonusRow(bonus, plan, perf));
  }

  if (plan.draw) {
    const owed = result.drawOwed;
    rows.push({
      label: "Draw position",
      value: result.aboveDraw > 0 ? money(result.aboveDraw) : `${money(owed)} left`,
      detail: result.aboveDraw > 0
        ? "Advances are cleared; this is real check building."
        : `${money(result.grossPay)} earned against ${money((plan.draw?.amount ?? 0) + (plan.drawCarriedIn ?? 0))} advanced.`,
      tone: result.aboveDraw > 0 ? "ok" : result.grossPay > 0 ? "neutral" : "warn",
    });
  }

  if (!rows.length) {
    rows.push({
      label: "Commission status",
      value: money(result.grossPay),
      detail: `${Math.round(result.confidence * 100)}% confidence from the saved pay plan.`,
      tone: "neutral",
    });
  }
  return rows.slice(0, 5);
}

function rateBonusRow(bonus: BonusRule, plan: PayPlan, perf: PerfInput): PayStatusRow {
  const checks = condList(bonus.condition).map((condition) => ({ condition, ...conditionSnapshot(condition, plan, perf) }));
  const missing = checks.find((c) => c.actual === undefined);
  const unmet = checks.find((c) => c.actual !== undefined && !c.met);
  const qualified = !missing && !unmet;
  const amount = bonus.effect.kind === "addRatePct" ? bonus.effect.amount : 0;

  if (qualified) {
    return {
      label: bonus.label,
      value: `+${fmtPct(amount)}%`,
      detail: checks.map((c) => `${metricLabel(c.condition.metric)} ${formatMetric(c.condition.metric, c.actual ?? 0)} clears ${targetPhrase(c.condition)}`).join(" · "),
      tone: "ok",
    };
  }
  if (missing) {
    return {
      label: bonus.label,
      value: "needs data",
      detail: `Add ${metricLabel(missing.condition.metric)} so EILA can confirm this bonus.`,
      tone: "neutral",
    };
  }
  return {
    label: bonus.label,
    value: "not yet",
    detail: gapPhrase(unmet!.condition, unmet!.actual ?? 0),
    tone: "warn",
  };
}

function conditionSnapshot(condition: Condition, plan: PayPlan, perf: PerfInput): { actual?: number; met: boolean } {
  const actual = metricActual(condition.metric, plan, perf);
  return { actual, met: actual !== undefined && compare(condition.op, actual, condition.value) };
}

function metricActual(metric: Metric, plan: PayPlan, perf: PerfInput): number | undefined {
  const units = perf.units || 0;
  const front = perf.frontGross || 0;
  const back = perf.backGross || 0;
  const basis = plan.grid?.basis ?? plan.base.basis ?? "total";
  const basisGross = basis === "front" ? front : basis === "back" ? back : front + back;
  switch (metric) {
    case "pvr": return units ? basisGross / units : 0;
    case "ppt": return units ? (perf.products || 0) / units : 0;
    case "units": return units;
    case "frontGross": return front;
    case "backGross": return back;
    case "totalGross": return front + back;
    case "products": return perf.products || 0;
    case "vscPenetration": return perf.vscPenetration;
    case "menuUsage": return perf.menuUsage;
    case "csiBelowRegion": return perf.csiBelowRegion === undefined ? undefined : perf.csiBelowRegion ? 1 : 0;
    case "csiConsecutiveBelow": return perf.csiConsecutiveBelow;
    case "contractsNotCashed": return perf.contractsNotCashed;
    case "chargebacks": return perf.chargebacks;
    case "backPvr": return units ? back / units : 0;
    case "fastStartUnits": return perf.fastStartUnits;
  }
}

function condList(condition: Condition | Condition[]): Condition[] {
  return Array.isArray(condition) ? condition : [condition];
}

function compare(op: Condition["op"], actual: number, target: number): boolean {
  if (op === "gt") return actual > target;
  if (op === "gte") return actual >= target;
  if (op === "lt") return actual < target;
  if (op === "lte") return actual <= target;
  return actual === target;
}

function gapPhrase(condition: Condition, actual: number): string {
  const gap = Math.max(0, condition.value - actual);
  if (condition.metric === "pvr" || condition.metric === "backPvr") return `Need ${money(gap)} more ${metricLabel(condition.metric)} · now ${formatMetric(condition.metric, actual)}`;
  if (condition.metric === "vscPenetration" || condition.metric === "menuUsage") return `Need ${fmtPct(gap)} more points · now ${formatMetric(condition.metric, actual)}`;
  if (condition.metric === "units" || condition.metric === "fastStartUnits" || condition.metric === "products") return `Need ${Math.ceil(gap)} more · now ${formatMetric(condition.metric, actual)}`;
  return `Need ${targetPhrase(condition)} · now ${formatMetric(condition.metric, actual)}`;
}

function metricLabel(metric: Metric): string {
  return ({
    pvr: "PVR",
    ppt: "PPU",
    units: "units",
    frontGross: "front gross",
    backGross: "back gross",
    totalGross: "total gross",
    products: "products",
    vscPenetration: "VSC",
    menuUsage: "menu usage",
    csiBelowRegion: "CSI",
    csiConsecutiveBelow: "CSI streak",
    contractsNotCashed: "contracts not cashed",
    chargebacks: "chargebacks",
    backPvr: "back-end PVR",
    fastStartUnits: "units by the 15th",
  } as Record<Metric, string>)[metric];
}

function formatMetric(metric: Metric, value: number): string {
  if (metric === "pvr" || metric === "backPvr" || metric.endsWith("Gross") || metric === "chargebacks") return money(value);
  if (metric === "vscPenetration" || metric === "menuUsage") return `${fmtPct(value)}%`;
  if (metric === "ppt") return value.toFixed(1);
  return `${Math.round(value)}`;
}

function targetPhrase(condition: Condition): string {
  const target = formatMetric(condition.metric, condition.value);
  if (condition.op === "gte") return `${target}+`;
  if (condition.op === "gt") return `over ${target}`;
  if (condition.op === "lte") return `${target} or less`;
  if (condition.op === "lt") return `under ${target}`;
  return target;
}

function fmtPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// A Monday-style number widget: big count-up figure, tiny label.
function Kpi({ label, value, money: isMoney, suffix = "", hint, icon, tone, delay, on, onExplain }: {
  label: string; value: number; money?: boolean; suffix?: string; hint?: string;
  icon: React.ReactNode; tone: string; delay: number; on: boolean; onExplain?: () => void;
}) {
  const shown = useCountUp(on ? value : 0);
  const body = (
    <>
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${tone}`}>{icon} {label}</div>
      <div className="mt-1 text-[26px] font-black leading-tight tabnum">
        {isMoney ? money(shown) : Math.round(shown)}{suffix}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-fg/65">{hint}</div>}
    </>
  );
  // Tap any KPI and EILA explains where the number comes from.
  if (onExplain) return <button className="glass rise block w-full p-4 text-left active:scale-[0.99]" style={{ animationDelay: `${delay}ms` }} onClick={onExplain}>{body}</button>;
  return (
    <div className="glass rise p-4" style={{ animationDelay: `${delay}ms` }}>{body}</div>
  );
}

function useCountUp(target: number, ms = 800) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(begin + (target - begin) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// Cumulative area chart. pathLength=1 normalizes the draw animation.
function Trend({ points, on }: { points: number[]; on: boolean }) {
  const W = 320, H = 96, PAD = 4;
  const max = Math.max(1, ...points);
  const n = Math.max(2, points.length);
  const xy = (i: number, v: number) => [PAD + (i / (n - 1)) * (W - PAD * 2), H - PAD - (v / max) * (H - PAD * 2)];
  const pts = (points.length === 1 ? [points[0], points[0]] : points).map((v, i) => xy(i, v));
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD} L${pts[0][0].toFixed(1)},${H - PAD} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trendFill)" opacity={on ? 1 : 0} style={{ transition: "opacity 0.9s 0.3s" }} />
      <path d={line} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
        pathLength={1} strokeDasharray={1} strokeDashoffset={on ? 0 : 1} style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.2,0.8,0.2,1)" }} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill="rgb(var(--accent))" opacity={on ? 1 : 0} style={{ transition: "opacity 0.4s 1s" }} />
    </svg>
  );
}

function Bars({ buckets, on }: { buckets: { label: string; value: number }[]; on: boolean }) {
  const max = Math.max(1, ...buckets.map((b) => b.value));
  return (
    <div className="mt-3 flex h-32 items-end gap-3 px-1">
      {buckets.map((b, i) => (
        <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          {b.value > 0 && <span className="text-[11px] font-bold text-fg/70 tabnum">{b.value}</span>}
          <div className="w-full rounded-t-lg bg-gradient-to-t from-accent/40 to-accent transition-[height] duration-700"
            style={{ height: on ? `${Math.max(3, (b.value / max) * 78)}%` : "3%", transitionDelay: `${i * 70}ms` }} />
          <span className="text-[10px] font-semibold text-fg/60">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

// Donut of category share — stacked circle strokes, pathLength=100.
function Donut({ slices, total, on }: { slices: { label: string; value: number }[]; total: number; on: boolean }) {
  let start = 0;
  return (
    <svg viewBox="0 0 84 84" className="h-28 w-28 shrink-0 -rotate-90" aria-hidden>
      <circle cx="42" cy="42" r="34" fill="none" stroke="rgb(var(--fg) / 0.06)" strokeWidth="11" />
      {slices.map((s, i) => {
        const frac = (s.value / total) * 100;
        const off = -start;
        start += frac;
        return (
          <circle key={s.label} cx="42" cy="42" r="34" fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
            strokeWidth="11" strokeLinecap="butt" pathLength={100}
            strokeDasharray={`${on ? frac : 0} ${on ? 100 - frac : 100}`} strokeDashoffset={off}
            style={{ transition: `stroke-dasharray 0.9s cubic-bezier(0.2,0.8,0.2,1) ${i * 120}ms` }} />
        );
      })}
    </svg>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
