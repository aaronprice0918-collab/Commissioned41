import { Reveal } from "@/components/Reveal";

// Shared shell width + vertical rhythm for content sections.
export function Section({
  id,
  eyebrow,
  className = "",
  children,
}: {
  id?: string;
  eyebrow?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`mx-auto max-w-shell px-5 py-20 sm:px-8 sm:py-28 ${className}`}>
      {eyebrow && (
        <Reveal>
          <span className="eyebrow mb-7">{eyebrow}</span>
        </Reveal>
      )}
      {children}
    </section>
  );
}

// The header block for an inner page (Mission / Products / About / Contact).
export function PageHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: React.ReactNode;
  intro?: string;
}) {
  return (
    <header className="mx-auto max-w-shell px-5 pb-4 pt-16 sm:px-8 sm:pt-24">
      <Reveal>
        <span className="eyebrow mb-5">{eyebrow}</span>
      </Reveal>
      <Reveal delay={80}>
        <h1 className="max-w-4xl text-balance text-5xl font-black leading-[1.05] tracking-tight sm:text-6xl">
          {title}
        </h1>
      </Reveal>
      {intro && (
        <Reveal delay={160}>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-white/55">{intro}</p>
        </Reveal>
      )}
    </header>
  );
}
