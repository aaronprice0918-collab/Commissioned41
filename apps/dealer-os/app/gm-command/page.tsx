"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Banknote, Car, ClipboardCheck, Crown, Factory, HandCoins, X } from "lucide-react";
import { askIla } from "@/lib/askIla";
import { ExplainChip } from "@/components/ExplainChip";
import { MetricCard } from "@/components/MetricCard";
import { MissionRing } from "@/components/MissionRing";
import { CountUp } from "@/components/CountUp";
import { SectionHeader } from "@/components/SectionHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { NightlyBrief } from "@/components/NightlyBrief";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import {
  canonicalPersonName,
  currency,
  docFeeIncome,
  financeLeaderboard,
  financeManagerNamesFromDeals,
  hasTradeData,
  isCountableFinance,
  isSold,
  manufacturerMoney,
  metricsFor,
  salesLeaderboard,
  salespersonNamesFromDeals,
  totalGross,
  tradeEquity,
  unitsLabel,
  type Deal,
} from "@/lib/data";

export default function GmCommandPage() {
  const { deals } = useDeals();
  const { settings } = useStoreSettings();
  const delivered = deals.filter(isSold);
  const metrics = metricsFor(deals);
  const newDeals = delivered.filter((deal) => deal.vehicleClass === "New");
  const usedDeals = delivered.filter((deal) => deal.vehicleClass === "Used");
  const wholesaleDeals = delivered.filter((deal) => deal.vehicleClass === "Wholesale");
  const financeDeals = delivered.filter(isCountableFinance);
  const manufacturerTotal = newDeals.reduce((sum, deal) => sum + manufacturerMoney(deal), 0);
  const missingInvoices = newDeals.filter((deal) => !deal.invoiceAmount).length;
  // Structured trades ONLY — the old regex mined free-text notes for numbers
  // the drill couldn't display, so the card and its list disagreed.
  const tradeIncome = delivered.reduce((sum, deal) => sum + (hasTradeData(deal) ? tradeEquity(deal) : 0), 0);
  const tradesWithData = delivered.filter(hasTradeData).length;
  const docFeeTotal = delivered.reduce((sum, deal) => sum + docFeeIncome(deal), 0);
  const rdrOpen = delivered.filter((deal) => (deal.rdrStatus || "Not Punched") !== "Punched").length;
  const salesTop = salesLeaderboard(deals, salespersonNamesFromDeals(deals))[0];
  const fiTop = financeLeaderboard(deals, financeManagerNamesFromDeals(deals))[0];
  const salesLeader = salesTop && salesTop.units > 0 ? { name: salesTop.name, count: salesTop.units, value: salesTop.totalGross } : null;
  const fiLeader = fiTop && fiTop.copies > 0 ? { name: fiTop.name, count: fiTop.copies, value: fiTop.backGross } : null;

  const [drill, setDrill] = useState<{ title: string; deals: Deal[]; amount?: (d: Deal) => number; amountLabel?: string } | null>(null);

  // Tap-to-explain on every computed number: the card drills into its deals,
  // and "ask EILA why" walks the real math.
  const topCards = [
    { label: "Delivered Units", value: `${metrics.delivered} / ${settings.targets.deliveredUnits}`, detail: `${metrics.missionVelocity}% of store target`, tone: "gold" as const, open: () => setDrill({ title: "Delivered units", deals: delivered }), explain: "Explain our delivered-units number against the store target — the real math, the projected finish at this pace, and what it takes to close the gap." },
    { label: "Total Gross w/ Doc", value: currency(metrics.gross), detail: `PVR ${currency(metrics.pvr)} including doc`, tone: "green" as const, open: () => setDrill({ title: "All delivered — gross", deals: delivered }), explain: "Explain the store's total gross with doc — how front, back, and doc fees build it and the PVR that makes. If it looks off, find which input is wrong." },
    { label: "F&I Gross", value: currency(metrics.financeGross), detail: `${financeDeals.length} classified opportunities`, tone: "blue" as const, open: () => setDrill({ title: "Finance deals", deals: financeDeals, amount: (d: Deal) => d.backGrossReserve, amountLabel: "back gross" }), explain: "Explain our F&I gross — which finance deals build it, walk the real math, and where the back-end is leaking." },
    { label: "Doc Fee Income", value: currency(docFeeTotal), detail: "Daryl monthly doc-fee tally", tone: "gold" as const, open: () => setDrill({ title: "Doc fee — delivered", deals: delivered, amount: docFeeIncome, amountLabel: "doc income" }), explain: "Explain the doc-fee income number — which deals it counts, and flag any delivered deal with a phantom or missing doc fee." },
  ];

  return (
    <div>
      <SectionHeader title="Store Overview" kicker="Whole-store operating view" />

      <div className="mb-5"><MorningBrief /></div>

      <div className="mb-5"><NightlyBrief /></div>

      {/* Store pace — animated ring (matches the home + goals command centers).
          Tap-to-explain: the whole ring hands off to EILA to walk the pace math. */}
      <button
        type="button"
        onClick={() => askIla("Explain the store's delivered pace — walk the real math in plain words: delivered vs the store target, the projected month-end finish, and who's driving or dragging it. If it looks off, find which input is wrong.")}
        className="rise glass-card mb-5 flex w-full items-center gap-5 rounded-[12px] p-5 text-left transition hover:border-mission-gold/30"
      >
        <MissionRing pct={metrics.missionVelocity} size={92} stroke={8}>
          <div className="font-display text-2xl font-black text-white">
            <CountUp value={metrics.missionVelocity} format={(n) => `${Math.round(n)}%`} />
          </div>
        </MissionRing>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Store Pace · Delivered</div>
          <div className="mt-1 font-display text-xl font-black text-white">
            <CountUp value={metrics.delivered} format={(n) => String(Math.round(n))} />
            <span className="text-white/40"> of {settings.targets.deliveredUnits} units</span>
          </div>
          <div className="mt-1 text-sm text-white/50">{metrics.missionVelocity}% of store target this month</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/28">ask EILA why</div>
        </div>
      </button>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {topCards.map((m, i) => (
          <div key={m.label} className="rise" style={{ animationDelay: `${i * 55}ms` }}>
            <MetricCard label={m.label} value={m.value} detail={m.detail} tone={m.tone} onClick={m.open} onExplain={() => askIla(m.explain)} />
          </div>
        ))}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="grid gap-4 md:grid-cols-2">
          <GmPanel i={0} icon={Car} title="New Vehicles" value={`${newDeals.length} Units`} detail={`${currency(sumGross(newDeals))} gross w/ doc | ${currency(manufacturerTotal)} ${Math.round(settings.holdbackPct * 100)}% invoice money`} tone="gold" count={newDeals.length} onOpen={() => setDrill({ title: "New vehicles", deals: newDeals })} explain="Explain the New-vehicles line — units, gross with doc, and the invoice (holdback) money; flag any new unit missing an invoice, that's real money uncaptured." />
          <GmPanel i={1} icon={HandCoins} title="Used Vehicles" value={`${usedDeals.length} Units`} detail={`${currency(sumGross(usedDeals))} gross w/ doc`} tone="green" count={usedDeals.length} onOpen={() => setDrill({ title: "Used vehicles", deals: usedDeals })} explain="Explain the Used-vehicles line — units and gross with doc, walk the real math, and where used gross is leaking." />
          <GmPanel i={2} icon={Factory} title="Wholesale" value={`${wholesaleDeals.length} Units`} detail={`${currency(sumGross(wholesaleDeals))} gross`} tone="blue" count={wholesaleDeals.length} onOpen={() => setDrill({ title: "Wholesale", deals: wholesaleDeals })} explain="Explain the Wholesale line — which deals are in it and what gross they carry." />
          <GmPanel i={3} icon={Banknote} title="Trade Equity Signal" value={currency(tradeIncome)} detail={`ACV − payoff across ${tradesWithData} trade${tradesWithData === 1 ? "" : "s"} with data`} tone="green" count={tradesWithData} onOpen={() => setDrill({ title: "Trades with data", deals: delivered.filter(hasTradeData), amount: tradeEquity, amountLabel: "trade equity" })} explain="Explain the trade-equity signal number — ACV minus payoff across the trades with data, deal by deal, and flag any trade that looks off." />
          <GmPanel i={4} icon={Banknote} title="Daryl Doc Fee Watch" value={currency(docFeeTotal)} detail={`${newDeals.length + usedDeals.length} retail deals checked at ${currency(docFeeTotal / Math.max(newDeals.length + usedDeals.length, 1))} average doc income`} tone="gold" count={delivered.length} onOpen={() => setDrill({ title: "Doc fee — delivered", deals: delivered, amount: docFeeIncome, amountLabel: "doc income" })} explain="Explain the doc-fee watch number — the real math behind the average doc income, and flag any delivered deal with a phantom or missing doc fee." />
        </div>

        <aside className="space-y-5">
          <section className="rise glass-card rounded-[12px] p-5" style={{ animationDelay: "120ms" }}>
            <div className="mb-5 flex items-center gap-3">
              <Crown className="h-6 w-6 text-mission-gold" />
              <div className="font-display text-2xl font-black text-white">Leader Board</div>
              <span className="live-dot ml-auto h-2 w-2 rounded-full bg-mission-green" aria-hidden />
            </div>
            <LeaderLine label="Sales Leader" leader={salesLeader} />
            <LeaderLine label="F&I Leader" leader={fiLeader} />
          </section>

          <section className="rise glass-card rounded-[12px] p-5" style={{ animationDelay: "180ms" }}>
            <div className="mb-5 flex items-center gap-3">
              <ClipboardCheck className="h-6 w-6 text-mission-gold" />
              <div className="font-display text-2xl font-black text-white">Risk Watch</div>
            </div>
            <RiskLine label="Open RDRs" value={`${rdrOpen}`} tone={rdrOpen ? "red" : "green"} href="/rdr-center" explain="Explain the open-RDR count — which delivered deals aren't punched yet and why that money's at risk." />
            <RiskLine label="Missing New Invoices" value={`${missingInvoices}`} tone={missingInvoices ? "red" : "green"} href="/deal-center" explain="Explain the missing-invoice count — which new units have no invoice entered and the holdback money that's uncaptured because of it." />
            <RiskLine label="Product Entry Needed" value={`${metrics.productMissing}`} tone={metrics.productMissing ? "red" : "green"} href="/deal-center" explain="Explain the product-entry-needed count — which deals still need products entered and the hidden gross sitting in them." />
          </section>
        </aside>
      </section>

      {drill && <GmDrill title={drill.title} deals={drill.deals} amount={drill.amount} amountLabel={drill.amountLabel} onClose={() => setDrill(null)} />}
    </div>
  );
}

