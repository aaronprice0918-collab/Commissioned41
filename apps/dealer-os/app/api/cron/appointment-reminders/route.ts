import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { consentStatus } from "@/lib/consent";
import { samePhone } from "@/lib/comms";

// Appointment Reminders — runs daily at 6pm ET (configurable via Vercel cron).
// Finds every lead with a confirmed or unconfirmed appointment TOMORROW, checks
// text consent, and sends a personalized reminder. Inbound YES/NO replies are
// handled by the existing webhook (appointment confirmation updates happen via
// the EILA tool or manually — this just sends the reminder).
//
// Guard: only fires when Twilio is configured. Consent-gated per lead.
// Idempotent: each lead is checked against `lead.lastReminderAt` to avoid
// double-sends if the cron fires twice.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req, "cron/appointment-reminders")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!twilioConfigured()) {
    return NextResponse.json({ skipped: true, reason: "Twilio not configured" });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  // Scan every org's leads for tomorrow's appointments.
  const { data: orgRows } = await supabase.from("app_store").select("org_id, value, updated_at").eq("key", "crmLeads");
  const { data: settingsRows } = await supabase.from("app_store").select("org_id, value").eq("key", "storeSettings");
  const settingsMap = new Map<string, any>((settingsRows ?? []).map((r: any) => [String(r.org_id), r.value]));

  // Tomorrow's date in the store's timezone (default ET).
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  let sent = 0;
  let skipped = 0;

  for (const row of orgRows ?? []) {
    const orgId = String(row.org_id);
    const leads: any[] = Array.isArray(row.value) ? row.value : [];
    const settings = settingsMap.get(orgId) ?? {};
    const storeName = settings.storeName || "the dealership";

    for (const lead of leads) {
      if (!lead.appointment || lead.status === "Lost" || lead.status === "Won") continue;

      // Check if appointment is tomorrow
      const apptDate = String(lead.appointment).slice(0, 10);
      if (apptDate !== tomorrowStr) continue;

      // Check consent
      if (consentStatus(lead, "text") !== "granted") {
        skipped++;
        continue;
      }

      // Idempotency: don't send if we already reminded today
      if (lead.lastReminderAt && String(lead.lastReminderAt).slice(0, 10) === new Date().toISOString().slice(0, 10)) {
        skipped++;
        continue;
      }

      // Build the reminder message
      const time = String(lead.appointment).includes("T")
        ? new Date(lead.appointment).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "your scheduled time";
      const rep = lead.salesperson || "your sales consultant";
      const vehicle = lead.vehicle ? ` about the ${lead.vehicle}` : "";
      const body = `Hi ${(lead.customer || "").split(" ")[0] || "there"}, just a reminder about your ${time} appointment tomorrow at ${storeName}${vehicle} with ${rep}. Reply YES to confirm or call us if you need to reschedule!`;

      const result = await sendTextToLead({
        supabase,
        orgId,
        leadId: String(lead.id),
        body,
        senderName: storeName,
        role: "Admin", // cron runs as admin — bypasses own-customer restriction
      });

      if (result.ok) {
        sent++;
        // Stamp the reminder so we don't double-send. This is a lightweight
        // write — the full CAS loop in smsServer already bumped the row, so
        // this is just a metadata patch on the lead.
        const { data: freshRow } = await supabase
          .from("app_store").select("value, updated_at").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
        const freshLeads: any[] = Array.isArray(freshRow?.value) ? freshRow.value : [];
        const patched = freshLeads.map((l: any) =>
          String(l?.id) === String(lead.id)
            ? { ...l, lastReminderAt: new Date().toISOString() }
            : l
        );
        await supabase.from("app_store").update({ value: patched, updated_at: new Date().toISOString() })
          .eq("org_id", orgId).eq("key", "crmLeads");
      } else {
        console.warn(`[appointment-reminders] failed for ${lead.id}: ${result.error}`);
        skipped++;
      }
    }
  }

  return NextResponse.json({ sent, skipped, date: tomorrowStr });
}
