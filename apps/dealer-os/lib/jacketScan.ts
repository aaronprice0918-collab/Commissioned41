// ── Scan and Sort — the deal-jacket page sorter ─────────────────────────────
// The F&I manager scans the signed deal stack in ANY order and drops the PDF on
// EILA. She labels every page against the store's jacket order (the API route
// does the reading); THIS module is the deterministic brain that turns those
// per-page labels into the final page sequence. Pure functions — unit-tested,
// no PDF or network code here.

export type PageLabel = { page: number; doc: string };

/** Snap a model-returned label onto the store's order (case-insensitive exact,
 * then contains either way). Anything that doesn't match is "Unknown". */
export function matchDocLabel(label: string, order: string[]): string {
  const raw = String(label || "").trim();
  if (!raw) return "Unknown";
  // Apostrophes vanish (Buyer's ≡ Buyers) before everything else collapses to spaces.
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
  /** Docs from the store order that showed up in the scan. */
  found: string[];
  /** Pages EILA couldn't place — kept at the end, never dropped. */
  unknownPages: number[];
};

/** Turn per-page labels into the sorted page sequence: pages grouped by doc,
 * groups in the STORE's order, pages inside a group in scan order, and every
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
