import type { Metadata } from "next";
import Image from "next/image";
import {
  Activity, BadgeCheck, BadgeDollarSign, Bot, Calculator, Car, Check,
  ShieldCheck, Smartphone, Trophy,
} from "lucide-react";
import { WaitlistForm } from "@/components/WaitlistForm";
import { LandingMobileMenu } from "@/components/LandingMobileMenu";
import { MissionMark, MissionWordmark } from "@/components/BrandMarks";

export const metadata: Metadata = {
  title: "Dealer Mission OS — The Dealership Operating System",
  description:
    "Dealer Mission OS is the operating system that runs the dealership — it tells your store what to do next on every lead and every deal. The floor, desking, F&I, live leaderboards, and an AI sales manager (EILA) that coaches every rep. Built by a 20-year finance veteran. Numbers your whole store can trust.",
  openGraph: {
    type: "website",
    url: "https://commissioned41.com",
    siteName: "Commissioned 41",
    title: "Commissioned 41 — Know Your Mission. Execute With Purpose.",
    description: "The company behind Dealer Mission OS — the dealership operating system.",
    images: [{ url: "/og-c41.png", width: 1200, height: 630, alt: "Commissioned 41" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Commissioned 41 — Know Your Mission. Execute With Purpose.",
    description: "The company behind Dealer Mission OS — the dealership operating system.",
    images: ["/og-c41.png"],
  },
};

const APP_URL = "https://missionos.commissioned41.com";

const FEATURES = [
  { icon: Bot, title: "EILA tells you what's next", line: "Your AI sales manager reads the floor and hands every rep the next best move — who to work, what to say, which deal to save." },
  { icon: Trophy, title: "The morning brief", line: "Walk in and the store tells you yesterday's units, gross, and reserve, who almost bought, and who needs coaching. No reports to run." },
  { icon: Car, title: "The whole floor, live", line: "Every up from arrival to delivery — mark-on-arrival, one-tap follow-up, and no lost lead without a manager TO." },
  { icon: Calculator, title: "Desking & deals", line: "Structured deal entry, trade equity, and money that's right on every screen." },
  { icon: BadgeDollarSign, title: "F&I & the menu", line: "Products, PVR, PPU, and holdback tracked deal-by-deal so nothing's left on the table." },
];

const WHY = [
  { icon: ShieldCheck, title: "Numbers you can trust", line: "Gross, PVR, and commission math are right on every screen — one source of truth, no arguments." },
  { icon: Activity, title: "Live, in real time", line: "The board updates as deals move. No stale spreadsheets, no end-of-day surprises." },
  { icon: Smartphone, title: "Built for the floor", line: "Mobile-first and fast — designed to be used one-handed on a phone, where deals happen." },
  { icon: BadgeCheck, title: "Built by an insider", line: "Designed by a finance director with 20 years in the business — not a software company guessing." },
];

const TIERS = [
  {
    name: "Single Store",
    tag: "Live now",
    blurb: "Run one rooftop on Dealer Mission OS.",
    features: ["The whole floor, desking & F&I", "Live leaderboards & accurate comp", "EILA — AI sales manager", "Mobile-first for the whole floor"],
    cta: "Get a demo",
    featured: true,
  },
  {
    name: "Dealer Group",
    tag: "Coming soon",
    blurb: "Standardize across every store.",
    features: ["Everything in Single Store", "Multi-store visibility", "Group-level reporting", "Priority onboarding & support"],
    cta: "Get a demo",
    featured: false,
  },
  {
    name: "Enterprise",
    tag: "Custom",
    blurb: "For large groups and OEMs.",
    features: ["Everything in Dealer Group", "Custom integrations", "Dedicated success manager", "Tailored rollout"],
    cta: "Talk to us",
    featured: false,
  },
];

export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-[#070b16] text-white">
      <style>{`html{scroll-behavior:smooth}`}</style>

      {/* sticky nav */}
      <header className="sticky top-0 z-50 border-b border-white/8 bg-[#070b16]/80 backdrop-blur-xl">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-3.5">
          <span className="flex shrink-0 items-center gap-2">
            <MissionMark className="h-7 w-7 sm:h-8 sm:w-8" priority />
            <MissionWordmark className="text-lg tracking-[0.06em] sm:text-xl" />
          </span>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-white/65 md:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#why" className="transition hover:text-white">Why Dealer Mission OS</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <a href="#about" className="transition hover:text-white">About</a>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <a href={`${APP_URL}/login`} className="rounded-full border border-white/15 px-3.5 py-1.5 text-sm font-bold text-white/85 transition hover:border-mission-gold/60 hover:text-white sm:px-4 sm:py-2">Sign In</a>
            <a href="#join" className="hidden rounded-full bg-mission-gold px-4 py-2 text-sm font-black uppercase tracking-[0.1em] text-mission-navy transition hover:brightness-110 md:inline-block">Get a Demo</a>
            <LandingMobileMenu />
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: "radial-gradient(900px 480px at 50% -10%, rgba(96,150,255,0.16), transparent 70%)" }} />
        <div className="relative mx-auto max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-24">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-mission-gold/85">
            A Dealer Operating System — not a CRM
          </div>
          <h1 className="font-display text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            Know the Lead.
            <br />
            <span className="bg-gradient-to-r from-[#dbe9ff] via-mission-green to-mission-gold bg-clip-text text-transparent">Execute the Mission.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/70">
            A CRM tells you <span className="text-white/90">where</span> your customer is. Dealer Mission OS tells your store <span className="text-white">what to do next</span> — the next move on every lead, every deal, every morning. One platform, one AI brain, built by someone who&apos;s lived the business.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#join" className="inline-flex items-center justify-center rounded-full bg-mission-gold px-7 py-3.5 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-[0_14px_40px_rgba(96,150,255,0.28)] transition hover:brightness-110">Get a Demo</a>
            <a href={APP_URL} className="inline-flex items-center justify-center rounded-full border border-white/15 px-7 py-3.5 text-sm font-bold text-white/85 transition hover:border-white/35">Launch Dealer Mission OS</a>
          </div>
          <div className="mt-6 text-sm font-semibold text-mission-gold/80">Live and running a real dealership today.</div>
        </div>
      </section>

      {/* features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-16">
        <div className="mb-8 text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-mission-gold/80">Features</div>
          <h2 className="mt-2 font-display text-3xl font-black tracking-tight sm:text-4xl">Run the whole floor on one system.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/60">From the first up to the funded deal — every part of the store, connected and accurate.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, line }) => (
            <div key={title} className="rounded-[16px] border border-white/10 bg-white/[0.03] p-5 transition hover:border-mission-gold/35 hover:bg-white/[0.05]">
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-mission-gold/12 text-mission-gold"><Icon className="h-5 w-5" /></span>
              <div className="font-display text-lg font-black">{title}</div>
              <div className="mt-1 text-sm leading-6 text-white/58">{line}</div>
            </div>
          ))}
          <div className="flex flex-col justify-center rounded-[16px] border border-mission-gold/25 bg-mission-gold/[0.06] p-5">
            <div className="font-display text-lg font-black text-white">Want it in your store?</div>
            <p className="mt-1 text-sm leading-6 text-white/65">See Dealer Mission OS live and get a walkthrough for your floor.</p>
            <a href="#join" className="mt-3 inline-flex w-fit items-center rounded-full bg-mission-gold px-5 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-mission-navy transition hover:brightness-110">Get a demo</a>
          </div>
        </div>
      </section>

      {/* why */}
      <section id="why" className="scroll-mt-24 border-y border-white/8 bg-white/[0.015] py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-8 text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-mission-gold/80">Why Dealer Mission OS</div>
            <h2 className="mt-2 font-display text-3xl font-black tracking-tight sm:text-4xl">Trust the numbers. Win the floor.</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WHY.map(({ icon: Icon, title, line }) => (
              <div key={title} className="rounded-[16px] border border-white/10 bg-[#0c0d11] p-5">
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-mission-gold/12 text-mission-gold"><Icon className="h-5 w-5" /></span>
                <div className="font-display text-base font-black">{title}</div>
                <div className="mt-1 text-sm leading-6 text-white/58">{line}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-16">
        <div className="mb-9 text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-mission-gold/80">Pricing</div>
          <h2 className="mt-2 font-display text-3xl font-black tracking-tight sm:text-4xl">Pricing built for your store.</h2>
          <p className="mt-2 text-white/55">Book a demo and we&apos;ll tailor it to your rooftop. Launch pricing announced soon.</p>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.name} className={`flex flex-col rounded-[20px] border p-6 ${t.featured ? "border-mission-gold/40 bg-mission-gold/[0.06] shadow-[0_18px_50px_rgba(96,150,255,0.12)]" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex items-center justify-between">
                <div className="font-display text-xl font-black">{t.name}</div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${t.featured ? "bg-mission-gold text-mission-navy" : "border border-white/15 text-white/55"}`}>{t.tag}</span>
              </div>
              <p className="mt-1.5 text-sm text-white/60">{t.blurb}</p>
              <ul className="mt-4 flex-1 space-y-2.5">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm leading-5 text-white/78">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-mission-gold" /> {f}
                  </li>
                ))}
              </ul>
              <a href="#join" className={`mt-6 inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.1em] transition ${t.featured ? "bg-mission-gold text-mission-navy hover:brightness-110" : "border border-white/15 text-white/85 hover:border-mission-gold/55"}`}>{t.cta}</a>
            </div>
          ))}
        </div>
      </section>

      {/* about / story */}
      <section id="about" className="scroll-mt-24 border-t border-white/8 py-16">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-mission-gold/80">The story</div>
          <h2 className="mt-2 font-display text-3xl font-black tracking-tight sm:text-4xl">Built by someone who&apos;s lived it.</h2>
          <div className="mt-5 space-y-5 text-lg leading-8 text-white/75">
            <p>Dealer Mission OS was built by a finance director who has spent two decades in the car business — living it, breathing it, knowing it inside and out. Not a software company guessing at the floor, but someone who&apos;s actually run it.</p>
            <p>It was born from a simple frustration: the numbers a store runs on are scattered, late, and rarely agree. So he built one system where the math is right, the board is live, and every rep gets real coaching in the moment — the way it should have been all along.</p>
            <p className="font-bold text-white">At Commissioned 41, we build tools that earn their place on your floor. Dealer Mission OS is the first.</p>
          </div>
        </div>
      </section>

      {/* join / demo */}
      <section id="join" className="scroll-mt-24 px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-black leading-tight tracking-tight sm:text-4xl">Bring Dealer Mission OS to your store.</h2>
          <p className="mx-auto mt-3 max-w-lg text-lg text-white/65">Drop your email and we&apos;ll set up a walkthrough for your floor.</p>
          <div className="mt-8"><WaitlistForm source="dealership" /></div>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-white/8 bg-black">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-12 text-center">
          <Image src="/brand/c41-logo-transparent.png" alt="Commissioned 41" width={1007} height={755} className="h-28 w-auto select-none drop-shadow-[0_18px_50px_rgba(0,0,0,0.55)]" priority={false} />
          <div className="text-xs text-white/40">A Commissioned 41 product · © 2026 Commissioned 41. All rights reserved.</div>
          <div className="flex gap-5 text-xs font-semibold text-white/45">
            <a href="/terms" className="transition hover:text-white">Terms of Service</a>
            <a href="/privacy" className="transition hover:text-white">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
