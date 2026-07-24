"use client";

// The Daily Budget — Aaron's July 6 2026 spec, in his words: "all the info
// you need for your daily budget all the way down to what you can spend
// today" (renamed to "Daily spending allowance", Aaron, July 6). One giant number a rep can spend guilt-free RIGHT NOW, because
// every bill, the pay-yourself savings bill, everyday-life burn, and the
// $1,000 never-go-below floor are already carved out of it — checked against
// EVERY projected day ahead, not just today. Recomputes as the balance and
// the spend log change.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Check, Plus, Sparkles, Wallet } from "lucide-react";
import { useMission } from "@/lib/store";
import { useAskIla } from "@/components/AppShell";
import { forecast } from "@/lib/engine";
import { vscIdOf } from "@/lib/fni";
import { getSupabase } from "@/lib/supabase";
import { compressImage } from "@/lib/payplan/upload";
import {
  addSpend,
  cashFlow,
  dailyBudget,
  goalProgress,
  incomeExpectation,
  payYourselfBill,
  removeSpend,
  setMerchantRule,
  setSpendAccount,
} from "@/lib/money/engine";
import type { CashFlowPoint, MoneyConfig } from "@/lib/money/types";
import { defaultMoneyConfig } from "@/lib/money/types";
import { CountUp } from "@/components/motion";
import { Labeled, Sheet, parseNumericInput } from "@/components/ui";
import { LogSpendSheet, SpendLogSheet } from "@/components/MoneyDashboard";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const uid = () => Math.random().toString(36).slice(2, 10);
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function DailyBudget() {
  const { data, updateMoney } = useMission();
  const askIla = useAskIla();
  const router = useRouter();
  const profile = data.profile!;
  const cfg = profile.money ?? defaultMoneyConfig();

  const [logOpen, setLogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [balOpen, setBalOpen] = useState(false);
  // Refresh on resume, same as MoneyDashboard — a PWA woken the next morning
  // was still computing yesterday's allowance from a mount-time clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setNow(new Date()); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  const f = useMemo(
    () => forecast(profile.plan, data.deals, now, profile.daysOff ?? [], vscIdOf(profile)),
    [profile.plan, profile.daysOff, data.deals, now],
  );
  const income = useMemo(
    () => incomeExpectation(f.likely.grossPay, cfg.paydays ?? cfg.payday, now, profile.plan.taxRate, cfg.checkNets),
    [f, cfg.paydays, cfg.payday, cfg.checkNets, now, profile.plan.taxRate],
  );
  const db = useMemo(() => dailyBudget(cfg, income, now), [cfg, income, now]);
  const flow = useMemo(() => cashFlow(cfg, income, now), [cfg, income, now]);
  const selfBill = payYourselfBill(cfg);
  const firstName = profile.name.split(" ")[0] || "you";

  if (!db) {
    return (
      <div className="space-y-4 pb-6">
        <BackRow onBack={() => router.back()} />
        <section className="glass rise p-5 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent/12 text-accent"><Wallet size={22} /></span>
          <h2 className="mt-3 font-display text-lg font-black">One number first</h2>
          <p className="mx-auto mt-1.5 max-w-[32ch] text-sm text-fg/65">
            Tell me what&apos;s in checking and I&apos;ll tell you what you can spend today — with your bills, savings, and floor already protected.
          </p>
          <button className="btn btn-primary btn-block mt-4" onClick={() => setBalOpen(true)}>Enter my balance</button>
        </section>
        <BalanceSheet open={balOpen} onClose={() => setBalOpen(false)} cfg={cfg} onSave={(c) => { updateMoney(c); setBalOpen(false); }} />
      </div>
    );
  }

  const ilaLine =
    db.leftToday > 0
      ? `${firstName}, ${money(db.leftToday)} is yours to spend today, guilt-free — bills paid, savings paid, floor untouched. Spend it happy or bank it; either way you're winning.`
      : db.spentToday >= db.perDay && db.perDay > 0
        ? `Today's fun money is spent — ${money(db.spentToday)} logged. Not a scold, a scoreboard: tomorrow reloads at ~${money(db.perDay)}.`
        : `Zero free-money day — every dollar's holding the ${money(db.floor)} floor until the next check lands. Timing, not trouble.`;

  return (
    <div className="space-y-4 pb-6">
      <BackRow onBack={() => router.back()} />

      {/* EILA's read */}
      <section className="glass rise p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15"><Sparkles size={17} className="text-accent2" /></span>
          <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-fg/90">{ilaLine}</p>
          <button className="shrink-0 text-[13px] font-semibold text-accent" onClick={() => askIla("Walk me through today's daily budget — how you got my daily spending allowance and what happens to it tomorrow.")}>
            Ask EILA
          </button>
        </div>
      </section>

      {/* THE number */}
      <button
        className="glass living-ring rise block w-full p-6 text-center"
        style={{ animationDelay: "60ms" }}
        onClick={() => askIla("Explain today's daily spending allowance — the exact math, what's carved out (bills, pay-yourself, essentials, floor), and which day ahead is the tight one.")}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">Daily spending allowance</div>
        <div className={`mt-2 font-display text-[56px] font-black leading-none tabnum ${db.leftToday > 0 ? "text-good" : ""}`}>
          <CountUp value={db.leftToday} format={money} />
        </div>
        <div className="mt-2 text-[12px] text-fg/60">
          bills, savings &amp; your {money(db.floor)} floor already carved out
        </div>
        {db.spentToday > 0 && (
          <div className="mt-1 text-[12px] text-fg/50">today&apos;s allowance {money(db.perDay)} − {money(db.spentToday)} logged</div>
        )}
      </button>

      <button className="btn btn-primary btn-block" onClick={() => setLogOpen(true)}>
        <Plus size={16} /> I spent some — log it
      </button>
      {(cfg.spend ?? []).length > 0 && (
        <button className="mx-auto block text-[13px] font-semibold text-accent" onClick={() => setHistoryOpen(true)}>
          Returned something or logged it wrong? Fix the log
        </button>
      )}

      {/* The receipts behind the number */}
      <section className="grid grid-cols-2 gap-3">
        <button className="glass rise p-4 text-left" style={{ animationDelay: "120ms" }} onClick={() => askIla("Explain my steady daily allowance on the Daily Budget screen — how it's computed and why it reloads.")}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">Every day, steady</div>
          <div className="mt-1 font-display text-2xl font-black tabnum">{money(db.perDay)}<span className="text-sm font-bold text-fg/50">/day</span></div>
          <div className="mt-0.5 text-[11px] text-fg/55">reloads daily, floor never breached</div>
        </button>
        <EmergencyFundCard cfg={cfg} askIla={askIla} />
        {/* db.lumpToday (one-shot ceiling) stays in the engine + EILA's briefing
            for "can I buy X today?" — the card slot belongs to the emergency
            fund now (Aaron, July 6). */}
        <button className="glass rise p-4 text-left" style={{ animationDelay: "200ms" }} onClick={() => setBalOpen(true)}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">In checking right now</div>
          <div className="mt-1 font-display text-2xl font-black tabnum">{cfg.checkingBalance != null ? money(cfg.checkingBalance) : "—"}</div>
          <div className={`mt-0.5 text-[11px] ${!cfg.bank && db.staleDays >= 3 ? "font-semibold text-warn" : "text-fg/55"}`}>
            {cfg.bank
              ? `live · synced from ${cfg.bank.institutions[0] ?? "your bank"}`
              : db.staleDays === 0 ? "updated today" : db.staleDays === 1 ? "from yesterday" : `${db.staleDays} days old — tap to update`}
          </div>
        </button>
        <button className="glass rise p-4 text-left" style={{ animationDelay: "240ms" }} onClick={() => askIla(`Why is my floor ${money(db.floor)} and how do I change it?`)}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">The floor</div>
          <div className="mt-1 font-display text-2xl font-black tabnum">{money(db.floor)}</div>
          <div className="mt-0.5 text-[11px] text-fg/55">never-go-below, after bills &amp; savings</div>
        </button>
      </section>

      {/* The month ahead with the floor drawn in */}
      <section className="glass rise p-4" style={{ animationDelay: "280ms" }}>
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg/70">The next 30 days</div>
          <button className="text-[13px] font-semibold text-accent" onClick={() => askIla("Talk me through my cash curve — where it gets tight and what protects the floor.")}>Ask EILA</button>
        </div>
        {flow.length > 0 && <FloorCurve points={flow} floor={db.floor} />}
        <div className="mt-2 space-y-1 text-[12px] text-fg/60">
          {db.tightestDate && (
            <div>Tightest day ahead: <span className="font-semibold tabnum text-fg/80">{money(db.tightestBalance ?? 0)}</span> on {db.tightestDate.slice(5).replace("-", "/")} — that day sets today&apos;s number.</div>
          )}
          <div>Next check: <span className="font-semibold tabnum text-fg/80">~{money(income.nextCheckAmount)}</span> on {income.nextCheckDate.slice(5).replace("-", "/")} — the number jumps when it lands.</div>
          {selfBill ? (
            <div>Paying yourself: <span className="font-semibold tabnum text-fg/80">{money(selfBill.amount)}/mo</span>{selfBill.dayOfMonth ? ` on the ${selfBill.dayOfMonth}` : ""} — counted as a bill, always.</div>
          ) : (
            <button className="font-semibold text-accent" onClick={() => askIla("Set up a pay-myself bill — a monthly savings transfer that counts as a mandatory bill in all my numbers. Help me pick the amount and the day.")}>
              + Make paying yourself a bill — EILA sets it up
            </button>
          )}
        </div>
      </section>

      <SpendLogSheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        cfg={cfg}
        onRemove={(id) => updateMoney(removeSpend(cfg, id))}
        onReclassify={(merchant, kind, category, opts) => updateMoney(setMerchantRule(cfg, merchant, kind, category, todayIso(), opts))}
        onSetAccount={(entry, accountId) => updateMoney(setSpendAccount(cfg, entry, accountId, todayIso()))}
      />
      <LogSpendSheet
        open={logOpen}
        onClose={() => setLogOpen(false)}
        cfg={cfg}
        onLog={(amount, category, note, account) => {
          updateMoney(addSpend(cfg, { amount, category, note, account }, todayIso(), uid));
          setLogOpen(false);
        }}
      />
      <BalanceSheet open={balOpen} onClose={() => setBalOpen(false)} cfg={cfg} onSave={(c) => { updateMoney(c); setBalOpen(false); }} />
    </div>
  );
}

