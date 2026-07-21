 "use client";

import { useState } from "react";
import { BadgeDollarSign, Banknote, ChevronRight, CircleDollarSign, ShieldCheck } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { DealsModal } from "@/components/DealsModal";
import { NextActionBar } from "@/components/NextActionBar";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { useSalesGoals } from "@/components/GoalProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { countsTowardFinance, currency, displayPersonName, financeManagerBoard, isCountableFinance, isCountableRetail, isHouseBucketName, metricsFor, samePerson, type Deal } from "@/lib/data";
import { askIla } from "@/lib/askIla";

export default function FinanceCommandPage() {
  const { deals } = useDeals();
  const { settings } = useStoreSettings();
  // THIS store's configured finance managers — not every name that lands on a
  // deal's financeManager field. Per-org via TeamProvider (the caller's `team`
  // store key); no hardcoded Kennesaw roster, so a second tenant's F&I Report
  // shows its own managers, never Kennesaw's. House/unassigned buckets stay in
  // the roster (for attribution) but don't earn a per-manager scorecard card.
  const { financeManagers } = useTeamLists();
  const financeManagerNames = financeManagers.filter((name) => !isHouseBucketName(name));
  const backGoal = settings.targets.backEnd;
  // Per-manager PVR/PPU targets (Goal Setup page) raise the bar person by
  // person; anyone without one is judged against the store-wide target.
  const { goals } = useSalesGoals();
  const pvrGoalFor = (name: string) => goals.financeTargets?.[name]?.pvr || backGoal;
  // Same default as the Goals page (store ppuMinimum) — one bar, two screens.
  const ppuGoalFor = (name: string) => goals.financeTargets?.[name]?.ppu || settings.targets.ppuMinimum || 0;
  const metrics = metricsFor(deals);
  const classifiedDeals = deals.filter(isCountableFinance);
  const protectedDeals = deals.filter((deal) => isCountableRetail(deal) && !countsTowardFinance(deal));
  const fmStats = financeManagerBoard(deals, financeManagerNames);
  const [drill, setDrill] = useState<{ title: string; subtitle?: string; deals: Deal[] } | null>(null);

  // EILA read: where back PVR sits, who's under goal, what's leaking gross.
  const underGoal = fmStats.filter((fm) => fm.deals > 0 && (fm.pvr < pvrGoalFor(fm.name) || (ppuGoalFor(fm.name) > 0 && fm.ppu < ppuGoalFor(fm.name))));
  const productMissing = metrics.productMissing || 0;
  const fiRead =
    `Back PVR is ${currency(metrics.backPvr)} vs ${currency(backGoal)} goal. ` +
    `${underGoal.length ? `${underGoal.length} manager${underGoal.length === 1 ? " is" : "s are"} under goal — ${underGoal.map((fm) => displayPersonName(fm.name)).slice(0, 2).join(", ")}${underGoal.length > 2 ? ` +${underGoal.length - 2}` : ""}.` : "Every manager is at goal."}` +
    `${productMissing ? ` ${productMissing} classified deal${productMissing === 1 ? "" : "s"} still need product entry.` : ""}`;
  const fiAction = productMissing
    ? { label: `Enter products on ${productMissing} deal${productMissing === 1 ? "" : "s"}`, sub: "Unlogged products = hidden gross", href: "/deal-center" }
    : underGoal.length
      ? { label: `Coach ${displayPersonName(underGoal[0].name)}`, sub: `${currency(Math.max(pvrGoalFor(underGoal[0].name) - underGoal[0].pvr, 0))} under their PVR bar`, href: "/finance-desk" }
      : { label: "F&I is on target — keep the menu clean", sub: "Full presentation on every classified deal", href: "/finance-desk" };
  const fiTone: "red" | "amber" | "green" = productMissing || underGoal.length ? "amber" : "green";

  return (
    <div>
      <SectionHeader title="F&I Report" kicker="Fair accountability logic" />
      <div className="mb-5"><NextActionBar read={fiRead} action={fiAction} tone={fiTone} /></div>
      {/* Tap-to-explain: the card drills into its deals; "ask EILA why" walks the math. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Back PVR" value={currency(metrics.backPvr)} detail={`Goal ${currency(backGoal)} — tap`} tone={metrics.backPvr >= backGoal ? "green" : "red"} onClick={() => setDrill({ title: "Finance Deals", subtitle: "Back PVR", deals: classifiedDeals })} onExplain={() => askIla("Explain our Back PVR number — walk the real math in plain words (back gross over finance deals), what's dragging it against the goal, and the fix. If it looks off, find which input is wrong.")} />
        <MetricCard label="Finance Deals" value={`${classifiedDeals.length}`} detail="Count toward F&I — tap" tone="gold" onClick={() => setDrill({ title: "Finance Deals", deals: classifiedDeals })} onExplain={() => askIla("Explain our Finance Deals count — every deal qualifies against F&I unless it's marked DNQ (cash included, per the store rule), so flag anything marked wrong.")} />
        <MetricCard label="Protected" value={`${protectedDeals.length}`} detail="DNQ only — tap" tone="blue" onClick={() => setDrill({ title: "Protected", subtitle: "DNQ", deals: protectedDeals })} onExplain={() => askIla("Explain our Protected count — the DNQ deals and why they don't count against F&I. Cash deals DO count unless marked DNQ; flag any misclassified.")} />
        <MetricCard label="Finance Gross" value={currency(metrics.financeGross)} detail="Finance deals only — tap" tone="green" onClick={() => setDrill({ title: "Finance Deals", subtitle: "Finance gross", deals: classifiedDeals })} onExplain={() => askIla("Explain our Finance Gross number — walk the real math in plain words, which deals it comes from, and where we're leaving money on the table. If it looks off, find which input is wrong.")} />
      </div>
      <section className="mt-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-black text-white">By Finance Manager</h2>
          <span className="text-xs uppercase tracking-[0.14em] text-white/45">Month to date</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-5">
          {fmStats.map((fm) => {
            const fmPvrGoal = pvrGoalFor(fm.name);
            const fmPpuGoal = ppuGoalFor(fm.name);
            const hitGoal = fm.pvr >= fmPvrGoal;
            const ppuHit = !fmPpuGoal || fm.ppu >= fmPpuGoal;
            const cells = [
              { label: "Deals", value: `${fm.deals}`, accent: "text-white" },
              { label: "Back Gross", value: currency(fm.backGross), accent: "text-mission-green" },
              { label: "Products", value: `${fm.products}`, accent: "text-mission-gold" },
              { label: fmPpuGoal ? `PPU · goal ${fmPpuGoal.toFixed(2)}` : "PPU", value: fm.ppu.toFixed(2), accent: ppuHit ? "text-white" : "text-mission-red" },
            ];
            const openDrill = () => setDrill({ title: displayPersonName(fm.name), subtitle: "Finance Manager", deals: deals.filter((d) => samePerson(d.financeManager, fm.name)) });
            return (
              // div + role="button" (not <button>): the tap-to-explain chip is a
              // nested tap target, and a real button can't legally contain one.
              <div key={fm.name} role="button" tabIndex={0} onClick={openDrill}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrill(); } }}
                className="glass-card cursor-pointer rounded-[12px] p-5 text-left transition hover:border-mission-gold/30">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-xl font-black text-white">{displayPersonName(fm.name)}</div>
                    <div className="text-xs uppercase tracking-[0.14em] text-white/45">Finance Manager</div>
                  </div>
                  <StatusPill tone={hitGoal ? "green" : "red"}>{currency(fm.pvr)} PVR</StatusPill>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  {cells.map((cell) => (
                    <div key={cell.label}>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-white/45">{cell.label}</div>
                      <div className={`mt-1 font-display text-xl font-black sm:text-2xl ${cell.accent}`}>{cell.value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/8 pt-3 text-xs text-white/45">
                  <span>{fm.financeDeals}/{fm.deals} finance · back gross incl. cash · PVR goal {currency(fmPvrGoal)}{goals.financeTargets?.[fm.name]?.pvr ? " (personal)" : ""} · {hitGoal ? "on target" : `${currency(fmPvrGoal - fm.pvr)} under`}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); askIla(`Explain ${displayPersonName(fm.name)}'s F&I month — walk the real math in plain words: PVR, PPU, and products against the goal, and the one move that raises it. If a number looks off, find which input is wrong.`); }}
                    className="shrink-0 text-[10px] font-black uppercase tracking-[0.18em] text-white/30 transition hover:text-mission-gold"
                  >
                    ask EILA why
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {/* Glossary, tucked behind a disclosure — reference, not permanent clutter. */}
      <details className="group mt-5">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/45 transition hover:text-white/70">
          <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" /> How F&I counts
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { icon: ShieldCheck, title: "Finance", copy: "A real finance deal — counts toward F&I penetration." },
            { icon: Banknote, title: "Cash", copy: "Counts as a unit, but not against F&I penetration." },
            { icon: CircleDollarSign, title: "DNQ", copy: "Did not qualify — does not hurt F&I performance." },
            { icon: BadgeDollarSign, title: "Product Math", copy: "VSC, GAP, Maintenance, Permaplate, and TWS count as 1 each. UTP counts as 5." },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="glass-card rounded-[12px] p-5">
                <Icon className="h-6 w-6 text-mission-gold" />
                <div className="mt-4 font-display text-lg font-black text-white">{item.title}</div>
                <p className="mt-2 text-sm leading-6 text-white/60">{item.copy}</p>
              </div>
            );
          })}
        </div>
      </details>

      {drill && <DealsModal title={drill.title} subtitle={drill.subtitle} deals={drill.deals} onClose={() => setDrill(null)} />}
    </div>
  );
}
