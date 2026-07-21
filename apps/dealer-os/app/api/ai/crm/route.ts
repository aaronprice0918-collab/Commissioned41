import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { ilaCore } from "@commissioned41/ila-core/core";
import { loadBrainLessons, renderBrain } from "@commissioned41/ila-core/brain";
import { loadUserMemory, reflectUserMemory, renderUserMemory } from "@/lib/ila-user-memory";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { resolveCaller, storeContext, leadToContext, loadStoreData, buildSnapshot, type EILAContext } from "./_context";
import { DEALER_PROMPT, COACHING_PROMPT } from "./_prompts";
import { callClaude, callEILAChat, streamEILAChat, resolveLead } from "./_claude";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// EILA chains up to 6 sequential model calls per turn (tool loop: query → query
// again → answer) plus transient-error backoff. Give her headroom to finish.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { ok, orgId, settings, viewer } = await resolveCaller(req);
    if (!ok) {
      return NextResponse.json(
        { error: "The Dealer Mission OS Assistant isn't enabled for your store. Ask your admin to turn it on in Store Settings." },
        { status: 403 },
      );
    }

    // Keyed per USER within the org — one heavy user gets throttled without
    // starving the rest of the floor (an org-only key bucketed the whole store).
    const rl = await rateLimit(clientKey(req, `${orgId}:${viewer.employeeName || "anon"}`), { limit: 40, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);

    // EILA on every action = the canonical core (who she is, everywhere) + the
    // Dealer capability layer (what she does here) + THIS store's economics.
    const systemBase = `${ilaCore(viewer.employeeName || "this team")}\n\n${DEALER_PROMPT}\n\n${storeContext(settings)}`;

    // EILA's memory, two tiers, both consumed on every action and both living
    // in the VOLATILE prompt block so the stable block's per-session prompt
    // cache is untouched:
    //  - per-rep memory: what she's learned about THIS person (new notes are
    //    distilled after chat turns — see reflectUserMemory below)
    //  - the main brain: universal craft lessons shared by every C41 product
    const [repNotes, brainLessons] = await Promise.all([
      loadUserMemory(orgId, viewer.employeeName),
      loadBrainLessons(),
    ]);
    const userMemory = [renderUserMemory(repNotes), renderBrain(brainLessons)]
      .filter(Boolean)
      .join("\n\n");

    const body = await req.json() as Record<string, any>;
    const { action, lead, message, history = [], channel = "text" } = body;

    // Never render a client-supplied lead unchecked — resolve + authorize it.
    const { lead: safeLead, denied } = await resolveLead(orgId, viewer, lead);
    if (denied) {
      return NextResponse.json(
        { error: "You can only use the assistant on your own leads." },
        { status: 403 },
      );
    }
    const leadCtx = safeLead ? leadToContext(safeLead) : "";

    if (action === "next-action") {
      const text = await callClaude(
        systemBase,
        [{ role: "user", content: `${leadCtx}\n\nWhat is the single best next action for this lead RIGHT NOW? Give one specific, immediately actionable recommendation in 1–2 sentences. No bullet points, no preamble.` }],
        120,
        userMemory || undefined,
      );
      return NextResponse.json({ suggestion: text });
    }

    if (action === "health-check") {
      const text = await callClaude(
        systemBase,
        [{
          role: "user",
          content: `${leadCtx}\n\nAnalyze this lead's health and buying likelihood. Return ONLY valid JSON, no markdown:
{
  "score": <number 1-10>,
  "label": "<Hot|Warm|Cool|Cold>",
  "summary": "<one sentence on deal health>",
  "flags": ["<risk or positive observation>"],
  "recommendation": "<top priority action in one sentence>"
}`,
        }],
        280,
        userMemory || undefined,
      );
      try {
        const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
        const health = JSON.parse(cleaned);
        return NextResponse.json({ health });
      } catch {
        return NextResponse.json({
          health: { score: 5, label: "Warm", summary: text, flags: [], recommendation: "" },
        });
      }
    }

    if (action === "draft-followup") {
      const isEmail = channel === "email";
      // firstTouch: the speed-to-lead intro on a fresh up — a different job
      // than a follow-up. First words the customer ever gets from the store,
      // racing the 5:00 clock: introduce the rep by name, hook to exactly
      // what they asked about, end on one easy question. Never mention that
      // it's AI-written, never sound like a dealership blast.
      const instruction = body?.firstTouch
        ? `Draft the FIRST text message this brand-new lead will ever receive from ${viewer.employeeName || "the rep"} at this store. Two sentences max, under 280 characters. Open with their first name, introduce the sender by first name and store, reference the exact vehicle or request they came in on, and end with ONE easy low-pressure question that moves toward a visit. Warm, human, specific — zero dealer-speak, no exclamation-point pile-ups, no "great news!". Return ONLY the message text.`
        : `Draft a short, personalized ${isEmail ? "email (include a subject line)" : "text message (max 3 sentences)"} follow-up for this customer. Sound human and specific to their situation — no generic dealer-speak.`;
      const text = await callClaude(
        systemBase,
        [{ role: "user", content: `${leadCtx}\n\n${instruction}` }],
        isEmail ? 220 : 140,
        userMemory || undefined,
      );
      return NextResponse.json({ draft: text });
    }

    if (action === "chat") {
      // Coalesce consecutive same-role turns and drop blanks before they reach
      // the Messages API, which rejects two messages of the same role in a row.
      // A client that (e.g.) ended a turn with a partial+error assistant bubble
      // must never brick the next request.
      const prior: { role: "user" | "assistant"; content: string }[] = [];
      for (const m of (history || [])) {
        const role = (m?.role === "assistant" ? "assistant" : "user") as "user" | "assistant";
        const content = String(m?.content ?? "").trim();
        if (!content) continue;
        const last = prior[prior.length - 1];
        if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
        else prior.push({ role, content });
      }
      const userContent = prior.length === 0
        ? `${leadCtx}\n\nQuestion: ${message}`
        : message;

      // EILA gets this store's full live dataset on every chat turn so she can
      // answer anything and audit the deals.
      // Load the store data ONCE: it backs both the capped text snapshot and
      // EILA's live-query tools (which run over it with no extra DB calls).
      const data = await loadStoreData(orgId);
      const snapshot = buildSnapshot(data, settings, viewer);
      const ctx: EILAContext = { orgId, settings, viewer, data };
      // Append the new user turn, merging if prior already ends on a user turn
      // (keeps roles strictly alternating for the Messages API).
      const messages: any[] = [...prior];
      const lastPrior = messages[messages.length - 1];
      if (lastPrior && lastPrior.role === "user") {
        messages[messages.length - 1] = { role: "user", content: `${lastPrior.content}\n\n${userContent}` };
      } else {
        messages.push({ role: "user", content: userContent });
      }
      // 4000 leaves room for adaptive thinking + a full answer; the prompt keeps
      // the visible reply short, so this is headroom for reasoning, not length.
      const extraSystem = userMemory ? `${snapshot}\n\n${userMemory}` : snapshot;

      // Distill durable per-rep notes after the reply is settled (waitUntil keeps
      // the function alive on Vercel; a failed reflection never disturbs chat).
      // Shared by both the streaming and buffered paths.
      const reflect = (replyText: string) => {
        if (replyText.trim() && viewer.employeeName.trim()) {
          waitUntil(reflectUserMemory(orgId, viewer.employeeName, [
            ...prior,
            { role: "user", content: String(message ?? "") },
            { role: "assistant", content: replyText },
          ]));
        }
      };

      // Streaming path (opt-in via { stream: true }): EILA talks as she thinks.
      // Emits newline-delimited JSON events — {t:"token"|"tool"|"done"|"error"}.
      // Backward-compatible: callers that don't ask for a stream get the JSON
      // reply below, unchanged.
      if (body?.stream === true) {
        const encoder = new TextEncoder();
        const signal = req.signal;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let closed = false;
            // Guard every enqueue: if the client already left, the controller is
            // closed/errored and enqueue throws — swallow it instead of crashing
            // the whole handler (and re-throwing inside the catch below).
            const send = (obj: Record<string, unknown>) => {
              if (closed || signal.aborted) return;
              try {
                controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
              } catch {
                closed = true;
              }
            };
            try {
              const result = await streamEILAChat(systemBase, ctx, messages, 4000, extraSystem, (e) => {
                if (e.type === "text") send({ t: "token", v: e.text });
                else if (e.type === "tool") send({ t: "tool", v: e.name });
              }, signal);
              if (!result.aborted) {
                send({ t: "done", tools: result.tools });
                reflect(result.text); // only learn from a reply the user actually received
              }
            } catch (err) {
              if (!signal.aborted) {
                const msg = err instanceof Error ? err.message : "Something went wrong.";
                send({ t: "error", v: msg });
              }
            } finally {
              closed = true;
              try { controller.close(); } catch { /* already closed by an abort */ }
            }
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            "x-accel-buffering": "no",
          },
        });
      }

      const result = await callEILAChat(systemBase, ctx, messages, 4000, extraSystem);
      reflect(result.text);
      return NextResponse.json({ reply: result.text, tools: result.tools });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[AI/CRM]", message);
    if (message.includes("ANTHROPIC_API_KEY not set")) {
      return NextResponse.json(
        { error: "Add ANTHROPIC_API_KEY to your Vercel environment variables and redeploy." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
