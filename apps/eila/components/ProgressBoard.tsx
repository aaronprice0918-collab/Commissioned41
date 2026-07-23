"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgePercent, Car, DollarSign, Gauge, Layers, ShieldCheck } from "lucide-react";
import { useMission } from "@/lib/store";
import { useAskIla } from "./AppShell";
import { forecast, dealTotals, money, isProductOnly } from "@/lib/engine";
import { INDUSTRY_UNIT } from "@/lib/types";
import { basisGrossLabel, dealMoneyOf, moneyBasis, productDefs, usesProductMenu, vscPenetrationPct } from "@/lib/fni";
import type { PayPlan } from "@/lib/payplan/types";

// EILA's month at a glance — a Monarch-style progress board: every number that
// matters as one clean labeled row (icon · label · value / target · bar). It's
// the 10-second answer to "how's my month going" without reading a single chart.
// Targets are HONEST — pulled from the rep's own goal, pay-grid gates, and
// rate-bonus thresholds — never invented. A metric with no target in the plan
// shows its value with no bar rather than a made-up denominator.

type Tone = "good" | "accent" | "warn";

interface BoardRow {
  key: string;
  label: string;
  icon: React.ReactNode;
  display: string;
  targetDisplay?: string;
  pct?: number; // 0..1, omitted = no bar (no honest target)
  tone: Tone;
  caption?: string;
  ask: string;
}

// Highest threshold the plan ever asks of a metric across all rate bonuses —
// that's the number the rep is really climbing toward.
function maxBonusTarget(plan: PayPlan, metric: string): number | undefined {
  let best: number | undefined;
  for (const b of plan.bonuses) {
    const conds = Array.isArray(b.condition) ? b.condition : [b.condition];
    for (const c of conds) if (c.metric === metric) best = Math.max(best ?? 0, c.value);
  }
  return best;
}

function maxDefined(...vals: (number | undefined)[]): number | undefined {
  const nums = vals.filter((v): v is number => typeof v === "number" && v > 0);
  return nums.length ? Math.max(...nums) : undefined;
}

