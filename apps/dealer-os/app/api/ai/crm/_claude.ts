import type { EILAContext, Viewer } from "./_context";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { samePerson } from "@/lib/data";
import { assembleAnthropicStream, type StreamEvent } from "@/lib/anthropicStream";
import { saveRepObservation, saveCustomerObservation, savePatternObservation, saveMistakeObservation } from "./_memory";
import { handleQueryDeals, handleDealJacket, handleRepDetail, handleEstimatePay, handleNextLeads, handleAppointments, handleEquity, handleDealsAtRisk, handleReadArchive, QUERY_DEALS_TOOL, DEAL_JACKET_TOOL, REP_DETAIL_TOOL, ESTIMATE_PAY_TOOL, NEXT_LEADS_TOOL, APPOINTMENTS_TOOL, EQUITY_TOOL, AT_RISK_TOOL, READ_ARCHIVE_TOOL } from "./_tools-read";
import { handleUpdateLead, handleUpdateDeal, handleSetGoals, handleCloseMonth, handleServiceUpdate, handlePartsUpdate, UPDATE_LEAD_TOOL, UPDATE_DEAL_TOOL, SET_GOALS_TOOL, CLOSE_MONTH_TOOL, SERVICE_UPDATE_TOOL, PARTS_UPDATE_TOOL } from "./_tools-write";
import { handleLookupRate, handleDecodeVin, handleSpeedToLead, handleCheckConsent, LOOKUP_RATE_TOOL, DECODE_VIN_TOOL, SPEED_TO_LEAD_TOOL, CHECK_CONSENT_TOOL } from "./_tools-lookup";
import { handleGroupReport, handleServiceLane, handlePartsCounter, handleFixedOpsDigest, handleTextCustomer, handleRestoreBackup, handleScheduleText, handleCancelScheduledText, handleListScheduledTexts, handleStartCadence, handleManageCadence, handleTextAnalytics, handleBroadcastText, GROUP_REPORT_TOOL, SERVICE_LANE_TOOL, PARTS_COUNTER_TOOL, FIXED_OPS_DIGEST_TOOL, TEXT_CUSTOMER_TOOL, RESTORE_BACKUP_TOOL, SCHEDULE_TEXT_TOOL, CANCEL_SCHEDULED_TEXT_TOOL, LIST_SCHEDULED_TEXTS_TOOL, START_CADENCE_TOOL, MANAGE_CADENCE_TOOL, TEXT_ANALYTICS_TOOL, BROADCAST_TEXT_TOOL } from "./_tools-ops";
import { COACHING_PROMPT } from "./_prompts";

