// Group reporting — the multi-rooftop rollup. One dealer principal, several
// stores, one answer to "how's the group doing?" Confirmed table stakes for
// the dealer-OS category (Tekion ARC sells multi-rooftop first-class; T1
// answers cross-store questions) — this is our version, EILA-shaped.
//
// Membership rides the existing plumbing, no schema change: a server-only
// `groupConfig` app_store row on any member org names the group, its member
// org ids, and the emails allowed to see the rollup. The platform owner sees
// every store without any config. All aggregation reuses metricsFor — the
// tested engine — per store; group totals are recomputed from the raw sums
// (a group PVR is total gross / total units, never an average of averages).

import { metricsFor, mergeStoreSettings, setActiveStoreSettings, defaultStoreSettings, type Deal, type StoreSettings } from "@/lib/data";

export type GroupConfig = {
  name: string;
  memberOrgIds: string[];
  viewers: string[]; // emails allowed to see the rollup
};

export type GroupStoreInput = { orgId: string; name: string; deals: Deal[]; settings?: Partial<StoreSettings> | null };

export type GroupStoreRow = {
  orgId: string;
  name: string;
  units: number;
  gross: number;
  front: number;
  back: number;
  pvr: number;
  financePvr: number;
  ppu: number;
  newUnits: number;
  usedUnits: number;
};

export type GroupRollup = {
  stores: GroupStoreRow[];
  totals: {
    units: number;
    gross: number;
    front: number;
    back: number;
    pvr: number;
    financePvr: number;
    ppu: number;
    newUnits: number;
    usedUnits: number;
    stores: number;
  };
};

// Parse a raw `groupConfig` app_store value defensively — it's hand-seeded
// (SQL/console) until there's an owner screen, so garbage must degrade to
// "no group", never crash a report.
export function parseGroupConfig(value: unknown): GroupConfig | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const memberOrgIds = Array.isArray(v.memberOrgIds) ? v.memberOrgIds.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  const viewers = Array.isArray(v.viewers) ? v.viewers.filter((x): x is string => typeof x === "string" && x.includes("@")) : [];
  if (!memberOrgIds.length || !viewers.length) return null;
  return { name: typeof v.name === "string" && v.name ? v.name : "Dealer Group", memberOrgIds, viewers };
}

// Which group (if any) can this email see? First match wins; matching is
// case-insensitive because emails are.
export function groupForViewer(configs: { value: unknown }[], email: string): GroupConfig | null {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  for (const c of configs) {
    const parsed = parseGroupConfig(c.value);
    if (parsed && parsed.viewers.some((v) => v.trim().toLowerCase() === needle)) return parsed;
  }
  return null;
}

export function groupRollup(stores: GroupStoreInput[]): GroupRollup {
  const rows: GroupStoreRow[] = [];
  // Raw sums for honest group ratios — units-weighted, not store-averaged.
  let units = 0, gross = 0, front = 0, back = 0, newUnits = 0, usedUnits = 0;
  let financeGross = 0, classified = 0, productTotal = 0, productReady = 0;

  for (const store of stores) {
    // Each store's OWN settings (product weights, doc fee) drive its metrics —
    // grading every rooftop with the founding store's weights lied about PPU.
    // metricsFor reads the module cache, so swap it per store and restore.
    setActiveStoreSettings(store.settings ? mergeStoreSettings(store.settings) : defaultStoreSettings);
    const m = metricsFor(Array.isArray(store.deals) ? store.deals : []); // the tested engine — never a re-implementation
    rows.push({
      orgId: store.orgId,
      name: store.name,
      units: m.delivered,
      gross: m.gross,
      front: m.front,
      back: m.back,
      pvr: m.pvr,
      financePvr: m.financePvr,
      ppu: m.ppu,
      newUnits: m.newUnits,
      usedUnits: m.usedUnits,
    });
    units += m.delivered;
    gross += m.gross;
    front += m.front;
    back += m.back;
    newUnits += m.newUnits;
    usedUnits += m.usedUnits;
    financeGross += m.financeGross;
    classified += m.classified;
    productTotal += m.productTotal;
    productReady += m.productReady;
  }

  // Leave the cache as the defaults — callers on the client re-prime it via
  // StoreSettingsProvider; on the server the next request sets its own.
  setActiveStoreSettings(defaultStoreSettings);

  rows.sort((a, b) => b.gross - a.gross);

  return {
    stores: rows,
    totals: {
      units,
      gross,
      front,
      back,
      pvr: units ? gross / units : 0,
      financePvr: classified ? financeGross / classified : 0,
      ppu: productReady ? productTotal / productReady : 0,
      newUnits,
      usedUnits,
      stores: rows.length,
    },
  };
}
