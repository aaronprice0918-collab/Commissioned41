// Client-side reader for EILA's streaming chat endpoint.
//
// POSTs to /api/ai/crm with { stream: true } and consumes the newline-delimited
// JSON the route emits — {t:"token"} deltas, {t:"tool"} activity, a terminal
// {t:"done", tools}, or {t:"error"}. Callers get live callbacks plus the fully
// assembled reply at the end (for TTS / logging). Kept transport-only and pure
// of React so it can back every EILA surface identically and be unit-tested.

export type ChatStreamHandlers = {
  onToken?: (delta: string) => void; // a visible-text delta arrived
  onTool?: (name: string) => void; // EILA started a tool call
};

// Parse one NDJSON line into an effect on the accumulator. Exported for tests:
// the whole client contract is "given these frames, produce this text + tools."
export type ChatFrame =
  | { t: "token"; v: string }
  | { t: "tool"; v: string }
  | { t: "done"; tools?: string[] }
  | { t: "error"; v?: string };

export async function streamChat(
  body: Record<string, unknown>,
  headers: Record<string, string>,
  handlers: ChatStreamHandlers = {},
): Promise<{ text: string; tools: string[] }> {
  const res = await fetch("/api/ai/crm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ ...body, stream: true }),
  });
  // Pre-stream failures (auth, rate limit, disabled) still come back as JSON.
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "AI request failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let tools: string[] = [];

  const handle = (frame: ChatFrame) => {
    if (frame.t === "token") {
      text += frame.v;
      handlers.onToken?.(frame.v);
    } else if (frame.t === "tool") {
      handlers.onTool?.(frame.v);
    } else if (frame.t === "done") {
      if (Array.isArray(frame.tools)) tools = frame.tools;
    } else if (frame.t === "error") {
      throw new Error(frame.v || "Stream error");
    }
  };

  const drain = (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let frame: ChatFrame | null = null;
      try {
        frame = JSON.parse(line) as ChatFrame;
      } catch {
        continue; // a torn frame never breaks the stream
      }
      handle(frame);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      drain(decoder.decode(value, { stream: true }));
    }
    // Flush any trailing frame not newline-terminated.
    if (buffer.trim()) {
      try {
        handle(JSON.parse(buffer.trim()) as ChatFrame);
      } catch {
        /* ignore a torn final frame */
      }
    }
  } finally {
    // Release/cancel the reader on any exit (incl. an {t:"error"} frame that
    // throws out of the loop) so the stream isn't left dangling.
    try {
      await reader.cancel();
    } catch {
      /* already released */
    }
  }
  return { text, tools };
}
