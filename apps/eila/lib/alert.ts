import { appConfig } from "./appConfig";

// Lightweight failure alerting. Two channels, both best-effort and non-throwing
// (an alert must never break the request it's reporting on):
//   1. Structured console.error — always on; shows up in Vercel logs/observability,
//      searchable by the "[ALERT]" tag.
//   2. An incoming webhook (Slack / Discord / Zapier "catch hook" / any URL). The
//      URL comes from the operator VAULT (lite_app_config) first, env as fallback
//      — the same DB-wins pattern as the Plaid secret. This is exactly what bit
//      the Slack reports: the deployed ALERT_WEBHOOK_URL env still pointed at a
//      DELETED webhook, so every report POSTed into a dead URL and failed
//      silently. Storing the live webhook in the vault lets an operator rotate it
//      instantly (no redeploy), and a stale env can never override it.
//
// Returns whether the webhook actually accepted the post, so callers can tell the
// user the truth ("filed AND delivered") instead of claiming a delivery they
// can't see — a fire-and-forget send that swallowed the error is precisely why
// EILA said "they got it" while nothing reached Slack.
export async function notifyFailure(title: string, detail: string): Promise<{ posted: boolean }> {
  const line = `[ALERT] ${title} — ${detail}`;
  // Always record to the server log.
  console.error(line);

  let url: string | undefined;
  try {
    url = await appConfig("ALERT_WEBHOOK_URL");
  } catch {
    url = process.env.ALERT_WEBHOOK_URL;
  }
  if (!url) return { posted: false };
  try {
    const msg = `🚨 MissionOS Lite: ${title}\n${detail}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg, content: msg }),
    });
    return { posted: res.ok };
  } catch {
    // Alerting is best-effort — swallow any error so it can't affect the caller,
    // but report the non-delivery so the caller doesn't overclaim.
    return { posted: false };
  }
}
