"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";

export function WaitlistForm({ source = "landing" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "loading") return;
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-full border border-mission-green/30 bg-mission-green/10 px-5 py-3.5 text-sm font-bold text-mission-green">
        <Check className="h-4 w-4" /> You&apos;re on the list. We&apos;ll be in touch.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-2.5 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="h-12 flex-1 rounded-full border border-white/15 bg-white/[0.04] px-5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-mission-gold/60"
      />
      <button
        type="submit"
        disabled={state === "loading"}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-mission-gold px-6 text-sm font-black uppercase tracking-[0.1em] text-mission-navy transition hover:brightness-110 disabled:opacity-50"
      >
        {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Join Waitlist <ArrowRight className="h-4 w-4" /></>}
      </button>
      {error && <p className="text-xs text-mission-red sm:absolute sm:mt-14">{error}</p>}
    </form>
  );
}
