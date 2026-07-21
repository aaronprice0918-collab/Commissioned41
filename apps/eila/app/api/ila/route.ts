import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { rateLimited } from "@/lib/rateLimit";
import { buildIlaSystemParts, ilaConfigured } from "@/lib/ila";
import { loadBrainLessons } from "@commissioned41/ila-core/brain";
import { ILA_TOOLS, ILA_TOOLS_GUIDANCE, TOOL_MARKER } from "@/lib/ila-tools";
import type { Deal, IlaMemory, LifeItem, Profile } from "@/lib/types";
import type { PayPlan } from "@/lib/payplan/types";

// EILA chat — streams a Claude response grounded in the rep's live performance
// data (goal pace, pipeline, follow-ups). Same gate as /api/parse-payplan:
// signed-in + subscribed (dev bypasses the subscription check).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // multi-round tool turns can run long; don't die at the platform default

const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL; // any Vercel deploy (previews too) enforces the gate — only true local dev gets the convenience pass

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15;

// Chat history can carry plain text OR structured blocks — the client sends
// tool_use/tool_result blocks back when continuing after executing EILA's
// fixes. Everything is sanitized field-by-field before reaching the model.
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type InBlock =
  | { type: "text"; text: string }
  | ImageBlock
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface ChatMessage {
  role: "user" | "assistant";
  content: string | InBlock[];
}

const TOOL_NAMES = new Set(ILA_TOOLS.map((t) => t.name));

// A rep can attach a screenshot (THE LOGG, a deal screen, a payoff) — EILA reads
// it with vision. Bound hard: only real image types, a per-image byte cap, and a
// cap on how many ride in one request, so a huge paste can't blow the request
// body or the model context.
const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BASE64 = 1_500_000; // ~1.1MB decoded — the client downscales below this before sending
const MAX_IMAGES_PER_REQUEST = 4;

function sanitizeBlocks(raw: unknown[]): InBlock[] {
  const out: InBlock[] = [];
  let images = 0;
  // 24, not 8: a round where EILA fires many parallel tool calls used to get
  // its later tool_use blocks silently dropped while all the results were
  // still sent — the continuation 400'd (July 8 audit). Orphans that still
  // slip past any cap are stripped by repairToolPairs below.
  for (const b of raw.slice(0, 24)) {
    const x = b as InBlock;
    if (x?.type === "text" && typeof x.text === "string" && x.text.trim()) {
      out.push({ type: "text", text: x.text.slice(0, 6000) });
    } else if (
      x?.type === "image" && images < MAX_IMAGES_PER_REQUEST &&
      x.source?.type === "base64" && IMAGE_MEDIA_TYPES.has(String(x.source.media_type)) &&
      typeof x.source.data === "string" && x.source.data.length > 0 && x.source.data.length <= MAX_IMAGE_BASE64
    ) {
      images++;
      out.push({ type: "image", source: { type: "base64", media_type: String(x.source.media_type), data: x.source.data } });
    } else if (
      x?.type === "tool_use" && typeof x.id === "string" && TOOL_NAMES.has(String(x.name)) &&
      x.input && typeof x.input === "object" && JSON.stringify(x.input).length < 6000
    ) {
      out.push({ type: "tool_use", id: x.id.slice(0, 64), name: String(x.name), input: x.input as Record<string, unknown> });
    } else if (x?.type === "tool_result" && typeof x.tool_use_id === "string" && typeof x.content === "string") {
      out.push({ type: "tool_result", tool_use_id: x.tool_use_id.slice(0, 64), content: x.content.slice(0, 4000), ...(x.is_error ? { is_error: true } : {}) });
    }
  }
  return out;
}

