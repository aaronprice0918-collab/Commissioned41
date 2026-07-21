"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useMission } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { SubscribeCard } from "@/components/SubscribeCard";
import { MissionMark } from "@/components/Brand";
import { redeemTeamCode, stashedTeamCode } from "@/lib/teamAccess";

// The deep-link entitlement gate (July 5 audit C-3, hardened July 8): one
// cached server check per app-open; an active verdict is never downgraded
// mid-session (a real lapse shows on the next full load). Shared by AppShell
// (all in-shell pages) AND standalone pages like /report — one gate, no forks.
// null = unknown/unchecked (render normally); false = signed in, not entitled.
export function useEntitled(account: { id: string; email: string } | null): boolean | null {
  const [entitled, setEntitled] = useState<boolean | null>(() => {
    try { return sessionStorage.getItem("lite-ent-ok") === "1" ? true : null; } catch { return null; }
  });
  useEffect(() => {
    if (!account || entitled === true) { if (!account) setEntitled(null); return; }
    let live = true;
    (async () => {
      try {
        const sb = getSupabase();
        const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
        const res = await fetch("/api/entitlement", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const j = (await res.json().catch(() => ({}))) as { active?: boolean; reason?: string };
        if (!live) return;
        if (j.active) { setEntitled(true); try { sessionStorage.setItem("lite-ent-ok", "1"); } catch {} }
        else if (j.reason && j.reason !== "not-signed-in") setEntitled(false); // signed in, genuinely not entitled
      } catch { /* network blip: don't wall a paying user */ }
    })();
    return () => { live = false; };
  }, [account, entitled]);
  return entitled;
}

// Shown to a signed-in user who isn't a paying subscriber. If they arrived via
// a team link (/team/<code>), the stashed code is redeemed here first — on
// success the page reloads straight into the app, so a comped teammate never
// sees a price. Everyone else can subscribe (checkout ties to their account
// email) or sign out.
export function Paywall() {
  const { account, signOut } = useMission();
  // Start in "redeeming" whenever a code is stashed so the subscribe card
  // doesn't flash before the comp lands.
  const [redeeming, setRedeeming] = useState(() => !!stashedTeamCode());

  useEffect(() => {
    if (!stashedTeamCode()) return;
    let live = true;
    (async () => {
      const ok = await redeemTeamCode();
      if (!live) return;
      if (ok) {
        window.location.reload();
      } else {
        setRedeeming(false);
      }
    })();
    return () => { live = false; };
  }, []);

  if (redeeming) {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <div className="glass w-full max-w-md rounded-[24px] p-8 text-center">
          <MissionMark width={76} className="mx-auto" />
          <div className="mt-6 flex items-center justify-center gap-2 text-fg/70">
            <Loader2 size={16} className="animate-spin" /> Activating your team access…
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
      <SubscribeCard
        email={account?.email}
        header={
          <p className="mt-3 text-center text-xs text-fg/70">
            Signed in as {account?.email} ·{" "}
            <button onClick={() => signOut()} className="underline transition hover:text-fg">
              Sign out
            </button>
          </p>
        }
      />
    </main>
  );
}