const REMEMBER_TOOL = {
  name: "remember_rep",
  description:
    "Save a lasting coaching observation about a salesperson or F&I manager to your persistent memory so it survives across conversations. Use this whenever you notice a strength, a weakness, or a recurring pattern worth remembering to coach this person better over time.",
  input_schema: {
    type: "object",
    properties: {
      rep: { type: "string", description: "Full name of the salesperson / F&I manager" },
      strengths: { type: "array", items: { type: "string" }, description: "Strengths to remember" },
      weaknesses: { type: "array", items: { type: "string" }, description: "Weak points / areas to improve" },
      patterns: { type: "array", items: { type: "string" }, description: "Behavioral or performance patterns noticed" },
      note: { type: "string", description: "Any other coaching note worth keeping" },
      drill: { type: "string", description: "A specific word track / rebuttal you're assigning this rep to practice, tied to a weakness (e.g. 'Practice the Feel-Felt-Found rebuttal for payment objections — run it 10x')." },
      personality: { type: "string", description: "This rep's personality / how they best take a push — so you coach them the way that lands (e.g. 'competitive hard-charger, responds to challenge' vs 'sensitive, rebuilding confidence, needs encouragement first')." },
      motivation: { type: "string", description: "Where they're at in life and their real 'why' — what they're working toward (e.g. 'new baby, saving for a house, money-motivated this quarter')." },
    },
    required: ["rep"],
  },
};
const REMEMBER_CUSTOMER_TOOL = {
  name: "remember_customer",
  description:
    "Save what you've learned about a specific CUSTOMER to your persistent memory so it survives across conversations — what they want, their objections, their situation, how they like to be handled. Use it whenever you learn something about a customer worth remembering to help close them and never restart cold.",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "The customer's name (or lead id)" },
      wants: { type: "array", items: { type: "string" }, description: "What they want — vehicle, payment, features, timing" },
      objections: { type: "array", items: { type: "string" }, description: "Objections / hesitations they've raised" },
      context: { type: "array", items: { type: "string" }, description: "Life/situation context — family, trade, credit, why they're buying" },
      note: { type: "string", description: "Any other detail worth keeping about this customer" },
    },
    required: ["customer"],
  },
};
const REMEMBER_PATTERN_TOOL = {
  name: "remember_pattern",
  description:
    "Save a high-order PATTERN you've learned about THIS store/floor to your store playbook — what converts, what objections recur and the word track that beats them, what the best closers do, timing/source trends. This is how you get smarter every deal. Use it whenever you spot a repeatable lesson about this dealership.",
  input_schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The pattern / lesson, stated concisely and actionably (e.g. 'Payment objections on used SUVs land best reframing to cost-of-ownership per day')." },
    },
    required: ["pattern"],
  },
};
const REMEMBER_MISTAKE_TOOL = {
  name: "remember_mistake",
  description:
    "Log a MISTAKE — made by ANYONE (a salesperson, an F&I manager, the store, or YOURSELF when you get something wrong and are corrected) — to your permanent memory, WITH the warning sign to watch for and the fix, so you CATCH it before it ever happens again and never make it yourself. Use it for any mistake, miss, or error: a missed product, a wrong tax/fee, a structure error, a compliance miss, a negative gross, a missing doc, a blown follow-up — anything that cost money, time, or created risk. Learn from every mistake so the store (and you) only ever pay for it once.",
  input_schema: {
    type: "object",
    properties: {
      mistake: { type: "string", description: "What went wrong, concretely (e.g. 'GAP sold on an 84-month deal at 145% LTV — would never have funded')." },
      sign: { type: "string", description: "The warning SIGN / setup that signals this mistake is about to repeat, specific enough to match a future deal (e.g. 'term >= 75mo AND GAP added AND LTV > 130%')." },
      fix: { type: "string", description: "How to catch / prevent it next time — the correct move." },
      deal: { type: "string", description: "The deal it happened on (customer or id), optional." },
    },
    required: ["mistake"],
  },
};

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ASSISTANT_MODEL = "claude-opus-4-8";

export const EILA_TOOLS = [QUERY_DEALS_TOOL, DEAL_JACKET_TOOL, REP_DETAIL_TOOL, ESTIMATE_PAY_TOOL, NEXT_LEADS_TOOL, APPOINTMENTS_TOOL, EQUITY_TOOL, AT_RISK_TOOL, READ_ARCHIVE_TOOL, UPDATE_LEAD_TOOL, UPDATE_DEAL_TOOL, SET_GOALS_TOOL, CLOSE_MONTH_TOOL, SERVICE_UPDATE_TOOL, PARTS_UPDATE_TOOL, LOOKUP_RATE_TOOL, DECODE_VIN_TOOL, SPEED_TO_LEAD_TOOL, CHECK_CONSENT_TOOL, GROUP_REPORT_TOOL, SERVICE_LANE_TOOL, PARTS_COUNTER_TOOL, FIXED_OPS_DIGEST_TOOL, TEXT_CUSTOMER_TOOL, SCHEDULE_TEXT_TOOL, CANCEL_SCHEDULED_TEXT_TOOL, LIST_SCHEDULED_TEXTS_TOOL, START_CADENCE_TOOL, MANAGE_CADENCE_TOOL, TEXT_ANALYTICS_TOOL, BROADCAST_TEXT_TOOL, RESTORE_BACKUP_TOOL, REMEMBER_TOOL, REMEMBER_CUSTOMER_TOOL, REMEMBER_PATTERN_TOOL, REMEMBER_MISTAKE_TOOL];


