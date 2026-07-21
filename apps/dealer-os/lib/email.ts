// Outbound email for Dealer Mission OS — sent through Resend (free tier covers a store's
// volume; no carrier approval like SMS). Fail-soft: if RESEND_API_KEY / EMAIL_FROM
// aren't set, send() returns { ok:false } and callers carry on — nothing breaks,
// email simply lights up the moment the keys are in (same pattern as the
// Anthropic key). EMAIL_FROM must be on a domain you've verified in Resend,
// e.g. "EILA <ila@mail.commissioned41.com>".

const RESEND_API = "https://api.resend.com/emails";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "email not configured" };
  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (!to.length) return { ok: false, error: "no recipients" };
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: opts.subject,
        ...(opts.html ? { html: opts.html } : {}),
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
