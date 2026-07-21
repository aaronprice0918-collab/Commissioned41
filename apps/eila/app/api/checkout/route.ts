import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/rateLimit";
import { getStripeServerClient, getLitePriceId } from "@/lib/stripe";
import { appConfig } from "@/lib/appConfig";
import { getSessionEmail, isValidTrialCode } from "@/lib/entitlement";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Creates a Stripe Checkout Session for the Mission OS Lite $19.99/mo subscription
// and returns its hosted-page URL. The browser redirects the buyer there to pay.
// No money moves until Stripe processes a real (or test) card on that page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Use the platform-trusted client IP (Vercel sets x-real-ip), NOT the
  // caller-supplied leftmost X-Forwarded-For entry — this is the only
  // unauthenticated endpoint, and an attacker could rotate a forged XFF to reset
  // the cap and drive unbounded Stripe session creation. Fall back to the
  // RIGHTMOST XFF hop (the one the platform appends) and only then "anon".
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = (req.headers.get("x-real-ip") || xff[xff.length - 1] || "anon").trim();
  if (await rateLimited(`checkout:${ip}`, 300_000, 10)) return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  const stripe = getStripeServerClient();
  const priceId = getLitePriceId();
  if (!stripe || !priceId) {
    return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });
  }

  // Absolute success/cancel URLs from the request's OWN host — works on
  // localhost, preview, and lite.commissioned41.com without hard-coding a
  // domain. Never the caller-controlled Origin header: a forged Origin built
  // a Stripe session that redirected the payer to an attacker-chosen domain
  // after payment (July 8 audit).
  const origin = new URL(req.url).origin;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Prefer the SESSION-verified email when the caller is signed in — the
    // self-referral guard below must not compare against a spoofable body
    // field (July 8 audit). Anonymous checkout (pre-signup) keeps body.email.
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const sessionEmail = token ? await getSessionEmail(token) : null;
    const email = sessionEmail ?? (typeof body.email === "string" ? body.email : undefined);

    // Platinum VIP add-on ($9.99/mo — live bank connection). Its own price and
    // its own subscription; must be signed in so the add-on lands on the right
    // member. No invite trials or referral coupons on the add-on.
    if (body.tier === "vip") {
      if (!sessionEmail) return NextResponse.json({ error: "Sign in first, then upgrade to VIP." }, { status: 401 });
      const vipPrice = await appConfig("STRIPE_VIP_PRICE_ID");
      if (!vipPrice) return NextResponse.json({ error: "VIP isn't configured yet." }, { status: 503 });
      const vipSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: vipPrice, quantity: 1 }],
        customer_email: sessionEmail,
        success_url: `${origin}/money?vip=success`,
        cancel_url: `${origin}/money?vip=cancel`,
        metadata: { app: "missionos-lite", tier: "vip" },
        subscription_data: { metadata: { app: "missionos-lite", tier: "vip" } },
      });
      return NextResponse.json({ url: vipSession.url });
    }

    // Invite codes (isValidTrialCode: TRIAL_CODES env or the built-in default)
    // grant a 30-day free trial: card up front, $0 today, auto-converts to
    // $19.99/mo on day 31 unless canceled. Entitlement already honors Stripe's
    // "trialing" status, so access flips on the moment checkout completes. An
    // invalid code errors clearly rather than silently charging full price.
    const invite = typeof body.invite === "string" ? body.invite.trim() : "";
    let trial = false;
    if (invite) {
      if (!isValidTrialCode(invite)) {
        return NextResponse.json({ error: "That invite code isn't valid." }, { status: 400 });
      }
      trial = true;
    }

    // Referral codes ("invite a colleague, you both get a free month") are
    // per-user, not a shared marketing code like `invite` above — looked up
    // in lite_referrals rather than an env var list. A bad/stale code is
    // silently dropped rather than blocking checkout; the reward for the
    // REFERRER happens later, in the webhook, once we know this is a real
    // paying conversion. Never stack with an invite trial — enforced here,
    // server-side, not just in the client UI (a caller could otherwise send
    // both fields directly and get a 30-day trial PLUS a free month after it,
    // caught in the July 5 audit).
    const referral = !trial && typeof body.referral === "string" ? body.referral.trim().toUpperCase() : "";
    let referrerEmail: string | null = null;
    if (referral) {
      const admin = getSupabaseAdmin();
      if (admin) {
        const { data } = await admin
          .from("lite_referrals")
          .select("referrer_email")
          .eq("code", referral)
          .maybeSingle();
        // Never let someone redeem their own code for a free month.
        if (data?.referrer_email && data.referrer_email !== email?.toLowerCase()) {
          referrerEmail = data.referrer_email;
        }
      }
    }
    const referralCouponId = referrerEmail ? process.env.STRIPE_REFERRAL_COUPON_ID : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: !referralCouponId, // Stripe disallows both at once
      customer_email: email,
      success_url: `${origin}/subscribe?status=success`,
      cancel_url: `${origin}/subscribe?status=cancel`,
      metadata: { app: "missionos-lite" },
      ...(referralCouponId ? { discounts: [{ coupon: referralCouponId }] } : {}),
      subscription_data: {
        metadata: {
          app: "missionos-lite",
          ...(trial ? { invite: invite.toLowerCase() } : {}),
          ...(referrerEmail ? { referral_code: referral, referrer_email: referrerEmail } : {}),
        },
        ...(trial ? { trial_period_days: 30 } : {}),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not start checkout. Try again or contact support@commissioned41.com." },
      { status: 400 },
    );
  }
}
