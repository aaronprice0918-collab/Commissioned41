"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardCheck, LockKeyhole, ShieldCheck } from "lucide-react";
import { DealsModal } from "@/components/DealsModal";
import { useCrmLeads, type CrmLead } from "@/components/CrmProvider";
import { ProfilePhoto, ProfilePhotoUploader, profilePhotoKey } from "@/components/ProfilePhotoUpload";
import { PlayerCard } from "@/components/PlayerCard";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { useDeals } from "@/components/DealProvider";
import { useSalesGoals } from "@/components/GoalProvider";
import { usePayPlans, defaultSalesPlan, type PayPlan, type PayRole, type SalesPlan } from "@/components/PayPlanProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { canonicalPersonName, commissionableFrontGross, countsTowardPpu, currency, currentMonthPace, dailyNeed, displayFullPersonName, financeStatusLabel, isCountableFinance, isCountableRetail, isRetail, money, number, paceValue, productUnits, salespersonShare, samePerson, unitsLabel, type Deal, type StoreTargets } from "@/lib/data";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { salesCommissionForDeal, volumeBonus } from "@/lib/salesPay";
import { CountUp } from "@/components/CountUp";
import { calculateFinancePay, PVR_COLS, PPU_ROWS, GRID, type FinancePay } from "@/lib/financePayPlan";
import { useCompPlans } from "@/components/CompPlanProvider";
import { EnginePayPanel } from "@/components/EnginePayPanel";
import { computePay } from "@/lib/payEngine";
import { buildPerformance, buildDealRows } from "@/lib/buildPerformance";
import { askIla } from "@/lib/askIla";

// Tap-to-explain law: every computed number on this scorecard can be questioned —
// tapping hands off to EILA with a specific "Explain my <number>" prompt, and EILA
// walks the real math from the live deals + pay plan (estimate_pay).
function explainScorecardLine(label: string) {
  askIla(`Explain my "${label}" number on my scorecard — walk the real math in plain words from my actual deals and my pay plan. If it looks off, find which input is wrong.`);
}

