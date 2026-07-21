"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { CommandDeck } from "@/components/CommandDeck";
import {
  Award,
  BadgeDollarSign,
  Archive,
  Brain,
  Calculator,
  CalendarClock,
  Car,
  Coins,
  Contact,
  Crown,
  Files,
  Gauge,
  HandCoins,
  ChevronLeft,
  ChevronRight,
  Compass,
  Building2,
  Menu,
  ArrowLeft,
  Home,
  Network,
  LockKeyhole,
  LogOut,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Palette,
  ClipboardCheck,
  Settings,
  Shield,
  Store,
  Target,
  Upload,
  Fuel,
  UsersRound,
  CreditCard,
  Wrench,
  Package,
  type LucideIcon,
} from "lucide-react";
import { authHeaders } from "@/lib/storeClient";
import clsx from "clsx";
import { useAuth } from "@/components/AuthProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { useDeals } from "@/components/DealProvider";
import { useCrmLeads } from "@/components/CrmProvider";
import { MissionMark, MissionWordmark } from "@/components/BrandMarks";
import { themes, useTheme, type ThemeKey } from "@/components/ThemeProvider";
import { isSold } from "@/lib/data";
import { isOpenLead, scoreLead } from "@/lib/leadScore";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; hint: string; icon: LucideIcon; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    hint: "Store dashboard & GM view",
    icon: Gauge,
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/gm-command", label: "Store Overview", icon: Crown },
    ],
  },
  {
    label: "The Deal",
    hint: "A deal, start to finish",
    icon: Store,
    items: [
      { href: "/crm-desk", label: "Showroom", icon: UsersRound },
      { href: "/follow-up", label: "Follow-Up", icon: ListChecks },
      { href: "/appointments", label: "Appointments", icon: CalendarClock },
      { href: "/equity", label: "Equity", icon: Coins },
      { href: "/desking", label: "Desking", icon: Calculator },
      { href: "/finance-desk", label: "Finance", icon: HandCoins },
      { href: "/service", label: "Service Lane", icon: Wrench },
      { href: "/parts", label: "Parts Counter", icon: Package },
      { href: "/deal-center", label: "Deals", icon: Files },
      { href: "/rdr-center", label: "RDR", icon: ClipboardCheck },
      { href: "/archive", label: "Archive", icon: Archive },
    ],
  },
  {
    label: "Performance",
    hint: "Goals, gross & recognition",
    icon: BadgeDollarSign,
    items: [
      { href: "/goals", label: "Goals", icon: Target },
      { href: "/finance-command", label: "F&I Report", icon: BadgeDollarSign },
      { href: "/commands", label: "Sales by Type", icon: Car },
      { href: "/recognition-feed", label: "Recognition", icon: Award },
      { href: "/my-scorecard", label: "My Scorecard", icon: LockKeyhole },
    ],
  },
  {
    label: "Team",
    hint: "People & chat",
    icon: UsersRound,
    items: [
      { href: "/team-command", label: "Team", icon: Network },
      { href: "/private-chat", label: "Messages", icon: MessageSquareText },
      { href: "/business-card", label: "Business Card", icon: Contact },
      { href: "/security", label: "Security", icon: LockKeyhole },
    ],
  },
  {
    label: "Admin",
    hint: "Store setup & access",
    icon: Settings,
    items: [
      { href: "/admin", label: "Admin", icon: Settings },
      { href: "/group", label: "Group", icon: Building2 },
      { href: "/pay-plan-studio", label: "Pay Plan Studio", icon: HandCoins },
      { href: "/store-settings", label: "Store Settings", icon: Store },
      { href: "/billing", label: "Billing", icon: CreditCard },
      { href: "/import", label: "Import", icon: Upload },
      { href: "/setup", label: "Monthly Setup", icon: Fuel },
    ],
  },
  {
    label: "Owner",
    hint: "Your private executive OS",
    icon: Compass,
    items: [
      { href: "/mission-core", label: "MissionOS Core", icon: Compass },
      { href: "/waitlist", label: "Commissioned 41 HQ", icon: Building2 },
      { href: "/ila-brain", label: "EILA's Brain", icon: Brain },
    ],
  },
];

