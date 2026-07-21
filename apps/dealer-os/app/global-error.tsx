"use client";

import { useEffect } from "react";
import { reportTelemetry } from "@/lib/telemetry";

// Root error boundary: catches crashes in the root layout itself (rare, severe).
// Must render its own <html>/<body>. Reports to EILA's health sensor.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportTelemetry("fatal", `${error?.message || "root error"}${error?.digest ? ` [${error.digest}]` : ""}`);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ background: "#070b16", color: "#fff", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Dealer Mission OS hit a snag.</div>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.6)" }}>
            Something went wrong loading the app. It&apos;s been logged for EILA. Reload to try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: 20, padding: "10px 20px", borderRadius: 999, border: "none", background: "#6096ff", color: "#06121f", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", fontSize: 12, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
