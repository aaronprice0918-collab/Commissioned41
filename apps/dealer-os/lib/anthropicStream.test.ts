import test from "node:test";
import assert from "node:assert/strict";
import {
  AnthropicStreamError,
  assembleAnthropicStream,
  createStreamAssembler,
  type StreamEvent,
} from "./anthropicStream.ts";

// Build one SSE frame the way Anthropic sends it: an `event:` line, a `data:`
// line with the JSON payload, and the blank-line terminator.
function sse(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

// A canonical plain-text turn: message_start → one text block streamed in two
// deltas → message_delta(end_turn) → message_stop.
function textTurn(parts: string[], stopReason = "end_turn"): string {
  let out = sse("message_start", { message: { usage: { input_tokens: 100, output_tokens: 0 } } });
  out += sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (const p of parts) out += sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: p } });
  out += sse("content_block_stop", { index: 0 });
  out += sse("message_delta", { delta: { stop_reason: stopReason }, usage: { output_tokens: 42 } });
  out += sse("message_stop", {});
  return out;
}

// Feed a whole SSE string to a fresh assembler, collecting the user-facing
// events, and return both the events and the assembled message.
function run(raw: string) {
  const events: StreamEvent[] = [];
  const a = createStreamAssembler((e) => events.push(e));
  a.push(raw);
  return { events, message: a.finish() };
}

test("assembles a plain text turn and forwards each delta in order", () => {
  const { events, message } = run(textTurn(["Hello ", "floor."]));
  assert.deepEqual(events, [
    { type: "text", text: "Hello " },
    { type: "text", text: "floor." },
  ]);
  assert.equal(message.content.length, 1);
  assert.deepEqual(message.content[0], { type: "text", text: "Hello floor." });
  assert.equal(message.stop_reason, "end_turn");
});

test("captures usage from message_start and message_delta", () => {
  const { message } = run(textTurn(["hi"]));
  assert.equal(message.usage.input_tokens, 100);
  assert.equal(message.usage.output_tokens, 42);
});

test("assembles a tool_use block from streamed partial_json and fires a tool event", () => {
  let raw = sse("message_start", { message: { usage: {} } });
  raw += sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "query_deals" } });
  // input JSON arrives in fragments, split mid-token like the real API does.
  raw += sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"stat' } });
  raw += sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: 'us":"hot"}' } });
  raw += sse("content_block_stop", { index: 0 });
  raw += sse("message_delta", { delta: { stop_reason: "tool_use" }, usage: {} });
  raw += sse("message_stop", {});

  const { events, message } = run(raw);
  assert.deepEqual(events, [{ type: "tool", name: "query_deals" }]);
  assert.equal(message.stop_reason, "tool_use");
  assert.equal(message.content.length, 1);
  const block = message.content[0];
  assert.equal(block.type, "tool_use");
  if (block.type === "tool_use") {
    assert.equal(block.id, "toolu_1");
    assert.equal(block.name, "query_deals");
    assert.deepEqual(block.input, { status: "hot" });
  }
});

test("handles a turn with text preamble followed by a tool call", () => {
  let raw = sse("message_start", { message: { usage: {} } });
  raw += sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  raw += sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Let me check." } });
  raw += sse("content_block_stop", { index: 0 });
  raw += sse("content_block_start", { index: 1, content_block: { type: "tool_use", id: "toolu_2", name: "deals_at_risk" } });
  raw += sse("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "{}" } });
  raw += sse("content_block_stop", { index: 1 });
  raw += sse("message_delta", { delta: { stop_reason: "tool_use" }, usage: {} });
  raw += sse("message_stop", {});

  const { events, message } = run(raw);
  assert.deepEqual(events, [
    { type: "text", text: "Let me check." },
    { type: "tool", name: "deals_at_risk" },
  ]);
  assert.equal(message.content.length, 2);
  assert.deepEqual(message.content[0], { type: "text", text: "Let me check." });
  assert.equal(message.content[1].type, "tool_use");
});

test("an argless tool call assembles to an empty-object input", () => {
  let raw = sse("message_start", { message: { usage: {} } });
  raw += sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "t", name: "appointments" } });
  // No input_json_delta at all — model called the tool with no arguments.
  raw += sse("content_block_stop", { index: 0 });
  raw += sse("message_delta", { delta: { stop_reason: "tool_use" }, usage: {} });
  const { message } = run(raw);
  const block = message.content[0];
  assert.equal(block.type, "tool_use");
  if (block.type === "tool_use") assert.deepEqual(block.input, {});
});

test("survives an SSE frame split across two push() calls", () => {
  const raw = textTurn(["streamed ", "in halves"]);
  const mid = Math.floor(raw.length / 2);
  const events: StreamEvent[] = [];
  const a = createStreamAssembler((e) => events.push(e));
  a.push(raw.slice(0, mid));
  a.push(raw.slice(mid));
  const message = a.finish();
  assert.equal(
    events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join(""),
    "streamed in halves",
  );
  assert.deepEqual(message.content[0], { type: "text", text: "streamed in halves" });
});