export default function MyScorecardPage() {
  const { deals } = useDeals();
  const { leads } = useCrmLeads();
  const { salespeople, managers, financeManagers } = useTeamLists();
  const { payPlans, savePayPlan } = usePayPlans();
  const { activePlanFor } = useCompPlans();
  const { goals: salesGoals } = useSalesGoals();
  const { settings } = useStoreSettings();
  const { profile } = useAuth();
  const people = [
    ...salespeople.map((name) => ({ key: `Sales:${name}`, name, role: "Sales" as PayRole })),
    ...managers.map((name) => ({ key: `Manager:${name}`, name, role: "Manager" as PayRole })),
    ...financeManagers.map((name) => ({ key: `F&I:${name}`, name, role: "F&I" as PayRole })),
  ];
  const selected = resolveSignedInPerson(profile, people) || people[0] || { key: "", name: "Awaiting Profile", role: "Sales" as PayRole };
  const photoKey = profilePhotoKey(selected.role, selected.name);
  const plan = payPlans.find((item) => item.personName === selected.name && item.role === selected.role) || defaultPlan(selected.name, selected.role);
  const sp = plan.sales ?? defaultSalesPlan;
  const deliveredDeals = payableDeals(deals);
  const personalDeals = dealsForRole(deliveredDeals, selected.name, selected.role);
  const creditedDeals = personalDeals.filter(isCountableRetail);
  // Always the signed-in person's OWN numbers — never store totals (even for admins).
  const calc = selected.role === "Sales" ? calculateSalesPay(personalDeals, selected.name, plan.sales ?? defaultSalesPlan) : calculatePay(personalDeals, plan);
  // An activated pay plan (authored in the Pay Plan Studio) drives this role's
  // live pay when present — for ANY role — running through the universal engine.
  const activePlan = activePlanFor(selected.role);
  const activeResult =
    activePlan
      ? computePay(
          activePlan,
          buildPerformance(personalDeals, {
            role: selected.role,
            name: selected.name,
            menuMet: plan.menuMet !== false,
            csiMet: plan.csiMet !== false,
            csiMonthsBelow: plan.csiMonthsBelow ?? 1,
            // Same fast-start cutoff as the legacy calc — one rule, two engines.
            fastStartByDay: sp.fastStartByDay,
          }),
          buildDealRows(personalDeals, selected.role === "Sales" ? selected.name : undefined),
        )
      : null;

  // Otherwise F&I falls back to the built-in PVR×PPU grid; Sales/Manager to their calc.
  const financePay =
    !activePlan && selected.role === "F&I"
      ? calculateFinancePay({
          units: calc.units,
          backGross: calc.backGross,
          products: calc.products,
          vscUnits: personalDeals.filter((d) => isCountableFinance(d) && d.products?.vsc).length,
          menuMet: plan.menuMet !== false,
          csiMet: plan.csiMet !== false,
          csiMonthsBelow: plan.csiMonthsBelow ?? 1,
        })
      : null;
  const forfeitedBonuses = activeResult && sp.bonusEligible === false ? activeResult.bonuses.reduce((sum, b) => sum + b.amount, 0) : 0;
  const estPay = activeResult
    ? activeResult.netEstimatedPay + activeResult.drawOffset - forfeitedBonuses // engine honors the month's bonus forfeiture like the legacy calc
    : financePay
      ? financePay.commissionAfterPenalty
      : calc.totalPay;
  const oneOnOne = buildOneOnOne(selected.name, selected.role, calc, deals, leads, salesGoals.salespersonUnits[selected.name] || 0, settings.targets);
  const monthName = currentMonthPace(deals).monthName;
  const unitGoal = salesGoals.salespersonUnits[selected.name] || 0;
  const pacePct = unitGoal ? Math.min(100, Math.round((calc.units / unitGoal) * 100)) : Math.min(100, Math.round(calc.units * 5));
  const [showDeals, setShowDeals] = useState(false);
  const drillDeals = selected.role === "Sales" ? creditedDeals : personalDeals;

  // Each non-sales person owns their pay plan; editing it re-tallies their month instantly.
  function updatePlan(field: keyof PayPlan, value: number) {
    savePayPlan({ ...plan, personName: selected.name, role: selected.role as PayRole, [field]: value });
  }

  // F&I penalty state (menu / CSI met) — manager flips off the rare month missed.
  function setFinanceFlag(patch: Partial<PayPlan>) {
    savePayPlan({ ...plan, personName: selected.name, role: selected.role as PayRole, ...patch });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-10">
      {/* Private personal hero — the scorecard player-card */}
      <PlayerCard
        className="rise mx-auto max-w-md"
        name={displayFullPersonName(selected.name)}
        role={selected.role}
        sub={`${monthName} · ${selected.role === "Sales" ? "Sales Floor" : selected.role}`}
        topLabel="SCORECARD"
        photo={<div className="rounded-full border-2 border-mission-green p-[3px]" style={{ boxShadow: "0 0 18px rgb(96 150 255 / 0.4)" }}><ProfilePhoto photoKey={photoKey} name={selected.name} size="lg" /></div>}
        topRight={<span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] ${oneOnOne.onPace ? "bg-mission-green text-mission-navy" : "bg-mission-red/20 text-mission-red"}`}><LockKeyhole className="h-3 w-3" /> {oneOnOne.onPace ? "On Pace" : "Needs Push"}</span>}
      >
        {/* Tap the headline number and EILA walks the pay-engine math behind it. */}
        <button
          type="button"
          onClick={() => askIla(`Explain my estimated ${monthName} pay — run my month through the pay engine and walk the real math in plain words: what's in the number, what's still pending, and the single best move to raise it. If it looks off, find which input is wrong.`)}
          className="block w-full text-center"
        >
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">Est. {monthName} Pay</div>
          <div className="mt-1 font-display text-4xl font-black text-mission-green" style={{ textShadow: "0 0 18px rgb(96 150 255 / 0.4)" }}><CountUp value={estPay} format={(n) => currency(Math.round(n))} /></div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/28">tap — EILA explains the math</div>
        </button>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/45">Units</span>
            <span className="font-bold text-white">{unitsLabel(calc.units)}{unitGoal ? <span className="text-white/40"> / {unitGoal}</span> : null}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-mission-green" style={{ width: `${pacePct}%`, boxShadow: "0 0 10px rgb(96 150 255 / 0.6)" }} /></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-[9px] uppercase tracking-wide text-white/40">Front</div><div className="mt-0.5 text-sm font-black text-white">{currency(calc.frontGross)}</div></div>
          <div><div className="text-[9px] uppercase tracking-wide text-white/40">Back</div><div className="mt-0.5 text-sm font-black text-white">{currency(calc.backGross)}</div></div>
          <div><div className="text-[9px] uppercase tracking-wide text-white/40">Total</div><div className="mt-0.5 text-sm font-black text-mission-green">{currency(calc.totalGross)}</div></div>
        </div>
        <p className="mt-4 text-center text-xs leading-5 text-white/50">{oneOnOne.message}</p>
        <div className="mt-3 flex justify-center"><ProfilePhotoUploader photoKey={photoKey} name={selected.name} /></div>
      </PlayerCard>

      {/* Your private KPIs — tap drills into the deals; "ask EILA why" walks the math. */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile i={0} label="Units (MTD)" value={unitsLabel(calc.units)} sub="Splits count as half — tap" tone="green" onClick={() => setShowDeals(true)} onExplain={() => askIla("Explain my Units (MTD) number — which deals count, how splits count as half, and flag anything that looks miscredited.")} />
        <Tile i={1} label="Front Gross" value={currency(calc.frontGross)} sub="Your credited front — tap" onClick={() => setShowDeals(true)} onExplain={() => askIla("Explain my Front Gross number — walk the real math in plain words, deal by deal, including splits. If it looks off, find which input is wrong.")} />
        <Tile i={2} label="Back Gross" value={currency(calc.backGross)} sub="Your credited back — tap" onClick={() => setShowDeals(true)} onExplain={() => askIla("Explain my Back Gross number — walk the real math in plain words, deal by deal, including splits. If it looks off, find which input is wrong.")} />
        <Tile i={3} label="Total Gross" value={currency(calc.totalGross)} sub={selected.role === "Sales" ? "Doc fee excluded — tap" : "Role-based gross — tap"} tone="gold" onClick={() => setShowDeals(true)} onExplain={() => askIla("Explain my Total Gross number — front plus back, what's excluded, and the real math in plain words. If it looks off, find which input is wrong.")} />
      </section>

      {/* Today */}
      <section className="rise rounded-[20px] border border-white/8 bg-white/[0.025] p-6" style={{ animationDelay: "100ms" }}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5"><ClipboardCheck className="h-5 w-5 text-mission-gold" /><h2 className="font-display text-xl font-black text-white">Today</h2></div>
          <StatusPill tone={oneOnOne.onPace ? "green" : "red"}>{oneOnOne.onPace ? "On Pace" : "Needs Push"}</StatusPill>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
          <div className="grid gap-3 md:grid-cols-3">
            {oneOnOne.tasks.map((task) => (
              <Link key={task.label} href={taskHref(task.label)} className="group block rounded-[12px] border border-white/8 bg-white/[0.03] p-4 transition hover:border-mission-gold/40 hover:bg-white/[0.05]">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-mission-gold/80 group-hover:text-mission-gold">{task.label} →</div>
                <div className="mt-2 text-sm font-semibold leading-6 text-white/78">{task.value}</div>
              </Link>
            ))}
          </div>
          {/* Tap-to-explain: the whole pace panel hands off to EILA to walk the projection. */}
          <button
            type="button"
            onClick={() => askIla("Explain my pace check — walk the real math in plain words: current, goal, how you project my month-end pace from today, and the needed-daily number. If it looks off, find which input is wrong.")}
            className="rounded-[12px] border border-white/8 bg-[#14161c]/60 p-4 text-left transition hover:border-mission-gold/30"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-mission-gold">Pace Check</div>
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white/28">ask EILA why</span>
            </div>
            <div className="mt-3 space-y-2.5 text-sm">
              <PaceCheckLine label="Current" value={oneOnOne.current} />
              <PaceCheckLine label="Goal" value={oneOnOne.goal} />
              <PaceCheckLine label="Month Pace" value={oneOnOne.monthPace} tone={oneOnOne.onPace ? "green" : "red"} />
              <PaceCheckLine label="Needed Daily" value={oneOnOne.dailyNeed} tone={oneOnOne.onPace ? "green" : "red"} />
            </div>
          </button>
        </div>
      </section>

      {activePlan && activeResult ? (
        <EnginePayPanel plan={activePlan} result={activeResult} monthName={monthName} />
      ) : financePay ? (
        <FinancePayPanel
          financePay={financePay}
          monthName={monthName}
          menuMet={plan.menuMet !== false}
          csiMet={plan.csiMet !== false}
          csiMonthsBelow={plan.csiMonthsBelow ?? 1}
          onToggleMenu={() => setFinanceFlag({ menuMet: !(plan.menuMet !== false) })}
          onToggleCsi={() => setFinanceFlag({ csiMet: !(plan.csiMet !== false) })}
          onSetMonths={(n) => setFinanceFlag({ csiMonthsBelow: Math.max(1, n) })}
        />
      ) : (
      <>
      {/* Pay breakdown */}
      <section className="rise rounded-[20px] border border-white/8 bg-white/[0.025] p-6" style={{ animationDelay: "160ms" }}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-black text-white">{monthName} Pay Breakdown</h2>
          <StatusPill tone={calc.bonusEarned ? "green" : "blue"}>{calc.bonusEarned ? "Bonus Earned" : "Bonus Tracking"}</StatusPill>
        </div>
        {/* Every pay line is tap-to-explain — EILA walks that line's real math. */}
        <div className="grid gap-3 md:grid-cols-2">
          <Breakdown label={selected.role === "Sales" ? "Sales Commission" : "Base / Draw"} value={selected.role === "Sales" ? calc.frontPay : calc.basePay} onExplain={explainScorecardLine} />
          <Breakdown label={selected.role === "Sales" ? "Volume Bonus" : "Flat Unit Pay"} value={selected.role === "Sales" ? calc.unitBonusPay : calc.flatPay} onExplain={explainScorecardLine} />
          <Breakdown label={selected.role === "Sales" ? "Fast Start Bonus" : "Front Gross Pay"} value={selected.role === "Sales" ? calc.fastStartPay : calc.frontPay} onExplain={explainScorecardLine} />
          <Breakdown label="Back Gross Pay" value={calc.backPay} onExplain={explainScorecardLine} />
          <Breakdown label={selected.role === "Sales" ? "Finance PVR Bonus" : "Total Gross Pay"} value={selected.role === "Sales" ? calc.financeBonusPay : calc.totalGrossPay} onExplain={explainScorecardLine} />
          <Breakdown label={selected.role === "Sales" ? "Manual / Eligibility Bonuses" : "Product Bonus"} value={selected.role === "Sales" ? 0 : calc.productPay} onExplain={explainScorecardLine} />
          <Breakdown label={selected.role === "Sales" ? "Christmas Club" : "Unit Bonus"} value={selected.role === "Sales" ? calc.christmasClubPay : calc.unitBonusPay} onExplain={explainScorecardLine} />
          <Breakdown label="Estimated Total" value={calc.totalPay} highlight onExplain={explainScorecardLine} />
        </div>
        {selected.role === "Sales" && (
          <div className="mt-4 rounded-[12px] border border-mission-gold/15 bg-mission-gold/[0.06] p-4 text-sm leading-6 text-white/55">
            Bonuses needing outside approval — valid reviews, salesperson of the month/year, acquisition commissions, Mazda Certified, CSI/NPS, connected service, CRM completion — are not auto-added until tracked in the app.
          </div>
        )}
      </section>

      {/* Pay plan */}
      <section className="rise rounded-[20px] border border-white/8 bg-white/[0.025] p-6" style={{ animationDelay: "200ms" }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-black text-white">Pay Plan</h2>
          <StatusPill tone="gold">{selected.role}</StatusPill>
        </div>
        {selected.role === "Sales" ? (
          <div className="grid gap-x-10 gap-y-3 text-sm sm:grid-cols-2">
            <PayLine label={`New CGP ${currency(sp.newHighMin)}+`} value={`${currency(sp.newHighFlat)} flat`} />
            <PayLine label={`New CGP down to ${currency(sp.newMidMin)}`} value={`${currency(sp.newMidFlat)} flat`} />
            <PayLine label={`New CGP below ${currency(sp.newMidMin)}`} value={`${currency(sp.newMiniFlat)} mini`} />
            <PayLine label={`Used CGP under ${currency(sp.usedHighMin)}`} value={`${sp.usedPct}%, ${currency(sp.usedMinCommission)} min`} />
            <PayLine label={`Used CGP ${currency(sp.usedHighMin)}+`} value={`${sp.usedHighPct}%, ${currency(sp.usedMinCommission)} min`} />
            <PayLine label="Volume Bonus" value={[...sp.volumeTiers].sort((a, b) => a.units - b.units).map((t) => `${t.units}=${currency(t.bonus)}`).join(" · ") || "None"} />
            <PayLine label="Finance Bonus" value={`${sp.financeBonusUnits} units + ${currency(sp.financeBonusBackPvr)} PVR = ${currency(sp.financeBonusAmount)}`} />
            <PayLine label="Fast Start" value={`${sp.fastStartUnits} units by the ${sp.fastStartByDay}th = ${currency(sp.fastStartAmount)}`} />
          </div>
        ) : (
          <>
            <p className="mb-4 text-xs leading-5 text-white/45">This is your plan — set your numbers once and your month tallies instantly.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <PlanNum label="Monthly Base / Draw" value={plan.monthlyBase} onChange={(v) => updatePlan("monthlyBase", v)} prefix="$" />
              <PlanNum label="Flat Per Unit" value={plan.flatPerUnit} onChange={(v) => updatePlan("flatPerUnit", v)} prefix="$" />
              <PlanNum label="Front Gross %" value={plan.frontGrossPct} onChange={(v) => updatePlan("frontGrossPct", v)} suffix="%" />
              <PlanNum label="Back Gross %" value={plan.backGrossPct} onChange={(v) => updatePlan("backGrossPct", v)} suffix="%" />
              <PlanNum label="Total Gross %" value={plan.totalGrossPct} onChange={(v) => updatePlan("totalGrossPct", v)} suffix="%" />
              <PlanNum label="Product Unit Bonus" value={plan.productUnitBonus} onChange={(v) => updatePlan("productUnitBonus", v)} prefix="$" />
              <PlanNum label="Unit Bonus Threshold" value={plan.unitBonusThreshold} onChange={(v) => updatePlan("unitBonusThreshold", v)} suffix=" units" />
              <PlanNum label="Unit Bonus Amount" value={plan.unitBonusAmount} onChange={(v) => updatePlan("unitBonusAmount", v)} prefix="$" />
            </div>
          </>
        )}
      </section>
      </>
      )}

      {/* Deal credits / team */}
      <section className="rise overflow-hidden rounded-[20px] border border-white/8 bg-white/[0.025]" style={{ animationDelay: "240ms" }}>
        <div className="flex items-center gap-2.5 p-6 pb-4">
          <ShieldCheck className="h-5 w-5 text-mission-gold" />
          <h2 className="font-display text-xl font-black text-white">Your Deal Credits</h2>
        </div>
        {selected.role === "F&I" ? (
          personalDeals.length === 0 ? (
            <div className="p-8 text-center text-sm leading-6 text-white/58">No deals are tied to this scorecard yet.</div>
          ) : (
            <FinanceDealTable deals={personalDeals} />
          )
        ) : selected.role === "Manager" ? (
          personalDeals.length === 0 ? (
            <div className="p-8 text-center text-sm leading-6 text-white/58">No deals are tied to this scorecard yet.</div>
          ) : (
            <ManagerDealTable deals={personalDeals} />
          )
        ) : creditedDeals.length === 0 ? (
          <div className="p-8 text-center text-sm leading-6 text-white/58">No deals are tied to this scorecard yet.</div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {creditedDeals.map((deal) => {
              const share = salespersonShare(deal, selected.name);
              const split = share < 1;
              const front = commissionableFrontGross(deal) * share;
              const back = deal.backGrossReserve * share;
              return (
                <div key={deal.id} className="rounded-[12px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-white">{deal.customer}</div>
                      <div className="mt-0.5 text-xs text-white/45">{deal.date} · {split ? `Split ${unitsLabel(share)}` : "Solo"} · {unitsLabel(productUnits(deal) * share)} products</div>
                    </div>
                    <div className="shrink-0 font-display text-lg font-black text-mission-gold">{currency(front + back)}</div>
                  </div>
                  <div className="mt-3 flex gap-4 text-xs text-white/55">
                    <span>Front <span className="font-bold text-white">{currency(front)}</span></span>
                    <span>Back <span className="font-bold text-mission-green">{currency(back)}</span></span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showDeals && <DealsModal title="Your Deal Credits" subtitle={`${displayFullPersonName(selected.name)} · ${monthName}`} deals={drillDeals} onClose={() => setShowDeals(false)} />}
    </div>
  );
}

function Tile({ i, label, value, sub, tone = "white", onClick, onExplain }: { i: number; label: string; value: string; sub: string; tone?: "white" | "green" | "gold"; onClick?: () => void; onExplain?: () => void }) {
  const accent = tone === "green" ? "text-mission-green" : tone === "gold" ? "text-mission-gold" : "text-white";
  const primary = onClick ?? onExplain;
  const content = (
    <>
      <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</span>
      <div className={`mt-3 font-display text-3xl font-black leading-none tracking-tight ${accent}`}>{value}</div>
      <div className="mt-2 text-xs leading-5 text-white/50">{sub}</div>
      {/* Tap-to-explain chip — a nested tap target, so the wrapper is a div with
          role="button" (a real <button> can't legally contain another). Faintly
          visible always: phones don't hover. */}
      {onExplain && onClick && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onExplain(); }}
          className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/30 transition hover:text-mission-gold"
        >
          ask EILA why
        </button>
      )}
    </>
  );
  if (primary) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={primary}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); primary(); } }}
        className="rise lift cursor-pointer rounded-[16px] border border-white/8 bg-white/[0.03] p-5 text-left transition hover:border-mission-gold/30"
        style={{ animationDelay: `${i * 70}ms` }}
      >
        {content}
      </div>
    );
  }
  return (
    <div className="rise lift rounded-[16px] border border-white/8 bg-white/[0.03] p-5" style={{ animationDelay: `${i * 70}ms` }}>
      {content}
    </div>
  );
}

function FinanceDealTable({ deals }: { deals: Deal[] }) {
  return (
    <>
    <div className="divide-y divide-white/8 md:hidden">
      {deals.map((deal) => (
        <div key={deal.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="truncate font-bold text-white">{deal.customer}</div>
            <div className="mt-0.5 text-xs text-white/50">{deal.date} · {financeStatusLabel(deal.financeStatus)} · {productUnits(deal)} products</div>
          </div>
          <div className="shrink-0 font-display text-base font-black text-mission-green">{currency(deal.backGrossReserve)}</div>
        </div>
      ))}
    </div>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-mission-gold/20 bg-mission-gold/10">
            {["Date", "Customer", "Status", "Back / Reserve", "Products"].map((heading) => (
              <th key={heading} className="px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-b border-white/8">
              <td className="px-4 py-4 text-white/62">{deal.date}</td>
              <td className="px-4 py-4 font-bold text-white">{deal.customer}</td>
              <td className="px-4 py-4 text-white/62">{financeStatusLabel(deal.financeStatus)}</td>
              <td className="px-4 py-4 text-white">{currency(deal.backGrossReserve)}</td>
              <td className="px-4 py-4 text-white">{productUnits(deal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function ManagerDealTable({ deals }: { deals: Deal[] }) {
  return (
    <>
    <div className="divide-y divide-white/8 md:hidden">
      {deals.map((deal) => (
        <div key={deal.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="truncate font-bold text-white">{deal.customer}</div>
            <div className="mt-0.5 text-xs text-white/50">{deal.date} · {displayFullPersonName(deal.salesperson)}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-display text-base font-black text-mission-gold">{currency(deal.frontGross + deal.backGrossReserve)}</div>
            <div className="text-[10px] text-white/45">F {currency(deal.frontGross)} · B {currency(deal.backGrossReserve)}</div>
          </div>
        </div>
      ))}
    </div>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            {["Date", "Customer", "Salesperson", "Front", "Back", "Total"].map((heading) => (
              <th key={heading} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-b border-white/8">
              <td className="px-4 py-4 text-white/62">{deal.date}</td>
              <td className="px-4 py-4 font-bold text-white">{deal.customer}</td>
              <td className="px-4 py-4 text-white/62">{displayFullPersonName(deal.salesperson)}</td>
              <td className="px-4 py-4 text-white">{currency(deal.frontGross)}</td>
              <td className="px-4 py-4 text-white">{currency(deal.backGrossReserve)}</td>
              <td className="px-4 py-4 font-black text-mission-gold">{currency(deal.frontGross + deal.backGrossReserve)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function PlanNum({ label, value, onChange, prefix, suffix }: { label: string; value: number; onChange: (value: number) => void; prefix?: string; suffix?: string }) {
  return (
    <label className="block rounded-[12px] border border-white/8 bg-white/[0.03] p-3">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{label}</span>
      <div className="flex items-center gap-1 text-white">
        {prefix && <span className="text-white/45">{prefix}</span>}
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          className="w-full bg-transparent font-display text-lg font-black tracking-tight outline-none"
        />
        {suffix && <span className="text-white/45">{suffix}</span>}
      </div>
    </label>
  );
}

function taskHref(label: string) {
  if (/appointment|pipeline/i.test(label)) return "/crm-desk";
  if (/desk/i.test(label)) return "/deal-center";
  if (/product|structure|coaching/i.test(label)) return "/finance-desk";
  if (/sales floor|accountability/i.test(label)) return "/goals";
  return "/crm-desk";
}

function dealsForRole(deals: Deal[], personName: string, role: PayRole) {
  // WHOLESALE DOES NOT PAY REPS (Aaron's rule, July 12 2026): a wholesale
  // unit carrying a salesperson's name never enters their pay set — not the
  // legacy calc, not the engine, not the deal list on this screen.
  if (role === "Sales") return deals.filter((deal) => isRetail(deal) && salespersonShare(deal, personName) > 0);
  if (role === "Manager") return deals.filter((deal) => namesMatch(deal.manager, personName));
  return deals.filter((deal) => isCountableFinance(deal) && namesMatch(deal.financeManager, personName));
}

function payableDeals(deals: Deal[]) {
  return deals.filter((deal) => deal.stage === "Delivered" || deal.stage === "Funded");
}

function calculatePay(deals: Deal[], plan: PayPlan) {
  const units = deals.length;
  // money() guards every raw dollar field: a partial/imported deal with a
  // missing or non-numeric frontGross/backGrossReserve must contribute 0, never
  // NaN — otherwise the flagship "Est Month Pay" tile renders $NaN.
  const frontGross = deals.reduce((sum, deal) => sum + money(deal.frontGross), 0);
  const backGross = deals.reduce((sum, deal) => sum + money(deal.backGrossReserve), 0);
  const allGross = deals.reduce((sum, deal) => sum + money(deal.frontGross) + money(deal.backGrossReserve), 0);
  const products = deals.filter(countsTowardPpu).reduce((sum, deal) => sum + productUnits(deal), 0);
  const basePay = plan.monthlyBase;
  const flatPay = units * plan.flatPerUnit;
  const frontPay = frontGross * (plan.frontGrossPct / 100);
  const backPay = backGross * (plan.backGrossPct / 100);
  const totalGrossPay = allGross * (plan.totalGrossPct / 100);
  const productPay = products * plan.productUnitBonus;
  const bonusEarned = units >= plan.unitBonusThreshold && plan.unitBonusThreshold > 0;
  const unitBonusPay = bonusEarned ? plan.unitBonusAmount : 0;
  const totalPay = basePay + flatPay + frontPay + backPay + totalGrossPay + productPay + unitBonusPay;

  return { units, frontGross, backGross, totalGross: allGross, products, basePay, flatPay, frontPay, backPay, totalGrossPay, productPay, bonusEarned, unitBonusPay, fastStartPay: 0, financeBonusPay: 0, christmasClubPay: 0, totalPay };
}

// Salesperson pay, driven by the store's configurable SalesPlan (defaults to
// Kennesaw's plan, so existing numbers are unchanged). Same shape as before.
function calculateSalesPay(deals: Deal[], personName: string, salesPlan: SalesPlan) {
  const retailDeals = deals.filter((deal) => isCountableRetail(deal) && salespersonShare(deal, personName) > 0);
  let units = 0;
  let frontGross = 0;
  let backGross = 0;
  let products = 0;
  let frontPay = 0;
  let fastStartUnits = 0;
  for (const deal of retailDeals) {
    const share = salespersonShare(deal, personName);
    units += share;
    frontGross += commissionableFrontGross(deal) * share;
    backGross += money(deal.backGrossReserve) * share;
    if (countsTowardPpu(deal)) products += productUnits(deal) * share;
    frontPay += salesCommissionForDeal(deal, salesPlan) * share;
    if (Number(deal.date.slice(8, 10)) <= salesPlan.fastStartByDay) fastStartUnits += share;
  }
  const allGross = frontGross + backGross;
  // Bonus eligibility (Certified / CSI / connected service) — defaults ON; a
  // manager forfeits the month's bonuses by flipping it off on the Goals page.
  const eligible = salesPlan.bonusEligible !== false;
  const unitBonusPay = eligible ? volumeBonus(units, salesPlan) : 0;
  const backPvr = units ? backGross / units : 0;
  const financeBonusPay = eligible && units >= salesPlan.financeBonusUnits && backPvr >= salesPlan.financeBonusBackPvr ? salesPlan.financeBonusAmount : 0;
  const fastStartPay = eligible && fastStartUnits >= salesPlan.fastStartUnits ? salesPlan.fastStartAmount : 0;
  const christmasClubPay = 0;
  const totalPay = frontPay + unitBonusPay + financeBonusPay + fastStartPay + christmasClubPay;

  return {
    units,
    frontGross,
    backGross,
    totalGross: allGross,
    products,
    basePay: 0,
    flatPay: 0,
    frontPay,
    backPay: 0,
    totalGrossPay: 0,
    productPay: 0,
    bonusEarned: unitBonusPay > 0,
    unitBonusPay,
    fastStartPay,
    financeBonusPay,
    christmasClubPay,
    totalPay,
  };
}

type ScorecardCalc = ReturnType<typeof calculatePay>;

function buildOneOnOne(personName: string, role: PayRole, calc: ScorecardCalc, deals: Deal[], leads: CrmLead[], unitGoal: number, targets: StoreTargets) {
  const pace = currentMonthPace(deals);
  const personalLeads = leads.filter((lead) => namesMatch(lead.salesperson, personName));
  const todaysAppointments = personalLeads.filter((lead) => lead.appointment?.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const openLeads = personalLeads.filter((lead) => !["Won", "Lost"].includes(lead.status)).length;

  if (role === "Sales") {
    const goal = unitGoal || 12;
    const monthPaceValue = paceValue(calc.units, pace);
    const neededDaily = dailyNeed(goal, calc.units, pace.remainingDays);
    const onPace = monthPaceValue >= goal;
    const message = onPace
      ? `${displayFullPersonName(personName)}, you are pacing ${number(monthPaceValue, 1)} units against a ${goal} unit goal. Stay sharp today: confirm every appointment, protect gross, and help the desk turn activity into delivered cars.`
      : `${displayFullPersonName(personName)}, you are at ${unitsLabel(calc.units)}/${goal} and pacing ${number(monthPaceValue, 1)} units. Your one-on-one mission today is ${number(neededDaily, 2)} delivered-unit pace. Build the day through appointments, follow-up, and clean write-ups.`;

    return {
      onPace,
      message,
      current: `${unitsLabel(calc.units)} Units`,
      goal: `${goal} Units`,
      monthPace: `${number(monthPaceValue, 1)} Units`,
      dailyNeed: `${number(neededDaily, 2)} Units`,
      tasks: [
        { label: "Appointment Focus", value: todaysAppointments ? `${todaysAppointments} appointment${todaysAppointments === 1 ? "" : "s"} today. Confirm, show, and desk them clean.` : "Set or confirm at least one strong appointment today." },
        { label: "Pipeline Focus", value: openLeads ? `${openLeads} open CRM opportunities need a next action.` : "Create fresh opportunities and log every customer touch." },
        { label: "Desk Focus", value: calc.units >= goal ? "Protect your pace and help the team close." : "Ask for the next desk turn early. Do not let a customer drift." },
      ],
    };
  }

  if (role === "F&I") {
    const pvr = calc.units ? calc.backGross / calc.units : 0;
    const ppu = calc.units ? calc.products / calc.units : 0;
    const onPace = pvr >= targets.backEnd && ppu >= targets.ppuElite;
    return {
      onPace,
      message: onPace
        ? `${displayFullPersonName(personName)}, you are at ${currency(pvr)} back PVR and ${number(ppu, 2)} PPU. Keep every menu clean and keep product value protected.`
        : `${displayFullPersonName(personName)}, today's one-on-one focus is ${currency(targets.backEnd)} back PVR and ${number(targets.ppuElite, 2)} PPU. Every classified copy needs a full presentation, clean structure, and documented product opportunity.`,
      current: `${currency(pvr)} PVR`,
      goal: `${currency(targets.backEnd)} PVR`,
      monthPace: `${number(ppu, 2)} PPU`,
      dailyNeed: ppu >= targets.ppuElite ? "On Product Pace" : `${number(Math.max(targets.ppuElite - ppu, 0), 2)} PPU Gap`,
      tasks: [
        { label: "Product Focus", value: "Every classified deal gets a complete product review." },
        { label: "Structure Focus", value: "Protect reserve, rate, lender fit, and clean funding before delivery." },
        { label: "Coaching Focus", value: "Partner with sales early so finance does not start from behind." },
      ],
    };
  }

  const projectedUnits = paceValue(calc.units, pace);
  const onPace = projectedUnits >= 130;
  return {
    onPace,
    message: onPace
      ? `${displayFullPersonName(personName)}, the team is pacing toward the store target. Keep the floor focused on appointments, desk speed, and clean gross.`
      : `${displayFullPersonName(personName)}, the store needs ${number(dailyNeed(130, calc.units, pace.remainingDays), 2)} delivered units per day to reach 130. Today's one-on-one focus is removing friction before it costs a deal.`,
    current: `${unitsLabel(calc.units)} Units`,
    goal: "130 Units",
    monthPace: `${number(projectedUnits, 1)} Units`,
    dailyNeed: `${number(dailyNeed(130, calc.units, pace.remainingDays), 2)} Units`,
    tasks: [
      { label: "Sales Floor", value: "Review who is behind pace and set a specific appointment/action target." },
      { label: "Desk", value: "Keep every active customer moving to a clear next step." },
      { label: "Accountability", value: "Use private messages to send direct coaching after each one-on-one." },
    ],
  };
}

