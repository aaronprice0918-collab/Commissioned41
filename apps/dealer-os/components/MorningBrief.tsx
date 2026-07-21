"use client";

import Link from "next/link";
import { ArrowRight, Sun } from "lucide-react";
import { useDeals } from "@/components/DealProvider";
import { useCrmLeads } from "@/components/CrmProvider";
import { useSalesGoals } from "@/components/GoalProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { useAuth } from "@/components/AuthProvider";
import { isAtRisk } from "@/lib/leadScore";
import {
  currency,
  currentMonthPace,
  dailyNeed,
  displayFullPersonName,
  isCountableRetail,
  isSold,
  number,
  paceValue,
  salespersonStats,
  totalGross,
  unitsLabel,
} from "@/lib/data";

// The GM "Good Morning" command brief — the morning twin of the Nightly Brief.
// It answers the 10-Second Rule in one glance: WHAT HAPPENED (yesterday + pace),
// WHAT NEEDS ATTENTION (traffic-light tiles), WHAT TO DO NEXT (one prominent
// next-best-action + one-click links into the work). Every number here is
// computed live from data the store already has — nothing is faked. Metrics we
// can't truthfully measure yet (lead response time, multi-source lead inflow,
// service-drive equity) are intentionally omitted until their feeds connect.

