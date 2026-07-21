import { NextResponse } from "next/server";
import { isOwnerEmail } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { DEFAULT_ORG_ID } from "@/lib/orgs";

// MissionOS Core — Aaron's private executive operating system. This is NOT
// EILA (the dealership sales coach sold to tenants). Core is owner-only and
// spans his whole life: faith, family, health, finances, business, growth.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Core makes heavy, non-streaming model calls; give it the same timeout headroom
// as the other AI brains so a deep question can't 504.
export const maxDuration = 60;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const CORE_MODEL = "claude-opus-4-8";
const STORE_KEY = "missionCore";

// Owner-only. Core handles deeply personal data, so it never opens to anyone
// but the product owner.
async function ownerOnly(req: Request): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return process.env.NODE_ENV !== "production"; // dev convenience
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return false;
  return isOwnerEmail(data.user.email);
}

const SYSTEM_PROMPT = `You are MissionOS — Aaron Price's elite personal executive operating system. You are NOT a generic chat assistant and you are NOT EILA (the dealership sales coach). MissionOS is a personal operating system that helps Aaron think, decide, execute, automate, and win across every domain of his life.

PRIME OBJECTIVE — judge every recommendation against this:
Build successful businesses, lead his family well, grow spiritually, create financial freedom, and maximize the impact of his life.

WHO AARON IS:
- Aaron Price — founder/CEO of Commissioned 41 (building MissionOS, a dealership operating system going SaaS), and F&I/Admin at Kennesaw Mazda. Man of faith. Husband and father. Driven to build wealth, lead well, and live with purpose.

CORE DIRECTIVES:
1. Think like a CEO — strategic, not reactive. Analyze objectives, risks, opportunities, bottlenecks, and leverage points. Recommend what creates maximum long-term value.
2. Act like a Chief of Staff — track his goals, projects, deadlines, tasks, follow-ups, relationships, and opportunities. Remind him what matters most.
3. Prioritize ruthlessly — weigh impact, revenue potential, time required, strategic importance, and alignment with long-term goals. Push him to the highest-leverage action.
4. Solve problems completely — root cause, options, comparison, recommendation, implementation plan, anticipated obstacles, next actions. Never leave it half-solved.
5. Be context-aware — learn his goals, habits, preferences, businesses, family priorities, schedule, strengths, and weaknesses, and use them. (His tracked context is supplied below under MISSION STATE — build on it and keep it current with the update_mission tool.)
6. Be proactive — surface risks, opportunities, and issues he hasn't asked about. Look around corners. Explain why it matters and what to do.
7. Decision intelligence — for major decisions give Best Case / Worst Case / Most Likely / Risks / Opportunity Cost / Recommendation / Confidence Score (0-100%).
8. Mission Control — hold awareness across Faith (Bible study, prayer, spiritual growth), Family (marriage, children, important dates), Health (sleep, fitness, nutrition), Finances (income, expenses, investments), and Business/Career (revenue, growth, opportunities, networking, learning).
9. Execution mode — when given a goal, break it into Annual targets, Quarterly objectives, Monthly goals, Weekly priorities, and Daily actions, with measurable outcomes.
10. Radical honesty — never tell him what he wants to hear. Tell him what's true, what's working, what's failing, what he's avoiding, and what to do next — even when it's uncomfortable.

MEMORY — you keep a persistent record of Aaron's life so you get sharper over time:
- The MISSION STATE below is your live memory: his north star, goals (by horizon), current priorities, and notes you've learned. Reference it; never re-ask what you already know.
- Whenever something is worth remembering or changes — a new goal, a completed goal, a shifting priority, a fact about his life/habits/family/business — call the update_mission tool to persist it. Do this on your own, without being asked.

COMMUNICATION STYLE: clear, direct, concise, action-oriented, data-driven, encouraging, professional. No filler, no hedging. Respect his faith.

ALWAYS end every substantive response with these three lines:
Recommended Action: <the single highest-leverage thing to do>
Why It Matters: <tie it to the prime objective>
Next Step: <the concrete immediate next step>`;

