"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, FileScan, FolderOpen, Landmark, PencilLine, Phone, Sparkles, Trash2, Users } from "lucide-react";
import clsx from "clsx";
import { useMission } from "@/lib/store";
import { useAskIla } from "./AppShell";
import { Labeled, parseNumericInput as num } from "./ui";
import { Deal, DealStatus, STATUS_LABEL, STATUS_WEIGHT } from "@/lib/types";
import { INDUSTRY_DEAL, statusLabel } from "@/lib/industry";
import { calculatePay, localMonthKey, money, perfFromDeals } from "@/lib/engine";
import { changedFields } from "@/lib/mergeEdits";
import { perDealPay } from "@/lib/payplan/calc";
import { dealUnits, productDefs, resolveVscId, spiffTotal, usesProductMenu } from "@/lib/fni";
import { jacketFileDaysLeft, jacketFileFresh, openJacketFile } from "@/lib/jacketFile";
import { CountUp } from "./motion";

const FLOW: DealStatus[] = ["prospect", "appointment", "working", "pending", "finance", "delivered", "dead"];

// One deal, the full story: what it pays (computed against the user's own
// plan, as the marginal difference this deal makes to the month), and every
// field editable — products added after the fact included.
export function DealDetail({ id }: { id: string }) {
  const { data, updateDeal, removeDeal } = useMission();
  const router = useRouter();
  const askIla = useAskIla();
  const deal = data.deals.find((d) => d.id === id);

  const industry = data.profile?.industry ?? "other";
  const spec = INDUSTRY_DEAL[industry];
  const fni = usesProductMenu(industry);
  const defs = productDefs(data.profile);

  const [form, setForm] = useState<Deal | null>(deal ? { ...deal } : null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Opens as a clean RECAP (the month-end report's little sibling); Edit
  // flips into the full form.
  const [mode, setMode] = useState<"recap" | "edit">("recap");

  // The deal as it was when the user tapped Edit — the baseline we diff the
  // form against on save, so Save writes ONLY the fields the user changed and
  // can't stamp a frozen snapshot back over a field EILA (or a cloud pull)
  // changed while this page was open. While in recap, keep the form mirrored
  // to the live deal so entering Edit always starts from the latest.
  const editBaseline = useRef<Deal | null>(null);
  useEffect(() => {
    if (mode === "recap" && deal) setForm({ ...deal });
  }, [deal, mode]);

  // Marginal pay: the month's pay WITH this deal landed minus WITHOUT it —
  // the honest answer to "what does this deal put in my pocket?"
  const impact = useMemo(() => {
    if (!deal || !data.profile) return null;
    const plan = data.profile.plan;
    // LOCAL month cohort, matching the dashboard's isThisMonth — slicing the
    // UTC string mis-cohorted evening deals near a month boundary.
    const month = localMonthKey(deal.date);
    const delivered = data.deals.filter((d) => localMonthKey(d.date) === month && d.status === "delivered" && d.id !== deal.id);
    const vscId = resolveVscId(defs);
    const without = calculatePay(plan, perfFromDeals(delivered, vscId));
    const withIt = calculatePay(plan, perfFromDeals([...delivered, { ...deal, status: "delivered" }], vscId));
    const spiff = fni ? spiffTotal([deal], defs) : 0;
    // A per-deal plan pays a loser deal its mini; say so instead of a bare number.
    const mini = plan.perDeal ? perDealPay(plan.perDeal, deal.amount, deal.category || undefined).mini : false;
    return { delta: withIt.grossPay - without.grossPay + spiff, spiff, mini, landed: deal.status === "delivered", odds: STATUS_WEIGHT[deal.status] };
  }, [deal, data, fni, defs]);

  if (!deal || !form) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-sm text-fg/50">
        That deal isn&apos;t here anymore. <Link href="/pipeline" className="ml-2 text-accent">Back to deals</Link>
      </div>
    );
  }

  const patch = (p: Partial<Deal>) => setForm((f) => (f ? { ...f, ...p } : f));
  const toggleProduct = (pid: string) => {
    const list = form.products ?? [];
    const next = list.includes(pid) ? list.filter((x) => x !== pid) : [...list, pid];
    patch({ products: next, addons: dealUnits({ ...form, products: next }, defs) });
  };

  function save() {
    if (!form) return;
    const trimmed: Deal = {
      ...form,
      customer: form.customer.trim(),
      item: form.item.trim(),
      phone: form.phone?.trim() || undefined,
      dealNumber: form.dealNumber?.trim() || undefined,
      bank: form.bank?.trim() || undefined,
      salesperson: form.salesperson?.trim() || undefined,
      salesperson2: form.salesperson2?.trim() || undefined,
      note: form.note?.trim() || undefined,
    };
    // Write only what the user changed (diff vs the deal at Edit-time), so a
    // field EILA changed on this deal meanwhile isn't reverted. updateDeal
    // merges the partial patch onto the live deal.
    const patch = editBaseline.current ? changedFields(editBaseline.current, trimmed) : trimmed;
    updateDeal(id, patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm font-semibold text-fg/50 active:scale-95">
          <ArrowLeft size={16} /> Back
        </button>
        <span className="text-xs text-fg/60 tabnum">
          {new Date(deal.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {form.dealNumber ? ` · #${form.dealNumber}` : ""}
        </span>
      </div>

      {/* who + what */}
      <div className="px-1">
        <div className="mb-1 text-[11px] font-black uppercase tracking-[0.14em] text-accent2">Deal report card</div>
        <h1 className="font-display text-2xl font-black leading-tight">{form.customer || "New opportunity"}</h1>
        <div className="mt-0.5 text-sm text-fg/70">{form.item || spec.itemLabel}</div>
      </div>

      {/* Scan and Sort — F&I: the signed stack back in your jacket order, a
          printable PDF to file in your own drive (Google Drive, wherever).
          Lives on the deal card so the finished deal and its paperwork ritual
          are one tap apart. */}
      {data.profile?.role === "finance" && (
        <div className="flex gap-2">
          <Link
            href={`/jacket?deal=${encodeURIComponent(id)}`}
            className="glass rise flex min-w-0 flex-1 items-center justify-between p-4 transition active:scale-[0.99]"
          >
            <span className="flex items-center gap-2 text-sm font-bold text-accent2">
              <FileScan size={17} /> Scan and Sort
            </span>
            <span className="hidden items-center gap-1 text-xs text-fg/50 sm:flex">
              the deal, in jacket order <ChevronRight size={14} />
            </span>
          </Link>
          {/* The blue folder — the sorted jacket EILA is holding (90 days).
              Tap: the whole deal, right there. */}
          {jacketFileFresh(deal.jacketFile) && (
            <button
              type="button"
              onClick={() => { void openJacketFile(deal.jacketFile!.path).catch((e) => alert(e instanceof Error ? e.message : "Couldn't open the file.")); }}
              title={`The scanned deal — EILA holds it ${jacketFileDaysLeft(deal.jacketFile!)} more day${jacketFileDaysLeft(deal.jacketFile!) === 1 ? "" : "s"}`}
              aria-label="Open the scanned deal file"
              className="glass rise grid w-16 shrink-0 place-items-center p-2 text-sky-400 transition active:scale-95"
            >
              <FolderOpen size={24} />
            </button>
          )}
        </div>
      )}

      {/* what it pays — the headline */}
      {impact && (
        <button
          className="glass living-ring rise block w-full p-4 text-left"
          onClick={() => askIla(`Explain what the ${form.customer || "this"} deal pays me — walk the math against my plan (the month with it minus without it, spiffs included). If it looks off, find which input is wrong.`)}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent2">
            <Sparkles size={13} /> {impact.landed ? "What this deal pays you" : "If this one lands"}
          </div>
          {/* No Math.max(0, …) — a $0/negative number is the truth, and hiding
              it is how the Rodney Stegall mini deal read as "pays nothing". */}
          <CountUp value={impact.delta} format={money} className="mt-1 block text-3xl font-black" />
          <div className="mt-1 text-xs text-fg/70">
            {impact.mini ? "mini deal — pays your plan's minimum · " : ""}
            {impact.spiff > 0 ? `includes ${money(impact.spiff)} in product spiffs · ` : ""}
            {impact.landed ? "counted in this month's check" : `${Math.round(impact.odds * 100)}% likely at this stage`}
          </div>
        </button>
      )}

      {mode === "recap" ? (
        <>
          {/* THE RECAP — the month-end report's little sibling, one deal */}
          <div className={clsx("grid gap-3", spec.secondaryLabel ? "grid-cols-3" : "grid-cols-1")}>
            <RecapStat label={spec.secondaryLabel ? "Front" : spec.amountLabel} value={form.amount} delayMs={60} />
            {spec.secondaryLabel && <RecapStat label="Back (F&I)" value={form.secondary} strong delayMs={110} />}
            {spec.hasReserve && <RecapStat label="Reserve" value={form.reserve} delayMs={160} />}
          </div>

          {fni && (
            <div className="glass rise p-4" style={{ animationDelay: "180ms" }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/65">Products sold{(form.products?.length ?? 0) > 0 ? ` · ${dealUnits(form, defs)} units` : ""}</div>
              {(form.products?.length ?? 0) > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {(form.products ?? []).map((id, i) => {
                    const p = defs.find((x) => x.id === id);
                    if (!p) return null;
                    return (
                      <span key={id} className="rise rounded-xl bg-good/15 px-3 py-2 text-sm font-semibold text-good" style={{ animationDelay: `${220 + i * 45}ms` }}>
                        {p.label}{p.spiff > 0 ? ` · $${p.spiff}` : ""}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 text-sm text-fg/65">None on this one{form.status !== "delivered" ? " yet" : ""}.</div>
              )}
            </div>
          )}

          <div className="glass rise divide-y divide-fg/5 p-1" style={{ animationDelay: "240ms" }}>
            <RecapRow label="Status">
              <span className={clsx("rounded-full px-2.5 py-1 text-[11px] font-bold", form.status === "delivered" ? "bg-good/15 text-good" : form.status === "dead" ? "bg-warn/15 text-warn" : "bg-accent/15 text-accent")}>
                {statusLabel(industry, form.status, STATUS_LABEL[form.status])}
              </span>
            </RecapRow>
            {fni && (form.bank || form.funded === false) && (
              <RecapRow label="Bank" icon={<Landmark size={13} />}>
                {form.bank || "—"}{form.funded === false ? <span className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-bold text-warn">WAITING ON FUNDING</span> : ""}
              </RecapRow>
            )}
            {fni && (form.salesperson || form.salesperson2) && (
              <RecapRow label="Salesperson" icon={<Users size={13} />}>
                {[form.salesperson, form.salesperson2].filter(Boolean).join(" / ")}{form.salesperson2 ? " (50/50)" : ""}
              </RecapRow>
            )}
            {form.noQualify && (
              <RecapRow label="F&I credit"><span className="text-warn">Doesn&apos;t qualify — unit counts, $0 credit</span></RecapRow>
            )}
            {form.phone && (
              <RecapRow label="Phone">
                <span className="flex items-center gap-2 tabnum">{form.phone}
                  <a href={`tel:${form.phone.replace(/[^0-9+]/g, "")}`} className="grid h-7 w-7 place-items-center rounded-lg bg-good/15 text-good active:scale-95" aria-label="Call"><Phone size={13} /></a>
                </span>
              </RecapRow>
            )}
            {form.followUpAt && (
              <RecapRow label="Next reminder"><span className="tabnum">{new Date(form.followUpAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></RecapRow>
            )}
            {form.note && <RecapRow label="Note"><span className="text-fg/70">{form.note}</span></RecapRow>}
          </div>

          <div className="rise flex gap-2" style={{ animationDelay: "300ms" }}>
            <button className="btn btn-primary !flex-[2]" onClick={() => { setForm({ ...deal }); editBaseline.current = { ...deal }; setMode("edit"); }}>
              <PencilLine size={15} /> Edit deal
            </button>
            <button className="btn btn-ghost !flex-1" onClick={() => askIla(`Give me the report card on my deal for ${form.customer || "this customer"} (${form.item || spec.itemLabel}, ${statusLabel(industry, form.status, STATUS_LABEL[form.status])}). What happened, what does it pay, and what should I remember?`)}>
              <Sparkles size={15} /> Ask EILA
            </button>
          </div>
        </>
      ) : (
      <>
      {/* status — tap to move it */}
      <Labeled label="Status">
        <div className="flex flex-wrap gap-2">
          {FLOW.map((s) => (
            <button key={s} onClick={() => patch({ status: s })}
              className={clsx("rounded-xl px-3 py-2 text-[13px] font-semibold transition active:scale-95",
                form.status === s ? (s === "dead" ? "bg-warn text-white" : "bg-accent text-white") : "bg-fg/6 text-fg/60")}>
              {statusLabel(industry, s, STATUS_LABEL[s])}
            </button>
          ))}
        </div>
      </Labeled>

      {/* the money */}
      <div className={clsx("grid gap-3", spec.secondaryLabel ? "grid-cols-2" : "grid-cols-1")}>
        <Labeled label={spec.amountLabel}>
          <input className="field tabnum" inputMode="numeric" value={String(form.amount)} onChange={(e) => patch({ amount: num(e.target.value) })} />
        </Labeled>
        {spec.secondaryLabel && (
          <Labeled label={spec.secondaryLabel}>
            <input className="field tabnum" inputMode="numeric" value={String(form.secondary)} onChange={(e) => patch({ secondary: num(e.target.value) })} />
          </Labeled>
        )}
      </div>

      {/* products — add what you sold, any time */}
      {fni && (
        <Labeled label={`Products sold${(form.products?.length ?? 0) > 0 ? ` · ${dealUnits(form, defs)} units` : ""}`}>
          <div className="flex flex-wrap gap-2">
            {defs.map((p) => {
              const on = (form.products ?? []).includes(p.id);
              return (
                <button key={p.id} onClick={() => toggleProduct(p.id)}
                  className={clsx("rounded-xl px-3.5 py-2.5 text-sm font-semibold transition active:scale-95",
                    on ? "bg-good/90 text-white" : "bg-fg/6 text-fg/70")}>
                  {p.label}{p.units !== 1 ? ` (${p.units}u)` : ""}
                </button>
              );
            })}
          </div>
        </Labeled>
      )}

      {fni && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Reserve">
              <input className="field tabnum" inputMode="numeric" value={String(form.reserve)} onChange={(e) => patch({ reserve: num(e.target.value) })} />
            </Labeled>
            <Labeled label="Deal #">
              <input className="field tabnum" value={form.dealNumber ?? ""} onChange={(e) => patch({ dealNumber: e.target.value })} placeholder="1234" />
            </Labeled>
            <Labeled label="Bank / lender">
              <input className="field" value={form.bank ?? ""} onChange={(e) => patch({ bank: e.target.value })} placeholder="Cash, credit union…" />
            </Labeled>
            <Labeled label="Funding">
              <div className="flex gap-2">
                {([["yes", "Funded"], ["no", "Waiting"]] as const).map(([v, l]) => (
                  <button key={v} onClick={() => patch({ funded: v === "yes" })}
                    className={clsx("flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-95",
                      (form.funded !== false) === (v === "yes") ? "bg-accent text-white" : "bg-fg/6 text-fg/60")}>
                    {l}
                  </button>
                ))}
              </div>
            </Labeled>
            <Labeled label="Salesperson">
              <input className="field" value={form.salesperson ?? ""} onChange={(e) => patch({ salesperson: e.target.value })} placeholder="Who sold it" />
            </Labeled>
            <Labeled label="Split with (50/50)">
              <input className="field" value={form.salesperson2 ?? ""} onChange={(e) => patch({ salesperson2: e.target.value })} placeholder="Optional" />
            </Labeled>
          </div>
          <button type="button" onClick={() => patch({ noQualify: !form.noQualify || undefined })}
            className={clsx("flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition active:scale-[0.99]",
              form.noQualify ? "bg-warn/15 text-warn" : "bg-fg/6 text-fg/60")}>
            <span>Doesn&apos;t qualify (unit counts, $0 F&amp;I credit)</span>
            <span className="tabnum">{form.noQualify ? "ON" : "off"}</span>
          </button>
          <button type="button" onClick={() => patch({ productOnly: !form.productOnly || undefined })}
            className={clsx("flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition active:scale-[0.99]",
              form.productOnly ? "bg-warn/15 text-warn" : "bg-fg/6 text-fg/60")}>
            <span>Product only (no vehicle — counts toward PVR/PPU, not a unit)</span>
            <span className="tabnum">{form.productOnly ? "ON" : "off"}</span>
          </button>
        </>
      )}

      {/* contact + reminder + note */}
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Phone">
          <div className="flex gap-2">
            <input className="field tabnum" type="tel" inputMode="tel" value={form.phone ?? ""} onChange={(e) => patch({ phone: e.target.value })} placeholder="(555) 555-5555" />
            {form.phone && (
              <a href={`tel:${form.phone.replace(/[^0-9+]/g, "")}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-good/15 text-good active:scale-95" aria-label="Call">
                <Phone size={17} />
              </a>
            )}
          </div>
        </Labeled>
        <Labeled label="Next reminder">
          <input className="field tabnum" type="date" value={form.followUpAt ? form.followUpAt.slice(0, 10) : ""}
            onChange={(e) => patch({ followUpAt: e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : undefined })} />
        </Labeled>
      </div>
      <Labeled label="Note">
        <textarea className="field min-h-[70px]" value={form.note ?? ""} onChange={(e) => patch({ note: e.target.value })} placeholder="Anything worth remembering" />
      </Labeled>

      <div className="flex gap-2">
        <button className="btn btn-primary !flex-[2]" onClick={() => { save(); setMode("recap"); }}>
          {saved ? <><Check size={16} /> Saved</> : "Save changes"}
        </button>
        <button className="btn btn-ghost !flex-1" onClick={() => { setForm({ ...deal }); setMode("recap"); }}>
          Cancel
        </button>
      </div>

      {!confirmDelete ? (
        <button className="btn btn-ghost btn-block !text-fg/65" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={15} /> Delete this deal
        </button>
      ) : (
        <div className="glass p-4 text-center">
          <div className="text-sm text-fg/80">Delete {form.customer || "this deal"} for good?</div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-ghost !flex-1" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="btn !flex-1 !bg-[rgb(127_95_80)] !text-white" onClick={() => { removeDeal(id); router.push("/pipeline"); }}>Delete</button>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

function RecapStat({ label, value, strong, delayMs = 0 }: { label: string; value: number; strong?: boolean; delayMs?: number }) {
  return (
    <div className={clsx("glass rise p-3 text-center", strong && "living-ring")} style={{ animationDelay: `${delayMs}ms` }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/65">{label}</div>
      <CountUp value={value} format={money} className={clsx("mt-0.5 block font-black", strong ? "text-xl text-good" : "text-lg")} />
    </div>
  );
}

function RecapRow({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65">{icon}{label}</span>
      <span className="text-right text-sm font-medium">{children}</span>
    </div>
  );
}
