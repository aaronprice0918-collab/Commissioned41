import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service — EILA" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-3xl font-black">Terms of Service</h1>
      <p className="mt-1 text-sm text-fg/70">EILA · a Commissioned 41 LLC product · Effective July 2, 2026</p>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-fg/75">
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">The service</h2>
          <p>
            EILA is an AI assistant for commission, money, and daily execution, built and operated
            by Commissioned 41 LLC (Georgia, USA). It helps you organize your day, track your deals,
            watch your money, pace your goals, and execute daily. It is a coaching and organization
            tool — not an employer system of record or CRM.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">Subscription &amp; billing</h2>
          <p>
            EILA is $19.99/month, billed by Stripe. Cancel anytime from the billing portal; access
            continues through the end of the paid period. No refunds for partial months, but if
            something went wrong, email us — we&apos;ll be fair.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">Your data, your numbers</h2>
          <p>
            You own the data you enter. EILA&apos;s projections, pace math, and coaching are estimates
            built from what you give her — verify important figures (like your actual paycheck)
            against your employer&apos;s official records. EILA is not financial, legal, or tax advice.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">Acceptable use</h2>
          <p>
            One account per person. Don&apos;t attempt to access other users&apos; data, abuse the AI
            endpoints, or use the service to break the law. We may suspend accounts that do.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">Service &amp; liability</h2>
          <p>
            We work hard to keep EILA fast, available, and accurate, but the service is provided
            &quot;as is.&quot; To the fullest extent permitted by law, Commissioned 41 LLC&apos;s
            liability is limited to the amount you paid us in the twelve months before a claim.
            These terms are governed by Georgia law.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 font-semibold text-fg">Changes</h2>
          <p>
            If these terms change materially, we&apos;ll note it in the app. Questions:
            {" "}<a className="underline" href="mailto:support@commissioned41.com">support@commissioned41.com</a>
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm text-fg/70">
        <Link href="/" className="underline">Back to EILA</Link> · <Link href="/privacy" className="underline">Privacy Policy</Link>
      </p>
    </main>
  );
}
