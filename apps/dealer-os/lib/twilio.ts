import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Thin Twilio client — REST via fetch, no SDK dependency. Inert until the
// env keys land (same pattern as Stripe): no keys → twilioConfigured() false,
// the send route 503s politely, the UI says texting isn't connected yet.
//
// Env:
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN — the account credentials
//   TWILIO_FROM_NUMBER — the store's texting number (E.164). Single-number
//   for now (founding store); per-org numbers become a commsConfig row when
//   store #2 needs one.

// Account creds present + at least the env fallback number. A store with its
// own number (commsConfig) works even without the env number — the send path
// checks per-org; this is the coarse "is texting wired at all" probe.
export function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

export function twilioCredsPresent(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export function twilioFromNumber(): string {
  return process.env.TWILIO_FROM_NUMBER || "";
}

export async function sendSms(to: string, body: string, fromOverride?: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  // Per-org number first (commsConfig), env number as the founding-store fallback.
  const from = fromOverride || process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Texting isn't configured yet." };

  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.sid) {
    return { ok: false, error: String(data?.message || `Twilio rejected the send (${res.status}).`) };
  }
  return { ok: true, sid: String(data.sid) };
}

// Twilio webhook authenticity: X-Twilio-Signature is base64(HMAC-SHA1(token,
// url + params sorted by key, names and values concatenated)). Reject
// anything that doesn't verify — an unauthenticated webhook that writes
// consent events and messages would be an injection surface.
export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
