import type { EILAContext } from "./_context";
import { scopeLeads } from "./_context";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { currency, samePerson } from "@/lib/data";
import { isOwnerEmail } from "@/lib/access";
import { guardedMutate } from "@/lib/storeServer";
import { isLate, laneStats, promiseRisk, promiseStats, recaptureList, updateDue, type ServiceStatus } from "@/lib/service";
import { SOP_AGING_DAYS, counterStats, normalizePartsData, sopAgeDays, stockSuggestions, type SopStatus } from "@/lib/parts";
import { buildFixedOpsDigest } from "@/lib/fixedOpsDigest";
import { groupForViewer, groupRollup, type GroupStoreInput } from "@/lib/groupReport";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { withOptOutNotice, textRevokedAnywhere } from "@/lib/comms";
import { consentStatus, suppressionDeadline } from "@/lib/consent";
import { isOpenLead, scoreLead } from "@/lib/leadScore";
import { makeScheduledTextId, scheduledLine, cancel as cancelScheduled, type ScheduledText } from "@/lib/scheduledTexts";
import { startCadence, cadenceSteps, cadenceSummary, pauseCadence, CADENCE_TEMPLATES, type CadenceTemplate, type CadenceState } from "@/lib/followUpCadence";
import { responseMetrics, repTextAnalytics, textNudges, scoreSentiment } from "@/lib/textIntelligence";


// group_report — the multi-rooftop rollup (lib/groupReport.ts, same brain as
// the Group Command screen). Access is decided HERE, per caller: the platform
// owner sees every store; a group principal sees the stores named in their
// server-only groupConfig row; everyone else is told it's not for them.
// Aggregates only — never a customer name across store lines.
export async function handleGroupReport(_input: any, ctx: EILAContext): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Group reporting needs the secure backend — it isn't wired in this environment.";
  const email = ctx.viewer.email || "";

  let groupName: string;
  let memberOrgIds: string[];
  if (isOwnerEmail(email)) {
    const { data: orgs } = await supabase.from("organizations").select("id");
    groupName = "All stores";
    memberOrgIds = (orgs ?? []).map((o: any) => String(o.id));
  } else {
    const { data: configs } = await supabase.from("app_store").select("value").eq("key", "groupConfig");
    const group = groupForViewer(configs ?? [], email);
    if (!group) return "This account isn't set up as a dealer-group principal — group reporting shows an owner every rooftop they run. For this store's numbers, use query_deals.";
    groupName = group.name;
    memberOrgIds = group.memberOrgIds;
  }
  if (!memberOrgIds.length) return "No stores found for this group yet.";

  const [{ data: orgRows }, { data: dealRows }, { data: settingsRows }] = await Promise.all([
    supabase.from("organizations").select("id, name").in("id", memberOrgIds),
    supabase.from("app_store").select("org_id, value").eq("key", "deals").in("org_id", memberOrgIds),
    supabase.from("app_store").select("org_id, value").eq("key", "storeSettings").in("org_id", memberOrgIds),
  ]);
  const names = new Map<string, string>((orgRows ?? []).map((o: any) => [String(o.id), String(o.name || "Store")]));
  const dealsByOrg = new Map<string, any[]>((dealRows ?? []).map((r: any) => [String(r.org_id), Array.isArray(r.value) ? r.value : []]));
  const settingsByOrg = new Map<string, any>((settingsRows ?? []).map((r: any) => [String(r.org_id), r.value ?? null]));
  const stores: GroupStoreInput[] = memberOrgIds.map((orgId) => ({ orgId, name: names.get(orgId) || "Store", deals: dealsByOrg.get(orgId) ?? [], settings: settingsByOrg.get(orgId) ?? null }));
  const r = groupRollup(stores);

  const L: string[] = [];
  L.push(`=== ${groupName}: ${r.totals.stores} store${r.totals.stores === 1 ? "" : "s"} ===`);
  L.push(`Group: ${r.totals.units} units (${r.totals.newUnits} new / ${r.totals.usedUnits} used) · gross ${currency(r.totals.gross)} (front ${currency(r.totals.front)} / back ${currency(r.totals.back)}) · PVR ${currency(r.totals.pvr)} · F&I PVR ${currency(r.totals.financePvr)} · PPU ${r.totals.ppu.toFixed(2)}`);
  for (const s of r.stores) {
    L.push(`${s.name}: ${s.units} units · gross ${currency(s.gross)} · PVR ${currency(s.pvr)} · F&I PVR ${currency(s.financePvr)} · PPU ${s.ppu.toFixed(2)}`);
  }
  return L.join("\n");
}

