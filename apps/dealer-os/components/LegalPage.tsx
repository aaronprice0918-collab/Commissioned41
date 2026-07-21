import Image from "next/image";

export function LegalH2({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-4 font-display text-lg font-black text-white">{children}</h2>;
}

export function LegalP({ children }: { children: React.ReactNode }) {
  return <p className="leading-7 text-white/72">{children}</p>;
}

export function LegalLI({ children }: { children: React.ReactNode }) {
  return <li className="leading-7 text-white/72">{children}</li>;
}

// Shared public, shell-free layout for the legal pages (Terms, Privacy).
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#08090c] text-white">
      <header className="border-b border-white/8">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <a href="/welcome" aria-label="Commissioned 41 home">
            <Image src="/brand/mission-logo.png" alt="Dealer Mission OS" width={130} height={30} className="h-7 w-auto" />
          </a>
          <a href="/welcome" className="text-sm font-semibold text-white/60 transition hover:text-white">Back to site</a>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-3xl font-black text-white sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-white/45">Last updated: {updated}</p>
        {intro && <p className="mt-6 leading-7 text-white/72">{intro}</p>}
        <div className="mt-4 space-y-3.5">{children}</div>
      </article>

      <footer className="border-t border-white/8">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 px-6 py-8 text-center text-xs text-white/40 sm:flex-row sm:justify-between">
          <span>© 2026 Commissioned 41, LLC</span>
          <span className="flex gap-4">
            <a href="/terms" className="transition hover:text-white">Terms</a>
            <a href="/privacy" className="transition hover:text-white">Privacy</a>
            <a href="/welcome" className="transition hover:text-white">Home</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