// LOCAL day key — deal dates + appointments are local; UTC made "yesterday" wrong every evening.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prettyDate = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function MorningBrief() {
  const { deals } = useDeals();
  const { leads } = useCrmLeads();
  const { goals } = useSalesGoals();
  const { salespeople } = useTeamLists();
  const { settings } = useStoreSettings();
  const { profile } = useAuth();

  const firstName = (profile?.employeeName || "").trim().split(/\s+/)[0] || "Boss";
  const now = new Date();
  const todayIso = iso(now);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ── What happened: yesterday (or the most recent sales day if yesterday was dark)
  // Same unit rule as Month Pace below (retail) — one brief, one definition.
  const delivered = deals.filter(isCountableRetail);
  const yIso = iso(new Date(now.getTime() - 86_400_000));
  let dayDeals = delivered.filter((d) => d.date === yIso);
  let dayLabel = "Yesterday";
  if (dayDeals.length === 0) {
    const last = [...new Set(delivered.map((d) => d.date).filter(Boolean))].sort().pop();
    if (last) {
      dayDeals = delivered.filter((d) => d.date === last);
      dayLabel = `Last sales day · ${prettyDate(last)}`;
    }
  }
  const dayUnits = dayDeals.length;
  const dayGross = dayDeals.reduce((s, d) => s + totalGross(d), 0);
  const dayReserve = dayDeals.reduce((s, d) => s + d.backGrossReserve, 0);

  // ── Pace toward the store unit goal
  const pace = currentMonthPace(deals);
  const mtdUnits = deals.filter(isCountableRetail).length;
  const goal = goals.teamDeliveredUnits || settings.targets.deliveredUnits;
  const projected = paceValue(mtdUnits, pace);
  const onPace = projected >= goal;
  const needPerDay = dailyNeed(goal, mtdUnits, pace.remainingDays);

  // ── What needs attention now (traffic-light)
  const newLeads = leads.filter((l) => l.status === "New Lead");
  const apptsToday = leads.filter((l) => l.appointment && l.appointment.slice(0, 10) === todayIso);
  const inDesk = leads.filter((l) => l.status === "Desking" || l.status === "In Finance");
  const openRdr = delivered.filter((d) => (d.rdrStatus || "Not Punched") !== "Punched");
  // Deals at risk — sitting too long in a stage that should keep moving.
  const nowMs = now.getTime();
  const atRisk = leads.filter((l) => isAtRisk(l, nowMs));

  // ── Coaching: reps pacing under their own unit goal
  const behind = salespeople
    .map((name) => {
      const units = salespersonStats(deals, name).units;
      const g = goals.salespersonUnits[name] || 0;
      return { name, behind: g > 0 && paceValue(units, pace) < g };
    })
    .filter((r) => r.behind)
    .map((r) => displayFullPersonName(r.name));

  // ── The single highest-priority next action (speed-to-lead first)
  const next =
    newLeads.length > 0
      ? { label: `Work ${newLeads.length} fresh lead${newLeads.length === 1 ? "" : "s"}`, sub: "Speed-to-lead — under 5 minutes", href: "/crm-desk" }
      : inDesk.length > 0
        ? { label: `Push ${inDesk.length} deal${inDesk.length === 1 ? "" : "s"} in the desk`, sub: "Get a manager on every working deal", href: "/deal-center" }
        : apptsToday.length > 0
          ? { label: `Confirm ${apptsToday.length} appointment${apptsToday.length === 1 ? "" : "s"} today`, sub: "Confirmed appointments show", href: "/crm-desk" }
          : openRdr.length > 0
            ? { label: `Punch ${openRdr.length} open RDR${openRdr.length === 1 ? "" : "s"}`, sub: "Protect the count", href: "/rdr-center" }
            : { label: "Floor's clean — coach to pace", sub: "Set each rep's number for today", href: "/goals" };

  const read =
    `${dayLabel.startsWith("Last") ? dayLabel : `${dayLabel}`}: ${dayUnits} delivered, ${currency(dayGross)} gross. ` +
    `You're pacing ${number(projected, 0)} toward ${goal}${onPace ? " — on target." : ` — need ${number(needPerDay, 1)}/day to catch up.`} ` +
    (newLeads.length ? `${newLeads.length} fresh lead${newLeads.length === 1 ? "" : "s"} need a 5-minute response.` : inDesk.length ? `${inDesk.length} deal${inDesk.length === 1 ? "" : "s"} sitting in the desk.` : "Floor's clean — keep the pressure on.");

  const tiles: { label: string; value: string; tone: "red" | "amber" | "green" | "blue"; href: string }[] = [
    { label: "Fresh leads to work", value: `${newLeads.length}`, tone: newLeads.length ? "red" : "green", href: "/crm-desk" },
    { label: "Appointments today", value: `${apptsToday.length}`, tone: apptsToday.length ? "blue" : "amber", href: "/crm-desk" },
    { label: "Deals in the desk", value: `${inDesk.length}`, tone: inDesk.length ? "amber" : "green", href: "/deal-center" },
    { label: "Open RDRs", value: `${openRdr.length}`, tone: openRdr.length ? "red" : "green", href: "/rdr-center" },
  ];

  return (
    <section className="rise glass-card overflow-hidden rounded-[16px]">
      {/* Header: greeting + the one-line EILA read (what's happening) */}
      <div className="border-b border-white/8 p-5 sm:p-6">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-mission-gold">
          <Sun className="h-3.5 w-3.5" />
          {weekday}
          <span className="live-dot ml-auto h-2 w-2 rounded-full bg-mission-green" aria-hidden />
        </div>
        <h2 className="mt-2 font-display text-3xl font-black leading-tight text-white sm:text-4xl">Good morning, {firstName}.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">{read}</p>
      </div>

      {/* What happened — yesterday snapshot + pace (no clutter, big numbers) */}
      <div className="grid grid-cols-2 gap-px bg-white/8 sm:grid-cols-4">
        <Snapshot label={dayLabel} value={unitsLabel(dayUnits)} sub="delivered" />
        <Snapshot label="Gross" value={currency(dayGross)} sub="that day, w/ doc" />
        <Snapshot label="F&I Gross" value={currency(dayReserve)} sub="back end, that day" />
        <Snapshot label="Month Pace" value={`${number(projected, 0)} / ${goal}`} sub={onPace ? "on target" : `need ${number(needPerDay, 1)}/day`} tone={onPace ? "green" : "amber"} />
      </div>

      {/* What to do next — one prominent action (one click) */}
      <div className="p-5 sm:p-6">
        <Link
          href={next.href}
          className="group flex items-center justify-between gap-3 rounded-[14px] border border-mission-green/30 bg-mission-green/10 px-5 py-4 transition hover:border-mission-green/60 hover:bg-mission-green/15"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-mission-green/80">Do this next</div>
            <div className="mt-1 truncate font-display text-xl font-black text-white">{next.label}</div>
            <div className="text-xs text-white/55">{next.sub}</div>
          </div>
          <ArrowRight className="h-6 w-6 shrink-0 text-mission-green transition group-hover:translate-x-1" />
        </Link>

        {/* What needs attention — traffic-light tiles, each one click into the work */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} className="lift rounded-[12px] border border-white/8 bg-white/[0.03] p-3.5 transition hover:border-white/20">
              <div className={`font-display text-2xl font-black tabular-nums ${toneText(t.tone)}`}>{t.value}</div>
              <div className="mt-1 text-[11px] font-semibold leading-4 text-white/55">{t.label}</div>
            </Link>
          ))}
        </div>

        {/* Intelligence callouts — only what we can prove, with names + a one-click jump */}
        {(atRisk.length > 0 || inDesk.length > 0 || behind.length > 0) && (
          <div className="mt-4 space-y-2">
            {atRisk.length > 0 && (
              <Callout href="/crm-desk" tone="red"
                text={`${atRisk.length} deal${atRisk.length === 1 ? "" : "s"} at risk — ${nameList(atRisk.map((l) => l.customer))} stuck too long in stage. Step in before they slip.`} />
            )}
            {inDesk.length > 0 && (
              <Callout href="/deal-center" tone="amber"
                text={`${inDesk.length} deal${inDesk.length === 1 ? "" : "s"} in the desk right now — ${nameList(inDesk.map((l) => l.customer))}. Get a manager on them.`} />
            )}
            {behind.length > 0 && (
              <Callout href="/goals" tone="red"
                text={`${behind.length} rep${behind.length === 1 ? "" : "s"} behind pace — ${nameList(behind)}. They need a number today.`} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function nameList(names: string[]) {
  const clean = names.map((n) => (n || "").trim()).filter(Boolean);
  if (clean.length === 0) return "—";
  if (clean.length <= 2) return clean.join(" & ");
  return `${clean.slice(0, 2).join(", ")} +${clean.length - 2} more`;
}

function toneText(tone: "red" | "amber" | "green" | "blue") {
  return tone === "red" ? "text-mission-red" : tone === "amber" ? "text-mission-gold" : tone === "blue" ? "text-mission-green" : "text-mission-green";
}

function Snapshot({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "green" | "amber" }) {
  return (
    <div className="bg-[#0b0d12] p-4">
      <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">{label}</div>
      <div className={`mt-1.5 font-display text-2xl font-black leading-none ${tone === "amber" ? "text-mission-gold" : tone === "green" ? "text-mission-green" : "text-white"}`}>{value}</div>
      <div className="mt-1 text-[11px] text-white/45">{sub}</div>
    </div>
  );
}

function Callout({ text, href, tone }: { text: string; href: string; tone: "red" | "amber" }) {
  const accent = tone === "red" ? "border-mission-red/30 bg-mission-red/[0.07]" : "border-mission-gold/25 bg-mission-gold/[0.06]";
  return (
    <Link href={href} className={`group flex items-center justify-between gap-3 rounded-[12px] border ${accent} px-4 py-3 transition hover:brightness-110`}>
      <span className="text-sm leading-5 text-white/80">{text}</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white/70" />
    </Link>
  );
}
