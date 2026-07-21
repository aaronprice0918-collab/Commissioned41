// ─────────────────────────────────────────────────────────────────────────────
// Commissioned 41 — central site config.
//
// One file to control the brand ecosystem: the two product URLs, navigation,
// and shared brand copy. Change a product domain here (or via env) and every
// link across the site updates.
//
// Product URLs are env-overridable for Vercel without a code change:
//   NEXT_PUBLIC_EILA_URL
//   NEXT_PUBLIC_MISSION_OS_LITE_URL
//   NEXT_PUBLIC_DEALER_MISSION_OS_URL
// (The defaults below are the current live properties.)
// ─────────────────────────────────────────────────────────────────────────────

// Brand rule: EVERY product lives on its own subdomain of commissioned41.com,
// so the whole ecosystem stays under one roof (no raw *.vercel.app links).
export const PRODUCT_URLS = {
  // EILA — AI performance companion for individual commission professionals.
  // Internal engine name stays "MissionOS Lite" (key: "lite" below); public name is "EILA".
  lite: process.env.NEXT_PUBLIC_EILA_URL ?? process.env.NEXT_PUBLIC_MISSION_OS_LITE_URL ?? "https://lite.commissioned41.com",
  // Dealer Mission OS — the live dealership OS. /login is its entry route.
  dealer: process.env.NEXT_PUBLIC_DEALER_MISSION_OS_URL ?? "https://missionos.commissioned41.com/login",
} as const;

export const BRAND_ASSETS = {
  eilaIcon: "/brand/eila-logo-clean-crop-20260715.png",
  dealerMark: "/brand/dealer-mission-mark-clean-20260714b.svg",
} as const;

export type ProductKey = "lite" | "dealer";

// Aaron, 2026-07-04: EILA (Lite) is THE flagship — she's live, self-serve, and
// can actually take a stranger's money today. EILA/Isla carries the personal
// money layer alongside commission and daily execution. Dealer Mission OS stays
// its own dealership product and should say "Coming Soon" until it can
// genuinely onboard and bill a random stranger end-to-end.
// Flip a key's status back to "live" only once it can genuinely onboard and
// bill a random stranger end-to-end.
export type ProductStatus = "live" | "comingSoon";

export interface Product {
  key: ProductKey;
  name: string;
  status: ProductStatus;
  subtitle: string;
  description: string;
  // Longer paragraph for the /products page.
  longDescription: string;
  cta: string;
  href: string;
  // Feature chips shown on cards.
  features: string[];
  // Deeper feature list for the /products page.
  capabilities: string[];
  audience: string;
}

export const PRODUCTS: Record<ProductKey, Product> = {
  lite: {
    key: "lite",
    name: "EILA",
    status: "live",
    subtitle: "Your AI assistant for commission, money, and daily execution.",
    description:
      "EILA brings the sales coach, day-to-day assistant, and personal money layer into one app so commission professionals can see the month, the money, and the next move.",
    longDescription:
      "EILA is the AI assistant for commission professionals — sales reps, agents, producers, closers, advisors, in any industry. She knows the goal, the pace, the pipeline, the day, and the money. Bills, cash flow, safe-to-spend, and financial clarity sit beside the sales rhythm so the user can make cleaner decisions without opening another system.",
    cta: "Meet EILA",
    href: PRODUCT_URLS.lite,
    features: ["Daily Mission", "Goal pacing", "Money layer", "AI coaching"],
    capabilities: [
      "The Daily Mission — your highest-leverage actions, every morning",
      "Goal pacing: know if you're ahead or behind, in real time",
      "A personal money layer for bills, cash flow, and safe-to-spend clarity",
      "Commission tracking for any pay structure — flat, tiered, grid, custom",
      "EILA drafts the next move so you're never starting blank",
      "Built for any commission professional, in any industry",
    ],
    audience: "Individual commission professionals",
  },
  dealer: {
    key: "dealer",
    name: "Dealer Mission OS",
    status: "comingSoon",
    subtitle: "Dealership operating system for automotive sales and finance teams.",
    description:
      "Dealer Mission OS helps dealerships track performance, sales activity, finance production, pay plans, goals, accountability, and daily execution.",
    longDescription:
      "Dealer Mission OS is the operating system for the modern dealership floor. It tracks performance, sales activity, finance production, pay plans, goals, and daily accountability — giving sales reps, F&I managers, desk managers, and operators a single source of truth and an AI assistant for every role. Already running live in early-access dealerships — opening more broadly soon.",
    cta: "Coming Soon",
    href: PRODUCT_URLS.dealer,
    features: ["Performance", "F&I production", "Pay plans", "Accountability"],
    capabilities: [
      "Live performance and sales-activity tracking",
      "Finance (F&I) production and product penetration",
      "Pay-plan modeling and commission visibility",
      "Goals, accountability, and daily execution",
      "An AI assistant for every role on the floor",
      "Built for sales, F&I, desk, and BDC teams",
    ],
    audience: "Dealerships, sales & finance teams",
  },
};

export const PRODUCT_LIST: Product[] = [PRODUCTS.lite, PRODUCTS.dealer];

// Top navigation.
export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Mission", href: "/mission" },
  { label: "Products", href: "/products" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
] as const;

// The mission — the spine of the brand.
export const MISSION_STATEMENT =
  "Commissioned 41 exists to help people and businesses take control of the mission in front of them, organize what matters, execute with purpose, and build systems that create freedom, clarity, and measurable growth.";

export const BRAND = {
  name: "Commissioned 41",
  tagline: "Know Your Mission. Execute With Purpose.",
  domain: "commissioned41.com",
} as const;
