// Pure data migrations run on every load (local + cloud pull). Kept out of
// store.tsx so they're testable without a React/JSX toolchain.

import type { AppData, Deal } from "./types";

// Migrate deals saved before the industry-neutral model: the app was
// automotive-only, so legacy fields map 1:1 onto the neutral channels
// (vehicle→item, type→category, frontGross→amount, backGross→secondary,
// products→addons). A no-op (same reference) for already-migrated data.
// CAREFUL: legacy `products` was a NUMBER (count); the modern F&I field
// `products` is a string[] of ProductDef ids — only the number is legacy.
export function ensureDeals(data: AppData): AppData {
  const deals = data.deals;
  if (!Array.isArray(deals)) return { ...data, deals: [] }; // corrupted/foreign blob — never let a non-array reach .map()/.filter()
  if (deals.length === 0) return data;
  let changed = false;
  const out = deals.map((raw) => {
    const legacy = raw as Deal & { vehicle?: string; type?: string; frontGross?: number; backGross?: number };
    const legacyCount = typeof (legacy as { products?: unknown }).products === "number"
      ? ((legacy as { products?: number }).products as number)
      : undefined;
    if (legacy.vehicle === undefined && legacy.frontGross === undefined && legacy.backGross === undefined && legacy.type === undefined && legacyCount === undefined) return raw;
    changed = true;
    const { vehicle, type, frontGross, backGross, ...rest } = legacy;
    if (legacyCount !== undefined) delete (rest as { products?: unknown }).products;
    return {
      ...rest,
      item: rest.item ?? vehicle ?? "",
      category: rest.category ?? type,
      amount: rest.amount ?? frontGross ?? 0,
      secondary: rest.secondary ?? backGross ?? 0,
      addons: rest.addons ?? legacyCount ?? 0,
      reserve: rest.reserve ?? 0,
    } as Deal;
  });
  return changed ? { ...data, deals: out } : data;
}
