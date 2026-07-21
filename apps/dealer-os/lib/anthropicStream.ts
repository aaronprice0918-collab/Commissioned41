// Anthropic streaming (SSE) assembler — the heart of EILA's streaming tool loop.
//
// The Messages API streams a turn as a sequence of server-sent events
// (message_start, content_block_start/delta/stop, message_delta, message_stop).
// This module turns that byte stream back into a single assembled message —
// text blocks reconstructed from text_delta, and tool_use blocks reconstructed
// from streamed partial_json — while forwarding user-facing text deltas live so
// EILA can talk as she thinks instead of landing a wall of text after a pause.
//
// It is deliberately pure and transport-free: `createStreamAssembler` is fed raw
// SSE text chunks (which may split an event across chunk boundaries) and yields
// the final message; `assembleAnthropicStream` is the thin adapter that pumps a
// real ReadableStream through it. Keeping the parsing here — not buried in the
// route — is what makes the tool loop testable without hitting the network.

// A block from a fully-assembled model turn. Mirrors the shape the non-streaming
// Messages API returns in `content[]`, so the tool loop can treat a streamed
// turn and a buffered turn identically.
export type AssembledBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  // Thinking blocks are never shown to the user, but they MUST be preserved
  // intact (text + signature) so a tool-use turn can be handed back to the
  // Messages API — with extended/adaptive thinking on, the API rejects a
  // follow-up turn whose thinking blocks were stripped or emptied.
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

export type AssembledMessage = {
  content: AssembledBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

// User-facing events surfaced live as the turn streams. `text` is a delta to
// append to the visible reply; `tool` fires when EILA starts a tool call, so the
// UI can show a "working" chip naming what she's doing.
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string };

export class AnthropicStreamError extends Error {}

// Stateful assembler. Feed it raw SSE text via push() (any chunking is fine —
// events split across pushes are buffered until complete), then call finish()
// for the assembled message. onEvent fires synchronously for each user-facing
// delta during push().
export function createStreamAssembler(onEvent: (e: StreamEvent) => void) {
  let sseBuffer = ""; // raw bytes not yet split into complete SSE events
  const blocks: AssembledBlock[] = [];
  const partialJson: Record<number, string> = {}; // index -> accumulated tool input JSON
  const usage: AssembledMessage["usage"] = {};
  let stopReason: string | null = null;

  function handleEvent(payload: Record<string, unknown>) {
    const type = payload.type;
    switch (type) {
      case "message_start": {
        const u = (payload.message as { usage?: Record<string, number> } | undefined)?.usage;
        if (u) Object.assign(usage, u);
        return;
      }
      case "content_block_start": {
        const index = payload.index as number;
        const cb = payload.content_block as { type: string; id?: string; name?: string } | undefined;
        if (!cb) return;
        const cbFull = cb as { type: string; id?: string; name?: string; signature?: string; data?: string };
        if (cb.type === "text") {
          blocks[index] = { type: "text", text: "" };
        } else if (cb.type === "tool_use") {
          blocks[index] = { type: "tool_use", id: cb.id || "", name: cb.name || "", input: {} };
          partialJson[index] = "";
          if (cb.name) onEvent({ type: "tool", name: cb.name });
        } else if (cb.type === "thinking") {
          // Preserved but never streamed to the user; the signature arrives via
          // signature_delta and is required for the block to be replayable.
          blocks[index] = { type: "thinking", thinking: "", signature: cbFull.signature || "" };
        } else if (cb.type === "redacted_thinking") {
          // Opaque encrypted reasoning — arrives complete, replayed verbatim.
          blocks[index] = { type: "redacted_thinking", data: cbFull.data || "" };
        }
        // Any other (future) block type is left as a hole and filtered out at
        // finish() — never a placeholder, which would corrupt a replayed turn.
        return;
      }
      case "content_block_delta": {
        const index = payload.index as number;
        const delta = payload.delta as { type: string; text?: string; partial_json?: string; thinking?: string; signature?: string } | undefined;
        if (!delta) return;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          const b = blocks[index];
          if (b && b.type === "text") b.text += delta.text;
          onEvent({ type: "text", text: delta.text });
        } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          partialJson[index] = (partialJson[index] || "") + delta.partial_json;
        } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          // Accumulated so the block can be replayed — NOT surfaced to the user.
          const b = blocks[index];
          if (b && b.type === "thinking") b.thinking += delta.thinking;
        } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
          const b = blocks[index];
          if (b && b.type === "thinking") b.signature = delta.signature;
        }
        return;
      }
      case "content_block_stop": {
        const index = payload.index as number;
        const b = blocks[index];
        if (b && b.type === "tool_use") {
          const raw = partialJson[index] || "";
          b.input = parseToolInput(raw);
        }
        return;
      }
      case "message_delta": {
        const delta = payload.delta as { stop_reason?: string } | undefined;
        if (delta?.stop_reason) stopReason = delta.stop_reason;
        const u = payload.usage as Record<string, number> | undefined;
        if (u) Object.assign(usage, u);
        return;
      }
      case "error": {
        const err = payload.error as { message?: string; type?: string } | undefined;
        throw new AnthropicStreamError(err?.message || err?.type || "Anthropic stream error");
      }
      // message_stop, ping — nothing to assemble.
      default:
        return;
    }
  }

  return {
    // Feed raw SSE text. Splits on the blank-line event delimiter; a trailing
    // partial event is held in the buffer until the next push completes it.
    push(chunk: string) {
      sseBuffer += chunk;
      let sep: number;
      // SSE events are separated by a blank line ("\n\n").
      while ((sep = sseBuffer.indexOf("\n\n")) !== -1) {
        const rawEvent = sseBuffer.slice(0, sep);
        sseBuffer = sseBuffer.slice(sep + 2);
        emitEvent(rawEvent, handleEvent);
      }
    },
    // Flush any final event the stream ended without a trailing blank line on,
    // then return the assembled message.
    finish(): AssembledMessage {
      const tail = sseBuffer.trim();
      if (tail) emitEvent(tail, handleEvent);
      sseBuffer = "";
      return { content: blocks.filter(Boolean), stop_reason: stopReason, usage };
    },
  };
}

// Pull the JSON out of a single SSE event's `data:` line(s) and hand it to the
// handler. Lines that aren't data (event:, id:, comments) are ignored; the JSON
// carries its own `type`, so the event: line is redundant. A [DONE] sentinel or
// unparseable data line is skipped rather than throwing.
function emitEvent(rawEvent: string, handle: (p: Record<string, unknown>) => void) {
  const dataLines = rawEvent
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) return;
  const joined = dataLines.join("");
  if (!joined || joined === "[DONE]") return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(joined);
  } catch {
    return; // a malformed frame never takes down the turn
  }
  handle(payload);
}

// Tool inputs arrive as streamed partial_json; an empty stream means an argless
// tool call ({}). A parse failure is surfaced under `_parseError` rather than
// thrown, so one bad tool call degrades to a tool error instead of killing the
// whole reply.
function parseToolInput(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { _parseError: true, _raw: raw };
  }
}

// Pump a real ReadableStream (Anthropic's response body) through the assembler,
// forwarding user-facing deltas via onEvent and returning the assembled turn.
export async function assembleAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: StreamEvent) => void,
): Promise<AssembledMessage> {
  const assembler = createStreamAssembler(onEvent);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    assembler.push(decoder.decode(value, { stream: true }));
  }
  return assembler.finish();
}
