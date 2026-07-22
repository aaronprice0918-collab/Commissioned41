import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { consentStatus } from "@/lib/consent";
import { textRevokedAnywhere } from "@/lib/comms";
import { guardedMutate } from "@/lib/storeServer";

// Speed-to-Lead Auto-Text — runs every 1 minute (Vercel cron). Finds New Leads
// that arrived in the last 5 minutes with text consent granted and no prior
// outbound text, then fires a personalized first-contact text. This is the
// auto-pilot layer on top of the Five-Minute Response System: the rep gets
// credit for a sub-5-minute response even if they're on the lot with a customer,
// because EILA already reached out on their behalf.
//
// Guard: only fires when Twilio is configured. Consent-gated per lead.
// Idempotent: only targets leads with no outbound messages (lead.messages empty
// or all inbound).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!cronAuthorized(req, "cron/speed-text")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!twilioConfigured()) {
    return NextResponse.json({ skipped: true, reason: "Twilio not configured" });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

  const { data: orgRows } = await supabase.from("app_store").select("org_id, value").eq("key", "crmLeads");
  const { data: settingsRows } = await supabase.from("app_store").select("org_id, value").eq("key", "storeSettings");
  const settingsMap = new Map<string, any>((settingsRows ?? []).map((r: any) => [String(r.org_id), r.value]));

  let sent = 0;
  let skipped = 0;

  const nowIso = now.toISOString();

  // Is this lead a fresh (<5 min) New Lead eligible for a first-contact text?
  const eligible = (lead: any): boolean => {
    if (lead?.status !== "New Lead" || !lead.customerPhone) return false;
    if (lead.speedTextSent) return false;
    const msgs: any[] = lead.messages ?? [];
    if (msgs.some((m: any) => m.dir === "out")) return false; // already contacted
    const idMatch = /^CRM-(\d{12,})$/.exec(lead.id || "");
    const createdAt = lead.date
      ? new Date(lead.date).toISOString()
      : idMatch ? new Date(Number(idMatch[1])).toISOString() : null;
    return !!createdAt && createdAt >= fiveMinAgo && createdAt <= nowIso;
  };

  for (const row of orgRows ?? []) {
    const orgId = String(row.org_id);
    const leadsSnapshot: any[] = Array.isArray(row.value) ? row.value : [];
    const settings = settingsMap.get(orgId) ?? {};
    const storeName = settings.storeName || "the dealership";

    if (!leadsSnapshot.some(eligible)) continue;

    // CLAIM every eligible lead by stamping speedTextSent BEFORE sending, via CAS
    // on fresh data — so two overlapping cron ticks can't both first-contact the
    // same lead, and the stamp no longer blind-clobbers a concurrent CRM edit.
    let toText: any[] = [];
    let consentSkipped = 0;
    await guardedMutate<any[]>(supabase, orgId, "crmLeads", (currentLeads) => {
      const current = currentLeads ?? [];
      const claimed: any[] = [];
      let cs = 0;
      const next = current.map((l: any) => {
        if (!eligible(l)) return l;
        if (consentStatus(l, "text") !== "granted" || textRevokedAnywhere(current, String(l.customerPhone || ""))) { cs++; return l; }
        claimed.push(l);
        return { ...l, speedTextSent: true };
      });
      toText = claimed;
      consentSkipped = cs;
      return next;
    });
    skipped += consentSkipped;

    for (const lead of toText) {
      const firstName = (lead.customer || "").split(" ")[0] || "there";
      const rep = lead.salesperson || "our team";
      const vehicle = lead.vehicle ? `the ${lead.vehicle}` : "a vehicle";
      const body = `Hi ${firstName}! Thanks for your interest in ${vehicle}. This is ${rep} at ${storeName}. I'd love to help — feel free to text back or call me directly. When would be a good time for you to come take a look?`;

      const result = await sendTextToLead({
        supabase, orgId, leadId: String(lead.id), body, senderName: lead.salesperson || "EILA", role: "Admin",
      });
      if (result.ok) sent++;
      else { skipped++; console.warn(`[speed-text] failed for ${lead.id}: ${result.error}`); }
    }
  }

  return NextResponse.json({ sent, skipped });
}