function GmDrill({ title, deals, onClose, amount = totalGross, amountLabel = "total gross" }: { title: string; deals: Deal[]; onClose: () => void; amount?: (d: Deal) => number; amountLabel?: string }) {
  // The drill sums the SAME measure as the card that opened it — an F&I gross
  // card must not footer with total-gross-with-doc (they used to disagree).
  const sorted = [...deals].sort((a, b) => amount(b) - amount(a));
  const total = sorted.reduce((sum, deal) => sum + amount(deal), 0);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="rise glass-panel relative flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] p-5 sm:rounded-[20px]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-display text-xl font-black text-white">{title}</div>
            <div className="mt-0.5 text-xs text-white/50">{sorted.length} {sorted.length === 1 ? "deal" : "deals"} · {currency(total)} {amountLabel}</div>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="-mx-1 mt-4 flex-1 space-y-1.5 overflow-y-auto px-1">
          {sorted.length === 0 && <div className="py-10 text-center text-sm text-white/45">No deals in this bucket yet.</div>}
          {sorted.map((deal) => {
            const gross = amount(deal);
            return (
              <Link key={deal.id} href={`/deal-entry?id=${deal.id}`} className="group flex items-center justify-between gap-3 rounded-[12px] border border-white/8 bg-white/[0.03] px-3.5 py-2.5 transition hover:border-mission-gold/30 hover:bg-white/[0.06]">
                <div className="min-w-0">
                  <div className="truncate font-bold text-white group-hover:text-mission-gold">{deal.customer || "—"}</div>
                  <div className="text-[11px] uppercase tracking-wide text-white/40">{deal.vehicleClass}{deal.stockNumber ? ` · ${deal.stockNumber}` : ""}</div>
                </div>
                <div className={`shrink-0 text-right font-black tabular-nums ${gross < 0 ? "text-mission-red" : "text-mission-gold"}`}>{currency(gross)}</div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GmPanel({
  i,
  icon: Icon,
  title,
  value,
  detail,
  tone,
  onOpen,
  count,
  explain,
}: {
  i: number;
  icon: typeof Car;
  title: string;
  value: string;
  detail: string;
  tone: "gold" | "green" | "blue";
  onOpen?: () => void;
  count?: number;
  explain?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <Icon className="h-6 w-6 text-mission-gold" />
        <StatusPill tone={tone}>{title}</StatusPill>
      </div>
      <div className="mt-5 font-display text-3xl font-black text-white">{value}</div>
      <p className="mt-3 text-sm leading-6 text-white/58">{detail}</p>
      {(onOpen || explain) && (
        <div className="mt-3 flex items-center gap-3">
          {onOpen && (
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.16em] text-mission-gold/0 transition group-hover:text-mission-gold/75">
              View {count} {count === 1 ? "deal" : "deals"} <ArrowUpRight className="h-3 w-3" />
            </span>
          )}
          {explain && <ExplainChip prompt={explain} />}
        </div>
      )}
    </>
  );
  const cls = "group rise glass-card rounded-[12px] p-5";
  const style = { animationDelay: `${i * 55}ms` } as const;
  // With an explain chip nested inside, the tappable wrapper must be a div with
  // role="button" — a real <button> can't legally contain the chip.
  const primary = onOpen ?? (explain ? () => askIla(explain) : undefined);
  return primary ? (
    <div
      role="button"
      tabIndex={0}
      onClick={primary}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); primary(); } }}
      className={`${cls} lift block w-full cursor-pointer text-left`}
      style={style}
    >
      {body}
    </div>
  ) : (
    <article className={cls} style={style}>{body}</article>
  );
}

