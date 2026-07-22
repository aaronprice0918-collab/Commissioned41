import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { consentStatus } from "@/lib/consent";
import { textRevokedAnywhere } from "@/lib/comms";
import { guardedMutate } from "@/lib/storeServer";
import { markSent, markFailed, pruneTerminal, type ScheduledText } from "@/lib/scheduledTexts";

// Scheduled Texts — runs every 1 minute (Vercel cron). Fires any scheduled
// text whose time has arrived. The consent gate runs AT SEND TIME — a STOP that
// arrived after the text was scheduled is honored before it goes out.
//
// Idempotency is the hard part: this cron fires every minute, sends are
// sequential Twilio calls, and Vercel can overlap invocations — a blind
// read-modify-upsert (the original) both clobbered concurrent writes AND
// re-sent texts whose "sent" marker never persisted after a mid-batch error.
// Fix: CLAIM each due text atomically (flip pending -> sent via CAS) BEFORE
// sending. A second overlapping run sees it's no longer pending and skips it.
// Marking sent-before-send means a send that fails is a MISSED text (downgraded
// to failed, best-effort), never a DUPLICATE — the correct, safe direction.

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
  const nowIso = now.toISOString();
  const { data: stRows } = await supabase.from("app_store").select("org_id, value").eq("key", "scheduledTexts");
  const { data: leadRows } = await supabase.from("app_store").select("org_id, value").eq("key", "crmLeads");
  const leadsMap = new Map<string, any[]>((leadRows ?? []).map((r: any) => [String(r.org_id), Array.isArray(r.value) ? r.value : []]));

  let sent = 0;
  let failed = 0;

  for (const row of stRows ?? []) {
    const orgId = String(row.org_id);
    const texts: ScheduledText[] = Array.isArray(row.value) ? row.value : [];
    if (!texts.some((t) => t.status === "pending" && t.scheduledAt <= nowIso)) continue;

    const leads = leadsMap.get(orgId) ?? [];

    // Phase 1 — CLAIM: atomically flip every due-and-consented text pending->sent
    // (and prune terminal history). Runs against fresh data on every CAS retry;
    // `claimed`/`consentFailed` are reassigned (not accumulated) each run, so they
    // reflect exactly the committed decision. Texts whose lead vanished or whose
    // consent was revoked since scheduling are marked failed here — never sent.
    let claimed: ScheduledText[] = [];
    let consentFailed = 0;
    await guardedMutate<ScheduledText[]>(supabase, orgId, "scheduledTexts", (cur) => {
      const arr: ScheduledText[] = Array.isArray(cur) ? cur : [];
      const toSend: ScheduledText[] = [];
      let cf = 0;
      const next = arr.map((t) => {
        if (t.status !== "pending" || t.scheduledAt > nowIso) return t;
        const lead = leads.find((l: any) => String(l?.id) === t.leadId);
        if (!lead) { cf++; return markFailed(t, "Lead no longer on the board."); }
        if (consentStatus(lead, "text") !== "granted" || textRevokedAnywhere(leads, String(lead.customerPhone || ""))) {
          cf++;
          return markFailed(t, "Customer revoked text consent since scheduling.");
        }
        toSend.push(t); // capture the ORIGINAL (pre-mark) for the send below
        return markSent(t, nowIso); // optimistic claim — a concurrent run now skips it
      });
      claimed = toSend;
      consentFailed = cf;
      return pruneTerminal(next, 30, now);
    });
    failed += consentFailed;

    // Phase 2 — SEND the texts we won the claim on. Already marked sent, so an
    // overlapping cron can't re-send them. A failure downgrades to "failed".
    const sendFailures: { id: string; error: string }[] = [];
    for (const st of claimed) {
      const result = await sendTextToLead({
        supabase,
        orgId,
        leadId: st.leadId,
        body: st.body,
        senderName: st.createdBy,
        role: "Admin",
        mediaUrl: st.mediaUrl,
      });
      if (result.ok) sent++;
      else { failed++; sendFailures.push({ id: st.id, error: result.error }); }
    }

    // Phase 3 — record any send failures (best-effort; a missed text, not a dupe).
    if (sendFailures.length) {
      const failMap = new Map(sendFailures.map((f) => [f.id, f.error]));
      await guardedMutate<ScheduledText[]>(supabase, orgId, "scheduledTexts", (cur) => {
        const arr: ScheduledText[] = Array.isArray(cur) ? cur : [];
        return arr.map((t) => (failMap.has(t.id) ? markFailed(t, failMap.get(t.id)!) : t));
      });
    }
  }

  return NextResponse.json({ sent, failed });
}
