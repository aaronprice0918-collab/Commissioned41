"use client";

import { useEffect } from "react";
import { reportTelemetry } from "@/lib/telemetry";

// Global runtime-health sensor: catches uncaught errors and unhandled promise
// rejections (failed fetches, async crashes, event-handler throws) anywhere in
// the app and reports them so EILA can see how Dealer Mission OS is actually running.
// React render crashes are caught separately by error.tsx / global-error.tsx.
// Deduped per session so one repeating error can't spam the log.
export function TelemetryReporter() {
  useEffect(() => {
    const seen = new Set<string>();
    const once = (key: string) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };

    const onError = (e: ErrorEvent) => {
      const msg = e?.message || String(e?.error || "error");
      if (!once(msg.slice(0, 120))) return;
      const where = e?.filename ? ` @ ${e.filename.replace(/^https?:\/\/[^/]+/, "")}:${e.lineno || 0}` : "";
      reportTelemetry("error", `${msg}${where}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e?.reason;
      const msg = (reason && (reason.message || String(reason))) || "unhandledrejection";
      if (!once(msg.slice(0, 120))) return;
      reportTelemetry("unhandledrejection", msg);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