// service_lane — the Service Drive board (lib/service.ts, same brain as the
// /service screen): what's in the lane, what's late on its promise, who's
// ready, declined work worth a call, and the service→sales flags.
export function handleServiceLane(_input: any, ctx: EILAContext): string {
  const visits: any[] = Array.isArray((ctx.data as any).serviceLane) ? (ctx.data as any).serviceLane : [];
  if (!visits.length) return "The service lane is empty — no visits logged yet. Appointments land there from the Service Lane screen.";
  const stats = laneStats(visits);
  const L: string[] = [];
  L.push(`=== SERVICE LANE: ${stats.inLaneNow} in the lane · ${stats.readyNow} ready · ${stats.lateNow} LATE · ${stats.salesFlags} flagged for sales ===`);
  for (const v of visits.filter((x) => x.status !== "Picked Up")) {
    const risk = promiseRisk(v);
    const riskNote = isLate(v) ? " · LATE on promise" : risk === "soon" ? " · promise DUE SOON — re-promise now" : "";
    const quiet = updateDue(v) ? " · customer hasn't heard from us — send a status text" : "";
    L.push(`${v.customer || "?"} · ${v.vehicle || "?"} · ${v.status}${v.promisedAt ? ` · promised ${new Date(v.promisedAt).toLocaleString()}` : ""}${v.estimatedTotal ? ` · ~${currency(v.estimatedTotal)}` : ""}${v.salesOpportunity ? " · SALES FLAG" : ""}${riskNote}${quiet} · ${v.concern || ""}`);
  }
  const missions = recaptureList(visits);
  if (missions.length) {
    L.push(`\nWIN-BACK LIST (open declined work — structured follow-up recovers 23-30%):`);
    for (const m of missions.slice(0, 12)) L.push(`${m.visit.customer || "?"} · ${m.visit.vehicle || "?"} · ${m.daysSince}d since pickup${m.cadence ? ` (${m.cadence}-day window)` : ""} · declined: ${m.visit.declinedWork}${m.visit.customerPhone ? ` · ${m.visit.customerPhone}` : ""}`);
  }
  const promises = promiseStats(visits);
  if (promises.length) {
    L.push(`\nPROMISE-TIME HONESTY (30d, per advisor — done on time / promised):`);
    for (const a of promises) L.push(`${a.advisor}: ${a.kept}/${a.promised} kept (${a.hitRate}%)`);
  }
  return L.join("\n");
}

// parts_counter — the Parts Counter board (lib/parts.ts, same brain as the
// /parts screen): special orders with their aging clocks, the tech request
// queue with fill times, and the lost-sale ledger with stock-it suggestions.
export function handlePartsCounter(_input: any, ctx: EILAContext): string {
  const data = normalizePartsData((ctx.data as any).partsCounter);
  if (!data.sops.length && !data.requests.length && !data.lostSales.length) {
    return "The parts counter board is empty — special orders, tech requests, and lost sales all land there from the Parts Counter screen.";
  }
  const stats = counterStats(data);
  const L: string[] = [];
  L.push(`=== PARTS COUNTER: ${stats.queueWaiting} tech${stats.queueWaiting === 1 ? "" : "s"} waiting · ${stats.sopsWaiting} special orders on the shelf (${currency(stats.sopsWaitingValue)}) · ${stats.sopsAging} aging ${SOP_AGING_DAYS}d+ · lost sales 30d ${currency(stats.lostValue30d)} ===`);
  const openSops = data.sops.filter((sop) => sop.status !== "Picked Up" && sop.status !== "Returned");
  if (openSops.length) {
    L.push(`\nSPECIAL ORDERS (aging counts from the day the part LANDED):`);
    for (const sop of openSops) {
      const age = sopAgeDays(sop);
      L.push(`${sop.customer || "?"} · ${sop.partNumber || sop.description || "?"}${sop.partNumber && sop.description ? ` (${sop.description})` : ""} · ${sop.status}${age != null ? ` · ${age}d on the shelf${age >= SOP_AGING_DAYS ? " — AGING, call them" : ""}` : ""}${sop.price ? ` · ${currency(sop.price)}` : ""}${sop.deposit ? " · deposit taken" : sop.status !== "Ordered" ? " · NO DEPOSIT" : ""}${sop.customerPhone ? ` · ${sop.customerPhone}` : ""}`);
    }
  }
  const openRequests = data.requests.filter((r) => r.status !== "Delivered");
  if (openRequests.length) {
    L.push(`\nTECH QUEUE${stats.avgFillMinutes != null ? ` (avg fill ${stats.avgFillMinutes} min over 30d)` : ""}:`);
    for (const r of openRequests) L.push(`${r.tech || "?"} · RO ${r.roNumber || "?"} · ${r.description || "?"} · ${r.status} since ${new Date(r.createdAt).toLocaleTimeString()}`);
  }
  const suggestions = stockSuggestions(data.lostSales);
  if (suggestions.length) {
    L.push(`\nSTOCK-IT SUGGESTIONS (3+ asks in 90 days):`);
    for (const sug of suggestions.slice(0, 8)) L.push(`${sug.label} · asked ${sug.demands}x · ${currency(sug.value)} walked out the door`);
  }
  return L.join("\n");
}

