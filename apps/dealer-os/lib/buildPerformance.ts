import { commissionableFrontGross, countsTowardPpu, money, isRetail, isVehicleUnit, productUnits, salespersonShare, type Deal } from "@/lib/data";
import type { DealRow, Performance } from "@/lib/payEngine";

type Opts = {
  role?: string;
  name?: string; // for Sales, splits are share-weighted to this person
  menuMet?: boolean;
  csiMet?: boolean;
  csiMonthsBelow?: number;
  uncashedContracts?: number;
  // Fast-start cutoff day (SalesPlan.fastStartByDay). Default 15.
  fastStartByDay?: number;
};

// Turn a person's month of deals into the engine's performance metrics. For a
// Sales person the numbers are share-weighted (a split counts as half); for
// other roles a deal counts once. Provides every gross base + rate axes so any
// CompPlan resolves. Metrics we can't derive from deals default to "met".
//
// UNIT GATE: retail (New/Used) only — the same rule as the legacy sales calc
// and the store leaderboards. A delivered Wholesale unit carrying a rep's name
// used to inflate the engine path's units/bonus tiers while the legacy path
// correctly excluded it: same rep, two pay numbers.
export function buildPerformance(deals: Deal[], opts?: Opts): Performance {
  const countable = deals.filter(isRetail);
  const shareOf = (d: Deal) => (opts?.role === "Sales" && opts?.name ? salespersonShare(d, opts.name) : 1);
  const fastStartCutoff = opts?.fastStartByDay ?? 15;

  let units = 0, backGross = 0, frontGross = 0, products = 0, vscUnits = 0, fastStartUnits = 0;
  for (const d of countable) {
    const share = shareOf(d);
    // Product-only deals feed gross + products (PVR/PPU numerators) but are NOT a
    // vehicle unit, so they never touch units / VSC penetration / fast-start.
    const car = isVehicleUnit(d);
    if (car) units += share;
    backGross += money(d.backGrossReserve) * share;
    frontGross += commissionableFrontGross(d) * share;
    if (countsTowardPpu(d)) products += productUnits(d) * share;
    if (car && d.products?.vsc) vscUnits += share;
    if (car && Number(d.date?.slice(8, 10)) <= fastStartCutoff) fastStartUnits += share; // delivered by the plan's fast-start day
  }
  const totalGross = frontGross + backGross;

  return {
    units,
    backGross,
    frontGross,
    totalGross,
    netProfit: backGross,
    products,
    fastStartUnits,
    pvr: units ? backGross / units : 0, // back-end per-vehicle retail
    frontPvr: units ? frontGross / units : 0,
    totalPvr: units ? totalGross / units : 0,
    ppu: units ? products / units : 0,
    vscPenetration: units ? (vscUnits / units) * 100 : 0,
    menuUsage: opts?.menuMet === false ? 0 : 100,
    csiBelow: opts?.csiMet === false ? 1 : 0,
    csiMonthsBelow: opts?.csiMonthsBelow ?? 1,
    uncashedContracts: opts?.uncashedContracts ?? 0,
  };
}

// Per-deal rows for perDeal rules (sales-style plans): each deal's CGP, class,
// and the person's split share.
export function buildDealRows(deals: Deal[], name?: string): DealRow[] {
  // Per-deal (per-car) rules pay on actual vehicle units — product-only deals
  // carry no front CGP and are not a car, so they're excluded here.
  return deals.filter(isVehicleUnit).map((d) => ({
    cgp: commissionableFrontGross(d),
    vehicleClass: d.vehicleClass,
    share: name ? salespersonShare(d, name) : 1,
  }));
}
