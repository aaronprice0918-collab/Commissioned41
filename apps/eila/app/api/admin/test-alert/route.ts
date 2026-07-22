import { NextResponse } from "next/server";

// A one-shot diagnostic for the EILA → Slack (or Discord) alert wire. Every
// real alert in the app flows through the same ALERT_WEBHOOK_URL incoming
// webhook (see lib/alert.ts) — but that path is silent by design: a missing or
// dead webhook fails without a peep, which is exactly what makes "my Slack
// pushes stopped" so hard to diagnose. This endpoint makes it loud: it posts a
// test message through the real webhook and reports precisely what happened,
// so the whole chain can be proven with one call. Gated by CRON_SECRET, same
// as the cron routes — this is an operator tool, not a user route.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Fail CLOSED if CRON_SECRET is missing — same rationale as the cron routes.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured (CRON_SECRET unset)." }, { status: 503 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    return NextResponse.json({
      ok: false,
      webhookConfigured: false,
      message:
        "ALERT_WEBHOOK_URL is not set — EILA has no Slack webhook to post to. Create a Slack incoming webhook, then add ALERT_WEBHOOK_URL in Vercel env and redeploy.",
    });
  }

  const text =
    "✅ EILA → Slack test alert. If you can read this in Slack, your alert connection is working. (Triggered from /api/admin/test-alert.)";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Same dual payload as lib/alert.ts so the test exercises the real shape:
      // {text} renders in Slack, {content} in Discord.
      body: JSON.stringify({ text, content: text }),
    });
    const body = (await res.text().catch(() => "")).slice(0, 200);
    return NextResponse.json({
      ok: res.ok,
      webhookConfigured: true,
      slackStatus: res.status,
      slackResponse: body,
      message: res.ok
        ? "Posted to the webhook successfully — check your Slack channel for the test message."
        : `The webhook is set but the POST failed (HTTP ${res.status}). The webhook is most likely revoked/dead — create a fresh Slack incoming webhook and update ALERT_WEBHOOK_URL.`,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      webhookConfigured: true,
      message: `The webhook is set but the request threw: ${e instanceof Error ? e.message : "unknown error"}. The URL is likely malformed or unreachable — recreate the Slack webhook and update ALERT_WEBHOOK_URL.`,
    });
  }
}
