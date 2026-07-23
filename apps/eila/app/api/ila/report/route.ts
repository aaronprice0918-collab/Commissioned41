import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/rateLimit";
import { getSessionEmail, hasActiveSubscription, isOwner, isCompEmail } from "@/lib/entitlement";
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

  // Anti-abuse gate: a burst of throwaway (never-subscribed) accounts could
  // otherwise pipe attacker-controlled text straight into the operator's
  // Slack/Discord alert channel (the per-email rate limit alone doesn't stop
  // that). BUT the owner and comped/team accounts are always allowed — they're
  // us, or people we've granted access — so a legit member (or Aaron himself)
  // is never gagged from filing a report. Only random unsubscribed accounts are
  // blocked. (Bug fix: the old gate required an active subscription for
  // EVERYONE, so the owner's own reports 402'd and silently never reached Slack.)
  let allowed = isOwner(email) || isCompEmail(email);
  if (!allowed) {
    try {
      allowed = (await hasActiveSubscription(email)) === true;
    } catch (e) {
      console.error("[ila/report] subscription check failed:", e);
      allowed = false;
    }
  }
  if (!allowed && IS_PROD) {
    return NextResponse.json({ error: "Subscription required." }, { status: 402 });
  }

  if (await rateLimited(`ila-report:${email}`, RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ error: "Too many reports." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { summary?: string; details?: string };
  const summary = String(body.summary ?? "").trim().slice(0, 200);
  const details = String(body.details ?? "").trim().slice(0, 2000);
  if (!summary) return NextResponse.json({ error: "Missing summary." }, { status: 400 });

  const { posted } = await notifyFailure(`EILA report from ${email}: ${summary}`, details || "(no details)");
  // ok = we accepted + logged it; delivered = the alert channel actually took it.
  // Relaying `delivered` lets EILA tell the user the truth instead of claiming a
  // Slack delivery it can't see.
  return NextResponse.json({ ok: true, delivered: posted });
}
