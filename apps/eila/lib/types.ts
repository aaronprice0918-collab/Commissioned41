// MissionOS Lite — core data model. Everything is per-user: it lives on-device
// (localStorage) AND syncs to the user's own row in Supabase (lite_state JSONB,
// lib/store.tsx push/pull). The shapes are designed to keep moving to a richer backend
// later without changing the comp engine.

import type { PayPlan } from "./payplan/types";
import type { MoneyConfig } from "./money/types";

// `Role` is the shape of a comp plan (individual closer vs. structuring
// specialist vs. manager vs. activity-based) — it's what drives defaultPlan().
// `Industry` is the vertical the rep works in — it drives terminology and
// EILA's tone. The two are independent axes: a jewelry rep and an insurance
// agent can both be "sales" role, in different industries.
export type Role = "sales" | "finance" | "sales_manager" | "bdc";

export const ROLE_LABEL: Record<Role, string> = {
  sales: "Individual Producer",
  finance: "Structuring / Back-End Specialist",
  sales_manager: "Manager / Team Lead",
  bdc: "Appointment Setter",
};

export type Industry =
  | "automotive"
  | "real_estate"
  | "mortgage"
  | "insurance"
  | "furniture"
  | "jewelry"
  | "rv_boats_powersports"
  | "solar_roofing"
  | "recruiting"
  | "saas"
  | "financial_services"
  | "other";

export const INDUSTRY_LABEL: Record<Industry, string> = {
  automotive: "Automotive",
  real_estate: "Real Estate",
  mortgage: "Mortgage",
  insurance: "Insurance",
  furniture: "Furniture",
  jewelry: "Jewelry",
  rv_boats_powersports: "RV, Boats & Powersports",
  solar_roofing: "Solar & Roofing",
  recruiting: "Recruiting",
  saas: "SaaS / Tech Sales",
  financial_services: "Financial Services",
  other: "Something else",
};

// The noun EILA and the app use in place of the generic "unit" wherever the
// UI or EILA's voice talks about what the rep sells.
export const INDUSTRY_UNIT: Record<Industry, { singular: string; plural: string }> = {
  automotive: { singular: "vehicle", plural: "vehicles" },
  real_estate: { singular: "closing", plural: "closings" },
  mortgage: { singular: "closed loan", plural: "closed loans" },
  insurance: { singular: "policy", plural: "policies" },
  furniture: { singular: "sale", plural: "sales" },
  jewelry: { singular: "sale", plural: "sales" },
  rv_boats_powersports: { singular: "unit", plural: "units" },
  solar_roofing: { singular: "install", plural: "installs" },
  recruiting: { singular: "placement", plural: "placements" },
  saas: { singular: "deal", plural: "deals" },
  financial_services: { singular: "account", plural: "accounts" },
  other: { singular: "sale", plural: "sales" },
};

export interface UnitTier {
  units: number; // at >= this many units...
  bonus: number; // ...you earn this flat monthly bonus
}

export interface GrossTier {
  gross: number; // at >= this much total gross...
  bonus: number; // ...this flat bonus
}

// A PVR × Product-per-Unit commission grid (common for F&I managers): the
// commission RATE is looked up from PPU (rows) × PVR (cols), then applied to
// net F&I profit (back-end gross). Optional +0.5% kickers.
export interface CommissionGrid {
  ppt: number[]; // product-per-unit row thresholds, ascending (e.g. [1.4,1.6,...,2.5])
  pvr: number[]; // PVR ($) column thresholds, ascending (e.g. [1050,1100,...,1700])
  rates: number[][]; // rates[pptIndex][pvrIndex] as a percent (e.g. 13.0)
  pvrBonusThreshold: number; // PVR above this adds pvrBonusAdd (0 = none)
  pvrBonusAdd: number; // e.g. 0.5
  vscBonusThreshold: number; // VSC penetration % at/above this adds vscBonusAdd (0 = none)
  vscBonusAdd: number; // e.g. 0.5
}

// The compensation model the AI (or the guided builder) produces from a pay plan.
// Intentionally flexible: any component can be 0/empty and the engine ignores it.
export interface CompModel {
  role: Role;
  frontCommissionPct: number; // % of front-end gross
  backCommissionPct: number; // % of back-end gross (F&I reserve + products)
  flatPerUnit: number; // $ mini / flat per unit
  productBonusPerUnit: number; // $ per product sold (VSC/GAP/etc.)
  unitTiers: UnitTier[]; // monthly volume bonuses
  grossTiers: GrossTier[]; // monthly gross bonuses
  guarantee: number; // monthly guarantee floor
  draw: number; // monthly draw/advance against commission (informational; not added to earned pay)
  spiffs: number; // misc monthly spiffs the user adds manually
  goalUnits: number; // personal monthly unit goal
  taxRate: number; // optional effective tax % for a net estimate (0 = off)
  grid?: CommissionGrid; // F&I PVR×PPU grid; when present it drives commission instead of front/back %
  notes: string;
}

