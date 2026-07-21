import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { loadProfile } from "@/lib/profile";
import { buildIlaSystem, buildSnapshot, ilaConfigured } from "@/lib/ila";
import { loadBrainLessons } from "@commissioned41/ila-core/brain";
import { reflectAndRemember } from "@/lib/ila-reflect";
import { isSameOrigin } from "@/lib/http";
import { dbConfigured, prisma } from "@/lib/db";
import { plaidConfigured } from "@/lib/plaid";
import { syncAll } from "@/lib/sync";
import { detectRecurringBills } from "@/lib/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// EILA's hands — each tool reuses the SAME lib the screens use (one brain).
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "sync_accounts",
    description:
      "Pull the freshest balances and transactions from the user's linked banks via Plaid. Use when they ask to refresh/sync, or when the answer depends on very recent activity (a deposit landing, a charge posting). Returns sync counts plus a fresh post-sync snapshot — answer from that snapshot.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "detect_bills",
    description:
      "Scan the user's real transaction history for recurring charges that aren't in their bill list yet (same merchant, steady amount, monthly/weekly rhythm). Use when they ask what bills or subscriptions they have, whether anything recurring is missing, or where their money quietly goes. Returns candidates; they confirm them in Settings.",
    input_schema: { type: "object", properties: {} },
  },
];

const MAX_TOOL_TURNS = 4;

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return new Response("bad origin", { status: 403 });
  }
  if (!ilaConfigured()) {
    return new Response("EILA is not configured (missing ANTHROPIC_API_KEY).", { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: ChatMessage[] };
  const incoming = Array.isArray(body.messages) ? body.messages : [];

  // Keep only valid roles/content and cap history length.
  const messages = incoming
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response("Expected a trailing user message.", { status: 400 });
  }

  const { profile, isLive } = await loadProfile();
  const canUseTools = isLive && plaidConfigured() && dbConfigured();

  // EILA's memory — durable notes she distilled from past conversations.
  let memories: { note: string; createdAt: Date }[] = [];
  if (dbConfigured()) {
    try {
      memories = await prisma.ilaMemory.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
    } catch (e) {
      console.error("[ila] memory load failed:", e); // she can still answer without it
    }
  }

  const brain = await loadBrainLessons(); // her shared cross-product playbook
  const system = buildIlaSystem(profile, memories, brain, canUseTools);
  const client = new Anthropic();

  // EILA learns from the exchange once the full reply exists. after() runs the
  // reflection post-response, so the user never waits on it; the promise below
  // hands it the completed assistant text.
  let resolveReply: (text: string) => void;
  const replyDone = new Promise<string>((r) => (resolveReply = r));
  if (dbConfigured()) {
    after(async () => {
      const reply = await replyDone;
      if (reply.trim()) {
        await reflectAndRemember([...messages, { role: "assistant", content: reply }]);
      }
    });
  }

  async function runTool(name: string): Promise<string> {
    try {
      if (name === "sync_accounts") {
        const r = await syncAll();
        const fresh = await loadProfile();
        return `Sync complete: ${r.accounts} accounts refreshed, ${r.added} new transactions, ${r.modified} updated, ${r.removed} removed.\n\nFRESH SNAPSHOT (post-sync — use these numbers now):\n${buildSnapshot(fresh.profile)}`;
      }
      if (name === "detect_bills") {
        const fresh = await loadProfile();
        const candidates = detectRecurringBills(fresh.profile.transactions, fresh.profile.bills);
        if (!candidates.length) {
          return "No recurring charges found that aren't already in the bill list.";
        }
        return `Recurring charges found that are NOT yet bills (user confirms them in Settings → Bills):\n${candidates
          .map((c) => `- ${c.name}: $${c.amount} ${c.cadence}${c.dayOfMonth ? ` around the ${c.dayOfMonth}th` : ""} (seen ${c.occurrences}×, ${c.confidence} confidence)`)
          .join("\n")}`;
      }
      return `Unknown tool: ${name}`;
    } catch (e) {
      console.error(`[ila] tool ${name} failed:`, e);
      return "The tool hit an error. Answer from the snapshot you already have and tell the user the refresh didn't go through.";
    }
  }

  const encoder = new TextEncoder();
  let full = "";
  let activeStream: ReturnType<typeof client.messages.stream> | null = null;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const convo: Anthropic.Messages.MessageParam[] = [...messages];
      try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const stream = client.messages.stream({
            model: "claude-opus-4-8",
            max_tokens: 1024,
            system,
            messages: convo,
            ...(canUseTools ? { tools: TOOLS } : {}),
          });
          activeStream = stream;

          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              full += event.delta.text;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }

          const final = await stream.finalMessage();
          if (final.stop_reason !== "tool_use") break;

          // Run every requested tool, feed results back, let her continue.
          convo.push({ role: "assistant", content: final.content });
          const results: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type === "tool_use") {
              results.push({ type: "tool_result", tool_use_id: block.id, content: await runTool(block.name) });
            }
          }
          convo.push({ role: "user", content: results });
          if (full && !full.endsWith("\n")) {
            full += "\n\n";
            controller.enqueue(encoder.encode("\n\n"));
          }
        }
      } catch (e) {
        console.error("EILA stream error:", e);
        controller.enqueue(encoder.encode("\n\n(EILA hit a snag. Try again in a moment.)"));
      } finally {
        controller.close();
        resolveReply(full);
      }
    },
    cancel() {
      activeStream?.abort();
      resolveReply(full);
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
