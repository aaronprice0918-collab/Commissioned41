import type { EILAContext } from "./_context";
import { scopeLeads } from "./_context";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { currency, samePerson } from "@/lib/data";
import { guardedMutate } from "@/lib/storeServer";
import { isLate, laneStats, promiseRisk, promiseStats, recaptureList, updateDue, type ServiceStatus } from "@/lib/service";
import { SOP_AGING_DAYS, counterStats, normalizePartsData, sopAgeDays, stockSuggestions, type SopStatus } from "@/lib/parts";
import { buildFixedOpsDigest } from "@/lib/fixedOpsDigest";
import { groupForViewer, groupRollup, type GroupStoreInput } from "@/lib/groupReport";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { withOptOutNotice } from "@/lib/comms";
import { consentStatus, suppressionDeadline } from "@/lib/consent";
import { isOpenLead, scoreLead } from "@/lib/leadScore";


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
  });
  if (!result.ok) return `The send failed: ${result.error}`;
  return `Sent to ${lead.customer}: "${result.message.body}" — it's on their thread.`;
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
    },
    required: ["customer", "message"],
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

