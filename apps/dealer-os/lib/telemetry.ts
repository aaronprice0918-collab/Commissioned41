import { authHeaders } from "@/lib/storeClient";

// Fire-and-forget client → /api/telemetry. Never throws into the caller.
// The endpoint now requires auth (it feeds the owner AI prompt), so we attach
// the session token best-effort. Errors here are always swallowed.
export function reportTelemetry(kind: string, message: string, path?: string) {
  try {
    const body = JSON.stringify({
      kind,
      message: String(message).slice(0, 300),
      path: path ?? (typeof location !== "undefined" ? location.pathname : ""),
    });
    void (async () => {
      let auth: Record<string, string> = {};
      try {
        auth = await authHeaders();
      } catch {
        // no session (e.g. a pre-login crash) — the server will drop it
      }
      void fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body,
        keepalive: true,
      }).catch(() => {});
    })();
  } catch {
    // swallow — telemetry must never break the app
  }
}
