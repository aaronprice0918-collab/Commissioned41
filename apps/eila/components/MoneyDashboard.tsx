"use client";

// The Money area — EILA's CFO side. Companion-first by explicit direction
// (Aaron, July 5 2026: "she needs to be more than transactional. She needs
// to be a companion"): the screen opens with EILA SPEAKING about where the
// rep stands, in her voice; the stat cards below are the receipts behind
// what she just said. Every element hands off into a conversation with her.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, Check, ChevronRight, FileScan, Plus, Sparkles, Wallet, X } from "lucide-react";
import { useMission } from "@/lib/store";
import { useAskIla } from "@/components/AppShell";
import { BankLink } from "@/components/BankLink";
import { forecast } from "@/lib/engine";
import { getSupabase } from "@/lib/supabase";
import { fileToBase64 } from "@/lib/payplan/upload";
import {
  addSpend,
  applyStatementScan,
  removeSpend,
  billsRemaining,
  budgetMonth,
  cashFlow,
  cashFlowLow,
  cashFlowSummary,
  goalProgress,
  incomeExpectation,
  monthBills,
  monthChecks,
  merchantKeyFor,
  safeToSpend,
  seedBudgetsFromProfile,
  setMerchantRule,
  type StatementScan,
} from "@/lib/money/engine";
import type { Bill, BillCadence, BudgetMonth, LedgerRow, MerchantRule, MoneyConfig, MoneyGoal, MonthBill } from "@/lib/money/types";
import { defaultMoneyConfig } from "@/lib/money/types";
import { changedFields, mergeListBy } from "@/lib/mergeEdits";
import { CountUp } from "@/components/motion";
import { Labeled, SectionTitle, Sheet, parseNumericInput } from "@/components/ui";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const uid = () => Math.random().toString(36).slice(2, 10);
// LOCAL date — toISOString is UTC and rolls to tomorrow after ~8pm ET, which
// would file tonight's dinner under the wrong day (or month, on the 31st).
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** EILA's read on the money picture — first person, her powerhouse voice,
 * grounded in the same math the cards below show. Deterministic (no AI
 * call): this is her scripted floor; the chat handoff is the deep dive. */
function ilaMoneyRead(
  cfg: MoneyConfig,
  sts: ReturnType<typeof safeToSpend>,
  low: ReturnType<typeof cashFlowLow>,
  nextBill: { name: string; amount: number; daysAway: number; date?: string } | null,
  nextCheck: { amount: number; date: string },
  firstName: string,
  bm: BudgetMonth | null,
): string[] {
  const out: string[] = [];
  if (cfg.checkingBalance == null) {
    return [
      `${firstName}, this is where I watch the other half of your money — not what you earn, what you keep.`,
      `Tell me what's in checking and what bills you carry, and I'll tell you what's safe to spend every single day.`,
    ];
  }
  if (sts) {
    if (sts.available > 0) {
      out.push(
        `You're clear to breathe — ${money(sts.available)} is genuinely yours right now, about ${money(sts.perDay)} a day until the check lands.`,
      );
    } else {
      out.push(
        nextCheck.amount > 0
          ? `Tight window, not trouble — today's cash is spoken for, and ~${money(nextCheck.amount)} lands ${nextCheck.date.slice(5).replace("-", "/")}. We hold the line a few days; that's the whole assignment.`
          : `It's tight — after what's already spoken for, there's no free money today. We hold the line until the check lands, and we don't panic.`,
      );
    }
  }
  if (low && low.balance < 0) {
    const lowDay = Number(low.date.slice(8));
    out.push(`Heads up: the curve dips under water around the ${lowDay}${ordinal(lowDay)}. We plan for it now, not that morning.`);
  }
  if (nextBill) {
    out.push(
      nextBill.daysAway <= 3
        ? `${nextBill.name} hits ${nextBill.daysAway === 0 ? "TODAY" : `in ${nextBill.daysAway} day${nextBill.daysAway === 1 ? "" : "s"}`} — ${money(nextBill.amount)}. It's covered; just don't spend it twice.`
        : `Next up: ${nextBill.name}, ${money(nextBill.amount)} — ${nextBill.daysAway} days out. Handled.`,
    );
  }
  if (bm && bm.totalBudget > 0) {
    const hot = bm.lines.filter((l) => l.budget > 0 && l.pct >= 100);
    if (bm.leftToSpend >= 0) {
      out.push(
        `On the budget: ${money(bm.leftToSpend)} left to spend with ${bm.daysLeft} day${bm.daysLeft === 1 ? "" : "s"} to go${hot.length ? ` — but ${hot.map((l) => l.name).join(" and ")} ${hot.length === 1 ? "is" : "are"} maxed, so the rest carries the slack` : " — you're running your plan, not the other way around"}.`,
      );
    } else {
      out.push(`The budget's ${money(Math.abs(bm.leftToSpend))} over with ${bm.daysLeft} day${bm.daysLeft === 1 ? "" : "s"} left. Not a crisis — a correction. We tighten now and finish the month clean.`);
    }
  }
  if (nextCheck.amount > 0) {
    out.push(`Your next check is tracking ~${money(nextCheck.amount)}. Every deal you close this week makes that number bigger — that's the connection.`);
  }
  return out;
}

