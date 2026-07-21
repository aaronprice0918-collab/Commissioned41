"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Printer, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMission } from "@/lib/store";
import { Paywall, useEntitled } from "@/components/Paywall";
import { calculatePay, localMonthKey, money, perfFromDeals } from "@/lib/engine";
import { INDUSTRY_LABEL, INDUSTRY_UNIT, STATUS_LABEL } from "@/lib/types";
import { INDUSTRY_DEAL, statusLabel } from "@/lib/industry";
import { basisGrossLabel, dealMoneyOf, dealUnits, moneyBasis, penetration, productDefs, round1, salespersonReport, spiffTotal, usesProductMenu } from "@/lib/fni";

// The month-end report — THE LOGG's closing ritual, one tap. Ties the deal
// log to the paycheck to the penny, in a layout built to be PRINTED or saved
// as a PDF and handed to payroll. Deliberately light-on-dark-free: paper is
// white, so this page is too.

export default function ReportPage() {
  return (
    <Suspense>
      <Report />
    </Suspense>
  );
}

function Report() {
  const { data, ready, account } = useMission();
  const router = useRouter();
  const params = useSearchParams();
  // /report renders OUTSIDE AppShell (white print layout), so it needs its own
  // entitlement wall — it was the one page the July 5 deep-link fix missed.
  const entitled = useEntitled(account);

  useEffect(() => {
    if (ready && !data.profile) router.replace("/");
  }, [ready, data.profile, router]);

  const monthKey = useMemo(() => {
    const m = params.get("month");
    if (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return m;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, [params]);

  const model = useMemo(() => {
    if (!data.profile) return null;
    const profile = data.profile;
    const plan = profile.plan;
    const defs = productDefs(profile);
    const fni = usesProductMenu(profile.industry);
    const spec = INDUSTRY_DEAL[profile.industry];
    const unit = INDUSTRY_UNIT[profile.industry];

    // LOCAL month, same rule as the dashboard/pipeline (isThisMonth) — the
    // payroll report and the live app must never disagree about which month
    // an evening boundary deal belongs to (July 8 audit, HIGH).
    const monthDeals = data.deals.filter((d) => localMonthKey(d.date) === monthKey && d.status !== "dead");
    const delivered = monthDeals.filter((d) => d.status === "delivered");
    const pay = calculatePay(plan, perfFromDeals(delivered));
    const spiffs = fni ? spiffTotal(delivered, defs) : 0;

    const units = delivered.length;
    const primary = delivered.reduce((s, d) => s + d.amount, 0);
    const secondaryT = delivered.reduce((s, d) => s + d.secondary, 0);
    // Headline money follows the channel the USER'S plan pays on — back
    // gross for an F&I grid, front for a front-paid rep, else the whole deal.
    const basis = moneyBasis(profile);
    const gross = delivered.reduce((s, d) => s + dealMoneyOf(basis)(d), 0);
    const productUnits = fni ? delivered.reduce((s, d) => s + dealUnits(d, defs), 0)
      : delivered.reduce((s, d) => s + (d.addons || 0), 0);

    return {
      profile, plan, defs, fni, spec, unit, basis,
      monthDeals, delivered, pay, spiffs,
      units, gross, primary, secondary: secondaryT, productUnits,
      perUnit: units ? gross / units : 0,
      ppu: units ? productUnits / units : 0,
      pen: fni ? penetration(delivered, defs) : [],
      reps: fni ? salespersonReport(delivered, defs).filter((r) => r.retail > 0) : [],
      monthName: new Date(`${monthKey}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  }, [data, monthKey]);

  if (account && entitled === false) {
    return (
      <div className="mx-auto min-h-[100dvh] w-full max-w-app px-4 pt-5">
        <Paywall />
      </div>
    );
  }
  if (!ready || !data.profile || !model) {
    return <div className="grid min-h-[100dvh] place-items-center"><div className="h-10 w-10 animate-pulse rounded-full bg-accent/30" /></div>;
  }

  const m = model;
  const totalPay = m.pay.grossPay + m.spiffs;

  return (
    <div className="min-h-[100dvh] bg-white text-slate-900">
      {/* screen-only toolbar */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 print:hidden">
        <Link href="/stats" className="flex items-center gap-1.5 text-sm font-semibold text-slate-500"><ArrowLeft size={16} /> Back</Link>
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white active:scale-95">
          <Printer size={15} /> Print / Save PDF
        </button>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8 print:px-2 print:py-2">
        <header className="border-b-2 border-slate-900 pb-4">
          <h1 className="text-2xl font-black tracking-tight">{m.monthName} — Month-End Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            {m.profile.name} · {INDUSTRY_LABEL[m.profile.industry]} · generated by EILA{m.pay.confidence < 0.75 ? " · estimate" : ""}
          </p>
        </header>

        {/* headline strip */}
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Head label={m.basis === "back" ? "Deal touches" : cap(m.unit.plural)} value={String(m.units)} />
          <Head label={basisGrossLabel(m.basis, m.profile.industry)} value={money(m.gross)} />
          <Head label={m.fni ? "PVR" : `Per ${m.unit.singular}`} value={money(m.perUnit)} />
          <Head label={m.fni ? "PPU" : "Add-ons / deal"} value={m.ppu.toFixed(2)} />
        </section>

        {/* pay breakdown — the receipt */}
        <Section title="Pay breakdown">
          <table className="w-full text-sm">
            <tbody>
              {m.pay.steps.map((s, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 text-slate-600">{s.label}</td>
                  <td className="py-1.5 text-right font-semibold tabnum">{s.detail}</td>
                </tr>
              ))}
              {m.spiffs > 0 && (
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 text-slate-600">Product spiffs</td>
                  <td className="py-1.5 text-right font-semibold tabnum">+{money(m.spiffs)}</td>
                </tr>
              )}
              <tr>
                <td className="py-2 pr-3 font-black">Total gross pay{m.spiffs > 0 ? " + spiffs" : ""}</td>
                <td className="py-2 text-right text-lg font-black tabnum">{money(totalPay)}</td>
              </tr>
              {m.pay.draw > 0 && (
                <tr className="border-t border-slate-200">
                  <td className="py-1.5 pr-3 text-slate-600">Draw already advanced</td>
                  <td className="py-1.5 text-right font-semibold tabnum">−{money(m.pay.drawOffset)}</td>
                </tr>
              )}
              {m.pay.draw > 0 && (
                <tr>
                  <td className="py-1.5 pr-3 font-bold">Remaining check</td>
                  <td className="py-1.5 text-right font-bold tabnum">{money(m.pay.remainderAfterDraw + m.spiffs)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Section>

        {/* product penetration */}
        {m.fni && m.units > 0 && (
          <Section title="Product penetration">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {m.pen.map(({ def, count, pct }) => (
                <div key={def.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{def.label}</div>
                  <div className="mt-0.5 text-xl font-black tabnum">{Math.round(pct * 100)}%</div>
                  <div className="text-xs text-slate-400 tabnum">{round1(count)} sold</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {round1(m.productUnits)} product units on {m.units} {m.units === 1 ? m.unit.singular : m.unit.plural}.
            </p>
          </Section>
        )}

        {/* salesperson product report */}
        {m.fni && m.reps.length > 0 && (
          <Section title="Salesperson product report">
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3">Salesperson</th>
                    <th className="py-1.5 pr-3 text-right">Units</th>
                    <th className="py-1.5 pr-3 text-right">Prod units</th>
                    <th className="py-1.5 pr-3 text-right">Per unit</th>
                    <th className="py-1.5 text-right">F&I gross</th>
                  </tr>
                </thead>
                <tbody>
                  {m.reps.map((r) => (
                    <tr key={r.name} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-semibold">{r.name}</td>
                      <td className="py-1.5 pr-3 text-right tabnum">{round1(r.retail)}</td>
                      <td className="py-1.5 pr-3 text-right tabnum">{round1(r.productUnits)}</td>
                      <td className="py-1.5 pr-3 text-right tabnum">{r.perUnit.toFixed(2)}</td>
                      <td className="py-1.5 text-right font-semibold tabnum">{money(r.fniGross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">Split deals credited 50/50. No-qualify deals keep the unit, carry $0 F&I credit.</p>
          </Section>
        )}

        {/* the deal log */}
        <Section title={`Deal log — ${m.delivered.length} closed`}>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b-2 border-slate-300 text-left uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-3">Date</th>
                  {m.fni && <th className="py-1.5 pr-3">Deal #</th>}
                  <th className="py-1.5 pr-3">Customer</th>
                  <th className="py-1.5 pr-3">{m.spec.itemLabel}</th>
                  {m.fni && <th className="py-1.5 pr-3">Salesperson</th>}
                  {m.fni && <th className="py-1.5 pr-3">Bank</th>}
                  <th className="py-1.5 pr-3 text-right">{m.spec.amountLabel}</th>
                  {m.spec.secondaryLabel && <th className="py-1.5 pr-3 text-right">{m.spec.secondaryLabel}</th>}
                  {m.fni && <th className="py-1.5 text-right">Products</th>}
                </tr>
              </thead>
              <tbody>
                {m.delivered.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 tabnum">{new Date(d.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</td>
                    {m.fni && <td className="py-1.5 pr-3 tabnum">{d.dealNumber || "—"}</td>}
                    <td className="py-1.5 pr-3 font-medium">{d.customer || "—"}</td>
                    <td className="py-1.5 pr-3">{d.item || "—"}</td>
                    {m.fni && <td className="py-1.5 pr-3">{[d.salesperson, d.salesperson2].filter(Boolean).join(" / ") || "—"}</td>}
                    {m.fni && <td className="py-1.5 pr-3">{d.bank || "—"}{d.funded === false ? " ⏳" : ""}</td>}
                    <td className="py-1.5 pr-3 text-right tabnum">{money(d.amount)}</td>
                    {m.spec.secondaryLabel && <td className="py-1.5 pr-3 text-right tabnum">{money(d.secondary)}</td>}
                    {m.fni && (
                      <td className="py-1.5 text-right">
                        {(d.products ?? []).map((id) => m.defs.find((x) => x.id === id)?.label.slice(0, 4)).filter(Boolean).join(", ") || (d.addons ? `${d.addons}u` : "—")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.monthDeals.length > m.delivered.length && (
            <p className="mt-2 text-xs text-slate-400">
              {m.monthDeals.length - m.delivered.length} more still working (not counted until {statusLabel(m.profile.industry, "delivered", STATUS_LABEL.delivered).toLowerCase()}).
            </p>
          )}
        </Section>

        <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400 print:mt-4">
          Generated by EILA · lite.commissioned41.com · numbers tie to the deal log above
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 break-inside-avoid">
      <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Head({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-100 p-3 text-center">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-black tabnum">{value}</div>
    </div>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