// fixed_ops_digest — the GM's weekly fixed-ops read (lib/fixedOpsDigest.ts,
// the SAME brain the Monday cron texts out): promises kept, win-back money,
// SOP shelf dollars, lost sales, and the one move to make first.
export function handleFixedOpsDigest(_input: any, ctx: EILAContext): string {
  const visits: any[] = Array.isArray((ctx.data as any).serviceLane) ? (ctx.data as any).serviceLane : [];
  const digest = buildFixedOpsDigest(visits, (ctx.data as any).partsCounter, ctx.settings.storeName || "the store");
  return `${digest.text}\n\n(The same digest texts the GM every Monday morning once a digest number is configured.)`;
}

// text_customer — EILA sends a REAL text through the same pipeline as the
// screen (lib/smsServer.ts: consent gate, own-customers privacy, opt-out
// notice, thread write — one brain, nothing can diverge). Outbound comms in
// a customer's pocket is the highest-stakes thing EILA does, so it's
// two-step like restore_backup: without confirm:true it only PREVIEWS.
export async function handleTextCustomer(input: any, ctx: EILAContext): Promise<string> {
  if (!twilioConfigured()) return "Texting isn't connected for this store yet — once the texting number is set up, I can send these for you. For now, copy the draft into your own phone.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Texting needs the secure backend — not available here.";

  const q = String(input?.customer || "").trim().toLowerCase();
  const message = String(input?.message || "").trim();
  if (!q || !message) return "I need the customer and the message to send.";

  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer) as any[];
  const hits = leads.filter((l) => String(l.customer || "").toLowerCase().includes(q));
  if (!hits.length) return `No working lead matches "${input?.customer}".`;
  if (hits.length > 1) return `Several leads match: ${hits.slice(0, 5).map((l) => l.customer).join(", ")}. Which one?`;
  const lead = hits[0];

  const consent = consentStatus(lead, "text");
  if (consent !== "granted") {
    return consent === "revoked"
      ? `HARD NO: ${lead.customer} revoked text consent — I won't send this, and neither should anyone. Suggest another consented channel or wait for them to reach out.`
      : `${lead.customer} has no text consent on file — capture it on their lead card (Consent chips) first, then I can send.`;
  }

  if (input?.confirm !== true) {
    const finalBody = withOptOutNotice(message, lead.messages);
    return [
      `READY TO SEND — needs the user's go-ahead (then call again with confirm:true):`,
      `To: ${lead.customer} · ${lead.customerPhone}`,
      `Message: "${finalBody}"`,
      `Consent: granted · thread has ${lead.messages?.length ?? 0} prior message(s).`,
    ].join("\n");
  }

  const result = await sendTextToLead({
    supabase,
    orgId: ctx.orgId,
    leadId: String(lead.id),
    body: message,
    senderName: ctx.viewer.employeeName || "EILA",
    role: ctx.viewer.role,
    mediaUrl: input?.imageUrl || undefined,
  });
  if (!result.ok) return `The send failed: ${result.error}`;
  return `Sent to ${lead.customer}: "${result.message.body}"${input?.imageUrl ? " + image" : ""} — it's on their thread.`;
}

