"use client";

import { useEffect, useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { SubscribeCard } from "@/components/SubscribeCard";
import { clearReferralCode } from "@/lib/referral";

// Public buy page. Reuses the shared SubscribeCard; also handles the return from
// Stripe (success → "you're in", cancel → "no charge").
export default function SubscribePage() {
  const [flash, setFlash] = useState<"success" | "cancel" | null>(null);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s === "success" || s === "cancel") setFlash(s);
    // A real checkout just completed — the stashed referral code (if any)
    // has already done its one job (applied at /api/checkout). Clear it so a
    // later cancel-then-resubscribe doesn't silently reapply the same free
    // month again (clearReferralCode was dead code until this — audit
    // finding, July 5: unlike the matching team-code flow, nothing ever
    // called it).
    if (s === "success") clearReferralCode();
  }, []);

  if (flash === "success") {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <div className="glass w-full max-w-md rounded-[24px] p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-good/15 text-good">
            <Check size={28} />
          </div>
          <h1 className="mt-5 font-display text-2xl font-black">You&apos;re in.</h1>
          <p className="mt-2 text-fg/60">
            Welcome to EILA. Your subscription is active — open the app and start executing your mission.
          </p>
          <a href="/" className="btn btn-primary mt-7 w-full">
            Open EILA <ArrowRight size={16} />
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
      <SubscribeCard
        header={
          flash === "cancel" ? (
            <p className="mt-3 rounded-xl bg-fg/5 px-4 py-2 text-center text-sm text-fg/60">
              No charge made. Whenever you&apos;re ready, you&apos;re one tap away.
            </p>
          ) : undefined
        }
      />
    </main>
  );
}
