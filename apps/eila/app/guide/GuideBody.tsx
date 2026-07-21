"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { MissionMark } from "@/components/Brand";

const TEAM_LINK = "https://lite.commissioned41.com/team/kennesaw-mazda";

const PROMPTS = [
  "Sort this out with me.",
  "Brief me on today.",
  "Am I going to hit my goal this month?",
  "Plan my day around my appointments.",
  "Show me my deal log for the month.",
  "I don't work Sundays — fix my pace.",
  "Something looks wrong with my numbers.",
];

// The public, no-login, permanent guide — the link Aaron hands his team.
// Lives on the app's own domain so it's not at the mercy of a third-party
// sharing toggle, and shares the app's real classes (.glass/.btn/.field)
// so it looks like EILA, not a one-off flyer.
export function GuideBody() {
  const [platform, setPlatform] = useState<"iphone" | "android">("iphone");

  useEffect(() => {
    if (/Android/i.test(navigator.userAgent)) setPlatform("android");
  }, []);

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl px-5 py-10">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-fg/65">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Commissioned 41 · Kennesaw Mazda
      </div>
      <h1 className="font-display mt-3 text-[32px] font-black leading-tight tracking-tight sm:text-4xl">
        Get <span className="text-accent2">EILA</span> on your phone.
      </h1>
      <p className="mt-2 max-w-[52ch] text-[17px] leading-relaxed text-fg/60">
        Your day, your pay, your pace, and your monthly deal log — right on your home screen. Takes about two minutes.
      </p>

      <div className="glass mt-5 border border-accent/30 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-fg/65">Your link</div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <a href={TEAM_LINK} className="break-all text-[15px] font-semibold text-accent2 underline-offset-4 hover:underline">
            lite.commissioned41.com/team/kennesaw-mazda
          </a>
          <CopyButton text={TEAM_LINK} label="Copy link" />
        </div>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-good">
        <Check size={14} /> Free for the whole Kennesaw team — no card, ever.
      </p>

      {/* ---- install ---- */}
      <Section title="1. Put the icon on your home screen" sub="This makes EILA open like any other app — no browser bar, no re-typing the link.">
        <div className="glass grid grid-cols-2 gap-1.5 p-1.5">
          <button onClick={() => setPlatform("iphone")}
            className={`rounded-xl py-3 text-[15px] font-bold transition ${platform === "iphone" ? "bg-accent text-white" : "text-fg/55"}`}>
            iPhone
          </button>
          <button onClick={() => setPlatform("android")}
            className={`rounded-xl py-3 text-[15px] font-bold transition ${platform === "android" ? "bg-accent text-white" : "text-fg/55"}`}>
            Android
          </button>
        </div>

        {platform === "iphone" ? (
          <Steps items={[
            <>Tap the link above — it opens in <b>Safari</b>.</>,
            <>Tap the <b>Share</b> button — the square with an arrow pointing up, at the bottom of the screen.</>,
            <>Scroll down the list and tap <b>Add to Home Screen</b>.</>,
            <>Tap <b>Add</b> in the top-right corner.</>,
            <>Done — the EILA icon is now on your home screen.</>,
          ]} />
        ) : (
          <Steps items={[
            <>Tap the link above — it opens in <b>Chrome</b>.</>,
            <>Tap the <b>⋮</b> (three dots) in the top-right corner.</>,
            <>Tap <b>Add to Home screen</b>.</>,
            <>Tap <b>Add</b>, then <b>Add</b> again to confirm.</>,
            <>Done — the EILA icon is now on your home screen.</>,
          ]} />
        )}
        <Tip>
          {platform === "iphone"
            ? <>Don&apos;t see &quot;Add to Home Screen&quot;? Make sure you opened the link in Safari, not another app. If you tapped it inside a text message, tap it again and choose &quot;Open in Safari&quot; first.</>
            : <>Don&apos;t see &quot;Add to Home screen&quot;? Make sure you&apos;re using Chrome. Some phones label it &quot;Install app&quot; instead — same thing.</>}
        </Tip>
      </Section>

      {/* ---- first time ---- */}
      <Section title="2. First time you open it" sub="Answer a few quick questions once — EILA remembers everything after that.">
        <Steps items={[
          <>Tap the <b>EILA</b> icon on your home screen.</>,
          <>Tap <b>Create your account</b> — just an email and a password. Because you came in on the Kennesaw link, you won&apos;t be asked to pay.</>,
          <>Tell EILA your first name.</>,
          <>Pick <b>Automotive</b> as your industry, and the role that fits you — most of the sales floor picks <b>Individual Producer</b>.</>,
          <>Upload your pay plan — a photo of the page or the PDF both work. EILA reads it and works out your commission automatically.</>,
          <>That&apos;s it. Your dashboard is live with your real numbers.</>,
        ]} />
      </Section>

      {/* ---- daily use ---- */}
      <Section title="3. Using it every day">
        <div className="flex flex-col gap-3">
          <FeatureCard title="Log a deal">
            Tap the big <b>+</b> button, any time. If you handle F&amp;I, you can even snap a photo of the deal recap and EILA fills in the whole thing for you.
          </FeatureCard>
          <FeatureCard title="Check your numbers">
            The <b>Home</b> tab opens with EILA&apos;s briefing: your day, your money, your deal board, and the first clear step.
          </FeatureCard>
          <FeatureCard title="Run your day">
            The <b>Day</b> tab keeps personal appointments, reminders, money pressure, and work context in one place.
          </FeatureCard>
          <FeatureCard title="Review your deals">
            The <b>Deals</b> tab shows your month log. Tap any customer to open that deal&apos;s report card.
          </FeatureCard>
          <FeatureCard title="Ask EILA anything">
            Tap the sparkle icon at the top or bottom of the screen and just type what&apos;s on your mind. She has your real numbers, not guesses.
          </FeatureCard>
        </div>
      </Section>

      {/* ---- ask ila ---- */}
      <Section title="Don't know what to say? Try one of these" sub="Tap the copy icon, then paste it into the chat with EILA.">
        <div className="flex flex-col gap-2.5">
          {PROMPTS.map((p) => (
            <div key={p} className="glass flex items-center gap-3 py-3 pl-4 pr-3">
              <span className="flex-1 text-[15px] leading-snug">&ldquo;{p}&rdquo;</span>
              <CopyButton text={p} iconOnly />
            </div>
          ))}
        </div>
        <div className="mt-4 border-l-2 border-accent pl-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent2">If you&apos;re F&amp;I</div>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-fg/55">
            You can also say things like <b className="text-fg/75">&quot;Add a VSC to the Dean deal&quot;</b> or{" "}
            <b className="text-fg/75">&quot;Mark deal 1571 as funded&quot;</b> — EILA finds the deal and fixes it right in the chat.
            And if she can&apos;t fix something herself, she&apos;ll file it straight to Aaron with your exact words — nothing gets lost.
          </p>
        </div>
      </Section>

      <footer className="mt-12 border-t border-fg/8 pt-5">
        <div className="mb-4 flex justify-center"><MissionMark width={36} /></div>
        <p className="text-center text-[13px] leading-relaxed text-fg/60">
          Stuck on anything above? Ask EILA &mdash; she&apos;s built to help you use the app, not just talk about it.<br />Still stuck? Email <a className="underline" href="mailto:support@commissioned41.com">support@commissioned41.com</a>.
        </p>
      </footer>
    </main>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mt-11">
      <h2 className="text-[22px] font-black tracking-tight" style={{ textWrap: "balance" }}>{title}</h2>
      {sub && <p className="mt-1 text-[14.5px] leading-relaxed text-fg/50">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="glass mt-4 divide-y divide-fg/5 p-1">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3.5 px-3 py-3.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-[13px] font-black tabnum text-accent2">{i + 1}</span>
          <span className="pt-0.5 text-[15.5px] leading-relaxed">{it}</span>
        </li>
      ))}
    </ol>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2.5 rounded-2xl border border-warn/25 bg-warn/10 p-3.5 text-[14px] leading-relaxed text-fg/80">
      <span className="mt-0.5 shrink-0 font-black text-warn">!</span>
      <span>{children}</span>
    </div>
  );
}

function FeatureCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass p-4">
      <h3 className="text-[16px] font-bold">{title}</h3>
      <p className="mt-1 text-[14.5px] leading-relaxed text-fg/55">{children}</p>
    </div>
  );
}

function CopyButton({ text, label, iconOnly }: { text: string; label?: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  if (iconOnly) {
    return (
      <button onClick={copy} aria-label="Copy this question"
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition active:scale-95 ${copied ? "bg-good/15 text-good" : "bg-fg/6 text-fg/50"}`}>
        {copied ? <Check size={16} /> : <Copy size={15} />}
      </button>
    );
  }
  return (
    <button onClick={copy}
      className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-bold transition active:scale-95 ${copied ? "bg-good/15 text-good" : "bg-fg/6 text-fg/70"}`}>
      {copied ? <span className="flex items-center gap-1.5"><Check size={14} /> Copied!</span> : label}
    </button>
  );
}
