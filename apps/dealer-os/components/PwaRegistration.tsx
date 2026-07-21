"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    let reg: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register("/sw.js")
      .then((r) => {
        reg = r;
        // Check for a freshly deployed worker right away.
        r.update().catch(() => {});
      })
      .catch(() => {
        // The app should still run normally if a browser blocks service workers.
      });

    // Every time the app comes back to the foreground (the classic "swipe-close
    // and reopen"), ask the browser to re-check sw.js. If a new version shipped,
    // it installs, skips waiting, and the worker reloads open windows — so the
    // installed PWA stops serving stale code without any manual cache clearing.
    const onVisible = () => {
      if (document.visibilityState === "visible") reg?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
