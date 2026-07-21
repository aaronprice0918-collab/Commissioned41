import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeServerClient } from "@/lib/stripe";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { type BillingState } from "@/lib/billing";

// Stripe → Dealer Mission OS. Stripe calls this when a store's subscription is
// created, renewed, changed, or canceled. We verify the signature (only the
// real Stripe can write here), resolve WHICH org the event belongs to (the
// checkout carries metadata.orgId, and it's stamped onto the subscription
// too), then mirror the subscription state onto that org's server-only
// `billing` app_store row — the row orgEntitled() reads on every request.
//
// Safe to deploy unconfigured: without the signing secret this returns 503
// and writes nothing, and entitlement stays fail-open (lib/billing.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(req: Request) {
  const stripe = getStripeServerClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabase = getSupabaseServerClient();
  if (!stripe || !secret || !supabase) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  // Verify against the RAW body — a forged signature throws and gets a 400.
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig || "", secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    // Always read the CURRENT subscription from Stripe rather than trusting
    // the event payload — deliveries aren't ordered, so an old retry's payload
    // could otherwise land after a newer one (same hardening as the lite app).
    const { sub, orgId } = await subscriptionForEvent(stripe, event);
    if (!sub || !orgId) {
      // Not ours (no orgId metadata) or already gone — acknowledge, don't retry.
      return NextResponse.json({ received: true, unmatched: true });
    }

    // Ordering guard on top of the live refetch: never let an event we KNOW is
    // chronologically older overwrite a newer write.
    const { data: existingRow } = await supabase
      .from("app_store").select("value").eq("org_id", orgId).eq("key", "billing").maybeSingle();
    const existing = (existingRow?.value ?? null) as BillingState | null;
    const existingCreated = existing?.eventCreated ? new Date(existing.eventCreated).getTime() : 0;
    if (existingCreated > event.created * 1000) {
      return NextResponse.json({ received: true, stale: true });
    }
    // Hand-comped stores stay comped — a stray Stripe event (e.g. a canceled
    // test subscription) must not downgrade a store Aaron comped on purpose.
    if (existing?.status === "comped") {
      return NextResponse.json({ received: true, comped: true });
    }

    const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
    const value: BillingState = {
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
      subscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
      priceId: sub.items.data[0]?.price?.id,
      eventCreated: new Date(event.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supabase.from("app_store").upsert(
      { org_id: orgId, key: "billing", value, updated_at: new Date().toISOString() },
      { onConflict: "org_id,key" },
    );
    if (error) throw new Error(error.message);

    console.log(`[stripe/webhook] org ${orgId} → ${sub.status} (${event.type})`);
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[stripe/webhook]", e);
    // 500 → Stripe retries, which is what we want for transient DB failures.
    return NextResponse.json({ error: "Webhook handling failed." }, { status: 500 });
  }
}

async function subscriptionForEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<{ sub: Stripe.Subscription | null; orgId: string | null }> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!subId) return { sub: null, orgId: null };
    const sub = await stripe.subscriptions.retrieve(subId);
    // The checkout carries the orgId; it's also stamped on the subscription.
    const orgId = session.metadata?.orgId || sub.metadata?.orgId || null;
    return { sub, orgId };
  }
  const raw = event.data.object as Stripe.Subscription;
  // subscription.deleted still resolves — retrieve returns the canceled state.
  const sub = await stripe.subscriptions.retrieve(raw.id).catch(() => raw);
  return { sub, orgId: sub.metadata?.orgId || raw.metadata?.orgId || null };
}
