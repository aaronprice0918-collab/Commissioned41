// F&I MANAGER SPIFF ENGINE — the store-incentive layer that sits ON TOP of the
// grid commission (calc.ts). This is the piece that makes EILA reproduce THE
// LOGG's pay in full: the audited grid engine already nails the commission +
// draw, but a finance manager's check also carries spiffs, and those don't fit
// the rate-bonus model — they're paid PER PRODUCT COUNT, some gated behind a
// month-level qualifier, and their per-unit rate steps by penetration %.
//
// Two shapes, matching THE LOGG:
//   • FLAT spiffs (e.g. NAS Combo $50/each) — paid on count, always.
//   • A GATED package (the "TWS" spiffs: VSC / Maintenance / GAP / Road-Hazard)
//     that pays ONLY when the month clears BOTH a PPU floor and a PVR floor, and
//     whose per-unit rate is chosen by that product's penetration %.
//
// Kept out of calc.ts on purpose: that engine is frozen behind a 3,000-month
// oracle fuzz. Spiffs layer on without touching it.

export interface SpiffTier {
  minPct: number; // penetration % at/above this...
  rate: number; // ...pays this $ per unit. Highest qualifying tier wins; below all tiers = $0.
}

export interface FlatSpiff {
  id: string;
  label: string;
  countKey: string; // which product count drives it (e.g. "combo")
  rate: number; // $ per unit sold
}

export interface GatedSpiff {
  id: string;
  label: string;
  countKey: string; // product count paid on
  penetrationKey: string; // which penetration % selects the tier
  tiers: SpiffTier[];
}

export interface SpiffPlan {
  flat: FlatSpiff[];
  // The gated package only pays when PPU >= qualifier.ppu AND PVR >= qualifier.pvr.
  gatedQualifier: { ppu: number; pvr: number };
  gated: GatedSpiff[];
}

export interface SpiffInput {
  ppu: number;
  pvr: number;
  counts: Record<string, number>; // per product id: how many deals carried it
  penetrations: Record<string, number>; // per product id: penetration % (0-100)
}

export interface SpiffLine {
  id: string;
  label: string;
  amount: number;
  note: string;
}

export interface SpiffResult {
  lines: SpiffLine[];
  gatedQualified: boolean;
  flatTotal: number;
  gatedTotal: number;
  total: number;
}

// Highest tier whose minPct <= penetration wins; below every tier pays $0.
export function tierRate(pct: number, tiers: SpiffTier[]): number {
  let rate = 0;
  for (const t of [...tiers].sort((a, b) => a.minPct - b.minPct)) {
    if (pct >= t.minPct) rate = t.rate;
  }
  return rate;
}

export function computeSpiffs(plan: SpiffPlan, input: SpiffInput): SpiffResult {
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const lines: SpiffLine[] = [];
  let flatTotal = 0;
  for (const f of plan.flat) {
    const count = input.counts[f.countKey] ?? 0;
    const amount = count * f.rate;
    flatTotal += amount;
    lines.push({ id: f.id, label: f.label, amount, note: `${count} × $${f.rate}` });
  }

  const gatedQualified =
    input.ppu >= plan.gatedQualifier.ppu && input.pvr >= plan.gatedQualifier.pvr;
  let gatedTotal = 0;
  for (const g of plan.gated) {
    const count = input.counts[g.countKey] ?? 0;
    const pen = input.penetrations[g.penetrationKey] ?? 0;
    const rate = tierRate(pen, g.tiers);
    const amount = gatedQualified ? count * rate : 0;
    gatedTotal += amount;
    lines.push({
      id: g.id,
      label: g.label,
      amount,
      note: gatedQualified
        ? `${count} × $${rate} (${pen.toFixed(1)}% tier)`
        : `locked — needs PPU ≥ ${plan.gatedQualifier.ppu} and PVR ≥ ${money(plan.gatedQualifier.pvr)}`,
    });
  }

  return { lines, gatedQualified, flatTotal, gatedTotal, total: flatTotal + gatedTotal };
}