// Call Anthropic with retry on transient errors (429 / 5xx / 529 overloaded) so
// a one-off blip never surfaces to the floor. Throws only after retries fail.
async function anthropicFetch(apiKey: string, body: Record<string, any>, tries = 3): Promise<any> {
  let lastErr = "";
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    lastErr = `Anthropic error ${res.status}: ${await res.text()}`;
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retryable || attempt === tries - 1) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); // 0.5s, 1s backoff
  }
  throw new Error(lastErr || "Anthropic error: request failed");
}

export async function callClaude(
  systemBase: string,
  messages: { role: "user" | "assistant"; content: string }[],


// Run every tool_use block in a model turn against the live store and return the
// tool_result blocks to feed back. Shared by the buffered and streaming loops so
// there is exactly one dispatch table. Appends each fired tool name to
// `toolsUsed` (for the UI "working" chip). A single tool throwing degrades to a
// tool error string — it never takes down the turn.
export async function runToolCalls(content: any[], ctx: EILAContext, toolsUsed: string[]): Promise<any[]> {
  const results: any[] = [];
  for (const b of content || []) {
    if (b.type !== "tool_use") continue;
    toolsUsed.push(b.name);
    let out = "Unknown tool.";
    try {
      if (b.name === "query_deals") out = handleQueryDeals(b.input, ctx);
      else if (b.name === "deal_jacket") out = handleDealJacket(b.input, ctx);
      else if (b.name === "rep_detail") out = handleRepDetail(b.input, ctx);
      else if (b.name === "estimate_pay") out = handleEstimatePay(b.input, ctx);
      else if (b.name === "next_leads") out = handleNextLeads(b.input, ctx);
      else if (b.name === "appointments") out = handleAppointments(b.input, ctx);
      else if (b.name === "equity") out = handleEquity(b.input, ctx);
      else if (b.name === "deals_at_risk") out = handleDealsAtRisk(b.input, ctx);
      else if (b.name === "read_archive") out = handleReadArchive(b.input, ctx);
      else if (b.name === "update_lead") out = await handleUpdateLead(b.input, ctx);
      else if (b.name === "update_deal") out = await handleUpdateDeal(b.input, ctx);
      else if (b.name === "set_goals") out = await handleSetGoals(b.input, ctx);
      else if (b.name === "close_month") out = await handleCloseMonth(b.input, ctx);
      else if (b.name === "service_update") out = await handleServiceUpdate(b.input, ctx);
      else if (b.name === "parts_update") out = await handlePartsUpdate(b.input, ctx);
      else if (b.name === "lookup_rate") out = handleLookupRate(b.input, ctx);
      else if (b.name === "decode_vin") out = await handleDecodeVin(b.input, ctx);
      else if (b.name === "speed_to_lead") out = handleSpeedToLead(b.input, ctx);
      else if (b.name === "check_consent") out = handleCheckConsent(b.input, ctx);
      else if (b.name === "group_report") out = await handleGroupReport(b.input, ctx);
      else if (b.name === "service_lane") out = handleServiceLane(b.input, ctx);
      else if (b.name === "parts_counter") out = handlePartsCounter(b.input, ctx);
      else if (b.name === "fixed_ops_digest") out = handleFixedOpsDigest(b.input, ctx);
      else if (b.name === "text_customer") out = await handleTextCustomer(b.input, ctx);
      else if (b.name === "schedule_text") out = await handleScheduleText(b.input, ctx);
      else if (b.name === "cancel_scheduled_text") out = await handleCancelScheduledText(b.input, ctx);
      else if (b.name === "list_scheduled_texts") out = handleListScheduledTexts(b.input, ctx);
      else if (b.name === "start_cadence") out = await handleStartCadence(b.input, ctx);
      else if (b.name === "manage_cadence") out = await handleManageCadence(b.input, ctx);
      else if (b.name === "text_analytics") out = handleTextAnalytics(b.input, ctx);
      else if (b.name === "broadcast_text") out = await handleBroadcastText(b.input, ctx);
      else if (b.name === "restore_backup") out = await handleRestoreBackup(b.input, ctx);
      else if (b.name === "remember_rep") out = await saveRepObservation(b.input, ctx.orgId);
      else if (b.name === "remember_customer") out = await saveCustomerObservation(b.input, ctx.orgId);
      else if (b.name === "remember_pattern") out = await savePatternObservation(b.input, ctx.orgId);
      else if (b.name === "remember_mistake") out = await saveMistakeObservation(b.input, ctx.orgId);
    } catch (e) {
      out = `Tool error: ${e instanceof Error ? e.message : "failed"}`;
    }
    results.push({ type: "tool_result", tool_use_id: b.id, content: out });
  }
  return results;
}


// Chat path with EILA's memory tool — runs the tool loop so she can save
// coaching observations mid-conversation and then answer.
export async function callEILAChat(
  systemBase: string,
  ctx: EILAContext,
  messages: any[],
  maxTokens: number,
  extraSystem: string,
): Promise<{ text: string; tools: string[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const toolsUsed: string[] = []; // which tools EILA fired, for the UI "working" chip

  // Prompt caching: split the system into a STABLE block (EILA's core + the
  // Dealer layer + the sales playbook + this store's economics — identical on
  // every message of a user's session, ~11.5K tokens) and the VOLATILE store
  // snapshot. Each gets a cache breakpoint, so Anthropic re-reads them at
  // ~0.1x instead of full price on every turn. The stable block embeds the
  // caller's name (the core addresses the rep by name), so it caches per USER
  // across their turns rather than store-wide; the snapshot is reused across
  // turns within a session. Tools render before system, so the first
  // breakpoint caches the tool definitions too. Same model, same output —
  // this is a cost change, not a behavior change. (Verify via the cache_read
  // line logged below on the preview.)
  const stableSystem = `${systemBase}${COACHING_PROMPT}`;
  const system: any[] = [{ type: "text", text: stableSystem, cache_control: { type: "ephemeral" } }];
  if (extraSystem) system.push({ type: "text", text: extraSystem, cache_control: { type: "ephemeral" } });

  let msgs = [...messages];
  // Up to 6 turns so EILA can chain tool calls (query → query again → answer).
  for (let iter = 0; iter < 6; iter++) {
    // Adaptive thinking: EILA reasons as hard as the question deserves — deep on
    // deal structuring / audits / objections, barely at all on a quick lookup.
    // The visible reply stays tight (the prompt enforces it); the reasoning is
    // internal. "medium" effort keeps him snappy; max_tokens 4000 leaves
    // headroom for thinking + a full answer. Retries transient errors.
    const data = await anthropicFetch(apiKey, {
      model: ASSISTANT_MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // Top-level cache_control auto-marks the LAST block in the request — the
      // newest message / tool result — so the conversation itself is cached
      // too: each tool-loop round and each follow-up turn re-reads the prior
      // exchange at ~0.1x instead of reprocessing it. If the auto breakpoint's
      // lookback misses (long tool round), the explicit system breakpoints
      // above still catch, so a miss never costs more than today's baseline.
      cache_control: { type: "ephemeral" },
      system,
      tools: EILA_TOOLS,
      messages: msgs,
    });
    if (data.usage) {
      const u = data.usage;
      console.log(`[AI/CRM] cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0}`);
    }
    if (data.stop_reason === "tool_use") {
      msgs.push({ role: "assistant", content: data.content });
      const results = await runToolCalls(data.content, ctx, toolsUsed);
      msgs.push({ role: "user", content: results });
      continue;
    }
    const textBlock = (data.content || []).find((b: any) => b.type === "text");
    return { text: textBlock?.text || "", tools: Array.from(new Set(toolsUsed)) };
  }
  return { text: "Done.", tools: Array.from(new Set(toolsUsed)) };
}

async function anthropicFetchStream(apiKey: string, body: Record<string, any>, tries = 3, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  let lastErr = "";
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
    if (res.ok && res.body) return res.body;
    lastErr = `Anthropic error ${res.status}: ${await res.text().catch(() => "")}`;
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retryable || attempt === tries - 1) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(lastErr || "Anthropic stream error: request failed");
}

export async function streamEILAChat(
  systemBase: string,
  ctx: EILAContext,
  messages: any[],
  maxTokens: number,
  extraSystem: string,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<{ text: string; tools: string[]; aborted: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const toolsUsed: string[] = [];

  const stableSystem = `${systemBase}${COACHING_PROMPT}`;
  const system: any[] = [{ type: "text", text: stableSystem, cache_control: { type: "ephemeral" } }];
  if (extraSystem) system.push({ type: "text", text: extraSystem, cache_control: { type: "ephemeral" } });

  let fullText = "";
  let msgs = [...messages];
  for (let iter = 0; iter < 6; iter++) {
    // If the client went away mid-stream, stop the loop — don't keep burning
    // model calls and tool side-effects for an abandoned request.
    if (signal?.aborted) return { text: fullText, tools: Array.from(new Set(toolsUsed)), aborted: true };
    const stream = await anthropicFetchStream(apiKey, {
      model: ASSISTANT_MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system,
      tools: EILA_TOOLS,
      messages: msgs,
    }, 3, signal);
    // Assemble the turn while forwarding text + tool events to the client.
    const assembled = await assembleAnthropicStream(stream, (e) => {
      if (e.type === "text") fullText += e.text;
      onEvent(e);
    });
    if (assembled.usage) {
      const u = assembled.usage;
      console.log(`[AI/CRM stream] cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0}`);
    }
    if (assembled.stop_reason === "tool_use") {
      msgs.push({ role: "assistant", content: assembled.content });
      const results = await runToolCalls(assembled.content, ctx, toolsUsed);
      msgs.push({ role: "user", content: results });
      continue;
    }
    break; // end_turn (or any non-tool stop) — the streamed text is the reply.
  }
  // If the loop exhausted its turns still wanting tools (no concluding text),
  // emit the same fallback the buffered path returns so the reply is never empty.
  if (!fullText.trim()) {
    const done = "Done.";
    fullText = done;
    onEvent({ type: "text", text: done });
  }
  return { text: fullText, tools: Array.from(new Set(toolsUsed)), aborted: false };
}

// SECURITY: the per-lead actions (health-check / draft-followup / next-action /
// first chat turn) must NOT trust the lead object from the request body — a rep
// could POST another rep's customer. Resolve the lead from the store by id and
// enforce the same rule as the store API: a Sales user may only act on their OWN


// SECURITY: the per-lead actions (health-check / draft-followup / next-action /
// first chat turn) must NOT trust the lead object from the request body — a rep
// could POST another rep's customer. Resolve the lead from the store by id and
// enforce the same rule as the store API: a Sales user may only act on their OWN
// leads. Managers/F&I/BDC/Admin/owner may act on any lead in their store.
export async function resolveLead(
  orgId: string,
  viewer: Viewer,
  clientLead: Record<string, any> | undefined,
): Promise<{ lead: Record<string, any> | null; denied: boolean }> {
  if (!clientLead) return { lead: null, denied: false };
  const supabase = getSupabaseServerClient();
  if (!supabase) return { lead: clientLead, denied: false }; // dev only
  let stored: Record<string, any> | null = null;
  if (clientLead.id) {
    const { data } = await supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
    const leads: any[] = Array.isArray(data?.value) ? data!.value : [];
    stored = leads.find((l) => l.id === clientLead.id) || null;
  }
  if (viewer.role === "Sales") {
    if (!stored || !samePerson(stored.salesperson, viewer.employeeName)) return { lead: null, denied: true };
    return { lead: stored, denied: false };
  }
  // Non-Sales roles can see the whole store; prefer the authoritative stored copy.
  return { lead: stored || clientLead, denied: false };
}

