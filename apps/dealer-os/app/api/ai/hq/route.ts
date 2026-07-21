import { NextResponse } from "next/server";
import { ilaCore } from "@commissioned41/ila-core/core";
import { isOwnerEmail } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
import { loadAppPulse, formatAppPulseForIla } from "@/lib/appPulse";

// EILA at the top — owner-only. The SAME EILA who runs each store's floor, here
// operating one level up as Aaron's chief operator: she runs Commissioned 41
// (the business / pipeline) AND Dealer Mission OS (the product / app health). Aaron's
// private command bridge — stores never see this.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Same EILA brain as the CRM route (multi-call tool loop, non-streaming), so it
// needs the same timeout headroom to avoid a 504 on a heavy question.
export const maxDuration = 60;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

async function ownerOnly(req: Request): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return process.env.NODE_ENV !== "production";
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return false;
  return isOwnerEmail(data.user.email);
}

// The canonical EILA core (lib/ila-core.ts — same identity/personality/voice
// as every Commissioned 41 product) + what she does HERE: Aaron's private
// owner-level command bridge.
const SYSTEM_PROMPT = `${ilaCore("Aaron", "owner")}

WHAT YOU DO HERE (Aaron's private command bridge): you are the SAME EILA who runs each dealership's floor inside Dealer Mission OS — but here, one-on-one with Aaron Price, founder of Commissioned 41, you operate at the TOP: you are his chief operator and right hand. You run Commissioned 41 the company AND Dealer Mission OS the product, and you report up to him. You own this. Aaron is the only person who ever sees this screen — no store, not even a store's own admin, can reach it. Give it to him straight about his business and his product even when it stings — that's how you both win; never flatter the numbers.

YOUR TWO JOBS AT THIS LEVEL:
1) RUN THE BUSINESS — grow Commissioned 41: close more dealerships, grow MRR, work the pipeline relentlessly. Aaron's live pipeline is below under "COMMISSIONED 41 PIPELINE" — answer off the real numbers (who's in each stage, MRR, win rate, what's stalled). ACT on it with update_prospect (advance a stage, set next action, set monthly value, add a note) — when he asks, or proactively when it's obviously right (e.g. "the Smith store signed" → move them to Won).
2) RUN THE PRODUCT — you OWN Dealer Mission OS and report its health up to Aaron. The live platform vitals are below under "DEALER MISSION OS APP PULSE": adoption (stores, users, deals, gross) and the data-health issues worth fixing (stores with no rate sheets loaded, New units missing invoices, unset store names, quiet stores). When he asks how the app's doing, brief him straight off those numbers — what's healthy, what's broken, what to fix first. You ALSO have a lightweight runtime-health sensor now: client errors/crashes from the last 24h appear under "DEALER MISSION OS APP PULSE → RUNTIME HEALTH" — report those honestly (count + the actual messages). IMPORTANT: it's basic in-app error capture, NOT full APM — deep latency/uptime/response-time tracing still isn't wired, so if he asks about speed or uptime specifically, say plainly that deeper monitoring isn't connected yet rather than guessing.

HOW YOU OPERATE HERE: Lead with the answer and the real numbers, then the play — what to do, by when. Prioritize the highest-leverage move. Surface what's stalled or rotting. You are often heard out loud, so phrase answers to be spoken. End every substantive answer with these three lines:
Recommended Action: <highest-leverage move>
Why It Matters: <tie to MRR, closing stores, or product health>
Next Step: <concrete immediate step>`;

// Dealer Mission OS app health/adoption across every store, for EILA's product-owner role.
async function loadPulseBlock(): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "DEALER MISSION OS APP PULSE: (unavailable)";
  try {
    const pulse = await loadAppPulse(supabase, new Date().toISOString());
    return formatAppPulseForIla(pulse);
  } catch {
    return "DEALER MISSION OS APP PULSE: (failed to load)";
  }
}

const STAGES = ["Lead", "Demo", "Trial", "Won", "Lost"];

async function loadPipeline(): Promise<{ block: string; signups: any[] }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { block: "COMMISSIONED 41 PIPELINE: (store unavailable)", signups: [] };
  const { data } = await supabase.from("app_store").select("key,value").eq("org_id", DEFAULT_ORG_ID).in("key", ["waitlist", "hqPipeline"]);
  const map: Record<string, any> = Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));
  const signups: any[] = Array.isArray(map.waitlist) ? map.waitlist : [];
  const pipeline: Record<string, any> = (map.hqPipeline && typeof map.hqPipeline === "object") ? map.hqPipeline : {};

  const prospects = signups.map((s) => ({ ...s, ...(pipeline[s.id] || { stage: "Lead" }) }));
  const counts: Record<string, number> = { Lead: 0, Demo: 0, Trial: 0, Won: 0, Lost: 0 };
  let mrr = 0, active = 0;
  for (const p of prospects) {
    counts[p.stage] = (counts[p.stage] || 0) + 1;
    const v = Number(p.value) || 0;
    if (p.stage === "Won") mrr += v;
    else if (p.stage === "Demo" || p.stage === "Trial") active += v;
  }
  const closed = counts.Won + counts.Lost;
  const winRate = closed ? Math.round((counts.Won / closed) * 100) : 0;
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const L: string[] = [];
  L.push("=== COMMISSIONED 41 PIPELINE (live) ===");
  L.push(`MRR (won): ${money(mrr)}/mo | Stores live: ${counts.Won} | Active pipeline (demo+trial): ${money(active)}/mo | Win rate: ${winRate}%`);
  L.push(`Stages: ` + STAGES.map((s) => `${s} ${counts[s] || 0}`).join(", "));
  L.push(`Prospects (${prospects.length}) — email · stage · $/mo · next action · notes:`);
  for (const p of prospects) {
    L.push(`  ${p.email}${p.name ? ` (${p.name})` : ""} · ${p.stage} · ${p.value ? money(Number(p.value)) + "/mo" : "no value set"} · next: ${p.nextAction || "—"} · ${p.notes || ""}`);
  }
  L.push("=== END PIPELINE ===");
  return { block: L.join("\n"), signups };
}