/** The emergency-fund view — the safety net beside the daily allowance
 * (Aaron, July 6: this slot used to be the one-shot ceiling). Reads the
 * emergency-flavored goal when one exists, falls back to the savings
 * bucket, and invites when there's neither. */
function EmergencyFundCard({ cfg, askIla }: { cfg: MoneyConfig; askIla: (prompt: string) => void }) {
  const goal = cfg.goals.find((g) => /emerg|rainy|safety|cushion/i.test(g.name));
  if (goal) {
    const pct = goalProgress(goal);
    return (
      <button
        className="glass rise p-4 text-left" style={{ animationDelay: "160ms" }}
        onClick={() => askIla(`How's my ${goal.name} doing — I'm at $${goal.saved.toLocaleString()} of $${goal.target.toLocaleString()}. What gets me there faster?`)}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">Emergency fund</div>
        <div className="mt-1 font-display text-2xl font-black tabnum">{money(goal.saved)}</div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fg/8">
          <div className="h-full rounded-full bg-gradient-to-r from-accent2 to-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-fg/55">{pct}% of {money(goal.target)}{pct >= 100 ? " — FUNDED 🎉" : ""}</div>
      </button>
    );
  }
  if (cfg.savingsBalance != null) {
    return (
      <button
        className="glass rise p-4 text-left" style={{ animationDelay: "160ms" }}
        onClick={() => askIla(`I've got $${cfg.savingsBalance!.toLocaleString()} in savings — help me turn it into a real emergency fund with a target (about 3 months of my bills).`)}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">Emergency fund</div>
        <div className="mt-1 font-display text-2xl font-black tabnum">{money(cfg.savingsBalance)}</div>
        <div className="mt-0.5 text-[11px] text-fg/55">in savings — tap to give it a target</div>
      </button>
    );
  }
  return (
    <button
      className="glass rise p-4 text-left" style={{ animationDelay: "160ms" }}
      onClick={() => askIla("Help me start an emergency fund — what's the right target for me (about 3 months of bills), and how do we get there on my checks?")}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/55">Emergency fund</div>
      <div className="mt-1 font-display text-2xl font-black tabnum text-fg/40">none yet</div>
      <div className="mt-0.5 text-[11px] text-fg/55">tap — EILA helps you start one</div>
    </button>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center justify-between px-1">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-fg/50 active:scale-95">
        <ArrowLeft size={16} /> Money
      </button>
      <h1 className="font-display text-lg font-black">Daily Budget</h1>
    </div>
  );
}