test("ignores thinking deltas — they never reach the user or the assembled text", () => {
  let raw = sse("message_start", { message: { usage: {} } });
  raw += sse("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } });
  raw += sse("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "secret reasoning" } });
  raw += sse("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "abc" } });
  raw += sse("content_block_stop", { index: 0 });
  raw += sse("content_block_start", { index: 1, content_block: { type: "text", text: "" } });
  raw += sse("content_block_delta", { index: 1, delta: { type: "text_delta", text: "Visible answer." } });
  raw += sse("content_block_stop", { index: 1 });
  raw += sse("message_delta", { delta: { stop_reason: "end_turn" }, usage: {} });

  const { events, message } = run(raw);
  assert.deepEqual(events, [{ type: "text", text: "Visible answer." }]);
  // The thinking placeholder holds no text; only the real answer survives.
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  assert.equal(text, "Visible answer.");
  assert.ok(!text.includes("secret reasoning"));
});

test("preserves thinking blocks (text + signature) on a tool-use turn so it can be replayed", () => {
  // Extended/adaptive thinking + tool use: turn 1 is thinking -> tool_use. The
  // assembled assistant content is pushed BACK to the Messages API for turn 2,
  // which rejects it if the thinking block was stripped or emptied. Regression
  // test for the streaming path dropping thinking into empty text placeholders.
  let raw = sse("message_start", { message: { usage: {} } });
  raw += sse("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } });
  raw += sse("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "The rep needs..." } });
  raw += sse("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig-xyz" } });
  raw += sse("content_block_stop", { index: 0 });
  raw += sse("content_block_start", { index: 1, content_block: { type: "tool_use", id: "toolu_9", name: "next_leads" } });
  raw += sse("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "{}" } });
  raw += sse("content_block_stop", { index: 1 });
  raw += sse("message_delta", { delta: { stop_reason: "tool_use" }, usage: {} });

  const { events, message } = run(raw);
  // Reasoning never streams to the customer — only the tool event fires.
  assert.deepEqual(events, [{ type: "tool", name: "next_leads" }]);
  // The thinking block survives intact, first, with its signature — and there is
  // NO empty-text placeholder anywhere in the replayed content.
  assert.equal(message.content.length, 2);
  assert.deepEqual(message.content[0], { type: "thinking", thinking: "The rep needs...", signature: "sig-xyz" });
  assert.equal(message.content[1].type, "tool_use");
  assert.ok(!message.content.some((b) => b.type === "text" && b.text === ""));
});

test("preserves a redacted_thinking block verbatim", () => {
  let raw = sse("message_start", { message: { usage: {} } });
  raw += sse("content_block_start", { index: 0, content_block: { type: "redacted_thinking", data: "encrypted-blob" } });
  raw += sse("content_block_stop", { index: 0 });
  raw += sse("content_block_start", { index: 1, content_block: { type: "tool_use", id: "t", name: "equity" } });
  raw += sse("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "{}" } });
  raw += sse("content_block_stop", { index: 1 });
  raw += sse("message_delta", { delta: { stop_reason: "tool_use" }, usage: {} });
  const { message } = run(raw);
  assert.deepEqual(message.content[0], { type: "redacted_thinking", data: "encrypted-blob" });
});

test("a malformed tool input degrades to a parse marker instead of throwing", () => {
  let raw = sse("message_start", { message: { usage: {} } });
  raw += sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "t", name: "equity" } });
  raw += sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"broken' } });
  raw += sse("content_block_stop", { index: 0 });
  raw += sse("message_delta", { delta: { stop_reason: "tool_use" }, usage: {} });
  const { message } = run(raw);
  const block = message.content[0];
  assert.equal(block.type, "tool_use");
  if (block.type === "tool_use") {
    assert.deepEqual(block.input, { _parseError: true, _raw: '{"broken' });
  }
});

test("an error event throws AnthropicStreamError", () => {
  const raw =
    sse("message_start", { message: { usage: {} } }) +
    sse("error", { error: { type: "overloaded_error", message: "Overloaded" } });
  assert.throws(() => run(raw), (e: unknown) => e instanceof AnthropicStreamError && /Overloaded/.test((e as Error).message));
});

test("skips [DONE] sentinels and unparseable data frames without dropping real events", () => {
  let raw = sse("message_start", { message: { usage: {} } });
  raw += "event: content_block_start\ndata: {not valid json}\n\n"; // garbage frame
  raw += "data: [DONE]\n\n"; // sentinel
  raw += sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  raw += sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "still works" } });
  raw += sse("content_block_stop", { index: 0 });
  raw += sse("message_delta", { delta: { stop_reason: "end_turn" }, usage: {} });
  const { events, message } = run(raw);
  assert.deepEqual(events, [{ type: "text", text: "still works" }]);
  assert.deepEqual(message.content[0], { type: "text", text: "still works" });
});

test("finish() flushes a final frame that lacks the trailing blank line", () => {
  const events: StreamEvent[] = [];
  const a = createStreamAssembler((e) => events.push(e));
  a.push(sse("message_start", { message: { usage: {} } }));
  a.push(sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
  a.push(sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "no trailing newline" } }));
  // Final frame delivered WITHOUT the closing "\n\n".
  a.push('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}');
  const message = a.finish();
  assert.equal(message.stop_reason, "end_turn");
  assert.deepEqual(message.content[0], { type: "text", text: "no trailing newline" });
});

test("assembleAnthropicStream pumps a ReadableStream end to end", async () => {
  const raw = textTurn(["from ", "a ", "stream"]);
  const encoder = new TextEncoder();
  // Emit the bytes in three arbitrary chunks to exercise cross-chunk buffering.
  const third = Math.ceil(raw.length / 3);
  const chunks = [raw.slice(0, third), raw.slice(third, third * 2), raw.slice(third * 2)];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  const events: StreamEvent[] = [];
  const message = await assembleAnthropicStream(body, (e) => events.push(e));
  assert.equal(
    events.map((e) => (e.type === "text" ? e.text : "")).join(""),
    "from a stream",
  );
  assert.deepEqual(message.content[0], { type: "text", text: "from a stream" });
  assert.equal(message.stop_reason, "end_turn");
});
