import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Building2, CalendarDays, Gauge, Sparkles, Target, Wallet } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { C41Logo } from "@/components/C41Logo";
import { Section } from "@/components/Section";
import { ProductGateway } from "@/components/ProductGateway";
import { BRAND_ASSETS, PRODUCT_LIST, PRODUCTS, MISSION_STATEMENT } from "@/config/site";

const ASSISTANT_LAYERS = [
  {
    icon: Target,
    label: "Commission",
    body: "Month pace, goals, deal rhythm, and the next best move.",
  },
  {
    icon: CalendarDays,
    label: "Day",
    body: "A practical view of what needs attention before the day gets away.",
  },
  {
    icon: Wallet,
    label: "Money",
    body: "Bills, cash flow, and safe-to-spend clarity before decisions get made.",
  },
];

const COMPANY_STANDARD = [
  {
    icon: Gauge,
    title: "Clarity first",
    body: "The user should always know where they stand, what changed, and what matters next.",
  },
  {
    icon: Sparkles,
    title: "Assistant, not drill sergeant",
    body: "The product should feel prepared, warm, direct, and five steps ahead.",
  },
  {
    icon: Building2,
    title: "One operating standard",
    body: "The same execution language works for one person and for the dealership floor.",
  },
];

export default function Home() {
  return (
    <>
      <section className="relative mx-auto max-w-shell px-5 pb-16 pt-12 text-center sm:px-8 sm:pb-20 sm:pt-20">
        <Reveal>
          <span className="eyebrow justify-center">Commissioned 41</span>
        </Reveal>

        <Reveal delay={80}>
          <C41Logo priority className="mt-3 w-full max-w-[340px] sm:max-w-[420px]" maxTilt={6} />
        </Reveal>

        <Reveal delay={160}>
          <h1 className="mx-auto mt-7 max-w-4xl text-balance text-5xl font-black leading-[1.02] tracking-tight sm:text-7xl">
            Commissioned 41
          </h1>
        </Reveal>

        <Reveal delay={220}>
          <p className="mx-auto mt-5 max-w-3xl text-balance text-2xl font-semibold leading-snug tracking-tight text-white/82 sm:text-3xl">
            The company building EILA for the individual and Dealer Mission OS for the floor.
          </p>
        </Reveal>

        <Reveal delay={300}>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-white/55">
            EILA is the flagship assistant: sales, day-to-day execution, and the money layer in one place.
            Dealer Mission OS carries that same standard into the dealership.
          </p>
        </Reveal>

        <Reveal delay={380}>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <a href={PRODUCTS.lite.href} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              Open EILA <ArrowRight size={16} />
            </a>
            <a href="#products" className="btn btn-ghost">
              See the Systems
            </a>
          </div>
        </Reveal>

        <Reveal delay={460}>
          <div className="mx-auto mt-12 grid max-w-5xl gap-4 lg:grid-cols-[1.14fr_0.86fr]">
            <div className="glass living-border overflow-hidden p-6 text-left sm:p-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <span className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[28%] bg-white shadow-[0_24px_64px_rgba(7,27,57,0.34)]">
                  <Image
                    src={BRAND_ASSETS.eilaIcon}
                    alt="EILA"
                    width={868}
                    height={868}
                    priority
                    unoptimized
                    className="h-full w-full rounded-[28%] object-contain"
                  />
                </span>
                <div>
                  <span className="inline-flex rounded-full border border-mission-green/25 bg-mission-green/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-mission-green">
                    Live Flagship
                  </span>
                  <h2 className="mt-3 text-4xl font-black leading-none tracking-tight text-white sm:text-5xl">
                    EILA
                  </h2>
                  <p className="mt-3 max-w-xl text-base leading-relaxed text-white/60">
                    Your right hand for commission pace, daily priorities, bills, cash flow, and the next move.
                  </p>
                </div>
              </div>

              <div className="mt-7 grid gap-2.5 sm:grid-cols-3">
                {ASSISTANT_LAYERS.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
                    <p className="text-sm font-black tracking-tight text-white">{item.label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/48">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass flex h-full flex-col justify-between gap-7 overflow-hidden p-6 text-left sm:p-8">
              <div className="flex items-center gap-4">
                <span className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl bg-[#eef2f8] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                  <Image
                    src={BRAND_ASSETS.dealerMark}
                    alt="Dealer Mission OS"
                    width={512}
                    height={512}
                    unoptimized
                    className="h-16 w-16 object-contain drop-shadow-[0_10px_18px_rgba(15,23,42,0.22)]"
                  />
                </span>
                <div>
                  <span className="inline-flex rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/45">
                    Coming Next
                  </span>
                  <h3 className="mt-2 text-2xl font-black leading-tight tracking-tight text-white">
                    Dealer Mission OS
                  </h3>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-white/55">
                The dealership operating system for performance, sales activity, finance production, pay plans,
                goals, accountability, and daily execution.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      <Section eyebrow="The Flagship" className="!py-14 sm:!py-20">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <Reveal>
            <div>
              <h2 className="max-w-3xl text-balance text-4xl font-black leading-tight tracking-tight sm:text-5xl">
                EILA runs the individual side. <span className="chrome-text">The work, the day, and the money.</span>
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/55">
                She keeps commission pace, daily priorities, bills, cash flow, and safe-to-spend clarity
                in one calm operating rhythm.
              </p>
              <Link href="/products" className="btn btn-ghost mt-7">
                Product Architecture <ArrowRight size={16} />
              </Link>
            </div>
          </Reveal>

          <div className="grid gap-3">
            {ASSISTANT_LAYERS.map((item, i) => (
              <Reveal key={item.label} delay={i * 80}>
                <div className="glass glass-hover flex gap-4 p-5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-mission-green/10 text-mission-green">
                    <item.icon size={21} />
                  </span>
                  <div>
                    <p className="font-black tracking-tight text-white">{item.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/50">{item.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      <Section id="products" eyebrow="The Products" className="!pt-16">
        <div className="max-w-3xl">
          <Reveal>
            <h2 className="text-balance text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              Two public products. <span className="chrome-text">One Commissioned 41 standard.</span>
            </h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="mt-5 text-lg leading-relaxed text-white/55">
              EILA leads the ecosystem. Dealer Mission OS follows with the same clarity, accountability,
              and execution language for dealership teams.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-2">
          {PRODUCT_LIST.map((p, i) => (
            <Reveal key={p.key} delay={i * 100} className="h-full">
              <ProductGateway product={p} />
            </Reveal>
          ))}
        </div>
      </Section>

      <Section eyebrow="The Standard">
        <Reveal>
          <h2 className="max-w-3xl text-balance text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            Built for people who refuse to drift.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {COMPANY_STANDARD.map((p, i) => (
            <Reveal key={p.title} delay={i * 80}>
              <div className="glass glass-hover h-full p-6">
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-mission-green/10 text-mission-green">
                  <p.icon size={20} />
                </div>
                <h3 className="text-lg font-black tracking-tight text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="!pt-0">
        <Reveal>
          <div className="glass living-border relative overflow-hidden px-6 py-14 text-center sm:px-14 sm:py-20">
            <div aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-mission-green/65 to-transparent" />
            <span className="eyebrow justify-center">Start Here</span>
            <h2 className="mx-auto mt-5 max-w-2xl text-balance text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              Know the mission. <span className="chrome-text">Then move with purpose.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-white/55">
              {MISSION_STATEMENT}
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <a href={PRODUCTS.lite.href} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                Open EILA <ArrowRight size={16} />
              </a>
              <Link href="/contact" className="btn btn-ghost">
                Contact Commissioned 41
              </Link>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
