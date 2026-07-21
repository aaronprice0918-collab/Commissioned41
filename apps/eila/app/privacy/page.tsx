import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy — EILA" };

// Plain-English privacy policy for a paid consumer product. Honest about
// exactly what we hold and where it lives; no boilerplate we can't back up.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-3xl font-black">Privacy Policy</h1>
      <p className="mt-1 text-sm text-fg/70">EILA · a Commissioned 41 LLC product · Effective July 6, 2026</p>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-fg/75">
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">What we collect</h2>
          <p>
            Your account email and password (handled by Supabase; we never see your password). The
            performance data you enter — your goals, pay plan, deals, opportunities, day items, and reminders.
            Deals you log can include your customers&apos; details (a name, phone number, or deal
            figures) — treat that data per your employer&apos;s rules; it stays in your account like
            everything else. If you upload or photograph a document (a pay plan, a deal recap, a
            customer ID), we read it once to fill in the fields and do not store the image — only
            the fields you save. Payment details go directly to Stripe; we never see or store your card.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">How we use it</h2>
          <p>
            To run the product: compute your pace, paycheck projection, and daily mission, and to let
            EILA coach you. Conversations with EILA and your data snapshot are processed by Anthropic
            (our AI provider) to generate her responses. EILA also keeps short coaching notes from your
            conversations so she remembers what matters to you — those stay in your account.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">What we never do</h2>
          <p>
            We do not sell your data. We do not share it with advertisers. We do not use your data to
            market to anyone. Lessons EILA learns for her shared coaching playbook are stripped of
            names, employers, and personal details before they ever leave your account.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">Where it lives &amp; how it&apos;s protected</h2>
          <p>
            Your data is stored with Supabase (encrypted at rest) with row-level security — your
            rows are readable and writable by your account only (we verify this with live tests).
            The app is hosted on Vercel; documents and conversations are processed by Anthropic;
            payments by Stripe. Everything moves over HTTPS. Optional Face ID lock is available in
            Settings.
          </p>
          <p className="mt-2">
            Deal files you sort with Scan and Sort are held in private, encrypted storage accessible
            only to your account for <strong>90 days</strong>, then automatically deleted. Download
            your copy if you want to keep it longer.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">Deleting your data</h2>
          <p>
            You can reset all app data from Settings at any time. To delete your account and
            everything tied to it, email us and we&apos;ll complete it within 30 days.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">Contact</h2>
          <p>
            Commissioned 41 LLC · <a className="underline" href="mailto:support@commissioned41.com">support@commissioned41.com</a>
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm text-fg/70">
        <Link href="/" className="underline">Back to EILA</Link> · <Link href="/terms" className="underline">Terms of Service</Link>
      </p>
    </main>
  );
}
