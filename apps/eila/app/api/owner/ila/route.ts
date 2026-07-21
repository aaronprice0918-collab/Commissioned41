import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getSessionEmail, isOwner } from "@/lib/entitlement";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeOwnerPulse } from "@/lib/owner-pulse";
import { buildOwnerIlaSystem } from "@/lib/ila-owner";
import { ilaConfigured } from "@/lib/ila";
import { rateLimited } from "@/lib/rateLimit";

// Owner EILA — Aaron's own assistant for the business, not any rep's month.
// Triple-locked exactly like /api/owner/pulse (session + isOwner + service
// role only); talk-only by design, no tools — see lib/ila-owner.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;

interface ChatMessage { role: "user" | "assistant"; content: string }

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isOwner(email)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  if (await rateLimited(`owner-ila:${email}`, RATE_WINDOW_MS, RATE_MAX)) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  if (!ilaConfigured()) return NextResponse.json({ error: "EILA is not configured." }, { status: 400 });

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Owner view isn't configured." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { messages?: ChatMessage[]; name?: string };
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Expected a trailing user message." }, { status: 400 });
  }

  let system: string;
  try {
    const pulse = await computeOwnerPulse(admin);
    system = buildOwnerIlaSystem(String(body.name || "Aaron").slice(0, 40), pulse);
  } catch (e) {
    console.error("[owner/ila] pulse failed:", e);
    return NextResponse.json({ error: "Could not load the business data." }, { status: 500 });
  }

  const client = new Anthropic();
  // Prompt caching: auto-mark the newest block so follow-up turns re-read the
  // system pulse + prior conversation at ~0.1x instead of reprocessing it.
  const stream = client.messages.stream({ model: "claude-fable-5", max_tokens: 1536, cache_control: { type: "ephemeral" }, system, messages });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (e) {
        console.error("Owner EILA stream error:", e);
        controller.enqueue(encoder.encode("\n\n(Hit a snag pulling that up. Try again in a moment.)"));
      } finally {
        controller.close();
      }
    },
    cancel() { stream.abort(); },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
