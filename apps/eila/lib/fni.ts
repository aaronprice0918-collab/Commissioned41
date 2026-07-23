// F&I depth — the layer that turns EILA into THE LOGG for finance managers.
// Everything here is driven by the USER'S own product menu (Profile.products)
// and pay plan; nothing about any one store's plan is hard-coded. The defaults
// below are just a sensible starting menu the user edits in Settings.

import { Deal, Industry, ProductDef, Profile } from "./types";
import { isProductOnly } from "./productOnly";

export const DEFAULT_AUTO_PRODUCTS: ProductDef[] = [
  { id: "vsc", label: "VSC", units: 1, spiff: 0 },
  { id: "gap", label: "GAP", units: 1, spiff: 0 },
  { id: "combo", label: "Combo bundle", units: 1, spiff: 0 },
  { id: "maint", label: "Maintenance", units: 1, spiff: 0 },
  { id: "other", label: "Other", units: 1, spiff: 0 },
];

// Which industries get the product-menu treatment (per-deal product picks
// instead of a bare add-on counter). Others keep the simple counter.
const PRODUCT_INDUSTRIES: Industry[] = ["automotive", "rv_boats_powersports"];

export function usesProductMenu(industry: Industry): boolean {
  return PRODUCT_INDUSTRIES.includes(industry);
}

export function productDefs(profile: Profile | null): ProductDef[] {
  if (!profile || !usesProductMenu(profile.industry)) return [];
  return profile.products && profile.products.length ? profile.products : DEFAULT_AUTO_PRODUCTS;
}

// Product units for one deal: the sum of each sold product's unit weight
// (stores weigh bundles differently — that's the `units` knob). Deals logged
// before the menu existed fall back to their plain add-on count.
export function dealUnits(deal: Deal, defs: ProductDef[]): number {
  if (!deal.products || !deal.products.length) return deal.addons || 0;
  return deal.products.reduce((s, id) => s + (defs.find((d) => d.id === id)?.units ?? 1), 0);
}

// Flat product spiffs across a set of deals — paid on top of the pay plan.
export function spiffTotal(deals: Deal[], defs: ProductDef[]): number {
  let t = 0;
  for (const deal of deals) {
    for (const id of deal.products ?? []) t += defs.find((d) => d.id === id)?.spiff ?? 0;
  }
  return t;
}

// The VSC product in THIS user's menu. A custom/imported menu carries GENERATED
// ids ("pmrpmkmsk3"), not the literal "vsc" — so any hardcoded `includes("vsc")`
// check reads 0% for those users (July 23: "VSC is not 0%"). Resolve by canonical
// id first, then by label, so it works for the default menu AND a custom one.
export function resolveVscId(defs: ProductDef[]): string | undefined {
  return (defs.find((d) => d.id === "vsc") ?? defs.find((d) => /\bv\.?s\.?c\b|service\s*contract/i.test(d.label)))?.id;
}

// % of retail cars carrying VSC — the one number every VSC display should use.
// Denominator = cars that could take VSC (not product-only, not a house/DNQ deal).
export function vscPenetrationPct(deals: Deal[], defs: ProductDef[]): number {
  const id = resolveVscId(defs);
  if (!id) return 0;
  const cars = deals.filter((d) => !isProductOnly(d) && !d.noQualify);
  if (!cars.length) return 0;
  return (cars.filter((d) => d.products?.includes(id)).length / cars.length) * 100;
}

// Penetration: what share of RETAIL cars carried each product. Product-only
// deals aren't cars, and no-qualify (DNQ/house) deals can't carry F&I products,
// so both are out of the numerator AND the denominator — matching vscPenetrationPct
// and the pay card (July 23: the widget read VSC 44% (÷34) while the board read
// 48% (÷31 retail)).
export function penetration(deals: Deal[], defs: ProductDef[]): { def: ProductDef; count: number; pct: number }[] {
  const cars = deals.filter((d) => !isProductOnly(d) && !d.noQualify);
  const n = cars.length || 1;
  return defs.map((def) => {
    const count = cars.filter((d) => d.products?.includes(def.id)).length;
    return { def, count, pct: count / n };
  });
}

export interface SalespersonRow {
  name: string;
  retail: number; // unit count (0.5 each on splits)
  productUnits: number;
  perUnit: number;
  fniGross: number; // back-end credit ($0 on no-qualify deals)
  byProduct: Record<string, number>;
}

// The report sales managers ask for: who feeds F&I, ranked. Split deals credit
// both names 50/50; no-qualify deals keep the unit on the board but carry $0.
export function salespersonReport(deals: Deal[], defs: ProductDef[]): SalespersonRow[] {
  const rows = new Map<string, SalespersonRow>();
  const get = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, " ");
    const key = name.toUpperCase();
    if (!rows.has(key)) rows.set(key, { name, retail: 0, productUnits: 0, perUnit: 0, fniGross: 0, byProduct: {} });
    return rows.get(key)!;
  };
  for (const deal of deals) {
    const names = [deal.salesperson, deal.salesperson2].filter((s): s is string => !!s && !!s.trim());
    if (!names.length) continue;
    const share = 1 / names.length;
    const units = dealUnits(deal, defs);
    // F&I credit = the back-end channel. (Reserve is informational — logs
    // like THE LOGG already fold it into back gross; adding it would double-count.)
    const gross = deal.noQualify ? 0 : deal.secondary;
    // Product-only deals credit F&I gross + products but are NOT a car unit.
    const car = !isProductOnly(deal);
    for (const n of names) {
      const r = get(n);
      if (car) r.retail += share;
      r.productUnits += units * share;
      r.fniGross += gross * share;
      for (const id of deal.products ?? []) r.byProduct[id] = (r.byProduct[id] ?? 0) + share;
    }
  }
  const out = [...rows.values()].map((r) => ({ ...r, perUnit: r.retail ? r.productUnits / r.retail : 0 }));
  out.sort((a, b) => b.fniGross - a.fniGross || b.productUnits - a.productUnits);
  return out;
}

// Which money channel the user measures themselves on — read from THEIR pay
// plan, never from the role name. An F&I manager's grid pays on back gross,
// so back is their headline; a rep paid on front headlines front; anyone
// paid on the whole deal headlines the whole deal.
export type MoneyBasis = "front" | "back" | "total";

export function moneyBasis(profile: Profile | null): MoneyBasis {
  const plan = profile?.plan;
  if (!plan) return "total";
  const grid = (plan as { grid?: { basis?: MoneyBasis } }).grid;
  if (grid?.basis === "back" || grid?.basis === "front") return grid.basis;
  const base = (plan as { base?: { frontPct?: number; backPct?: number } }).base ?? {};
  const front = base.frontPct ?? 0;
  const back = base.backPct ?? 0;
  if (back > 0 && front === 0) return "back";
  if (front > 0 && back === 0) return "front";
  return "total";
}

// Deal → the money that counts for this user, per their basis.
export function dealMoneyOf(basis: MoneyBasis): (d: Deal) => number {
  if (basis === "back") return (d) => d.secondary;
  if (basis === "front") return (d) => d.amount;
  return (d) => d.amount + d.secondary;
}

export function basisGrossLabel(basis: MoneyBasis, industry: Industry): string {
  if (basis === "back") return usesProductMenu(industry) ? "F&I gross" : "Back-end gross";
  if (basis === "front") return "Front gross";
  return "Gross";
}

// Round to one decimal (split deals produce .5 units).
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
