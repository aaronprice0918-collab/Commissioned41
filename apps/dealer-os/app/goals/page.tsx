"use client";

import { useState } from "react";
import { Save, Target, RotateCcw } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { MissionRing } from "@/components/MissionRing";
import { CountUp } from "@/components/CountUp";
import { DealsModal } from "@/components/DealsModal";
import { NextActionBar } from "@/components/NextActionBar";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { defaultSalesGoals, useSalesGoals } from "@/components/GoalProvider";
import { usePayPlans, defaultSalesPlan } from "@/components/PayPlanProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { currency, currentMonthPace, displayFullPersonName, financeManagerBoard, goals as storeGoals, isCountableRetail, isHouseBucketName, number, paceValue, salespersonStats, unitsLabel } from "@/lib/data";
import { askIla } from "@/lib/askIla";

export default function GoalsPage() {
  const { deals } = useDeals();
  const { salespeople, financeManagers } = useTeamLists();
  const { goals, updateGoals, resetGoals } = useSalesGoals();
  const { payPlans, savePayPlan } = usePayPlans();
  const { settings } = useStoreSettings();
  const deliveredDeals = deals.filter(isCountableRetail);
  const fmBoard = financeManagerBoard(deals, financeManagers.filter((name) => !isHouseBucketName(name)));

  // Bonus eligibility per rep — defaults ON. A manager flips it off the rare
  // month a rep misses Certified / CSI / connected-service, forfeiting bonuses.
  function repPlan(name: string) {
    return payPlans.find((p) => p.personName === name && p.role === "Sales");
  }
  function bonusEligible(name: string) {
    return repPlan(name)?.sales?.bonusEligible !== false;
  }
  function toggleBonusEligible(name: string) {
    const existing = repPlan(name);
    const sales = { ...(existing?.sales ?? defaultSalesPlan), bonusEligible: !bonusEligible(name) };
    const base = existing ?? {
      personName: name,
      role: "Sales" as const,
      monthlyBase: 0,
      flatPerUnit: 0,
      frontGrossPct: 0,
      backGrossPct: 0,
      totalGrossPct: 0,
      productUnitBonus: 0,
      unitBonusThreshold: 0,
      unitBonusAmount: 0,
    };
    savePayPlan({ ...base, sales });
  }
  const teamDelivered = deliveredDeals.length;
  const teamGoal = goals.teamDeliveredUnits || storeGoals.deliveredUnits;
  const remaining = Math.max(teamGoal - teamDelivered, 0);
  const percent = teamGoal ? Math.round((teamDelivered / teamGoal) * 100) : 0;
  const [showDelivered, setShowDelivered] = useState(false);

  // EILA read: who has no target, who's behind pace, where the team sits.
  const pace = currentMonthPace(deals);
  const projectedTeam = paceValue(teamDelivered, pace);
  const noGoalReps = salespeople.filter((name) => !(goals.salespersonUnits[name] > 0));
  const behindReps = salespeople
    .filter((name) => {
      const g = goals.salespersonUnits[name] || 0;
      return g > 0 && paceValue(salespersonStats(deals, name).units, pace) < g;
    })
    .map(displayFullPersonName);
  const goalRead =
    `${noGoalReps.length ? `${noGoalReps.length} rep${noGoalReps.length === 1 ? " has" : "s have"} no goal set. ` : ""}` +
    `Team is pacing ${number(projectedTeam, 0)} toward ${teamGoal}` +
    `${projectedTeam >= teamGoal ? " — on target." : ` — ${number(teamGoal - projectedTeam, 0)} short.`}` +
    `${behindReps.length ? ` ${behindReps.length} rep${behindReps.length === 1 ? " is" : "s are"} behind their own pace.` : ""}`;
  const goalAction = noGoalReps.length
    ? { label: `Set goals for ${noGoalReps.length} rep${noGoalReps.length === 1 ? "" : "s"}`, sub: "They have no target this month", href: "#goal-editor" }
    : behindReps.length
      ? { label: `Coach ${behindReps[0]}${behindReps.length > 1 ? ` & ${behindReps.length - 1} more` : ""}`, sub: "Pacing under their unit goal", href: "/team-command" }
      : { label: "Team's on pace — raise the bar", sub: "Push targets while you're ahead", href: "#goal-editor" };
  const goalTone: "red" | "amber" | "green" = noGoalReps.length ? "red" : behindReps.length ? "amber" : "green";

  function updateTeamGoal(value: string) {
    updateGoals({ ...goals, teamDeliveredUnits: Math.max(Number(value) || 0, 0) });
  }

  function updatePersonGoal(name: string, value: string) {
    updateGoals({
      ...goals,
      salespersonUnits: {
        ...goals.salespersonUnits,
        [name]: Math.max(Number(value) || 0, 0),
      },
    });
  }

  function goalFor(name: string) {
    return goals.salespersonUnits[name] ?? 0;
  }

  // Per-F&I-manager PVR/PPU targets. 0/empty clears the override — that manager
  // is judged against the store-wide target again (Finance Command shows which).
  function updateFinanceTarget(name: string, field: "pvr" | "ppu", value: string) {
    const n = Math.max(Number(value) || 0, 0);
    const current = goals.financeTargets?.[name] ?? {};
    const next = { ...current, [field]: n || undefined };
    const financeTargets = { ...(goals.financeTargets ?? {}) };
    if (!next.pvr && !next.ppu) delete financeTargets[name];
    else financeTargets[name] = next;
    updateGoals({ ...goals, financeTargets });
  }

  return (
    <div>
      <SectionHeader title="Goal Setup" kicker="Sales team unit targets" />

      <div className="mb-5"><NextActionBar read={goalRead} action={goalAction} tone={goalTone} /></div>

      {/* Team goal pace — an animated ring that fills to the team's progress.
          Tap-to-explain: the whole ring hands off to EILA to walk the pace math. */}
      <button
        type="button"
        onClick={() => askIla("Explain my team goal pace — walk the real math in plain words: delivered units vs the goal, what we're projected to land at month-end from today's pace, and who's driving or dragging it. If it looks off, find which input is wrong.")}
        className="glass-card mb-3 flex w-full items-center gap-5 rounded-[12px] p-5 text-left transition hover:border-mission-gold/30"
      >
        <MissionRing pct={percent} size={92} stroke={8}>
          <div className="font-display text-2xl font-black text-white">
            <CountUp value={percent} format={(n) => `${Math.round(n)}%`} />
          </div>
        </MissionRing>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Team Goal Pace</div>
          <div className="mt-1 font-display text-xl font-black text-white">
            <CountUp value={teamDelivered} format={(n) => String(Math.round(n))} />
            <span className="text-white/40"> of {teamGoal} units</span>
          </div>
          <div className="mt-1 text-sm text-white/50">{remaining > 0 ? `${remaining} to go this month` : "Goal reached — push the bar higher"}</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/28">ask EILA why</div>
        </div>
      </button>

      {/* Tap-to-explain on every computed number (the goal itself is the editable
          input below, so it stays a plain card). */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Team Unit Goal" value={`${teamGoal}`} detail="Editable sales team target" tone="gold" />
        <MetricCard label="Delivered Units" value={`${teamDelivered}`} detail="Delivered New + Used — tap" tone="green" onClick={() => setShowDelivered(true)} onExplain={() => askIla("Explain my delivered-units number — which deals count as delivered New + Used, and flag anything that looks miscounted.")} />
        <MetricCard label="Remaining" value={`${remaining}`} detail="Units left to target" tone={remaining ? "red" : "gold"} onExplain={() => askIla("Explain my remaining-units number — the real math from the team goal minus delivered, and what daily pace clears it by month-end.")} />
        <MetricCard label="Goal Pace" value={`${percent}%`} detail="Team progress" tone={percent >= 100 ? "gold" : percent >= 75 ? "green" : "blue"} onExplain={() => askIla("Explain my goal-pace percentage — walk the real math in plain words and tell me straight whether we hit the month at this pace. If it looks off, find which input is wrong.")} />
      </section>

      <section id="goal-editor" className="glass-card mt-5 scroll-mt-24 rounded-[12px] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-[12px] bg-mission-gold/10 text-mission-gold">
              <Target className="h-6 w-6" />
            </div>
            <div>
              <div className="readable-text font-display text-2xl font-black text-white">Edit Unit Goals</div>
              <div className="readable-text text-sm leading-6 text-white/56">Set the store sales team target and each salesperson&apos;s monthly unit goal.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetGoals}
              className="inline-flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black uppercase tracking-[0.08em] text-white/70 transition hover:border-mission-gold/40 hover:text-white"
            >
              <RotateCcw className="h-4 w-4" />
              Reset Goals
            </button>
            <StatusPill tone="green">Auto Saved</StatusPill>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
          <label className="block rounded-[12px] border border-mission-gold/20 bg-mission-gold/10 p-4">
            <span className="readable-text mb-2 block text-xs font-black uppercase tracking-[0.1em] text-mission-gold">Sales Team Unit Goal</span>
            <input
              className={inputClass}
              type="number"
              min="0"
              value={teamGoal}
              onChange={(event) => updateTeamGoal(event.target.value)}
            />
          </label>

          <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
              <Save className="h-4 w-4 text-mission-gold" />
              Goals save automatically as you type.
            </div>
            <p className="readable-text text-sm leading-6 text-white/58">
              These are monthly unit goals. Current units come from delivered New and Used deals in Deal Center.
            </p>
          </div>
        </div>
      </section>

      <section className="glass-card mt-5 overflow-hidden rounded-[12px]">
        <div className="border-b border-white/10 p-5">
          <div className="readable-text font-display text-2xl font-black text-white">Salesperson Unit Goals</div>
          <div className="readable-text mt-1 text-sm text-white/56">Edit each unit goal and watch the month-to-date progress update.</div>
        </div>
        {/* One clean, scannable card per rep — no horizontal-scroll spreadsheet.
            Same layout on phone and desktop; a pace bar gives instant triage. */}
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {salespeople.map((name) => {
            const delivered = salespersonStats(deals, name).units;
            const goal = goalFor(name);
            const left = Math.max(goal - delivered, 0);
            const pace = goal ? Math.round((delivered / goal) * 100) : 0;
            const noGoal = !(goal > 0);
            const eligible = bonusEligible(name);
            return (
              <div key={name} className="rounded-[12px] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="readable-text truncate font-bold text-white">{displayFullPersonName(name)}</div>
                    <div className="mt-0.5 text-xs text-white/50">{noGoal ? "No goal set" : `${unitsLabel(delivered)} delivered · ${unitsLabel(left)} to go`}</div>
                  </div>
                  <label className="shrink-0 text-right">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Goal</span>
                    <input className={`h-11 w-20 rounded-[12px] border bg-[#14161c]/80 px-3 text-center text-sm text-white outline-none focus:border-mission-gold/60 ${noGoal ? "border-mission-red/50" : "border-white/10"}`} type="number" min="0" value={goal} onChange={(event) => updatePersonGoal(name, event.target.value)} />
                  </label>
                </div>
                {!noGoal && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/45">Pace</span>
                      <StatusPill tone={pace >= 100 ? "gold" : pace >= 75 ? "green" : "blue"}>{pace}%</StatusPill>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className={`h-full rounded-full ${pace >= 100 ? "bg-mission-gold" : pace >= 75 ? "bg-mission-green" : "bg-mission-green/60"}`} style={{ width: `${Math.min(pace, 100)}%` }} />
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => toggleBonusEligible(name)}
                  title="Certified / CSI / connected-service met? Off forfeits this month's bonuses."
                  className="mt-3 flex w-full items-center justify-between gap-2 rounded-[10px] border border-white/10 bg-white/[0.02] px-3 py-2 text-left transition hover:border-mission-gold/40"
                >
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">Bonuses</span>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.1em] ${eligible ? "text-mission-green" : "text-mission-red"}`}>
                    <span className={`h-2 w-2 rounded-full ${eligible ? "bg-mission-green" : "bg-mission-red"}`} />
                    {eligible ? "Eligible" : "Forfeited"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-F&I-manager PVR/PPU targets — personal raises of the bar. Blank =
          judged against the store-wide target (Finance Command labels which). */}
      <section className="glass-card mt-5 overflow-hidden rounded-[12px]">
        <div className="border-b border-white/10 p-5">
          <div className="readable-text font-display text-2xl font-black text-white">F&amp;I Manager Targets</div>
          <div className="readable-text mt-1 text-sm text-white/56">
            Personal PVR and PPU targets per manager. Leave blank to use the store target ({currency(settings.targets.backEnd)} back PVR · {settings.targets.ppuMinimum.toFixed(2)} PPU minimum).
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {fmBoard.map((fm) => {
            const t = goals.financeTargets?.[fm.name] ?? {};
            const pvrGoal = t.pvr || settings.targets.backEnd;
            const ppuGoal = t.ppu || settings.targets.ppuMinimum;
            return (
              <div key={fm.name} className="rounded-[12px] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="readable-text truncate font-bold text-white">{displayFullPersonName(fm.name)}</div>
                    <div className="mt-0.5 text-xs text-white/50">
                      MTD {currency(fm.pvr)} PVR · {fm.ppu.toFixed(2)} PPU
                      <span className={fm.pvr >= pvrGoal && fm.ppu >= ppuGoal ? " text-mission-green" : " text-mission-red"}>
                        {" "}· {fm.pvr >= pvrGoal && fm.ppu >= ppuGoal ? "on target" : "under target"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <label className="text-right">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">PVR $</span>
                      <input
                        className="h-11 w-24 rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-center text-sm text-white outline-none focus:border-mission-gold/60"
                        type="number" min="0" step="50" placeholder={String(settings.targets.backEnd)}
                        value={t.pvr ?? ""} onChange={(event) => updateFinanceTarget(fm.name, "pvr", event.target.value)}
                      />
                    </label>
                    <label className="text-right">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">PPU</span>
                      <input
                        className="h-11 w-20 rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-center text-sm text-white outline-none focus:border-mission-gold/60"
                        type="number" min="0" step="0.1" placeholder={settings.targets.ppuMinimum.toFixed(2)}
                        value={t.ppu ?? ""} onChange={(event) => updateFinanceTarget(fm.name, "ppu", event.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {showDelivered && <DealsModal title="Delivered Units" subtitle="New + Used delivered" deals={deliveredDeals} onClose={() => setShowDelivered(false)} />}
    </div>
  );
}

const inputClass = "h-11 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition focus:border-mission-gold/60";
