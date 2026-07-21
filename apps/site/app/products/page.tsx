import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Building2, Check, Clock3, Sparkles, Target, Wallet } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { Section } from "@/components/Section";
import { BRAND_ASSETS, PRODUCTS, PRODUCT_LIST, type Product } from "@/config/site";

export const metadata: Metadata = {
  title: "Products",
  description:
    "EILA is the flagship AI assistant from Commissioned 41 — live today for individual commission professionals. Dealer Mission OS is the dealership operating system coming next.",
};

const FLOW = [
  {
    icon: Target,
    title: "Start with the person",
    body: "EILA helps one commission professional see the month, the day, the money, and the next move.",
  },
  {
    icon: Wallet,
    title: "Protect the money",
    body: "EILA keeps bills, cash flow, and safe-to-spend clarity close to the daily plan.",
  },
  {
    icon: Building2,
    title: "Then run the floor",
    body: "Dealer Mission OS brings the same execution standard to the whole dealership team.",
  },
];

export default function ProductsPage() {
  const flagship = PRODUCTS.lite;
  const upcoming = PRODUCT_LIST.filter((p) => p.key !== "lite");

  return (
    <>
      <section className="mx-auto max-w-shell px-5 pb-14 pt-16 sm:px-8 sm:pb-20 sm:pt-24">
        <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <Reveal>
              <span className="eyebrow mb-5">The Products</span>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="max-w-3xl text-balance text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl">
                EILA leads the ecosystem. <span className="chrome-text">The rest follows.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-white/58">
                Commissioned 41 is building one connected family of operating systems. The first live product is EILA:
                a clean, daily AI assistant for commission professionals who want clarity, pace, money awareness, and the next move.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href={flagship.href} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  Open EILA <ArrowRight size={16} />
                </a>
                <Link href="/contact" className="btn btn-ghost">
                  Talk to us
                </Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={140}>
            <div className="relative overflow-hidden rounded-[28px] border border-mission-green/22 bg-[#ffffff] p-6 shadow-[0_34px_110px_-42px_rgba(19,154,245,0.42)] sm:p-8">
              <div aria-hidden className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-mission-gold/14 blur-3xl" />
              <div aria-hidden className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-mission-gold/55 to-transparent" />
              <div className="relative flex flex-col gap-8 sm:flex-row sm:items-center">
                <Image
                  src={BRAND_ASSETS.eilaIcon}
                  alt="EILA"
                  width={868}
                  height={868}
                  priority
                  unoptimized
                  className="h-32 w-32 shrink-0 rounded-[24%] object-contain shadow-[0_24px_62px_rgba(7,27,57,0.40)] sm:h-40 sm:w-40"
                />
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-mission-green/25 bg-mission-green/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-mission-green">
                    <Sparkles size={13} /> Live Today
                  </div>
                  <h2 className="mt-4 text-5xl font-black tracking-tight text-white sm:text-6xl">EILA</h2>
                  <p className="mt-3 max-w-md text-lg leading-relaxed text-white/55">
                    Your AI assistant for commission, money, and daily execution.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <Section className="!py-8 sm:!py-12">
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Reveal>
            <ProductCard product={flagship} featured />
          </Reveal>
          {upcoming.map((product, i) => (
            <Reveal key={product.key} delay={(i + 1) * 90}>
              <ProductCard product={product} />
            </Reveal>
          ))}
        </div>
      </Section>

      <Section eyebrow="The Flow" className="!pt-10">
        <Reveal>
          <h2 className="max-w-3xl text-balance text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            One standard, two products, one assistant layer.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {FLOW.map((item, i) => (
            <Reveal key={item.title} delay={i * 80}>
              <div className="glass glass-hover h-full p-6">
                <span className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-mission-green/12 text-mission-green">
                  <item.icon size={21} />
                </span>
                <h3 className="text-xl font-black tracking-tight text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/55">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="!pt-0">
        <Reveal>
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] px-6 py-12 text-center shadow-[0_30px_90px_-48px_rgba(96,150,255,0.75)] backdrop-blur-xl sm:px-14 sm:py-16">
            <div aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-mission-green/65 to-transparent" />
            <h2 className="mx-auto max-w-2xl text-balance text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              Start with EILA. <span className="steel-text">Build from there.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/55">
              If you&apos;re evaluating the Commissioned 41 ecosystem, EILA is the cleanest place to feel the standard:
              clear numbers, direct coaching, personal money awareness, and one next move.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={flagship.href} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
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

function ProductCard({ product, featured = false }: { product: Product; featured?: boolean }) {
  const comingSoon = product.status === "comingSoon";
  const content = (
    <article className={`glass living-border relative overflow-hidden p-6 sm:p-7 ${featured ? "bg-[#f5f9ff] ring-1 ring-mission-green/25" : ""}`}>
      <div aria-hidden className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-mission-green/10 blur-3xl" />
      <div className="relative flex items-start justify-between gap-5">
        <div className="flex items-center gap-4">
          {product.key === "lite" ? (
            <Image
              src={BRAND_ASSETS.eilaIcon}
              alt=""
              width={868}
              height={868}
              unoptimized
              className={`${featured ? "h-16 w-16" : "h-14 w-14"} shrink-0 rounded-[23%] object-contain shadow-[0_14px_34px_rgba(7,27,57,0.42)]`}
            />
          ) : (
            <Image
              src={BRAND_ASSETS.dealerMark}
              alt=""
              width={128}
              height={128}
              unoptimized
              className={`${featured ? "h-16 w-16" : "h-14 w-14"} shrink-0 object-contain drop-shadow-[0_14px_28px_rgba(15,23,42,0.28)]`}
            />
          )}
          {/* min-w-0 lets long product names wrap cleanly inside the card. */}
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.17em] ${
              comingSoon
                ? "border-white/12 bg-white/[0.04] text-white/52"
                : "border-mission-green/25 bg-mission-green/12 text-mission-gold"
            }`}>
              {comingSoon ? <Clock3 size={12} /> : <Sparkles size={12} />}
              {comingSoon ? "Coming Soon" : "Live Today"}
            </span>
            <h3 className={`${featured ? "mt-3 text-4xl sm:text-5xl" : "mt-3 text-2xl sm:text-3xl"} font-black leading-[1.04] tracking-tight text-white`}>
              {product.name}
            </h3>
          </div>
        </div>
      </div>

      <p className={`${featured ? "mt-6 text-lg" : "mt-5 text-base"} relative font-semibold leading-relaxed text-white/82`}>
        {product.subtitle}
      </p>
      <p className={`${featured ? "mt-3 text-sm" : "mt-3 text-sm"} relative leading-relaxed text-white/55`}>
        {product.description}
      </p>

      <div className="relative mt-5 grid gap-2.5">
        {product.capabilities.slice(0, featured ? 4 : 3).map((item) => (
          <div key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-white/62">
            <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-mission-green/15 text-mission-green">
              <Check size={10} strokeWidth={3} />
            </span>
            {item}
          </div>
        ))}
      </div>

      {comingSoon ? (
        <Link href="/contact" className="btn btn-ghost mt-7 w-full">
          Get Notified <ArrowRight size={16} />
        </Link>
      ) : (
        <a href={product.href} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-7 w-full">
          {product.cta} <ArrowRight size={16} />
        </a>
      )}
    </article>
  );

  return content;
}
