// ── Scan and Sort — the deal-jacket page sorter (F&I) ───────────────────────
// A finance manager scans the signed deal stack in ANY order and drops the PDF
// on EILA. The /api/scan-jacket route labels every page against the USER'S own
// jacket order (their store's required document sequence, editable in the
// Jacket screen); this module is the deterministic brain that turns those
// labels into the final page sequence. Pure functions — unit-tested, no PDF or
// network code here. Mirrors the Dealer Mission OS implementation so the two
// products sort a jacket identically.

import type { Profile } from "./types";

export type PageLabel = { page: number; doc: string };

export const DEFAULT_JACKET_ORDER: string[] = [
  "Deal Recap / Washout Sheet",
  "Buyer's Order",
  "Retail Installment Contract",
  "Credit Application",
  "Privacy Notice",
  "OFAC / ID Verification",
  "Odometer Disclosure",
  "Title Application",
  "Tag / Registration",
  "Proof of Insurance",
  "Trade Title / Payoff Authorization",
  "GAP Waiver",
  "Service Contract (VSC)",
  "Product Contracts (Maint / PermaPlate / TWS)",
  "We-Owe / Due Bill",
  "Stips (Proof of Income / Residence)",
];

/** The user's required document order — their saved list, else the house
 * default. Never returns an empty list. */
export function jacketOrderFor(profile?: Pick<Profile, "jacketOrder"> | null): string[] {
  const custom = profile?.jacketOrder;
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

/** Snap a model-returned label onto the order (case-insensitive exact, then
 * contains either way; apostrophes ignored). No match = "Unknown". */
export function matchDocLabel(label: string, order: string[]): string {
  const raw = String(label || "").trim();
  if (!raw) return "Unknown";
  const norm = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const n = norm(raw);
  if (!n || n === "unknown") return "Unknown";
  for (const doc of order) if (norm(doc) === n) return doc;
  for (const doc of order) {
    const d = norm(doc);
    if (d.includes(n) || n.includes(d)) return doc;
  }
  return "Unknown";
}

export type ScanSortPlan = {
  /** Original page indexes in the order they should appear in the sorted PDF. */
  sequence: number[];
  /** Page groups in final order — Unknown group (if any) rides at the back. */
  groups: { doc: string; pages: number[] }[];
  /** Docs from the order that showed up in the scan. */
  found: string[];
  /** Pages EILA couldn't place — kept at the end, never dropped. */
  unknownPages: number[];
};

/** Turn per-page labels into the sorted page sequence: pages grouped by doc,
 * groups in the USER's order, pages inside a group in scan order, and every
 * unplaced page kept at the back (a page must never vanish from a deal file). */
export function orderScannedPages(labels: PageLabel[], order: string[]): ScanSortPlan {
  const byDoc = new Map<string, number[]>();
  const unknownPages: number[] = [];
  const sorted = [...labels].sort((a, b) => a.page - b.page);
  for (const { page, doc } of sorted) {
    const matched = matchDocLabel(doc, order);
    if (matched === "Unknown") {
      unknownPages.push(page);
      continue;
    }
    const list = byDoc.get(matched) ?? [];
    list.push(page);
    byDoc.set(matched, list);
  }

  const groups: { doc: string; pages: number[] }[] = [];
  for (const doc of order) {
    const pages = byDoc.get(doc);
    if (pages?.length) groups.push({ doc, pages });
  }
  if (unknownPages.length) groups.push({ doc: "Unknown", pages: unknownPages });

  return {
    sequence: groups.flatMap((g) => g.pages),
    groups,
    found: groups.map((g) => g.doc).filter((d) => d !== "Unknown"),
    unknownPages,
  };
}
