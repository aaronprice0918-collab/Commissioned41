"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, CalendarDays, Home, Users, Plus, Sunrise, Settings as SettingsIcon, Sparkles, Wallet } from "lucide-react";
import clsx from "clsx";
import { useMission } from "@/lib/store";
import { followUpQueue } from "@/lib/engine";
import { AddDeal } from "./AddDeal";
import { DailyBrief } from "./DailyBrief";
import { Settings } from "./Settings";
import { LockScreen } from "./LockScreen";
import { IlaChat } from "./IlaChat";
import { biometricEnabled, isUnlockedThisSession } from "@/lib/biometric";
import { Wordmark } from "./Brand";
import { Paywall, useEntitled } from "./Paywall";
import { forecast, money } from "@/lib/engine";
import { todaysMission } from "@/lib/coach";
import { dailyBudget, incomeExpectation } from "@/lib/money/engine";
import { defaultMoneyConfig } from "@/lib/money/types";

export { Wordmark };

// Lets any screen hand EILA an opening request and raise her chat sheet.
const IlaLaunch = createContext<(prompt?: string) => void>(() => {});
export function useAskIla() { return useContext(IlaLaunch); }

type AppSection = "home" | "pipeline" | "day" | "stats" | "money";

const NAV_ITEMS: { href: string; icon: React.ReactNode; label: string; section: AppSection }[] = [
  { href: "/", icon: <Home size={22} />, label: "Home", section: "home" },
  { href: "/stats", icon: <BarChart3 size={22} />, label: "Stats", section: "stats" },
  { href: "/money", icon: <Wallet size={22} />, label: "Money", section: "money" },
  { href: "/day", icon: <CalendarDays size={22} />, label: "Day", section: "day" },
  { href: "/pipeline", icon: <Users size={22} />, label: "Deals", section: "pipeline" },
];