async function loadMissionState(): Promise<{ state: any; block: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { state: {}, block: "MISSION STATE: (store unavailable)" };
  const { data } = await supabase.from("app_store").select("value").eq("org_id", DEFAULT_ORG_ID).eq("key", STORE_KEY).maybeSingle();
  const state = (data?.value && typeof data.value === "object") ? data.value : {};
  const goals: any[] = Array.isArray(state.goals) ? state.goals : [];
  const priorities: any[] = Array.isArray(state.priorities) ? state.priorities : [];
  const notes: any[] = Array.isArray(state.notes) ? state.notes : [];
  const L: string[] = [];
  L.push("=== MISSION STATE (your live memory of Aaron) ===");
  L.push(`North Star: ${state.northStar || "(not set — help him define it)"}`);
  if (goals.length) {
    L.push("Goals:");
    for (const g of goals) L.push(`  [${g.status || "open"}] (${g.horizon || "—"}/${g.area || "—"}) ${g.title}${g.due ? ` — due ${g.due}` : ""}`);
  } else {
    L.push("Goals: (none yet)");
  }
  L.push(priorities.length ? `Current priorities: ${priorities.map((p) => p.title || p).join("; ")}` : "Current priorities: (none set)");
  if (notes.length) {
    L.push("What you've learned about Aaron:");
    for (const n of notes.slice(-30)) L.push(`  - ${typeof n === "string" ? n : n.text}`);
  }
  L.push("=== END MISSION STATE ===");
  return { state, block: L.join("\n") };
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function applyUpdate(input: any): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const { data } = await supabase.from("app_store").select("value").eq("org_id", DEFAULT_ORG_ID).eq("key", STORE_KEY).maybeSingle();
  const state: any = (data?.value && typeof data.value === "object") ? data.value : {};
  state.goals = Array.isArray(state.goals) ? state.goals : [];
  state.priorities = Array.isArray(state.priorities) ? state.priorities : [];
  state.notes = Array.isArray(state.notes) ? state.notes : [];

  const done: string[] = [];
  if (input?.northStar && String(input.northStar).trim()) {
    state.northStar = String(input.northStar).trim();
    done.push("north star");
  }
  for (const g of Array.isArray(input?.addGoals) ? input.addGoals : []) {
    if (!g?.title) continue;
    state.goals.push({
      id: uid("goal"),
      title: String(g.title).trim(),
      horizon: g.horizon || "month",
      area: g.area || "business",
      status: "open",
      due: g.due || "",
      createdAt: new Date().toISOString(),
    });
    done.push("added a goal");
  }
  for (const id of Array.isArray(input?.completeGoalIds) ? input.completeGoalIds : []) {
    const g = state.goals.find((x: any) => x.id === id);
    if (g) { g.status = "done"; done.push("completed a goal"); }
  }
  if (Array.isArray(input?.setPriorities)) {
    state.priorities = input.setPriorities.filter(Boolean).map((t: any) => ({ id: uid("pri"), title: String(t).trim() }));
    done.push("updated priorities");
  }
  for (const n of Array.isArray(input?.addNotes) ? input.addNotes : []) {
    const text = String(n).trim();
    if (text) { state.notes.push({ id: uid("note"), ts: new Date().toISOString(), text }); done.push("saved a note"); }
  }
  state.updatedAt = new Date().toISOString();
  await supabase.from("app_store").upsert({ org_id: DEFAULT_ORG_ID, key: STORE_KEY, value: state, updated_at: new Date().toISOString() }, { onConflict: "org_id,key" });
  return done.length ? `Mission state updated: ${done.join(", ")}.` : "Nothing to update.";
}

const UPDATE_TOOL = {
  name: "update_mission",
  description:
    "Persist changes to Aaron's MissionOS state so they survive across conversations. Use whenever you learn something worth keeping or something changes — a new goal, a completed goal, shifting priorities, his north star, or a fact about his life, family, business, health, or faith.",
  input_schema: {
    type: "object",
    properties: {
      northStar: { type: "string", description: "Set/refine Aaron's overarching mission statement" },
      addGoals: {
        type: "array",
        description: "New goals to track",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            horizon: { type: "string", enum: ["annual", "quarter", "month", "week", "day"] },
            area: { type: "string", enum: ["faith", "family", "health", "finances", "business", "growth"] },
            due: { type: "string", description: "Optional due date (plain text or ISO)" },
          },
          required: ["title"],
        },
      },
      completeGoalIds: { type: "array", items: { type: "string" }, description: "Ids of goals now completed" },
      setPriorities: { type: "array", items: { type: "string" }, description: "Replace the current top priorities list" },
      addNotes: { type: "array", items: { type: "string" }, description: "Lasting facts/observations about Aaron to remember" },
    },
  },
};

async function runCore(messages: any[], maxTokens: number, stateBlock: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const system = `${SYSTEM_PROMPT}\n\n${stateBlock}`;
  let msgs = [...messages];
  for (let iter = 0; iter < 5; iter++) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CORE_MODEL, max_tokens: maxTokens, system, tools: [UPDATE_TOOL], messages: msgs }),
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.stop_reason === "tool_use") {
      msgs.push({ role: "assistant", content: data.content });
      const results: any[] = [];
      for (const b of data.content || []) {
        if (b.type === "tool_use" && b.name === "update_mission") {
          const out = await applyUpdate(b.input);
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
      return NextResponse.json({ error: "MissionOS Core is owner-only." }, { status: 403 });
    }
    const body = (await req.json()) as Record<string, any>;
    const { action, message, history = [] } = body;
    const { block } = await loadMissionState();

    if (action === "briefing") {
      const text = await runCore(
        [{ role: "user", content: "Give me my MissionOS briefing right now: where I stand across faith, family, health, finances, and business, what matters most today, and the single highest-leverage action. Be specific and honest." }],
        1200,
        block,
      );
      return NextResponse.json({ reply: text });
    }

    if (action === "chat") {
      const prior = (history || []).map((m: any) => ({ role: m.role, content: m.content }));
      const messages = [...prior, { role: "user", content: String(message || "") }];
      const text = await runCore(messages, 1400, block);
      return NextResponse.json({ reply: text });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[AI/CORE]", msg);
    if (msg.includes("ANTHROPIC_API_KEY not set")) {
      return NextResponse.json({ error: "Add ANTHROPIC_API_KEY to Vercel env and redeploy." }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
