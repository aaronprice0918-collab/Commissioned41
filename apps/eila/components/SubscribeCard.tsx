"use client";

import { useEffect, useState } from "react";
import { Check, ArrowRight, Loader2, ShieldCheck, Sparkles, Gift } from "lucide-react";
import { MissionMark } from "@/components/Brand";
import { captureReferralCode, stashedReferralCode } from "@/lib/referral";

const FEATURES = [
  "Your Day board — life, money, reminders, and sales context together",
  "A clean monthly deal log with report cards for every customer",
  "Goal pacing: know if you're ahead or behind, in real time",
  "EILA briefs your day, deal board, and money without living in your CRM",
];

const INVITE_KEY = "lite-invite";

// An invite link (?invite=CODE) can land on any page and the sign-up flow
// navigates away before the paywall shows — so the code is stashed the
// moment it's seen and survives until checkout uses it.
export function captureInvite() {
  try {
    const code = new URLSearchParams(window.location.search).get("invite");
    if (code) localStorage.setItem(INVITE_KEY, code.trim());
  } catch {}
}

// The EILA subscribe card — shared by the public /subscribe page and the
// in-app paywall. Starts Stripe checkout for the $19.99/mo subscription,
// passing the account email so the payment ties to the right person. With a
// valid invite code, checkout opens as a 30-day free trial instead.
export function SubscribeCard({ email, header }: { email?: string; header?: React.ReactNode }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [referral, setReferral] = useState<string | null>(null);

  useEffect(() => {
    captureInvite();
    captureReferralCode();
    try { setInvite(localStorage.getItem(INVITE_KEY)); } catch {}
    setReferral(stashedReferralCode());
  }, []);

  async function subscribe() {
    if (status === "loading") return;
    setStatus("loading");
    setError("");
    try {
      // An invite code (30-day trial) and a referral code (one free month)
      // are both "get in free" mechanics — don't stack them. Invite wins if
      // somehow both are stashed at once.
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(email ? { email } : {}),
          ...(invite ? { invite } : referral ? { referral } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        // A bad/expired invite shouldn't dead-end the purchase — clear it so
        // the next tap is a normal subscribe, and say what happened.
        if (invite && res.status === 400 && data.error?.includes("invite")) {
          try { localStorage.removeItem(INVITE_KEY); } catch {}
          setInvite(null);
        }
        throw new Error(data.error || "Could not start checkout.");
      }
      window.location.href = data.url;
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    }
  }

  return (
    <div className="glass living-ring w-full max-w-md rounded-[26px] p-7 sm:p-8">
      <MissionMark width={76} className="mx-auto" />
      {header}

      <h1 className="mt-6 text-center font-display text-2xl font-black leading-tight">
        Meet EILA.
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-center text-[15px] leading-relaxed text-fg/60">
        Bring EILA the messy month. She helps you see your day, your deals, your money, and the
        next step with confidence.
      </p>

      {invite && (
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-good/25 bg-good/10 px-3.5 py-2.5 text-sm font-semibold text-good">
          <Gift size={16} /> Invite accepted — your first 30 days are free
        </div>
      )}
      {!invite && referral && (
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-good/25 bg-good/10 px-3.5 py-2.5 text-sm font-semibold text-good">
          <Gift size={16} /> Referred by a colleague — your first month is free
        </div>
      )}

      <div className="mt-6 space-y-2.5">
        {FEATURES.map((f) => (
          <div key={f} className="flex items-start gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
              <Check size={12} />
            </span>
            <span className="text-[15px] leading-snug text-fg/85">{f}</span>
          </div>
        ))}
      </div>

      <div className="mt-7 flex items-end justify-center gap-1.5">
        {invite ? (
          <>
            <span className="font-display text-5xl font-black tabnum leading-none">$0</span>
            <span className="pb-1 text-fg/50">for 30 days, then $19.99 / month</span>
          </>
        ) : referral ? (
          <>
            <span className="font-display text-5xl font-black tabnum leading-none">$0</span>
            <span className="pb-1 text-fg/50">for your first month, then $19.99 / month</span>
          </>
        ) : (
          <>
            <span className="font-display text-5xl font-black tabnum leading-none">$19.99</span>
            <span className="pb-1 text-fg/50">/ month</span>
          </>
        )}
      </div>
      <p className="mt-1.5 text-center text-xs text-fg/65">Cancel anytime · secure checkout by Stripe</p>

      <button onClick={subscribe} disabled={status === "loading"} className="btn btn-primary mt-6 w-full">
        {status === "loading" ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Starting checkout…
          </>
        ) : invite ? (
          <>
            <Gift size={16} /> Start your free 30 days <ArrowRight size={16} />
          </>
        ) : referral ? (
          <>
            <Gift size={16} /> Start your free month <ArrowRight size={16} />
          </>
        ) : (
          <>
            <Sparkles size={16} /> Subscribe — $19.99/mo <ArrowRight size={16} />
          </>
        )}
      </button>

      {status === "error" && <p className="mt-3 text-center text-sm text-warn">{error}</p>}

      <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-fg/60">
        <ShieldCheck size={13} /> Payments are securely handled by Stripe. We never see your card.
      </div>
      <p className="mt-2 text-center text-[11px] text-fg/60">
        By subscribing you agree to the{" "}
        <a href="/terms" className="underline hover:text-fg/60">Terms</a> and{" "}
        <a href="/privacy" className="underline hover:text-fg/60">Privacy Policy</a>.
      </p>
    </div>
  );
}
