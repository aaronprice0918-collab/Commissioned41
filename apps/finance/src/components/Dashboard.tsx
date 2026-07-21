"use client";

import Link from "next/link";
import {
  alerts,
  billsRemaining,
  billsRemainingTotal,
  creditUtilization,
  dailyBrief,
  emergencyFund,
  forecast,
  healthScore,
  incomeRemainingThisMonth,
  investments,
  liquidCash,
  monthlySubscriptions,
  netWorth,
  nextPaycheck,
  safeToSpend,
  spendByCategory,
  spentThisMonth,
  totalDebt,
} from "@/lib/engine";
import type { FinancialProfile } from "@/lib/types";
import { currency, percent, relativeDays, shortDate } from "@/lib/format";
import { AnimatedNumber, Card, Dot, Label, Pill } from "@/components/primitives";
import { HealthRing } from "@/components/HealthRing";
import { ForecastChart } from "@/components/Forecast";
import { DecisionEngine } from "@/components/DecisionEngine";
import { ConnectBank } from "@/components/ConnectBank";
import { SyncButton } from "@/components/SyncButton";
import { LockButton } from "@/components/LockButton";
import { IlaChat } from "@/components/IlaChat";

const usd0 = (n: number) => currency(n);
const usd2 = (n: number) => currency(n, { cents: true });

const CATEGORY_LABELS: Record<string, string> = {
  food: "Groceries",
  fuel: "Fuel",
  restaurants: "Restaurants",
  amazon: "Amazon",
  kids: "Kids",
  business: "Business",
  entertainment: "Entertainment",
  travel: "Travel",
  shopping: "Shopping",
  utilities: "Utilities",
  subscriptions: "Subscriptions",
  housing: "Housing",
  transportation: "Transportation",
  medical: "Medical",
  taxes: "Taxes",
  debt: "Debt",
  savings: "Savings",
  investments: "Investments",
  income: "Income",
};

