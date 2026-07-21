import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/rateLimit";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { notifyFailure } from "@/lib/alert";

// EILA's direct line to Aaron's team — when she can't fix something herself
// (math that looks wrong, something broken), she files it here with the
// user's exact context. Rides the existing alert channel: always a tagged
// Vercel log line, plus an instant Slack/Discord ping when the webhook is set.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 300_000;
const RATE_MAX = 5;
const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // Gate on an active subscription like every other EILA route — otherwise a
  // burst of throwaway (never-subscribed) accounts could pipe attacker-controlled
  // text straight into the operator's Slack/Discord alert channel. The per-email
  // rate limit alone doesn't stop that because it's per-account.
  let active = false;
  try {
    active = await hasActiveSubscription(email);
  } catch (e) {
    console.error("[ila/report] subscription check failed:", e);
    active = false;
  }
  if (!active && IS_PROD) {
    return NextResponse.json({ error: "Subscription required." }, { status: 402 });
  }

  if (await rateLimited(`ila-report:${email}`, RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ error: "Too many reports." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { summary?: string; details?: string };
  const summary = String(body.summary ?? "").trim().slice(0, 200);
  const details = String(body.details ?? "").trim().slice(0, 2000);
  if (!summary) return NextResponse.json({ error: "Missing summary." }, { status: 400 });

  await notifyFailure(`EILA report from ${email}: ${summary}`, details || "(no details)");
  return NextResponse.json({ ok: true });
}
