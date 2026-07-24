// EILA's self-audit — she checks her OWN numbers instead of waiting to be told
// they're wrong.
//
// Aaron, July 2026: "EILA needs to be smart enough to figure this out without me
// having to come to you all the time." The 41-vs-36 saga was a data problem the
// app could SEE but never mentioned: three house deals and two product-only deals
// were logged as ordinary retail cars, so every per-car number (units, PVR, VSC%)
// divided by 41 instead of 36 and both grid kickers stayed dark. Nothing was
// broken — nobody had told the app those five weren't retail units.
//
// So EILA looks for deals whose SHAPE contradicts how they're being counted, and
// offers the one-tap fix. Every finding is conservative on purpose: it only fires
// on unambiguous evidence, it never guesses at money, and applying it flips a
// classification flag (noQualify / productOnly) — never an amount. A wrong nag is
// cheap; a wrong auto-edit to someone's pay record is not.
//
// ONE brain: the Home card and EILA's `audit_numbers` tool both call auditDeals(),
// so what she says and what the screen shows can never disagree.
import type { Deal, ProductDef, Profile } from "./types";
import { isProductOnly } from "./productOnly";
import { productDefs, resolveVscId } from "./fni";
import { isThisMonth } from "./engine";

export type AuditFixKind = "markNoQualify" | "markProductOnly";

export interface AuditFinding {
  dealId: string;
  customer: string;
  kind: AuditFixKind;
  // Plain-language, fifth-grader clear: what's wrong and what it costs them.
  reason: string;
}

export interface AuditResult {
  findings: AuditFinding[];
  // A menu problem, not a deal problem — no per-deal fix, so it's reported alone.
  vscMenuWarning?: string;
  // What the count becomes if every finding is applied (so the card can say
  // "41 → 36" instead of an abstract "5 issues").
  unitsNow: number;
  unitsAfter: number;
}

// A delivered deal with NO F&I credit and NO products is a house/DNQ deal: the
// salesperson keeps the unit, the finance manager gets $0 and it must leave the
// PVR denominator. Requiring BOTH signals (no back gross AND no products) keeps a
// legitimately-flat deal that still sold a product out of this.
function looksNoQualify(d: Deal): boolean {
  return !d.noQualify && !isProductOnly(d) && d.secondary === 0 && (d.products?.length ?? 0) === 0 && d.reserve === 0;
}

// Back-end money with NO vehicle line is a product-only sale (a walk-in buys a
// VSC). Its gross still lifts PVR — it just isn't a car. We require an explicit
// textual signal, because in this neutral model an F&I user's ordinary deal also
// has amount 0 (they log back gross only), so `amount === 0` alone means nothing.
function looksProductOnly(d: Deal): boolean {
  if (d.productOnly || d.noQualify) return false;
  if (d.secondary <= 0) return false;
  const text = `${d.item ?? ""} ${d.note ?? ""}`;
  return /product\s*only|no\s*(vehicle|car|unit)|parts\s*only|accessor(y|ies)\s*only/i.test(text);
}

function retailUnitCount(deals: Deal[]): number {
  return deals.filter((d) => !d.noQualify && !isProductOnly(d)).length;
}

// Audit THIS month's delivered deals — the ones driving the numbers on screen.
export function auditDeals(deals: Deal[], profile: Profile | null, now = new Date()): AuditResult {
  const delivered = deals.filter((d) => d.status === "delivered" && isThisMonth(d.date, now) && !d.demo);
  const findings: AuditFinding[] = [];

  for (const d of delivered) {
    const who = d.customer?.trim() || "this deal";
    if (looksNoQualify(d)) {
      findings.push({
        dealId: d.id,
        customer: who,
        kind: "markNoQualify",
        reason: `${who} shows $0 F&I and no products — that's a house deal. Right now it still counts as one of your cars, which drags your per-car average (PVR) down.`,
      });
    } else if (looksProductOnly(d)) {
      findings.push({
        dealId: d.id,
        customer: who,
        kind: "markProductOnly",
        reason: `${who} has back-end money but no vehicle — that's a product-only sale. The money should count toward PVR, but it shouldn't count as a car.`,
      });
    }
  }

  // The custom-menu VSC trap (July 24): a menu with no resolvable VSC product
  // means every VSC number reads 0% and the 50% kicker can never fire.
  const defs: ProductDef[] = productDefs(profile);
  const vscMenuWarning =
    defs.length > 0 && !resolveVscId(defs)
      ? "I can't find a VSC (service contract) in your product menu, so your VSC penetration reads 0% and the VSC bonus can't fire. Open Settings → products and name it so I can track it."
      : undefined;

  const unitsNow = retailUnitCount(delivered);
  const fixedIds = new Set(findings.map((f) => f.dealId));
  const unitsAfter = retailUnitCount(delivered.filter((d) => !fixedIds.has(d.id)));

  return { findings, vscMenuWarning, unitsNow, unitsAfter };
}

// The patch a finding applies — the ONLY thing a fix is ever allowed to change.
// Marking a deal no-qualify also zeroes its F&I credit, matching how the LOGG
// importer records a DNQ (secondary: 0) so the pay math stays identical either way.
export function patchForFinding(kind: AuditFixKind): Partial<Deal> {
  return kind === "markNoQualify" ? { noQualify: true, secondary: 0 } : { productOnly: true };
}

// One plain-language summary EILA can speak and the card can show — same words,
// same source, so she and the screen never tell different stories.
export function auditSummary(r: AuditResult, unitLabel = "cars"): string {
  if (!r.findings.length) {
    return r.vscMenuWarning ?? `Your numbers check out — all ${r.unitsNow} ${unitLabel} this month look like real retail units.`;
  }
  const n = r.findings.length;
  return `${n} deal${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} being counted as ${n === 1 ? "a car" : "cars"} but ${n === 1 ? "doesn't" : "don't"} look like ${n === 1 ? "one" : "any"}. Fixing ${n === 1 ? "it" : "them"} moves your count from ${r.unitsNow} to ${r.unitsAfter} ${unitLabel} and lifts your per-car average.`;
}