// restore_backup — EILA parity for the Import screen's safety net. Destructive
// and org-wide, so three guards: (1) same roles that can write deals
// (Manager/F&I/Admin — canWrite matrix in lib/access.ts); (2) two-step —
// without confirm:true it only DESCRIBES the backup so EILA asks first;
// (3) the swap is reversible: the replaced board becomes the new backup,
// exactly like the screen. Writes bump the row's write-stamp, so open devices'
// next compare-and-swap save conflicts and reloads instead of clobbering.
export async function handleRestoreBackup(input: any, ctx: EILAContext): Promise<string> {
  const role = ctx.viewer.role;
  if (!(role === "Admin" || role === "Manager" || role === "F&I")) {
    return "Restoring the board is a manager move — ask a manager, F&I manager, or admin to run it.";
  }
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Secure store unavailable — use the Import screen's Safety net card instead.";

  const read = async (key: string) => {
    const { data } = await supabase.from("app_store").select("value").eq("org_id", ctx.orgId).eq("key", key).maybeSingle();
    return Array.isArray(data?.value) ? (data!.value as any[]) : [];
  };
  const backup = await read("deals_backup");
  const board = await read("deals");
  if (!backup.length) return "There's no safety-net backup on file for this store (one is snapshotted automatically whenever an import replaces the board).";

  const gross = (list: any[]) => list.reduce((t, d) => t + (Number(d.frontGross) || 0) + (Number(d.backGrossReserve) || 0), 0);
  const summary = `Backup: ${backup.length} deal(s), ${currency(gross(backup))} front+back. Board right now: ${board.length} deal(s), ${currency(gross(board))}.`;

  if (input?.confirm !== true) {
    return `${summary}\nRestoring REPLACES the current board with the backup (reversible — the replaced board becomes the new backup). To proceed, confirm with the user, then call restore_backup again with confirm=true.`;
  }

  const nowIso = new Date().toISOString();
  // Board first, verified; only then swap the old board into the backup slot —
  // a failed first write must never cost the backup.
  const { error: e1 } = await supabase.from("app_store").upsert(
    { org_id: ctx.orgId, key: "deals", value: backup, updated_at: nowIso },
    { onConflict: "org_id,key" },
  );
  if (e1) return `Restore failed — nothing was changed: ${e1.message}`;
  const { data: check } = await supabase.from("app_store").select("value").eq("org_id", ctx.orgId).eq("key", "deals").maybeSingle();
  const landed = Array.isArray(check?.value) ? check!.value.length : 0;
  if (landed !== backup.length) return `Restore write did not verify (expected ${backup.length} deals, found ${landed}) — check the board before doing anything else.`;
  const { error: e2 } = await supabase.from("app_store").upsert(
    { org_id: ctx.orgId, key: "deals_backup", value: board, updated_at: nowIso },
    { onConflict: "org_id,key" },
  );
  return `Done — ${backup.length} deal(s) are back on the board (verified).${e2 ? " Heads up: the replaced board could NOT be saved as the new backup." : ` The replaced ${board.length}-deal board is the new backup — restore again to swap back.`} Everyone should close and reopen the app to pick up the restored board.`;
}

export const GROUP_REPORT_TOOL = {
  name: "group_report",
  description:
    "Multi-store group rollup for dealer-group principals and the owner: units, gross, PVR, F&I PVR and PPU for every store in the group plus the group totals. Use for any cross-store or 'how's the group / which store' question. Access is enforced per caller — regular store users are politely declined.",
  input_schema: { type: "object", properties: {} },
};

export const SERVICE_LANE_TOOL = {
  name: "service_lane",
  description:
    "The Service Drive board: everything in the lane right now (status, promise times, LATE and due-soon flags, customers overdue for a status update), the declined-work WIN-BACK list with days-since and cadence windows, per-advisor promise-time hit rates, and service customers flagged as sales opportunities. Use for any service-department question.",
  input_schema: { type: "object", properties: {} },
};

export const PARTS_COUNTER_TOOL = {
  name: "parts_counter",
  description:
    "The Parts Counter board: every special order with its aging clock (received-but-not-picked-up is the #1 obsolescence feeder), deposit status, the live tech request queue with fill times, and the lost-sale ledger with stock-it suggestions. Use for any parts-department question.",
  input_schema: { type: "object", properties: {} },
};

export const FIXED_OPS_DIGEST_TOOL = {
  name: "fixed_ops_digest",
  description:
    "The Fixed Ops weekly digest — service promises kept this week, what's late right now, the win-back list, special-order shelf dollars and aging, lost sales, and the single top move. Use for 'how did fixed ops do', 'service and parts summary', or any week-in-review question.",
  input_schema: { type: "object", properties: {} },
};

export const TEXT_CUSTOMER_TOOL = {
  name: "text_customer",
  description:
    "Send a REAL text message to a customer on a working lead, through the store's texting number. Consent-gated server-side (granted text consent only) and two-step: call WITHOUT confirm first to get a preview, show it to the user, and only after they explicitly approve call again with confirm:true. Never confirm on your own.",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Customer name (or part of one) on the working lead." },
      message: { type: "string", description: "The text to send. Keep it short, human, and signed with the sender's first name." },
      confirm: { type: "boolean", description: "true ONLY after the user explicitly approved the previewed message." },
      imageUrl: { type: "string", description: "Optional: publicly accessible image URL to attach as MMS (vehicle photo, payment breakdown, etc)." },
    },
    required: ["customer", "message"],
  },
};

