import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { consentStatus } from "@/lib/consent";
import { textRevokedAnywhere } from "@/lib/comms";
import { guardedMutate } from "@/lib/storeServer";

// Appointment Reminders — runs daily (Vercel cron). Finds every lead with an
// appointment TOMORROW, checks text consent, and sends a personalized reminder.
//
// Idempotency: each due lead is CLAIMED (stamp lastReminderAt) atomically via
// CAS BEFORE the send, so an overlapping/retried run can't double-text — and the
// stamp write no longer blind-clobbers concurrent CRM edits (the original used a
// non-CAS .update). Times are rendered in the STORE timezone, not the server's
// UTC (which told customers the wrong hour for instant-valued appointments).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STORE_TZ = "America/New_York"; // launch market; per-store tz is a future add

/** YYYY-MM-DD for `d` as seen in `tz`. */
function ymdInTz(d: Date, tz = STORE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Human time label for an appointment value. An explicit instant (…Z / +hh:mm)
 * is converted to the store tz; a naive "YYYY-MM-DDTHH:mm" is shown as written
 * (its wall-clock), never UTC-shifted. */
function apptTimeLabel(appointment: string, tz = STORE_TZ): string {
  const s = String(appointment);
  if (!s.includes("T")) return "your scheduled time";
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  }
  const m = /T(\d{2}):(\d{2})/.exec(s);
  if (!m) return "your scheduled time";
  let h = Number(m[1]);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

export async function GET(req: Request) {
  if (!cronAuthorized(req, "cron/appointment-reminders")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!twilioConfigured()) {
    return NextResponse.json({ skipped: true, reason: "Twilio not configured" });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  const { data: orgRows } = await supabase.from("app_store").select("org_id, value").eq("key", "crmLeads");
  const { data: settingsRows } = await supabase.from("app_store").select("org_id, value").eq("key", "storeSettings");
  const settingsMap = new Map<string, any>((settingsRows ?? []).map((r: any) => [String(r.org_id), r.value]));

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = ymdInTz(now);
  const tomorrowStr = ymdInTz(new Date(now.getTime() + 86_400_000));

  let sent = 0;
  let skipped = 0;

  for (const row of orgRows ?? []) {
    const orgId = String(row.org_id);
    const leadsSnapshot: any[] = Array.isArray(row.value) ? row.value : [];
    const settings = settingsMap.get(orgId) ?? {};
    const storeName = settings.storeName || "the dealership";

    const dueInSnapshot = leadsSnapshot.some(
      (l) => l?.appointment && l.status !== "Lost" && l.status !== "Won" && String(l.appointment).slice(0, 10) === tomorrowStr,
    );
    if (!dueInSnapshot) continue;

    // CLAIM every due-and-consented, not-yet-reminded lead by stamping
    // lastReminderAt (CAS, re-checks fresh data). Capture them for the send.
    let toRemind: any[] = [];
    let consentSkipped = 0;
    await guardedMutate<any[]>(supabase, orgId, "crmLeads", (currentLeads) => {
      const current = currentLeads ?? [];
      const claimed: any[] = [];
      let cs = 0;
      const next = current.map((l: any) => {
        if (!l?.appointment || l.status === "Lost" || l.status === "Won") return l;
        if (String(l.appointment).slice(0, 10) !== tomorrowStr) return l;
        if (l.lastReminderAt && ymdInTz(new Date(l.lastReminderAt)) === todayStr) return l; // already reminded today
        if (consentStatus(l, "text") !== "granted" || textRevokedAnywhere(current, String(l.customerPhone || ""))) { cs++; return l; }
        claimed.push(l);
        return { ...l, lastReminderAt: nowIso };
      });
      toRemind = claimed;
      consentSkipped = cs;
      return next;
    });
    skipped += consentSkipped;

    for (const lead of toRemind) {
      const rep = lead.salesperson || "your sales consultant";
      const vehicle = lead.vehicle ? ` about the ${lead.vehicle}` : "";
      const body = `Hi ${(lead.customer || "").split(" ")[0] || "there"}, just a reminder about your ${apptTimeLabel(lead.appointment)} appointment tomorrow at ${storeName}${vehicle} with ${rep}. Reply YES to confirm or call us if you need to reschedule!`;

      const result = await sendTextToLead({
        supabase, orgId, leadId: String(lead.id), body, senderName: storeName, role: "Admin",
      });
      if (result.ok) sent++;
      else { skipped++; console.warn(`[appointment-reminders] failed for ${lead.id}: ${result.error}`); }
    }
  }

  return NextResponse.json({ sent, skipped, date: tomorrowStr });
}
