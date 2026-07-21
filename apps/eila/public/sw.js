// EILA's push notification service worker. Only handles push delivery + click —
// no offline caching, no app-shell strategy (that's a separate concern from
// "wake me up when something needs my attention").

self.addEventListener("push", (event) => {
  let payload = { title: "EILA", body: "Something needs your attention.", url: "/day" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON push (shouldn't happen — our server always sends JSON) — fall
    // back to the default payload rather than crash the worker.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon.png",
      badge: "/badge.png",
      data: { url: payload.url },
      tag: "ila-nudge", // a fresh nudge replaces a stale unread one, doesn't stack
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clients.find((c) => "focus" in c);
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) await existing.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
