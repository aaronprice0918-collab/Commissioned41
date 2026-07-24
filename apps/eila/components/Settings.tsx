"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, RotateCcw, CloudOff, Cloud, Loader2, LogOut, ScanFace, Sparkles, ArrowRight, CreditCard, FileUp, BellRing, Gift, Copy, Share2 } from "lucide-react";
import { useMission } from "@/lib/store";
import { isOwner } from "@/lib/owner";
import { getSupabase } from "@/lib/supabase";
import { Industry, INDUSTRY_LABEL, INDUSTRY_UNIT, ProductDef, ROLE_LABEL, Role } from "@/lib/types";
import { productDefs, usesProductMenu } from "@/lib/fni";
import { PayPlan } from "@/lib/payplan/types";
import { changedFields } from "@/lib/mergeEdits";
import { BUILD_ID } from "@/lib/version";
import { Sheet, Labeled, NumInput } from "./ui";
import { PayPlanUploader, ParseResult } from "./PayPlanUploader";
import { PlanEditor } from "./PlanEditor";
import { PayPlanReview } from "./PayPlanReview";
import { IlaMemoryBlock } from "./IlaMemory";
import { biometricAvailable, biometricEnabled, registerBiometric, disableBiometric } from "@/lib/biometric";
import { pushSupported, pushPermission, enableNudges, disableNudges } from "@/lib/push";

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, updatePlan, clearSampleData, resetAll, account, syncing, syncError, signIn, signUp, signOut } = useMission();
  const [plan, setPlan] = useState(data.profile?.plan ?? null);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const hasSampleData = (data.deals ?? []).some((d) => d.demo);

  // The plan as it was when the sheet opened — the baseline we diff the draft
  // against on save, so we only write fields the USER changed (not clobber a
  // field EILA or a cloud pull changed while the sheet sat open).
  const baseline = useRef<PayPlan | null>(data.profile?.plan ?? null);

  // Seed the plan draft ONCE per open (guarded by ref, so the dep list keeps
  // a constant shape) — keying the reseed on data.profile reset a half-edited
  // PlanEditor whenever ANY persist changed profile identity. July 5 audit C-7.
  const seededOpen = useRef(false);
  useEffect(() => {
    if (open && !seededOpen.current) {
      seededOpen.current = true;
      const p = data.profile?.plan ?? null;
      setPlan(p); baseline.current = p; setSaved(false); setConfirmReset(false);
    }
    if (!open) seededOpen.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.profile]);

  if (!data.profile || !plan) return null;

  function save() {
    if (!plan) return;
    // Merge only what the user edited onto the LATEST stored plan. A whole-draft
    // updatePlan(plan) would stamp the frozen draft back, reverting anything
    // changed elsewhere since the sheet opened (e.g. EILA's set_pay_goal — the
    // "$20k goal snaps back to $6k" bug, reached through Save this time).
    const live = data.profile?.plan;
    const base = baseline.current;
    const merged = live && base ? { ...live, ...changedFields(base, plan) } : plan;
    updatePlan(merged);
    baseline.current = merged; // a second Save in the same session diffs from here
    setPlan(merged);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-5">
        <div className="glass flex items-center justify-between p-4">
          <div>
            <div className="font-bold">{data.profile.name}</div>
            <div className="text-xs text-fg/70">{ROLE_LABEL[data.profile.role]} · {INDUSTRY_LABEL[data.profile.industry]}</div>
          </div>
          {account ? (
            <span className="flex items-center gap-1.5 rounded-full bg-good/15 px-3 py-1 text-[11px] text-good">
              {syncing ? <Loader2 size={13} className="animate-spin" /> : <Cloud size={13} />} {syncError ? "Sync issue — retrying" : "Synced"}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-fg/6 px-3 py-1 text-[11px] text-fg/70"><CloudOff size={13} /> On this device</span>
          )}
        </div>

        {/* Subscribe / manage billing */}
        {/* Owner-only: the growth Pulse. The real gate is server-side; this
            link just shows for the owner's email so it isn't visible clutter
            for customers (a curious tap by anyone else 403s at the API). */}
        {isOwner(account?.email ?? "") && (
          <Link href="/owner" className="glass flex items-center justify-between p-4 transition active:scale-[0.99]">
            <span className="flex items-center gap-2.5 text-sm font-bold"><Sparkles size={16} className="text-accent2" /> Your Pulse</span>
            <span className="text-xs text-fg/65">signups · activity →</span>
          </Link>
        )}

        <BillingBlock signedIn={!!account} />

        {/* Referral program — needs a real account, since the reward is tied
            to a Stripe customer, not a device. */}
        {account && <ReferralBlock />}

        {/* Account / cloud sync */}
        <AccountBlock account={account} signIn={signIn} signUp={signUp} signOut={signOut} />

        {/* Face ID / biometric lock */}
        <BiometricBlock label={account?.email || data.profile.name} />

        {/* Proactive nudges — needs a real signed-in account, same reason
            cloud sync does: the cron job pushes to a subscription tied to your
            user_id, not to a device sitting offline. */}
        {account && <NudgesBlock />}

        <div>
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">Your pay plan</div>
          <UploadPlanBlock role={data.profile.role} industry={data.profile.industry} onParsed={setPlan} />
          <div className="mt-3">
            <PayPlanReview
              plan={plan}
              industry={data.profile.industry}
              products={productDefs(data.profile)}
              moneyConfig={data.profile.money}
            />
          </div>
          <div className="mt-3">
            <PlanEditor plan={plan} onChange={setPlan} unit={INDUSTRY_UNIT[data.profile.industry]} industry={data.profile.industry} />
          </div>
        </div>

        {/* F&I product menu — the user's OWN store's products, weights, spiffs */}
        {usesProductMenu(data.profile.industry) && <ProductsBlock />}

        {/* Work week — drives pace math (extrapolate over days you can sell) */}
        <DaysOffBlock />

        <button className="btn btn-primary btn-block" onClick={save}>
          {saved ? <><Check size={16} /> Saved</> : "Save changes"}
        </button>

        {/* The window into EILA's memory — watch her get to know you, correct what's wrong */}
        <IlaMemoryBlock />

        {hasSampleData && (
          <div className="glass living-border p-4">
            <div className="flex items-start gap-2.5">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" />
              <div className="text-sm text-fg/70">
                Your dashboard is showing a <span className="text-fg/90">sample month</span> so it isn&apos;t empty.
                It clears automatically when you log your first real deal — or clear it now.
              </div>
            </div>
            <button
              className="btn btn-ghost btn-block mt-3 !text-fg/80"
              onClick={() => { clearSampleData(); onClose(); }}
            >
              <Sparkles size={15} /> Clear sample data
            </button>
          </div>
        )}

        <div className="border-t border-fg/5 pt-4">
          {!confirmReset ? (
            <button className="btn btn-ghost btn-block !text-fg/60" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={15} /> Reset all data
            </button>
          ) : (
            <div className="glass p-4 text-center">
              <div className="text-sm text-fg/80">Erase your profile and all deals?</div>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-ghost !flex-1" onClick={() => setConfirmReset(false)}>Cancel</button>
                <button className="btn !flex-1 !bg-[rgb(127_95_80)] !text-white" onClick={() => { resetAll(); onClose(); }}>Erase</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// Days the user doesn't sell (store closed, scheduled day off). Pace math
// extrapolates the month over WORKING days — 7 sold in 3 days worked with
// 23 working days left in July is a 54 pace, not 72.
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function DaysOffBlock() {
  const { data, updateDaysOff } = useMission();
  const daysOff = data.profile?.daysOff ?? [];

  function toggle(day: number) {
    const next = daysOff.includes(day) ? daysOff.filter((d) => d !== day) : [...daysOff, day].sort();
    if (next.length === 7) return; // somebody has to sell something
    updateDaysOff(next);
  }

  return (
    <div>
      <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">Days you don&apos;t work</div>
      <div className="glass p-4">
        <div className="flex gap-1.5">
          {DAY_LABELS.map((label, day) => {
            const off = daysOff.includes(day);
            return (
              <button key={label} onClick={() => toggle(day)}
                className={`flex-1 rounded-xl py-2.5 text-[12px] font-bold transition active:scale-95 ${off ? "bg-warn/20 text-warn line-through" : "bg-fg/6 text-fg/70"}`}>
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 px-1 text-[11px] leading-relaxed text-fg/60">
          Tap the days your store is closed or you&apos;re off. Your pace and projections
          spread the month over the days you can actually sell.
        </p>
      </div>
    </div>
  );
}

// The user's own F&I product menu. Every store's menu, unit weights, and
// spiffs differ — so they live here as settings, never as hard-coded rules.
function ProductsBlock() {
  const { data, updateProducts } = useMission();
  const [items, setItems] = useState<ProductDef[]>(() => productDefs(data.profile));
  const [savedAt, setSavedAt] = useState(false);
  // The product ids present when this editor opened — so on save we can tell a
  // product EILA added meanwhile (not in this set) from one the user deleted.
  const baselineIds = useRef<Set<string>>(new Set(productDefs(data.profile).map((p) => p.id)));

  function patch(i: number, p: Partial<ProductDef>) {
    setItems((prev) => prev.map((x, n) => (n === i ? { ...x, ...p } : x)));
  }
  function save() {
    const clean = items
      .map((x) => ({ ...x, label: x.label.trim(), units: Math.max(0, x.units || 0), spiff: Math.max(0, x.spiff || 0) }))
      .filter((x) => x.label);
    // Keep any product added elsewhere (e.g. EILA's update_products) while this
    // menu sat open — a new id the draft never saw is a merge, not a delete.
    const userIds = new Set(clean.map((p) => p.id));
    const addedMeanwhile = productDefs(data.profile).filter((p) => !baselineIds.current.has(p.id) && !userIds.has(p.id));
    const merged = [...clean, ...addedMeanwhile];
    updateProducts(merged);
    setItems(merged);
    baselineIds.current = new Set(merged.map((p) => p.id));
    setSavedAt(true);
    setTimeout(() => setSavedAt(false), 1800);
  }

  return (
    <div>
      <div className="mb-2 mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">Your product menu</div>
      <div className="glass space-y-2 p-4">
        <div className="grid grid-cols-[1fr_64px_72px_28px] items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-fg/60">
          <span>Product</span><span className="text-center">Units</span><span className="text-center">Spiff $</span><span />
        </div>
        {items.map((p, i) => (
          <div key={p.id} className="grid grid-cols-[1fr_64px_72px_28px] items-center gap-2">
            <input className="field !py-2" value={p.label} onChange={(e) => patch(i, { label: e.target.value })} />
            {/* NumInput: String(p.units)+parseFloat ate the decimal point — 0.5-unit bundles were untypeable */}
            <NumInput className="field !py-2 text-center tabnum" value={p.units} onChange={(v) => patch(i, { units: v })} />
            <NumInput className="field !py-2 text-center tabnum" value={p.spiff} onChange={(v) => patch(i, { spiff: v })} />
            <button className="text-fg/60 transition hover:text-warn" aria-label={`Remove ${p.label}`}
              onClick={() => setItems((prev) => prev.filter((_, n) => n !== i))}>✕</button>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <button className="btn btn-ghost !flex-1 !py-2 !text-[13px]"
            onClick={() => setItems((prev) => [...prev, { id: `p${Date.now().toString(36)}`, label: "", units: 1, spiff: 0 }])}>
            + Add product
          </button>
          <button className="btn btn-primary !flex-1 !py-2 !text-[13px]" onClick={save}>
            {savedAt ? <><Check size={14} /> Saved</> : "Save menu"}
          </button>
        </div>
        <p className="px-1 pt-1 text-[11px] leading-relaxed text-fg/60">
          Units = what one sale counts toward your products-per-deal number (bundles can count as more than 1).
          Spiff = flat $ you&apos;re paid per sale of that product, on top of your plan.
        </p>
      </div>
    </div>
  );
}

// Pay plan changed? Upload the new document (PDF, photos, or text) and
// the parser reads it into the editor below for REVIEW — nothing about the
// rep's money changes until they look it over and hit Save.
function UploadPlanBlock({ role, industry, onParsed }: { role: Role; industry: Industry; onParsed: (p: PayPlan) => void }) {
  const [openUpload, setOpenUpload] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function onResult(r: ParseResult) {
    if (r.ok && r.plan) {
      onParsed(r.plan);
      setMsg(`Read ✓ ${r.sourceName} — review the numbers below, then hit Save.`);
      setOpenUpload(false);
    } else {
      setMsg(r.error || "Couldn't read that one — sharp, well-lit photos of each page work best.");
    }
  }

  return (
    <div>
      {!openUpload ? (
        <button type="button" onClick={() => { setOpenUpload(true); setMsg(null); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-sm font-semibold text-accent transition active:scale-[0.99]">
          <FileUp size={16} /> Pay plan changed? Upload the new one
        </button>
      ) : (
        <PayPlanUploader role={role} industry={industry} busyLabel="EILA is reading your plan…" onResult={onResult} />
      )}
      {msg && <p className={`mt-2 px-1 text-xs ${msg.startsWith("Read ✓") ? "text-good" : "text-warn"}`}>{msg}</p>}
    </div>
  );
}

// Signed-in users get a "Manage subscription" action that opens the Stripe
// billing portal; everyone else gets the public subscribe link.
function BillingBlock({ signedIn }: { signedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function manage() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch("/api/portal", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (j.url) { window.location.href = j.url; return; }
      setErr(j.error || "Couldn't open billing. Try subscribing first.");
    } catch {
      setErr("Couldn't open billing.");
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <a href="/subscribe" className="glass living-ring glass-tap flex items-center gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Sparkles size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">Subscribe — $19.99/mo</div>
          <div className="text-xs text-fg/70">Unlock the full EILA experience</div>
        </div>
        <ArrowRight size={16} className="shrink-0 text-fg/65" />
      </a>
    );
  }

  return (
    <div>
      <button onClick={manage} disabled={busy} className="glass living-ring glass-tap flex w-full items-center gap-3 p-4 text-left disabled:opacity-60">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <CreditCard size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">Manage subscription</div>
          <div className="text-xs text-fg/70">Update card, view invoices, or cancel</div>
        </div>
        <ArrowRight size={16} className="shrink-0 text-fg/65" />
      </button>
      {err && <p className="mt-2 px-1 text-xs text-warn">{err}</p>}
    </div>
  );
}

function AccountBlock({ account, signIn, signUp, signOut }: {
  account: { id: string; email: string } | null;
  signIn: (e: string, p: string) => Promise<string | null>;
  signUp: (e: string, p: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (account) {
    return (
      <div className="glass flex items-center justify-between p-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/65">Signed in</div>
          <div className="truncate text-sm text-fg/80">{account.email}</div>
          {/* Read this to support to confirm exactly which version your phone is
              running — ends any "is it the old cached app?" guessing. */}
          <div className="mt-1 text-[10px] font-mono text-fg/40">Version {BUILD_ID === "dev" ? "dev" : BUILD_ID.slice(0, 7)}</div>
        </div>
        <button onClick={() => signOut()} className="flex items-center gap-1.5 rounded-xl bg-fg/6 px-3 py-2 text-sm text-fg/60 active:scale-95"><LogOut size={15} /> Sign out</button>
      </div>
    );
  }

  async function go(kind: "in" | "up") {
    if (!email || !pw || busy) return;
    // Same bar as the front-door sign-up — accounts created HERE with shorter
    // passwords couldn't get past AuthScreen's old sign-in check.
    if (kind === "up" && pw.length < 8) { setMsg("Use at least 8 characters."); return; }
    setBusy(true); setMsg(null);
    const err = kind === "in" ? await signIn(email.trim(), pw) : await signUp(email.trim(), pw);
    setBusy(false);
    if (err) setMsg(err);
    else if (kind === "up") setMsg("Account created. If sync doesn't start, check your email to confirm.");
  }

  return (
    <div className="glass space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><Cloud size={16} className="text-accent2" /> Sync across devices</div>
      <p className="text-xs text-fg/70">Create an account so your data follows you to any phone or computer and survives a cache clear.</p>
      <Labeled label="Email"><input className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></Labeled>
      <Labeled label="Password"><input className="field" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" /></Labeled>
      {msg && <p className="px-1 text-xs text-warn">{msg}</p>}
      <div className="flex gap-2">
        <button className="btn btn-ghost !flex-1" disabled={busy} onClick={() => go("in")}>Sign in</button>
        <button className="btn btn-primary !flex-1" disabled={busy} onClick={() => go("up")}>{busy ? <Loader2 size={15} className="animate-spin" /> : "Create account"}</button>
      </div>
    </div>
  );
}

function BiometricBlock({ label }: { label: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    biometricAvailable().then((a) => { if (on) setAvailable(a); });
    setEnabled(biometricEnabled());
    return () => { on = false; };
  }, []);

  async function turnOn() {
    setBusy(true);
    const ok = await registerBiometric(label);
    setBusy(false);
    setEnabled(ok);
  }
  function turnOff() { disableBiometric(); setEnabled(false); }

  return (
    <div className="glass flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><ScanFace size={20} /></div>
        <div>
          <div className="text-sm font-semibold">Face ID lock</div>
          <div className="text-xs text-fg/70">
            {available === false ? "Not available on this device" : enabled ? "Required to open the app" : "Use Face ID / fingerprint to open"}
          </div>
        </div>
      </div>
      {available === false ? null : enabled ? (
        <button onClick={turnOff} className="rounded-xl bg-fg/6 px-3 py-2 text-sm text-fg/60 active:scale-95">Turn off</button>
      ) : (
        <button onClick={turnOn} disabled={busy || available === null} className="btn btn-primary !px-4 !py-2 !text-[13px]">
          {busy ? <Loader2 size={14} className="animate-spin" /> : available === null ? "Checking…" : "Turn on"}
        </button>
      )}
    </div>
  );
}

function NudgesBlock() {
  const supported = pushSupported();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supported) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setEnabled(!!sub && pushPermission() === "granted");
      } catch { /* no registration yet — stays off */ }
    })();
  }, [supported]);

  async function turnOn() {
    setBusy(true);
    setError("");
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
    const err = token ? await enableNudges(token) : "Sign in first.";
    setBusy(false);
    if (err) { setError(err); return; }
    setEnabled(true);
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
    if (token) await disableNudges(token);
    setBusy(false);
    setEnabled(false);
  }

  return (
    <div className="glass p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent2/12 text-accent2"><BellRing size={20} /></div>
          <div>
            <div className="text-sm font-semibold">EILA's nudges</div>
            <div className="text-xs text-fg/70">
              {!supported ? "Not available on this browser" : enabled ? "She'll ping you when something needs attention" : "Day reminders, money pressure, pace slipping — she'll tell you"}
            </div>
          </div>
        </div>
        {supported && (
          enabled ? (
            <button onClick={turnOff} disabled={busy} className="rounded-xl bg-fg/6 px-3 py-2 text-sm text-fg/60 active:scale-95">
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Turn off"}
            </button>
          ) : (
            <button onClick={turnOn} disabled={busy} className="btn btn-primary !px-4 !py-2 !text-[13px]">
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Turn on"}
            </button>
          )
        )}
      </div>
      {error && <p className="mt-2.5 text-xs text-warn">{error}</p>}
    </div>
  );
}

function ReferralBlock() {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const sb = getSupabase();
        const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
        if (!token) return;
        const res = await fetch("/api/referral/code", { headers: { Authorization: `Bearer ${token}` } });
        const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        if (!on) return;
        if (res.ok && data.code) setCode(data.code);
        else setError(data.error || "Couldn't load your invite link.");
      } catch {
        if (on) setError("Couldn't load your invite link.");
      }
    })();
    return () => { on = false; };
  }, []);

  const url = code ? `${window.location.origin}/?ref=${code}` : "";

  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  async function share() {
    if (!code) return;
    const text = "I've been using EILA to keep track of my pace and pay every day — worth a look:";
    if (canShare) {
      try { await navigator.share({ text, url }); return; } catch { /* user canceled — fine */ }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="glass p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-good/12 text-good"><Gift size={20} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Invite a colleague</div>
          <div className="text-xs text-fg/70">You both get a free month when they subscribe</div>
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-warn">{error}</p>}
      {code && (
        <button onClick={share} className="btn btn-primary mt-3.5 w-full">
          {copied ? <Check size={16} /> : canShare ? <Share2 size={16} /> : <Copy size={16} />}
          {copied ? "Copied — go ahead and send it" : "Share your link"}
        </button>
      )}
      {code && <div className="mt-2.5 truncate text-center text-[11px] text-fg/60">{url}</div>}
    </div>
  );
}