function LeaderLine({ label, leader }: { label: string; leader: { name: string; count: number; value: number } | null }) {
  return (
    <div className="mb-3 rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-white/42">{label}</div>
      <div className="mt-2 font-display text-2xl font-black text-white">{leader ? canonicalPersonName(leader.name) : "Awaiting Deals"}</div>
      <div className="mt-1 text-sm text-white/58">{leader ? `${unitsLabel(leader.count)} units | ${currency(leader.value)}` : "No delivered data yet"}</div>
    </div>
  );
}

function RiskLine({ label, value, tone, href, explain }: { label: string; value: string; tone: "red" | "green"; href?: string; explain?: string }) {
  const router = useRouter();
  const inner = (
    <>
      <div className="min-w-0">
        <div className="text-sm font-bold text-white/70 group-hover:text-white">{label}</div>
        {explain && <ExplainChip prompt={explain} className="mt-0.5" />}
      </div>
      <StatusPill tone={tone}>{value}</StatusPill>
    </>
  );
  const cls = "group mb-3 flex items-center justify-between gap-3 rounded-[12px] border border-white/10 bg-white/[0.035] p-3";
  // The explain chip nests inside, so a Link/anchor wrapper is illegal — use a
  // div with role="button" that navigates.
  if (href && explain) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => router.push(href)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(href); } }}
        className={`${cls} cursor-pointer transition hover:border-mission-gold/40 hover:bg-white/[0.06]`}
      >
        {inner}
      </div>
    );
  }
  return href ? (
    <Link href={href} className={`${cls} transition hover:border-mission-gold/40 hover:bg-white/[0.06]`}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function sumGross(deals: Deal[]) {
  return deals.reduce((sum, deal) => sum + totalGross(deal), 0);
}


