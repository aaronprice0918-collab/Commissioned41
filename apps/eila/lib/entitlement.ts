import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getStripeServerClient } from "@/lib/stripe";
import { getSupabaseAdmin, ENTITLEMENTS_TABLE } from "@/lib/supabaseAdmin";

// Shared entitlement helpers for server routes. Verifies the caller's Supabase
// session token server-side (so an email can't be spoofed) and checks whether
// that email has an active subscription. Used by /api/entitlement,
// /api/parse-payplan, and /api/portal so the auth + billing logic lives in
// exactly one place.

// "active" for our purposes = currently paying or in a paid trial. past_due is a
// dunning state (a payment failed) — treat it as INACTIVE, not entitled. canceled
// / unpaid / incomplete are likewise not entitled. "comped" is ours, not Stripe's:
// /api/team writes it for accounts granted free access via a team code
// (dealership partners etc.), so those rows entitle without any subscription.
const ACTIVE = new Set(["active", "trialing", "comped"]);

// Pure status check — exported so it can be unit-tested in isolation and reused
// by the webhook when it decides what to persist. A subscription entitles the
// user iff its Stripe status is active or trialing.
export function isEntitledStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE.has(status);
}

// Owner / comp allowlist. Emails listed in COMP_EMAILS (comma-separated) get full
// access without a Stripe subscription — for the owner, team, and comped accounts.
// Pure + injectable so it's unit-testable. Case-insensitive.
export function isCompEmail(email: string, raw = process.env.COMP_EMAILS): boolean {
  if (!email) return false;
  const set = (raw || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return set.includes(email.toLowerCase());
}

// The OWNER — the only person who may see the Owner dashboard (everyone's
// emails + activity). Separate from COMP_EMAILS (which now also holds comped
// TEAM members) so team access can never accidentally open the owner view.
// The pure check lives in lib/owner.ts (client-safe); re-exported here.
export { isOwner } from "./owner";

// Built-in code lists, so the shareable links work with zero dashboard config.
// Setting the matching env var (TRIAL_CODES / TEAM_CODES) REPLACES the default
// entirely — that's the rotate/revoke lever when a code has spread too far.
const DEFAULT_TRIAL_CODES = "welcome30";
const DEFAULT_TEAM_CODES = "kennesaw-mazda";

// One comma-separated, case-insensitive code list — shared shape for trial and
// team codes. Pure + injectable so it's unit-testable.
function codeSet(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Trial invite codes (30 days free, card up front, converts to paid). Used by
// /api/checkout to validate and /free-trial to pick the default link code.
export function isValidTrialCode(
  code: string,
  raw = process.env.TRIAL_CODES || DEFAULT_TRIAL_CODES,
): boolean {
  return !!code && codeSet(raw || "").includes(code.trim().toLowerCase());
}

export function firstTrialCode(raw = process.env.TRIAL_CODES || DEFAULT_TRIAL_CODES): string | null {
  return codeSet(raw || "")[0] || null;
}

// Team comp codes. Codes listed here grant free "comped" access to whole groups
// — e.g. a partner dealership's sales team — via a /team/<code> link, with no
// card and no trial clock.
export function isValidTeamCode(
  code: string,
  raw = process.env.TEAM_CODES || DEFAULT_TEAM_CODES,
): boolean {
  return !!code && codeSet(raw || "").includes(code.trim().toLowerCase());
}

// Verify a Supabase session token and return the user's id + lowercased
// email, or null. The one place this actually happens — every route that
// needs "who is this" goes through here (or the getSessionEmail wrapper
// below) instead of hand-rolling its own copy, so there's a single spot to
// add logging/behavior changes (consolidated July 5 audit: three routes had
// each grown their own byte-for-byte copy of this).
export async function getSessionUser(token: string | null): Promise<{ id: string; email: string | null } | null> {
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const sb = createClient(url, anon);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email?.toLowerCase() || null };
  } catch (e) {
    console.error("[auth] getSessionUser failed", e);
    return null;
  }
}

// Verify a Supabase session token and return the lowercased email, or null.
export async function getSessionEmail(token: string | null): Promise<string | null> {
  const user = await getSessionUser(token);
  return user?.email ?? null;
}

// Fast path: read entitlement from the lite_entitlements table that the Stripe
// webhook keeps up to date. Returns:
//   true  -> a row says this email is entitled
//   false -> a row says this email is NOT entitled (canceled/past_due/etc.)
//   null  -> no table configured, no row yet, or a read error => caller should
//            fall back to a live Stripe lookup (don't trust an absent row as "no")
async function entitlementFromTable(email: string): Promise<boolean | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from(ENTITLEMENTS_TABLE)
      .select("status")
      .eq("email", email)
      .maybeSingle();
    if (error || !data) return null;
    return isEntitledStatus(data.status as string);
  } catch {
    return null;
  }
}

// Authoritative-but-slow path: ask Stripe directly. Throws on a Stripe/config
// error so callers can decide how to fail (the routes fail CLOSED).
async function entitlementFromStripe(email: string): Promise<boolean> {
  const stripe = getStripeServerClient();
  if (!stripe) throw new Error("stripe-not-configured");
  const customers = await stripe.customers.list({ email, limit: 20 });
  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 20 });
    if (subs.data.some((s) => isEntitledStatus(s.status))) return true;
  }
  return false;
}

// Does this email have a live (active or trialing) subscription? Checks the fast
// webhook-fed table first; if that can't answer (not configured / no row yet),
// falls back to a live Stripe lookup. This keeps correctness even before the
// webhook has backfilled a given customer, while making the common case a single
// indexed row read instead of multiple Stripe API calls.
export async function hasActiveSubscription(email: string): Promise<boolean> {
  // Owner / comp accounts always have access, no billing required.
  if (isCompEmail(email)) return true;
  const fromTable = await entitlementFromTable(email);
  if (fromTable !== null) return fromTable;
  return entitlementFromStripe(email);
}

// ---- Platinum VIP ($9.99/mo add-on: live bank connection) ----

// Does this email carry the VIP add-on? Comp accounts (owner/team) are VIP
// automatically. Otherwise scan the customer's subscriptions for an item on
// the VIP price. Live Stripe lookup only (no table fast-path yet) — VIP-gated
// routes are rate-limited by their callers.
export async function hasVipSubscription(email: string): Promise<boolean> {
  if (isCompEmail(email)) return true;
  const { getStripeServerClient } = await import("./stripe");
  const { appConfig } = await import("./appConfig");
  const stripe = getStripeServerClient();
  const vipPrice = await appConfig("STRIPE_VIP_PRICE_ID");
  if (!stripe || !vipPrice) return false; // unconfigured = nobody is VIP, fail closed
  const customers = await stripe.customers.list({ email, limit: 20 });
  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 20 });
    for (const s of subs.data) {
      if (!isEntitledStatus(s.status)) continue;
      if (s.items.data.some((it) => it.price?.id === vipPrice)) return true;
    }
  }
  return false;
}