export function ProgressBoard() {
  const { data } = useMission();
  const askIla = useAskIla();
  const profile = data.profile!;
  const plan = profile.plan;
  const industry = profile.industry;
  const unit = INDUSTRY_UNIT[industry];

  // Animate every bar from 0 → target on mount, matching the Performance page.
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(t);
  }, []);

  const now = new Date();
  const f = useMemo(() => forecast(plan, data.deals, now, profile.daysOff ?? []), [plan, data.deals, profile.daysOff]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const rows = useMemo<BoardRow[]>(() => {
    const counted = f.counted;
    const t = dealTotals(counted);
    const basis = moneyBasis(profile);
    const defs = productDefs(profile);
    const basisGross = counted.reduce((s, d) => s + dealMoneyOf(basis)(d), 0);
    const units = t.units;
    const pvr = units ? basisGross / units : 0;
    const ppu = t.addonsPerUnit;

    // VSC penetration = % of retail cars carrying VSC, resolved against the
    // user's OWN menu (a custom menu's VSC id isn't the literal "vsc").
    const vscPct = vscPenetrationPct(counted, defs);

    // Honest targets from the plan itself.
    const goal = plan.goalUnits || 0;
    const gridPvr = plan.grid?.x?.length ? plan.grid.x[plan.grid.x.length - 1] : undefined;
    const gridPpu = plan.grid?.y?.length ? plan.grid.y[plan.grid.y.length - 1] : undefined;
    const pvrTarget = maxDefined(gridPvr, maxBonusTarget(plan, "pvr"));
    const ppuTarget = maxDefined(gridPpu, maxBonusTarget(plan, "ppt"));
    const vscTarget = maxBonusTarget(plan, "vscPenetration");

    const out: BoardRow[] = [];

    // 1) Units — the headline. Pace tells the tone.
    out.push({
      key: "units",
      label: cap(unit.plural),
      icon: <Car size={15} />,
      display: `${units}`,
      targetDisplay: goal ? `${goal}` : undefined,
      pct: goal ? units / goal : undefined,
      tone: goal ? (units >= goal ? "good" : f.paceUnits >= goal ? "accent" : "warn") : "accent",
      caption: goal ? `On pace for ${f.paceUnits} · day ${dayOfMonth} of ${daysInMonth}` : `${units} delivered so far`,
      ask: `How's my ${unit.singular} count tracking against my goal this month? Am I on pace, and what do I need per day to hit it?`,
    });

    // 2) The gross that actually pays me (front / back / total per my plan).
    const grossTarget = goal && pvrTarget ? goal * pvrTarget : undefined;
    out.push({
      key: "gross",
      label: basisGrossLabel(basis, industry),
      icon: <DollarSign size={15} />,
      display: money(basisGross),
      targetDisplay: grossTarget ? money(grossTarget) : undefined,
      pct: grossTarget ? basisGross / grossTarget : undefined,
      tone: grossTarget ? (basisGross >= grossTarget ? "good" : "accent") : "accent",
      caption: grossTarget ? "Goal = your unit goal at target PVR" : "Booked so far this month",
      ask: `Break down my ${basisGrossLabel(basis, industry)} this month — what's driving it and how do I lift it?`,
    });

    // 3) PVR — per-vehicle gross.
    out.push({
      key: "pvr",
      label: "PVR",
      icon: <Gauge size={15} />,
      display: money(pvr),
      targetDisplay: pvrTarget ? money(pvrTarget) : undefined,
      pct: pvrTarget ? pvr / pvrTarget : undefined,
      tone: pvrTarget ? (pvr >= pvrTarget ? "good" : "accent") : "accent",
      caption: pvrTarget ? "Target maxes your pay grid" : "Gross per vehicle",
      ask: "Explain my PVR — how it's calculated, where I stand against my grid, and the fastest way to raise it.",
    });

    // 4) PPU — products per unit.
    out.push({
      key: "ppu",
      label: "PPU",
      icon: <Layers size={15} />,
      display: ppu.toFixed(2),
      targetDisplay: ppuTarget ? ppuTarget.toFixed(1) : undefined,
      pct: ppuTarget ? ppu / ppuTarget : undefined,
      tone: ppuTarget ? (ppu >= ppuTarget ? "good" : "accent") : "accent",
      caption: ppuTarget ? "Target clears your grid gate" : "Products per vehicle",
      ask: "Explain my PPU (products per unit) — what it is, my target, and which products to push to raise it.",
    });

    // 5) VSC penetration — only where the rep sells a product menu.
    if (usesProductMenu(industry) || vscTarget !== undefined) {
      out.push({
        key: "vsc",
        label: "VSC %",
        icon: vscTarget !== undefined ? <ShieldCheck size={15} /> : <BadgePercent size={15} />,
        display: `${Math.round(vscPct)}%`,
        targetDisplay: vscTarget !== undefined ? `${Math.round(vscTarget)}%` : undefined,
        pct: vscTarget !== undefined ? vscPct / vscTarget : undefined,
        tone: vscTarget !== undefined ? (vscPct >= vscTarget ? "good" : "accent") : "accent",
        caption: vscTarget !== undefined ? "Bonus target" : "Service contracts sold",
        ask: "How's my VSC penetration this month, what's my bonus target, and how many more do I need to hit it?",
      });
    }

    return out;
  }, [f, plan, profile, industry, unit, dayOfMonth, daysInMonth]);

  return (
    <div className="glass rise p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65">
          <Gauge size={13} /> Your numbers
        </div>
        <span className="rounded-full bg-fg/6 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fg/55">vs plan targets</span>
      </div>

      <div className="mt-3 space-y-3">
        {rows.map((r) => (
          <button key={r.key} onClick={() => askIla(r.ask)} className="block w-full text-left active:opacity-70">
            <div className="flex items-center gap-2.5">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-fg/[0.05] ${toneText(r.tone)}`}>{r.icon}</span>
              <span className="flex-1 truncate text-sm font-semibold text-fg/85">{r.label}</span>
              <span className="shrink-0 text-sm font-black tabnum">
                {r.display}
                {r.targetDisplay ? <span className="font-semibold text-fg/40"> / {r.targetDisplay}</span> : null}
              </span>
            </div>
            {r.pct !== undefined && (
              <div className="ml-[38px] mt-1.5 h-2 overflow-hidden rounded-full bg-fg/8">
                <div
                  className={`h-full rounded-full transition-[width] duration-700 ${toneBar(r.tone)}`}
                  style={{ width: on ? `${Math.min(100, Math.max(r.pct > 0 ? 4 : 0, r.pct * 100))}%` : "0%" }}
                />
              </div>
            )}
            {r.caption && <div className="ml-[38px] mt-1 text-[11px] text-fg/50">{r.caption}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

function toneText(tone: Tone): string {
  return tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-accent2";
}
function toneBar(tone: Tone): string {
  return tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : "bg-gradient-to-r from-accent/60 to-accent";
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
