"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const next = params.get("next") || "/";
        router.replace(next);
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.error === "string" ? d.error : "Sign in failed.");
      }
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <form onSubmit={submit} className="glass rise w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-[var(--accent)]/30 to-transparent">
            <span className="text-lg font-bold tracking-tight text-white">M</span>
          </div>
          <div>
            <div className="text-sm font-semibold">MissionOS Finance</div>
            <div className="text-xs text-[var(--text-faint)]">Locked — enter your passphrase</div>
          </div>
        </div>

        <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Passphrase
        </label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base outline-none transition focus:border-[var(--accent)]/60"
          placeholder="••••••••••"
        />

        {error && <div className="mt-3 text-sm text-[var(--stop)]">{error}</div>}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-5 w-full rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-soft)] disabled:opacity-40"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center px-5">
          <div className="text-sm text-[var(--text-dim)]">Loading…</div>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
