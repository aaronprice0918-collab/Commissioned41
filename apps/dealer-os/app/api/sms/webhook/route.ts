import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
import { recordConsentPatch } from "@/lib/consent";
import { appendMessagePatch, inboundConsentEvent, matchLeadByPhone, samePhone, type LeadMessage } from "@/lib/comms";
import { twilioCredsPresent, verifyTwilioSignature } from "@/lib/twilio";

// Inbound texts from Twilio. Two jobs, both compliance-load-bearing:
// 1. Land the customer's reply on their lead's thread so the store SEES it
//    (an unseen reply is a lost deal and, if it was a revocation, a lawsuit).
// 2. STOP-family keywords write a REVOKE straight onto the consent trail —
//    revoke-by-any-means, honored the second it arrives, no human in the
//    loop. START/UNSTOP re-grants the same way.
// Signature-verified: an unauthenticated caller must not be able to inject
// messages or flip consent. Multi-tenant: the org is resolved from the TO
// number (each store's number lives in its server-only commsConfig row); the
// env number maps to the founding org.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const twiml = () =>
  new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });

export async function POST(request: NextRequest) {
  // Creds only — a deployment can run on per-org numbers with no env number.
  if (!twilioCredsPresent()) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const raw = await request.text();
  const parsed = new URLSearchParams(raw);
  const params: Record<string, string> = {};
  parsed.forEach((value, key) => {
    params[key] = value;
  });

  // Twilio signs the PUBLIC url — behind Vercel's proxy, rebuild it from the
  // forwarded headers rather than trusting request.url's internal view.
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const url = `${proto}://${host}${new URL(request.url).pathname}`;
  const signature = request.headers.get("x-twilio-signature") || "";
  if (!verifyTwilioSignature(url, params, signature)) {
    console.warn("[sms/webhook] signature verification failed");
    return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  }

  const from = params.From || "";
  const body = (params.Body || "").trim();
  if (!from || !body) return twiml();

  const supabase = getSupabaseServerClient();
  if (!supabase) return twiml();

  // WHICH STORE was texted? Match the To number against every org's
  // commsConfig number; the env number (founding store) is the fallback. An
  // inbound reply — especially a STOP — must land on the RIGHT tenant.
  const toNumber = params.To || "";
  let orgId = DEFAULT_ORG_ID;
  const { data: commsRows } = await supabase.from("app_store").select("org_id, value").eq("key", "commsConfig");
  const hit = (commsRows ?? []).find((r: any) => typeof r?.value?.fromNumber === "string" && samePhone(r.value.fromNumber, toNumber));
  if (hit) orgId = String(hit.org_id);
  else if (process.env.TWILIO_FROM_NUMBER && toNumber && !samePhone(process.env.TWILIO_FROM_NUMBER, toNumber)) {
    // A number we don't recognize at all — don't guess a tenant with consent
    // writes. Log and acknowledge.
    console.warn(`[sms/webhook] inbound To number matches no org: ${toNumber.slice(-4).padStart(toNumber.length, "*")}`);
    return twiml();
  }
  const { data: row } = await supabase
    .from("app_store").select("value, updated_at").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
  const leads: any[] = Array.isArray(row?.value) ? row!.value : [];
  const lead = matchLeadByPhone(leads, from);
  if (!lead) {
    // No lead carries this number — nothing to attach to. Log so a lost
    // reply is at least findable, and stay 200 so Twilio doesn't retry.
    console.warn(`[sms/webhook] inbound from unmatched number ${from.slice(-4).padStart(from.length, "*")}`);
    return twiml();
  }

  const at = new Date().toISOString();
  const message: LeadMessage = { dir: "in", body, at, sid: params.MessageSid || undefined };
  const consentEvent = inboundConsentEvent(body, at);

  // The message lands on the newest matching lead; a consent keyword (STOP /
  // START) stamps EVERY lead sharing this phone — a revocation belongs to the
  // customer, not to one lead card, and every chip must agree.
  const apply = (l: any) => {
    const isThread = String(l?.id) === String(lead.id);
    const isSamePhone = samePhone(String(l?.customerPhone || ""), from);
    if (!isThread && !(consentEvent && isSamePhone)) return l;
    let next = l;
    if (isThread) next = { ...next, ...appendMessagePatch(next, message) };
    if (consentEvent && isSamePhone) next = { ...next, ...recordConsentPatch(next, consentEvent) };
    return next;
  };

  // Conditional on the write-stamp; on a race, retry once on the fresh copy —
  // an inbound message (or a STOP) must never be silently dropped.
  const query = supabase.from("app_store").update({ value: leads.map(apply), updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("key", "crmLeads");
  const { data: updated } = await (row?.updated_at ? query.eq("updated_at", row.updated_at) : query).select("updated_at");
  if (!updated || !updated.length) {
    const { data: fresh } = await supabase
      .from("app_store").select("value").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
    const freshLeads: any[] = Array.isArray(fresh?.value) ? fresh!.value : [];
    await supabase.from("app_store").update({ value: freshLeads.map(apply), updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("key", "crmLeads");
  }

  return twiml();
}