export type DealStatus =
  | "prospect"
  | "appointment"
  | "working"
  | "pending"
  | "finance"
  | "delivered"
  | "dead";

export const STATUS_LABEL: Record<DealStatus, string> = {
  prospect: "Prospect",
  appointment: "Appointment",
  working: "Working",
  pending: "Pending",
  finance: "In Finance",
  delivered: "Delivered",
  dead: "Dead",
};

// How confident we are each stage actually books, for the "likely" projection.
export const STATUS_WEIGHT: Record<DealStatus, number> = {
  prospect: 0.1,
  appointment: 0.25,
  working: 0.5,
  pending: 0.8,
  finance: 0.9,
  delivered: 1,
  dead: 0,
};

// F&I product definitions — per-user, editable in Settings, seeded with
// sensible defaults for automotive. Every store's menu differs, so nothing
// about these is hard-coded: `units` is how many product units one sale
// counts for toward PPU (some stores count a bundle as several), `spiff` is
// a flat $ paid per sale of this product on top of the pay plan.
export interface ProductDef {
  id: string;
  label: string;
  units: number;
  spiff: number;
}

// Industry-neutral deal record. The two money channels (`amount`, `secondary`)
// feed the pay engine's primary/secondary channels; what they're CALLED — and
// whether `secondary`/`addons`/`reserve` exist at all — comes from the
// industry's spec in lib/industry.ts. Legacy automotive field names
// (vehicle/type/frontGross/backGross/products) are migrated on load by
// ensureDeals() in lib/store.tsx.
export interface Deal {
  id: string;
  date: string; // ISO; the day it was logged / delivered
  customer: string;
  phone?: string; // enables tap-to-call from the deal card/day board
  item: string; // what was sold — labeled per industry (vehicle / property / policy / piece…)
  category?: string; // industry-defined option id (auto: new/used/lease; RE: buyer/listing…)
  amount: number; // primary commissionable money (front gross / GCI / premium / fee…)
  secondary: number; // second money channel where the industry has one (auto/RV back gross); else 0
  addons: number; // add-on count where the industry has them (F&I products / protection plans); else 0
  reserve: number; // finance reserve (informational; auto-world only)
  status: DealStatus;
  followUpAt?: string; // ISO date for next touch
  note?: string;
  demo?: boolean; // true for sample deals seeded on first setup (auto-cleared on first real deal)
  // ---- F&I depth (automotive; all optional so older deals are untouched) ----
  dealNumber?: string; // store deal #
  bank?: string; // lender
  funded?: boolean; // bank has funded (separate from pipeline status)
  salesperson?: string; // who sold the unit (feeds the salesperson report)
  salesperson2?: string; // split partner — both credited 50/50
  noQualify?: boolean; // counts for the salesperson's units but carries $0 F&I credit
  productOnly?: boolean; // backend products sold with NO vehicle — its gross/products count toward PVR/PPU but it is NOT a unit
  products?: string[]; // ProductDef ids sold on this deal (drives PPU/penetration)
  jacketFile?: { path: string; pages: number; savedAt: string }; // Scan and Sort: the sorted PDF EILA holds for 90 days (blue folder)
}

export type LifeItemKind = "appointment" | "task" | "personal";

// Things in the rep's actual day that are not dealership CRM work: family,
// appointments, errands, habits, reminders, and the life admin EILA should help
// them protect around selling.
export interface LifeItem {
  id: string;
  title: string;
  kind: LifeItemKind;
  date: string; // local YYYY-MM-DD
  time?: string; // HH:mm, optional
  note?: string;
  done?: boolean;
  createdAt: string;
}

export interface Profile {
  name: string;
  role: Role;
  industry: Industry;
  plan: PayPlan;
  comp?: CompModel; // legacy (pre-engine) — migrated to `plan` on load
  payPlanFileName?: string;
  createdAt: string;
  products?: ProductDef[]; // the user's own product menu (F&I); defaults seeded per industry
  daysOff?: number[]; // weekdays the user doesn't sell (0=Sun…6=Sat) — drives pace math
  money?: MoneyConfig; // the Money area (EILA's CFO side); absent until set up
  jacketOrder?: string[]; // F&I: the user's required deal-jacket document order (Scan and Sort); absent = house default
  timeZone?: string; // IANA zone (e.g. "America/Chicago"); lets the server-side nudge cron bucket follow-ups in the rep's local day, not UTC. Absent = server default.
}

// A single durable thing EILA has learned about this rep from an interaction —
// a preference, a fact about their situation, a commitment, what coaching
// landed. Distilled by /api/ila/reflect after each chat. Per-app by design:
// these never leave this product.
export interface IlaMemory {
  id: string;
  date: string; // ISO — when EILA learned it
  note: string;
}

export interface AppData {
  profile: Profile | null;
  deals: Deal[];
  lifeItems?: LifeItem[];
  ilaMemories?: IlaMemory[]; // optional: data saved before this field existed
}