export function AppShell({ active, children, wide }: { active: AppSection; children: React.ReactNode; wide?: boolean }) {
  const { data, account, syncError } = useMission();
  const router = useRouter();
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ilaOpen, setIlaOpen] = useState(false);
  const [ilaPrompt, setIlaPrompt] = useState<string | undefined>(undefined);
  const openIla = (prompt?: string) => { setIlaPrompt(prompt); setIlaOpen(true); };
  const activeTitle = NAV_ITEMS.find((n) => n.section === active)?.label ?? "EILA";

  // Day badge = life items still open today + customer touches that need
  // attention. Follow-up is now one signal inside the day, not the product.
  const dueCount = useMemo(() => followUpQueue(data.deals).needsYou, [data.deals]);
  const dayCount = useMemo(() => {
    const today = localDayKey();
    const lifeToday = (data.lifeItems ?? []).filter((i) => i.date === today && !i.done).length;
    return lifeToday + dueCount;
  }, [data.lifeItems, dueCount]);
  const dayPulse = useMemo(() => {
    if (!data.profile) return null;
    const now = new Date();
    const f = forecast(data.profile.plan, data.deals, now, data.profile.daysOff ?? []);
    const mission = todaysMission(data.profile.plan, data.deals, data.profile.industry, now, data.profile.daysOff ?? []);
    const cfg = data.profile.money ?? defaultMoneyConfig();
    const income = incomeExpectation(
      f.likely.grossPay,
      cfg.paydays ?? cfg.payday,
      now,
      data.profile.plan.taxRate,
      cfg.checkNets,
    );
    const budget = dailyBudget(cfg, income, now);
    return {
      mission,
      likely: f.likely.grossPay,
      dayCount,
      moneyLabel: budget ? money(budget.leftToday) : "Set up",
      moneyHint: budget ? "left today" : "money",
      moneyHref: budget ? "/money/daily" : "/money",
    };
  }, [data.deals, data.profile, dayCount]);
  const [locked, setLocked] = useState(false);
  const [gateReady, setGateReady] = useState(false);
  // Deep-link entitlement wall (July 5 audit C-3): home already gates; these
  // pages did not. The check itself lives in useEntitled — shared with the
  // standalone /report page so there's exactly one gate, no forks.
  const entitled = useEntitled(account);

  // Face ID gate: if enabled and not yet unlocked this session, lock the app.
  useEffect(() => {
    setLocked(biometricEnabled() && !isUnlockedThisSession());
    setGateReady(true);
  }, []);

  // Auto-open the Daily Brief once per calendar day — but only after unlock.
  useEffect(() => {
    if (!gateReady || locked) return;
    try {
      const today = new Date().toDateString();
      if (localStorage.getItem("lite-brief-seen") !== today) {
        setBriefOpen(true);
        localStorage.setItem("lite-brief-seen", today);
      }
    } catch {}
  }, [gateReady, locked]);

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
  }

  if (gateReady && locked) return <LockScreen onUnlock={() => setLocked(false)} />;
  if (account && entitled === false) {
    return (
      <div className="mx-auto min-h-[100dvh] w-full max-w-app px-4 pt-5">
        <Paywall />
      </div>
    );
  }

  return (
    <IlaLaunch.Provider value={openIla}>
    <div className="min-h-[100dvh] w-full lg:mx-auto lg:grid lg:max-w-7xl lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6 lg:px-6 lg:py-6">
      <DesktopRail active={active} dayCount={dayCount} onAdd={() => setAddOpen(true)} onAsk={() => openIla()} />
      <div className={`mx-auto w-full max-w-app px-4 pb-36 pt-[max(env(safe-area-inset-top),20px)] lg:mx-0 lg:max-w-none lg:px-0 lg:pb-0 lg:pt-0 ${wide ? "lg:max-w-none" : ""}`}>
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={goBack} aria-label="Back" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fg/6 text-fg/65 active:scale-95">
            <ArrowLeft size={18} />
          </button>
          <Link href="/" aria-label="Home" className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fg/6 active:scale-95", pathname === "/" ? "text-accent" : "text-fg/65")}>
            <Home size={18} />
          </Link>
          <div className="ml-1 lg:hidden"><Wordmark height={22} /></div>
          <div className="hidden min-w-0 lg:block">
            <div className="text-sm font-bold text-fg">{activeTitle}</div>
          </div>
          {/* Cloud-sync trouble was only whispered inside Settings — a rep could
              work all day on a dead sync and never know (silence sweep, July 13). */}
          {syncError && (
            <span className="rounded-full bg-warn/15 px-2.5 py-1 text-[10.5px] font-bold text-warn">
              Sync issue — retrying
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => openIla()} aria-label="Ask EILA" className="grid h-10 w-10 place-items-center rounded-full bg-accent/15 text-accent2 active:scale-95">
            <Sparkles size={18} />
          </button>
          <button onClick={() => setBriefOpen(true)} aria-label="Daily brief" className="grid h-10 w-10 place-items-center rounded-full bg-fg/6 text-accent2 active:scale-95">
            <Sunrise size={19} />
          </button>
          <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="grid h-10 w-10 place-items-center rounded-full bg-fg/6 text-fg/55 active:scale-95">
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>

      {dayPulse && active !== "home" && (
        <TodayPulse
          mission={dayPulse.mission}
          dayCount={dayPulse.dayCount}
          moneyLabel={dayPulse.moneyLabel}
          moneyHint={dayPulse.moneyHint}
          moneyHref={dayPulse.moneyHref}
          likely={dayPulse.likely}
          onBrief={() => setBriefOpen(true)}
          onAsk={openIla}
        />
      )}

      {children}

      {/* fade so content scrolling under the fixed nav never looks hard-cut */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-28 bg-gradient-to-t from-ink-900 to-transparent lg:hidden" aria-hidden />

      {/* bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <div className="mx-auto max-w-app px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2">
          <div className="glass living-ring flex items-center justify-around rounded-[22px] px-2 py-2">
            <Tab href="/" icon={<Home size={22} />} label="Home" active={active === "home"} />
            <Tab href="/stats" icon={<BarChart3 size={22} />} label="Stats" active={active === "stats"} />
            <Tab href="/money" icon={<Wallet size={22} />} label="Money" active={active === "money"} />
            <button onClick={() => setAddOpen(true)} aria-label="Log a deal"
              className="btn-primary -mt-7 grid h-14 w-14 shrink-0 place-items-center rounded-full shadow-[0_14px_34px_-10px_rgb(127_95_80/0.62)] active:scale-95">
              <Plus size={26} strokeWidth={2.6} />
            </button>
            <Tab href="/day" icon={<CalendarDays size={22} />} label="Day" active={active === "day"} badge={dayCount} />
            <Tab href="/pipeline" icon={<Users size={22} />} label="Deals" active={active === "pipeline"} />
            <button onClick={() => openIla()} className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1 text-fg/70 transition active:scale-95" aria-label="Ask EILA">
              <Sparkles size={22} className="text-accent2" />
              <span className="text-[10px] font-semibold">EILA</span>
            </button>
          </div>
        </div>
      </nav>

      <AddDeal open={addOpen} onClose={() => setAddOpen(false)} />
      <DailyBrief open={briefOpen} onClose={() => setBriefOpen(false)} />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <IlaChat open={ilaOpen} onClose={() => { setIlaOpen(false); setIlaPrompt(undefined); }} initialPrompt={ilaPrompt} />
      </div>
    </div>
    </IlaLaunch.Provider>
  );
}

function TodayPulse({ mission, dayCount, moneyLabel, moneyHint, moneyHref, likely, onBrief, onAsk }: {
  mission: string;
  dayCount: number;
  moneyLabel: string;
  moneyHint: string;
  moneyHref: string;
  likely: number;
  onBrief: () => void;
  onAsk: (prompt?: string) => void;
}) {
  const clearDay = dayCount === 0;
  const dayWord = dayCount === 1 ? "thing" : "things";
  return (
    <section
      className="glass living-ring mb-4 overflow-hidden p-4 lg:p-4"
      aria-label="Today with EILA"
      style={{
        background:
          "linear-gradient(145deg, rgb(var(--ink-900)) 0%, rgb(var(--accent) / 0.08) 45%, rgb(var(--accent-2) / 0.07) 100%)",
      }}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onBrief}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-good/12 text-good active:scale-95"
          aria-label="Open today's brief"
        >
          <Sunrise size={19} />
        </button>
        <button
          onClick={() => onAsk(`Today's home check-in says: "${mission}". Give me the clearest, calmest day plan from here — life, money, deals, and what should I do first?`)}
          className="min-w-0 flex-1 text-left active:opacity-80"
        >
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-accent2">EILA briefing</div>
          <div className="mt-0.5 text-[16px] font-black leading-tight text-fg">
            {clearDay ? "You have room to breathe today." : `${dayCount} ${dayWord} deserve a little attention.`}
          </div>
          <div className="mt-1 line-clamp-2 text-[12.5px] font-semibold leading-snug text-fg/58">
            One simple next step: {mission}
          </div>
        </button>
        <button onClick={onBrief} className="hidden shrink-0 rounded-full bg-fg/6 px-3 py-2 text-[11px] font-bold text-fg/65 active:scale-95 sm:inline-flex">
          Brief
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 border-t border-fg/6 pt-2 text-center">
        <Link href="/day" className="min-w-0 border-r border-fg/6 px-2 active:opacity-75">
          <div className={`text-sm font-black tabnum ${dayCount ? "text-warn" : "text-good"}`}>{dayCount || "Clear"}</div>
          <div className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-fg/45">day</div>
        </Link>
        <Link href={moneyHref} className="min-w-0 border-r border-fg/6 px-2 active:opacity-75">
          <div className="text-sm font-black tabnum text-fg">{moneyLabel}</div>
          <div className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-fg/45">{moneyHint}</div>
        </Link>
        <Link href="/stats" className="min-w-0 px-2 active:opacity-75">
          <div className="text-sm font-black tabnum text-accent">{money(likely)}</div>
          <div className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-fg/45">likely</div>
        </Link>
      </div>
    </section>
  );
}

function DesktopRail({ active, dayCount, onAdd, onAsk }: { active: AppSection; dayCount: number; onAdd: () => void; onAsk: () => void }) {
  return (
    <aside className="hidden lg:sticky lg:top-6 lg:flex lg:h-[calc(100dvh-3rem)] lg:flex-col">
      <div className="glass flex min-h-0 flex-1 flex-col p-4">
        <div className="px-1 pb-5 pt-1"><Wordmark height={24} /></div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <DesktopNavItem key={item.href} item={item} active={active === item.section} badge={item.section === "day" ? dayCount : undefined} />
          ))}
        </nav>
        <div className="mt-5 grid gap-2">
          <button onClick={onAdd} className="btn btn-primary w-full !justify-start !rounded-2xl !px-4 !py-3">
            <Plus size={18} /> Log a deal
          </button>
          <button onClick={onAsk} className="btn btn-ghost w-full !justify-start !rounded-2xl !px-4 !py-3 text-accent2">
            <Sparkles size={18} /> Ask EILA
          </button>
        </div>
        <div className="mt-auto rounded-2xl bg-fg/[0.035] p-3 text-xs leading-relaxed text-fg/55">
          Day clear. Deals logged. Money watched.
        </div>
      </div>
    </aside>
  );
}

function localDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function DesktopNavItem({ item, active, badge }: { item: { href: string; icon: React.ReactNode; label: string }; active: boolean; badge?: number }) {
  return (
    <Link
      href={item.href}
      className={clsx(
        "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition",
        active ? "bg-accent/12 text-accent" : "text-fg/65 hover:bg-fg/[0.04] hover:text-fg/85",
      )}
    >
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-fg/[0.045]">{item.icon}</span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent2 px-1 text-[11px] font-black text-white tabnum">{badge > 9 ? "9+" : badge}</span> : null}
    </Link>
  );
}

function Tab({ href, icon, label, active, badge }: { href: string; icon: React.ReactNode; label: string; active: boolean; badge?: number }) {
  return (
    <Link href={href} className={clsx("relative flex min-w-0 flex-1 flex-col items-center gap-1 py-1 transition", active ? "text-accent" : "text-fg/70")}>
      {icon}
      {badge ? (
        <span className="absolute -top-1 right-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent2 px-1 text-[10px] font-black text-white tabnum">{badge > 9 ? "9+" : badge}</span>
      ) : null}
      <span className="max-w-full truncate text-[10px] font-semibold">{label}</span>
    </Link>
  );
}
