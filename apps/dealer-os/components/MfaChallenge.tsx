"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LockKeyhole } from "lucide-react";

// The second step of sign-in for anyone with two-factor turned on: password
// got them a partial (aal1) session, this screen upgrades it to aal2 with the
// 6-digit code from their authenticator app. Rendered by AuthProvider INSTEAD
// of the app until the code verifies — there is no way around it short of
// signing out.
export function MfaChallenge({
  supabase,
  onVerified,
  onSignOut,
}: {
  supabase: SupabaseClient;
  onVerified: () => void;
  onSignOut: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const factorId = useRef<string>("");

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      factorId.current = data?.totp?.[0]?.id ?? "";
    });
  }, [supabase]);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId.current) {
      setError("Couldn't find your authenticator on this account — sign out and back in.");
      return;
    }
    setBusy(true);
    setError("");
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factorId.current });
    if (challengeError || !challenge) {
      setError(challengeError?.message || "Couldn't start the check — try again.");
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: factorId.current,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError("That code didn't match. Codes rotate every 30 seconds — grab the current one and try again.");
      setCode("");
      return;
    }
    onVerified();
  }

  return (
    <div className="grid min-h-screen place-items-center bg-mission-navy p-4 text-white">
      <div className="glass-panel w-full max-w-sm rounded-[20px] p-6">
        <div className="grid h-12 w-12 place-items-center rounded-full border border-mission-gold/40 bg-mission-gold/10">
          <LockKeyhole className="h-6 w-6 text-mission-gold" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-black">Two-factor check</h1>
        <p className="mt-1 text-sm text-white/60">Enter the 6-digit code from your authenticator app to finish signing in.</p>
        <form onSubmit={verify} className="mt-5 space-y-3">
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="w-full rounded-[12px] border border-white/12 bg-[#14161c]/80 p-3 text-center font-display text-2xl font-black tracking-[0.4em] text-white outline-none placeholder:text-white/20 focus:border-mission-gold/60"
          />
          {error && <p className="text-sm font-bold text-mission-red">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Checking…" : "Verify"}
          </button>
        </form>
        <button type="button" onClick={onSignOut} className="mt-4 w-full text-center text-xs font-bold uppercase tracking-[0.12em] text-white/40 transition hover:text-white/70">
          Sign out instead
        </button>
      </div>
    </div>
  );
}
