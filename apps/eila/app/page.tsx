"use client";

import { useEffect, useRef, useState } from "react";
import { useMission } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { Onboarding } from "@/components/Onboarding";
import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/components/Dashboard";
import { AuthScreen } from "@/components/AuthScreen";
import { Paywall } from "@/components/Paywall";
import { captureInvite } from "@/components/SubscribeCard";
import { captureTeamCode } from "@/lib/teamAccess";
import { captureReferralCode } from "@/lib/referral";

type Account = { id: string; email: string } | null;

// Checks (server-side) whether the signed-in user has an active subscription.
function useEntitlement(account: Account) {
  const [state, setState] = useState<{ checking: boolean; active: boolean }>({
    checking: !!account,
    active: false,
  });
  // Mirror of state.active for the async check() — once a session is verified
  // active, background re-checks must never downgrade or sign it out.
  const activeRef = useRef(false);
  activeRef.current = state.active;

  useEffect(() => {
    if (!account) {
      setState({ checking: false, active: false });
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ checking: true, active: false });

    // A single check can land at a bad moment (session token just expired and
    // not yet refreshed, a network blip) — and a false negative here paywalls a
    // paying/comped user until they fully reload. So: retry once shortly after
    // a negative, re-check when the auth token refreshes or the app returns to
    // the foreground, and never DOWNGRADE an active verdict mid-session (a
    // genuine lapse gets picked up on the next full load).
    const check = async (isRetry: boolean) => {
      if (!live) return;
      try {
        const sb = getSupabase();
        const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
        const res = await fetch("/api/entitlement", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const j = (await res.json().catch(() => ({ active: false }))) as { active?: boolean; reason?: string };
        if (!live) return;
        if (j.active) {
          setState({ checking: false, active: true });
          return;
        }
        // The server can't see our session (revoked/expired token — e.g. after
        // a password change) while the client still thinks it's signed in. That
        // person needs the sign-in screen, NOT the paywall. Try one token
        // refresh; if the session is truly dead, sign out so AuthScreen shows.
        if (j.reason === "not-signed-in" && sb && !activeRef.current) {
          if (!isRetry) {
            await sb.auth.refreshSession().catch(() => null);
            timer = setTimeout(() => check(true), 500);
          } else {
            await sb.auth.signOut().catch(() => null);
          }
          return;
        }
        setState((s) => (s.active ? s : { checking: false, active: false }));
        if (!isRetry) timer = setTimeout(() => check(true), 2500);
      } catch {
        if (!live) return;
        setState((s) => (s.active ? s : { checking: false, active: false }));
        if (!isRetry) timer = setTimeout(() => check(true), 2500);
      }
    };

    check(false);

    const sb = getSupabase();
    const sub = sb?.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") check(true);
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") check(true);
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      sub?.data.subscription.unsubscribe();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account?.id]);

  return state;
}

export default function Page() {
  useEffect(() => { captureInvite(); captureTeamCode(); captureReferralCode(); }, []);

  const { data, ready, account, cloudChecked, cloudError } = useMission();
  const ent = useEntitlement(account);

  // Failsafe: if auth isn't configured (no Supabase), don't lock anyone out.
  const gated = !!getSupabase();

  if (!ready) return <Splash />;

  if (gated) {
    if (!account) return <AuthScreen />;
    if (ent.checking) return <Splash />;
    if (!ent.active) return <Paywall />;
    // Signed in but nothing on this device yet: their profile may still be
    // syncing down (sign-out wipes the device on purpose). Hold the splash
    // until the cloud has answered — otherwise a returning user gets marched
    // through onboarding again and can clobber their real plan. A FAILED
    // check gets a retry, never onboarding (an "empty" default profile built
    // over an unreachable cloud copy would overwrite the real one).
    if (!data.profile && !cloudChecked) return cloudError ? <CloudRetry /> : <Splash />;
  }

  if (!data.profile) return <Onboarding />;

  return (
    <AppShell active="home">
      <Dashboard />
    </AppShell>
  );
}

function CloudRetry() {
  return (
    <div className="grid min-h-[100dvh] place-items-center px-6">
      <div className="glass w-full max-w-sm space-y-3 p-6 text-center">
        <p className="font-bold">Couldn&apos;t reach your data</p>
        <p className="text-sm text-fg/60">Your plan and deals are saved in the cloud — we just couldn&apos;t pull them down. Check your connection and try again.</p>
        <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="grid min-h-[100dvh] place-items-center">
      <div className="h-10 w-10 animate-pulse rounded-full bg-accent/30" />
    </div>
  );
}
