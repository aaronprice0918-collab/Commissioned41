import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ORG_ID } from "@/lib/orgs";

// ── Org billing / entitlement — the one brain ────────────────────────────────
// Dealer Mission OS bills PER STORE (org), $499/mo via Stripe. The org's
// subscription state lives on the org-scoped `billing` app_store row, written
// ONLY by the Stripe webhook (service role) — the key is deliberately NOT in
// /api/store's allowedKeys, so no client can read or forge it. Server routes
// call orgEntitled() before serving data.
//
// Fail-open by design: with no STRIPE_SECRET_KEY configured, billing is off
// and every org is entitled — shipping this file changes nothing until Aaron
// adds the Stripe keys. Kennesaw (the default org) is permanently entitled;
// it's the proof-of-concept store, not a customer.

export type BillingState = {
  stripeCustomerId?: string;
  subscriptionId?: string;
  // Stripe subscription status verbatim ("active", "trialing", "past_due",
  // "canceled", …) plus our own "comped" for partner stores granted free
  // access by hand.
  status?: string;
  currentPeriodEnd?: string; // ISO
  priceId?: string;
  // Stripe event.created of the write — the ordering guard: an older retry
  // never overwrites a newer state.
  eventCreated?: string; // ISO
  updatedAt?: string; // ISO
};

// Currently paying, in a paid trial, or comped by us. past_due is a dunning
// state (a payment failed) — NOT entitled; the courtesy window below keeps a
// hiccup from bricking a store mid-day.
const ACTIVE = new Set(["active", "trialing", "comped"]);

export function isEntitledStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE.has(status);
}

// New orgs get this long from creation before an active subscription is
// REQUIRED. Covers the minutes between provisioning and the Stripe webhook
// landing, and gives a demo org room to evaluate before paying.
export const COURTESY_DAYS = 14;

/** Pure decision — injectable inputs so it's unit-testable. */
export function decideEntitlement(input: {
  stripeConfigured: boolean;
  orgId: string;
  billing: BillingState | null;
  orgCreatedAt: string | null;
  now?: Date;
}): { entitled: boolean; reason: string } {
  const now = input.now ?? new Date();
  if (!input.stripeConfigured) return { entitled: true, reason: "billing_off" };
  if (input.orgId === DEFAULT_ORG_ID) return { entitled: true, reason: "founding_store" };
  if (isEntitledStatus(input.billing?.status)) return { entitled: true, reason: input.billing!.status! };
  if (!input.billing?.status) {
    // Never subscribed (or the webhook hasn't landed yet): courtesy window
    // from org creation. An org with no created_at is grandfathered — it
    // predates billing and we will not brick it.
    if (!input.orgCreatedAt) return { entitled: true, reason: "grandfathered" };
    const created = new Date(input.orgCreatedAt).getTime();
    if (!Number.isFinite(created)) return { entitled: true, reason: "grandfathered" };
    const inWindow = now.getTime() - created < COURTESY_DAYS * 24 * 60 * 60 * 1000;
    return inWindow ? { entitled: true, reason: "courtesy_window" } : { entitled: false, reason: "never_subscribed" };
  }
  // Had a subscription; it's not active anymore (canceled / past_due / unpaid).
  return { entitled: false, reason: input.billing.status };
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** Read the org's billing row (server-only key; service-role client). */
export async function readOrgBilling(supabase: SupabaseClient, orgId: string): Promise<BillingState | null> {
  const { data } = await supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", "billing").maybeSingle();
  return data?.value && typeof data.value === "object" ? (data.value as BillingState) : null;
}

/** The server-route gate. One extra row read per request; fail-open on read
 * errors so a Supabase blip never locks a paying store out. */
export async function orgEntitled(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ entitled: boolean; reason: string; billing: BillingState | null }> {
  if (!stripeConfigured()) return { entitled: true, reason: "billing_off", billing: null };
  if (orgId === DEFAULT_ORG_ID) return { entitled: true, reason: "founding_store", billing: null };
  try {
    const billing = await readOrgBilling(supabase, orgId);
    const { data: org } = await supabase.from("organizations").select("created_at").eq("id", orgId).maybeSingle();
    const decision = decideEntitlement({
      stripeConfigured: true,
      orgId,
      billing,
      orgCreatedAt: (org?.created_at as string | undefined) ?? null,
    });
    return { ...decision, billing };
  } catch {
    return { entitled: true, reason: "check_failed_open", billing: null };
  }
}
