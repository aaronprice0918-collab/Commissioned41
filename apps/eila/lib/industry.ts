// The industry layer — ONE place that teaches the whole app how each vertical
// actually sells. Every screen, form, coach line, and EILA prompt reads deal
// terminology from here instead of assuming automotive. The pay engine itself
// stays industry-agnostic (two money channels + counts); this module decides
// what those channels are CALLED and which ones exist for a given industry.

import type { DealStatus, Industry } from "./types";

export interface DealCategory { id: string; label: string }

export interface IndustryDealSpec {
  // What the rep sells — drives the "item" field label + placeholder.
  itemLabel: string;
  itemPlaceholder: string;
  // Optional deal categories (auto: New/Used/Lease). null = no category field.
  categories: DealCategory[] | null;
  // The primary commissionable money on a deal (engine channel 1).
  amountLabel: string;
  amountHint: string;
  // A second money channel (auto/RV F&I back gross). null = hidden entirely.
  secondaryLabel: string | null;
  // Add-on count (F&I products, protection plans). null = hidden entirely.
  addonsLabel: string | null;
  // Whether the informational finance-reserve field applies (auto-world only).
  hasReserve: boolean;
  // Industry-true wording for pipeline stages that differ from the default.
  statusOverrides: Partial<Record<DealStatus, string>>;
}

const AUTO_LIKE = {
  amountLabel: "Front gross",
  amountHint: "Front-end gross profit on the deal",
  secondaryLabel: "Back gross (F&I)",
  addonsLabel: "F&I products",
  hasReserve: true,
  statusOverrides: {},
};

export const INDUSTRY_DEAL: Record<Industry, IndustryDealSpec> = {
  automotive: {
    ...AUTO_LIKE,
    itemLabel: "Vehicle",
    itemPlaceholder: "CX-5, Silverado, Model Y…",
    categories: [
      { id: "new", label: "New" },
      { id: "used", label: "Used" },
      { id: "lease", label: "Lease" },
    ],
  },
  rv_boats_powersports: {
    ...AUTO_LIKE,
    itemLabel: "Unit",
    itemPlaceholder: "Travel trailer, pontoon, SxS…",
    categories: [
      { id: "new", label: "New" },
      { id: "used", label: "Used" },
    ],
  },
  real_estate: {
    itemLabel: "Property",
    itemPlaceholder: "123 Maple St…",
    categories: [
      { id: "buyer", label: "Buyer side" },
      { id: "listing", label: "Listing side" },
    ],
    amountLabel: "Gross commission (GCI)",
    amountHint: "Your side's gross commission on the closing — your split applies on top",
    secondaryLabel: null,
    addonsLabel: null,
    hasReserve: false,
    statusOverrides: { finance: "Under contract", delivered: "Closed" },
  },
  mortgage: {
    itemLabel: "Loan",
    itemPlaceholder: "Purchase — 30yr conventional…",
    categories: [
      { id: "purchase", label: "Purchase" },
      { id: "refi", label: "Refinance" },
    ],
    amountLabel: "Loan amount",
    amountHint: "Total loan amount — your comp % (bps) applies to this",
    secondaryLabel: null,
    addonsLabel: null,
    hasReserve: false,
    statusOverrides: { finance: "In underwriting", delivered: "Funded" },
  },
  insurance: {
    itemLabel: "Policy",
    itemPlaceholder: "Auto + home bundle…",
    categories: [
      { id: "auto", label: "Auto" },
      { id: "home", label: "Home" },
      { id: "life", label: "Life" },
      { id: "commercial", label: "Commercial" },
    ],
    amountLabel: "Annual premium",
    amountHint: "First-year premium — your commission % applies to this",
    secondaryLabel: null,
    addonsLabel: null,
    hasReserve: false,
    statusOverrides: { finance: "In underwriting", delivered: "Bound" },
  },
  furniture: {
    itemLabel: "Sale",
    itemPlaceholder: "Sectional + dining set…",
    categories: null,
    amountLabel: "Sale amount",
    amountHint: "The written sale total your commission is figured on",
    secondaryLabel: null,
    addonsLabel: "Protection plans",
    hasReserve: false,
    statusOverrides: { finance: "Financing", delivered: "Delivered" },
  },
  jewelry: {
    itemLabel: "Piece",
    itemPlaceholder: "1.5ct solitaire, Rolex Datejust…",
    categories: null,
    amountLabel: "Sale amount",
    amountHint: "The sale total your commission is figured on",
    secondaryLabel: null,
    addonsLabel: "Add-ons (warranty / care plan)",
    hasReserve: false,
    statusOverrides: { finance: "Financing", delivered: "Sold" },
  },
  solar_roofing: {
    itemLabel: "Project",
    itemPlaceholder: "8.4kW system, full re-roof…",
    categories: [
      { id: "solar", label: "Solar" },
      { id: "roofing", label: "Roofing" },
    ],
    amountLabel: "Contract value",
    amountHint: "Signed contract value — your comp applies to this",
    secondaryLabel: null,
    addonsLabel: null,
    hasReserve: false,
    statusOverrides: { finance: "In approval", delivered: "Installed" },
  },
  recruiting: {
    itemLabel: "Placement",
    itemPlaceholder: "Sr. engineer @ Acme…",
    categories: null,
    amountLabel: "Placement fee",
    amountHint: "The fee billed for the placement — your split applies to this",
    secondaryLabel: null,
    addonsLabel: null,
    hasReserve: false,
    statusOverrides: { finance: "Offer stage", delivered: "Placed" },
  },
  saas: {
    itemLabel: "Deal",
    itemPlaceholder: "Acme Corp — 24 seats…",
    categories: [
      { id: "new_logo", label: "New logo" },
      { id: "expansion", label: "Expansion" },
      { id: "renewal", label: "Renewal" },
    ],
    amountLabel: "Contract value",
    amountHint: "ACV / bookings your commission is figured on",
    secondaryLabel: null,
    addonsLabel: null,
    hasReserve: false,
    statusOverrides: { finance: "Contracting", delivered: "Closed won" },
  },
  financial_services: {
    itemLabel: "Account",
    itemPlaceholder: "IRA rollover, annuity…",
    categories: null,
    amountLabel: "Production (GDC)",
    amountHint: "Gross dealer concession / production your payout applies to",
    secondaryLabel: null,
    addonsLabel: null,
    hasReserve: false,
    statusOverrides: { finance: "In processing", delivered: "Funded" },
  },
  other: {
    itemLabel: "Sale",
    itemPlaceholder: "What did you sell?",
    categories: null,
    amountLabel: "Commissionable amount",
    amountHint: "The money your commission is figured on",
    secondaryLabel: null,
    addonsLabel: null,
    hasReserve: false,
    statusOverrides: {},
  },
};

// Industry-aware stage label — falls back to the default wording.
export function statusLabel(industry: Industry, status: DealStatus, fallback: string): string {
  return INDUSTRY_DEAL[industry].statusOverrides[status] ?? fallback;
}

// The pay engine composes its plain-English hints around the generic word
// "unit(s)" — swap in the industry's own noun at display time so a bonus
// reads "Reach 10 closings", never "Reach 10 units", without touching the
// engine's tested internals.
export function localizeUnits(text: string, unit: { singular: string; plural: string }): string {
  return text.replace(/\bunits\b/g, unit.plural).replace(/\bunit\b/g, unit.singular);
}