// ── schedule_text — EILA or a rep sets a text to fire later ────────────────
export async function handleScheduleText(input: any, ctx: EILAContext): Promise<string> {
  if (!twilioConfigured()) return "Texting isn't connected for this store yet.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Secure backend unavailable.";

  const q = String(input?.customer || "").trim().toLowerCase();
  const message = String(input?.message || "").trim();
  const when = String(input?.when || "").trim();
  if (!q || !message || !when) return "I need the customer, the message, and when to send it (e.g. 'tomorrow at 9am').";

  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer) as any[];
  const hits = leads.filter((l) => String(l.customer || "").toLowerCase().includes(q));
  if (!hits.length) return `No working lead matches "${input?.customer}".`;
  if (hits.length > 1) return `Several leads match: ${hits.slice(0, 5).map((l: any) => l.customer).join(", ")}. Which one?`;
  const lead = hits[0];

  if (consentStatus(lead, "text") !== "granted") {
    return consentStatus(lead, "text") === "revoked"
      ? `HARD NO: ${lead.customer} revoked text consent.`
      : `${lead.customer} has no text consent on file — capture it first.`;
  }

  // Parse the when — support common natural expressions
  const scheduledAt = parseScheduleTime(when);
  if (!scheduledAt) return `I couldn't parse "${when}" as a date/time. Try something like "tomorrow at 9am", "July 25 at 2pm", or an ISO datetime.`;
  if (new Date(scheduledAt) <= new Date()) return "That time is in the past — give me a future time.";

  const st: ScheduledText = {
    id: makeScheduledTextId(),
    leadId: String(lead.id),
    body: message,
    scheduledAt,
    createdAt: new Date().toISOString(),
    createdBy: ctx.viewer.employeeName || "EILA",
    status: "pending",
    mediaUrl: input?.imageUrl || undefined,
  };

  await guardedMutate<ScheduledText[]>(supabase, ctx.orgId, "scheduledTexts", (current) => {
    return [...(current ?? []), st];
  });

  const fireTime = new Date(scheduledAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `Scheduled ✔ Text to ${lead.customer} fires ${fireTime}: "${message}"${st.mediaUrl ? " + image" : ""} [id:${st.id}]`;
}