/** One-field balance refresh — the daily ritual that keeps every number true.
 * Two ways in: type it, or snap a screenshot of the bank app and EILA reads
 * the balance off it (suggest-then-approve: it only fills the field; the
 * Update tap is still the human gate). */
function BalanceSheet({ open, onClose, cfg, onSave }: { open: boolean; onClose: () => void; cfg: MoneyConfig; onSave: (c: MoneyConfig) => void }) {
  const [text, setText] = useState("");
  const [snapMsg, setSnapMsg] = useState("");
  const [snapping, setSnapping] = useState(false);
  const snapInput = useRef<HTMLInputElement>(null);
  const [seenOpen, setSeenOpen] = useState(false);
  if (open && !seenOpen) { setText(cfg.checkingBalance != null ? String(cfg.checkingBalance) : ""); setSnapMsg(""); setSeenOpen(true); }
  if (!open && seenOpen) setSeenOpen(false);
  const val = parseNumericInput(text);

  async function snap(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setSnapping(true);
    setSnapMsg("");
    try {
      const part = await compressImage(file);
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch("/api/scan-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ file: { dataB64: part.dataB64, mediaType: part.mediaType } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setSnapMsg(j.error || "Couldn't read that one — try a cleaner screenshot."); return; }
      setText(String(j.balance));
      setSnapMsg(`EILA read $${Number(j.balance).toLocaleString()}${j.accountName ? ` from ${j.accountName}` : ""}${j.kind === "current" ? " (current balance — available may differ)" : ""}. Check it, then Update.`);
    } catch {
      setSnapMsg("Couldn't read that one — try again.");
    } finally {
      setSnapping(false);
      if (snapInput.current) snapInput.current.value = "";
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="What's in checking right now?">
      <div className="space-y-4 pb-2">
        <button className="btn btn-ghost btn-block" disabled={snapping} onClick={() => snapInput.current?.click()}>
          <Camera size={16} /> {snapping ? "Reading your screenshot…" : "Snap it from your bank app"}
        </button>
        {snapMsg && <p className={`text-[12px] font-semibold ${/^EILA read/.test(snapMsg) ? "text-good" : "text-warn"}`}>{snapMsg}</p>}
        <Labeled label="Checking balance" hint="Straight off your bank app — every number on this screen recalculates from it.">
          <input className="field" inputMode="decimal" placeholder="e.g. 4,200" value={text} onChange={(e) => { setText(e.target.value); setSnapMsg(""); }} />
        </Labeled>
        <button
          className="btn btn-primary btn-block"
          onClick={() => {
            // Never a dead button (silence sweep, July 13): a blank or negative
            // entry gets told what's needed instead of a greyed-out shrug.
            if (text.trim() === "" || !(val >= 0)) {
              setSnapMsg("Type your checking balance as a positive number — that's all this needs.");
              return;
            }
            onSave({ ...cfg, checkingBalance: Math.round(val), balanceAsOf: todayIso() });
          }}
        >
          <Check size={16} /> Update
        </button>
        <input ref={snapInput} type="file" accept="image/*" className="hidden" onChange={(e) => snap(e.target.files)} />
      </div>
    </Sheet>
  );
}

/** The cash curve with the FLOOR drawn in — the promise made visible. */
function FloorCurve({ points, floor }: { points: CashFlowPoint[]; floor: number }) {
  const W = 320, H = 110, PAD = 4;
  const vals = points.map((p) => p.balance);
  const lo = Math.min(...vals, 0);
  const hi = Math.max(...vals, floor + 100);
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  const floorY = y(floor);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`Projected cash over 30 days with the $${floor} floor marked`}>
      <path d={`${path} L${x(points.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z`} fill="rgb(var(--accent) / 0.10)" />
      <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" />
      <line x1={PAD} x2={W - PAD} y1={floorY} y2={floorY} stroke="rgb(var(--warn) / 0.6)" strokeDasharray="4 4" strokeWidth="1.5" />
      <text x={W - PAD - 2} y={floorY - 4} textAnchor="end" fontSize="9" fill="rgb(var(--warn) / 0.9)" fontWeight="700">
        floor ${floor.toLocaleString()}
      </text>
    </svg>
  );
}