export function Dashboard({
  profile,
  isLive,
  locked = false,
}: {
  profile: FinancialProfile;
  isLive: boolean;
  locked?: boolean;
}) {
  const sts = safeToSpend(profile);
  const health = healthScore(profile);
  const brief = dailyBrief(profile);
  const cash = liquidCash(profile);
  const billsLeft = billsRemaining(profile);
  const billsLeftTotal = billsRemainingTotal(profile);
  const fc = forecast(profile, 30);
  const nw = netWorth(profile);
  const debt = totalDebt(profile);
  const ef = emergencyFund(profile);
  const invest = investments(profile);
  const util = creditUtilization(profile);
  const incomeLeft = incomeRemainingThisMonth(profile);
  const spent = spentThisMonth(profile);
  const subs = monthlySubscriptions(profile);
  const cats = spendByCategory(profile);
  const catMax = Math.max(...cats.map((c) => c.amount), 1);
  const live = alerts(profile);

  const sortedGoals = [...profile.goals].sort((a, b) => b.saved / b.target - a.saved / a.target);

  return (
    <main className="mx-auto max-w-7xl px-5 pb-24 pt-8 sm:px-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rise">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-[var(--accent)]/30 to-transparent">
            <span className="text-lg font-bold tracking-tight text-white">M</span>
          </div>
          <div>
            <div className="text-sm font-medium text-[var(--text)]">MissionOS Finance</div>
            <div className="text-xs text-[var(--text-faint)]">
              Good evening, {profile.name} · {shortDate(profile.asOf)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Pill tone={health.score >= 75 ? "good" : health.score >= 60 ? "accent" : "watch"}>
            <Dot tone={health.score >= 75 ? "good" : health.score >= 60 ? "accent" : "watch"} />
            {health.grade} · {health.score}
          </Pill>
          {isLive ? (
            <SyncButton />
          ) : (
            <>
              <Pill tone="watch">Demo data</Pill>
              <ConnectBank />
            </>
          )}
          <Link
            href="/settings"
            title="Settings"
            aria-label="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[var(--text-dim)] transition hover:border-white/25 hover:text-white"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          {locked && <LockButton />}
        </div>
      </header>

      {/* Connect-bank banner (demo mode) */}
      {!isLive && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-5 py-4 rise">
          <div>
            <div className="text-sm font-semibold">You&apos;re viewing demo data</div>
            <div className="text-xs text-[var(--text-dim)]">
              Connect a bank with Plaid to make this your real money — balances and transactions sync automatically.
            </div>
          </div>
          <ConnectBank variant="cta" />
        </div>
      )}

      {/* Hero: Safe to Spend + Daily Brief + Health */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-7" delay={40}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Label>Safe to spend</Label>
              <div className="mt-2 text-5xl font-semibold tracking-tight sm:text-6xl">
                <AnimatedNumber value={sts.available} format={usd0} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-dim)]">
                <Pill tone="accent">{currency(sts.perDay)}/day</Pill>
                <span>for {sts.daysUntilIncome} days until your next deposit</span>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">Projected month-end</div>
              <div className="num mt-1 text-2xl font-semibold" style={{ color: sts.projectedMonthEnd >= 0 ? "var(--good)" : "var(--stop)" }}>
                {currency(sts.projectedMonthEnd)}
              </div>
            </div>
          </div>

          {/* Daily brief */}
          <div className="mt-6 border-t border-white/8 pt-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-semibold shimmer-text">EILA · Today&apos;s brief</span>
            </div>
            <ul className="space-y-2.5">
              {brief.map((line, i) => (
                <li key={i} className="flex items-start gap-3 text-[15px] leading-snug">
                  <span className="mt-1.5">
                    <Dot tone={line.tone === "good" ? "good" : line.tone === "watch" ? "watch" : "accent"} />
                  </span>
                  <span className="text-[var(--text)]">{line.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="p-7 flex flex-col items-center justify-center text-center" delay={90}>
          <Label>Financial Health</Label>
          <div className="my-4">
            <HealthRing score={health.score} />
          </div>
          <div className="text-lg font-semibold">{health.grade}</div>
          <div className="mt-4 w-full space-y-2">
            {health.factors.slice(0, 4).map((f) => (
              <div key={f.label} className="flex items-center gap-2.5">
                <span className="w-28 shrink-0 text-left text-xs text-[var(--text-dim)]">{f.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${f.score}%`,
                      background: f.score >= 75 ? "var(--good)" : f.score >= 50 ? "var(--accent)" : "var(--watch)",
                    }}
                  />
                </div>
                <span className="num w-7 text-right text-xs text-[var(--text-faint)]">{Math.round(f.score)}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Stat widgets */}
      <section className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Current Cash" value={cash} fmt={usd0} delay={120} sub={`${profile.accounts.filter((a) => a.type === "checking").length} checking`} />
        <NextPaycheckCard profile={profile} delay={150} />
        <Stat
          label="Bills Remaining"
          value={billsLeftTotal}
          fmt={usd0}
          delay={180}
          tone="watch"
          sub={`${billsLeft.length} bills this month`}
        />
        <Stat
          label="Net Worth"
          value={nw}
          fmt={usd0}
          delay={210}
          tone={nw >= 0 ? "good" : "stop"}
          sub="trending up"
        />
      </section>

      {/* Forecast + side column */}
      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-6" delay={240}>
          <div className="mb-2 flex items-center justify-between">
            <Label>30-Day Cash Flow Forecast</Label>
            <div className="flex items-center gap-3 text-[11px] text-[var(--text-faint)]">
              <span className="flex items-center gap-1.5"><Dot tone="good" /> income</span>
              <span className="flex items-center gap-1.5"><Dot tone="watch" /> bill</span>
            </div>
          </div>
          <ForecastChart points={fc} />
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-6" delay={270}>
            <Label>Income Remaining</Label>
            <div className="num mt-2 text-3xl font-semibold text-[var(--good)]">
              <AnimatedNumber value={incomeLeft} format={usd0} />
            </div>
            <div className="mt-1 text-xs text-[var(--text-dim)]">expected before month-end</div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/8 pt-4">
              <MiniStat label="Spent this month" value={usd0(spent)} />
              <MiniStat label="Subscriptions" value={`${usd2(subs)}/mo`} />
            </div>
          </Card>

          <Card className="p-6" delay={300}>
            <Label>Debt &amp; Credit</Label>
            <div className="num mt-2 text-3xl font-semibold">{usd0(debt)}</div>
            <div className="mt-1 text-xs text-[var(--text-dim)]">total across {profile.accounts.filter((a) => a.balance < 0).length} accounts</div>
            <div className="mt-4 space-y-2 border-t border-white/8 pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-dim)]">Credit utilization</span>
                <span className="num font-medium" style={{ color: util > 0.3 ? "var(--watch)" : "var(--good)" }}>
                  {percent(util)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(util * 100, 100)}%`, background: util > 0.3 ? "var(--watch)" : "var(--good)" }}
                />
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Decision Engine + Goals + Spending */}
      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-0" delay={330} hover={false}>
          <DecisionEngine profile={profile} />
        </Card>

        <Card className="p-6" delay={360}>
          <div className="flex items-center justify-between">
            <Label>Goals</Label>
            <Pill tone="neutral">{profile.goals.length} active</Pill>
          </div>
          <div className="mt-4 space-y-4">
            {sortedGoals.map((g) => {
              const pct = g.saved / g.target;
              return (
                <div key={g.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <span>{g.emoji}</span> {g.name}
                    </span>
                    <span className="num text-xs text-[var(--text-dim)]">
                      {usd0(g.saved)} / {usd0(g.target)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--accent-soft)] to-[var(--accent)]"
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-[var(--text-faint)]">
                    <span>by {shortDate(g.targetDate)}</span>
                    <span style={{ color: g.probability >= 0.7 ? "var(--good)" : "var(--watch)" }}>
                      {percent(g.probability)} likely
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-6" delay={390}>
          <Label>Spending Intelligence</Label>
          <div className="mt-1 text-xs text-[var(--text-dim)]">This month · {usd0(spent)}</div>
          <div className="mt-4 space-y-2.5">
            {cats.slice(0, 7).map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-[var(--text-dim)]">
                  {CATEGORY_LABELS[c.category] ?? c.category}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--accent)]/70 to-[var(--accent-soft)]"
                    style={{ width: `${(c.amount / catMax) * 100}%` }}
                  />
                </div>
                <span className="num w-14 text-right text-xs">{usd0(c.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Upcoming bills + Wealth/EF + Alerts */}
      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-6" delay={420}>
          <Label>Upcoming Bills</Label>
          <div className="mt-4 space-y-1">
            {billsLeft.slice(0, 7).map((u) => (
              <div key={u.bill.id} className="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
                <div>
                  <div className="text-sm font-medium">{u.bill.name}</div>
                  <div className="text-[11px] text-[var(--text-faint)]">{relativeDays(u.daysAway)} · {shortDate(u.date)}</div>
                </div>
                <span className="num text-sm">{usd2(u.bill.amount)}</span>
              </div>
            ))}
            {billsLeft.length === 0 && (
              <div className="py-6 text-center text-sm text-[var(--text-faint)]">No bills left this month 🎉</div>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-6" delay={450}>
            <Label>Emergency Fund</Label>
            <div className="num mt-2 text-3xl font-semibold">{usd0(ef)}</div>
            <div className="mt-1 text-xs text-[var(--text-dim)]">{health.factors[0].detail}</div>
          </Card>
          <Card className="p-6" delay={480}>
            <Label>Investments &amp; Retirement</Label>
            <div className="num mt-2 text-3xl font-semibold">{usd0(invest)}</div>
            <div className="mt-1 text-xs text-[var(--text-dim)]">brokerage + 401(k)</div>
          </Card>
        </div>

        <Card className="p-6" delay={510}>
          <Label>Smart Alerts</Label>
          <div className="mt-4 space-y-3">
            {live.map((a) => {
              const tone = a.severity === "warn" ? "watch" : a.severity === "good" ? "good" : "accent";
              return (
                <div key={a.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Dot tone={tone as "good" | "watch" | "accent"} />
                    {a.title}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-dim)]">{a.detail}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      <footer className="mt-10 text-center text-xs text-[var(--text-faint)]">
        MissionOS Finance · {isLive ? "live on your accounts" : "demo data"} · the CFO in your pocket
      </footer>

      <IlaChat />
    </main>
  );
}

function Stat({
  label,
  value,
  fmt,
  sub,
  tone = "neutral",
  delay = 0,
}: {
  label: string;
  value: number;
  fmt: (n: number) => string;
  sub?: string;
  tone?: "neutral" | "good" | "watch" | "stop";
  delay?: number;
}) {
  const color = tone === "good" ? "var(--good)" : tone === "watch" ? "var(--watch)" : tone === "stop" ? "var(--stop)" : undefined;
  return (
    <Card className="p-5" delay={delay}>
      <Label>{label}</Label>
      <div className="num mt-2 text-3xl font-semibold tracking-tight" style={{ color }}>
        <AnimatedNumber value={value} format={fmt} />
      </div>
      {sub && <div className="mt-1 text-xs text-[var(--text-faint)]">{sub}</div>}
    </Card>
  );
}

function NextPaycheckCard({ profile, delay }: { profile: FinancialProfile; delay: number }) {
  const next = nextPaycheck(profile);
  if (!next) {
    return (
      <Card className="p-5" delay={delay}>
        <Label>Next Paycheck</Label>
        <div className="num mt-2 text-3xl font-semibold tracking-tight text-[var(--text-faint)]">—</div>
        <div className="mt-1 text-xs text-[var(--text-faint)]">none scheduled</div>
      </Card>
    );
  }
  return (
    <Card className="p-5" delay={delay}>
      <div className="flex items-center justify-between">
        <Label>Next Paycheck</Label>
        <Pill tone={next.confidence >= 0.85 ? "good" : "watch"}>{percent(next.confidence)}</Pill>
      </div>
      <div className="num mt-2 text-3xl font-semibold tracking-tight text-[var(--good)]">
        <AnimatedNumber value={next.expectedNet} format={(n) => currency(n)} />
      </div>
      <div className="mt-1 text-xs text-[var(--text-faint)]">
        {shortDate(next.date)} · {next.kind}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-2.5 text-[11px] text-[var(--text-dim)]">
        <span>worst {currency(next.worstCase)}</span>
        <span>best {currency(next.bestCase)}</span>
      </div>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">{label}</div>
      <div className="num mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
