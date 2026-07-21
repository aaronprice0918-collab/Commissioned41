import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass, Target, Gauge, Layers, ListChecks, TrendingUp } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { Section, PageHeader } from "@/components/Section";
import { MISSION_STATEMENT } from "@/config/site";

export const metadata: Metadata = {
  title: "Mission",
  description: MISSION_STATEMENT,
};

const PILLARS = [
  {
    icon: ListChecks,
    title: "Take control",
    body: "Own the mission in front of you with intention. Decide what matters, then build around it.",
  },
  {
    icon: Compass,
    title: "Organize what matters",
    body: "Pull the scattered pieces — money, activity, goals, people — into one place you can actually see.",
  },
  {
    icon: Target,
    title: "Execute with purpose",
    body: "Turn intention into a daily next move. Systems beat motivation, every single day.",
  },
  {
    icon: TrendingUp,
    title: "Build for growth",
    body: "Create systems that compound — freedom, clarity, and measurable growth that lasts.",
  },
];

const BELIEFS = [
  ["Drift is the default.", "Without a system, good intentions quietly decay into busy-but-not-better. We build the system."],
  ["Clarity beats hustle.", "You don't need more noise. You need to see the truth of your numbers and your next move."],
  ["Measurement creates honesty.", "What gets tracked gets faced. Real progress requires real numbers — no vanity, no hiding."],
  ["Freedom is the point.", "Discipline and structure aren't the goal. They're how you buy back time, margin, and options."],
];

export default function MissionPage() {
  return (
    <>
      <PageHeader
        eyebrow="The Mission"
        title={
          <>
            We exist so you can{" "}
            <span className="chrome-text">execute the mission in front of you.</span>
          </>
        }
      />

      {/* Mission statement, full weight */}
      <Section className="!pt-10">
        <Reveal>
          <div className="glass living-border relative overflow-hidden p-8 sm:p-12">
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-0 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-mission-green/60 to-transparent"
            />
            <p className="text-balance text-2xl font-semibold leading-snug tracking-tight text-white/90 sm:text-3xl">
              {MISSION_STATEMENT}
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 70}>
              <div className="glass glass-hover h-full p-6">
                <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-mission-green/10 text-mission-green">
                  <p.icon size={20} />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* What we believe */}
      <Section eyebrow="What We Believe">
        <Reveal>
          <h2 className="max-w-3xl text-balance text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            A few convictions that <span className="steel-text">shape every system we build.</span>
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {BELIEFS.map(([t, b], i) => (
            <Reveal key={t} delay={(i % 2) * 70}>
              <div className="glass glass-hover flex h-full gap-4 p-6">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mission-green/10 text-mission-green">
                  <Gauge size={18} />
                </span>
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-white">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">{b}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <Section className="!pt-0">
        <Reveal>
          <div className="glass living-border flex flex-col items-center gap-6 px-6 py-12 text-center sm:px-14 sm:py-16">
            <Layers className="text-mission-green" size={28} />
            <h2 className="max-w-2xl text-balance text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              The mission is the same. The systems are how you run it.
            </h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
              <Link href="/products" className="btn btn-primary">
                See the Products <ArrowRight size={16} />
              </Link>
              <Link href="/about" className="btn btn-ghost">
                About the Company
              </Link>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
