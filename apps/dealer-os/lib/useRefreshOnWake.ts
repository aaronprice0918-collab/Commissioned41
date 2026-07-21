"use client";

import { useEffect, useRef } from "react";

// The phone rule: a screen that pops back up must show TODAY's board, not a
// memory of the last visit. Phones freeze timers in the background, so
// heartbeats alone don't cut it — this fires the moment the app becomes
// visible or focused again (throttled so a focus+visibility pair, or rapid
// tab hops, don't double-fetch). Every data provider hangs its reload here;
// the deal board pioneered the pattern during the July clobber incident.
export function useRefreshOnWake(refresh: () => void, minIntervalMs = 4000) {
  const lastRun = useRef(0);
  const fn = useRef(refresh);
  fn.current = refresh;

  useEffect(() => {
    const fire = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRun.current < minIntervalMs) return;
      lastRun.current = now;
      fn.current();
    };
    document.addEventListener("visibilitychange", fire);
    window.addEventListener("focus", fire);
    window.addEventListener("pageshow", fire); // bfcache restores skip mount effects entirely
    return () => {
      document.removeEventListener("visibilitychange", fire);
      window.removeEventListener("focus", fire);
      window.removeEventListener("pageshow", fire);
    };
  }, [minIntervalMs]);
}