function defaultPlan(personName: string, role: PayRole): PayPlan {
  return {
    personName,
    role,
    monthlyBase: 0,
    flatPerUnit: role === "Sales" ? 200 : 0,
    frontGrossPct: role === "Sales" ? 25 : role === "Manager" ? 2 : 0,
    backGrossPct: role === "F&I" ? 12 : 0,
    totalGrossPct: 0,
    productUnitBonus: role === "F&I" ? 40 : 0,
    unitBonusThreshold: role === "Manager" ? 130 : role === "F&I" ? 45 : 12,
    unitBonusAmount: role === "Manager" ? 2000 : role === "F&I" ? 1000 : 750,
  };
}

function profileRoleToPayRole(role?: string): PayRole {
  if (role === "Manager" || role === "Admin") return "Manager";
  if (role === "F&I") return "F&I";
  return "Sales";
}

function resolveSignedInPerson(profile: { employeeName: string; role: string } | null, people: Array<{ key: string; name: string; role: PayRole }>) {
  if (!profile?.employeeName) return null;
  const employeeName = canonicalPersonName(profile.employeeName);
  const role = profileRoleToPayRole(profile.role);
  // Match the signed-in user to their roster record by name — FUZZY, because the
  // login profile name and the roster spelling can differ slightly. Prefer the
  // record that also matches their role (so an F&I manager lands on the F&I plan).
  const match =
    people.find((person) => samePerson(person.name, employeeName) && person.role === role) ||
    people.find((person) => samePerson(person.name, employeeName));
  if (match) return match;
  // No roster match — anchor to the signed-in identity and THEIR role, never the
  // first salesperson's plan. (An F&I/Manager sees their own plan, not Sales.)
  return { key: `${role}:${employeeName}`, name: employeeName, role };
}

