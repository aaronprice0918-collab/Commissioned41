"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { Brain, CalendarDays, CheckCircle2, Sparkles, TrendingUp, DollarSign, PhoneCall, Trophy, ArrowUpRight, Gauge, Info } from "lucide-react";
import { useMission } from "@/lib/store";
import { useAskIla } from "./AppShell";
import { forecast, dealTotals, followUpQueue, monthBounds, money } from "@/lib/engine";
import { coach, todaysMission, Insight } from "@/lib/coach";
import { INDUSTRY_UNIT, ROLE_LABEL } from "@/lib/types";
import { INDUSTRY_DEAL, localizeUnits, statusLabel } from "@/lib/industry";
import { basisGrossLabel, dealMoneyOf, moneyBasis } from "@/lib/fni";
import type { NextTier, PlanType } from "@/lib/payplan/types";
import { Stat, SectionTitle, Drawer } from "./ui";
import { CountUp, ProgressRing } from "./motion";
import { IlaGreeting } from "./IlaGreeting";
import { GoalClimb } from "./GoalClimb";

const PLAN_LABEL: Record<PlanType, string> = {
  flat: "Flat % plan", tiered: "Tiered plan", grid: "Grid plan", perDeal: "Per-deal plan", hybrid: "Hybrid plan", unknown: "Plan needs review",
};

