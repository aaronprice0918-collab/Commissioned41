// Lightweight failure alerting. Two channels, both best-effort and non-throwing
// (an alert must never break the request it's reporting on):
//   1. Structured console.error — always on; shows up in Vercel logs/observability,
//      searchable by the "[ALERT]" tag.
//   2. An incoming webhook (Slack / Discord / Zapier "catch hook" / any URL) — only
//      when ALERT_WEBHOOK_URL is set. Sends both {text} (Slack) and {content}
//      (Discord) so either platform renders it. This is the zero-setup path to an
//      instant phone/desktop ping: paste a Slack or Discord webhook URL into the
//      env and alerts start flowing — no email domain verification needed.
export async function notifyFailure(title: string, detail: string): Promise<void> {
  const line = `[ALERT] ${title} — ${detail}`;
  // Always record to the server log.
  console.error(line);

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const msg = `🚨 MissionOS Lite: ${title}\n${detail}`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg, content: msg }),
    });
  } catch {
    // Alerting is best-effort — swallow any error so it can't affect the caller.
  }
}
