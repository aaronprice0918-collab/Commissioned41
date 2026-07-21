"use client";

// Client side of EILA's proactive nudges — opt-in only (Settings toggle), never
// requested automatically on load. Browser permission prompts that fire
// unprompted are the fastest way to get a product muted forever.

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// Returned as ArrayBuffer, not Uint8Array — TS's DOM lib types
// PushSubscriptionOptionsInit.applicationServerKey as BufferSource, and a
// plain ArrayBuffer satisfies that without fighting TS's newer generic
// Uint8Array<ArrayBufferLike> vs ArrayBuffer variance.
function urlBase64ToApplicationServerKey(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer;
}

// Registers the service worker (idempotent — safe to call every time), asks
// for notification permission if not already decided, subscribes to push, and
// hands the subscription to the server. Returns an error string, or null on
// success — mirrors the store's signIn/signUp convention.
export async function enableNudges(authToken: string): Promise<string | null> {
  if (!pushSupported()) return "Your browser doesn't support notifications.";
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return "Nudges aren't configured yet.";

  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    if (Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return "Notifications were blocked — you can turn them on later in your browser settings.";
    } else if (Notification.permission === "denied") {
      return "Notifications are blocked for this site — turn them on in your browser settings, then try again.";
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToApplicationServerKey(vapidKey),
      });
    }

    const json = sub.toJSON();
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!res.ok) return "Couldn't save that on our end — try again in a moment.";
    return null;
  } catch {
    return "Couldn't turn on nudges — try again in a moment.";
  }
}

export async function disableNudges(authToken: string): Promise<string | null> {
  try {
    if (pushSupported()) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
    }
    const res = await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return "Couldn't turn that off on our end — try again.";
    return null;
  } catch {
    return "Couldn't turn off nudges — try again in a moment.";
  }
}