function namesMatch(left: string, right: string) {
  return samePerson(cleanPersonKey(left), cleanPersonKey(right));
}

function cleanPersonKey(name: string) {
  return name.trim().replace(/^(sales|manager|f&i):/i, "");
}

function FinanceStat({ label, value, tone, onExplain }: { label: string; value: string; tone?: "gold"; onExplain?: (label: string) => void }) {
  const body = (
    <>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">{label}</div>
      <div className={`mt-1 font-display text-xl font-black ${tone === "gold" ? "text-mission-gold" : "text-white"}`}>{value}</div>
    </>
  );
  if (onExplain) {
    return (
      <button type="button" onClick={() => onExplain(label)} title="Tap — EILA explains this number" className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3 text-left transition hover:border-mission-gold/40">
        {body}
      </button>
    );
  }
  return <div className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3">{body}</div>;
}

function PenaltyToggle({ label, met, penalty, onToggle, extra }: { label: string; met: boolean; penalty: string; onToggle: () => void; extra?: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-white/10 bg-white/[0.02] p-3">
      <button type="button" onClick={onToggle} title="On = requirement met (no penalty). Tap to flag a miss." className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">{label}</span>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.1em] ${met ? "text-mission-green" : "text-mission-red"}`}>
          <span className={`h-2 w-2 rounded-full ${met ? "bg-mission-green" : "bg-mission-red"}`} />
          {met ? "Met" : `Missed ${penalty}`}
        </span>
      </button>
      {extra}
    </div>
  );
}