export function MoneyDashboard() {
  const { data, updateMoney } = useMission();
  const askIla = useAskIla();
  const profile = data.profile!;
  const cfg = profile.money ?? defaultMoneyConfig();
  const hasSetup = profile.money != null;

  const [editOpen, setEditOpen] = useState(false);
  const [scan, setScan] = useState<StatementScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const scanInput = useRef<HTMLInputElement>(null);

  async function runScan(files: FileList | null) {
    if (!files || !files.length) return;
    setScanning(true);
    setScanMsg("");
    try {
      const payload = [];
      if (files.length > 6) setScanMsg(`You picked ${files.length} files — I can read 6 per scan, so I'm reading the first 6. Run a second scan for the rest; they'll merge.`);
      for (const f of Array.from(files).slice(0, 6)) {
        const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
        if (!isPdf && !f.type.startsWith("image/")) continue;
        payload.push({ dataB64: await fileToBase64(f), mediaType: isPdf ? "application/pdf" : f.type || "image/jpeg" });
      }
      if (!payload.length) { setScanMsg("Use a photo or the PDF from your bank's app."); return; }
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch("/api/scan-statement", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ files: payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setScanMsg(j.error || "Couldn't read that one — try the PDF from your bank's app."); return; }
      setScan(j as StatementScan);
    } catch {
      setScanMsg("Couldn't read that one — try again.");
    } finally {
      setScanning(false);
      if (scanInput.current) scanInput.current.value = "";
    }
  }

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setNow(new Date()); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  const f = useMemo(
    () => forecast(profile.plan, data.deals, now, profile.daysOff ?? []),
    [profile.plan, profile.daysOff, data.deals, now],
  );
  const income = useMemo(
    () => incomeExpectation(f.likely.grossPay, cfg.paydays ?? cfg.payday, now, profile.plan.taxRate, cfg.checkNets),
    [f, cfg.paydays, cfg.payday, cfg.checkNets, now, profile.plan.taxRate],
  );
  const sts = useMemo(() => safeToSpend(cfg, income, now), [cfg, income, now]);
  const flow = useMemo(() => cashFlow(cfg, income, now), [cfg, income, now]);
  const low = useMemo(() => cashFlowLow(flow), [flow]);
  const upcoming = useMemo(() => billsRemaining(cfg, now), [cfg, now]);
  const bm = useMemo(() => budgetMonth(cfg, now), [cfg, now]);
  const summary = useMemo(() => cashFlowSummary(cfg, income, now), [cfg, income, now]);
  const checks = useMemo(() => monthChecks(cfg, income, now), [cfg, income, now]);
  const mBills = useMemo(() => monthBills(cfg, now), [cfg, now]);
  const [logOpen, setLogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const nextBill = upcoming.length
    ? { name: upcoming[0].bill.name, amount: upcoming[0].bill.amount, daysAway: upcoming[0].daysAway, date: upcoming[0].date }
    : null;
  const read = ilaMoneyRead(cfg, sts, low, nextBill, { amount: income.nextCheckAmount, date: income.nextCheckDate }, profile.name.split(" ")[0], bm);

  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, dim - now.getDate() + 1);
  const monthName = now.toLocaleString("en-US", { month: "long" });
  const periodLabel = `${now.getMonth() + 1}/1 – ${now.getMonth() + 1}/${dim}`;
  const leftover = summary.find((r) => r.label === "Leftover") ?? { label: "Leftover" as const, budget: 0, actual: 0 };
  const incomeRow = summary.find((r) => r.label === "Income") ?? { label: "Income" as const, budget: 0, actual: 0 };
  // Before the first check counts, "in − out" is a guaranteed scary negative
  // that reads as broke (Aaron, July 6: "-1,503?!"). Pre-income the hero
  // flips to plain "out so far + what's coming" — honest, never alarmist.
  const preIncome = incomeRow.actual === 0 && incomeRow.budget > 0;
  // Her sharpest line leads the strip: a budget correction beats a status read.
  const readLine = (bm && bm.leftToSpend < 0 ? read.find((l) => l.includes("over")) : null) ?? read[0];

  return (
    <div className="space-y-4 pb-6">
      {/* EILA's one-line read — the dashboard is the star; she hands off to chat. */}
      <section className="glass rise p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15">
            <Sparkles size={17} className="text-accent2" />
          </span>
          <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-fg/90">{readLine}</p>
          <button
            className="shrink-0 text-[13px] font-semibold text-accent"
            onClick={() => askIla("Let's talk about my money — where do I stand and what should I do this week?")}
          >
            Talk it through
          </button>
        </div>
      </section>

      {hasSetup && (
        <Link
          href="/money/daily"
          className="btn btn-primary btn-block rise !py-4 text-[16px] font-black"
          style={{ animationDelay: "40ms" }}
        >
          <Wallet size={18} /> Daily budget — what can I spend today? <ChevronRight size={18} />
        </Link>
      )}

      {/* Platinum VIP: live bank connection (pitch → connect → connected). */}
      <BankLink />

      {!hasSetup ? (
        <section className="glass rise p-5 text-center" style={{ animationDelay: "140ms" }}>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent/12 text-accent">
            <Wallet size={22} />
          </span>
          <h2 className="mt-3 font-display text-lg font-black">Set up your money picture</h2>
          <p className="mx-auto mt-1.5 max-w-[30ch] text-sm text-fg/65">
            Checking balance, your bills, what a normal month costs you. Two minutes — then EILA watches it with you.
          </p>
          <StatementDropZone scanning={scanning} onPick={() => scanInput.current?.click()} onFiles={runScan} />
          {scanMsg && <p className="mt-2 text-[12px] font-semibold text-warn">{scanMsg}</p>}
          <div className="mt-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-fg/10" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg/40">or</span>
            <span className="h-px flex-1 bg-fg/10" />
          </div>
          <button className="btn btn-ghost btn-block mt-3" onClick={() => setEditOpen(true)}>
            Type it in myself
          </button>
        </section>
      ) : (
        <>
          {/* The dashboard — Aaron's "Simple Budget" vision (July 6, 2026),
              one command center: month header + Left-to-Spend/Days-Left
              heroes, cash-flow summary, budget-vs-actual, allocation donut,
              then Income / Expenses / Bills / Saving / Debt panels. All of
              it visible at once — nothing buried down a feed. */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="glass rise col-span-2 p-4 md:col-span-1">
              <div className="flex items-baseline justify-between">
                <div className="font-display text-3xl font-black">{monthName}</div>
                <button className="text-[13px] font-semibold text-accent" onClick={() => setEditOpen(true)}>Edit</button>
              </div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg/45">Budget dashboard · {periodLabel}</div>
              {/* Every headline number is tappable — EILA explains it in plain
                  words (Aaron, July 6: "it needs to be dumbed down or right"). */}
              <div className="mt-3 space-y-1.5 text-[12px]">
                <button className="flex w-full justify-between" onClick={() => askIla("Explain my 'Safe to spend today' number on the Money dashboard — walk me through the exact math in plain words.")}>
                  <span className="text-fg/60">Safe to spend today</span><span className="font-bold tabnum text-good">{sts ? money(sts.available) : "—"}</span>
                </button>
                <button className="flex w-full justify-between" onClick={() => askIla("Explain my next check on the Money dashboard — when it lands, how you got the amount, and whether it's my number or your estimate.")}>
                  <span className="text-fg/60">Next check</span><span className="font-bold tabnum">{money(income.nextCheckAmount)} · {income.nextCheckDate.slice(5).replace("-", "/")}</span>
                </button>
                <button className="flex w-full justify-between" onClick={() => askIla("Explain my month-end cash number on the Money dashboard — does it account for every bill still coming out this month?")}>
                  <span className="text-fg/60">Month-end cash</span><span className={`font-bold tabnum ${sts && sts.projectedMonthEnd < 0 ? "text-warn" : ""}`}>{sts ? money(sts.projectedMonthEnd) : "—"}</span>
                </button>
              </div>
            </div>
            {preIncome ? (
              <button className="glass rise p-4 text-center" style={{ animationDelay: "60ms" }} onClick={() => askIla("Explain the 'Out so far' number on my Money dashboard in plain words — where does it come from and when does it flip to Left to Spend?")}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">Out so far</div>
                <div className="mt-1.5 font-display text-3xl font-black tabnum">
                  <CountUp value={-leftover.actual} format={(n) => money(n)} />
                </div>
                <div className="mt-1 text-[11px] text-fg/50">{money(incomeRow.budget)} in checks still coming</div>
              </button>
            ) : (
              <button className="glass rise p-4 text-center" style={{ animationDelay: "60ms" }} onClick={() => askIla("Explain my 'Left to spend' number on the Money dashboard in plain words — what counts as in and what counts as out?")}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">Left to spend</div>
                <div className={`mt-1.5 font-display text-3xl font-black tabnum ${leftover.actual < 0 ? "text-warn" : "text-good"}`}>
                  <CountUp value={leftover.actual} format={(n) => money(n)} />
                </div>
                <div className="mt-1 text-[11px] text-fg/50">this month’s budget room — not your bank balance</div>
              </button>
            )}
            <button className="glass rise p-4 text-center" style={{ animationDelay: "120ms" }} onClick={() => askIla("How am I tracking against my budget this month? Break it down per category, plain words.")}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">Days left</div>
              <div className="mt-1.5 font-display text-3xl font-black tabnum">{daysLeft}</div>
              <div className="mt-1 text-[11px] text-fg/50">
                {bm && bm.totalBudget > 0 ? `${money(Math.max(0, bm.leftToSpend))} budget left · ~${money(bm.perDayLeft)}/day` : `of ${dim} this month`}
              </div>
            </button>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <div className="glass rise p-4" style={{ animationDelay: "160ms" }}>
              <SectionTitle>In · out · kept</SectionTitle>
              <LedgerTable rows={summary} />
              <p className="mt-2.5 border-t border-fg/6 pt-2 text-[10.5px] leading-relaxed text-fg/45">
                &ldquo;So far&rdquo; counts checks that have landed, bills past their due day, and spending you&apos;ve logged. Off by a bit? Tap Edit or just tell EILA — she&apos;ll fix it.
              </p>
            </div>
            <div className="glass rise p-4" style={{ animationDelay: "200ms" }}>
              <SectionTitle>Your plan vs. real life</SectionTitle>
              <PairedBars rows={summary} />
            </div>
            <div className="glass rise p-4" style={{ animationDelay: "240ms" }}>
              <SectionTitle>Money out so far</SectionTitle>
              <AllocationTracker rows={summary} bills={mBills} />
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <div className="glass rise p-4" style={{ animationDelay: "280ms" }}>
              <SectionTitle>Income</SectionTitle>
              {checks.length === 0 ? (
                <p className="text-[12px] text-fg/55">Set your paydays in Edit — every check shows here, planned vs landed.</p>
              ) : (
                <div className="divide-y divide-fg/6">
                  {checks.map((c) => (
                    <div key={c.date} className="flex items-center justify-between py-2 text-[13px]">
                      <span className="font-semibold">Check · the {c.day}{ordinal(c.day)}</span>
                      <span className="flex items-baseline gap-2">
                        <span className="tabnum font-semibold">{money(c.amount)}</span>
                        <span className={`text-[11px] font-semibold ${c.landed ? "text-good" : "text-fg/45"}`}>{c.landed ? "landed" : "coming"}</span>
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-2 text-[13px] font-bold">
                    <span>Total</span>
                    <span className="tabnum">{money(checks.filter((c) => c.landed).reduce((t, c) => t + c.amount, 0))} / {money(checks.reduce((t, c) => t + c.amount, 0))}</span>
                  </div>
                  {checks.every((c) => !c.landed) && (
                    <button className="w-full pt-2 text-left text-[11px] leading-relaxed text-fg/50" onClick={() => askIla("A check already hit my account this month but Income says $0 counted. Fix my paydays so it shows.")}>
                      Already got a check this month? Then a payday&apos;s missing here — tap Edit, or <span className="font-semibold text-accent">tell EILA</span> and she&apos;ll add it.
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="glass rise p-4" style={{ animationDelay: "320ms" }}>
              <SectionTitle
                action={
                  <span className="flex items-center gap-3">
                    <button className="text-[13px] font-semibold text-accent" onClick={() => setHistoryOpen(true)}>History</button>
                    <button className="text-[13px] font-semibold text-accent" onClick={() => setLogOpen(true)}>Log spend</button>
                  </span>
                }
              >
                Expenses
              </SectionTitle>
              {bm && bm.lines.length > 0 ? (
                <>
                  <div className="space-y-2.5">
                    {bm.lines.map((l) => {
                      const over = l.budget > 0 ? l.pct > 100 : l.actual > 0;
                      return (
                        <button key={l.name} className="block w-full text-left" onClick={() => askIla(`How am I doing on my ${l.name} budget this month?`)}>
                          <div className="flex items-baseline justify-between text-[12px]">
                            <span className="font-semibold">{l.name}</span>
                            <span className={`tabnum font-semibold ${over ? "text-warn" : "text-fg/60"}`}>
                              {money(l.actual)}{l.budget > 0 ? ` / ${money(l.budget)}` : " · unplanned"}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fg/8">
                            <div
                              className={`h-full rounded-full transition-[width] duration-700 ${over ? "bg-warn" : "bg-gradient-to-r from-accent2 to-accent"}`}
                              style={{ width: `${l.budget > 0 ? Math.min(100, l.pct) : l.actual > 0 ? 100 : 0}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-fg/6 pt-2 text-[13px] font-bold">
                    <span>Total</span>
                    <span className="tabnum">{money(bm.totalSpent)} / {money(bm.totalBudget)}</span>
                  </div>
                  {bm.totalSpent === 0 && (
                    <p className="pt-2 text-[11px] leading-relaxed text-fg/50">
                      This only counts what you log — tap <span className="font-semibold">Log spend</span> or tell EILA (&ldquo;spent 40 on gas&rdquo;) and it lands here.
                    </p>
                  )}
                </>
              ) : (
                <div>
                  <p className="text-[12px] text-fg/55">Set a number per category — food, gas, fun — and this panel scores the month against it.</p>
                  {cfg.spendingProfile && cfg.spendingProfile.categories.length > 0 && (
                    <button className="btn btn-primary btn-block mt-3" onClick={() => updateMoney({ ...cfg, budgets: seedBudgetsFromProfile(cfg) })}>
                      <Sparkles size={15} /> Start from your scanned pattern
                    </button>
                  )}
                  <button className="btn btn-ghost btn-block mt-2" onClick={() => setEditOpen(true)}>Set budgets</button>
                </div>
              )}
            </div>

            <div className="glass rise p-4" style={{ animationDelay: "360ms" }}>
              <SectionTitle
                action={
                  <button className="text-[13px] font-semibold text-accent" disabled={scanning} onClick={() => scanInput.current?.click()}>
                    {scanning ? "Reading…" : "Scan statement"}
                  </button>
                }
              >
                Bills
              </SectionTitle>
              {scanMsg && <p className="mb-2 text-[12px] text-warn">{scanMsg}</p>}
              <MonthBillList items={mBills.filter((b) => !b.bill.isDebt)} empty="No dated bills this month. Add them in Edit and they land here." />
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <div className="glass rise p-4" style={{ animationDelay: "400ms" }}>
              <SectionTitle
                action={<button className="text-[13px] font-semibold text-accent" onClick={() => setEditOpen(true)}>Edit</button>}
              >
                Saving
              </SectionTitle>
              {cfg.savingsBalance != null && (
                <button
                  className="mb-3 flex w-full items-center justify-between border-b border-fg/6 pb-2.5 text-left"
                  onClick={() => askIla("Explain my savings bucket — why it's separate from checking and doesn't feed safe-to-spend.")}
                >
                  <span className="text-[12px] font-semibold">💰 In savings <span className="font-normal text-fg/50">· its own bucket</span></span>
                  <span className="tabnum text-[15px] font-bold">{money(cfg.savingsBalance)}</span>
                </button>
              )}
              {cfg.goals.length === 0 ? (
                <p className="text-[12px] text-fg/55">Give EILA something to fight for with you — a trip, a truck, a debt gone, a cushion.</p>
              ) : (
                <div className="space-y-3">
                  {cfg.goals.map((g) => {
                    const gpct = goalProgress(g);
                    return (
                      <button
                        key={g.id}
                        className="block w-full text-left"
                        onClick={() => askIla(`Let's talk about my "${g.name}" goal — I'm at $${g.saved.toLocaleString()} of $${g.target.toLocaleString()}. How do I get there faster?`)}
                      >
                        <div className="flex items-baseline justify-between text-[12px]">
                          <span className="font-semibold">{g.emoji ? `${g.emoji} ` : ""}{g.name}</span>
                          <span className="tabnum font-semibold text-fg/60">{money(g.saved)} / {money(g.target)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fg/8">
                          <div className="h-full rounded-full bg-gradient-to-r from-accent2 to-accent transition-[width] duration-700" style={{ width: `${gpct}%` }} />
                        </div>
                        <div className="mt-0.5 text-[10px] text-fg/50">{gpct}% there{gpct >= 100 ? " — DONE. Tell EILA. 🎉" : ""}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="glass rise p-4" style={{ animationDelay: "440ms" }}>
              <SectionTitle>Debt</SectionTitle>
              <MonthBillList items={mBills.filter((b) => b.bill.isDebt)} empty='Mark a bill as "debt" in Edit (truck note, cards) and payments track here.' />
            </div>

            <div className="glass rise p-4" style={{ animationDelay: "480ms" }}>
              <SectionTitle>Next 30 days</SectionTitle>
              {flow.length > 0 ? (
                <>
                  <CashCurve points={flow} />
                  {low && (
                    <div className={`mt-2 text-[12px] ${low.balance < 0 ? "text-warn" : "text-fg/55"}`}>
                      Lowest point: {money(low.balance)} on {low.date.slice(5).replace("-", "/")}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-fg/55">Enter your checking balance in Edit and the cash curve draws here.</p>
              )}
            </div>
          </section>
        </>
      )}

      {/* hidden file input behind every scan button — camera or files on phone, picker on desktop */}
      <input
        ref={scanInput}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => runScan(e.target.files)}
      />

      <MoneySetupSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        cfg={cfg}
        onSave={(c, seeded) => {
          // Merge-don't-clobber, done for real: write the user's DIFF (draft vs
          // the config the sheet SEEDED from) over the LATEST config — never the
          // whole frozen draft. A field changed elsewhere while the sheet sat
          // open (EILA's update_money, a scan, a cloud pull) survives unless the
          // user edited that same field. (The old version diffed bill ids
          // against the render-time cfg — which re-renders to ≡ latest, so its
          // "added meanwhile" merge could never fire.)
          const latest = data.profile?.money ?? c;
          const diff = changedFields(seeded, c);
          const merged: MoneyConfig = { ...latest, ...diff };
          // paydays + checkNets move as a GLUED PAIR — each amount belongs to
          // its day. If the user touched either half, both come from the draft;
          // a field-level split could marry EILA's amounts to the user's days.
          if ("paydays" in diff || "payday" in diff || "checkNets" in diff) {
            merged.paydays = c.paydays; merged.payday = c.payday; merged.checkNets = c.checkNets;
          }
          // Lists merge ROW BY ROW (a row edit changes the whole array, so the
          // field diff can't protect siblings): the user's edited/added rows
          // win; rows they didn't touch follow the latest — including edits and
          // removals made mid-sheet by EILA or a scan. No reverts, no ghosts.
          merged.bills = mergeListBy((b) => b.id, seeded.bills, c.bills, latest.bills ?? []);
          merged.goals = mergeListBy((g) => g.id, seeded.goals, c.goals, latest.goals ?? []);
          const budgets = mergeListBy((b) => b.name.trim().toLowerCase(), seeded.budgets ?? [], c.budgets ?? [], latest.budgets ?? []);
          merged.budgets = budgets.length ? budgets : undefined;
          // spend isn't editable in the sheet — the live ledger always wins
          // (an EILA log_spend mid-edit must survive the save).
          merged.spend = latest.spend ?? c.spend;
          merged.spendingProfile = latest.spendingProfile ?? c.spendingProfile;
          updateMoney(merged);
          setEditOpen(false);
        }}
      />
      <SpendLogSheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        cfg={cfg}
        onRemove={(id) => updateMoney(removeSpend(cfg, id))}
        onReclassify={(merchant, kind, category) => updateMoney(setMerchantRule(cfg, merchant, kind, category, todayIso()))}
      />
      <LogSpendSheet
        open={logOpen}
        onClose={() => setLogOpen(false)}
        cfg={cfg}
        onLog={(amount, category, note) => {
          updateMoney(addSpend(cfg, { amount, category, note }, todayIso(), uid));
          setLogOpen(false);
        }}
      />
      <StatementReviewSheet
        scan={scan}
        onClose={() => setScan(null)}
        onApprove={(kept) => {
          if (!scan) return;
          updateMoney(applyStatementScan(cfg, scan, kept, todayIso(), () => Math.random().toString(36).slice(2, 10)));
          setScan(null);
        }}
      />
    </div>
  );
}

/** Review-then-approve for a statement scan — picture-book clear: here's what
 * she found, tap off anything that's wrong, one big button saves it. */
function StatementReviewSheet({
  scan, onClose, onApprove,
}: { scan: StatementScan | null; onClose: () => void; onApprove: (kept: StatementScan["bills"]) => void }) {
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [seen, setSeen] = useState<StatementScan | null>(null);
  if (scan && seen !== scan) { setSeen(scan); setDropped(new Set()); }

  if (!scan) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const kept = scan.bills.filter((_, i) => !dropped.has(i));
  return (
    <Sheet open={!!scan} onClose={onClose} title="Here's what EILA found">
      <div className="space-y-4 pb-2">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15">
            <Sparkles size={17} className="text-accent2" />
          </span>
          <p className="text-[14px] leading-relaxed text-fg/85">
            I read {scan.monthsAnalyzed} month{scan.monthsAnalyzed === 1 ? "" : "s"} of your statement{scan.monthsAnalyzed === 1 ? "" : "s"}.
            {scan.bills.length ? ` These ${scan.bills.length} charges come out on repeat — tap off any that don't belong, and I'll watch the rest for you.` : " I didn't spot clearly-recurring charges — you can add bills by hand."}
          </p>
        </div>

        {scan.bills.length > 0 && (
          <div className="space-y-2">
            {scan.bills.map((b, i) => {
              const off = dropped.has(i);
              return (
                <button
                  key={`${b.name}-${i}`}
                  className={`glass flex w-full items-center gap-3 p-3 text-left transition-opacity ${off ? "opacity-40" : ""}`}
                  style={{ borderRadius: 14 }}
                  onClick={() => {
                    const next = new Set(dropped);
                    if (off) next.delete(i); else next.add(i);
                    setDropped(next);
                  }}
                  aria-pressed={!off}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${off ? "border-fg/25" : "border-accent bg-accent text-white"}`}>
                    {!off && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{b.name}</span>
                    <span className="block text-[11px] text-fg/55">around the {b.dayOfMonth}{ordinal(b.dayOfMonth)}{b.isSubscription ? " · subscription" : ""}</span>
                  </span>
                  <span className="font-display text-[15px] font-bold tabnum">${b.amount.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        )}

        {(scan.endingBalance > 0 || scan.monthlySpend > 0) && (
          <div className="glass space-y-1.5 p-3.5" style={{ borderRadius: 14 }}>
            {scan.endingBalance > 0 && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-fg/65">Latest balance on the statement</span>
                <span className="font-bold tabnum">${scan.endingBalance.toLocaleString()}</span>
              </div>
            )}
            {scan.monthlySpend > 0 && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-fg/65">Your everyday spending runs about</span>
                <span className="font-bold tabnum">${scan.monthlySpend.toLocaleString()}/mo</span>
              </div>
            )}
            {scan.categories.slice(0, 4).map((c) => (
              <div key={c.name} className="flex items-center justify-between text-[12px] text-fg/55">
                <span>· {c.name}</span>
                <span className="tabnum">${c.monthly.toLocaleString()}/mo</span>
              </div>
            ))}
          </div>
        )}

        <button className="btn btn-primary btn-block" onClick={() => onApprove(kept)}>
          <Check size={16} /> Looks right — save {kept.length ? `${kept.length} bill${kept.length === 1 ? "" : "s"} + my pattern` : "my pattern"}
        </button>
        <button className="btn btn-ghost btn-block" onClick={onClose}>Cancel — save nothing</button>
      </div>
    </Sheet>
  );
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][Math.min(n % 10, 4)] ?? "th";
}

/** The CASH FLOW story — money in, money out (bills / debt / everyday),
 * money kept — written the way a person says it, not a ledger. (July 13:
 * the Category|Budget|So-far table read as a contradiction machine.) */
function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const get = (label: string) => rows.find((r) => r.label === label) ?? { label, budget: 0, actual: 0 };
  const income = get("Income");
  const bills = get("Bills");
  const debt = get("Debt");
  const everyday = get("Expenses");
  const kept = get("Leftover");
  const outActual = bills.actual + debt.actual + everyday.actual;
  const outBudget = bills.budget + debt.budget + everyday.budget;
  const subs = [
    { name: "Bills", r: bills },
    { name: "Debt", r: debt },
    { name: "Everyday spending", r: everyday },
  ].filter((x) => x.r.budget > 0 || x.r.actual > 0);

  return (
    <div className="text-[13px]">
      <div className="flex items-baseline justify-between py-1.5">
        <span className="font-semibold">Money in</span>
        <span className="tabnum"><span className="font-bold text-good">{money(income.actual)}</span>
          <span className="text-[11px] text-fg/45"> of {money(income.budget)} expected</span></span>
      </div>
      <div className="flex items-baseline justify-between border-t border-fg/6 py-1.5">
        <span className="font-semibold">Money out</span>
        <span className="tabnum"><span className="font-bold">{money(outActual)}</span>
          <span className="text-[11px] text-fg/45"> of {money(outBudget)} planned</span></span>
      </div>
      {subs.map(({ name, r }) => (
        <div key={name} className="flex items-baseline justify-between py-1 pl-4 text-[12px] text-fg/60">
          <span>{name}</span>
          <span className="tabnum">{money(r.actual)} <span className="text-[10.5px] text-fg/40">of {money(r.budget)}</span></span>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between border-t border-fg/10 pt-2">
        <span className="font-bold">Kept so far</span>
        <span className="tabnum"><span className={`font-bold ${kept.actual < 0 ? "text-warn" : "text-good"}`}>{money(kept.actual)}</span>
          <span className="text-[11px] text-fg/45"> · plan says {money(kept.budget)} by month-end</span></span>
      </div>
    </div>
  );
}

/** PLAN VS. REAL LIFE — one plain-worded row per money bucket: what's happened
 * so far, out of what you planned, with a single fill-the-bucket bar. Written to
 * be understood at a glance with zero finance words. */
function PairedBars({ rows }: { rows: LedgerRow[] }) {
  const data = rows.filter((r) => r.label !== "Leftover");
  // Plain title + a caption that says, in order, what the two numbers ARE.
  const copy = (label: string): { title: string; caption: string; verb: string } => {
    if (label === "Income") return { title: "Money coming in", caption: "made so far · expected this month", verb: "made" };
    if (label === "Expenses") return { title: "Everyday spending", caption: "spent so far · what you planned to spend", verb: "spent" };
    if (label === "Bills") return { title: "Bills", caption: "paid so far · total for the month", verb: "paid" };
    if (label === "Debt") return { title: "Debt payments", caption: "paid so far · planned this month", verb: "paid" };
    return { title: label, caption: "so far · planned", verb: "so far" };
  };
  return (
    <div className="space-y-3.5">
      {data.map((r) => {
        const isIncome = r.label === "Income";
        const over = !isIncome && r.actual > r.budget;
        const pct = r.budget > 0 ? Math.min(100, Math.round((r.actual / r.budget) * 100)) : (r.actual > 0 ? 100 : 0);
        const c = copy(r.label);
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-bold text-fg/80">{c.title}</span>
              <span className="tabnum text-[13px] text-fg/70">
                <span className="font-bold text-fg">{money(r.actual)}</span> of {money(r.budget)}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 rounded-full bg-fg/10">
              <div className={`h-full rounded-full ${isIncome ? "bg-good" : over ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex items-baseline justify-between text-[10.5px] text-fg/45">
              <span>{c.caption}</span>
              {over
                ? <span className="font-semibold text-warn">{money(r.actual - r.budget)} over plan</span>
                : isIncome
                  ? <span>{money(Math.max(0, r.budget - r.actual))} still expected</span>
                  : <span>{money(Math.max(0, r.budget - r.actual))} left</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** MONEY OUT SO FAR — replaces the old allocation donut. This reads as a
 * tracker: total out, biggest pressure, category shares, and what's still
 * scheduled. */
function AllocationTracker({ rows, bills }: { rows: LedgerRow[]; bills: MonthBill[] }) {
  const get = (label: LedgerRow["label"]) => rows.find((r) => r.label === label) ?? { label, budget: 0, actual: 0 };
  const categories = [
    {
      label: "Everyday",
      row: get("Expenses"),
      color: "bg-good",
      text: "text-good",
      note: "logged spending",
    },
    {
      label: "Bills",
      row: get("Bills"),
      color: "bg-accent",
      text: "text-accent",
      note: "must-pay bills",
    },
    {
      label: "Debt",
      row: get("Debt"),
      color: "bg-warn",
      text: "text-warn",
      note: "loan/card payments",
    },
  ].filter((c) => c.row.actual > 0 || c.row.budget > 0);
  const total = categories.reduce((s, c) => s + c.row.actual, 0);
  if (!total) {
    return <p className="text-[12px] text-fg/55">Nothing out the door yet — this fills in as bills land and spend gets logged.</p>;
  }
  const plannedOut = categories.reduce((s, c) => s + c.row.budget, 0);
  const biggest = categories.reduce((hi, c) => (c.row.actual > hi.row.actual ? c : hi), categories[0]);
  const remainingScheduled = bills.filter((b) => !b.landed).reduce((s, b) => s + b.bill.amount, 0);
  const paidBills = bills
    .filter((b) => b.landed)
    .sort((a, b) => b.bill.amount - a.bill.amount)
    .slice(0, 3);
  const pct = (value: number, base = total) => Math.round((value / Math.max(1, base)) * 100);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-fg/45">Out this month</div>
          <div className="mt-1 font-display text-3xl font-black tabnum">{money(total)}</div>
          <div className="mt-0.5 text-[11px] text-fg/50">
            {total > plannedOut ? `${money(total - plannedOut)} over plan` : `${money(Math.max(0, plannedOut - total))} planned left`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[10.5px] font-bold uppercase tracking-wider ${biggest.text}`}>biggest</div>
          <div className="mt-1 text-[12px] font-bold tabnum text-fg/75">{biggest.label} · {pct(biggest.row.actual)}%</div>
        </div>
      </div>

      <div className="flex h-3 overflow-hidden rounded-full bg-fg/8" aria-label="Money out by category">
        {categories.filter((c) => c.row.actual > 0).map((c) => (
          <div
            key={c.label}
            className={`${c.color} h-full transition-[width] duration-700`}
            style={{ width: `${Math.max(4, pct(c.row.actual))}%` }}
            title={`${c.label}: ${money(c.row.actual)}`}
          />
        ))}
      </div>

      <div className="space-y-2">
        {categories.map((c) => {
          const share = pct(c.row.actual);
          const usedPlan = pct(c.row.actual, c.row.budget || c.row.actual);
          const over = c.row.budget > 0 && c.row.actual > c.row.budget;
          return (
            <div key={c.label}>
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${c.color}`} />
                  <span className="truncate">{c.label}</span>
                  <span className="hidden text-[10.5px] font-medium text-fg/40 sm:inline">{c.note}</span>
                </span>
                <span className="shrink-0 tabnum font-bold">{money(c.row.actual)} · {share}%</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/8">
                  <div className={`h-full rounded-full ${over ? "bg-warn" : c.color}`} style={{ width: `${Math.min(100, Math.max(0, usedPlan))}%` }} />
                </div>
                <span className={`w-[54px] text-right text-[10px] tabnum ${over ? "font-bold text-warn" : "text-fg/45"}`}>
                  {c.row.budget > 0 ? `${usedPlan}%` : "new"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-fg/6 pt-2">
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className="font-semibold text-fg/55">Still scheduled</span>
          <span className="tabnum font-bold text-fg/75">{money(remainingScheduled)}</span>
        </div>
        {paidBills.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {paidBills.map((item) => (
              <div key={`${item.bill.id}-${item.date}`} className="flex items-center justify-between gap-3 text-[11px] text-fg/55">
                <span className="min-w-0 truncate">{item.bill.name}</span>
                <span className="shrink-0 tabnum">{money(item.bill.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** BILLS / DEBT panel body — the month's instances, paid ✓ or coming, with a
 * paid-so-far progress footer. */
function MonthBillList({ items, empty }: { items: MonthBill[]; empty: string }) {
  if (!items.length) return <p className="text-[12px] text-fg/55">{empty}</p>;
  const total = items.reduce((s, i) => s + i.bill.amount, 0);
  const landed = items.filter((i) => i.landed).reduce((s, i) => s + i.bill.amount, 0);
  return (
    <div>
      <div className="divide-y divide-fg/6">
        {items.map((i) => (
          <div key={`${i.bill.id}-${i.date}`} className="flex items-center justify-between py-2 text-[13px]">
            <span className="min-w-0">
              <span className="block truncate font-semibold">{i.bill.name}</span>
              <span className="block text-[10px] text-fg/50">
                the {Number(i.date.slice(8))}{ordinal(Number(i.date.slice(8)))}{i.bill.isSubscription ? " · subscription" : ""}{i.bill.isSavings ? " · 💰 pay yourself" : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="tabnum font-semibold">{money(i.bill.amount)}</span>
              <span className={`text-[11px] font-semibold ${i.landed ? "text-good" : "text-fg/45"}`}>{i.landed ? "paid" : "coming"}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-fg/6 pt-2">
        <div className="flex items-center justify-between text-[13px] font-bold">
          <span>Total</span>
          <span className="tabnum">{money(landed)} / {money(total)}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fg/8">
          <div className="h-full rounded-full bg-gradient-to-r from-accent2 to-accent transition-[width] duration-700" style={{ width: `${total > 0 ? Math.round((landed / total) * 100) : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

/** The picture-book drop zone (Aaron's standard, July 5: "you open it up and
 * boom — it pops out at you and tells you what to do"). One glance says it
 * all: big scanner art, a bouncing arrow, plain words, the whole card is the
 * button. Drag-and-drop on desktop; tap opens the camera/file picker on phone. */
function StatementDropZone({ scanning, onPick, onFiles }: { scanning: boolean; onPick: () => void; onFiles: (files: FileList | null) => void }) {
  const [over, setOver] = useState(false);
  return (
    <button
      className={`mt-4 w-full rounded-[24px] border-2 border-dashed p-6 text-center transition-all duration-200 active:scale-[0.98] ${
        over ? "scale-[1.02] border-accent bg-accent/10" : "border-accent/40 bg-accent/[0.04]"
      }`}
      disabled={scanning}
      onClick={onPick}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
      aria-label="Scan your bank statement"
    >
      {scanning ? (
        <>
          <span className="mx-auto grid h-16 w-16 animate-pulse place-items-center rounded-2xl bg-accent/15 text-accent">
            <FileScan size={30} />
          </span>
          <div className="mt-3 font-display text-lg font-black">Reading your statement…</div>
          <p className="mt-1 text-[13px] text-fg/60">EILA&apos;s finding your bills and your pattern. ~20 seconds.</p>
        </>
      ) : (
        <>
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-accent/15 text-accent">
            <FileScan size={30} />
          </span>
          <div className="mt-2 text-accent motion-safe:animate-bounce" aria-hidden>
            <ArrowDown size={22} className="mx-auto" strokeWidth={2.6} />
          </div>
          <div className="font-display text-lg font-black">Drop your bank statement here</div>
          <p className="mx-auto mt-1.5 max-w-[32ch] text-[13px] leading-relaxed text-fg/65">
            Photos or PDFs · up to 6 at once, any of your banks. EILA finds your autopay bills and your spending pattern <span className="font-semibold text-fg/80">for you</span>.
          </p>
          <p className="mt-2 text-[11px] text-fg/45">You approve everything before it saves. The statement itself is never stored.</p>
        </>
      )}
    </button>
  );
}

/** Hand-rolled SVG cash-flow curve on the design tokens (same pattern as
 * Performance.tsx charts — no chart lib). */
function CashCurve({ points }: { points: { date: string; balance: number }[] }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  const W = 320, H = 96, PAD = 4;
  const vals = points.map((p) => p.balance);
  const lo = Math.min(...vals, 0);
  const hi = Math.max(...vals, 1);
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="Projected cash over the next 30 days">
      {lo < 0 && <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="rgb(var(--warn) / 0.45)" strokeDasharray="3 4" strokeWidth="1" />}
      <path
        d={`${path} L${x(points.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z`}
        fill="rgb(var(--accent) / 0.10)"
      />
      <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round"
        pathLength={1} strokeDasharray={1} strokeDashoffset={on ? 0 : 1}
        style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.2,0.8,0.2,1)" }} />
    </svg>
  );
}

/** One-tap spend logging — amount, a category chip, done. The chips are the
 * user's own budget categories first, familiar defaults after. */
export function LogSpendSheet({
  open, onClose, cfg, onLog,
}: { open: boolean; onClose: () => void; cfg: MoneyConfig; onLog: (amount: number, category: string, note?: string) => void }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [nudge, setNudge] = useState("");
  const [seenOpen, setSeenOpen] = useState(false);
  if (open && !seenOpen) { setAmount(""); setCategory(""); setNote(""); setNudge(""); setSeenOpen(true); }
  if (!open && seenOpen) setSeenOpen(false);

  const chips = [...new Set([
    ...(cfg.budgets ?? []).map((b) => b.name),
    ...(cfg.spendingProfile?.categories ?? []).map((c) => c.name),
    "Food", "Gas", "Fun", "Shopping", "Other",
  ])].slice(0, 10);
  const amt = parseNumericInput(amount);

  return (
    <Sheet open={open} onClose={onClose} title="Log what you spent">
      <div className="space-y-4 pb-2">
        <Labeled label="How much?">
          <input className="field" inputMode="decimal" placeholder="e.g. 42" autoFocus
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Labeled>
        <div>
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">On what?</div>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  category.toLowerCase() === c.toLowerCase() ? "border-accent bg-accent text-white" : "border-fg/15 text-fg/75"
                }`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <input className="field mt-2" placeholder="…or type a category" value={category}
            onChange={(e) => setCategory(e.target.value)} />
        </div>
        <Labeled label="Note (optional)">
          <input className="field" placeholder="lunch with Tony" value={note} onChange={(e) => setNote(e.target.value)} />
        </Labeled>
        {nudge && <p className="px-1 text-center text-[12.5px] font-semibold text-warn">{nudge}</p>}
        <button
          className="btn btn-primary btn-block"
          onClick={() => {
            // Never a dead button: missing amount gets a plain ask, missing
            // category just files under Other (July 12 field report — the
            // silently-disabled button read as "logging is broken").
            if (!(amt > 0)) { setNudge("Type how much you spent — that's the only must-have."); return; }
            onLog(amt, category.trim() || "Other", note.trim() || undefined);
          }}
        >
          <Check size={16} /> Log {amt > 0 ? money(amt) : "it"}
        </button>
      </div>
    </Sheet>
  );
}

// Plain-English buckets for the "what is this?" tap. No jargon.
const SPEND_CATEGORIES = ["Groceries", "Gas", "Dining", "Shopping", "Fun", "Other"];

/** The spend log, editable — every purchase (synced or logged), newest first.
 * Tap a synced line to tell the app in plain words what it really is; it
 * remembers that merchant for every past and future charge. One tap also
 * removes a hand-logged entry. */
export function SpendLogSheet({
  open, onClose, cfg, onRemove, onReclassify,
}: {
  open: boolean; onClose: () => void; cfg: MoneyConfig;
  onRemove: (id: string) => void;
  onReclassify: (merchant: string, kind: MerchantRule["kind"] | "remove", category?: string) => void;
}) {
  const entries = [...(cfg.spend ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickCatFor, setPickCatFor] = useState<string | null>(null);
  const ruleKeys = new Set((cfg.merchantRules ?? []).map((r) => merchantKeyFor(r.key)));
  const isLearned = (merchant?: string) => !!merchant && ruleKeys.has(merchantKeyFor(merchant));

  const choose = (merchant: string, kind: MerchantRule["kind"] | "remove", category?: string) => {
    onReclassify(merchant, kind, category);
    setOpenId(null);
    setPickCatFor(null);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Your spending">
      <div className="space-y-2 pb-2">
        {entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-fg/60">Nothing here yet. Connect your bank and your purchases show up automatically — or log one by hand.</p>
        ) : (
          entries.map((e) => {
            const merchant = e.note || e.category;
            const isBank = e.source === "bank";
            const expanded = openId === e.id;
            return (
              <div key={e.id} className="glass p-3" style={{ borderRadius: 14 }}>
                <div className="flex items-center gap-3">
                  {/* Tap the line itself to fix what it is (synced lines only). */}
                  <button
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                    disabled={!isBank}
                    onClick={() => { setOpenId(expanded ? null : e.id); setPickCatFor(null); }}
                    aria-label={isBank ? `Fix what "${merchant}" is` : undefined}
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <span className="truncate">{merchant}</span>
                      {isLearned(merchant) && <Check size={12} className="shrink-0 text-accent" aria-label="Remembered" />}
                    </div>
                    <div className="text-[11px] text-fg/50">
                      {e.category} · {e.date.slice(5).replace("-", "/")}{isBank ? " · tap to fix" : ""}
                    </div>
                  </button>
                  <div className="font-display text-[15px] font-bold tabnum">${Math.round(e.amount).toLocaleString()}</div>
                  {!isBank && (
                    <button
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fg/6 text-fg/55 active:scale-95"
                      onClick={() => onRemove(e.id)}
                      aria-label={`Remove $${Math.round(e.amount)} ${e.category}`}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {expanded && isBank && (
                  <div className="mt-3 border-t border-fg/8 pt-3">
                    {pickCatFor === e.id ? (
                      <>
                        <p className="mb-2 text-[12px] font-semibold text-fg/70">What kind of everyday spending?</p>
                        <div className="flex flex-wrap gap-2">
                          {SPEND_CATEGORIES.map((c) => (
                            <button key={c} className="btn btn-ghost px-3 py-1.5 text-[13px]" onClick={() => choose(merchant, "everyday", c)}>{c}</button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mb-2 text-[12px] font-semibold text-fg/70">What is this, really?</p>
                        <div className="grid grid-cols-1 gap-2">
                          <button className="btn btn-ghost justify-start py-2 text-[13px]" onClick={() => setPickCatFor(e.id)}>🛒 Everyday spending</button>
                          <button className="btn btn-ghost justify-start py-2 text-[13px]" onClick={() => choose(merchant, "bill")}>🧾 A bill</button>
                          <button className="btn btn-ghost justify-start py-2 text-[13px]" onClick={() => choose(merchant, "debt")}>💳 Debt or loan payment</button>
                          <button className="btn btn-ghost justify-start py-2 text-[13px]" onClick={() => choose(merchant, "ignore")}>🔄 Not spending — I just moved my money</button>
                          {isLearned(merchant) && (
                            <button className="btn btn-ghost justify-start py-2 text-[13px] text-fg/55" onClick={() => choose(merchant, "remove")}>↩︎ Back to automatic</button>
                          )}
                        </div>
                        <p className="mt-2 text-[11px] text-fg/45">I&apos;ll remember {merchant} and fix every past and future charge.</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <p className="px-1 pt-1 text-[11px] text-fg/45">Every change recalculates your budget, ledger, and today&apos;s number instantly.</p>
      </div>
    </Sheet>
  );
}

/** Setup / edit sheet: balance, payday, essentials, bills, budgets, goals. */
function MoneySetupSheet({
  open, onClose, cfg, onSave,
}: { open: boolean; onClose: () => void; cfg: MoneyConfig; onSave: (c: MoneyConfig, seeded: MoneyConfig) => void }) {
  const [draft, setDraft] = useState<MoneyConfig>(cfg);
  // The config this draft was seeded FROM — the baseline the save diffs
  // against, so only fields the user actually edited get written.
  const seed = useRef<MoneyConfig>(cfg);
  // Paydays field keeps the user's RAW typing ("10, 15, 30") — reformatting
  // a controlled input on every keystroke eats the comma mid-type.
  const [paydaysText, setPaydaysText] = useState("");
  // Check amounts too — one amount, or one PER payday in the same order
  // ("3000, 800, 3000" against paydays "1, 10, 15").
  const [netsText, setNetsText] = useState("");
  // Re-seed the draft each time the sheet opens with current saved state.
  const [seenOpen, setSeenOpen] = useState(false);
  if (open && !seenOpen) {
    setDraft(cfg);
    seed.current = cfg;
    setPaydaysText(cfg.paydays?.join(", ") ?? (cfg.payday != null ? String(cfg.payday) : ""));
    setNetsText(cfg.checkNets?.join(", ") ?? "");
    setSeenOpen(true);
  }
  if (!open && seenOpen) setSeenOpen(false);

  const setBill = (id: string, patch: Partial<Bill>) =>
    setDraft({ ...draft, bills: draft.bills.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const setGoal = (id: string, patch: Partial<MoneyGoal>) =>
    setDraft({ ...draft, goals: draft.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) });

  return (
    <Sheet open={open} onClose={onClose} title="Your money picture">
      <div className="space-y-4 pb-2">
        <Labeled label="Checking balance today" hint="EILA anchors safe-to-spend on this — update it whenever.">
          <input
            className="field" inputMode="decimal" placeholder="e.g. 4,200"
            value={draft.checkingBalance ?? ""}
            onChange={(e) => setDraft({
              ...draft,
              checkingBalance: e.target.value === "" ? undefined : parseNumericInput(e.target.value),
              balanceAsOf: todayIso(), // LOCAL day — toISOString dates an evening update tomorrow
            })}
          />
        </Labeled>
        <Labeled label="Savings balance (optional)" hint="Savings + reserve accounts, total. Its own bucket — shown separately, never mixed into spendable cash.">
          <input
            className="field" inputMode="decimal" placeholder="e.g. 1,820"
            value={draft.savingsBalance ?? ""}
            onChange={(e) => setDraft({ ...draft, savingsBalance: e.target.value === "" ? undefined : Math.max(0, parseNumericInput(e.target.value)) })}
          />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Paydays (days of month)" hint="Every day a check lands — e.g. 10, 15, 30.">
            <input
              className="field" placeholder="10, 15, 30"
              value={paydaysText}
              onChange={(e) => {
                setPaydaysText(e.target.value);
                const days = e.target.value.split(/[,\s]+/).map((s) => parseNumericInput(s)).filter((n) => n >= 1 && n <= 31).slice(0, 4);
                // Text present but nothing valid (e.g. "45") → keep the last
                // good paydays instead of silently modeling "paid on the 1st".
                if (e.target.value.trim() && !days.length) return;
                setDraft({ ...draft, paydays: days.length ? days : undefined, payday: days[0] });
              }}
              onBlur={() => setPaydaysText(draft.paydays?.join(", ") ?? "")}
            />
          </Labeled>
          <Labeled label="Check amounts (net, optional)" hint="Take-home per check. One number = every check; or one per payday in the same order (3000, 800, 3000). She'll use YOUR numbers over her estimate.">
            <input
              className="field" placeholder="3,225 or 3000, 800, 3000"
              value={netsText}
              onChange={(e) => {
                setNetsText(e.target.value);
                const nets = e.target.value.split(/[,\s]+/).map((s) => parseNumericInput(s)).filter((n) => n > 0).slice(0, 4);
                if (e.target.value.trim() && !nets.length) return;
                setDraft({ ...draft, checkNets: nets.length ? nets : undefined });
              }}
              onBlur={() => setNetsText(draft.checkNets?.join(", ") ?? "")}
            />
          </Labeled>
          <Labeled label="Never-go-below floor" hint="Dollars that must ALWAYS stay in checking — after bills and savings. Default $1,000.">
            <input
              className="field" inputMode="decimal" placeholder="1,000"
              value={draft.cushion ?? ""}
              onChange={(e) => setDraft({ ...draft, cushion: e.target.value === "" ? undefined : Math.max(0, parseNumericInput(e.target.value)) })}
            />
          </Labeled>
          <Labeled label="Monthly essentials" hint="Groceries, gas, life — outside named bills.">
            <input
              className="field" inputMode="decimal" placeholder="e.g. 900"
              value={draft.monthlyEssentials || ""}
              onChange={(e) => setDraft({ ...draft, monthlyEssentials: parseNumericInput(e.target.value) })}
            />
          </Labeled>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg/70">Bills</span>
            <button
              className="flex items-center gap-1 text-[13px] font-semibold text-accent"
              onClick={() => setDraft({ ...draft, bills: [...draft.bills, { id: uid(), name: "", amount: 0, cadence: "monthly" as BillCadence, dayOfMonth: 1 }] })}
            >
              <Plus size={14} /> Add bill
            </button>
          </div>
          <div className="space-y-2">
            {draft.bills.map((b) => (
              <div key={b.id} className="glass flex items-center gap-2 p-2.5" style={{ borderRadius: 14 }}>
                <input className="field !w-[28%] !px-2 !py-2 text-sm" placeholder="Rent" value={b.name}
                  onChange={(e) => setBill(b.id, { name: e.target.value })} />
                <input className="field !w-[20%] !px-2 !py-2 text-sm" inputMode="decimal" placeholder="$"
                  value={b.amount || ""} onChange={(e) => setBill(b.id, { amount: parseNumericInput(e.target.value) })} />
                <input className="field !w-[13%] !px-2 !py-2 text-sm" inputMode="numeric" placeholder="day"
                  value={b.dayOfMonth ?? ""} onChange={(e) => setBill(b.id, { dayOfMonth: e.target.value === "" ? undefined : Math.min(31, Math.max(1, parseNumericInput(e.target.value))) })} />
                <button
                  className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${b.isDebt ? "border-warn bg-warn/15 text-warn" : "border-fg/15 text-fg/45"}`}
                  onClick={() => setBill(b.id, { isDebt: !b.isDebt || undefined, isSavings: undefined })}
                  aria-pressed={!!b.isDebt}
                  title="Debt payments (truck note, cards) show in the dashboard's Debt panel"
                >
                  debt
                </button>
                <button
                  className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${b.isSavings ? "border-good bg-good/15 text-good" : "border-fg/15 text-fg/45"}`}
                  onClick={() => setBill(b.id, { isSavings: !b.isSavings || undefined, isDebt: undefined })}
                  aria-pressed={!!b.isSavings}
                  title="Paying yourself — a savings transfer treated as a mandatory bill"
                >
                  save
                </button>
                <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fg/6 text-fg/55"
                  onClick={() => setDraft({ ...draft, bills: draft.bills.filter((x) => x.id !== b.id) })} aria-label={`Remove ${b.name || "bill"}`}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {draft.bills.length === 0 && <p className="px-1 text-[12px] text-fg/55">Rent, truck payment, insurance, subscriptions…</p>}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg/70">Monthly budget</span>
            <button
              className="flex items-center gap-1 text-[13px] font-semibold text-accent"
              onClick={() => setDraft({ ...draft, budgets: [...(draft.budgets ?? []), { name: "", monthly: 0 }] })}
            >
              <Plus size={14} /> Add category
            </button>
          </div>
          <div className="space-y-2">
            {(draft.budgets ?? []).map((b, i) => (
              <div key={i} className="glass flex items-center gap-2 p-2.5" style={{ borderRadius: 14 }}>
                <input className="field !w-[52%] !px-2.5 !py-2 text-sm" placeholder="Food" value={b.name}
                  onChange={(e) => setDraft({ ...draft, budgets: draft.budgets!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input className="field !w-[28%] !px-2.5 !py-2 text-sm" inputMode="decimal" placeholder="$/mo"
                  value={b.monthly || ""} onChange={(e) => setDraft({ ...draft, budgets: draft.budgets!.map((x, j) => (j === i ? { ...x, monthly: parseNumericInput(e.target.value) } : x)) })} />
                <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fg/6 text-fg/55"
                  onClick={() => setDraft({ ...draft, budgets: draft.budgets!.filter((_, j) => j !== i) })} aria-label={`Remove ${b.name || "budget"}`}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {!(draft.budgets ?? []).length && (
              <p className="px-1 text-[12px] text-fg/55">Planned spend per category — food, gas, fun. EILA scores the month against it.</p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg/70">Goals</span>
            <button
              className="flex items-center gap-1 text-[13px] font-semibold text-accent"
              onClick={() => setDraft({ ...draft, goals: [...draft.goals, { id: uid(), name: "", target: 0, saved: 0 }] })}
            >
              <Plus size={14} /> Add goal
            </button>
          </div>
          <div className="space-y-2">
            {draft.goals.map((g) => (
              <div key={g.id} className="glass flex items-center gap-2 p-2.5" style={{ borderRadius: 14 }}>
                <input className="field !w-[40%] !px-2.5 !py-2 text-sm" placeholder="Emergency fund" value={g.name}
                  onChange={(e) => setGoal(g.id, { name: e.target.value })} />
                <input className="field !w-[22%] !px-2.5 !py-2 text-sm" inputMode="decimal" placeholder="saved"
                  value={g.saved || ""} onChange={(e) => setGoal(g.id, { saved: parseNumericInput(e.target.value) })} />
                <input className="field !w-[22%] !px-2.5 !py-2 text-sm" inputMode="decimal" placeholder="target"
                  value={g.target || ""} onChange={(e) => setGoal(g.id, { target: parseNumericInput(e.target.value) })} />
                <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fg/6 text-fg/55"
                  onClick={() => setDraft({ ...draft, goals: draft.goals.filter((x) => x.id !== g.id) })} aria-label={`Remove ${g.name || "goal"}`}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <button
          className="btn btn-primary btn-block"
          onClick={() => {
            // Blank/zero budget rows are drafts, not categories — drop them.
            // (The save-side row-by-row merge compares rows by VALUE, so this
            // cleanup can't read as a user edit to untouched categories.)
            const budgets = (draft.budgets ?? []).filter((b) => b.name.trim() && b.monthly > 0);
            onSave({ ...draft, budgets: budgets.length ? budgets : undefined }, seed.current);
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
