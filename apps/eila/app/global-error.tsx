"use client";

import "./globals.css";

// Only fires if the ROOT layout itself throws (vs. a route segment, which
// app/error.tsx already catches) — has to define its own <html>/<body> since
// it replaces the whole document in that case. Deliberately plain: no brand
// component, no icon import, nothing that could itself fail if something
// fundamental broke.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ display: "grid", minHeight: "100dvh", placeItems: "center", padding: "1.25rem", textAlign: "center" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>EILA couldn&rsquo;t load.</h1>
            <p style={{ marginTop: "0.5rem", opacity: 0.7 }}>Your data is safe — please try reloading.</p>
            <button
              onClick={reset}
              style={{ marginTop: "1.5rem", padding: "0.75rem 1.5rem", borderRadius: 999, border: "none", background: "#7f5f50", color: "#fff", fontWeight: 700, cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
