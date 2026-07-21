"use client";

import { useEffect } from "react";

function deploymentIdFrom(html: string): string | null {
  return html.match(/<html[^>]*\bdata-dpl-id="([^"]+)"/i)?.[1] ?? null;
}

async function currentServerDeployment(): Promise<string | null> {
  const res = await fetch("/", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!res.ok) return null;
  return deploymentIdFrom(await res.text());
}

export function VersionGuard() {
  useEffect(() => {
    const runningDeployment = document.documentElement.getAttribute("data-dpl-id");
    if (!runningDeployment) return;
    let cancelled = false;

    async function check() {
      try {
        const serverDeployment = await currentServerDeployment();
        if (!serverDeployment || cancelled || serverDeployment === runningDeployment) return;
        const reloadKey = `lite-reloaded-for-${serverDeployment}`;
        if (sessionStorage.getItem(reloadKey) === "1") return;
        sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
      } catch {
        // A missed update check should never interrupt the user's work.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const interval = window.setInterval(check, 60_000);
    const timeout = window.setTimeout(check, 4_000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
