import { NextResponse } from "next/server";
import { getStripeServerClient } from "@/lib/stripe";
import { getSessionEmail } from "@/lib/entitlement";

// Opens the Stripe Customer Billing Portal for the signed-in user so they can
// update their card, see invoices, or cancel. Verifies the Supabase session
// token server-side, finds their Stripe customer by email, and returns the
// hosted portal URL for the browser to redirect to.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = getStripeServerClient();
  if (!stripe) return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // Never the caller-controlled Origin header — mirror the checkout route's
  // July 8 hardening so the Stripe return_url can only ever point at this app's
  // own host, not an attacker-chosen domain from a forged Origin.
  const origin = new URL(req.url).origin;

  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer = customers.data[0];
    if (!customer) return NextResponse.json({ error: "No subscription found." }, { status: 400 });

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${origin}/`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[portal] stripe error:", e);
    return NextResponse.json({ error: "Could not open billing portal." }, { status: 400 });
  }
}
