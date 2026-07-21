"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, BriefcaseBusiness, FilePlus2, FolderCheck, Pencil, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { CloseMonthButton } from "@/components/CloseMonthButton";
import { StatusPill } from "@/components/StatusPill";
import { OfficeCheckCard } from "@/components/OfficeCheckCard";
import { DealJacketCard } from "@/components/DealJacketCard";
import { useAuth } from "@/components/AuthProvider";
import { useDeals } from "@/components/DealProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { jacketOrderFor, jacketStatus, withJacketDoc, type JacketDocState } from "@/lib/dealJacket";
import {
  currency,
  canonicalPersonName,
  isSold,
  displayFullPersonName,
  displayPersonName,
  financeStatusLabel,
  dealStageLabel,
  officeCheckSummary,
  productUnits,
  type Deal,
  type OfficeManualKey,
} from "@/lib/data";
import { askIla } from "@/lib/askIla";

export default function DealCenterPage() {
  const { deals, clearDeals, updateDeal, deleteDeal } = useDeals();
  const { isAdmin, isOwner, profile } = useAuth();
  const { settings, updateSettings } = useStoreSettings();
  const [search, setSearch] = useState("");
  const [gateDealId, setGateDealId] = useState<string | null>(null);
  const [jacketDealId, setJacketDealId] = useState<string | null>(null);
  const filteredDeals = useMemo(() => filterDeals(deals, search), [deals, search]);
  const canDeleteDeal = isOwner || isAdmin || profile?.role === "Manager";
  const canCloseMonth = isOwner || isAdmin || profile?.role === "Manager";
  // The jacket ORDER lives on storeSettings, whose server write-matrix is
  // admin-only (lib/access.ts) — gate the editor the same way or the save 403s.
  const canEditJacketOrder = isOwner || isAdmin;
  const gateDeal = gateDealId ? deals.find((d) => d.id === gateDealId) ?? null : null;
  const jacketDeal = jacketDealId ? deals.find((d) => d.id === jacketDealId) ?? null : null;
  const jacketOrder = jacketOrderFor(settings);

  function setJacketDoc(dealId: string, doc: string, state: JacketDocState) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;
    updateDeal(dealId, { jacketDocs: withJacketDoc(deal, doc, state) });
  }

  // Scan and Sort found these docs in the file — one update for the whole batch.
  function markJacketDocsFiled(dealId: string, docs: string[]) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;
    let next = deal.jacketDocs ?? {};
    for (const doc of docs) next = withJacketDoc({ jacketDocs: next }, doc, "have");
    updateDeal(dealId, { jacketDocs: next });
  }

  // Worklist focus — turn the ledger into a punch-down list of what needs action.
  // "working"/"finalized" split the count card: working deals (desk/contracted)
  // and booked units (funded/delivered) are different jobs — never blended.
  const [focus, setFocus] = useState<null | "office" | "rdr" | "working" | "finalized">(null);
  const notReady = useMemo(() => filteredDeals.filter((d) => !d.readyToPost), [filteredDeals]);
  const notPunched = useMemo(() => filteredDeals.filter((d) => (d.stage === "Delivered" || d.stage === "Funded") && (d.rdrStatus || "Not Punched") !== "Punched"), [filteredDeals]);
  // isSold is the ONE brain for "booked" (Delivered/Funded) — the same test
  // metricsFor uses everywhere, so this split can never drift from the money.
  const finalizedDeals = useMemo(() => filteredDeals.filter(isSold), [filteredDeals]);
  const workingDeals = useMemo(() => filteredDeals.filter((d) => !isSold(d)), [filteredDeals]);
  const shownDeals =
    focus === "office" ? notReady
      : focus === "rdr" ? notPunched
        : focus === "working" ? workingDeals
          : focus === "finalized" ? finalizedDeals
            : filteredDeals;

  const totals = useMemo(() => {
    // FINALIZED money only — a working desk deal's speculative gross must not
    // blend into the same tiles as booked gross (Mission Control counts sold).
    const front = finalizedDeals.reduce((s, d) => s + d.frontGross, 0);
    const back = finalizedDeals.reduce((s, d) => s + d.backGrossReserve, 0);
    return { count: filteredDeals.length, front, back, total: front + back };
  }, [filteredDeals, finalizedDeals]);

  function toggleManual(dealId: string, key: OfficeManualKey) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;
    const current = deal.officeChecklist || {};
    updateDeal(dealId, { officeChecklist: { ...current, [key]: !current[key] } });
  }

  function markReady(dealId: string, ready: boolean) {
    updateDeal(dealId, { readyToPost: ready, readyToPostAt: ready ? new Date().toISOString() : undefined });
  }

  function confirmClearDeals() {
    const confirmation = window.prompt("Type CLEAR DEALS to delete every saved deal.");
    if (confirmation === "CLEAR DEALS") clearDeals();
  }

  return (
    <div>
      <SectionHeader title="Deals" kicker="Every deal, one tap from the full record" />

      {/* Summary strip. The two COUNT cards drill straight into their list below
          (working and finalized are different jobs — never blended into one
          number); the gross cards hand the math to EILA. */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {(() => {
          const scope = search ? ` for my "${search}" search (${totals.count} deals shown)` : "";
          const stageCards = [
            {
              key: "finalized" as const,
              label: "Finalized",
              value: `${finalizedDeals.length}`,
              explain: `Explain the finalized (delivered + funded) deal count in Deal Center${scope} — what's in it and flag anything that looks miscounted.`,
            },
            {
              key: "working" as const,
              label: "Working",
              value: `${workingDeals.length}`,
              explain: `Explain the working deal count in Deal Center${scope} — deals still on the desk or contracted, and which ones look stuck.`,
            },
          ];
          const grossCells = [
            { label: "Front gross (finalized)", value: currency(totals.front), accent: "text-white", explain: `Explain the front gross total in Deal Center${scope} — walk the real math deal by deal in plain words and flag anything off, like a missing invoice or negative gross.` },
            { label: "Back gross (finalized)", value: currency(totals.back), accent: "text-mission-green", explain: `Explain the back gross total in Deal Center${scope} — which deals carry it, products vs reserve, and where the back-end is leaking.` },
            { label: "Total gross (finalized)", value: currency(totals.total), accent: "text-mission-gold", explain: `Explain the total gross in Deal Center${scope} — front plus back, walk the real math in plain words. If it looks off, find which input is wrong.` },
          ];
          return (
            <>
              {stageCards.map((cell) => (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setFocus(focus === cell.key ? null : cell.key)}
                  title={focus === cell.key ? "Tap — show all deals" : `Tap — see the ${cell.label.toLowerCase()} deals`}
                  className={`glass-card rounded-[12px] p-4 text-left transition ${focus === cell.key ? "border-mission-gold/60 bg-mission-gold/10" : "hover:border-mission-gold/30"}`}
                >
                  <div className="text-[11px] uppercase tracking-[0.14em] text-white/45">{cell.label}</div>
                  <div className="mt-1 font-display text-2xl font-black text-white">{cell.value}</div>
                  <div className="mt-1 flex items-center gap-3 text-[9px] font-black uppercase tracking-[0.18em]">
                    <span className={focus === cell.key ? "text-mission-gold" : "text-white/35"}>{focus === cell.key ? "showing · tap to clear" : "view list"}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); askIla(cell.explain); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); askIla(cell.explain); } }}
                      className="text-white/25 transition hover:text-mission-gold"
                    >
                      ask EILA why
                    </span>
                  </div>
                </button>
              ))}
              {grossCells.map((cell) => (
                <button key={cell.label} type="button" onClick={() => askIla(cell.explain)} title="Tap — EILA explains this number" className="glass-card rounded-[12px] p-4 text-left transition hover:border-mission-gold/30">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-white/45">{cell.label}</div>
                  <div className={`mt-1 font-display text-2xl font-black ${cell.accent}`}>{cell.value}</div>
                  <div className="mt-1 text-[9px] font-black uppercase tracking-[0.18em] text-white/25">ask EILA why</div>
                </button>
              ))}
            </>
          );
        })()}
      </div>

      {/* Worklist band — what needs action, one tap to focus the list */}
      {(notReady.length > 0 || notPunched.length > 0 || focus) && (
        <div className="mb-5 flex flex-wrap gap-2.5">
          <WorklistTile label="Not office-clean" count={notReady.length} tone="amber" active={focus === "office"} onClick={() => setFocus(focus === "office" ? null : "office")} />
          <WorklistTile label="Not RDR-punched" count={notPunched.length} tone="red" active={focus === "rdr"} onClick={() => setFocus(focus === "rdr" ? null : "rdr")} />
          {focus && (
            <button type="button" onClick={() => setFocus(null)} className="inline-flex items-center gap-2 rounded-[12px] border border-white/12 px-4 py-2.5 text-sm font-bold text-white/65 transition hover:text-white">
              <X className="h-3.5 w-3.5" /> Show all {filteredDeals.length}
            </button>
          )}
        </div>
      )}

      {/* Search + actions */}
      <div className="glass-card mb-5 flex flex-col gap-3 rounded-[12px] p-4 lg:flex-row lg:items-center lg:justify-between">
        <label className="flex min-h-12 w-full items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/70 focus-within:border-mission-gold/55 lg:max-w-[460px]">
          <Search className="h-4 w-4 shrink-0 text-mission-gold" />
          <input
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/42"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search VIN, stock, customer, salesperson, F&I, lender"
            aria-label="Search deals"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="shrink-0 text-white/45 hover:text-white" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/deal-entry"
            className="inline-flex items-center gap-2 rounded-[12px] bg-mission-gold px-4 py-2 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110"
          >
            <FilePlus2 className="h-4 w-4" /> New Deal
          </Link>
          {canCloseMonth && <CloseMonthButton deals={deals} />}
          {canCloseMonth && (
            <Link
              href="/archive"
              className="inline-flex items-center gap-2 rounded-[12px] border border-white/12 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/5"
            >
              <Archive className="h-4 w-4" /> Archive
            </Link>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={confirmClearDeals}
              className="rounded-[12px] border border-mission-red/30 bg-mission-red/10 px-4 py-2 text-sm font-bold text-mission-red transition hover:border-mission-red/60 hover:bg-mission-red/15"
            >
              Clear Deal Data
            </button>
          )}
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="glass-card rounded-[12px] p-10 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-mission-gold/30 bg-mission-gold/10 text-mission-gold">
            <BriefcaseBusiness className="h-7 w-7" />
          </div>
          <div className="mt-5 font-display text-3xl font-black text-white">No deals yet.</div>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/58">Add the first record, or load a month in one shot from the Import screen.</p>
          <Link href="/deal-entry" className="mt-5 inline-flex items-center gap-2 rounded-[12px] bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
            <FilePlus2 className="h-4 w-4" /> New Deal
          </Link>
        </div>
      ) : filteredDeals.length === 0 ? (
        <div className="glass-card rounded-[12px] p-10 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-[12px] border border-mission-gold/30 bg-mission-gold/10 text-mission-gold">
            <Search className="h-7 w-7" />
          </div>
          <div className="mt-5 font-display text-3xl font-black text-white">No matching deals.</div>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/58">Search checks VIN, stock, customer, salesperson, manager, F&I, lender, and deal number.</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden rounded-[12px]">
          {/* Mobile: clean read cards */}
          <div className="divide-y divide-white/8 lg:hidden">
            {shownDeals.map((deal) => (
              <DealRowCard key={deal.id} deal={deal} onGate={() => setGateDealId(deal.id)} onJacket={() => setJacketDealId(deal.id)} canDelete={canDeleteDeal} onDelete={deleteDeal} />
            ))}
          </div>

          {/* Desktop: clean scannable list (full edit one tap away) */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.14em] text-white/45">
                  {["Customer", "Class", "Salesperson", "Manager", "F&I", "Lender", "Front", "Back", "Total", "Products", "Stage", "Status", ""].map((c, i) => (
                    <th key={c || `a${i}`} className={`px-4 py-3 font-black ${["Front", "Back", "Total", "Products"].includes(c) ? "text-right" : ""}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownDeals.map((deal) => {
                  const total = deal.frontGross + deal.backGrossReserve;
                  const units = productUnits(deal);
                  return (
                    <tr key={deal.id} className="group border-b border-white/[0.06] transition-colors hover:bg-white/[0.04]">
                      <td className="px-4 py-3">
                        <Link href={`/deal-entry?id=${deal.id}`} className="block">
                          <div className="font-bold text-white group-hover:text-mission-gold">{deal.customer}</div>
                          <div className="mt-0.5 text-xs text-white/42">{deal.date} · {deal.stockNumber || "—"}</div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill tone={deal.vehicleClass === "New" ? "green" : deal.vehicleClass === "Used" ? "gold" : "blue"}>{deal.vehicleClass}</StatusPill>{deal.isLease ? <StatusPill tone="amber">Lease</StatusPill> : null}
                      </td>
                      <td className="px-4 py-3 text-white/78">
                        {displayFullPersonName(canonicalPersonName(deal.salesperson))}
                        {deal.salesperson2 ? <span className="text-mission-gold"> +1</span> : null}
                      </td>
                      <td className="px-4 py-3 text-white/72">{deal.manager ? displayFullPersonName(canonicalPersonName(deal.manager)) : "—"}</td>
                      <td className="px-4 py-3 text-white/72">{displayFullPersonName(canonicalPersonName(deal.financeManager))}</td>
                      <td className="px-4 py-3 text-white/55">{deal.lender || "—"}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${deal.frontGross < 0 ? "text-mission-red" : "text-white/80"}`}>{currency(deal.frontGross)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-mission-green">{currency(deal.backGrossReserve)}</td>
                      <td className={`px-4 py-3 text-right font-black tabular-nums ${total < 0 ? "text-mission-red" : "text-mission-gold"}`}>{currency(total)}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-white/70">{units ? units.toFixed(units % 1 ? 1 : 0) : "—"}</td>
                      <td className="px-4 py-3"><StatusPill tone="blue">{dealStageLabel(deal.stage)}</StatusPill></td>
                      <td className="px-4 py-3"><StatusPill tone={deal.financeStatus === "Classified" ? "green" : "blue"}>{financeStatusLabel(deal.financeStatus)}</StatusPill></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <JacketDot deal={deal} order={jacketOrder} onOpen={() => setJacketDealId(deal.id)} />
                          <ReadyDot deal={deal} onOpen={() => setGateDealId(deal.id)} />
                          <Link href={`/deal-entry?id=${deal.id}`} className="grid h-8 w-8 place-items-center rounded-[10px] border border-mission-gold/30 bg-mission-gold/10 text-mission-gold transition hover:bg-mission-gold/20" aria-label={`Edit ${deal.customer}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                          {canDeleteDeal && (
                            <button type="button" onClick={() => { if (window.confirm(`Delete deal for ${deal.customer}?`)) deleteDeal(deal.id); }} className="grid h-8 w-8 place-items-center rounded-[10px] border border-mission-red/30 bg-mission-red/10 text-mission-red transition hover:bg-mission-red/20" aria-label={`Delete ${deal.customer}`}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {gateDeal && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" onClick={() => setGateDealId(null)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-display text-lg font-black text-white">{gateDeal.customer}</div>
                <div className="text-xs text-white/50">{gateDeal.stockNumber || "—"} · {gateDeal.lender || "—"}</div>
              </div>
              <button type="button" onClick={() => setGateDealId(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/60 transition hover:border-white/30 hover:text-white" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <OfficeCheckCard deal={gateDeal} onToggleManual={(key) => toggleManual(gateDeal.id, key)} onMarkReady={(ready) => markReady(gateDeal.id, ready)} />
          </div>
        </div>
      )}

      {jacketDeal && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" onClick={() => setJacketDealId(null)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-display text-lg font-black text-white">{jacketDeal.customer}</div>
                <div className="text-xs text-white/50">{jacketDeal.dealNumber ? `#${jacketDeal.dealNumber} · ` : ""}{jacketDeal.stockNumber || "—"} · {jacketDeal.lender || "—"}</div>
              </div>
              <button type="button" onClick={() => setJacketDealId(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/60 transition hover:border-white/30 hover:text-white" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <DealJacketCard
              deal={jacketDeal}
              order={jacketOrder}
              storeName={settings.storeName}
              canEditOrder={canEditJacketOrder}
              onSetDoc={(doc, state) => setJacketDoc(jacketDeal.id, doc, state)}
              onMarkFiled={(docs) => markJacketDocsFiled(jacketDeal.id, docs)}
              onSaveOrder={(order) => updateSettings({ ...settings, dealJacketOrder: order })}
              onFiled={(file) => updateDeal(jacketDeal.id, { jacketFile: file })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function WorklistTile({ label, count, tone, active, onClick }: { label: string; count: number; tone: "amber" | "red"; active: boolean; onClick: () => void }) {
  const accent = tone === "red" ? "text-mission-red" : "text-mission-gold";
  const ring = active ? (tone === "red" ? "border-mission-red/60 bg-mission-red/10" : "border-mission-gold/60 bg-mission-gold/10") : "border-white/10 bg-white/[0.03] hover:border-white/25";
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-3 rounded-[12px] border px-4 py-2.5 text-left transition ${ring}`}>
      <span className={`font-display text-2xl font-black tabular-nums ${count > 0 ? accent : "text-white/40"}`}>{count}</span>
      <span className="text-xs font-bold leading-4 text-white/65">{label}{active ? " · showing" : ""}</span>
    </button>
  );
}

function JacketDot({ deal, order, onOpen }: { deal: Deal; order: string[]; onOpen: () => void }) {
  const { have, required, complete, missing } = jacketStatus(deal, order);
  const untouched = have === 0 && !complete;
  const title = complete ? "Jacket complete" : untouched ? "Run the jacket checklist" : `${missing.length} doc${missing.length === 1 ? "" : "s"} missing`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={`Deal jacket for ${deal.customer}: ${title} (${have}/${required})`}
      className={`grid h-8 w-8 place-items-center rounded-[10px] border transition ${
        complete
          ? "border-mission-green/45 bg-mission-green/12 text-mission-green"
          : untouched
            ? "border-white/12 bg-white/[0.04] text-white/45 hover:text-white/70"
            : "border-mission-gold/40 bg-mission-gold/10 text-mission-gold hover:bg-mission-gold/20"
      }`}
    >
      <FolderCheck className="h-4 w-4" />
    </button>
  );
}

function ReadyDot({ deal, onOpen }: { deal: Deal; onOpen: () => void }) {
  const { open } = officeCheckSummary(deal);
  const ready = Boolean(deal.readyToPost);
  const title = ready ? "Ready to post" : open.length ? `${open.length} to review` : "Run the office gate";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={`Office-clean gate for ${deal.customer}: ${title}`}
      className={`grid h-8 w-8 place-items-center rounded-[10px] border transition ${
        ready
          ? "border-mission-green/45 bg-mission-green/12 text-mission-green"
          : open.length
            ? "border-mission-gold/40 bg-mission-gold/10 text-mission-gold hover:bg-mission-gold/20"
            : "border-white/12 bg-white/[0.04] text-white/45 hover:text-white/70"
      }`}
    >
      <ShieldCheck className="h-4 w-4" />
    </button>
  );
}

function DealRowCard({ deal, onGate, onJacket, canDelete, onDelete }: { deal: Deal; onGate: () => void; onJacket: () => void; canDelete: boolean; onDelete: (id: string) => void }) {
  const total = deal.frontGross + deal.backGrossReserve;
  return (
    <div className="p-4">
      <Link href={`/deal-entry?id=${deal.id}`} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-white">{deal.customer}</div>
          <div className="mt-0.5 text-xs text-white/50">{deal.date} · {deal.stockNumber || "—"}</div>
        </div>
        <StatusPill tone={deal.vehicleClass === "New" ? "green" : deal.vehicleClass === "Used" ? "gold" : "blue"}>{deal.vehicleClass}</StatusPill>{deal.isLease ? <StatusPill tone="amber">Lease</StatusPill> : null}
      </Link>
      <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
        <span className="text-white/45">Salesperson</span><span className="text-right text-white/80">{displayFullPersonName(canonicalPersonName(deal.salesperson))}{deal.salesperson2 ? " +1" : ""}</span>
        <span className="text-white/45">Manager</span><span className="text-right text-white/80">{deal.manager ? displayFullPersonName(canonicalPersonName(deal.manager)) : "—"}</span>
        <span className="text-white/45">F&amp;I</span><span className="text-right text-white/80">{displayFullPersonName(canonicalPersonName(deal.financeManager))}</span>
        <span className="text-white/45">Lender</span><span className="text-right text-white/80">{deal.lender || "—"}</span>
        <span className="text-white/45">Total gross</span><span className={`text-right font-black ${total < 0 ? "text-mission-red" : "text-mission-gold"}`}>{currency(total)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusPill tone="blue">{dealStageLabel(deal.stage)}</StatusPill>
        <StatusPill tone={deal.financeStatus === "Classified" ? "green" : "blue"}>{financeStatusLabel(deal.financeStatus)}</StatusPill>
      </div>
      <div className="mt-3 flex gap-2">
        <Link href={`/deal-entry?id=${deal.id}`} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[12px] border border-mission-gold/30 bg-mission-gold/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-gold"><Pencil className="h-4 w-4" /> Edit</Link>
        <button type="button" onClick={onJacket} className="grid min-h-10 w-11 place-items-center rounded-[12px] border border-white/12 bg-white/[0.04] text-white/60" aria-label="Deal jacket"><FolderCheck className="h-4 w-4" /></button>
        <button type="button" onClick={onGate} className="grid min-h-10 w-11 place-items-center rounded-[12px] border border-white/12 bg-white/[0.04] text-white/60" aria-label="Office gate"><ShieldCheck className="h-4 w-4" /></button>
        {canDelete && (
          <button type="button" onClick={() => { if (window.confirm(`Delete deal for ${deal.customer}?`)) onDelete(deal.id); }} className="grid min-h-10 w-11 place-items-center rounded-[12px] border border-mission-red/30 bg-mission-red/10 text-mission-red" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
        )}
      </div>
    </div>
  );
}

function filterDeals(deals: Deal[], search: string) {
  const query = normalizeSearch(search);
  if (!query) return deals;
  return deals.filter((deal) => {
    const haystack = [
      deal.id, deal.dealNumber || "", deal.date, deal.customer, deal.stockNumber, deal.vin, deal.vehicleClass,
      deal.salesperson, displayPersonName(deal.salesperson), canonicalPersonName(deal.salesperson),
      deal.salesperson2 || "", deal.manager, displayPersonName(deal.manager), canonicalPersonName(deal.manager),
      deal.financeManager, displayPersonName(deal.financeManager), canonicalPersonName(deal.financeManager),
      deal.lender, deal.tradeInfo, deal.financeStatus, deal.rdrStatus || "", deal.missionDebrief,
    ].map(normalizeSearch).join(" ");
    return haystack.includes(query);
  });
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
