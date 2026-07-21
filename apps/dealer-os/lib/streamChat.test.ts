import test from "node:test";
import assert from "node:assert/strict";
import { streamChat } from "./streamChat.ts";

// Build a fake fetch Response whose body streams the given raw chunks, so we can
// drive streamChat without a network. Mirrors the shape it reads: ok, body
// (ReadableStream<Uint8Array>), and json() for the error path.
function fakeResponse(opts: { ok?: boolean; chunks?: string[]; json?: unknown }) {
  const { ok = true, chunks = [], json } = opts;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok, body, json: async () => json } as unknown as Response;
}

// Swap global fetch for the duration of one call, then restore it.
async function withFetch(res: Response, fn: () => Promise<void>) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => res) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

const frame = (o: Record<string, unknown>) => JSON.stringify(o) + "\n";

test("streams tokens in order and returns the assembled reply + tools", async () => {
  const res = fakeResponse({
    chunks: [
      frame({ t: "token", v: "Three " }),
      frame({ t: "tool", v: "next_leads" }),
      frame({ t: "token", v: "hot ups." }),
      frame({ t: "done", tools: ["next_leads"] }),
    ],
  });
  await withFetch(res, async () => {
    const tokens: string[] = [];
    const tools: string[] = [];
    const out = await streamChat({ action: "chat", message: "hi" }, {}, {
      onToken: (d) => tokens.push(d),
      onTool: (n) => tools.push(n),
    });
    assert.deepEqual(tokens, ["Three ", "hot ups."]);
    assert.deepEqual(tools, ["next_leads"]);
    assert.equal(out.text, "Three hot ups.");
    assert.deepEqual(out.tools, ["next_leads"]);
  });
});

test("reassembles a frame split across two network chunks", async () => {
  const full = frame({ t: "token", v: "halved" });
  const mid = Math.floor(full.length / 2);
  const res = fakeResponse({ chunks: [full.slice(0, mid), full.slice(mid)] });
  await withFetch(res, async () => {
    const out = await streamChat({ action: "chat", message: "hi" }, {});
    assert.equal(out.text, "halved");
  });
});

test("flushes a final frame delivered without a trailing newline", async () => {
  const res = fakeResponse({
    chunks: [frame({ t: "token", v: "no newline" }), JSON.stringify({ t: "done", tools: [] })],
  });
  await withFetch(res, async () => {
    const out = await streamChat({ action: "chat", message: "hi" }, {});
    assert.equal(out.text, "no newline");
  });
});

test("an error frame rejects with its message", async () => {
  const res = fakeResponse({ chunks: [frame({ t: "token", v: "partial" }), frame({ t: "error", v: "Overloaded" })] });
  await withFetch(res, async () => {
    await assert.rejects(
      streamChat({ action: "chat", message: "hi" }, {}),
      /Overloaded/,
    );
  });
});

test("a non-ok response throws the JSON error (pre-stream failures stay JSON)", async () => {
  const res = fakeResponse({ ok: false, json: { error: "You can only use the assistant on your own leads." } });
  await withFetch(res, async () => {
    await assert.rejects(
      streamChat({ action: "chat", message: "hi" }, {}),
      /your own leads/,
    );
  });
});

test("torn (unparseable) frames are skipped without dropping good ones", async () => {
  const res = fakeResponse({
    chunks: ["{not json}\n", frame({ t: "token", v: "survived" }), frame({ t: "done", tools: [] })],
  });
  await withFetch(res, async () => {
    const out = await streamChat({ action: "chat", message: "hi" }, {});
    assert.equal(out.text, "survived");
  });
});
