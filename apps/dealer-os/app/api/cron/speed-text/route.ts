import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { consentStatus } from "@/lib/consent";

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

  for (const row of orgRows ?? []) {
    const orgId = String(row.org_id);
    const leads: any[] = Array.isArray(row.value) ? row.value : [];
    const settings = settingsMap.get(orgId) ?? {};
    const storeName = settings.storeName || "the dealership";

    for (const lead of leads) {
      // Only target New Leads — they just arrived
      if (lead.status !== "New Lead") continue;
      if (!lead.customerPhone) continue;

      // Check the lead's creation time — must be within last 5 minutes.
      // CRM-<ms> IDs encode creation time.
      const idMatch = /^CRM-(\d{12,})$/.exec(lead.id || "");
      const createdAt = lead.date
        ? new Date(lead.date).toISOString()
        : idMatch ? new Date(Number(idMatch[1])).toISOString() : null;
      if (!createdAt || createdAt < fiveMinAgo || createdAt > now.toISOString()) {
        continue; // too old or no creation time
      }

      // Only if no outbound text has been sent yet
      const msgs: any[] = lead.messages ?? [];
      if (msgs.some((m: any) => m.dir === "out")) {
        skipped++;
        continue;
      }

      // Check text consent
      if (consentStatus(lead, "text") !== "granted") {
        skipped++;
        continue;
      }

      // Idempotency: skip if already stamped by a previous cron run
      if (lead.speedTextSent) {
        skipped++;
        continue;
      }

      // Build the first-contact text
      const firstName = (lead.customer || "").split(" ")[0] || "there";
      const rep = lead.salesperson || "our team";
      const vehicle = lead.vehicle ? `the ${lead.vehicle}` : "a vehicle";
      const body = `Hi ${firstName}! Thanks for your interest in ${vehicle}. This is ${rep} at ${storeName}. I'd love to help — feel free to text back or call me directly. When would be a good time for you to come take a look?`;

      const result = await sendTextToLead({
        supabase,
        orgId,
        leadId: String(lead.id),
        body,
        senderName: lead.salesperson || "EILA",
        role: "Admin",
      });

      if (result.ok) {
        sent++;
        // Stamp so we don't re-send on the next cron tick
        const { data: freshRow } = await supabase
          .from("app_store").select("value, updated_at").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
        const freshLeads: any[] = Array.isArray(freshRow?.value) ? freshRow.value : [];
        const patched = freshLeads.map((l: any) =>
          String(l?.id) === String(lead.id) ? { ...l, speedTextSent: true } : l
        );
        await supabase.from("app_store").update({ value: patched, updated_at: new Date().toISOString() })
          .eq("org_id", orgId).eq("key", "crmLeads");
      } else {
        console.warn(`[speed-text] failed for ${lead.id}: ${result.error}`);
        skipped++;
      }
    }
  }

  return NextResponse.json({ sent, skipped });
}
