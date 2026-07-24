"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { BUILD_ID, isNewerVersionAvailable } from "@/lib/version";

// The trust fix for "I opened EILA and it's showing last night's numbers." A
// phone can keep serving a cached OLD bundle after a new deploy, so the counts
// look wrong even when the data and the deployed fix are correct. This polls the
// live deploy's build id and, when this phone is behind, shows a tap-to-refresh
// banner — so stale code can never silently pass off old numbers as current.
export function UpdatePrompt() {
  const [stale, setStale] = useState(false);

  const check = useCallback(async () => {
    if (stale) return;
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { build?: string };
      if (isNewerVersionAvailable(BUILD_ID, String(data.build ?? ""))) setStale(true);
    } catch {
      /* offline / transient network — don't nag; we'll check again */
    }
  }, [stale]);

  useEffect(() => {
    check();
    // Re-check when the app comes back to the foreground (the exact moment a rep
    // reopens EILA and would otherwise see the cached version) and every 5 min.
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(check, 5 * 60 * 1000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(id); };
  }, [check]);

  async function update() {
    try {
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* cache API unavailable — the reload below still pulls fresh HTML */
    }
    window.location.reload();
  }

  if (!stale) return null;
  return (
    <button
      onClick={update}
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-accent px-4 py-2 text-sm font-bold text-white shadow-lg active:opacity-90"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.45rem)", paddingBottom: "0.45rem" }}
    >
      <RefreshCw size={15} /> New version ready — tap to update
    </button>
  );
}
