import Stripe from "stripe";

// Server-side Stripe client. Mirrors getSupabaseServerClient(): returns null when
// the key isn't configured, so callers can fail gracefully instead of crashing.
export function getStripeServerClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // Pin the API version so a Stripe-side default change can't silently alter
  // billing/webhook behavior (SOC 2 CC8.1). Matches the pinned SDK (stripe@22.2.3)
  // and the webhook endpoint's own API version.
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

// The $499/mo Dealer Mission OS price, created by scripts/stripe-setup.mjs.
export function getMissionOsPriceId() {
  return process.env.STRIPE_PRICE_ID || null;
}
