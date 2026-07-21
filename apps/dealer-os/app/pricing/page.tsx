"use client";

import { useEffect, useState } from "react";
import { MissionWordmark } from "@/components/BrandMarks";
import {
  Activity, Brain, Check, ClipboardCheck, DollarSign, Handshake,
  LayoutGrid, Loader2, ShieldCheck, Sparkles, Target, TrendingUp, Users,
} from "lucide-react";

// The disconnected stack a dealer pays for today — shown to make the pain concrete.
// Only list what Dealer Mission OS actually replaces TODAY (no F&I menu yet — don't overclaim).
const OLD_STACK = ["CRM & desking", "Reporting", "Pay & goal tracker", "Spreadsheets"];

// What Dealer Mission OS does — his words: CRM, desking, tracking, pacing, goals, accountability, ROI.
const CAPABILITIES = [
  { icon: LayoutGrid, label: "Tells every rep what to do next" },
  { icon: Handshake, label: "Desking & deal structuring" },
  { icon: ClipboardCheck, label: "Lease & financing, built in" },
  { icon: TrendingUp, label: "Live tracking & pacing" },
  { icon: Target, label: "No lost lead, no leaked gross" },
  { icon: DollarSign, label: "Your store's real ROI" },
];

const PLAN_FEATURES = [
  "Your whole store in one operating system — the floor, desking, financing, reporting",
  "EILA tells you what to do next and helps structure every deal",
  "The morning brief: yesterday's numbers and who needs you, no reports to run",
  "See who's actually putting in the work — real accountability",
  "Know your store's ROI, to the dollar",
  "Unlimited users · we get you set up",
];

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"success" | "cancel" | null>(null);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s === "success" || s === "cancel") setStatus(s);
  }, []);

  async function subscribe() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setLoading(false);
    }
  }

  function scrollToSubscribe() {
    document.getElementById("subscribe")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 pt-12 pb-32">
      {/* Ambient depth — soft cyan glows behind the glass. */}
      <div
        className="glass-orb"
        style={{ width: 320, height: 320, top: -90, left: -70, background: "radial-gradient(circle, rgba(96,150,255,0.16), transparent 70%)" }}
        aria-hidden
      />
      <div
        className="glass-orb"
        style={{ width: 360, height: 360, top: 680, right: -90, background: "radial-gradient(circle, rgba(96,150,255,0.12), transparent 70%)" }}
        aria-hidden
      />

      <div className="relative mx-auto w-full max-w-md space-y-16">
        {status === "success" && (
          <div className="glass-panel glass-accent rounded-2xl px-5 py-4 text-center">
            <div className="flex items-center justify-center gap-2 font-semibold text-mission-green">
              <Check className="h-5 w-5" /> You&apos;re in. Welcome to Dealer Mission OS.
            </div>
            <p className="mt-1 text-sm text-white/70">We&apos;ll get your store set up right away.</p>
          </div>
        )}
        {status === "cancel" && (
          <div className="glass-panel rounded-2xl px-5 py-4 text-center text-sm text-white/70">
            No charge made. Ready whenever you are. 👇
          </div>
        )}

        {/* ───────── HERO ───────── */}
        <section className="pt-4 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-mission-green/20 bg-mission-green/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-mission-green/90">
            <Sparkles className="h-3.5 w-3.5" /> Dealer Mission OS
          </div>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] text-white">
            Do you run a dealership?
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-white/70">
            Tired of paying for program after program — and not one of them
            tells you the same thing?
          </p>
          <p className="mt-6 text-xl font-semibold text-white">
            That&apos;s exactly why I built{" "}
            <MissionWordmark className="text-xl" />.
          </p>
          <p className="mt-3 text-sm text-white/45">— Aaron Price · founder, Commissioned 41</p>

          <button
            onClick={scrollToSubscribe}
            className="glass-tactile mt-8 inline-flex items-center justify-center gap-2 rounded-2xl bg-mission-green/90 px-7 py-4 text-base font-bold text-mission-navy transition hover:bg-mission-green"
          >
            See it — $499/mo
          </button>
        </section>

        {/* ───────── THE PROBLEM: five tools → one ───────── */}
        <section className="glass-panel relative overflow-hidden rounded-3xl p-7">
          <span className="glass-sweep" aria-hidden />
          <h2 className="text-2xl font-bold text-white">Tool after tool. Bill after bill.</h2>
          <p className="mt-2 text-white/60">And not one of them agrees on your numbers.</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {OLD_STACK.map((t) => (
              <span
                key={t}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white/40 line-through decoration-mission-red/50"
              >
                {t}
              </span>
            ))}
          </div>

          <div className="neon-rule my-6" />

          <p className="text-lg font-semibold text-white">
            Dealer Mission OS is all of it — in one place, on your phone.
          </p>
        </section>

        {/* ───────── WHAT IT DOES ───────── */}
        <section>
          <h2 className="text-center text-2xl font-bold text-white">
            Everything your store runs on.
            <br />
            <span className="text-mission-green">One app.</span>
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {CAPABILITIES.map(({ icon: Icon, label }) => (
              <div key={label} className="glass-panel rounded-2xl p-4">
                <Icon className="h-5 w-5 text-mission-green" />
                <p className="mt-2 text-sm font-medium leading-snug text-white/85">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ───────── THE TWO THINGS NOBODY SHOWS YOU ───────── */}
        <section className="space-y-3">
          <div className="glass-panel flex items-center gap-4 rounded-2xl p-5">
            <Users className="h-6 w-6 flex-none text-mission-green" />
            <p className="text-base font-semibold text-white">
              See who&apos;s actually putting in the work.
            </p>
          </div>
          <div className="glass-panel flex items-center gap-4 rounded-2xl p-5">
            <DollarSign className="h-6 w-6 flex-none text-mission-green" />
            <p className="text-base font-semibold text-white">
              Know your store&apos;s true ROI — to the dollar.
            </p>
          </div>
        </section>

        {/* ───────── THE ALIVE AI ───────── */}
        <section className="glass-panel glass-accent relative overflow-hidden rounded-3xl p-7 text-center">
          <span className="glass-sweep" aria-hidden />
          <div className="inline-flex items-center gap-2 rounded-full border border-mission-green/20 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-mission-green">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-mission-green" /> Live
          </div>
          <div className="mt-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-mission-green/30 bg-mission-green/10">
            <Brain className="h-7 w-7 text-mission-green" />
          </div>
          <h2 className="mt-5 text-2xl font-bold leading-snug text-white">
            An AI that knows your store
            <br />
            better than you do.
          </h2>
          <p className="mt-4 leading-relaxed text-white/70">
            It watches your floor in real time, sees the deal from an angle you
            didn&apos;t — and tells you how to structure it to make it.
          </p>
        </section>

        {/* ───────── THE MISSION ───────── */}
        <section className="text-center">
          <Activity className="mx-auto h-6 w-6 text-mission-green/70" />
          <h2 className="mt-4 text-3xl font-extrabold leading-tight text-white">
            Built to revolutionize the car business.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-white/70">
            If you run a store in America and you don&apos;t have Dealer Mission OS in
            your pocket — you&apos;re missing the ball.
          </p>
        </section>

        {/* ───────── PRICING / SUBSCRIBE ───────── */}
        <section id="subscribe" className="glass-panel relative overflow-hidden rounded-3xl p-7 scroll-mt-6">
          <span className="glass-sweep" aria-hidden />
          <div className="flex items-end gap-1">
            <span className="glass-num text-5xl font-extrabold text-white">$499</span>
            <span className="mb-1 text-white/60">/ month per store</span>
          </div>

          <div className="neon-rule my-6" />

          <ul className="space-y-3">
            {PLAN_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-white/85">
                <Check className="mt-0.5 h-4 w-4 flex-none text-mission-green" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={subscribe}
            disabled={loading}
            className="glass-tactile mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-mission-green/90 px-6 py-4 text-base font-bold text-mission-navy transition hover:bg-mission-green disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Taking you to checkout…
              </>
            ) : (
              <>Subscribe — start today</>
            )}
          </button>

          {error && <p className="mt-3 text-center text-sm text-mission-red">{error}</p>}

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-white/50">
            <ShieldCheck className="h-3.5 w-3.5" /> Secure checkout by Stripe · cancel anytime
          </p>
        </section>
      </div>
    </main>
  );
}
