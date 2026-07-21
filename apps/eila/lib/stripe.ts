import "server-only";
import Stripe from "stripe";

// Server-side Stripe client for Mission OS Lite checkout. Returns null when the
// secret key isn't set, so the app deploys safely before billing is configured.
let cached: Stripe | null = null;

export function getStripeServerClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) cached = new Stripe(key);
  return cached;
}

// The recurring price for the Mission OS Lite subscription ($19.99/mo), created
// in the Stripe dashboard. Set STRIPE_LITE_PRICE_ID in the environment.
export function getLitePriceId(): string | undefined {
  return process.env.STRIPE_LITE_PRICE_ID;
}
