import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";
import { twilioConfigured } from "@/lib/twilio";
import { consentStatus } from "@/lib/consent";
import { textRevokedAnywhere } from "@/lib/comms";
import { cadenceSteps, advanceCadence, type CadenceState } from "@/lib/followUpCadence";
import { makeScheduledTextId, type ScheduledText } from "@/lib/scheduledTexts";
import { guardedMutate } from "@/lib/storeServer";

// Follow-Up Cadence Processor — runs every hour. For each active cadence whose
// nextFireAt has passed, it drafts the step's message using the lead context and
// enqueues it as a scheduled text (fires on the next minute via the
// scheduled-texts cron). The draft is contextual: it uses the step's `intent`
// plus the lead's live data to compose a message.
//
// Why not send directly? Because the cadence step is an INTENT ("thank them
// for coming in, reference their vehicle"), not a canned message. For V1, we
// use a simple template approach. For V2, this hooks into EILA to draft via
// Claude — same two-step confirm as text_customer.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Simple template drafting — V1. Replaces {customer}, {vehicle}, {rep}, {store}
// in the step intent and wraps it as a text message.
function draftFromIntent(intent: string, lead: any, storeName: string): string {
  const firstName = (lead.customer || "").split(" ")[0] || "there";
  const vehicle = lead.vehicle || "the vehicle we discussed";
  const rep = lead.salesperson || "your sales consultant";

  // The intent is a DIRECTIVE for what the message should accomplish. For V1,
  // we compose a clean, human message from it. This is the part EILA will
  // eventually draft with full AI context.
  const parts = intent.toLowerCase();
  if (parts.includes("intro") || parts.includes("warm")) {
    return `Hi ${firstName}, this is ${rep} at ${storeName}. Thanks for your interest in ${vehicle} — I'd love to help you find exactly what you're looking for. Feel free to text back or give me a call anytime!`;
  }
  if (parts.includes("follow-up") || parts.includes("soft follow")) {
    return `Hey ${firstName}, just checking in! Did you have any questions about ${vehicle}? Happy to help with anything — pricing, trade value, financing options. Just text back!`;
  }
  if (parts.includes("thank") || parts.includes("came in")) {
    return `Hey ${firstName}, thanks for coming in today! It was great meeting you. If you have any questions about ${vehicle} or the numbers we discussed, don't hesitate to reach out. - ${rep}`;
  }
  if (parts.includes("value add") || parts.includes("incentive")) {
    return `Hi ${firstName}, just wanted to let you know ${vehicle} is still available and we have some great options to work with right now. Would you like to come take another look? - ${rep}`;
  }
  if (parts.includes("objection") || parts.includes("better")) {
    return `Hey ${firstName}, I've been thinking about what we discussed and I may have a way to make the numbers work better for you on ${vehicle}. Want me to run some options? - ${rep}`;
  }
  if (parts.includes("urgency") || parts.includes("month-end")) {
    return `Hi ${firstName}, just a heads up — ${vehicle} has been getting some attention and I wanted to make sure you get first shot at it. Let me know if you'd like to come back in! - ${rep}`;
  }
  if (parts.includes("last touch") || parts.includes("door open")) {
    return `Hey ${firstName}, haven't heard from you in a bit — no pressure at all! Just wanted you to know ${vehicle} is still here if you're interested, and I'm here whenever you're ready. - ${rep}`;
  }
  if (parts.includes("trade") || parts.includes("upgrade") || parts.includes("equity")) {
    return `Hi ${firstName}, it's ${rep} at ${storeName}. I was looking at our new arrivals and thought of you — have you thought about upgrading? I'd love to show you what's available. No obligation, just options!`;
  }
  if (parts.includes("service") || parts.includes("declined")) {
    return `Hi ${firstName}, this is ${storeName} service department. We still have the quote on file for the work we recommended on your last visit. Would you like to get that scheduled? We're happy to work around your schedule.`;
  }
  // Default: use the intent as a guide for a generic follow-up
  return `Hi ${firstName}, this is ${rep} at ${storeName}. Just following up — I'm here if you need anything regarding ${vehicle}. Text back anytime!`;
}

export async function GET(req: Request) {
  if (!cronAuthorized(req, "cron/follow-up-cadence")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!twilioConfigured()) {
    return NextResponse.json({ skipped: true, reason: "Twilio not configured" });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  const now = new Date();
  const nowIso = now.toISOString();
  const { data: leadRows } = await supabase.from("app_store").select("org_id, value, updated_at").eq("key", "crmLeads");
  const { data: settingsRows } = await supabase.from("app_store").select("org_id, value").eq("key", "storeSettings");
  const settingsMap = new Map<string, any>((settingsRows ?? []).map((r: any) => [String(r.org_id), r.value]));

  let queued = 0;
  let skipped = 0;

  for (const row of leadRows ?? []) {
    const orgId = String(row.org_id);
    const leads: any[] = Array.isArray(row.value) ? row.value : [];
    const settings = settingsMap.get(orgId) ?? {};
    const storeName = settings.storeName || "the dealership";

    const leadsToProcess: { lead: any; cadence: CadenceState }[] = [];

    for (const lead of leads) {
      const cadence: CadenceState | undefined = lead.cadence;
      if (!cadence || cadence.status !== "active") continue;
      if (cadence.nextFireAt > nowIso) continue; // not time yet

      // Consent check
      if (consentStatus(lead, "text") !== "granted" || textRevokedAnywhere(leads, String(lead.customerPhone || ""))) {
        skipped++;
        continue;
      }

      leadsToProcess.push({ lead, cadence });
    }

    if (!leadsToProcess.length) continue;

    // Draft and enqueue each step, then advance the cadence on the lead
    const scheduledTexts: ScheduledText[] = [];

    // Use guardedMutate to safely update the leads with advanced cadences
    await guardedMutate<any[]>(supabase, orgId, "crmLeads", (currentLeads) => {
      const current = currentLeads ?? [];
      return current.map((l: any) => {
        const match = leadsToProcess.find((p) => String(p.lead.id) === String(l?.id));
        if (!match) return l;

        const steps = cadenceSteps(match.cadence);
        const step = steps[match.cadence.currentStep];
        if (!step) return { ...l, cadence: { ...match.cadence, status: "completed" } };

        // Draft the message
        const body = draftFromIntent(step.intent, l, storeName);

        // Enqueue as a scheduled text (fires on the next minute)
        scheduledTexts.push({
          id: makeScheduledTextId(),
          leadId: String(l.id),
          body,
          scheduledAt: nowIso,
          createdAt: nowIso,
          createdBy: match.cadence.startedBy,
          status: "pending",
        });

        queued++;
        return { ...l, cadence: advanceCadence(match.cadence) };
      });
    });

    // Append the drafted texts to the org's scheduledTexts store
    if (scheduledTexts.length) {
      await guardedMutate<ScheduledText[]>(supabase, orgId, "scheduledTexts", (current) => {
        return [...(current ?? []), ...scheduledTexts];
      });
    }
  }

  return NextResponse.json({ queued, skipped });
}
