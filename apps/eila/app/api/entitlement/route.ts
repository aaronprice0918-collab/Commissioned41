import { NextResponse } from "next/server";
import { getStripeServerClient } from "@/lib/stripe";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { rateLimited } from "@/lib/rateLimit";

// Is the signed-in user a paying subscriber? Verifies the caller's Supabase
// session token server-side (so an email can't be spoofed), then checks Stripe
// for an active subscription on that email. No webhook / extra table needed.
//
// Fails CLOSED: if billing is unconfigured or Stripe errors, we do NOT grant
// access in production. (Dev gets a convenience pass so local work isn't blocked.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL; // any Vercel deploy (previews too) enforces the gate — only true local dev gets the convenience pass

export async function POST(req: Request) {
  const stripe = getStripeServerClient();
  if (!stripe) {
    // No billing configured. In prod, nobody is entitled; in dev, let work through.
    return IS_PROD
      ? NextResponse.json({ active: false, reason: "billing-unconfigured" })
      : NextResponse.json({ active: true, reason: "dev-no-billing" });
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ active: false, reason: "not-signed-in" });

  // Rate-limited like every other Stripe-touching route: without the
  // entitlements table each call can fan out to customers.list + up to 20
  // subscription reads on Stripe (July 8 audit).
  // Deliberately NO `reason` on the 429: the client wall only paywalls on a
  // reason, and a rate-limit hit is a cost guard, not an access verdict — it
  // must never flash the paywall at a paying user mid-burst.
  if (await rateLimited(`entitlement:${email}`, 60_000, 30)) {
    return NextResponse.json({ active: false }, { status: 429 });
  }

  try {
    const active = await hasActiveSubscription(email);
    // `reason` is REQUIRED on every inactive response: AppShell's deep-link
    // wall only paywalls when a reason is present, so the bare {active:false}
    // this used to return let a lapsed subscriber keep using every page
    // except "/" (July 8 audit, HIGH).
    return NextResponse.json(active ? { active, email } : { active, email, reason: "no-subscription" });
  } catch (e) {
    // Fail closed: never grant access on an error. Log details server-side only.
    console.error("[entitlement] stripe check failed:", e);
    return NextResponse.json({ active: false, reason: "check-failed" });
  }
}
