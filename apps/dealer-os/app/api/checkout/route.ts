import { NextResponse } from "next/server";
import { getStripeServerClient, getMissionOsPriceId } from "@/lib/stripe";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { resolveAppOrigin } from "@/lib/appOrigin";

// Creates a Stripe Checkout Session for the Dealer Mission OS $499/mo subscription and
// returns its hosted-page URL. The browser then redirects the store there to pay.
// No money moves until Stripe processes a real (or test) card on that page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = getStripeServerClient();
  const priceId = getMissionOsPriceId();
  if (!stripe || !priceId) {
    return NextResponse.json(
      { error: "Billing isn't configured right now." },
      { status: 503 },
    );
  }

  // Throttle checkout-session creation per IP — this endpoint is reachable
  // unauthenticated (signup flow), so cap it against Stripe-session spam.
  const rl = await rateLimit(clientKey(req), { limit: 10, windowSec: 60 });
  if (!rl.ok) return tooManyRequests(rl);

  // Build success/cancel URLs from an allowlisted origin — never a raw,
  // attacker-controllable Origin header (SOC 2 CC6.1).
  const origin = resolveAppOrigin(req);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const email = typeof body.email === "string" ? body.email : undefined;
    // The store being paid for. Comes from the signup flow (provisionOrg's
    // returned orgId) or the /billing page (the caller's own org). Without it,
    // checkout still works but the webhook can't activate anyone — so the
    // pricing page passes it whenever the caller is signed in.
    let orgId = typeof body.orgId === "string" && /^[0-9a-f-]{36}$/i.test(body.orgId) ? body.orgId : undefined;
    // A SIGNED-IN caller pays for their OWN store, full stop — the body value
    // is only trusted for the signup flow, where no session exists yet.
    const supabase = getSupabaseServerClient();
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (supabase && token) {
      const { data } = await supabase.auth.getUser(token);
      if (data.user) {
        const { data: profile } = await supabase.from("user_profiles").select("org_id").eq("id", data.user.id).maybeSingle();
        if (profile?.org_id) orgId = String(profile.org_id);
      }
    }
    const metadata: Record<string, string> = { app: "missionos", ...(orgId ? { orgId } : {}) };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // Stores can apply promo codes (e.g. a launch discount) right on the page.
      allow_promotion_codes: true,
      customer_email: email,
      success_url: orgId
        ? `${origin}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`
        : `${origin}/pricing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: orgId ? `${origin}/billing?status=cancel` : `${origin}/pricing?status=cancel`,
      metadata,
      // The orgId rides on the subscription too, so every later lifecycle
      // event (renewal, cancel) resolves back to the store without a lookup.
      subscription_data: { metadata },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[checkout]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 400 });
  }
}
