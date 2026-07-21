"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, CreditCard, Loader2, ShieldAlert } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { authHeaders } from "@/lib/storeClient";

// The store's subscription — status, renewal, subscribe / manage. Admin-facing
// (the API enforces admin for the portal; reps who land here just see status).
// /api/billing GET is the single source of truth; Stripe hosts the actual
// checkout and portal pages, so no card data ever touches this app.

type BillingStatus = {
  configured: boolean;
  entitled: boolean;
  reason: string;
  status: string | null;
  currentPeriodEnd: string | null;
  hasCustomer: boolean;
  foundingStore: boolean;
  orgId: string;
};

export default function BillingPage() {
  const { profile, session } = useAuth();
  const [state, setState] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const paidJustNow = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("status") === "success";

  async function refresh() {
    try {
      const res = await fetch("/api/billing", { cache: "no-store", headers: await authHeaders() });
      if (res.ok) setState((await res.json()) as BillingStatus);
    } catch {
      /* leave the loading state */
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Fresh from Stripe Checkout: the webhook usually lands within seconds —
  // poll a few times so the page flips to Active without a manual reload.
  useEffect(() => {
    if (!paidJustNow) return;
    const timer = setInterval(() => void refresh(), 3000);
    const stop = setTimeout(() => clearInterval(timer), 30000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidJustNow]);

  async function subscribe() {
    if (!state) return;
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: state.orgId, email: profile?.email || session?.user?.email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) window.location.href = data.url;
      else setNote(data.error || "Couldn't start checkout — try again.");
    } catch {
      setNote("Couldn't start checkout — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/billing", { method: "POST", headers: await authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) window.location.href = data.url;
      else setNote(data.error || "Couldn't open the billing portal.");
    } catch {
      setNote("Couldn't open the billing portal.");
    } finally {
      setBusy(false);
    }
  }

  const active = !!state && (state.entitled || false);
  const statusLabel = state?.foundingStore
    ? "Founding store"
    : !state?.configured
      ? "Billing not set up yet"
      : state?.status
        ? state.status.replace(/_/g, " ")
        : state?.reason === "courtesy_window"
          ? "Trial window"
          : "No subscription";

  return (
    <div>
      <SectionHeader title="Billing" kicker="Your Dealer Mission OS subscription" />
      {!state ? (
        <div className="glass-card flex items-center gap-3 rounded-[12px] p-6 text-white/60">
          <Loader2 className="h-5 w-5 animate-spin text-mission-gold" /> Loading your subscription…
        </div>
      ) : (
        <div className="glass-card rounded-[12px] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`grid h-12 w-12 place-items-center rounded-[12px] ${active ? "bg-mission-green/10 text-mission-green" : "bg-mission-red/10 text-mission-red"}`}>
                {active ? <BadgeCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
              </div>
              <div>
                <div className="font-display text-2xl font-black text-white">Dealer Mission OS — $499/mo per store</div>
                <div className="mt-0.5 flex items-center gap-2 text-sm text-white/55">
                  <StatusPill tone={active ? "green" : "red"}>{statusLabel}</StatusPill>
                  {state.currentPeriodEnd && <span>renews {state.currentPeriodEnd.slice(0, 10)}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {state.configured && !state.foundingStore && !(state.status && ["active", "trialing"].includes(state.status)) && (
                <button type="button" disabled={busy} onClick={subscribe} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-mission-gold px-6 text-sm font-black uppercase tracking-[0.1em] text-mission-navy disabled:opacity-40">
                  <CreditCard className="h-4 w-4" /> Subscribe
                </button>
              )}
              {state.hasCustomer && (
                <button type="button" disabled={busy} onClick={openPortal} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-6 text-sm font-black uppercase tracking-[0.1em] text-white/75 transition hover:border-mission-gold/50 hover:text-white disabled:opacity-40">
                  Manage billing
                </button>
              )}
            </div>
          </div>
          {paidJustNow && !active && (
            <p className="mt-4 rounded-[10px] border border-mission-green/30 bg-mission-green/10 p-3 text-sm font-bold text-mission-green">
              Payment received — activating your store now (this takes a few seconds)…
            </p>
          )}
          {note && <p className="mt-4 text-sm font-bold text-mission-red">{note}</p>}
          <p className="mt-4 text-xs leading-5 text-white/40">
            Card, invoices, and cancellation are handled on Stripe&apos;s secure pages — no card data ever touches Dealer Mission OS.
            {state.foundingStore ? " As the founding store, your access never lapses." : ""}
          </p>
        </div>
      )}
    </div>
  );
}
