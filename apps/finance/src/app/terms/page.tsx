import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · MissionOS Finance",
  description: "Terms for using MissionOS Finance.",
};

const UPDATED = "July 1, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
      <div className="glass p-8 sm:p-10">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Commissioned 41 LLC · MissionOS Finance
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">Last updated {UPDATED}</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-[var(--text-dim)]">
          <Section title="The service">
            MissionOS Finance is a personal financial management application operated by Commissioned 41 LLC. It
            lets its user connect their own financial accounts and view their cash flow, spending, and goals.
          </Section>
          <Section title="Your account and connections">
            You are responsible for maintaining the security of your login and for the accounts you choose to
            connect. You represent that any accounts you connect are your own or that you are authorized to connect
            them.
          </Section>
          <Section title="Acceptable use">
            Use the app for its intended personal financial management purpose. Do not attempt to disrupt, reverse
            engineer, or gain unauthorized access to the service or its data.
          </Section>
          <Section title="Financial disclaimer">
            MissionOS Finance provides information and insights to help you understand your own finances. It is not
            financial, investment, tax, or legal advice. You are responsible for your own financial decisions.
          </Section>
          <Section title="Data">
            Your data is handled as described in our{" "}
            <a href="/privacy" className="text-[var(--accent-soft)] underline underline-offset-2 hover:text-[var(--accent)]">
              Privacy Policy
            </a>
            .
          </Section>
          <Section title="Provided “as is”">
            The service is provided on an “as is” and “as available” basis, without warranties of any kind, to the
            extent permitted by law.
          </Section>
          <Section title="Contact">
            Questions? Email{" "}
            <a href="mailto:aaronpricemeta@gmail.com" className="text-[var(--accent-soft)] underline underline-offset-2 hover:text-[var(--accent)]">
              aaronpricemeta@gmail.com
            </a>
            .
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
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
