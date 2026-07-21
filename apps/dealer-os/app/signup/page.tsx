"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2 } from "lucide-react";

const APP_URL = "https://missionos.commissioned41.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Demo-only until Stripe billing lands: keep self-serve sign-up closed. Flip
// NEXT_PUBLIC_SIGNUPS_OPEN="true" in Vercel to open the wizard to the public.
const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "true";

type Form = { dealershipName: string; name: string; email: string; password: string };

const STEPS = [
  {
    key: "dealershipName", q: "What's your store's name?",
    hint: "The name on your building. You can change it later.",
    placeholder: "Kennesaw Mazda", type: "text",
    bad: "Type your store's name to keep going.",
  },
  {
    key: "name", q: "What's your name?",
    hint: "Just your name — first and last is great.",
    placeholder: "Aaron Price", type: "text",
    bad: "Type your name to keep going.",
  },
  {
    key: "email", q: "What email do you want to log in with?",
    hint: "You'll use this to sign in. Use one you check.",
    placeholder: "you@email.com", type: "email",
    bad: "That doesn't look like an email. It should look like name@email.com.",
  },
  {
    key: "password", q: "Make a password.",
    hint: "At least 8 letters or numbers. Write it down so you don't forget it.",
    placeholder: "Your password", type: "password",
    bad: "A little longer, please — at least 8 characters.",
  },
] as const;

export default function SignupPage() {
  const [phase, setPhase] = useState<"welcome" | "form" | "done">("welcome");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>({ dealershipName: "", name: "", email: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // While sign-up is closed (demo-only), send anyone who lands here to the demo form.
  useEffect(() => {
    if (!SIGNUPS_OPEN) window.location.replace("/welcome#join");
  }, []);
  if (!SIGNUPS_OPEN) return null;

  const current = STEPS[step];
  const value = form[current?.key as keyof Form] ?? "";

  function valid(): boolean {
    if (current.key === "email") return EMAIL_RE.test(value.trim());
    if (current.key === "password") return value.length >= 8;
    return value.trim().length > 0;
  }

  function next() {
    if (!valid()) { setError(current.bad); return; }
    setError("");
    if (step < STEPS.length - 1) setStep(step + 1);
    else void submit();
  }

  async function submit() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      // Store created — hand straight off to Stripe Checkout with the new org
      // attached, so the webhook can activate it the moment they pay. If
      // billing isn't configured (or checkout hiccups), the plain done screen
      // still stands and the 14-day courtesy window covers them.
      if (data.orgId) {
        try {
          const pay = await fetch("/api/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgId: data.orgId, email: data.email }),
          });
          const payData = await pay.json().catch(() => ({}));
          if (pay.ok && payData.url) {
            window.location.href = payData.url;
            return;
          }
        } catch {
          // fall through to the done screen
        }
      }
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const card = "rounded-[22px] border border-white/10 bg-gradient-to-b from-[#0c0d10] to-[#08090b] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.7)]";

  return (
    <main className="grid min-h-screen place-items-center bg-[#08090c] px-5 py-10 text-white">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Image src="/brand/mission-logo.png" alt="Dealer Mission OS" width={150} height={34} className="mx-auto h-9 w-auto" priority />
        </div>

        {phase === "welcome" && (
          <div className={`${card} text-center`}>
            <h1 className="font-display text-3xl font-black leading-tight">Let&apos;s set up your store.</h1>
            <p className="mx-auto mt-3 max-w-xs text-lg leading-7 text-white/65">It takes about a minute. We&apos;ll ask a few easy questions — that&apos;s it.</p>
            <button type="button" onClick={() => setPhase("form")} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mission-gold px-6 py-4 text-base font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110">
              Get Started <ArrowRight className="h-5 w-5" />
            </button>
            <a href={`${APP_URL}/login`} className="mt-5 inline-block text-sm font-semibold text-white/50 transition hover:text-white">Already signed up? Log in</a>
          </div>
        )}

        {phase === "form" && (
          <div className={card}>
            <div className="mb-6 flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-mission-gold" : "bg-white/12"}`} />
              ))}
            </div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">Question {step + 1} of {STEPS.length}</div>
            <h1 className="mt-2 font-display text-2xl font-black leading-tight">{current.q}</h1>
            <p className="mt-1.5 text-base leading-6 text-white/60">{current.hint}</p>

            <div className="mt-5">
              <div className="flex items-center rounded-[14px] border border-white/12 bg-[#101218] focus-within:border-mission-gold/60">
                <input
                  autoFocus
                  type={current.type === "password" && !showPw ? "password" : current.type === "email" ? "email" : "text"}
                  value={value}
                  onChange={(e) => { setForm({ ...form, [current.key]: e.target.value }); if (error) setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(); } }}
                  placeholder={current.placeholder}
                  className="h-14 min-w-0 flex-1 bg-transparent px-4 text-lg text-white outline-none placeholder:text-white/30"
                />
                {current.type === "password" && (
                  <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"} className="grid h-14 w-14 place-items-center text-white/45 transition hover:text-white">
                    {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                )}
              </div>
              {error && <p className="mt-3 text-sm font-semibold text-mission-red">{error}</p>}
            </div>

            <button
              type="button"
              onClick={next}
              disabled={loading}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mission-gold px-6 py-4 text-base font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : step < STEPS.length - 1 ? <>Next <ArrowRight className="h-5 w-5" /></> : <>Finish &amp; open my store <Check className="h-5 w-5" /></>}
            </button>

            <div className="mt-4">
              {step > 0 && (
                <button type="button" onClick={() => { setError(""); setStep(step - 1); }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/50 transition hover:text-white">
                  <ArrowLeft className="h-4 w-4" /> Go back
                </button>
              )}
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className={`${card} text-center`}>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-mission-green/20 text-mission-green">
              <Check className="h-8 w-8" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-black">You&apos;re all set, {form.name.split(" ")[0] || "friend"}!</h1>
            <p className="mt-2 text-lg leading-7 text-white/65">{form.dealershipName} is ready to go. Tap below and log in with the email and password you just made.</p>
            <a href={`${APP_URL}/login`} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mission-gold px-6 py-4 text-base font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110">
              Open my store <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-white/35">A Commissioned 41 product</p>
      </div>
    </main>
  );
}
