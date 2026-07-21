import Link from "next/link";

// Branded 404 — unknown routes fell through to Next's bare default page
// (found during the July 9 Sky-standard sweep). Token-driven, so it reads
// right on Sky and every dark theme.
export default function NotFound() {
  return (
    <div className="grid min-h-[100dvh] place-items-center px-6 text-center">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.22em] text-mission-gold">Dealer Mission OS</p>
        <h1 className="mt-3 font-display text-3xl font-black text-white">That screen isn&apos;t here.</h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-sm text-white/60">
          The link may be old or mistyped. Everything that matters is on the bridge.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full bg-mission-gold px-6 py-2.5 text-sm font-black uppercase tracking-[0.14em] text-mission-navy"
        >
          Back to Mission Control
        </Link>
      </div>
    </div>
  );
}
