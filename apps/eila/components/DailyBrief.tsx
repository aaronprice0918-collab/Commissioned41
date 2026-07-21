"use client";

import { CalendarDays, Sparkles, Target, PhoneCall, ArrowUpRight, TrendingUp, DollarSign, Wallet } from "lucide-react";
import { useMission } from "@/lib/store";
import { INDUSTRY_UNIT } from "@/lib/types";
import { useAskIla } from "./AppShell";
import { forecast, monthBounds, money } from "@/lib/engine";
import { coach, todaysMission } from "@/lib/coach";
import { billsRemaining, dailyBudget, incomeExpectation } from "@/lib/money/engine";
import { defaultMoneyConfig } from "@/lib/money/types";
import { Sheet } from "./ui";

export function DailyBrief({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useMission();
  const askIla = useAskIla();
  // Any number in the brief is questionable — tap hands off to EILA (close
  // this sheet first so hers can open).
  const explain = (prompt: string) => { onClose(); askIla(prompt); };
  if (!data.profile) return null;
  const plan = data.profile.plan;
  const industry = data.profile.industry ?? "automotive";

  const f = forecast(plan, data.deals, new Date(), data.profile?.daysOff ?? []);
  const cur = f.current;
  const mission = todaysMission(plan, data.deals, industry, new Date(), data.profile?.daysOff ?? []);
  const insights = coach(plan, data.deals, industry, new Date(), data.profile?.daysOff ?? []).slice(0, 3);
  const { daysRemaining } = monthBounds();
  const goalGap = Math.max((plan.goalUnits || 0) - f.paceUnits, 0);
  const due = data.deals.filter((d) => d.followUpAt && new Date(d.followUpAt) <= endToday() && d.status !== "delivered" && d.status !== "dead");
  const lifeToday = (data.lifeItems ?? []).filter((i) => i.date === todayKey() && !i.done).sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  const firstName = data.profile.name.split(" ")[0] || "there";
  const moneyCfg = data.profile.money ?? defaultMoneyConfig();
  const income = incomeExpectation(
    f.likely.grossPay,
    moneyCfg.paydays ?? moneyCfg.payday,
    new Date(),
    plan.taxRate,
    moneyCfg.checkNets,
  );
  const dayMoney = dailyBudget(moneyCfg, income, new Date());
  const nextBill = billsRemaining(moneyCfg, new Date())[0];

  return (
    <Sheet open={open} onClose={onClose} title="Today's Brief">
      <div className="space-y-4">
        <div className="px-1">
          <div className="text-sm text-fg/70">{greeting()}, {firstName}.</div>
          <div className="text-xs text-fg/60">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · {daysRemaining} days left this month</div>
        </div>

        <div className="glass living-ring flex gap-3 p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Target size={20} /></div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/65">Today's focus</div>
            <div className="mt-0.5 text-[15px] leading-snug text-fg/90">{mission}</div>
          </div>
        </div>

        {lifeToday.length > 0 && (
          <button className="glass block w-full p-4 text-left" onClick={() => explain(`Here is what is on my personal day board: ${lifeToday.map((i) => `${i.time ? `${i.time} ` : ""}${i.title}`).join("; ")}. Help me plan my day around this and my sales goals.`)}>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65">
              <CalendarDays size={12} className="text-accent2" /> Life today
            </div>
            <div className="space-y-1.5">
              {lifeToday.slice(0, 4).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-semibold text-fg/85">{item.title}</span>
                  <span className="shrink-0 text-xs tabnum text-fg/50">{item.time ? displayTime(item.time) : item.kind}</span>
                </div>
              ))}
            </div>
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button className="glass p-4 text-left" onClick={() => explain("Explain my likely commission — what's earned now vs still pipeline-weighted, and how you got the number. Plain words.")}>
            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-accent2"><Sparkles size={12} /> Likely</div>
            <div className="mt-1 text-2xl font-black tabnum">{money(f.likely.grossPay)}</div>
            <div className="text-xs text-good">{money(cur.grossPay)} earned now</div>
          </button>
          <button className="glass p-4 text-left" onClick={() => explain("Explain my month-end pace — how you project it and what closes the gap to my goal.")}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/65">Month-end pace</div>
            <div className="mt-1 text-2xl font-black tabnum">{f.paceUnits} <span className="text-base text-fg/65">{INDUSTRY_UNIT[industry].plural}</span></div>
            {plan.goalUnits > 0 && <div className="text-xs text-fg/70">{goalGap > 0 ? `${goalGap} under goal` : "at/above goal"}</div>}
          </button>
        </div>

        <button className="glass p-4 text-left" onClick={() => explain("Give me my money picture for today. Tell me what I can spend, what bill is next, and what I should avoid doing today.")}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65"><Wallet size={12} className="text-accent2" /> Money today</div>
          {dayMoney ? (
            <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-3">
              <div>
                <div className="text-3xl font-black tabnum text-fg">{money(dayMoney.leftToday)}</div>
                <div className="text-xs text-fg/60">left to spend today · floor {money(dayMoney.floor)}</div>
              </div>
              <div className="text-right text-xs text-fg/60">
                {nextBill ? (
                  <>
                    <div className="font-bold text-fg/75 tabnum">{money(nextBill.bill.amount)}</div>
                    <div className="max-w-[120px] truncate">next: {nextBill.bill.name}</div>
                  </>
                ) : (
                  <>
                    <div className="font-bold text-good">clear</div>
                    <div>no dated bill ahead</div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm leading-relaxed text-fg/65">Set up checking and bills once, and I&apos;ll tell you what is safe to spend every morning.</div>
          )}
        </button>

        {cur.nextTiers.length > 0 && (
          <div className="glass p-4">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65"><ArrowUpRight size={12} className="text-good" /> Best opportunities today</div>
            <div className="space-y-2">
              {cur.nextTiers.slice(0, 3).map((t, i) => (
                <button key={i} className="flex w-full items-center justify-between gap-3 text-left" onClick={() => explain(`Walk me through this opportunity: "${t.hint}" — where does the +${money(t.addPay)} come from and what is the first calm step today?`)}>
                  <span className="text-sm text-fg/80">{t.hint}</span>
                  <span className="shrink-0 text-sm font-bold tabnum text-good">+{money(t.addPay)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {due.length > 0 && (
          <div className="glass p-4">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65"><PhoneCall size={12} className="text-accent2" /> Customer touches</div>
            <div className="flex flex-wrap gap-2">{due.slice(0, 8).map((d) => <span key={d.id} className="rounded-full bg-fg/6 px-3 py-1 text-sm text-fg/80">{d.customer || "Customer"}</span>)}</div>
          </div>
        )}

        {insights.length > 0 && (
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <div key={i} className="glass flex items-start gap-3 p-3.5">
                <div className="mt-0.5 shrink-0 text-good">{ins.kind === "followup" ? <PhoneCall size={16} /> : ins.kind === "pace" ? <TrendingUp size={16} /> : <DollarSign size={16} />}</div>
                <div className="text-[14px] leading-snug text-fg/80">{ins.text}</div>
              </div>
            ))}
          </div>
        )}

        <p className="px-1 text-center text-sm italic text-fg/70">{encouragement(cur.grossPay > 0, goalGap === 0)}</p>
        <button className="btn btn-primary btn-block" onClick={onClose}>I&apos;m ready →</button>
      </div>
    </Sheet>
  );
}

function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
function endToday() { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function displayTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h || 0, m || 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function encouragement(started: boolean, onGoal: boolean) {
  if (onGoal) return "You're ahead of the game. Keep protecting the pace.";
  if (started) return "Momentum's real. Stack one more win today.";
  return "Clean slate. The first deal sets the tone — go get it.";
}