// Aaron's Kennesaw Mazda spiff schedule, transcribed line-for-line from THE LOGG
// Pay Plan tab. NAS Combo is the ungated $50/unit; the rest are the TWS package,
// gated on PPU ≥ 2.0 AND PVR ≥ $1,550, with penetration-stepped rates.
export const KENNESAW_SPIFFS: SpiffPlan = {
  flat: [{ id: "nas", label: "NAS Combo spiff", countKey: "combo", rate: 50 }],
  gatedQualifier: { ppu: 2.0, pvr: 1550 },
  gated: [
    {
      id: "vsc",
      label: "Service Contract / VSC spiff",
      countKey: "vsc",
      penetrationKey: "vsc",
      // 40-49% → $25, 50-59% → $30, 60%+ → $40 (below 40% = $0).
      tiers: [{ minPct: 40, rate: 25 }, { minPct: 50, rate: 30 }, { minPct: 60, rate: 40 }],
    },
    {
      id: "maint",
      label: "Maintenance spiff",
      countKey: "maint",
      penetrationKey: "maint",
      // 20-39% → $15, 40%+ → $25 (below 20% = $0).
      tiers: [{ minPct: 20, rate: 15 }, { minPct: 40, rate: 25 }],
    },
    {
      id: "gap",
      label: "GAP spiff",
      countKey: "gap",
      penetrationKey: "gap",
      // 30-39% → $15, 40%+ → $40 (below 30% = $0).
      tiers: [{ minPct: 30, rate: 15 }, { minPct: 40, rate: 40 }],
    },
    {
      id: "roadHazard",
      label: "Road Hazard / Tire spiff",
      countKey: "other", // THE LOGG: "Uses Other product column"
      penetrationKey: "other",
      // 15%+ → $25 (below = $0).
      tiers: [{ minPct: 15, rate: 25 }],
    },
  ],
};

import type { Deal } from "../types";
import type { ProductDef } from "../types";
import { dealUnits } from "../fni";
import { isProductOnly } from "../productOnly";

// Turn a month's deals into the SpiffInput the engine needs: per-product counts
// (how many deals carried each product) and penetration %, plus PPU (product
// UNITS per retail deal — NAS Combo weighs 5, so units ≠ count) and PVR (F&I
// back gross per retail deal). Non-qualifying deals carry $0 F&I gross, matching
// the salesperson report and THE LOGG.
export function fniSpiffInput(deals: Deal[], defs: ProductDef[]): SpiffInput {
  // PVR/PPU denominator is CAR units — product-only deals credit gross + products
  // (numerators below) but are not a unit. Penetration is also over cars.
  const cars = deals.filter((d) => !isProductOnly(d));
  const retail = cars.length;
  const counts: Record<string, number> = {};
  const penetrations: Record<string, number> = {};
  let productUnits = 0;
  let fniGross = 0;
  for (const d of deals) {
    // addons is the app's product-units field (kept synced to the menu, and set
    // to THE LOGG's own Product Units on import — where a bundle weighs 5); it's
    // the same value that drives the grid PPU, so PPU ties out across surfaces.
    // Product-only add-ons + back gross COUNT in the numerators.
    productUnits += d.addons && d.addons > 0 ? d.addons : dealUnits(d, defs);
    fniGross += d.noQualify ? 0 : d.secondary;
  }
  for (const d of cars) {
    for (const id of d.products ?? []) counts[id] = (counts[id] ?? 0) + 1;
  }
  for (const id of Object.keys(counts)) {
    penetrations[id] = retail ? (counts[id] / retail) * 100 : 0;
  }
  return {
    ppu: retail ? productUnits / retail : 0,
    pvr: retail ? fniGross / retail : 0,
    counts,
    penetrations,
  };
}
