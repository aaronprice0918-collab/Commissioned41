import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { notifyFailure } from "@/lib/alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Bounds how long we'll wait on any single dependency check. Without this, a
// hung Anthropic/Stripe/Supabase call could silently eat the whole run (audit
// finding, July 5) — a degraded dependency should show up as its own failure,
// not as a mysteriously-timed-out cron with no useful alert.
const CHECK_TIMEOUT_MS = 8000;
function withTimeout(label: string, p: Promise<string | null>): Promise<string | null> {
  return Promise.race([
    p,
    new Promise<string | null>((resolve) => setTimeout(() => resolve(`${label} timed out after ${CHECK_TIMEOUT_MS / 1000}s`), CHECK_TIMEOUT_MS)),
  ]);
}

// The gap "make EILA airtight" left open: every other alert in this app is
// REACTIVE — it fires from inside a real user's request when something
// breaks for them. Nothing was watching the systems themselves, so a silent
// outage (a rotated key that broke, Stripe down, the DB unreachable) would
// only surface once a customer complained. This runs daily, checks the three
// things that would actually take EILA down, and pages Slack the moment one
// of them fails — cheap, read-only calls only (no tokens spent, no real
// charges), so this never costs meaningfully more than it protects.
async function checkAnthropic(): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "ANTHROPIC_API_KEY is not set.";
  try {
    const client = new Anthropic();
    await client.models.list({ limit: 1 });
    return null;
  } catch (e) {
    return `Anthropic API unreachable: ${e instanceof Error ? e.message : "unknown error"}`;
  }
}

async function checkStripe(): Promise<string | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return "STRIPE_SECRET_KEY is not set — billing is offline.";
  try {
    const stripe = new Stripe(key);
    await stripe.balance.retrieve();
    return null;
  } catch (e) {
    return `Stripe API unreachable: ${e instanceof Error ? e.message : "unknown error"}`;
  }
}

async function checkSupabase(): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return "Supabase service-role client isn't configured.";
  try {
    const { error } = await admin.from("lite_entitlements").select("email").limit(1);
    if (error) return `Supabase query failed: ${error.message}`;
    return null;
  } catch (e) {
    return `Supabase unreachable: ${e instanceof Error ? e.message : "unknown error"}`;
  }
}

export async function GET(req: Request) {
  // Fail CLOSED if CRON_SECRET is missing — see the identical fix + rationale
  // in app/api/cron/nudges/route.ts (July 5 audit finding).
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Cron not configured." }, { status: 503 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [anthropic, stripe, supabase] = await Promise.all([
    withTimeout("Anthropic check", checkAnthropic()),
    withTimeout("Stripe check", checkStripe()),
    withTimeout("Supabase check", checkSupabase()),
  ]);

  // Piggyback the AI-route shared rate-limit table's cleanup here rather than
  // adding a fourth cron entry — this already runs once daily. Rows are keyed
  // per-minute so anything older than a day is long dead; harmless if the
  // table doesn't exist yet (rate limiting falls back to in-memory until
  // Aaron runs supabase/lite_rate_limits.sql).
  const admin = getSupabaseAdmin();
  if (admin) {
    // Supabase query builders resolve with { error } rather than throwing, so
    // a missing table here is a no-op, not a crash.
    await admin.from("lite_rate_limits").delete().lt("window_start", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  }
  const failures = { anthropic, stripe, supabase };
  const broken = Object.entries(failures).filter(([, v]) => v);

  if (broken.length) {
    await notifyFailure(
      "Daily health check failed",
      broken.map(([name, detail]) => `${name}: ${detail}`).join("\n"),
    );
  }

  return NextResponse.json({ ok: broken.length === 0, failures });
}
