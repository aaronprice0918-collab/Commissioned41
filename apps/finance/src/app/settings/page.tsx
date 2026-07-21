"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Bill, Goal, Paycheck, TxnCategory } from "@/lib/types";
import type { AppConfig } from "@/lib/config";
import { candidateToBill, type BillCandidate } from "@/lib/recurring";

const BILL_CATEGORIES: TxnCategory[] = [
  "housing",
  "utilities",
  "subscriptions",
  "transportation",
  "debt",
  "medical",
  "kids",
  "business",
  "taxes",
  "savings",
  "investments",
  "entertainment",
];

const EMPTY_BILL = (): Bill => ({
  id: `b_${Date.now()}`,
  name: "New bill",
  amount: 0,
  category: "utilities",
  cadence: "monthly",
  dayOfMonth: 1,
  autoDetected: false,
});

const EMPTY_GOAL = (): Goal => ({
  id: `g_${Date.now()}`,
  name: "New goal",
  target: 5000,
  saved: 0,
  targetDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10),
  monthlyContribution: 250,
  probability: 0.7,
  emoji: "🎯",
});

const EMPTY_PAYCHECK = (): Paycheck => ({
  id: `pc_${Date.now()}`,
  date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10),
  kind: "commission",
  expectedGross: 0,
  expectedNet: 0,
  confidence: 0.8,
  worstCase: 0,
  bestCase: 0,
  source: "Kennesaw Mazda",
});

