"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Lock } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { useMission } from "@/lib/store";
import { MissionMark } from "@/components/Brand";

// Where the emailed reset link lands. Supabase parses the recovery token out of
// the URL hash itself and fires a PASSWORD_RECOVERY auth event, establishing a
// short-lived session scoped to "you may now set a new password" — nothing else.
// If someone opens this page without a valid/unexpired link, no recovery event
// fires and we show an explicit "link's no good" state instead of a dead form.
export default function ResetPasswordPage() {
  const router = useRouter();
  const { updatePassword } = useMission();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setStatus("invalid"); return; }
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setStatus("ready");
    });
    // The event can fire before this listener attaches, so also check directly.
    // NOTE: a normally signed-in user who navigates here also has a session —
    // for them this is just "change my password", which Supabase allows.
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) setStatus((s) => (s === "checking" ? "ready" : s));
    });
    const timer = setTimeout(() => setStatus((s) => (s === "checking" ? "invalid" : s)), 4000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    const err = await updatePassword(password);
    setBusy(false);
    if (err) { setError(err); return; }
    setDone(true);
    setTimeout(() => router.replace("/"), 1500);
  }

  if (status === "checking") {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <Loader2 className="animate-spin text-fg/65" size={24} />
      </main>
    );
  }

  if (status === "invalid") {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <div className="glass w-full max-w-md rounded-[24px] p-8 text-center">
          <h1 className="font-display text-xl font-black">That link's expired.</h1>
          <p className="mt-2 text-fg/60">
            Reset links only work for a little while. Head back and request a fresh one.
          </p>
          <a href="/" className="btn btn-primary mt-6 inline-flex w-full items-center justify-center gap-2">
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <div className="glass w-full max-w-md rounded-[24px] p-8 text-center">
          <h1 className="font-display text-xl font-black">Password updated.</h1>
          <p className="mt-2 text-fg/60">Taking you in…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
      <form onSubmit={submit} className="glass living-ring w-full max-w-sm rounded-[26px] p-7">
        <MissionMark width={70} className="mx-auto" />
        <h1 className="mt-5 text-center font-display text-2xl font-black">Set a new password.</h1>
        <p className="mt-1.5 text-center text-sm text-fg/55">Make it something only you know.</p>

        <label className="mt-6 block">
          <span className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">
            <Lock size={12} /> New password
          </span>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className="field w-full" autoComplete="new-password" autoFocus />
        </label>
        <label className="mt-3.5 block">
          <span className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">
            <Lock size={12} /> Confirm password
          </span>
          <input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" className="field w-full" autoComplete="new-password" />
        </label>

        {error && <p className="mt-3 text-center text-sm text-warn">{error}</p>}

        <button type="submit" disabled={busy} className="btn btn-primary mt-6 w-full">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <>Update password <ArrowRight size={16} /></>}
        </button>
      </form>
    </main>
  );
}