// Window repair (July 8 audit): a blind slice(-20) could open the window on an
// assistant turn or mid tool-exchange — both Anthropic 400s ("first message
// must be user", "tool_result without matching tool_use"). Rules: the window
// must start on a plain user turn, and tool_use/tool_result blocks survive
// only as matched pairs across adjacent (assistant → user) messages. A message
// left empty by the strip becomes a placeholder text block so role alternation
// is preserved.
function repairToolPairs(messages: { role: "user" | "assistant"; content: string | InBlock[] }[]): void {
  const blocksOf = (m: { content: string | InBlock[] }) => (Array.isArray(m.content) ? m.content : []);
  const hasToolResult = (m: { content: string | InBlock[] }) => blocksOf(m).some((b) => b.type === "tool_result");
  while (messages.length && (messages[0].role !== "user" || hasToolResult(messages[0]))) messages.shift();

  // Matched ids per adjacent assistant→user boundary, computed BEFORE any strip.
  const keep: Set<string>[] = messages.map(() => new Set<string>());
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role !== "assistant" || messages[i + 1].role !== "user") continue;
    const uses = new Set(blocksOf(messages[i]).filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id));
    for (const b of blocksOf(messages[i + 1])) {
      if (b.type === "tool_result" && uses.has(b.tool_use_id)) { keep[i].add(b.tool_use_id); keep[i + 1].add(b.tool_use_id); }
    }
  }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!Array.isArray(m.content)) continue;
    const filtered = m.content.filter((b) =>
      b.type === "text" || b.type === "image" ? true : b.type === "tool_use" ? keep[i].has(b.id) : keep[i].has(b.tool_use_id),
    );
    m.content = filtered.length ? filtered : [{ type: "text", text: "(earlier context trimmed)" }];
  }
}

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  if (await rateLimited(`ila:${email}`, RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  let active = false;
  try {
    active = await hasActiveSubscription(email);
  } catch (e) {
    console.error("[ila] subscription check failed:", e);
    active = false;
  }
  if (!active && IS_PROD) {
    return NextResponse.json({ error: "Subscription required." }, { status: 402 });
  }

  if (!ilaConfigured()) {
    return NextResponse.json({ error: "EILA is not configured." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    messages?: ChatMessage[];
    profile?: Profile;
    plan?: PayPlan;
    deals?: Deal[];
    lifeItems?: LifeItem[];
    memories?: IlaMemory[];
    allowTools?: boolean;
  };

  // EILA's per-user memory notes ride in from the client (they live in the
  // user's synced AppData, not on the server). Sanitize hard: strings only,
  // clipped, capped.
  const memories: IlaMemory[] = (Array.isArray(body.memories) ? body.memories : [])
    .filter((m) => m && typeof m.note === "string" && m.note.trim())
    .slice(0, 40)
    .map((m) => ({
      id: String(m.id ?? ""),
      date: typeof m.date === "string" ? m.date : "",
      note: m.note.trim().slice(0, 300),
    }));

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .slice(-20)
    .map((m) => {
      if (typeof m.content === "string") return m.content.trim() ? { role: m.role, content: m.content } : null;
      if (Array.isArray(m.content)) {
        const blocks = sanitizeBlocks(m.content);
        return blocks.length ? { role: m.role, content: blocks } : null;
      }
      return null;
    })
    .filter((m): m is NonNullable<typeof m> => !!m);
  repairToolPairs(messages);

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Expected a trailing user message." }, { status: 400 });
  }
  if (!body.profile || !body.plan || !Array.isArray(body.deals)) {
    return NextResponse.json({ error: "Missing profile/plan/deals." }, { status: 400 });
  }
  // DoS bound, not a math change: no real month approaches this, and an
  // unbounded array made every request run forecast() over whatever a caller
  // sent (July 8 audit).
  if (body.deals.length > 1000) body.deals = body.deals.slice(0, 1000);

  const lifeItems: LifeItem[] = (Array.isArray(body.lifeItems) ? body.lifeItems : [])
    .filter((i) => i && typeof i.title === "string" && typeof i.date === "string")
    .slice(0, 200)
    .map((i) => ({
      id: String(i.id ?? ""),
      title: String(i.title).trim().slice(0, 120),
      kind: (i.kind === "appointment" || i.kind === "personal" ? i.kind : "task") as LifeItem["kind"],
      date: String(i.date).slice(0, 10),
      ...(typeof i.time === "string" ? { time: i.time.slice(0, 5) } : {}),
      ...(typeof i.note === "string" ? { note: i.note.trim().slice(0, 200) } : {}),
      ...(i.done ? { done: true } : {}),
      createdAt: typeof i.createdAt === "string" ? i.createdAt : "",
    }))
    .filter((i) => i.title && /^\d{4}-\d{2}-\d{2}$/.test(i.date));

  const brain = await loadBrainLessons(); // her shared cross-product playbook
  // Prompt caching: the persona/memory half of the prompt is byte-identical
  // across a user's turns, so it gets its own breakpoint; the live snapshot
  // (which changes when a tool edits data) rides after it, so a data edit
  // never invalidates the cached persona. Same words, same model, same
  // answers — this is purely a cost/latency change.
  const parts = buildIlaSystemParts(body.profile, body.plan, body.deals, memories, brain, lifeItems);
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: parts.stable, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text:
        parts.live +
        (body.allowTools
          ? ILA_TOOLS_GUIDANCE
          // Truthfulness when tools are OFF: the money/budget snapshot text
          // mentions tool names (update_money, log_spend…) — without this line a
          // tool-less context could promise fixes it can't make (July 8 audit).
          : "\nREAD-ONLY CONTEXT: no tools are available on this turn. Ignore any instruction elsewhere in this prompt to call a tool (update_money, log_spend, upsert_bill, …) — describe what to change and where instead of claiming you changed it."),
    },
  ];
  const client = new Anthropic();

  // Snappy by design. This is a texting-style assistant, so time-to-first-token
  // matters more than deep reasoning. Fable 5 ALWAYS thinks before replying (its
  // thinking can't be turned off), which landed as several seconds of dead air
  // after every send — the #1 reason the chat felt slow. Opus 4.8 with `thinking`
  // omitted starts streaming immediately (and at half Fable's price); `effort:
  // low` keeps replies short and quick. The EILA core already enforces brevity,
  // and her heavy reasoning lives in the owner/analytics surfaces, not this chat.
  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    // Fast, terse replies for a chat surface (GA param; cast keeps it building on
    // SDK 0.109's older types).
    ...({ output_config: { effort: "low" } } as Record<string, unknown>),
    // Auto-mark the newest message too, so the conversation itself (including
    // the client-side tool round-trips, which re-send everything) is re-read
    // from cache instead of reprocessed each round.
    cache_control: { type: "ephemeral" },
    system,
    messages: messages as Anthropic.MessageParam[],
    // Her hands: only the interactive chat opts in (the morning briefing
    // reads, never edits). Tools execute client-side, where the data lives.
    ...(body.allowTools ? { tools: ILA_TOOLS as Anthropic.Tool[] } : {}),
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        // If she reached for a tool, ship the calls to the client after the
        // spoken text — the client applies them and continues the exchange.
        const final = await stream.finalMessage();
        const u = final.usage;
        console.log(`[ila] cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} in=${u.input_tokens} out=${u.output_tokens}`);
        const toolUses = final.content.filter((b) => b.type === "tool_use");
        if (toolUses.length) {
          controller.enqueue(encoder.encode(
            TOOL_MARKER + JSON.stringify(toolUses.map((t) => ({ id: t.id, name: t.name, input: t.input }))),
          ));
        }
      } catch (e) {
        console.error("EILA stream error:", e);
        controller.enqueue(encoder.encode("\n\n(EILA hit a snag. Try again in a moment.)"));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
