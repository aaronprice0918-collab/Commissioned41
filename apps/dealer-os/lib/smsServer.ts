import "server-only";
import { consentStatus } from "@/lib/consent";
import { appendMessagePatch, textRevokedAnywhere, toE164, withOptOutNotice, type LeadMessage } from "@/lib/comms";
import { sendSms, twilioCredsPresent } from "@/lib/twilio";

// The ONE outbound-text pipeline — the /api/sms/send route and EILA's
// text_customer tool both call this, so the consent gate, the privacy rule,
// the opt-out notice and the thread write can never diverge (one brain).

const samePerson = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";

export type SendTextResult = { ok: true; message: LeadMessage } | { ok: false; error: string; status: number };

export async function sendTextToLead(opts: {
  supabase: any;
  orgId: string;
  leadId: string;
  body: string;
  senderName: string;
  role: string;
  mediaUrl?: string; // MMS attachment — publicly accessible image/video URL
}): Promise<SendTextResult> {
  const { supabase, orgId, leadId, senderName, role } = opts;
  const body = opts.body.trim();
  if (!leadId || !body) return { ok: false, error: "Missing lead or message body.", status: 400 };
  if (body.length > 1200) return { ok: false, error: "That message is too long for a text.", status: 400 };

  const { data: row } = await supabase
    .from("app_store").select("value, updated_at").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
  const leads: any[] = Array.isArray(row?.value) ? row.value : [];
  const lead = leads.find((l) => String(l?.id) === leadId);
  if (!lead) return { ok: false, error: "That lead isn't on the board.", status: 404 };

  // Privacy mirrors the screens: reps text their OWN customers only.
  if ((role === "Sales" || role === "BDC") && !samePerson(String(lead.salesperson || ""), senderName)) {
    return { ok: false, error: "You can only text your own customers.", status: 403 };
  }

  const to = toE164(String(lead.customerPhone || ""));
  if (!to) return { ok: false, error: "No phone number on this lead.", status: 400 };

  // THE GATE. Recorded consent only — unknown is not a yes. And a revocation
  // belongs to the CUSTOMER: if any lead sharing this phone carries a text
  // revoke (old visit, second lead card), the number is off-limits even when
  // this card says granted.
  const consent = consentStatus(lead, "text");
  if (consent !== "granted" || textRevokedAnywhere(leads, String(lead.customerPhone || ""))) {
    return {
      ok: false,
      status: 403,
      error:
        consent === "revoked" || textRevokedAnywhere(leads, String(lead.customerPhone || ""))
          ? "This customer revoked text consent — do not text them."
          : "No text consent on file — capture it on the lead card (Consent chips) before texting.",
    };
  }

  // The store's own texting number (server-only commsConfig row, seeded per
  // org) — falls back to the env number for the founding store. A store with
  // neither gets an honest "not connected" instead of sending from the wrong
  // dealership's number.
  const { data: comms } = await supabase
    .from("app_store").select("value").eq("org_id", orgId).eq("key", "commsConfig").maybeSingle();
  const orgFrom = typeof comms?.value?.fromNumber === "string" ? comms.value.fromNumber : "";
  if (!twilioCredsPresent() || (!orgFrom && !process.env.TWILIO_FROM_NUMBER)) {
    return { ok: false, error: "Texting isn't connected for this store yet.", status: 503 };
  }

  const finalBody = withOptOutNotice(body, lead.messages);
  const sent = await sendSms(to, finalBody, orgFrom || undefined, opts.mediaUrl);
  if (!sent.ok) return { ok: false, error: sent.error, status: 502 };

  const message: LeadMessage = { dir: "out", body: finalBody, at: new Date().toISOString(), by: senderName, sid: sent.sid };
  const withMessage = (l: any) =>
    String(l?.id) === leadId ? { ...l, ...appendMessagePatch(l, message), ...(l.firstContactAt ? {} : { firstContactAt: message.at }) } : l;

  // Conditional write on the row's write-stamp: leads are a whole-array JSONB
  // row that open devices also save, so a blind read-modify-write could
  // clobber a concurrent edit. If someone saved between our read and write,
  // the text already went out (never resend) — append on the fresh copy.
  const query = supabase.from("app_store").update({ value: leads.map(withMessage), updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("key", "crmLeads");
  const { data: updated } = await (row?.updated_at ? query.eq("updated_at", row.updated_at) : query).select("updated_at");
  if (!updated || !updated.length) {
    const { data: fresh } = await supabase
      .from("app_store").select("value").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
    const freshLeads: any[] = Array.isArray(fresh?.value) ? fresh.value : [];
    await supabase.from("app_store").update({ value: freshLeads.map(withMessage), updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("key", "crmLeads");
  }
  return { ok: true, message };
}