// The real F&I pay model — PVR×PPU grid → % of net profit, with the live cell lit.
function FinancePayPanel({ financePay: f, monthName, menuMet, csiMet, csiMonthsBelow, onToggleMenu, onToggleCsi, onSetMonths }: { financePay: FinancePay; monthName: string; menuMet: boolean; csiMet: boolean; csiMonthsBelow: number; onToggleMenu: () => void; onToggleCsi: () => void; onSetMonths: (n: number) => void }) {
  return (
    <section className="rise rounded-[20px] border border-white/8 bg-white/[0.025] p-6" style={{ animationDelay: "160ms" }}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-black text-white">{monthName} F&amp;I Pay — Grid Plan</h2>
        <StatusPill tone="gold">{f.effectivePct.toFixed(1)}% of net</StatusPill>
      </div>

      {/* Every grid stat and pay line is tap-to-explain — EILA walks the real math. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FinanceStat label="Your PVR" value={currency(Math.round(f.pvr))} onExplain={explainScorecardLine} />
        <FinanceStat label="Your PPU" value={number(f.ppu, 2)} onExplain={explainScorecardLine} />
        <FinanceStat label="VSC Penetration" value={`${number(f.vscPenetration, 0)}%`} onExplain={explainScorecardLine} />
        <FinanceStat label="Effective Rate" value={`${f.effectivePct.toFixed(1)}%`} tone="gold" onExplain={explainScorecardLine} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Breakdown label="Net F&I Profit" value={f.netProfit} onExplain={explainScorecardLine} />
        <Breakdown label={`Commission (${f.effectivePct.toFixed(1)}%)`} value={f.commission} onExplain={explainScorecardLine} />
        {f.penaltyAmount > 0 && <Breakdown label={`Penalty (−${f.menuPenaltyPct + f.csiPenaltyPct}%)`} value={-f.penaltyAmount} onExplain={explainScorecardLine} />}
        <Breakdown label="Commission (net of penalty)" value={f.commissionAfterPenalty} highlight onExplain={explainScorecardLine} />
        <Breakdown label="Monthly Draw (advance)" value={-f.drawMonthly} onExplain={explainScorecardLine} />
        <Breakdown label="Est. Check (after draw)" value={f.estCheck} onExplain={explainScorecardLine} />
      </div>

      <div className="mt-4 grid gap-x-10 gap-y-2 text-sm sm:grid-cols-2">
        <PayLine label="Base grid rate" value={`${f.basePct.toFixed(1)}%`} />
        <PayLine label="PVR bonus (over $1,900)" value={f.pvrBonusPct ? `+${f.pvrBonusPct}%` : "—"} />
        <PayLine label="VSC bonus (over 50%)" value={f.vscBonusPct ? `+${f.vscBonusPct}%` : "—"} />
        <PayLine label="Effective rate" value={`${f.effectivePct.toFixed(1)}%`} />
      </div>

      {/* Penalty switches — default Met (no penalty); flip the rare month missed. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <PenaltyToggle label="Menu usage ≥ 95%" met={menuMet} penalty="−5%" onToggle={onToggleMenu} />
        <PenaltyToggle
          label="CSI at / above region"
          met={csiMet}
          penalty={`−${5 + 3 * Math.max(0, csiMonthsBelow - 1)}%`}
          onToggle={onToggleCsi}
          extra={!csiMet ? (
            <label className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/55">
              Consecutive months below
              <input type="number" min={1} value={csiMonthsBelow} onChange={(e) => onSetMonths(Number(e.target.value) || 1)} className="h-8 w-16 rounded-[8px] border border-white/12 bg-[#14161c]/80 px-2 text-center text-sm text-white outline-none focus:border-mission-gold/60" />
            </label>
          ) : null}
        />
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-center text-xs">
          <thead>
            <tr>
              <th className="p-2 text-left font-black text-white/45">PPU \ PVR</th>
              {PVR_COLS.map((c) => <th key={c} className="p-2 font-black text-white/55">{currency(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {PPU_ROWS.map((row, ri) => (
              <tr key={row}>
                <td className="p-2 text-left font-black text-white/55">{row.toFixed(1)}</td>
                {PVR_COLS.map((c, ci) => {
                  const active = ri === f.rowIndex && ci === f.colIndex;
                  return (
                    <td key={c} className={`p-2 tabular-nums ${active ? "rounded-[8px] bg-mission-gold font-black text-mission-navy" : "text-white/55"}`}>
                      {GRID[ri][ci].toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Best move to earn more — next-tier opportunities from the engine. */}
      {f.opportunities.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-mission-gold">Best move this month</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {f.opportunities.map((o) => (
              <div key={o.label} className="rounded-[12px] border border-mission-gold/25 bg-mission-gold/[0.06] p-3">
                <div className="text-sm font-bold text-white">{o.label}</div>
                <div className="mt-0.5 text-xs text-white/60">{o.detail}</div>
                {o.estAddedPay != null && <div className="mt-1 font-display text-base font-black text-mission-gold">+{currency(Math.round(o.estAddedPay))}/mo</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plain-English explanation — every line of the calculation (acceptance #6). */}
      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/45 transition hover:text-white/70">
          <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" /> How this was calculated · {f.confidence} confidence
        </summary>
        <ul className="mt-2 space-y-1 border-l border-white/10 pl-4 text-xs leading-5 text-white/60">
          {f.explanation.map((line, i) => <li key={i}>{line}</li>)}
          {f.warnings.map((w, i) => <li key={`w${i}`} className="text-mission-gold/80">⚠ {w}</li>)}
        </ul>
      </details>

      <p className="mt-4 text-xs leading-5 text-white/45">
        Commission = grid rate &times; net F&amp;I profit. Net uses your back-end gross — individual chargebacks aren&apos;t tracked in-app yet. Menu-usage (under 95%) and CSI penalties, and the $200 uncashed-contract fine, are policy adjustments not auto-applied. An $8,000 monthly draw is advanced against this.
        {f.belowGrid ? " Your PVR/PPU is below the grid floor — showing the lowest band." : ""}
      </p>
    </section>
  );
}

function PayLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
      <span className="text-white/48">{label}</span>
      <strong className="text-white">{value}</strong>
    </div>
  );
}

// Tap-to-explain: every pay line can be questioned — onExplain receives the line's
// label so call sites don't repeat it; the row renders as a button only then.
function Breakdown({ label, value, highlight = false, onExplain }: { label: string; value: number; highlight?: boolean; onExplain?: (label: string) => void }) {
  // Empty bonus rows are clutter — only show a line that carries money (or the total).
  if (value === 0 && !highlight) return null;
  const cls = `rounded-[12px] border p-4 ${highlight ? "border-mission-gold/40 bg-mission-gold/10" : "border-white/10 bg-white/[0.035]"}`;
  const body = (
    <>
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">{label}</div>
      <div className={`mt-2 font-display text-2xl font-black ${highlight ? "text-mission-gold" : "text-white"}`}>{currency(value)}</div>
    </>
  );
  if (onExplain) {
    return (
      <button type="button" onClick={() => onExplain(label)} title="Tap — EILA explains this number" className={`${cls} text-left transition hover:border-mission-gold/40`}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

function PaceCheckLine({ label, value, tone = "white" }: { label: string; value: string; tone?: "white" | "green" | "red" }) {
  const toneClass = tone === "green" ? "text-mission-green" : tone === "red" ? "text-mission-red" : "text-white";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
      <span className="text-white/46">{label}</span>
      <strong className={toneClass}>{value}</strong>
    </div>
  );
}
