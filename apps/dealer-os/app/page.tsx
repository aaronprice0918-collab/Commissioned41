"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Calculator, Files, HandCoins, MessageSquareText, Sparkles, Target, TrendingUp, Trophy, UsersRound, X } from "lucide-react";
import { MissionMark, MissionLockup } from "@/components/BrandMarks";
import { MissionRing } from "@/components/MissionRing";
import { NextActionBar } from "@/components/NextActionBar";
import { Tilt } from "@/components/Tilt";
import { usePrivateChat } from "@/components/ChatProvider";
import { useCrmLeads, type CrmLead } from "@/components/CrmProvider";
import { useDeals } from "@/components/DealProvider";
import { useSalesGoals } from "@/components/GoalProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { currency, currentMonthPace, dailyNeed, financeLeaderboard, financeManagerNamesFromDeals, metricsFor, number, paceValue, salesLeaderboard, salespersonNamesFromDeals, samePerson, team, unitsLabel, type Deal } from "@/lib/data";
import { askIla } from "@/lib/askIla";
import { ExplainChip } from "@/components/ExplainChip";

// Numbers tick up to their value on load so the board feels alive, not static.
function useCountUp(target: number, duration = 1100) {
  const [val, setVal] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = ref.current;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      ref.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function salesUnitRows(deals: Deal[], salesGoals: Record<string, number>) {
  const names = Array.from(new Set([...team.filter((m) => m.role === "Sales").map((m) => m.name), ...salespersonNamesFromDeals(deals)]));
  return salesLeaderboard(deals, names)
    .map((row) => ({ name: row.name, units: row.units, goal: salesGoals[row.name] ?? team.find((m) => m.name === row.name)?.unitGoal ?? 0 }))
    .filter((row) => row.units > 0 || row.goal > 0);
}

export default function MissionControlPage() {
  const { deals, loaded: dealsLoaded } = useDeals();
  const { leads, loaded: leadsLoaded } = useCrmLeads();
  const boardsLoaded = dealsLoaded && leadsLoaded;
  const { sendMessage } = usePrivateChat();
  const { goals: salesGoals } = useSalesGoals();
  const { settings } = useStoreSettings();
  const [coachingSent, setCoachingSent] = useState(false);
  const [coachingArmed, setCoachingArmed] = useState(false);

  const frontGoal = settings.targets.frontEnd;
  const backGoal = settings.targets.backEnd;
  const storeGoal = settings.targets.pvrTotal;

  const metrics = metricsFor(deals);
  const pace = currentMonthPace(deals);
  const deliveredGoal = salesGoals.teamDeliveredUnits || settings.targets.deliveredUnits;
  // ONE definition store-wide: Total Gross = front + back + doc-fee income
  // (GM Command, Archive, and Group all use metrics.gross — this screen said
  // a different number for the same month).
  const totalGross = metrics.gross;

  const projectedUnits = paceValue(metrics.delivered, pace);
  const unitsPerDay = dailyNeed(deliveredGoal, metrics.delivered, pace.remainingDays);
  const frontPerDay = dailyNeed(frontGoal * deliveredGoal, metrics.front, pace.remainingDays);
  const backPerDay = dailyNeed(backGoal * deliveredGoal, metrics.back, pace.remainingDays);
  const totalPerDay = dailyNeed(storeGoal * deliveredGoal, totalGross, pace.remainingDays);

  const onPaceTarget = (deliveredGoal / pace.daysInMonth) * pace.elapsedDays;
  const aheadBy = metrics.delivered - onPaceTarget;
  const onPace = aheadBy >= 0;
  const unitPct = Math.min(Math.round((metrics.delivered / Math.max(deliveredGoal, 1)) * 100), 100);

  const leaders = salesUnitRows(deals, salesGoals.salespersonUnits);
  const topUnits = leaders[0]?.units || 0;

  // Animate in: count numbers up, grow bars from zero on mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);
  const cuDelivered = useCountUp(metrics.delivered);
  const cuTotal = useCountUp(totalGross);
  const cuFront = useCountUp(metrics.front);
  const cuBack = useCountUp(metrics.back);

  // The rep furthest behind pace — EILA's live read for the dashboard window.
  const behind = leaders
    .filter((r) => r.goal > 0)
    .map((r) => ({ ...r, need: dailyNeed(r.goal, r.units, pace.remainingDays), gap: r.goal - r.units }))
    .sort((a, b) => b.gap - a.gap)[0];

  // Full boards + sold-by-class for the drill-downs (click a number to open it).
  const repNames = Array.from(new Set([...team.filter((m) => m.role === "Sales").map((m) => m.name), ...salespersonNamesFromDeals(deals)]));
  const salesBoard = salesLeaderboard(deals, repNames);
  const fiNames = Array.from(new Set([...team.filter((m) => m.role === "F&I").map((m) => m.name), ...financeManagerNamesFromDeals(deals)]));
  const fiBoard = financeLeaderboard(deals, fiNames);
  const sold = deals.filter((d) => d.stage === "Delivered" || d.stage === "Funded");
  const classCounts = {
    New: sold.filter((d) => d.vehicleClass === "New").length,
    Used: sold.filter((d) => d.vehicleClass === "Used").length,
    Wholesale: sold.filter((d) => d.vehicleClass === "Wholesale").length,
  };

  // Live counts for the feature windows.
  const openUps = leads.filter((l) => !["Won", "Lost", "Dead"].includes(l.status)).length;
  const deskingCount = leads.filter((l) => /desk/i.test(l.status || "")).length;
  const pvr = metrics.delivered ? Math.round(totalGross / metrics.delivered) : 0;

  // A concrete, role-agnostic next action right under the hero.
  const localToday = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`; // LOCAL day, matching the local appointment strings
  const apptTodayCount = leads.filter((l) => l.appointment?.slice(0, 10) === localToday).length;
  const homeRead = `${openUps} active opportunit${openUps === 1 ? "y" : "ies"} on the floor · ${apptTodayCount} appointment${apptTodayCount === 1 ? "" : "s"} today · pacing ${number(projectedUnits, 0)} of ${deliveredGoal} units.`;
  const homeAction = apptTodayCount > 0
    ? { label: `Confirm ${apptTodayCount} appointment${apptTodayCount === 1 ? "" : "s"} today`, sub: "Confirmed appointments show", href: "/crm-desk" }
    : openUps > 0
      ? { label: `Work ${openUps} active opportunit${openUps === 1 ? "y" : "ies"}`, sub: "Move every up to a next step", href: "/crm-desk" }
      : { label: "Floor's clear — coach to pace", sub: "Set each rep's number for today", href: "/goals" };
  const homeTone: "green" | "amber" | "red" = onPace ? "green" : "amber";

  const [drill, setDrill] = useState<{ kind: "units" | "total" | "front" | "back" | "floor" | "desking" | "pvr" | "deals"; name?: string } | { kind: "rep"; name: string } | null>(null);

  function sendDailyCoaching() {
    leaders.forEach((row) => {
      const need = row.goal > 0 ? dailyNeed(row.goal, row.units, pace.remainingDays) : 0; // no goal = no invented 12-unit target
      sendMessage({
        from: "Manager:Daryl NeSmith",
        to: `Sales:${row.name}`,
        body: `${row.name}, you're at ${unitsLabel(row.units)}/${row.goal} for ${pace.monthName}. ${need > 0 ? `Today's mission: ${number(need, 1)} unit pace — one clean appointment, one strong walkaround, one disciplined follow-up.` : "You're ahead of pace — protect your leads and help the floor."}`,
      });
    });
    financeLeaderboard(deals, Array.from(new Set([...team.filter((m) => m.role === "F&I").map((m) => m.name), ...financeManagerNamesFromDeals(deals)]))).forEach((row) => {
      sendMessage({
        from: "Manager:Daryl NeSmith",
        to: `F&I:${row.name}`,
        body: `${row.name}, ${row.copies} copies so far this ${pace.monthName}. Keep every menu clean and protect product value on every classified deal.`,
      });
    });
    const bdc = team.find((m) => m.role === "BDC");
    const apptToday = leads.filter((l: CrmLead) => l.appointment?.slice(0, 10) === localToday).length;
    if (bdc) sendMessage({ from: "Manager:Daryl NeSmith", to: `Sales:${bdc.name}`, body: `${bdc.name}, ${apptToday} appointment${apptToday === 1 ? "" : "s"} on today's board. Keep the phones moving and the floor fed.` });
    setCoachingSent(true);
  }

  // The no-fake-zeros law: until the boards have actually been read, the
  // dashboard says it's reading — it never presents $0 / 0 units as the truth.
  if (!boardsLoaded) {
    return (
      <div className="relative mx-auto grid min-h-[60vh] max-w-6xl place-items-center pb-10">
        <div className="text-center">
          <MissionMark className="mx-auto h-10 w-10 animate-pulse" />
          <div className="mt-4 font-display text-xl font-black text-white">Reading the live board…</div>
          <div className="mt-1 text-sm text-white/50">Your numbers are on the way.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-6xl pb-10">
      <div className="relative z-10 space-y-3.5">
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">
          <MissionMark className="h-4 w-4" /> Mission Control · {pace.monthName}
          <span className="inline-flex items-center gap-1.5">· Live <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-mission-gold" /></span>
        </div>
      </div>

      {/* ── EILA — the hero window, watching the floor ─────────────────── */}
      <section className="living-border rise lg-glass relative overflow-hidden rounded-[26px] p-7 text-center sm:p-9">
        <span className="lg-blob" style={{ width: 300, height: 300, left: -80, top: -40, background: "radial-gradient(circle, rgba(40,110,200,0.28), transparent 66%)", animation: "lgBlob 16s ease-in-out infinite" }} aria-hidden />
        <span className="lg-blob" style={{ width: 260, height: 260, right: -70, top: 30, background: "radial-gradient(circle, rgba(96,150,255,0.18), transparent 66%)", animation: "lgBlob2 19s ease-in-out infinite" }} aria-hidden />
        <span className="lg-blob" style={{ width: 280, height: 280, left: "40%", bottom: -120, background: "radial-gradient(circle, rgba(40,110,200,0.2), transparent 66%)", animation: "lgBlob3 22s ease-in-out infinite" }} aria-hidden />

        <div className="relative">
          {/* Dealer Mission OS — "DEALER" eyebrow over the chrome M + MISSION mark.
              "Mission OS" is the platform family; this product is the dealer one.
              The eyebrow reads as part of the machined mark: steel text (white
              flips to ink on Sky) flanked by hairline rules, tucked to the M —
              not a colored label floating above it. */}
          <div className="flex items-center justify-center gap-3 font-display text-[12px] font-black uppercase text-white/55">
            <span className="h-px w-9 bg-current opacity-50" aria-hidden />
            <span className="tracking-[0.42em]" style={{ marginRight: "-0.42em" }}>Dealer</span>
            <span className="h-px w-9 bg-current opacity-50" aria-hidden />
          </div>
          <MissionLockup priority className="mx-auto mt-1 h-24 w-[200px] sm:h-28 sm:w-[240px]" />

          <div className="mx-auto mt-5 max-w-xl">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-mission-gold">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-mission-gold" /> EILA · watching the floor
            </div>
            <p className="mt-3 text-lg leading-relaxed text-white/90">
              {behind ? (
                <>Big run to make today — and you&apos;ve got the team to do it. <span className="text-white">{behind.name.split(" ")[0]}</span>&apos;s one good up from breaking out, and there&apos;s gross sitting on this floor with your name on it. Let&apos;s go take it — I&apos;m on every deal with you.</>
              ) : (
                <>You&apos;re rolling — pacing <span className="text-white">{number(projectedUnits, 0)} units</span> with clean numbers. This is what a winning month feels like. Keep the foot down; I&apos;ve got every deal covered.</>
              )}
            </p>
            <div className="mt-4 flex h-5 items-end justify-center gap-1" aria-hidden>
              {[7, 15, 10, 17, 9, 13, 8].map((h, i) => (
                <span key={i} className="lg-wb" style={{ height: h, animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                if (coachingSent) return;
                if (!coachingArmed) { setCoachingArmed(true); return; }
                sendDailyCoaching();
              }}
              onBlur={() => setCoachingArmed(false)}
              className="lift mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-mission-navy hover:brightness-95"
            >
              {coachingSent ? "Push sent" : coachingArmed ? `Send to ${leaders.length} ${leaders.length === 1 ? "inbox" : "inboxes"} — tap to confirm` : "Draft the push"} <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {/* The pulse — your store's vitals. Tap-to-explain: each vital hands off
              to EILA to walk the real math behind it. */}
          <div className="relative mx-auto mt-8 flex max-w-md items-center justify-between gap-4 rounded-[20px] border border-white/10 bg-white/[0.03] p-5">
            <button
              type="button"
              onClick={() => askIla("Explain the store's delivered-units pace — walk the real math in plain words: where we sit against the month's goal, the projected finish from today's pace, and who's driving or dragging it.")}
              className="flex flex-col items-center gap-1.5"
            >
              <MissionRing pct={unitPct} size={72} stroke={6}>
                <div className="text-center leading-none">
                  <div className="font-display text-xl font-black tabular-nums text-white">{Math.round(cuDelivered)}</div>
                  <div className="text-[9px] font-semibold text-white/40">/ {deliveredGoal}</div>
                </div>
              </MissionRing>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Units · {unitPct}%</div>
            </button>
            <svg viewBox="0 0 160 26" className="h-7 flex-1" preserveAspectRatio="none" aria-hidden>
              <line x1="0" y1="13" x2="160" y2="13" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              <path d="M0 13 H60 l5 -8 l6 16 l5 -8 H108 l4 -4 l4 4 H160" fill="none" stroke="rgb(var(--mission-gold))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="40 150" style={{ animation: "lgDash 3s linear infinite", filter: "drop-shadow(0 0 5px rgb(var(--mission-gold) / 0.7))" }} />
            </svg>
            <button
              type="button"
              onClick={() => askIla("Explain the store's total gross number — walk the real math in plain words: front vs back, which deals are carrying it, and where we're leaving money. If it looks off, find which input is wrong.")}
              className="text-right"
            >
              <div className="font-display text-4xl font-black tabular-nums text-mission-gold">{currency(Math.round(cuTotal))}</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Total Gross</div>
            </button>
          </div>

          {/* The team — points of light */}
          {leaders.length > 0 && (
            <div className="mt-7 flex flex-wrap items-end justify-center gap-x-6 gap-y-3">
              {leaders.slice(0, 7).map((r) => {
                const top = topUnits > 0 && r.units === topUnits;
                return (
                  <div key={r.name} className="flex flex-col items-center gap-1.5">
                    <span className="lg-pt h-[7px] w-[7px] rounded-full" style={{ background: "rgb(var(--mission-gold))", boxShadow: top ? "0 0 12px rgb(var(--mission-gold))" : undefined, opacity: top ? 1 : 0.55 }} />
                    <span className="text-[11px] text-white/55">{r.name.split(" ")[0]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* The one move that matters right now — concrete, one tap into the work. */}
      <NextActionBar read={homeRead} action={homeAction} tone={homeTone} />

      {/* ── The feature wall — glass windows, tap to open into detail; every
             computed number carries an "ask EILA why" tap-to-explain chip ────── */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        {/* Tap = the LIST of those exact opportunities (Aaron: "when I touch the
            21 it should give me the 21 people"), not a hop to a screen whose
            cards count today-only and read zero. */}
        <FeatureWindow i={0} icon={UsersRound} label="The Floor" value={`${openUps}`} sub="working" onClick={() => setDrill({ kind: "floor" })} explain="Explain The Floor number — which opportunities count as working right now, and who needs a touch first?" />
        <FeatureWindow i={1} icon={Calculator} label="Desking" value={`${deskingCount}`} sub="on the desk" onClick={() => setDrill({ kind: "desking" })} explain="Explain the Desking count — who's on the desk right now and where does each deal stand?" />
        <FeatureWindow i={2} icon={HandCoins} label="Store PVR" value={currency(pvr)} onClick={() => setDrill({ kind: "pvr" })} explain="Explain our store PVR — walk the real math in plain words (total gross over delivered units), how front and back split it, and the fix if it's light." />
        <FeatureWindow i={3} icon={Target} label="Goals · Pace" value={`${unitPct}%`} bar={unitPct} onClick={() => setDrill({ kind: "units" })} explain="Explain our goal-pace percentage — walk the real math in plain words and tell me straight whether we hit the month at this pace." />
        <FeatureWindow i={4} icon={TrendingUp} label="Total Gross" value={currency(Math.round(cuTotal))} onClick={() => setDrill({ kind: "total" })} explain="Explain the store's total gross — front vs back, which deals are carrying it, and where we're leaving money. If it looks off, find which input is wrong." />
        <FeatureWindow i={5} icon={Files} label="Deals" value={`${deals.length}`} sub="on the board" onClick={() => setDrill({ kind: "deals" })} explain="Explain this month's deal count — what's in it (delivered, funded, working) and flag anything that looks miscounted." />
      </div>

      {/* Units leaderboard (units only — gross stays private in My Scorecard) */}
      <section className="rise lg-glass rounded-[22px] p-6" style={{ animationDelay: "120ms" }}>
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Trophy className="h-5 w-5 text-mission-gold" />
            <h2 className="font-display text-xl font-black text-white">Units Board</h2>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">{pace.monthName} · Units only</div>
        </div>

        {leaders.length === 0 ? (
          <div className="py-10 text-center text-sm text-white/50">No delivered units yet this month.</div>
        ) : (
          <div className="space-y-1.5">
            {leaders.map((row, idx) => {
              const pct = Math.round((row.units / Math.max(topUnits, 1)) * 100);
              const hitGoal = row.goal > 0 && row.units >= row.goal;
              return (
                <button type="button" key={row.name} onClick={() => setDrill({ kind: "rep", name: row.name })} className="group grid w-full grid-cols-[28px_1fr_auto] items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition hover:bg-white/[0.06]">
                  <div className={`text-center font-display text-sm font-black ${idx === 0 ? "text-mission-gold" : "text-white/35"}`}>{idx + 1}</div>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-semibold text-white">{row.name}</span>
                      <span className="shrink-0 text-sm text-white/45">{row.goal ? `goal ${row.goal}` : ""}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div className={`meter-fill h-full rounded-full ${hitGoal ? "bg-mission-green" : "bg-mission-gold/55"}`} style={{ width: `${mounted ? pct : 0}%`, transitionDelay: `${idx * 80}ms` }} />
                    </div>
                  </div>
                  <div className="text-right font-display text-2xl font-black tabular-nums text-white">{unitsLabel(row.units)}</div>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-5 border-t border-white/8 pt-4 text-xs leading-5 text-white/40">
          Front, back, total gross, and pay are private — each person sees their own breakdown in <span className="text-white/60">My Scorecard</span>.
        </p>
      </section>
      </div>

      <DrillOverlay
        drill={drill}
        onClose={() => setDrill(null)}
        sold={sold}
        allDeals={deals}
        classCounts={classCounts}
        front={metrics.front}
        back={metrics.back}
        totalGross={totalGross}
        salesBoard={salesBoard}
        fiBoard={fiBoard}
        leads={leads}
        salesGoals={salesGoals.salespersonUnits}
        pace={pace}
        onNudge={(to, body) => sendMessage({ from: "Manager:Daryl NeSmith", to, body })}
      />
    </div>
  );
}

// A glass feature-window: lit panel that pops forward, tap to open into detail
// (navigate to its page, or open a drill-down overlay). With an `explain`
// prompt, the number also carries an "ask EILA why" chip — the wrapper becomes a
// div role="button" then, since a real button/link can't contain the chip.
function FeatureWindow({ i, icon: Icon, label, value, sub, bar, href, onClick, explain }: { i: number; icon: typeof Target; label: string; value: string; sub?: string; bar?: number; href?: string; onClick?: () => void; explain?: string }) {
  const router = useRouter();
  const inner = (
    <>
      <span className="absolute right-3.5 top-3.5 text-mission-gold/60 transition group-hover:text-mission-gold"><ArrowUpRight className="h-4 w-4" /></span>
      <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-mission-gold/30 bg-mission-gold/10 text-mission-gold">
        <Icon className="h-5 w-5" />
      </span>
      <div className="mt-3.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</div>
      <div className="mt-1 font-display text-3xl font-black leading-none tracking-tight tabular-nums text-white">
        {value}{sub ? <span className="ml-1 text-base font-bold text-white/40">{sub}</span> : null}
      </div>
      {bar != null ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="meter-fill h-full rounded-full bg-mission-gold" style={{ width: `${Math.min(bar, 100)}%`, boxShadow: "0 0 8px rgb(var(--mission-gold))" }} />
        </div>
      ) : null}
      {explain && <ExplainChip prompt={explain} className="mt-2.5 block" />}
    </>
  );
  const cls = "group rise lg-glass glass-tactile relative block overflow-hidden rounded-[18px] p-4 text-left transition hover:-translate-y-0.5";
  const style = { animationDelay: `${i * 60}ms` };
  if (explain) {
    const go = href ? () => router.push(href) : onClick;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && go) { e.preventDefault(); go(); } }}
        className={`${cls} w-full cursor-pointer`}
        style={style}
      >
        {inner}
      </div>
    );
  }
  return href
    ? <Link href={href} className={cls} style={style}>{inner}</Link>
    : <button type="button" onClick={onClick} className={`${cls} w-full`} style={style}>{inner}</button>;
}

type SalesRow = { name: string; units: number; frontGross: number; backGross: number; totalGross: number; pvr: number; ppu: number };
type FiRow = { name: string; copies: number; backGross: number; pvr: number; ppu: number; products: number };

function BarRow({ label, value, pct, sub, tone = "gold" }: { label: string; value: string; pct: number; sub?: string; tone?: "gold" | "green" | "red" }) {
  const bar = tone === "green" ? "bg-mission-green" : tone === "red" ? "bg-mission-red" : "bg-mission-gold/80";
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-36 shrink-0 truncate text-sm text-white/80">{label}{sub ? <span className="ml-1 text-white/35">· {sub}</span> : null}</div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8"><div className={`meter-fill h-full rounded-full ${bar}`} style={{ width: `${Math.max(Math.min(pct, 100), 2)}%` }} /></div>
      <div className="glass-num w-24 shrink-0 text-right font-display text-sm font-black tabular-nums">{value}</div>
    </div>
  );
}

// Glowing neon divider that brackets each vehicle-class group in the units list.
function NeonGroupHeader({ label, count, tone }: { label: string; count: number; tone: "gold" | "green" }) {
  const rgb = tone === "green" ? "var(--mission-green)" : "var(--mission-gold)";
  const lineStyle: React.CSSProperties = {
    background: `linear-gradient(90deg, transparent, rgb(${rgb} / 0.9), transparent)`,
    boxShadow: `0 0 10px rgb(${rgb} / 0.55)`,
  };
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="neon-rule h-[2px] flex-1 rounded-full" style={lineStyle} />
      <span
        className="shrink-0 text-[11px] font-black uppercase tracking-[0.2em]"
        style={{ color: `rgb(${rgb})`, textShadow: `0 0 12px rgb(${rgb} / 0.7)` }}
      >
        {label} · {count}
      </span>
      <span className="neon-rule h-[2px] flex-1 rounded-full" style={lineStyle} />
    </div>
  );
}

function EILANote({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-mission-gold/25 bg-mission-gold/[0.06] p-3.5">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 glass-accent" />
      <p className="text-sm leading-6 text-white/75">{text}</p>
    </div>
  );
}

function DrillOverlay({ drill, onClose, sold, allDeals, classCounts, front, back, totalGross, salesBoard, fiBoard, leads, salesGoals, pace, onNudge }: {
  drill: { kind: string; name?: string } | null;
  onClose: () => void;
  sold: Deal[];
  allDeals: Deal[];
  classCounts: { New: number; Used: number; Wholesale: number };
  front: number;
  back: number;
  totalGross: number;
  salesBoard: SalesRow[];
  fiBoard: FiRow[];
  leads: CrmLead[];
  salesGoals: Record<string, number>;
  pace: ReturnType<typeof currentMonthPace>;
  onNudge: (to: string, body: string) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!drill) return null;

  let title = "";
  let content: ReactNode = null;

  if (drill.kind === "floor") {
    // The exact people behind the number — same predicate as the card's count.
    const open = leads.filter((l) => !["Won", "Lost", "Dead"].includes(l.status));
    title = `The Floor — ${open.length} working opportunit${open.length === 1 ? "y" : "ies"}`;
    content = (
      <>
        <div className="space-y-1">
          {open.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-white/[0.04]">
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-white/90">{l.customer || "—"}</span>
                <span className="block truncate text-xs text-white/45">
                  {[l.vehicle, l.salesperson].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/60">
                {l.status}
              </span>
            </div>
          ))}
          {open.length === 0 && <div className="px-3 py-6 text-sm text-white/45">Nothing working right now.</div>}
        </div>
        <Link
          href="/crm-desk"
          className="lift mt-5 inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.1em] text-mission-navy shadow-gold hover:brightness-110"
        >
          <UsersRound className="h-4 w-4" /> Work the floor in Showroom
        </Link>
      </>
    );
  }

  if (drill.kind === "desking") {
    // The exact people behind the number — same predicate as the card's count.
    const atDesk = leads.filter((l) => /desk/i.test(l.status || ""));
    title = `Desking — ${atDesk.length} on the desk`;
    content = (
      <>
        <div className="space-y-1">
          {atDesk.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-white/[0.04]">
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-white/90">{l.customer || "—"}</span>
                <span className="block truncate text-xs text-white/45">{[l.vehicle, l.salesperson].filter(Boolean).join(" · ") || "—"}</span>
              </span>
              <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/60">{l.status}</span>
            </div>
          ))}
          {atDesk.length === 0 && <div className="px-3 py-6 text-sm text-white/45">Nobody on the desk right now.</div>}
        </div>
        <Link href="/desking" className="lift mt-5 inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.1em] text-mission-navy shadow-gold hover:brightness-110">
          <Calculator className="h-4 w-4" /> Open the Desk
        </Link>
      </>
    );
  }

  if (drill.kind === "pvr") {
    // SAME math as the card: retail delivered only. Wholesale sold units used
    // to inflate the divisor here, so the drill printed a different PVR than
    // the card it explains.
    const delivered = sold.filter((d) => d.vehicleClass !== "Wholesale").length;
    const pvrNow = delivered ? Math.round(totalGross / delivered) : 0;
    const max = Math.max(front, back, 1);
    const dealDoc = (d: { docFee?: number }) => (typeof d.docFee === "number" ? d.docFee : 0);
    const byGross = sold
      .filter((d) => d.vehicleClass !== "Wholesale")
      .sort((a, b) => (b.frontGross + b.backGrossReserve + dealDoc(b)) - (a.frontGross + a.backGrossReserve + dealDoc(a)));
    title = "Store PVR — the math behind it";
    content = (
      <>
        <div className="text-sm text-white/70">
          {currency(totalGross)} total gross ÷ {delivered} delivered = <span className="font-black text-white">{currency(pvrNow)}</span> per vehicle.
        </div>
        <div className="mt-3 space-y-1">
          <BarRow label="Back-end (F&I)" value={currency(back)} pct={(Math.max(back, 0) / max) * 100} tone="green" />
          <BarRow label="Front-end (sales)" value={currency(front)} pct={(Math.max(front, 0) / max) * 100} />
        </div>
        <div className="mt-5 mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/40">Every delivered deal, biggest gross first</div>
        <div className="space-y-1">
          {byGross.map((d) => (
            <Link key={d.id} href={`/deal-entry?id=${d.id}`} className="group flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors hover:bg-white/[0.06]">
              <span className="truncate text-white/85 group-hover:text-white">{d.customer || "—"}</span>
              <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-white/45">
                {currency(d.frontGross + d.backGrossReserve + (typeof d.docFee === "number" ? d.docFee : 0))}
                <ArrowRight className="h-3.5 w-3.5 text-mission-gold/0 transition group-hover:text-mission-gold/70" />
              </span>
            </Link>
          ))}
        </div>
        <Link href="/finance-command" className="lift mt-5 inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.1em] text-mission-navy shadow-gold hover:brightness-110">
          <HandCoins className="h-4 w-4" /> Open Finance Command
        </Link>
      </>
    );
  }

  if (drill.kind === "deals") {
    // Finalized vs working — never blended (same split as Deal Center).
    const finalized = allDeals.filter((d) => d.stage === "Delivered" || d.stage === "Funded");
    const working = allDeals.filter((d) => d.stage !== "Delivered" && d.stage !== "Funded");
    const row = (d: Deal) => (
      <Link key={d.id} href={`/deal-entry?id=${d.id}`} className="group flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors hover:bg-white/[0.06]">
        <span className="truncate text-white/85 group-hover:text-white">{d.customer || "—"}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-white/45">
          {d.salesperson || "—"}
          <ArrowRight className="h-3.5 w-3.5 text-mission-gold/0 transition group-hover:text-mission-gold/70" />
        </span>
      </Link>
    );
    title = `Deals this month — ${allDeals.length}`;
    content = (
      <>
        {finalized.length > 0 && (
          <div className="mt-1">
            <NeonGroupHeader label="Finalized" count={finalized.length} tone="green" />
            <div className="space-y-1">{finalized.map(row)}</div>
          </div>
        )}
        {working.length > 0 && (
          <div className="mt-3">
            <NeonGroupHeader label="Working" count={working.length} tone="gold" />
            <div className="space-y-1">{working.map(row)}</div>
          </div>
        )}
        {allDeals.length === 0 && <div className="px-3 py-6 text-sm text-white/45">No deals on the board yet.</div>}
        <Link href="/deal-center" className="lift mt-5 inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.1em] text-mission-navy shadow-gold hover:brightness-110">
          <Files className="h-4 w-4" /> Open Deal Center
        </Link>
      </>
    );
  }

  if (drill.kind === "units") {
    title = "Units — where they're coming from";
    const max = Math.max(classCounts.New, classCounts.Used, classCounts.Wholesale, 1);
    // Group the list all-New, then all-Used, then Wholesale (not blended).
    const classRank: Record<string, number> = { New: 0, Used: 1, Wholesale: 2 };
    const orderedSold = [...sold].sort((a, b) => (classRank[a.vehicleClass] ?? 9) - (classRank[b.vehicleClass] ?? 9));
    content = (
      <>
        <div className="space-y-1">
          <BarRow label="New" value={`${classCounts.New}`} pct={(classCounts.New / max) * 100} />
          <BarRow label="Used" value={`${classCounts.Used}`} pct={(classCounts.Used / max) * 100} tone="green" />
          {classCounts.Wholesale > 0 ? <BarRow label="Wholesale" value={`${classCounts.Wholesale}`} pct={(classCounts.Wholesale / max) * 100} /> : null}
        </div>
        <div className="mt-5 mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/40">All delivered deals ({sold.length}) — the ring counts {sold.length - classCounts.Wholesale} retail{classCounts.Wholesale > 0 ? ` + ${classCounts.Wholesale} wholesale (not in the ring)` : ""}</div>
        {(["New", "Used", "Wholesale"] as const).map((cls) => {
          const group = orderedSold.filter((d) => d.vehicleClass === cls);
          if (!group.length) return null;
          return (
            <div key={cls} className="mt-2">
              <NeonGroupHeader label={cls} count={group.length} tone={cls === "Used" ? "green" : "gold"} />
              <div className="space-y-1">
                {group.map((d) => (
                  <Link
                    key={d.id}
                    href={`/deal-entry?id=${d.id}`}
                    className="group flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors hover:bg-white/[0.06]"
                  >
                    <span className="truncate text-white/85 group-hover:text-white">{d.customer || "—"}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-white/45">
                      {d.salesperson || "—"}
                      <ArrowRight className="h-3.5 w-3.5 text-mission-gold/0 transition group-hover:text-mission-gold/70" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </>
    );
  } else if (drill.kind === "total") {
    title = "Total gross — where it's coming from";
    const max = Math.max(front, back, 1);
    const topFi = [...fiBoard].sort((a, b) => b.backGross - a.backGross)[0];
    content = (
      <>
        <BarRow label="Back-end (F&I)" value={currency(back)} pct={(back / max) * 100} tone="green" />
        <BarRow label="Front-end (sales)" value={currency(front)} pct={(Math.max(front, 0) / max) * 100} />
        <div className="mt-3 text-sm text-white/55">Total {currency(totalGross)} this month.</div>
        {topFi && topFi.backGross > 0 ? <EILANote text={`Most of your gross is back-end — ${topFi.name} is driving it at ${currency(topFi.backGross)} across ${topFi.copies} copies. Tap Back Gross to see the whole F&I board.`} /> : null}
      </>
    );
  } else if (drill.kind === "front") {
    title = "Front gross — by salesperson";
    const rows = [...salesBoard].filter((r) => r.frontGross !== 0).sort((a, b) => b.frontGross - a.frontGross);
    const max = Math.max(...rows.map((r) => Math.abs(r.frontGross)), 1);
    content = (
      <div className="space-y-1">
        {rows.map((r) => <BarRow key={r.name} label={r.name} value={currency(r.frontGross)} pct={(Math.abs(r.frontGross) / max) * 100} tone={r.frontGross < 0 ? "red" : "gold"} />)}
        {rows.length === 0 ? <div className="py-6 text-center text-sm text-white/50">No front gross recorded yet.</div> : null}
      </div>
    );
  } else if (drill.kind === "back") {
    title = "Back gross — by F&I manager";
    const rows = [...fiBoard].filter((r) => r.copies > 0).sort((a, b) => b.backGross - a.backGross);
    const max = Math.max(...rows.map((r) => r.backGross), 1);
    content = (
      <>
        <div className="space-y-1">
          {rows.map((r) => <BarRow key={r.name} label={r.name} value={currency(r.backGross)} pct={(r.backGross / max) * 100} sub={`${r.copies} copies · ${r.ppu.toFixed(1)} PPU`} tone="green" />)}
        </div>
        {rows[0] ? <EILANote text={`${rows[0].name} is your back-end engine at ${currency(rows[0].backGross)} (${rows[0].ppu.toFixed(1)} PPU). If a deal needs more back-end, that's who's holding gross right now.`} /> : null}
      </>
    );
  } else if (drill.kind === "rep") {
    // Guarded to "rep" — a bare else here would overwrite the floor/desking/
    // pvr/deals drill content composed by the standalone branches above.
    const name = drill.name || "";
    const r = salesBoard.find((x) => samePerson(x.name, name));
    const goal = salesGoals[name] ?? team.find((m) => m.name === name)?.unitGoal ?? 0;
    const units = r?.units ?? 0;
    // No goal set = no invented pace math (the old "|| 12" fabricated a
    // 12-unit goal for reps with none and told them they were behind it).
    const need = goal > 0 ? dailyNeed(goal, units, pace.remainingDays) : 0;
    const myLeads = leads.filter((l) => samePerson(l.salesperson || "", name));
    const open = myLeads.filter((l) => !["Won", "Lost"].includes(l.status));
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const appts = myLeads.filter((l) => (l.appointment || "").slice(0, 10) === todayKey);
    const onPaceRep = units >= (goal / Math.max(pace.daysInMonth, 1)) * pace.elapsedDays;
    const insight = onPaceRep
      ? `${name} is on pace at ${unitsLabel(units)}/${goal}. Keep them protecting gross and feeding the desk — they're a good one to pair with a rep who's slipping.`
      : `${name} is behind — ${unitsLabel(units)}/${goal}, needs ${number(need, 1)}/day to land. ${open.length} open up${open.length === 1 ? " needs" : "s need"} a next action${appts.length ? `, ${appts.length} appointment${appts.length === 1 ? "" : "s"} today to confirm` : ""}. Coaching: get them asking for the desk turn early and don't let a customer drift.`;
    title = `${name} — live action report`;
    content = (
      <>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { l: "Units", v: `${unitsLabel(units)}/${goal}` },
            { l: "Need/day", v: number(need, 1) },
            { l: "Open ups", v: `${open.length}` },
            { l: "Appts today", v: `${appts.length}` },
          ].map((s) => (
            <div key={s.l} className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">{s.l}</div>
              <div className="glass-num mt-1 font-display text-xl font-black">{s.v}</div>
            </div>
          ))}
        </div>
        <EILANote text={insight} />
        {open.length > 0 ? (
          <>
            <div className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/40">Open ups to work</div>
            <div className="space-y-1">
              {open.slice(0, 6).map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm hover:bg-white/[0.04]">
                  <span className="truncate text-white/85">{l.customer || "—"}</span>
                  <span className="shrink-0 text-white/45">{l.status}{l.nextAction ? ` · ${l.nextAction}` : ""}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => { onNudge(`Sales:${name}`, insight); onClose(); }}
          className="lift mt-5 inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.1em] text-mission-navy shadow-gold hover:brightness-110"
        >
          <MessageSquareText className="h-4 w-4" /> Send {name.split(" ")[0]} this nudge
        </button>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div className="rise glass-panel relative z-10 flex w-full max-w-lg flex-col overflow-hidden p-6" style={{ maxHeight: "84vh" }}>
        <span className="glass-sweep" aria-hidden />
        <div className="relative flex items-start justify-between gap-4">
          <h3 className="glass-num font-display text-xl font-black leading-tight">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 text-white/60 transition hover:border-white/35 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="relative mt-5 overflow-y-auto">{content}</div>
      </div>
    </div>
  );
}
