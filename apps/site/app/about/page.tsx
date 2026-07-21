import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Building2 } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { Section, PageHeader } from "@/components/Section";
import { BRAND_ASSETS, PRODUCTS } from "@/config/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Commissioned 41 is the parent company behind EILA and Dealer Mission OS — operating systems for people and businesses who refuse to drift.",
};

const HIERARCHY = [
  {
    name: "Commissioned 41",
    role: "Parent company & brand",
    body: "The home base. The mission, the standard, and the team behind every system we ship.",
    tone: "chrome-text",
    mark: "company",
  },
  {
    name: "EILA",
    role: "Product · commission, money, and daily execution",
    body: PRODUCTS.lite.subtitle,
    tone: "steel-text",
    mark: "eila",
  },
  {
    name: "Dealer Mission OS",
    role: "Product · dealership operations",
    body: PRODUCTS.dealer.subtitle,
    tone: "steel-text",
    mark: "dealer",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="About"
        title={
          <>
            One company. <span className="chrome-text">One ecosystem.</span>
          </>
        }
        intro="Commissioned 41 is the parent company behind EILA and Dealer Mission OS. Everything we build serves a single idea: people and businesses execute better when they can see the mission clearly and run it with a system."
      />

      {/* Brand hierarchy */}
      <Section eyebrow="Brand Hierarchy" className="!pt-12">
        <Reveal>
          <h2 className="max-w-3xl text-balance text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            How it all fits together.
          </h2>
        </Reveal>

        <div className="mt-12 space-y-4">
          {HIERARCHY.map((h, i) => (
            <Reveal key={h.name} delay={i * 80}>
              <div className="glass glass-hover flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-7">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mission-green/10 text-mission-green">
                  {h.mark === "eila" ? (
                    <Image src={BRAND_ASSETS.eilaIcon} alt="" width={868} height={868} unoptimized className="h-9 w-9 rounded-xl object-contain" />
                  ) : h.mark === "dealer" ? (
                    <Image src={BRAND_ASSETS.dealerMark} alt="" width={40} height={40} unoptimized className="h-10 w-10 object-contain" />
                  ) : (
                    <Building2 size={22} />
                  )}
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className={`text-xl font-black tracking-tight ${h.tone}`}>{h.name}</h3>
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
                      {h.role}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/55">{h.body}</p>
                </div>
                {i > 0 && (
                  <span className="hidden text-xs font-semibold uppercase tracking-wider text-white/60 sm:block">
                    Under Commissioned 41
                  </span>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Founder / origin */}
      <Section eyebrow="The Origin">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <Reveal>
            <div className="relative mx-auto h-56 w-56 sm:h-64 sm:w-64">
              <Image
                src={BRAND_ASSETS.eilaIcon}
                alt="EILA"
                width={868}
                height={868}
                unoptimized
                className="h-full w-full rounded-[23%] object-contain drop-shadow-[0_30px_90px_rgba(7,27,57,0.42)]"
              />
            </div>
          </Reveal>
          <div>
            <Reveal>
              <h2 className="text-balance text-4xl font-black leading-tight tracking-tight sm:text-5xl">
                At <span className="steel-text">41</span>, the drifting stopped.
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <div className="mt-6 space-y-4 text-lg leading-relaxed text-white/55">
                <p>
                  Commissioned 41 was born from a simple, hard realization: nothing important gets
                  built on autopilot. The future has to be chosen — and then executed on, every day.
                </p>
                <p>
                  That conviction became a company. First EILA, a personal command center for sales, life, and money,
                  then Dealer Mission OS for the dealership floor — both built on the same belief
                  that clarity and accountability change outcomes.
                </p>
                <p className="text-white">
                  This is for everyone — and every team — that refuses to drift.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <Section className="!pt-0">
        <Reveal>
          <div className="glass living-border flex flex-col items-center gap-6 px-6 py-12 text-center sm:px-14 sm:py-16">
            <h2 className="max-w-2xl text-balance text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              Build something that doesn&apos;t drift.
            </h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
              <Link href="/products" className="btn btn-primary">
                Explore the Products <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className="btn btn-ghost">
                Get in Touch
              </Link>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