// Simple schedule-time parser for natural expressions
function parseScheduleTime(when: string): string | null {
  const now = new Date();
  const lower = when.toLowerCase().trim();

  // ISO datetime
  const iso = new Date(when);
  if (!isNaN(iso.getTime()) && when.includes("-")) return iso.toISOString();

  // "tomorrow at Xam/pm"
  const tomorrowMatch = lower.match(/tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    let h = parseInt(tomorrowMatch[1]);
    const m = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
    const ampm = tomorrowMatch[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  // "in X hours/minutes"
  const inMatch = lower.match(/in\s+(\d+)\s*(hour|hr|minute|min)/i);
  if (inMatch) {
    const n = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const ms = unit.startsWith("hour") || unit.startsWith("hr") ? n * 3600000 : n * 60000;
    return new Date(now.getTime() + ms).toISOString();
  }

  // "today at Xam/pm"
  const todayMatch = lower.match(/today\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (todayMatch) {
    const d = new Date(now);
    let h = parseInt(todayMatch[1]);
    const m = todayMatch[2] ? parseInt(todayMatch[2]) : 0;
    const ampm = todayMatch[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  // Bare "Xam/pm" — assume today if future, else tomorrow
  const bareTime = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (bareTime) {
    const d = new Date(now);
    let h = parseInt(bareTime[1]);
    const m = bareTime[2] ? parseInt(bareTime[2]) : 0;
    const ampm = bareTime[3].toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    d.setHours(h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  return null;
}

// ── cancel_scheduled_text — cancel a pending scheduled text ───────────────
export async function handleCancelScheduledText(input: any, ctx: EILAContext): Promise<string> {
  const textId = String(input?.textId || "").trim();
  if (!textId) return "I need the scheduled text ID (e.g. ST-1234567890).";

  const supabase = getSupabaseServerClient();
  if (!supabase) return "Secure backend unavailable.";

  let found = false;
  await guardedMutate<ScheduledText[]>(supabase, ctx.orgId, "scheduledTexts", (current) => {
    return (current ?? []).map((t) => {
      if (t.id === textId && t.status === "pending") {
        found = true;
        return cancelScheduled(t);
      }
      return t;
    });
  });

  return found ? `Cancelled ✔ Scheduled text ${textId} won't be sent.` : `No pending scheduled text found with ID "${textId}".`;
}

// ── list_scheduled_texts — show pending scheduled texts ───────────────────
export function handleListScheduledTexts(_input: any, ctx: EILAContext): string {
  const texts: ScheduledText[] = Array.isArray((ctx.data as any).scheduledTexts) ? (ctx.data as any).scheduledTexts : [];
  const leads: any[] = Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [];
  const pending = texts.filter((t) => t.status === "pending");
  if (!pending.length) return "No scheduled texts pending.";

  const out = [`=== ${pending.length} scheduled text(s) pending ===`];
  for (const t of pending.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    const lead = leads.find((l: any) => String(l?.id) === t.leadId);
    out.push(scheduledLine(t, lead?.customer || "Unknown"));
  }
  return out.join("\n");
}

// ── start_cadence — start a follow-up cadence on a lead ───────────────────
export async function handleStartCadence(input: any, ctx: EILAContext): Promise<string> {
  if (!twilioConfigured()) return "Texting isn't connected for this store yet.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Secure backend unavailable.";

  const q = String(input?.customer || "").trim().toLowerCase();
  if (!q) return "Which customer? Give me a name.";

  const template = String(input?.template || "new_lead") as CadenceTemplate;
  const validTemplates = [...Object.keys(CADENCE_TEMPLATES), "custom"] as CadenceTemplate[];
  if (!validTemplates.includes(template)) {
    return `Invalid template. Choose one: ${Object.entries(CADENCE_TEMPLATES).map(([k, v]) => `${k} (${v.label})`).join(", ")}, or "custom".`;
  }

  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer) as any[];
  const hits = leads.filter((l) => String(l.customer || "").toLowerCase().includes(q));
  if (!hits.length) return `No working lead matches "${input?.customer}".`;
  if (hits.length > 1) return `Several leads match: ${hits.slice(0, 5).map((l: any) => l.customer).join(", ")}. Which one?`;
  const lead = hits[0];

  if (lead.cadence?.status === "active") {
    return `${lead.customer} already has an active cadence (${cadenceSummary(lead.cadence)}). Cancel or pause it first.`;
  }
  if (consentStatus(lead, "text") !== "granted") {
    return consentStatus(lead, "text") === "revoked"
      ? `HARD NO: ${lead.customer} revoked text consent.`
      : `${lead.customer} has no text consent on file — capture it first.`;
  }

  const cadence = startCadence(template, ctx.viewer.employeeName || "EILA");
  const steps = cadenceSteps(cadence);

  await guardedMutate<any[]>(supabase, ctx.orgId, "crmLeads", (currentLeads) => {
    return (currentLeads ?? []).map((l: any) =>
      String(l?.id) === String(lead.id) ? { ...l, cadence } : l
    );
  });

  const templateInfo = template === "custom" ? "Custom cadence" : CADENCE_TEMPLATES[template].label;
  return `Started ✔ "${templateInfo}" cadence on ${lead.customer} — ${steps.length} steps over ${steps[steps.length - 1]?.day ?? 0} days. First text fires ${new Date(cadence.nextFireAt).toLocaleDateString()}. Cadence auto-pauses if the customer replies.`;
}

// ── manage_cadence — pause/resume/cancel a lead's cadence ─────────────────
export async function handleManageCadence(input: any, ctx: EILAContext): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Secure backend unavailable.";

  const q = String(input?.customer || "").trim().toLowerCase();
  if (!q) return "Which customer?";
  const action = String(input?.action || "").toLowerCase();
  if (!["pause", "resume", "cancel"].includes(action)) return "Action must be 'pause', 'resume', or 'cancel'.";

  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer) as any[];
  const hits = leads.filter((l) => String(l.customer || "").toLowerCase().includes(q));
  if (!hits.length) return `No working lead matches "${input?.customer}".`;
  if (hits.length > 1) return `Several leads match: ${hits.slice(0, 5).map((l: any) => l.customer).join(", ")}. Which one?`;
  const lead = hits[0];

  if (!lead.cadence) return `${lead.customer} doesn't have a cadence running.`;

  let newCadence: CadenceState;
  if (action === "pause") {
    newCadence = pauseCadence(lead.cadence, input?.reason || "Paused by user");
  } else if (action === "resume") {
    if (lead.cadence.status !== "paused") return `Cadence isn't paused — it's ${lead.cadence.status}.`;
    newCadence = { ...lead.cadence, status: "active", pausedReason: undefined };
  } else {
    newCadence = { ...lead.cadence, status: "cancelled" };
  }

  await guardedMutate<any[]>(supabase, ctx.orgId, "crmLeads", (currentLeads) => {
    return (currentLeads ?? []).map((l: any) =>
      String(l?.id) === String(lead.id) ? { ...l, cadence: newCadence } : l
    );
  });

  return `Done — ${lead.customer}'s cadence is now ${newCadence.status}${newCadence.pausedReason ? ` (${newCadence.pausedReason})` : ""}.`;
}

// ── text_analytics — conversation intelligence for coaching ───────────────
export function handleTextAnalytics(input: any, ctx: EILAContext): string {
  const leads: any[] = Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [];
  const now = new Date();

  const repName = String(input?.rep || "").trim();
  if (repName) {
    // Per-rep detail
    const repLeads = leads.filter((l) => samePerson(String(l.salesperson || ""), repName));
    if (!repLeads.length) return `No leads found for ${repName}.`;
    const withMsgs = repLeads.filter((l) => l.messages?.length > 0);
    const nudges = textNudges(repLeads, now);
    const metrics = withMsgs.map((l) => ({
      customer: l.customer || "?",
      ...responseMetrics(l.messages, now),
      lastSentiment: l.messages?.filter((m: any) => m.dir === "in").slice(-1)[0]?.sentiment || "none",
    }));

    const out = [`=== Text Analytics — ${repName} ===`];
    out.push(`Leads with text threads: ${withMsgs.length}`);
    const totalOut = metrics.reduce((s, m) => s + m.totalOutbound, 0);
    const totalIn = metrics.reduce((s, m) => s + m.totalInbound, 0);
    out.push(`Total texts: ${totalOut} sent, ${totalIn} received`);
    const responseTimes = metrics.filter((m) => m.avgResponseMinutes !== null).map((m) => m.avgResponseMinutes!);
    if (responseTimes.length) {
      const avg = Math.round((responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length) * 10) / 10;
      out.push(`Avg response time: ${avg} minutes`);
    }
    const waiting = metrics.filter((m) => m.waitingForReply);
    if (waiting.length) {
      out.push(`⚠ ${waiting.length} customer(s) waiting for a reply:`);
      for (const m of waiting) out.push(`  ${m.customer} — waiting ${m.waitingMinutes ?? "?"}m`);
    }
    if (nudges.length) {
      out.push("NUDGES:");
      for (const n of nudges.slice(0, 10)) out.push(`  [${n.urgency}] ${n.customer}: ${n.reason}`);
    }
    return out.join("\n");
  }

  // Store-wide analytics
  const analytics = repTextAnalytics(leads, now);
  if (!analytics.length) return "No text activity to analyze yet.";
  const nudges = textNudges(leads, now);

  const out = [`=== Store Text Analytics ===`];
  out.push("Rep | Sent | Received | Avg Response | Unanswered");
  for (const r of analytics) {
    out.push(`${r.name} | ${r.totalSent} | ${r.totalReceived} | ${r.avgResponseMinutes !== null ? `${r.avgResponseMinutes}m` : "—"} | ${r.unansweredCount}`);
  }
  if (nudges.length) {
    out.push(`\n⚠ ${nudges.length} nudge(s):`);
    for (const n of nudges.slice(0, 15)) out.push(`  [${n.urgency}] ${n.customer} (${n.salesperson}): ${n.reason}`);
  }
  return out.join("\n");
}

// ── broadcast_text — send a text to multiple leads at once ────────────────
export async function handleBroadcastText(input: any, ctx: EILAContext): Promise<string> {
  if (!twilioConfigured()) return "Texting isn't connected for this store yet.";

  const role = ctx.viewer.role;
  if (!(role === "Admin" || role === "Manager" || role === "F&I")) {
    return "Broadcast texting is a manager/admin feature.";
  }

  const filter = String(input?.filter || "").toLowerCase();
  const message = String(input?.message || "").trim();
  if (!message) return "I need a message to broadcast.";

  const leads: any[] = Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [];
  let targets: any[];

  if (filter === "appointments_today") {
    const today = new Date().toISOString().slice(0, 10);
    targets = leads.filter((l) => l.appointment && String(l.appointment).slice(0, 10) === today && l.status !== "Lost" && l.status !== "Won");
  } else if (filter === "appointments_tomorrow") {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    targets = leads.filter((l) => l.appointment && String(l.appointment).slice(0, 10) === tomorrowStr && l.status !== "Lost" && l.status !== "Won");
  } else if (filter.startsWith("status:")) {
    const status = filter.replace("status:", "").trim();
    targets = leads.filter((l) => String(l.status || "").toLowerCase() === status);
  } else if (filter.startsWith("rep:")) {
    const repName = filter.replace("rep:", "").trim();
    targets = leads.filter((l) => String(l.salesperson || "").toLowerCase().includes(repName));
  } else {
    return `I need a filter to select recipients. Options:\n• appointments_today — all customers with today's appointments\n• appointments_tomorrow — all customers with tomorrow's appointments\n• status:<stage> — all leads in a specific stage (e.g. status:working)\n• rep:<name> — all leads for a specific rep`;
  }

  // Filter to those with text consent
  const consented = targets.filter((l) => l.customerPhone && consentStatus(l, "text") === "granted" && !textRevokedAnywhere(leads, String(l.customerPhone || "")));
  const noConsent = targets.length - consented.length;

  if (!consented.length) return `No leads match that filter with text consent. (${targets.length} matched, ${noConsent} lack consent.)`;

  if (input?.confirm !== true) {
    const preview = consented.slice(0, 10).map((l) => `${l.customer || "?"} · ${l.salesperson || "?"}`).join("\n");
    return [
      `READY TO BROADCAST — needs your go-ahead (then call again with confirm:true):`,
      `Recipients: ${consented.length} (${noConsent} filtered out — no consent)`,
      `Message: "${message}"`,
      `Preview of recipients:`,
      preview,
      consented.length > 10 ? `... and ${consented.length - 10} more` : "",
    ].filter(Boolean).join("\n");
  }

  // Send! Use the scheduled text system for reliability
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Secure backend unavailable.";

  const now = new Date().toISOString();
  const scheduledTexts: ScheduledText[] = consented.map((l) => ({
    id: makeScheduledTextId(),
    leadId: String(l.id),
    body: message.replace("{name}", (l.customer || "").split(" ")[0] || "there").replace("{vehicle}", l.vehicle || "your vehicle"),
    scheduledAt: now, // fire immediately
    createdAt: now,
    createdBy: ctx.viewer.employeeName || "Admin",
    status: "pending" as const,
  }));

  await guardedMutate<ScheduledText[]>(supabase, ctx.orgId, "scheduledTexts", (current) => {
    return [...(current ?? []), ...scheduledTexts];
  });

  return `Broadcast queued ✔ ${scheduledTexts.length} texts will fire within the next minute. Message: "${message}"`;
}

export const SCHEDULE_TEXT_TOOL = {
  name: "schedule_text",
  description:
    "Schedule a text message to send to a customer at a specific future time. The consent gate re-checks at send time, so a STOP that arrives after scheduling is honored. Use for 'text Smith tomorrow at 9am', 'remind Chen about their appointment in 2 hours', etc.",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Customer name (or part of one) on the working lead." },
      message: { type: "string", description: "The text to send. Keep it short and human." },
      when: { type: "string", description: "When to send — natural language like 'tomorrow at 9am', 'in 2 hours', 'today at 3pm', or ISO datetime." },
      imageUrl: { type: "string", description: "Optional: publicly accessible image URL for MMS." },
    },
    required: ["customer", "message", "when"],
  },
};

export const CANCEL_SCHEDULED_TEXT_TOOL = {
  name: "cancel_scheduled_text",
  description:
    "Cancel a pending scheduled text before it fires. Use list_scheduled_texts to find the ID first.",
  input_schema: {
    type: "object",
    properties: { textId: { type: "string", description: "The scheduled text ID (e.g. ST-1234567890)" } },
    required: ["textId"],
  },
};

export const LIST_SCHEDULED_TEXTS_TOOL = {
  name: "list_scheduled_texts",
  description: "Show all pending scheduled texts — what's queued to fire and when.",
  input_schema: { type: "object", properties: {} },
};

export const START_CADENCE_TOOL = {
  name: "start_cadence",
  description:
    "Start a follow-up text cadence on a lead — an automated drip sequence that sends contextual texts over days/weeks. Templates: new_lead (14-day nurture), post_visit (didn't close), post_quote (numbers sent), service_followup (declined work), equity_trade (trade-up opportunity). Auto-pauses when the customer replies. Consent-gated.",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Customer name on the working lead." },
      template: { type: "string", enum: ["new_lead", "post_visit", "post_quote", "service_followup", "equity_trade"], description: "Which cadence template to run." },
    },
    required: ["customer", "template"],
  },
};

