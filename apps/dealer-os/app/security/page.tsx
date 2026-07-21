"use client";

import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, ShieldCheck, ShieldOff } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { useAuth } from "@/components/AuthProvider";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

// Two-factor authentication, self-serve per user. Dealers are FTC "financial
// institutions" under the Safeguards Rule — MFA on systems that touch customer
// information isn't optional for a store, so every account can turn it on
// here with any authenticator app (Google Authenticator, 1Password, Authy…).
// Enrollment is TOTP via Supabase auth: enroll → scan QR → prove one code →
// from then on sign-in asks for the rotating 6-digit code.
export default function SecurityPage() {
  const { session, signOut } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [factors, setFactors] = useState<{ id: string; status: string; friendly_name?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const refresh = useMemo(
    () => async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data } = await supabase.auth.mfa.listFactors();
      setFactors((data?.all ?? []).filter((f) => f.factor_type === "totp").map((f) => ({ id: f.id, status: f.status, friendly_name: f.friendly_name })));
      setLoading(false);
    },
    [supabase]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = factors.find((f) => f.status === "verified");

  async function startEnroll() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    setDone("");
    // Clear any abandoned half-enrollment first — Supabase keeps unverified
    // factors around and a stale one blocks re-enrolling.
    for (const f of factors.filter((f) => f.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Dealer Mission OS" });
    setBusy(false);
    if (enrollError || !data) {
      setError(enrollError?.message || "Couldn't start enrollment — try again.");
      return;
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  }

  async function confirmEnroll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !enrolling) return;
    setBusy(true);
    setError("");
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
    if (challengeError || !challenge) {
      setError(challengeError?.message || "Couldn't verify — try again.");
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: challenge.id, code: code.trim() });
    setBusy(false);
    if (verifyError) {
      setError("That code didn't match — grab the current one from your app and try again.");
      setCode("");
      return;
    }
    setEnrolling(null);
    setDone("Two-factor is ON. From now on, sign-in asks for your 6-digit code.");
    void refresh();
  }

  async function turnOff() {
    if (!supabase || !active) return;
    if (!window.confirm("Turn OFF two-factor for your account? Sign-in goes back to password only.")) return;
    setBusy(true);
    setError("");
    setDone("");
    const { error: offError } = await supabase.auth.mfa.unenroll({ factorId: active.id });
    setBusy(false);
    if (offError) {
      setError(
        /aal2/i.test(offError.message)
          ? "For safety, turning two-factor off needs a fresh two-factor sign-in. Sign out, sign back in with your code, then come back here."
          : offError.message
      );
      return;
    }
    setDone("Two-factor is off.");
    void refresh();
  }

  if (!session) return null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6">
      <SectionHeader
        title="Security"
        kicker="Two-factor authentication protects customer information — the FTC Safeguards Rule expects it on every system that touches a deal."
        icon={ShieldCheck}
      />

      <div className="glass-card rounded-[16px] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border ${active ? "border-mission-green/50 bg-mission-green/10" : "border-white/12 bg-white/[0.04]"}`}>
              {active ? <ShieldCheck className="h-5 w-5 text-mission-green" /> : <ShieldOff className="h-5 w-5 text-white/45" />}
            </div>
            <div>
              <div className="font-display text-xl font-black text-white">Two-factor authentication</div>
              <div className={`mt-0.5 text-sm font-bold ${active ? "text-mission-green" : "text-white/50"}`}>
                {loading ? "Checking…" : active ? "ON — sign-in asks for your authenticator code" : "OFF — password only"}
              </div>
            </div>
          </div>
          {!loading && !enrolling && (
            <button
              type="button"
              onClick={active ? turnOff : startEnroll}
              disabled={busy || !supabase}
              className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.12em] transition disabled:opacity-40 ${active ? "border border-mission-red/40 text-mission-red hover:bg-mission-red hover:text-white" : "bg-mission-gold text-mission-navy shadow-gold hover:brightness-110"}`}
            >
              {active ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>

        {!supabase && <p className="mt-4 text-sm text-white/50">Two-factor setup isn’t available in this preview — it works on the live site.</p>}

        {enrolling && (
          <div className="mt-5 rounded-[12px] border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-black uppercase tracking-[0.12em] text-mission-gold">Scan, then prove one code</div>
            <p className="mt-1 text-sm text-white/60">Open your authenticator app (Google Authenticator, 1Password, Authy…), scan this QR code, then type the 6-digit code it shows.</p>
            <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <div className="rounded-[12px] bg-white p-3" style={{ ["--c41-white" as string]: "255 255 255" }}>
                {/* Supabase hands back the QR as an SVG string; next/image can't take it, and it must render pixel-exact for scanners. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/svg+xml;utf8,${encodeURIComponent(enrolling.qr)}`} alt="Authenticator QR code" className="h-40 w-40" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/40">No camera? Enter this key manually</div>
                <div className="mt-1 break-all rounded-[8px] border border-white/10 bg-[#14161c]/80 p-2 font-mono text-xs text-white/80">{enrolling.secret}</div>
                <form onSubmit={confirmEnroll} className="mt-3 flex gap-2">
                  <input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="w-32 rounded-[10px] border border-white/12 bg-[#14161c]/80 p-2.5 text-center font-display text-lg font-black tracking-[0.3em] text-white outline-none placeholder:text-white/20 focus:border-mission-gold/60"
                  />
                  <button type="submit" disabled={busy || code.length !== 6} className="rounded-full bg-mission-gold px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-40">
                    {busy ? "Checking…" : "Activate"}
                  </button>
                </form>
                <button type="button" onClick={() => setEnrolling(null)} className="mt-2 text-xs font-bold uppercase tracking-[0.1em] text-white/40 transition hover:text-white/70">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm font-bold text-mission-red">{error}</p>}
        {done && <p className="mt-4 text-sm font-bold text-mission-green">{done}</p>}
      </div>

      <div className="glass-card rounded-[16px] p-5 text-sm leading-6 text-white/55">
        <div className="mb-1 flex items-center gap-2 font-display text-base font-black text-white">
          <LockKeyhole className="h-4 w-4 text-mission-gold" /> Why this matters
        </div>
        Dealerships are “financial institutions” under the FTC Safeguards Rule: multi-factor authentication is required on systems
        that access customer information. Turning this on covers your account; store admins should have every user with customer
        access do the same. Lost your authenticator app? Ask your store admin to reset your access.
        <button type="button" onClick={() => void signOut()} className="mt-3 block text-xs font-bold uppercase tracking-[0.12em] text-white/35 transition hover:text-white/70">
          Sign out
        </button>
      </div>
    </div>
  );
}