export function Dashboard() {
  const { data } = useMission();
  const askIla = useAskIla();
  const profile = data.profile!;
  const plan = profile.plan;
  const hasSampleData = data.deals.some((d) => d.demo);

  const v = useMemo(() => {
    const f = forecast(plan, data.deals, new Date(), profile.daysOff ?? []);
    const live = dealTotals(f.counted);
    const insights = coach(plan, data.deals, profile.industry, new Date(), profile.daysOff ?? []);
    const mission = todaysMission(plan, data.deals, profile.industry, new Date(), profile.daysOff ?? []);
    const touchQueue = followUpQueue(data.deals);
    const today = localDayKey();
    const todayLife = (data.lifeItems ?? [])
      .filter((i) => i.date === today && !i.done)
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    const { daysRemaining } = monthBounds();
    const counts = {
      appt: f.pipeline.filter((d) => d.status === "appointment").length,
      working: f.pipeline.filter((d) => d.status === "working").length,
      pending: f.pipeline.filter((d) => d.status === "pending").length,
      finance: f.pipeline.filter((d) => d.status === "finance").length,
    };
    return { f, live, insights, mission, daysRemaining, counts, touchQueue, todayLife };
    // profile.daysOff MUST be a dep: the Dashboard stays mounted under the
    // Settings/EILA overlays, and a days-off change there left pace/paycheck/
    // today's focus computed on the old schedule (July 8 audit, confirmed).
  }, [plan, data.deals, data.lifeItems, profile.industry, profile.daysOff]);

  const { f, live, insights, mission, daysRemaining, counts, touchQueue, todayLife } = v;
  const cur = f.current;
  const goalPct = plan.goalUnits ? (f.totals.units / plan.goalUnits) * 100 : 0;
  const unit = INDUSTRY_UNIT[profile.industry];
  const spec = INDUSTRY_DEAL[profile.industry];
  const fastestMove = cur.nextTiers[0];
  const liveCount = counts.appt + counts.working + counts.pending + counts.finance;
  // The money channel the USER'S plan pays on — back for an F&I grid.
  const basis = moneyBasis(profile);
  const basisGross = f.counted.reduce((s, d) => s + dealMoneyOf(basis)(d), 0);

  return (
    <div className="space-y-1 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] lg:items-start lg:gap-4 lg:space-y-0">
      <WelcomeHome
        firstName={profile.name.split(" ")[0] || "there"}
        roleLabel={ROLE_LABEL[plan.role as keyof typeof ROLE_LABEL] ?? plan.role}
        monthLabel={monthName()}
        planLabel={PLAN_LABEL[cur.planType]}
        confidence={Math.round(cur.confidence * 100)}
        earned={cur.grossPay}
        likely={f.likely.grossPay}
        closed={f.totals.units}
        liveCount={liveCount}
        unitLabel={f.totals.units === 1 ? unit.singular : unit.plural}
        hasSampleData={hasSampleData}
        onPlan={() => askIla("Make today feel simple. Give me a positive day plan with one calm first step.")}
      />

      <AssistantDesk
        nextLife={todayLife[0]}
        lifeCount={todayLife.length}
        customerCount={touchQueue.needsYou}
        earned={cur.grossPay}
        likely={f.likely.grossPay}
        liveCount={liveCount}
        memoryCount={data.ilaMemories?.length ?? 0}
        moneyReady={profile.money?.checkingBalance != null}
        mission={mission}
        onBrief={() => askIla(`Brief me like my executive assistant. You already checked my day, customer reminders, deal board, and money. Give me the agenda, what you noticed, and the first calm step. Keep it polished and concise.`)}
      />

      {/* EILA welcome — the emotional anchor of the dashboard */}
      <div className="mt-3 lg:col-span-2">
        <IlaGreeting profile={profile} deals={data.deals} />
      </div>

      {/* THE CLIMB — the bold hero: shows with a draw or a goal, climbs to the summit. */}
      {(plan.takeHomeGoal || plan.draw) && (
        <div className="mt-3 lg:col-span-2">
          <GoalClimb
            takeHome={cur.netAfterTax}
            goal={plan.takeHomeGoal ?? 0}
            taxRate={plan.taxRate}
            draw={plan.draw?.amount ?? 0}
            drawOwed={cur.drawOwed}
            onAsk={() => askIla(plan.takeHomeGoal ? `Walk me up my climb to my ${money(plan.takeHomeGoal)} take-home goal — where am I now, how much more gross commission I need after my draw and tax, and the exact plan to reach the top this month.` : `Help me set a monthly take-home goal, then show me the climb to reach it from where I am now.`)}
          />
        </div>
      )}

      {/* HERO — tappable: EILA walks the math behind the number.
          Aaron, July 17: the old headline ("Likely month-end commission" over
          $4,874) was a LIE — that number is what's EARNED SO FAR (the floor with
          no working deals entered), while the real month-end trajectory (pace,
          ~$9,324) was hidden. Now the big number is the FACT (earned/banked),
          pace is shown as an explicitly-labeled projection, and the real check
          beyond the draw stays front and center. No number is dressed up as
          something it isn't. */}
      {(() => {
        const onDraw = !!plan.draw && cur.grossPay > 0;
        const hasSpread = f.best.grossPay > cur.grossPay + 1;
        const drawLabel = plan.draw ? (plan.draw.amount % 1000 === 0 ? `$${plan.draw.amount / 1000}k` : money(plan.draw.amount)) : "";
        const check = cur.aboveDraw; // the REAL check beyond every advance, from banked deals
        const lockedInLift = f.likely.grossPay > cur.grossPay + 1; // working deals add on top of banked
        const paceAhead = f.pacePay > cur.grossPay + 1;
        return (
      <button className="glass living-ring rise mt-3 block w-full overflow-hidden p-5 text-left lg:mt-0" onClick={() => askIla("Walk me through my commission on the home screen — what I've earned so far, what I'm on pace for by month-end, how my draw affects the actual check, and what would move it. Plain words.")}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent2"><Sparkles size={13} /> Commission earned so far</div>
        <div className="mt-1 text-[44px] font-black leading-none tabnum">
          <CountUp value={cur.grossPay} format={money} />
        </div>
        <div className="mt-1 text-xs text-fg/50">banked from your delivered deals this month{onDraw ? ` — it pays down your ${drawLabel} draw first` : ""}</div>
        {/* The real forward number, labeled as the projection it is (never as a fact). */}
        {paceAhead && (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className="rounded-full bg-accent/10 px-2.5 py-1 font-semibold text-accent">On pace for {money(f.pacePay)} by month-end</span>
            <span className="text-xs text-fg/45">if you hold this month's selling rate</span>
          </div>
        )}
        {lockedInLift && (
          <div className="mt-1.5 text-xs text-fg/55">≈ {money(f.likely.grossPay)} once your working deals land{hasSpread ? `, up to ${money(f.best.grossPay)} if they all do` : ""}.</div>
        )}
        {/* THE number that answers "what do I actually take home." On a draw,
            that's the check beyond every advance — shown bold, not buried. */}
        {onDraw ? (
          <div className="mt-4 rounded-xl bg-fg/[0.04] px-3 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/45">Your check beyond the {drawLabel} draw</div>
            <div className={`mt-0.5 text-xl font-black tabnum ${check > 0 ? "text-good" : "text-fg/70"}`}>
              {money(Math.max(0, check))}
              {check <= 0 && <span className="ml-2 text-xs font-semibold text-fg/50">still clearing the draw — every deal builds it</span>}
            </div>
            {check > 0 && plan.taxRate > 0 && (
              <div className="mt-1 text-xs text-fg/55">≈ {money(check * (1 - plan.taxRate / 100))} take-home after {plan.taxRate}% tax</div>
            )}
          </div>
        ) : (
          plan.taxRate > 0 && (
            <div className="mt-3 text-sm text-fg/70">≈ <span className="font-semibold tabnum">{money(cur.netAfterTax)}</span> take-home after {plan.taxRate}% tax</div>
          )
        )}
      </button>
        );
      })()}


      {/* Today's focus — one calm first step, not a command. */}
      <button className="glass rise mt-3 block w-full overflow-hidden p-5 text-left lg:mt-0 lg:min-h-full" onClick={() => askIla(`My focus today is: "${mission}" — walk me through it like a professional assistant. Keep it calm, clear, and tell me the first small step.`)}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent2"><Sparkles size={13} /> Today's focus</div>
        <div className="mt-2 text-[22px] font-black leading-tight text-fg">{mission}</div>
      </button>

      <FastestCheckMove move={fastestMove} mission={mission} unit={unit} />

      {/* THE NUMBERS — everything granular lives one clean tap down. Bold screen
          up top; the look-it-up data tucked in a drop-down (Aaron, July 8:
          "boring data that you find in a drop down"). */}
      <div className="lg:col-span-2">
      <Drawer label="See all your numbers" hint="Goal, rate, pace, live deals & how your check adds up">

      {/* Monthly goal — animated ring + count-up, celebrates when hit */}
      {plan.goalUnits ? (
        <button className={`glass rise mt-3 flex w-full items-center gap-4 p-4 text-left ${goalPct >= 100 ? "goal-hit" : ""}`} onClick={() => askIla("How do I hit my monthly goal from here? Give me the honest gap and the plan for this week.")}>
          <ProgressRing pct={goalPct} size={72}>
            <div className="text-[15px] font-black leading-none text-fg">
              <CountUp value={goalPct} format={(n) => `${Math.round(n)}%`} />
            </div>
          </ProgressRing>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/65">Monthly goal</div>
            <div className="mt-0.5 text-[15px] leading-snug text-fg/90">
              {goalPct >= 100 ? (
                <span className="inline-flex items-center gap-1.5 font-bold text-good">
                  <Trophy size={15} /> Goal hit — {f.totals.units} of {plan.goalUnits} {unit.plural}!
                </span>
              ) : (
                <>
                  <span className="font-bold tabnum text-fg">{f.totals.units}</span> of {plan.goalUnits} {unit.plural} ·{" "}
                  <span className="tabnum">{plan.goalUnits - f.totals.units}</span> to go
                </>
              )}
            </div>
          </div>
        </button>
      ) : null}

      {/* F&I rate (grid plans) */}
      {cur.rateBreakdown && (
        <button className="glass rise mt-3 block w-full p-5 text-left" onClick={() => askIla("Explain my commission rate — which part of my plan sets it right now (my PPU and PVR), and what would raise the rate?")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65"><Gauge size={13} className="text-accent2" /> Your commission rate</div>
            <div className="text-xs text-fg/65">{daysRemaining} days left</div>
          </div>
          <div className="mt-1 flex items-end gap-3">
            <div className="text-4xl font-black tabnum text-accent">
              <CountUp value={cur.rate} format={(n) => `${n.toFixed(cur.rate % 1 === 0 ? 0 : 1)}%`} />
            </div>
            <div className="pb-1 text-xs text-fg/50">PPU {cur.rateBreakdown.ppt.toFixed(1)} · PVR {money(cur.rateBreakdown.pvr)}{cur.rateBreakdown.bonusRate ? ` · +${cur.rateBreakdown.bonusRate}% bonus` : ""}</div>
          </div>
        </button>
      )}

      {/* Next-tier opportunities */}
      {cur.nextTiers.length > 0 && (
        <>
          <SectionTitle><span className="flex items-center gap-1.5"><ArrowUpRight size={13} className="text-good" /> Ways to improve</span></SectionTitle>
          <div className="space-y-2.5">
            {cur.nextTiers.map((t, i) => {
              const hint = localizeUnits(t.hint, unit);
              return (
                <button key={i} className="glass glass-tap flex w-full items-center justify-between p-4 text-left" onClick={() => askIla(`Walk me through this opportunity: "${hint}" — where does the +${money(t.addPay)} come from in my plan, and what is the first calm step today?`)}>
                  <div className="min-w-0 pr-3 text-[14px] leading-snug text-fg/85">{hint}</div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-black tabnum text-good">+{money(t.addPay)}</div>
                    {t.addRatePct ? <div className="text-[11px] text-fg/65">+{t.addRatePct}%</div> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Stat grid — every label speaks the rep's industry, and every money
          figure counts the channel THEIR plan pays on (an F&I manager sees
          back gross and true PVR, not the store's blended number). */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label={`${cap(unit.plural)} closed`} value={`${f.totals.units}`} hint={plan.goalUnits ? `Goal ${plan.goalUnits} · ${Math.round(goalPct)}%` : undefined} accent onClick={() => askIla(`Which ${unit.plural} count as closed this month and which don\u2019t? List them.`)} />
        <Stat label="On pace for" value={`${f.paceUnits} ${unit.plural}`} hint={`≈ ${money(f.pacePay)} month-end`} onClick={() => askIla("Explain my pace number — how you project my month-end from where I am today, including my days off.")} />
        <Stat
          label={spec.secondaryLabel ? basisGrossLabel(basis, profile.industry) : cap(spec.amountLabel)}
          value={money(basisGross)}
          onClick={() => askIla("Explain the gross number on my home screen — which money channel my plan pays on and which deals it counts.")}
          hint={
            basis === "back" ? `front ${money(live.primary)} stays with the store`
            : basis === "front" ? `back ${money(live.secondary)} not counted`
            : spec.secondaryLabel ? `Front ${money(live.primary)} · Back ${money(live.secondary)}`
            : `across ${f.totals.units} ${f.totals.units === 1 ? unit.singular : unit.plural}`
          }
        />
        <Stat
          label={basis === "back" && spec.secondaryLabel ? "PVR" : `Avg per ${unit.singular}`}
          value={money(f.totals.units ? basisGross / f.totals.units : 0)}
          hint={spec.addonsLabel ? `${live.addonsPerUnit.toFixed(1)} ${spec.addonsLabel.toLowerCase()}/${unit.singular}` : undefined}
          onClick={() => askIla(`Explain my average per ${unit.singular} — what goes into it and how it compares to what my plan needs.`)}
        />
      </div>

      {/* Live deals — every tile drills into the deal log (the UX law: if it
          looks interactive, it IS interactive; these were inert divs). */}
      <SectionTitle>Live deals now</SectionTitle>
      <div className="grid grid-cols-4 gap-2">
        <Pip n={counts.appt} label="Appts" href="/pipeline" /><Pip n={counts.working} label="Working" href="/pipeline" /><Pip n={counts.pending} label="Pending" href="/pipeline" /><Pip n={counts.finance} label={statusLabel(profile.industry, "finance", "Finance")} href={profile.role === "finance" ? "/finance" : "/pipeline"} />
      </div>

      {/* How it adds up — plain-English steps */}
      <SectionTitle>How it adds up</SectionTitle>
      <div className="glass divide-y divide-fg/5 p-1">
        {cur.steps.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-sm text-fg/70">{localizeUnits(s.label, unit)}</span>
            <span className="text-right text-xs tabnum text-fg/70">{localizeUnits(s.detail, unit)}</span>
          </div>
        ))}
      </div>

      {/* Missing data */}
      {cur.missingData.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-fg/[0.04] p-3 text-xs text-fg/50">
          <Info size={15} className="mt-0.5 shrink-0 text-accent2" />
          <span>This estimate assumes no penalties. Add your {cur.missingData.join(", ")} in Settings to sharpen it.</span>
        </div>
      )}

      {/* Coach */}
      <SectionTitle><span className="flex items-center gap-1.5"><Sparkles size={13} className="text-accent2" /> Coach</span></SectionTitle>
      <div className="space-y-2.5">{insights.map((ins, i) => <CoachCard key={i} ins={ins} />)}</div>
      </Drawer>
      </div>
    </div>
  );
}

function Pip({ n, label, href }: { n: number; label: string; href?: string }) {
  const body = <><div className="text-2xl font-black tabnum">{n}</div><div className="text-[11px] text-fg/70">{label}</div></>;
  if (href) return <Link href={href} className="glass flex flex-col items-center py-3 active:opacity-70">{body}</Link>;
  return <div className="glass flex flex-col items-center py-3">{body}</div>;
}

function WelcomeHome({
  firstName,
  roleLabel,
  monthLabel,
  planLabel,
  confidence,
  earned,
  likely,
  closed,
  liveCount,
  unitLabel,
  hasSampleData,
  onPlan,
}: {
  firstName: string;
  roleLabel: string;
  monthLabel: string;
  planLabel: string;
  confidence: number;
  earned: number;
  likely: number;
  closed: number;
  liveCount: number;
  unitLabel: string;
  hasSampleData: boolean;
  onPlan: () => void;
}) {
  const headline = earned > 0
    ? `You've already put ${money(earned)} on the board this month.`
    : liveCount > 0
      ? `${liveCount} live ${liveCount === 1 ? "deal is" : "deals are"} already moving.`
      : "Fresh board. We can make today simple.";

  return (
    <section
      className="rise overflow-hidden rounded-[28px] border border-accent/15 p-5 lg:col-span-2"
      style={{
        background:
          "linear-gradient(145deg, rgb(var(--ink-900)) 0%, rgb(var(--accent) / 0.08) 44%, rgb(var(--accent-2) / 0.075) 100%)",
        boxShadow: "0 22px 50px -34px rgb(var(--accent) / 0.55)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-bold uppercase tracking-wider text-fg/50">
        <span className="inline-flex items-center gap-1 rounded-full bg-good/12 px-2.5 py-1 text-good">
          <CheckCircle2 size={12} /> Welcome back
        </span>
        <span>{roleLabel}</span>
        <span>/</span>
        <span>{monthLabel}</span>
        {hasSampleData && <span className="rounded-full bg-accent/12 px-2 py-1 text-accent">Sample data</span>}
      </div>
      <div className="mt-3">
        <h1 className="font-display text-[30px] font-black leading-[1.04] tracking-tight text-fg">
          {greeting()}, {firstName}.
        </h1>
        <p className="mt-2 max-w-[44ch] text-[15px] font-semibold leading-relaxed text-fg/68">
          {headline} EILA will keep the day light, the money honest, and the next step clear.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onPlan} className="btn btn-primary !rounded-2xl !px-4 !py-2.5 !text-[13px]">
          <Sparkles size={15} /> Brief me
        </button>
        <Link href="/day" className="btn btn-ghost !rounded-2xl !px-4 !py-2.5 !text-[13px]">
          <CalendarDays size={15} /> Open day
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-fg/6 pt-3">
        <WelcomeMetric label={unitLabel} value={`${closed}`} tone="text-good" />
        <WelcomeMetric label="live deals" value={`${liveCount}`} tone="text-accent2" />
        <WelcomeMetric label={`${planLabel} read`} value={`${confidence}%`} tone="text-fg" />
      </div>
      <div className="mt-2 text-[11px] font-semibold text-fg/45 tabnum">
        Month-end outlook: <span className="text-accent">{money(likely)}</span>
      </div>
    </section>
  );
}

function WelcomeMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0">
      <div className={`text-lg font-black tabnum ${tone}`}>{value}</div>
      <div className="truncate text-[10px] font-bold uppercase tracking-wider text-fg/42">{label}</div>
    </div>
  );
}

function AssistantDesk({
  nextLife,
  lifeCount,
  customerCount,
  earned,
  likely,
  liveCount,
  memoryCount,
  moneyReady,
  mission,
  onBrief,
}: {
  nextLife?: { title: string; time?: string; kind: string };
  lifeCount: number;
  customerCount: number;
  earned: number;
  likely: number;
  liveCount: number;
  memoryCount: number;
  moneyReady: boolean;
  mission: string;
  onBrief: () => void;
}) {
  const agenda = nextLife
    ? `${nextLife.time ? `${displayTime(nextLife.time)} / ` : ""}${nextLife.title}`
    : lifeCount
      ? `${lifeCount} things on your day board`
      : "No personal appointments entered yet";
  const watching = [
    lifeCount ? `${lifeCount} day item${lifeCount === 1 ? "" : "s"}` : "",
    customerCount ? `${customerCount} customer touch${customerCount === 1 ? "" : "es"}` : "",
    liveCount ? `${liveCount} live deal${liveCount === 1 ? "" : "s"}` : "",
    moneyReady ? "money pulse" : "",
  ].filter(Boolean).join(" / ") || "the next thing you hand me";
  const needed = !moneyReady
    ? "I still need your money setup once, then I can watch cash and bills with you."
    : !lifeCount
      ? "Tell me one real-life thing I should protect today."
      : customerCount
        ? "Start with the warmest customer touch, then I will keep the rest in order."
        : "Keep feeding me the messy version. I will turn it into a clean next move.";
  return (
    <section className="glass rise mt-3 p-4 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent2">
            <Sparkles size={13} /> EILA at the desk
          </div>
          <div className="mt-1 text-[20px] font-black leading-tight text-fg">I checked the room before you walked in.</div>
          <p className="mt-1 text-[13px] font-semibold leading-relaxed text-fg/58">
            Your day, customers, deal board, and money picture are lined up below.
          </p>
        </div>
        <button onClick={onBrief} className="shrink-0 rounded-full bg-accent/12 px-3 py-2 text-[11px] font-black text-accent active:scale-95">
          Brief me
        </button>
      </div>

      <div className="mt-4 divide-y divide-fg/6 rounded-2xl bg-ink-800/68 px-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.72)]">
        <DeskRow icon={<CalendarDays size={16} />} label="Day" value={agenda} />
        <DeskRow
          icon={<PhoneCall size={16} />}
          label="Customers"
          value={customerCount ? `${customerCount} touch${customerCount === 1 ? "" : "es"} worth your attention` : "No urgent customer touches"}
        />
        <DeskRow
          icon={<DollarSign size={16} />}
          label="Money"
          value={`${money(earned)} earned / ${money(likely)} month-end outlook`}
        />
        <DeskRow
          icon={<TrendingUp size={16} />}
          label="Deals"
          value={`${liveCount} live deal${liveCount === 1 ? "" : "s"}. ${mission}`}
        />
        <DeskRow
          icon={<Brain size={16} />}
          label="Memory"
          value={memoryCount ? `${memoryCount} durable thing${memoryCount === 1 ? "" : "s"} learned about how to help you` : "Still learning how you like to work"}
        />
      </div>

      <div className="mt-3 border-t border-fg/6 pt-3">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-fg/42">What I am watching</div>
        <div className="mt-0.5 text-[13px] font-bold leading-snug text-fg/78">{watching}</div>
        <div className="mt-2 text-[12.5px] font-semibold leading-snug text-fg/55">{needed}</div>
      </div>
    </section>
  );
}

function DeskRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent2">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-fg/42">{label}</div>
        <div className="mt-0.5 line-clamp-2 text-[13px] font-bold leading-snug text-fg/78">{value}</div>
      </div>
    </div>
  );
}

function CoachCard({ ins }: { ins: Insight }) {
  const askIla = useAskIla();
  const icon = { money: <DollarSign size={18} />, push: <TrendingUp size={18} />, followup: <PhoneCall size={18} />, win: <Trophy size={18} />, pace: <ArrowUpRight size={18} /> }[ins.kind];
  const tone = ins.kind === "money" || ins.kind === "win" ? "text-good" : ins.kind === "followup" ? "text-accent2" : "text-accent";
  return (
    <button className="glass glass-tap flex w-full items-start gap-3 p-4 text-left" onClick={() => askIla(`You told me: "${ins.text}" — talk me through it. What exactly do I do next?`)}>
      <div className={`mt-0.5 shrink-0 ${tone}`}>{icon}</div><div className="text-[15px] leading-snug text-fg/85">{ins.text}</div>
    </button>
  );
}

function FastestCheckMove({ move, mission, unit }: { move?: NextTier; mission: string; unit: typeof INDUSTRY_UNIT[keyof typeof INDUSTRY_UNIT] }) {
  const askIla = useAskIla();
  const text = move ? localizeUnits(move.hint, unit) : mission;
  const value = move ? `+${money(move.addPay)}` : "Hold pace";
  const prompt = move
    ? `This is the best money opportunity on my Home page: "${text}" worth about +${money(move.addPay)}. Walk me through the first calm action today and explain the pay math behind it.`
    : `My Home page says the best next step is to hold pace with: "${mission}". Walk me through the first calm action today.`;

  return (
    <button className="glass living-ring rise mt-3 block w-full overflow-hidden p-5 text-left lg:col-span-2 lg:mt-0" onClick={() => askIla(prompt)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-good"><ArrowUpRight size={13} /> Best money opportunity</div>
          <div className="mt-2 text-[24px] font-black leading-tight text-fg">{text}</div>
        </div>
        <div className="shrink-0 rounded-2xl bg-good/12 px-3 py-2 text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-good/80">possible lift</div>
          <div className="text-2xl font-black tabnum text-good">{value}</div>
          {move?.addRatePct ? <div className="text-[11px] font-semibold text-good/80">+{move.addRatePct}% rate</div> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-fg/55">
        {move ? <span className="rounded-full bg-fg/6 px-2 py-0.5">{move.label}</span> : null}
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">{move ? "strongest money lift right now" : "best next step right now"}</span>
      </div>
    </button>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
function monthName() { return new Date().toLocaleString("en-US", { month: "long", year: "numeric" }); }
function localDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function displayTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h || 0, m || 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
