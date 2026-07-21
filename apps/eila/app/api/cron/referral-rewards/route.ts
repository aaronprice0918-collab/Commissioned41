import { NextResponse } from "next/server";
import { getStripeServerClient, getLitePriceId } from "@/lib/stripe";
import { getSupabaseAdmin, ENTITLEMENTS_TABLE } from "@/lib/supabaseAdmin";
import { notifyFailure } from "@/lib/alert";

// Pays out "invite a colleague" referral rewards — deliberately NOT done
// synchronously in the Stripe webhook. Runs once daily (vercel.json cron).
// Aaron's call (July 5 audit): waiting ~24h before crediting the referrer
// means a same-day card dispute/refund on the REFERRED person never should
// have paid out in the first place, and it gives one place to enforce a cap
// (12 free months per referrer per rolling year) so a referrer can't cycle
// colleagues' emails for unlimited credits.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAP_PER_YEAR = 12;
const DELAY_MS = 24 * 60 * 60 * 1000;

interface RedemptionRow {
  id: string;
  code: string;
  referred_email: string;
  referrer_email: string | null;
  created_at: string;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Cron not configured." }, { status: 503 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const stripe = getStripeServerClient();
  const priceId = getLitePriceId();
  if (!admin || !stripe || !priceId) {
    return NextResponse.json({ error: "Referral rewards aren't configured yet." }, { status: 503 });
  }

  const cutoff = new Date(Date.now() - DELAY_MS).toISOString();
  const { data: due, error: dueErr } = await admin
    .from("lite_referral_redemptions")
    .select("id, code, referred_email, referrer_email, created_at")
    .is("processed_at", null)
    .lte("created_at", cutoff);
  if (dueErr) return NextResponse.json({ error: dueErr.message }, { status: 500 });
  if (!due?.length) return NextResponse.json({ credited: 0, declined: 0, total: 0 });

  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const price = await stripe.prices.retrieve(priceId);
  const amount = price.unit_amount ?? 1999;

  let credited = 0;
  let declined = 0;

  for (const row of due as RedemptionRow[]) {
    const referrerEmail = row.referrer_email;
    if (!referrerEmail) {
      await admin.from("lite_referral_redemptions").update({ processed_at: new Date().toISOString() }).eq("id", row.id);
      declined++;
      continue;
    }

    try {
      // Still actually subscribed? A same-day dispute/refund/cancel means no
      // reward — this is the whole reason crediting waits 24h.
      const { data: referredRow } = await admin
        .from(ENTITLEMENTS_TABLE)
        .select("entitled")
        .eq("email", row.referred_email)
        .maybeSingle();
      const stillActive = !!(referredRow as { entitled?: boolean } | null)?.entitled;
      if (!stillActive) {
        await admin.from("lite_referral_redemptions").update({ processed_at: new Date().toISOString() }).eq("id", row.id);
        declined++;
        continue;
      }

      // 12-free-months/year-per-referrer cap.
      const { count } = await admin
        .from("lite_referral_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("referrer_email", referrerEmail)
        .not("rewarded_at", "is", null)
        .gte("rewarded_at", yearAgo);
      if ((count ?? 0) >= CAP_PER_YEAR) {
        await admin.from("lite_referral_redemptions").update({ processed_at: new Date().toISOString() }).eq("id", row.id);
        declined++;
        continue;
      }

      const { data: referrerRow } = await admin
        .from(ENTITLEMENTS_TABLE)
        .select("stripe_customer_id")
        .eq("email", referrerEmail)
        .maybeSingle();
      const customerId = (referrerRow as { stripe_customer_id?: string } | null)?.stripe_customer_id;
      if (!customerId) {
        await admin.from("lite_referral_redemptions").update({ processed_at: new Date().toISOString() }).eq("id", row.id);
        declined++;
        continue;
      }

      // Idempotency key = one credit per redemption row, ever. Without it, a
      // crash AFTER Stripe credits but BEFORE we mark rewarded_at/processed_at
      // (the two are separate calls) would re-credit on tomorrow's run — a real
      // double-payout. With the key, Stripe returns the original transaction
      // instead of creating a second one, so the retry is safe (July 15 audit).
      await stripe.customers.createBalanceTransaction(
        customerId,
        {
          amount: -amount,
          currency: price.currency || "usd",
          description: `Referral reward — thanks for sharing EILA (${row.referred_email} subscribed)`,
        },
        { idempotencyKey: `referral-reward-${row.id}` },
      );
      const now = new Date().toISOString();
      await admin.from("lite_referral_redemptions").update({ rewarded_at: now, processed_at: now }).eq("id", row.id);
      credited++;
    } catch (e) {
      // Leave processed_at unset so a transient failure (Stripe blip, etc.)
      // gets retried tomorrow instead of being silently dropped forever.
      await notifyFailure(
        "referral reward failed",
        `referrer=${referrerEmail} referred=${row.referred_email}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return NextResponse.json({ credited, declined, total: due.length });
}
