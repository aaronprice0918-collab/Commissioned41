import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeServerClient } from "@/lib/stripe";
import { getSupabaseAdmin, ENTITLEMENTS_TABLE } from "@/lib/supabaseAdmin";
import { isEntitledStatus } from "@/lib/entitlement";
import { notifyFailure } from "@/lib/alert";

// Stripe webhook for Mission OS Lite. Stripe calls this endpoint whenever a
// subscription is created, renewed, changed, or canceled. We verify the
// signature (so only the real Stripe can write here), then mirror the
// subscription's status into the lite_entitlements table. The app's entitlement
// check reads that table first — so access flips on/off promptly without the app
// having to phone Stripe on every page load.
//
// Safe to deploy before configuration: if the signing secret or the service-role
// key isn't set, the endpoint returns 503 and writes nothing. The entitlement
// check then keeps falling back to a live Stripe lookup (current behavior), so
// nothing breaks in the meantime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Subscription lifecycle + the checkout completion event. checkout.session.completed
// is the fastest signal that a brand-new subscriber just paid.
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(req: Request) {
  const stripe = getStripeServerClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const admin = getSupabaseAdmin();

  // Not configured yet — acknowledge nothing, do nothing, leak nothing.
  if (!stripe || !secret || !admin) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  // Verify the signature against the RAW request body. A bad/forged signature
  // throws and we reject with 400 — only genuine Stripe events get past here.
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig || "", secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    // Acknowledge unhandled events so Stripe doesn't retry them.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    // For subscription.* events, always read the CURRENT state from Stripe
    // rather than trusting the event's own payload — Stripe doesn't guarantee
    // delivery order, so an older retry's payload could otherwise land after
    // a newer one. This makes the write itself order-independent instead of
    // just detecting the problem after the fact (July 5 audit).
    const sub = await subscriptionForEvent(stripe, event);
    if (sub) {
      const email = await emailForCustomer(stripe, sub.customer);
      if (email) {
        const eventCreatedIso = new Date(event.created * 1000).toISOString();

        // Belt-and-suspenders on top of the live-refetch above: if two
        // deliveries still race, never let an event we know is chronologically
        // older overwrite a row a newer event already wrote. Falls back to
        // "always write" if `event_created` isn't provisioned yet (graceful
        // degrade — matches this route's existing "safe to deploy before
        // configuration" posture) rather than erroring the whole webhook.
        const { data: existing, error: existingErr } = await admin
          .from(ENTITLEMENTS_TABLE)
          .select("event_created")
          .eq("email", email.toLowerCase())
          .maybeSingle();
        const existingCreated = !existingErr
          ? (existing as { event_created?: string | null } | null)?.event_created
          : null;
        const isStale = !!existingCreated && new Date(existingCreated).getTime() > event.created * 1000;

        if (!isStale) {
          await admin.from(ENTITLEMENTS_TABLE).upsert(
            {
              email: email.toLowerCase(),
              status: sub.status,
              entitled: isEntitledStatus(sub.status),
              stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
              current_period_end: periodEndIso(sub),
              updated_at: new Date().toISOString(),
              ...(existingErr ? {} : { event_created: eventCreatedIso }),
            },
            { onConflict: "email" },
          );
        }

        // Referral reward — only on the actual conversion event, never on
        // later renewals/updates for the same subscription (checkout.session.
        // completed fires exactly once per new subscription).
        if (event.type === "checkout.session.completed") {
          await rewardReferralIfAny(stripe, admin, sub, email.toLowerCase());
        }
      }
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    // A billing event reached us but we couldn't record it. Alert immediately
    // (this is the "a payment event didn't land" case Aaron wants to know about),
    // then return 500 so Stripe retries rather than silently dropping it.
    await notifyFailure(
      "webhook processing failed",
      `event=${event.type} id=${event.id}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}

// Current period end moved onto subscription items in recent Stripe API
// versions. Read it defensively (it's informational only — the entitlement
// decision is purely `status`) and return null if it isn't present.
function periodEndIso(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const secs = item?.current_period_end;
  return typeof secs === "number" ? new Date(secs * 1000).toISOString() : null;
}

// Resolve the Subscription object an event refers to — always by RE-FETCHING
// from Stripe rather than trusting the event's own embedded payload. Stripe
// doesn't guarantee webhook delivery order, so an older retry's payload could
// otherwise land after a newer one and overwrite good state with stale status;
// asking Stripe for the subscription's current truth makes the write
// order-independent instead of order-sensitive (July 5 audit).
async function subscriptionForEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<Stripe.Subscription | null> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription" || !session.subscription) return null;
    const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    return stripe.subscriptions.retrieve(id);
  }
  const id = (event.data.object as Stripe.Subscription).id;
  return stripe.subscriptions.retrieve(id);
}

// Get the billing email for a customer (string id or expanded object). Deleted
// customers come back with { deleted: true } and no email — handled as null.
async function emailForCustomer(
  stripe: Stripe,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): Promise<string | null> {
  const obj = typeof customer === "string" ? await stripe.customers.retrieve(customer) : customer;
  if (!obj || obj.deleted) return null;
  return (obj as Stripe.Customer).email || null;
}

// "Invite a colleague, you both get a free month." The REFERRED person's
// free month is already applied as a Stripe coupon at checkout time (see
// /api/checkout) — this just RECORDS that half of the referral so the
// /api/cron/referral-rewards job can credit the referrer roughly 24h later.
// Crediting is deliberately NOT done here (Aaron's call, July 5 audit): if
// the referred person's card gets disputed/refunded same-day, the referrer
// should never have been paid out in the first place. The cron re-checks the
// referred person is still actually active before crediting, and also
// enforces the 12-free-months/year-per-referrer cap there.
//
// The redemption row's UNIQUE constraint on referred_email is what makes
// this safe against Stripe's at-least-once webhook delivery: if this event
// gets redelivered (a retry, a duplicate), the insert fails as a duplicate
// and the referrer is never queued for a reward twice for the same person.
async function rewardReferralIfAny(
  stripe: Stripe,
  admin: SupabaseClient,
  sub: Stripe.Subscription,
  referredEmail: string,
): Promise<void> {
  const code = sub.metadata?.referral_code;
  const referrerEmail = sub.metadata?.referrer_email;
  if (!code || !referrerEmail || referrerEmail === referredEmail) return;

  const { error: insertError } = await admin
    .from("lite_referral_redemptions")
    .insert({ code, referred_email: referredEmail, referrer_email: referrerEmail });
  if (insertError) return; // duplicate (already queued) or table missing — either way, stop here
}
