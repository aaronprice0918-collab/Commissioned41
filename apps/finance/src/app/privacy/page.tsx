import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · MissionOS Finance",
  description: "How MissionOS Finance handles your financial data.",
};

const UPDATED = "July 1, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
      <div className="glass p-8 sm:p-10">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Commissioned 41 LLC · MissionOS Finance
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">Last updated {UPDATED}</p>

        <div className="prose-invert mt-8 space-y-6 text-[15px] leading-relaxed text-[var(--text)]">
          <Section title="Who we are">
            MissionOS Finance is a personal financial management application operated by Commissioned 41 LLC.
            It gives its user a live view of their own accounts, cash flow, bills, spending, and financial goals.
          </Section>

          <Section title="What data we access">
            With your explicit consent, MissionOS Finance connects to your financial institutions through{" "}
            <A href="https://plaid.com">Plaid</A>. Through Plaid we access:
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--text-dim)]">
              <li>Account information (names, types, masked account numbers)</li>
              <li>Account balances</li>
              <li>Transaction history and details</li>
            </ul>
            We request only the data needed to power your dashboard and financial insights.
          </Section>

          <Section title="How we use your data">
            Your financial data is used for one purpose: to display your own dashboard and generate personal
            financial insights inside the app (safe-to-spend, forecasts, spending analysis, and goal tracking).
            We do not use your data for advertising, and we do not build profiles for anyone other than you.
          </Section>

          <Section title="We never sell or share your data">
            We do not sell, rent, or share your financial data with any third party. Your data is used solely to
            operate the app for you. The only third parties involved are the infrastructure providers that make the
            app run (see below), each acting only to provide their service.
          </Section>

          <Section title="How we protect your data">
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--text-dim)]">
              <li>Bank access tokens are encrypted at rest using AES-256-GCM encryption.</li>
              <li>Data is stored in a managed PostgreSQL database (Neon), encrypted at rest.</li>
              <li>All traffic is served over HTTPS/TLS, with strict security headers (CSP, HSTS).</li>
              <li>The application is protected behind authentication; access is limited to the account owner.</li>
            </ul>
          </Section>

          <Section title="Service providers">
            We rely on a small set of providers to operate the app: <b>Plaid</b> (secure bank connectivity),{" "}
            <b>Neon</b> (database hosting), <b>Vercel</b> (application hosting), and <b>Anthropic</b> (the AI
            assistant that answers your questions about your finances). Each processes data only to provide its
            service and under its own security and privacy commitments.
          </Section>

          <Section title="Plaid">
            When you connect an account, Plaid collects and processes your information under its own privacy policy.
            You can review how Plaid handles your data, and manage your connections, at{" "}
            <A href="https://plaid.com/legal/#end-user-privacy-policy">plaid.com/legal</A> and{" "}
            <A href="https://my.plaid.com">my.plaid.com</A>.
          </Section>

          <Section title="Data retention and your control">
            You control your data. You can disconnect an institution or request deletion of your data at any time,
            and it will be removed from our systems. We retain data only for as long as needed to operate the app
            for you.
          </Section>

          <Section title="Contact">
            Questions about this policy or your data? Email{" "}
            <A href="mailto:aaronpricemeta@gmail.com">aaronpricemeta@gmail.com</A>.
          </Section>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
      <div className="mt-1.5 text-[var(--text-dim)]">{children}</div>
    </section>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-[var(--accent-soft)] underline underline-offset-2 hover:text-[var(--accent)]">
      {children}
    </a>
  );
}