function getCurrentPageLabel(pathname: string) {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.href === pathname || (pathname === "/command" && item.href === "/commands")) {
        return item.label;
      }
    }
  }
  return "Dealer Mission OS";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { canAccess, profile, secureMode, isOwner, signOut } = useAuth();
  const storeName = useStoreSettings().settings.storeName || "Dealer Mission OS";
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  // Gate the attention badges to AFTER mount: they derive from client-loaded
  // data (leads/deals) + today's date, so rendering them during SSR/first
  // hydration would mismatch the server HTML. Mount-gating keeps hydration clean.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { deals } = useDeals();
  const { leads } = useCrmLeads();

  // Live attention counts — the OS chrome answers "what needs me?" without a click.
  // Same signals the Morning Brief surfaces, wired straight into the nav.
  const freshLeads = leads.filter((l) => l.status === "New Lead").length;
  const inDesk = leads.filter((l) => l.status === "Desking" || l.status === "In Finance").length;
  const openRdr = deals.filter((d) => isSold(d) && (d.rdrStatus || "Not Punched") !== "Punched").length;
  const overdueFollowups = leads.filter((l) => isOpenLead(l) && scoreLead(l).overdue).length;
  // LOCAL day — appointments are local strings; UTC zeroed the badge every evening.
  const todayIso = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
  const apptsToConfirm = leads.filter(
    (l) => l.appointment && l.appointment.slice(0, 10) === todayIso && !l.appointmentConfirmed && !["Shown", "Desking", "In Finance", "Won", "Lost"].includes(l.status),
  ).length;
  const navBadges: Record<string, { count: number; tone: "red" | "amber" }> = mounted
    ? {
        "/crm-desk": { count: freshLeads, tone: "red" },
        "/follow-up": { count: overdueFollowups, tone: "red" },
        "/appointments": { count: apptsToConfirm, tone: "amber" },
        "/desking": { count: inDesk, tone: "amber" },
        "/rdr-center": { count: openRdr, tone: "red" },
      }
    : {};
  // The chip's number = the SUM of the per-screen badges, so following the
  // dots always accounts for every item the chip promised. No orphan counts.
  const attentionTotal = mounted ? Object.values(navBadges).reduce((sum, b) => sum + b.count, 0) : 0;

  // Close mobile overlay on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Store subscription state — the server is the real gate (every data route
  // 402s a lapsed org); this check just renders a decent paywall instead of an
  // inexplicably empty app. Default entitled so nothing flashes while loading,
  // and skip entirely outside secure mode (dev / preview).
  const [lapsed, setLapsed] = useState(false);
  useEffect(() => {
    if (!secureMode || !profile) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/billing", { cache: "no-store", headers: await authHeaders() });
        if (!res.ok) return;
        const data = (await res.json()) as { entitled?: boolean };
        if (!cancelled) setLapsed(data.entitled === false);
      } catch {
        /* fail open — the server still enforces */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [secureMode, profile, pathname]);

  if (pathname.startsWith("/card/") || pathname.startsWith("/print/") || pathname === "/welcome" || pathname === "/terms" || pathname === "/privacy" || pathname === "/signup" || pathname === "/pricing") return <>{children}</>;

  // Lapsed store: everything routes to the paywall except Billing itself (the
  // admin needs it to fix the subscription).
  if (lapsed && pathname !== "/billing") {
    const admin = profile?.role === "Admin" || isOwner;
    return (
      <div className="grid min-h-screen place-items-center bg-[#08090c] px-5 text-white">
        <div className="w-full max-w-md rounded-[22px] border border-white/10 bg-gradient-to-b from-[#0c0d10] to-[#08090b] p-8 text-center shadow-[0_40px_120px_rgba(0,0,0,0.7)]">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-mission-gold/10 text-mission-gold">
            <CreditCard className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-black">This store&apos;s subscription has lapsed.</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-white/60">
            {admin
              ? "Renew it and the whole team is back in seconds — every deal and lead is safe and waiting."
              : "Ask your manager or admin to renew the store's Dealer Mission OS subscription — all the data is safe and waiting."}
          </p>
          {admin && (
            <Link href="/billing" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mission-gold px-6 py-4 text-sm font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110">
              Fix billing
            </Link>
          )}
          <button type="button" onClick={() => void signOut()} className="mt-4 text-sm font-semibold text-white/50 transition hover:text-white">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const allowed = canAccess(pathname);
  const currentLabel = getCurrentPageLabel(pathname);

  const visibleGroups = navGroups
    .filter((group) => group.label !== "Owner" || isOwner) // MissionOS Core is owner-only
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccess(item.href)) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen command-grid isolate">
      {/* Liquid-glass black — soft sheen flowing across the dark surface, like light
          rolling over black glass. Neutral silver highlights + one faint green for life. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <span className="glass-orb" style={{ width: 760, height: 320, left: "-14%", top: "2%", mixBlendMode: "screen", background: "radial-gradient(60% 50% at 50% 50%, rgba(48,96,196,0.22), transparent 70%)", animation: "orbDrift 30s ease-in-out infinite" }} />
        <span className="glass-orb" style={{ width: 680, height: 280, right: "-16%", bottom: "8%", mixBlendMode: "screen", background: "radial-gradient(60% 50% at 50% 50%, rgba(40,82,178,0.18), transparent 72%)", animation: "orbDrift2 38s ease-in-out infinite" }} />
        <span className="glass-orb" style={{ width: 560, height: 240, left: "28%", top: "46%", mixBlendMode: "screen", background: "radial-gradient(60% 50% at 50% 50%, rgba(54,104,206,0.15), transparent 72%)", animation: "orbDrift 34s ease-in-out infinite" }} />
        <span className="glass-orb" style={{ width: 540, height: 540, right: "2%", top: "12%", background: "radial-gradient(circle, rgba(96,150,255,0.06), transparent 66%)", animation: "orbDrift2 42s ease-in-out infinite" }} />
      </div>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Left Rail ──────────────────────────────────────────── */}
      <nav
        style={{ paddingTop: "env(safe-area-inset-top)" }}
        className={clsx(
          "fixed left-0 top-0 bottom-0 z-40 flex flex-col border-r border-white/[0.07] bg-[#0a0b0e] transition-all duration-200 ease-in-out overflow-hidden lg:overflow-visible",
          open ? "w-[88vw] max-w-[380px] lg:w-60 translate-x-0" : "w-16 -translate-x-full lg:translate-x-0"
        )}
      >
        {/* Brand mark */}
        <div
          className={clsx(
            "flex items-center border-b border-white/[0.07] shrink-0 h-16",
            open ? "gap-3 px-4" : "justify-center px-0"
          )}
        >
          <MissionMark className="h-9 w-9 shrink-0" priority />
          {open && (
            <div className="min-w-0">
              <MissionWordmark eyebrow={false} className="block whitespace-nowrap text-[11px] tracking-tight" />
              <div className="text-[9px] font-bold text-white/30 tracking-[0.2em] uppercase whitespace-nowrap">
                {storeName}
              </div>
            </div>
          )}
        </div>

        {/* Nav groups */}
        <div className={clsx("flex-1 py-2", open ? "overflow-y-auto" : "overflow-visible")}>
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const groupActive = group.items.some(
              (it) => it.href === pathname || (pathname === "/command" && it.href === "/commands")
            );

            // Collapsed: one icon per group + hover flyout that reveals contents
            const groupAttention = group.items.some((it) => navBadges[it.href]?.count);
            if (!open) {
              return (
                <div key={group.label} className="group/nav relative px-2 py-0.5">
                  <div
                    className={clsx(
                      "relative mx-auto flex h-10 w-10 items-center justify-center rounded-[10px] transition",
                      groupActive
                        ? "bg-mission-gold/15 text-mission-gold ring-1 ring-mission-gold/40"
                        : "text-white/50 group-hover/nav:bg-white/[0.08] group-hover/nav:text-white"
                    )}
                  >
                    <GroupIcon className="h-[18px] w-[18px]" />
                    {groupAttention && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-mission-red ring-2 ring-[#0a0b0e]" />}
                  </div>
                  <div className="absolute left-full top-0 z-50 hidden pl-2 group-hover/nav:block">
                    <div className="min-w-[216px] rounded-[14px] border border-white/10 bg-[#0d0e12]/95 p-2 shadow-[0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                      <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                        <GroupIcon className="h-3.5 w-3.5 text-mission-gold" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">{group.label}</span>
                      </div>
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = item.href === pathname || (pathname === "/command" && item.href === "/commands");
                        const badge = navBadges[item.href];
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={clsx(
                              "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold transition",
                              active ? "bg-mission-gold text-mission-navy" : "text-white/65 hover:bg-white/[0.08] hover:text-white"
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="whitespace-nowrap">{item.label}</span>
                            {badge && badge.count > 0 && (
                              <span className={clsx(
                                "ml-auto grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[10px] font-black tabular-nums",
                                badge.tone === "red" ? "bg-mission-red text-white" : "bg-mission-gold text-mission-navy"
                              )}>
                                {badge.count}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            // Expanded: section label + a grid of big, bold tiles you can't miss
            return (
              <div key={group.label} className="mb-2 px-3">
                <div className="flex items-center gap-2 px-1 pt-3 pb-2 select-none">
                  <GroupIcon className="h-3.5 w-3.5 text-white/30 shrink-0" />
                  <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/30 whitespace-nowrap">{group.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.href || (pathname === "/command" && item.href === "/commands");
                    const badge = navBadges[item.href];
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={clsx(
                          "relative flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-[16px] border p-3 text-center transition",
                          active
                            ? "border-transparent bg-mission-gold text-mission-navy shadow-gold"
                            : "border-white/10 bg-white/[0.04] text-white/85 active:scale-[0.97] hover:border-mission-gold/45 hover:text-white"
                        )}
                      >
                        {badge && badge.count > 0 && (
                          <span className={clsx(
                            "absolute right-2 top-2 grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[10px] font-black tabular-nums",
                            badge.tone === "red" ? "bg-mission-red text-white" : "bg-mission-gold text-mission-navy"
                          )}>
                            {badge.count}
                          </span>
                        )}
                        <Icon className="h-7 w-7 shrink-0" />
                        <span className="text-[13px] font-bold leading-tight">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Sign out — the last item, right below Commissioned 41 HQ */}
          {open ? (
            <button type="button" onClick={() => void signOut()} className="mx-2 mt-1 flex w-[calc(100%-1rem)] items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold text-mission-red/80 transition hover:bg-mission-red/10 hover:text-mission-red">
              <LogOut className="h-[18px] w-[18px] shrink-0" />
              <span className="whitespace-nowrap">Sign out</span>
            </button>
          ) : (
            <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="mx-auto mt-1 flex h-10 w-10 items-center justify-center rounded-[10px] text-mission-red/70 transition hover:bg-mission-red/10 hover:text-mission-red">
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>

        {/* Bottom controls */}
        <div className={clsx("border-t border-white/[0.07] shrink-0", open ? "p-3 space-y-2" : "p-2 space-y-1")}>
          {open && (
            <label className="flex items-center gap-2 w-full rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/45 cursor-pointer">
              <Palette className="h-3.5 w-3.5 text-mission-gold shrink-0" />
              <select
                className="flex-1 min-w-0 bg-transparent text-white outline-none text-xs"
                value={theme}
                onChange={(e) => setTheme(e.target.value as ThemeKey)}
              >
                {themes.map((t) => (
                  <option key={t.key} value={t.key} className="bg-[#0a0b0e] text-white">
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={clsx(
              "flex items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.04] text-white/40 hover:text-white hover:bg-white/[0.08] transition w-full",
              open ? "gap-2 px-3 py-2 text-xs font-bold" : "h-10"
            )}
          >
            {open ? (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </nav>

      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <header
        style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(4rem + env(safe-area-inset-top))" }}
        className={clsx(
          "fixed top-0 right-0 z-30 flex items-center gap-4 h-16 border-b border-white/[0.07] bg-[#0a0b0e]/95 backdrop-blur-xl px-5 transition-all duration-200 ease-in-out",
          open ? "left-0 lg:left-60" : "left-0 lg:left-16"
        )}
      >
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          className="lg:hidden flex items-center justify-center h-9 w-9 rounded-[12px] border border-white/12 bg-white/[0.06] text-white shrink-0"
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Back + Home — one-tap wayfinding from any screen (Aaron). Hidden on
            the dashboard itself, where "back/home" would be a no-op. */}
        {pathname !== "/" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Go back"
              className="flex items-center justify-center h-9 w-9 rounded-[12px] border border-white/12 bg-white/[0.06] text-white/80 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Link
              href="/"
              aria-label="Home — Mission Control"
              className="flex items-center justify-center h-9 w-9 rounded-[12px] border border-white/12 bg-white/[0.06] text-white/80 transition hover:text-white"
            >
              <Home className="h-4 w-4" />
            </Link>
          </div>
        )}

        {/* Page title — big & bold */}
        <h1 className="flex-1 text-xl font-black text-white tracking-tight leading-none truncate">
          {currentLabel}
        </h1>

        {/* Global attention — "what needs me?" in the chrome, one tap to the brief */}
        {attentionTotal > 0 && (
          // Land the tap where THIS role can act: GM Command for those who
          // can open it, the Showroom for everyone else (Sales/BDC used to
          // land on an access-denied wall).
          <Link href={canAccess("/gm-command") ? "/gm-command" : "/crm-desk"} className="flex items-center gap-2 rounded-[12px] border border-mission-red/30 bg-mission-red/10 px-3 py-2 shrink-0 transition hover:bg-mission-red/15">
            <span className="live-dot h-2 w-2 rounded-full bg-mission-red shrink-0" aria-hidden />
            <span className="text-xs font-bold text-white/85 whitespace-nowrap">{attentionTotal} need{attentionTotal === 1 ? "s" : ""} you</span>
          </Link>
        )}

        {/* Role badge */}
        {profile?.role && (
          <div className="hidden sm:flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2 shrink-0">
            <div className="h-5 w-5 rounded-full bg-mission-gold/20 border border-mission-gold/50 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-black text-mission-gold">
                {profile.role.charAt(0)}
              </span>
            </div>
            <span className="text-xs font-bold text-white/60 whitespace-nowrap">
              {profile.role}
            </span>
          </div>
        )}
      </header>

      {/* ── Main content ────────────────────────────────────────── */}
      <main
        className={clsx(
          "transition-all duration-200 ease-in-out",
          open ? "lg:pl-60" : "lg:pl-16"
        )}
      >
        <div key={pathname} style={{ paddingTop: "calc(5rem + env(safe-area-inset-top))", paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }} className="rise w-full px-4 lg:px-8">
          {allowed ? children : <AccessDenied role={profile?.role || (secureMode ? "Employee" : "Preview")} />}
        </div>
      </main>

      {/* EILA's Command Deck — ask anything (type or talk) from any screen */}
      <CommandDeck />
    </div>
  );
}

function AccessDenied({ role }: { role: string }) {
  return (
    <div className="glass-card mx-auto mt-20 max-w-2xl rounded-[12px] p-8 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-mission-gold/35 bg-mission-gold/10 text-mission-gold">
        <Shield className="h-7 w-7" />
      </div>
      <div className="mt-5 font-display text-3xl font-black text-white">
        Access controlled by management
      </div>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/60">
        This screen is not included with the current {role} access level. A manager or admin can change the employee role in the secure profile setup.
      </p>
    </div>
  );
}
