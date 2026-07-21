import { type Deal, type StoreSettings } from "@/lib/data";

// ── Deal Jacket ──────────────────────────────────────────────────────────────
// The physical deal file ("jacket") the office keys and the bank funds. Every
// store staples its paperwork in ONE required order; a deal that shows up out
// of order or missing a doc bounces between F&I and the office. This module is
// the single brain for that order: the screen checklist, the printable cover
// sheet, and EILA's deal_jacket tool all read it (one brain, no divergence).
//
// Data model (no schema changes — rides the existing JSONB rows):
// - The ORDER lives on storeSettings.dealJacketOrder (per-store override);
//   absent/empty = DEFAULT_JACKET_ORDER below.
// - Per-deal progress lives on deal.jacketDocs: { [docName]: "have" | "na" }.
//   A doc absent from the map is simply missing. Keyed by the doc NAME so a
//   reordered store list never orphans progress.

export type JacketDocState = "missing" | "have" | "na";

// Aaron's REAL Kennesaw Mazda F&I checklist (photographed cover sheet, July
// 2026) — transcribed section by section. Docs marked "if applicable" /
// new-vs-used are still listed; the F&I manager taps N/A on the ones a given
// deal doesn't need, and the print sheet shows the same N/A column.
export type JacketSection = { name: string; docs: string[] };

export const DEFAULT_JACKET_SECTIONS: JacketSection[] = [
  {
    name: "Deal Pack",
    docs: [
      "RDR — New Car",
      "Recap",
      "Cash Back Form",
      "OFAC / Red Flag",
      "1st Pencil — signed",
      "Risk Based Pricing — signed",
      "Arbitration Agreement",
      "Privacy Act",
      "Lemon Law — New Car — signed",
      "Used Car Buyers Guide",
      "Dealer Participation",
      "We Owe",
      "CarFax — Used",
      "Agreement to Provide Insurance",
      "Insurance Verification Form",
      "Out of State Tax Disclaimer",
      "Military Tax Free — 100% Disabled",
      "Menu — signed",
      "Products — signed",
    ],
  },
  {
    name: "Bank Pack",
    docs: [
      "Approval",
      "Credit App — signed",
      "Contract",
      "Invoice — New",
      "NADA — Used",
      "Stips",
    ],
  },
  {
    name: "Tag & Title — Purchased Vehicle",
    docs: [
      "Drivers License — each owner",
      "Title App MV-1 — 2 copies",
      "MV7D — Taxes",
      "Bill of Sale",
      "White Power of Attorney — 2 copies",
      "Odometer Statement — signed",
      "Copy of TOP",
      "Red Reassignment",
      "Copy of Insurance Card",
      "Copy of Registration",
      "MV-34 Change of Address — if applicable",
      "Pictures of VIN and Mileage",
    ],
  },
  {
    name: "Delivery",
    docs: [
      "Copy & Amount of Money Down",
      "Customer Delivery Checklist",
    ],
  },
  {
    name: "Trade Pack",
    docs: [
      "Drivers License — all parties on trade title",
      "Signed Title — by owner",
      "Gift Letter — if vehicle not in buyer's name",
      "$75 Duplicate Title Fee — if no title",
      "Payoff Verification",
      "2 White POAs — signed",
      "1 Green SPOA — signed",
      "Gratis",
      "Trade Odometer Statement — signed",
      "Trade Pictures of VIN and Mileage",
      "Affidavit of Correction — T-11",
      "Proof of Name Change",
    ],
  },
];

export const DEFAULT_JACKET_ORDER: string[] = DEFAULT_JACKET_SECTIONS.flatMap((s) => s.docs);

/** Group an order into display sections. The house default groups into the
 * real cover-sheet sections; a custom per-store order (a flat list from the
 * editor) renders as one unnamed section. */
export function jacketSections(order: string[]): JacketSection[] {
  if (order === DEFAULT_JACKET_ORDER || JSON.stringify(order) === JSON.stringify(DEFAULT_JACKET_ORDER)) {
    return DEFAULT_JACKET_SECTIONS;
  }
  return [{ name: "", docs: order }];
}

/** The store's required document order — the per-store override when one is
 * saved, else the house default. Never returns an empty list. */
export function jacketOrderFor(settings?: Pick<StoreSettings, "dealJacketOrder"> | null): string[] {
  const custom = settings?.dealJacketOrder;
  if (Array.isArray(custom)) {
    const cleaned = custom.map((d) => (typeof d === "string" ? d.trim() : "")).filter(Boolean);
    if (cleaned.length) return cleaned;
  }
  return DEFAULT_JACKET_ORDER;
}

/** Parse the editor textarea (one document per line) into a clean order:
 * trimmed, no empties, no duplicates (first occurrence wins). */
export function normalizeJacketOrder(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function jacketDocState(deal: Pick<Deal, "jacketDocs">, doc: string): JacketDocState {
  return deal.jacketDocs?.[doc] ?? "missing";
}

/** Tap-to-cycle: missing → have → N/A → missing. */
export function cycleJacketState(state: JacketDocState): JacketDocState {
  return state === "missing" ? "have" : state === "have" ? "na" : "missing";
}

/** Apply one doc's new state to the deal's jacketDocs map. "missing" removes
 * the key so untouched deals stay lean in the store. */
export function withJacketDoc(
  deal: Pick<Deal, "jacketDocs">,
  doc: string,
  state: JacketDocState
): Record<string, "have" | "na"> {
  const next: Record<string, "have" | "na"> = { ...(deal.jacketDocs ?? {}) };
  if (state === "missing") delete next[doc];
  else next[doc] = state;
  return next;
}

export type JacketStatus = {
  items: { doc: string; state: JacketDocState; position: number }[];
  have: number;
  na: number;
  missing: string[];
  /** docs that still need collecting = order minus have minus N/A */
  total: number;
  /** docs that count toward done (total minus N/A) */
  required: number;
  complete: boolean;
};

/** The whole jacket, in the store's order, with progress. */
export function jacketStatus(deal: Pick<Deal, "jacketDocs">, order: string[]): JacketStatus {
  const items = order.map((doc, i) => ({ doc, state: jacketDocState(deal, doc), position: i + 1 }));
  const have = items.filter((x) => x.state === "have").length;
  const na = items.filter((x) => x.state === "na").length;
  const missing = items.filter((x) => x.state === "missing").map((x) => x.doc);
  const required = order.length - na;
  return { items, have, na, missing, total: order.length, required, complete: missing.length === 0 };
}

/** One-line summary — what EILA says and what the row badge shows. */
export function jacketSummaryLine(deal: Pick<Deal, "jacketDocs">, order: string[]): string {
  const s = jacketStatus(deal, order);
  if (s.complete) return `Jacket complete — ${s.have} of ${s.required} docs in order${s.na ? ` (${s.na} N/A)` : ""}.`;
  const head = s.missing.slice(0, 4).join(", ");
  const more = s.missing.length > 4 ? ` +${s.missing.length - 4} more` : "";
  return `${s.have} of ${s.required} docs in the jacket — missing: ${head}${more}.`;
}