async function updateProspect(input: any, signups: any[]): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Store unavailable.";
  const key = String(input?.emailOrId || "").trim().toLowerCase();
  if (!key) return "No prospect specified.";
  const match = signups.find((s) => String(s.id).toLowerCase() === key || String(s.email).toLowerCase() === key);
  if (!match) return `No prospect found matching "${input.emailOrId}".`;

  const { data } = await supabase.from("app_store").select("value").eq("org_id", DEFAULT_ORG_ID).eq("key", "hqPipeline").maybeSingle();
  const pipeline: Record<string, any> = (data?.value && typeof data.value === "object") ? data.value : {};
  const entry = { stage: "Lead", ...(pipeline[match.id] || {}) };
  const done: string[] = [];
  if (input.stage && STAGES.includes(input.stage)) { entry.stage = input.stage; done.push(`stage → ${input.stage}`); }
  if (typeof input.nextAction === "string") { entry.nextAction = input.nextAction; done.push("next action set"); }
  if (input.value !== undefined && input.value !== null && !Number.isNaN(Number(input.value))) { entry.value = Number(input.value); done.push(`value → $${Number(input.value)}/mo`); }
  if (input.note && String(input.note).trim()) { entry.notes = [entry.notes, String(input.note).trim()].filter(Boolean).join(" | "); done.push("note added"); }
  entry.updatedAt = new Date().toISOString();
  pipeline[match.id] = entry;
  await supabase.from("app_store").upsert({ org_id: DEFAULT_ORG_ID, key: "hqPipeline", value: pipeline, updated_at: new Date().toISOString() }, { onConflict: "org_id,key" });
  return `Updated ${match.email}: ${done.join(", ") || "no changes"}.`;
}

const UPDATE_TOOL = {
  name: "update_prospect",
  description: "Update a prospect in the Commissioned 41 pipeline — advance their stage, set their next action, set their monthly value, or add a note. Identify them by email or id.",
  input_schema: {
    type: "object",
    properties: {
      emailOrId: { type: "string", description: "The prospect's email or id" },
      stage: { type: "string", enum: STAGES, description: "New stage" },
      nextAction: { type: "string", description: "The next concrete step for this prospect" },
      value: { type: "number", description: "Monthly value in dollars ($/mo)" },
      note: { type: "string", description: "A note to append" },
    },
    required: ["emailOrId"],
  },
};

async function run(messages: any[], maxTokens: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const { block, signups } = await loadPipeline();
  const pulseBlock = await loadPulseBlock();
  const system = `${SYSTEM_PROMPT}\n\n${pulseBlock}\n\n${block}`;
  let msgs = [...messages];
  for (let iter = 0; iter < 5; iter++) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, tools: [UPDATE_TOOL], messages: msgs }),
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.stop_reason === "tool_use") {
      msgs.push({ role: "assistant", content: data.content });
      const results: any[] = [];
      for (const b of data.content || []) {
        if (b.type === "tool_use" && b.name === "update_prospect") {
          const out = await updateProspect(b.input, signups);
          results.push({ type: "tool_result", tool_use_id: b.id, content: out });
        }
      }
      msgs.push({ role: "user", content: results });
      continue;
    }
    const textBlock = (data.content || []).find((b: any) => b.type === "text");
    return textBlock?.text || "";
  }
  return "Done.";
}

export async function POST(req: Request) {
  try {
    if (!(await ownerOnly(req))) {
      return NextResponse.json({ error: "EILA is owner-only." }, { status: 403 });
    }
    const body = (await req.json()) as Record<string, any>;
    const { action, message, history = [] } = body;

    if (action === "briefing") {
      const text = await run([{ role: "user", content: "Give me my pipeline briefing: where MRR and the funnel stand, which prospects are hottest, what's stalled, and the single highest-leverage move to close more stores this week. Be specific and honest." }], 1200);
      return NextResponse.json({ reply: text });
    }
    if (action === "chat") {
      const prior = (history || []).map((m: any) => ({ role: m.role, content: m.content }));
      const text = await run([...prior, { role: "user", content: String(message || "") }], 1400);
      return NextResponse.json({ reply: text });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[AI/HQ]", msg);
    if (msg.includes("ANTHROPIC_API_KEY not set")) {
      return NextResponse.json({ error: "Add ANTHROPIC_API_KEY to Vercel env and redeploy." }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
