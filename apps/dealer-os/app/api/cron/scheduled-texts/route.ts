import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { consentStatus } from "@/lib/consent";
import { textRevokedAnywhere } from "@/lib/comms";
import { pendingNow, markSent, markFailed, type ScheduledText } from "@/lib/scheduledTexts";

// Scheduled Texts — runs every 1 minute (Vercel cron). Fires any scheduled
// text whose time has arrived. The consent gate runs AT SEND TIME — a STOP
// that arrived after the text was scheduled is honored before it goes out.
//
// Guard: Twilio configured. Consent-gated per lead. Idempotent: only fires
// texts with status "pending" whose scheduledAt <= now.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!cronAuthorized(req, "cron/scheduled-texts")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!twilioConfigured()) {
    return NextResponse.json({ skipped: true, reason: "Twilio not configured" });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  const now = new Date();
  const { data: stRows } = await supabase.from("app_store").select("org_id, value").eq("key", "scheduledTexts");
  const { data: leadRows } = await supabase.from("app_store").select("org_id, value").eq("key", "crmLeads");
  const leadsMap = new Map<string, any[]>((leadRows ?? []).map((r: any) => [String(r.org_id), Array.isArray(r.value) ? r.value : []]));

  let sent = 0;
  let failed = 0;

  for (const row of stRows ?? []) {
    const orgId = String(row.org_id);
    const texts: ScheduledText[] = Array.isArray(row.value) ? row.value : [];
    const pending = pendingNow(texts, now);
    if (!pending.length) continue;

    const leads = leadsMap.get(orgId) ?? [];
    let updated = false;

    for (const st of pending) {
      const lead = leads.find((l: any) => String(l?.id) === st.leadId);
      if (!lead) {
        // Lead was deleted — mark failed
        const idx = texts.findIndex((t) => t.id === st.id);
        if (idx >= 0) texts[idx] = markFailed(st, "Lead no longer on the board.");
        updated = true;
        failed++;
        continue;
      }

      // Consent check AT SEND TIME — the most important gate
      if (consentStatus(lead, "text") !== "granted" || textRevokedAnywhere(leads, String(lead.customerPhone || ""))) {
        const idx = texts.findIndex((t) => t.id === st.id);
        if (idx >= 0) texts[idx] = markFailed(st, "Customer revoked text consent since scheduling.");
        updated = true;
        failed++;
        continue;
      }

      const result = await sendTextToLead({
        supabase,
        orgId,
        leadId: st.leadId,
        body: st.body,
        senderName: st.createdBy,
        role: "Admin",
        mediaUrl: st.mediaUrl,
      });

      const idx = texts.findIndex((t) => t.id === st.id);
      if (result.ok) {
        if (idx >= 0) texts[idx] = markSent(st);
        sent++;
      } else {
        if (idx >= 0) texts[idx] = markFailed(st, result.error);
        failed++;
      }
      updated = true;
    }

    if (updated) {
      await supabase.from("app_store")
        .upsert({ org_id: orgId, key: "scheduledTexts", value: texts, updated_at: now.toISOString() }, { onConflict: "org_id,key" });
    }
  }

  return NextResponse.json({ sent, failed });
}
