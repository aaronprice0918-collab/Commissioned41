"use client";

import { useState } from "react";
import { ArrowRight, Gift, Loader2, Lock, Mail } from "lucide-react";
import { useMission } from "@/lib/store";
import { MissionMark } from "@/components/Brand";
import { hasTeamInvite } from "@/lib/teamAccess";

// The front door: you must have an account to use Mission OS Lite. Email +
// password via the existing Supabase auth. After sign-in the gate checks for an
// active subscription.
//
// Someone arriving on a team link (/team/<code>) is here to CREATE an account,
// not sign in — so for them the form opens in sign-up mode with a "your access
// is free" note, instead of making a first-timer hunt for the little "New here?"
// toggle under a "Welcome back" heading.
export function AuthScreen() {
  const { signIn, signUp, requestPasswordReset } = useMission();
  // Lazy initializer: AuthScreen only mounts after the client-side store is
  // ready, so reading the URL/localStorage here is safe (no SSR pass).
  const [teamInvite] = useState(() => hasTeamInvite());
  const [mode, setMode] = useState<"in" | "up">(teamInvite ? "up" : "in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  // "Forgot password?" is a separate mini-flow, not a third value of `mode` —
  // it only ever needs an email field and never touches signIn/signUp.
  const [forgot, setForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setCheckEmail(false);
    const err = mode === "in" ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    // signUp with email confirmation on → no session yet; tell them to confirm.
    if (mode === "up") setCheckEmail(true);
    // On success the auth listener sets `account` and the gate advances.
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const err = await requestPasswordReset(email.trim());
    setBusy(false);
    // Show the same confirmation whether or not the email matches an account —
    // never reveal which emails are registered.
    if (err) { setError(err); return; }
    setForgotSent(true);
  }

  if (checkEmail) {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <div className="glass w-full max-w-md rounded-[24px] p-8 text-center">
          <Mail className="mx-auto text-accent" size={30} />
          <h1 className="mt-4 font-display text-xl font-black">Almost there.</h1>
          <p className="mt-2 text-fg/60">
            We created your account. If you&apos;re asked to confirm your email, tap the link we sent,
            then come back and sign in.
          </p>
          <button className="btn btn-ghost mt-6 w-full" onClick={() => { setMode("in"); setCheckEmail(false); }}>
            Back to sign in
          </button>
        </div>
      </main>
    );
  }

  if (forgot) {
    if (forgotSent) {
      return (
        <main className="grid min-h-[100dvh] place-items-center px-5">
          <div className="glass w-full max-w-md rounded-[24px] p-8 text-center">
            <Mail className="mx-auto text-accent" size={30} />
            <h1 className="mt-4 font-display text-xl font-black">Check your email.</h1>
            <p className="mt-2 text-fg/60">
              If an account exists for {email.trim()}, we sent a link to reset the password. It's good
              for a little while — tap it, then set a new password.
            </p>
            <button className="btn btn-ghost mt-6 w-full" onClick={() => { setForgot(false); setForgotSent(false); }}>
              Back to sign in
            </button>
          </div>
        </main>
      );
    }
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
        <form onSubmit={submitForgot} className="glass living-ring w-full max-w-sm rounded-[26px] p-7">
          <MissionMark width={70} className="mx-auto" />
          <h1 className="mt-5 text-center font-display text-2xl font-black">Reset your password.</h1>
          <p className="mt-1.5 text-center text-sm text-fg/55">
            Enter your email and we'll send you a reset link.
          </p>

          <label className="mt-6 block">
            <span className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">
              <Mail size={12} /> Email
            </span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className="field w-full" autoComplete="email" autoFocus />
          </label>

          {error && <p className="mt-3 text-center text-sm text-warn">{error}</p>}

          <button type="submit" disabled={busy} className="btn btn-primary mt-6 w-full">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <>Send reset link <ArrowRight size={16} /></>}
          </button>

          <button type="button" onClick={() => { setForgot(false); setError(""); }} className="mt-4 w-full text-center text-sm text-fg/55 transition hover:text-fg">
            Back to sign in
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
      <form onSubmit={submit} className="glass living-ring w-full max-w-sm rounded-[26px] p-7">
        <MissionMark width={70} className="mx-auto" />
        <h1 className="mt-5 text-center font-display text-2xl font-black">
          {mode === "in" ? "Welcome back." : "Create your account."}
        </h1>
        <p className="mt-1.5 text-center text-sm text-fg/55">
          {mode === "in" ? "Sign in and pick up where you left off." : "Set up EILA around your real numbers."}
        </p>

        {teamInvite && mode === "up" && (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-good/25 bg-good/10 px-3.5 py-2.5 text-sm font-semibold text-good">
            <Gift size={16} /> Team invite — your access is free
          </div>
        )}

        <label className="mt-6 block">
          <span className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">
            <Mail size={12} /> Email
          </span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className="field w-full" autoComplete="email" />
        </label>
        <label className="mt-3.5 block">
          <span className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">
            <Lock size={12} /> Password
          </span>
          {/* minLength only on SIGN-UP: enforcing it at sign-in locked out
              accounts legitimately created elsewhere with a shorter password
              (Settings' account block never imposed one) — July 8 audit. */}
          <input type="password" required minLength={mode === "up" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "up" ? "At least 8 characters" : "Your password"} className="field w-full" autoComplete={mode === "in" ? "current-password" : "new-password"} />
        </label>

        {mode === "in" && (
          <button type="button" onClick={() => { setForgot(true); setError(""); }} className="mt-2.5 block w-full text-right text-xs text-fg/65 transition hover:text-fg/70">
            Forgot password?
          </button>
        )}

        {error && <p className="mt-3 text-center text-sm text-warn">{error}</p>}

        <button type="submit" disabled={busy} className="btn btn-primary mt-6 w-full">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <>{mode === "in" ? "Sign in" : "Create account"} <ArrowRight size={16} /></>}
        </button>

        <button type="button" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(""); }} className="mt-4 w-full text-center text-sm text-fg/55 transition hover:text-fg">
          {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}