export default function SettingsPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [suggested, setSuggested] = useState<BillCandidate[]>([]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg(null));
    fetch("/api/bills/detect")
      .then((r) => r.json())
      .then((d) => setSuggested(Array.isArray(d.candidates) ? d.candidates : []))
      .catch(() => {});
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (!cfg) {
    return <main className="mx-auto max-w-3xl px-5 py-16 text-center text-[var(--text-dim)]">Loading your settings…</main>;
  }

  const setGoal = (i: number, patch: Partial<Goal>) =>
    setCfg({ ...cfg, goals: cfg.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  const setPay = (i: number, patch: Partial<Paycheck>) =>
    setCfg({ ...cfg, paychecks: cfg.paychecks.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setBill = (i: number, patch: Partial<Bill>) =>
    setCfg({ ...cfg, bills: cfg.bills.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const adoptSuggestion = (c: BillCandidate) => {
    setCfg({ ...cfg, bills: [...cfg.bills, candidateToBill(c)] });
    setSuggested(suggested.filter((s) => s.name !== c.name));
  };

  return (
    <main className="mx-auto max-w-3xl px-5 pb-24 pt-8 sm:px-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-[var(--text-faint)] transition hover:text-[var(--text)]">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-[var(--text-dim)]">Goals and income the bank can&apos;t see. Saved to your database.</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-soft)] disabled:opacity-40"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
        </button>
      </header>

      {/* Profile */}
      <section className="glass mb-4 p-6">
        <SectionLabel>Profile</SectionLabel>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={cfg.name} onChange={(v) => setCfg({ ...cfg, name: v })} />
          </Field>
          <Field label="Monthly essentials floor ($)" hint="groceries/fuel not tracked as named bills">
            <NumInput value={cfg.monthlyEssentials} onChange={(v) => setCfg({ ...cfg, monthlyEssentials: v })} />
          </Field>
        </div>
      </section>

      {/* Goals */}
      <section className="glass mb-4 p-6">
        <div className="flex items-center justify-between">
          <SectionLabel>Goals</SectionLabel>
          <button
            onClick={() => setCfg({ ...cfg, goals: [...cfg.goals, EMPTY_GOAL()] })}
            className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-[var(--text-dim)] transition hover:text-white"
          >
            + Add goal
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {cfg.goals.map((g, i) => (
            <div key={g.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Emoji">
                  <TextInput value={g.emoji} onChange={(v) => setGoal(i, { emoji: v })} />
                </Field>
                <div className="col-span-1 sm:col-span-3">
                  <Field label="Name">
                    <TextInput value={g.name} onChange={(v) => setGoal(i, { name: v })} />
                  </Field>
                </div>
                <Field label="Target ($)">
                  <NumInput value={g.target} onChange={(v) => setGoal(i, { target: v })} />
                </Field>
                <Field label="Saved ($)">
                  <NumInput value={g.saved} onChange={(v) => setGoal(i, { saved: v })} />
                </Field>
                <Field label="Monthly ($)">
                  <NumInput value={g.monthlyContribution} onChange={(v) => setGoal(i, { monthlyContribution: v })} />
                </Field>
                <Field label="Target date">
                  <DateInput value={g.targetDate} onChange={(v) => setGoal(i, { targetDate: v })} />
                </Field>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => setCfg({ ...cfg, goals: cfg.goals.filter((_, j) => j !== i) })}
                  className="text-xs text-[var(--stop)] transition hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {cfg.goals.length === 0 && <Empty>No goals yet — add one above.</Empty>}
        </div>
      </section>

      {/* Bills */}
      <section className="glass mb-4 p-6">
        <div className="flex items-center justify-between">
          <SectionLabel>Bills</SectionLabel>
          <button
            onClick={() => setCfg({ ...cfg, bills: [...cfg.bills, EMPTY_BILL()] })}
            className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-[var(--text-dim)] transition hover:text-white"
          >
            + Add bill
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--text-faint)]">
          These feed safe-to-spend and the forecast — keep them honest. Remove anything that isn&apos;t really yours.
        </p>

        {suggested.length > 0 && (
          <div className="mt-4 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-4">
            <div className="text-xs font-semibold">Found in your bank activity</div>
            <div className="mt-1 text-[11px] text-[var(--text-dim)]">
              These charges repeat on a rhythm — tap Add to make them bills, then Save.
            </div>
            <div className="mt-3 space-y-2">
              {suggested.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{c.name}</div>
                    <div className="text-[11px] text-[var(--text-faint)]">
                      ${c.amount} {c.cadence}
                      {c.dayOfMonth ? ` · around the ${c.dayOfMonth}th` : ""} · seen {c.occurrences}×
                    </div>
                  </div>
                  <button
                    onClick={() => adoptSuggestion(c)}
                    className="shrink-0 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent-soft)]"
                  >
                    + Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 space-y-4">
          {cfg.bills.map((b, i) => (
            <div key={b.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="col-span-2">
                  <Field label="Name">
                    <TextInput value={b.name} onChange={(v) => setBill(i, { name: v })} />
                  </Field>
                </div>
                <Field label="Amount ($)">
                  <NumInput value={b.amount} onChange={(v) => setBill(i, { amount: v })} />
                </Field>
                <Field label="Category">
                  <SelectInput
                    value={b.category}
                    options={BILL_CATEGORIES}
                    onChange={(v) => setBill(i, { category: v as TxnCategory })}
                  />
                </Field>
                <Field label="Repeats">
                  <SelectInput
                    value={b.cadence}
                    options={["monthly", "weekly", "biweekly", "quarterly", "yearly"]}
                    onChange={(v) => setBill(i, { cadence: v as Bill["cadence"] })}
                  />
                </Field>
                <Field label="Day of month" hint="for monthly bills">
                  <NumInput value={b.dayOfMonth ?? 1} onChange={(v) => setBill(i, { dayOfMonth: Math.min(31, Math.max(1, Math.round(v))) })} />
                </Field>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-[10px] text-[var(--text-faint)]">{b.autoDetected ? "detected from your bank" : ""}</div>
                <button
                  onClick={() => setCfg({ ...cfg, bills: cfg.bills.filter((_, j) => j !== i) })}
                  className="text-xs text-[var(--stop)] transition hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {cfg.bills.length === 0 && <Empty>No bills yet — add one, or tap a suggestion above.</Empty>}
        </div>
      </section>

      {/* Income */}
      <section className="glass mb-4 p-6">
        <div className="flex items-center justify-between">
          <SectionLabel>Expected Income</SectionLabel>
          <button
            onClick={() => setCfg({ ...cfg, paychecks: [...cfg.paychecks, EMPTY_PAYCHECK()] })}
            className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-[var(--text-dim)] transition hover:text-white"
          >
            + Add paycheck
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--text-faint)]">
          Until the pay-plan AI is wired, enter your expected deposits here so safe-to-spend and the forecast stay accurate.
        </p>
        <div className="mt-4 space-y-4">
          {cfg.paychecks.map((p, i) => (
            <div key={p.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="col-span-2">
                  <Field label="Source">
                    <TextInput value={p.source} onChange={(v) => setPay(i, { source: v })} />
                  </Field>
                </div>
                <Field label="Kind">
                  <SelectInput
                    value={p.kind}
                    options={["salary", "hourly", "commission", "bonus", "draw", "spiff"]}
                    onChange={(v) => setPay(i, { kind: v as Paycheck["kind"] })}
                  />
                </Field>
                <Field label="Date">
                  <DateInput value={p.date} onChange={(v) => setPay(i, { date: v })} />
                </Field>
                <Field label="Expected net ($)">
                  <NumInput value={p.expectedNet} onChange={(v) => setPay(i, { expectedNet: v })} />
                </Field>
                <Field label="Confidence (%)">
                  <NumInput value={Math.round(p.confidence * 100)} onChange={(v) => setPay(i, { confidence: v / 100 })} />
                </Field>
                <Field label="Worst case ($)">
                  <NumInput value={p.worstCase} onChange={(v) => setPay(i, { worstCase: v })} />
                </Field>
                <Field label="Best case ($)">
                  <NumInput value={p.bestCase} onChange={(v) => setPay(i, { bestCase: v })} />
                </Field>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => setCfg({ ...cfg, paychecks: cfg.paychecks.filter((_, j) => j !== i) })}
                  className="text-xs text-[var(--stop)] transition hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {cfg.paychecks.length === 0 && <Empty>No income entries yet — add one above.</Empty>}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-soft)] disabled:opacity-40"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
        </button>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-[var(--text-dim)]">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[10px] text-[var(--text-faint)]">{hint}</div>}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]/60";

function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
}
function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className={`${inputCls} num`}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  );
}
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="date" className={`${inputCls} num`} value={value} onChange={(e) => onChange(e.target.value)} />;
}
function SelectInput({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o} className="bg-[var(--bg-elev)]">
          {o}
        </option>
      ))}
    </select>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-sm text-[var(--text-faint)]">{children}</div>;
}