export const MANAGE_CADENCE_TOOL = {
  name: "manage_cadence",
  description:
    "Pause, resume, or cancel a lead's active follow-up cadence. Use when you need to manually intervene in an automated sequence.",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Customer name on the working lead." },
      action: { type: "string", enum: ["pause", "resume", "cancel"], description: "What to do with the cadence." },
      reason: { type: "string", description: "Why (for pause — shows on the lead card)." },
    },
    required: ["customer", "action"],
  },
};

export const TEXT_ANALYTICS_TOOL = {
  name: "text_analytics",
  description:
    "Text conversation intelligence — response times, sentiment trends, unanswered messages, and coaching nudges. Call without a rep name for the store-wide dashboard, or with a rep name for their individual stats. Use for 'how's our texting', 'who has unanswered texts', 'how fast does Bo reply'.",
  input_schema: {
    type: "object",
    properties: { rep: { type: "string", description: "Optional: drill into one rep's text stats." } },
  },
};

export const BROADCAST_TEXT_TOOL = {
  name: "broadcast_text",
  description:
    "Send a text to multiple leads at once — manager/admin only. Consent-gated per recipient. Two-step: call WITHOUT confirm to preview the recipient list, call with confirm:true after approval. Supports {name} and {vehicle} placeholders. Filters: appointments_today, appointments_tomorrow, status:<stage>, rep:<name>.",
  input_schema: {
    type: "object",
    properties: {
      filter: { type: "string", description: "Who to text: 'appointments_today', 'appointments_tomorrow', 'status:working', 'rep:Marcus'" },
      message: { type: "string", description: "The message. Use {name} for customer first name, {vehicle} for their vehicle." },
      confirm: { type: "boolean", description: "true ONLY after the user approved the preview." },
    },
    required: ["filter", "message"],
  },
};

export const RESTORE_BACKUP_TOOL = {
  name: "restore_backup",
  description:
    "Restore the store's safety-net deals backup (snapshotted automatically before any import that replaces the board) — the same restore as the Import screen. DESTRUCTIVE: replaces the current board. ALWAYS call it once WITHOUT confirm first to see what the backup holds, tell the user, and only call with confirm=true after they explicitly agree. Manager/F&I/Admin only.",
  input_schema: {
    type: "object",
    properties: { confirm: { type: "boolean", description: "true ONLY after the user has explicitly confirmed the restore" } },
  },
};

