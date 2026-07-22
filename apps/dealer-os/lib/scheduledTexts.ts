// Scheduled texts — fire-and-forget text sends on a timer. A rep or EILA
// says "text Smith at 9am tomorrow" and the cron delivers it. The consent
// gate runs AT SEND TIME (not schedule time) so a STOP that arrives overnight
// is honored before the message ever goes out. Stored on the org's app_store
// as `scheduledTexts` (same JSONB-array pattern as everything else).

export type ScheduledText = {
  id: string; // ST-<ms>-<rand> — globally unique (see makeScheduledTextId)
  leadId: string;
  body: string;
  scheduledAt: string; // ISO — when to fire
  createdAt: string; // ISO — when it was scheduled
  createdBy: string; // staff name or "EILA"
  status: "pending" | "sent" | "failed" | "cancelled";
  error?: string;
  sentAt?: string;
  mediaUrl?: string; // MMS attachment
};

export function makeScheduledTextId(): string {
  // Date.now() alone collides when a broadcast schedules many texts in the same
  // millisecond (a synchronous .map over recipients) — every recipient got the
  // SAME id, so the cron's id-based retire marked only the first "sent" and
  // re-fired the rest every minute (mass duplicate texts). A random suffix makes
  // each id globally unique so every scheduled text is retired independently.
  return `ST-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Texts whose scheduled time has arrived or passed and haven't been fired. */
export function pendingNow(texts: ScheduledText[], now = new Date()): ScheduledText[] {
  const iso = now.toISOString();
  return texts.filter((t) => t.status === "pending" && t.scheduledAt <= iso);
}

/** Mark a text as sent — returns the patched copy, never mutates. */
export function markSent(t: ScheduledText, sentAt = new Date().toISOString()): ScheduledText {
  return { ...t, status: "sent", sentAt };
}

/** Mark a text as failed — returns the patched copy, never mutates. */
export function markFailed(t: ScheduledText, error: string): ScheduledText {
  return { ...t, status: "failed", error };
}

/** Cancel a pending text — returns the patched copy, never mutates. */
export function cancel(t: ScheduledText): ScheduledText {
  return { ...t, status: "cancelled" };
}

/** Drop terminal-state (sent/failed/cancelled) texts older than `days`.
 * `pending` is always kept. The array is read every minute by the cron AND
 * loaded into EILA's context on every AI request, so without pruning a few big
 * broadcasts bloat read latency and token cost forever. Applied on every write. */
export function pruneTerminal(texts: ScheduledText[], days = 30, now = new Date()): ScheduledText[] {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  return texts.filter((t) => t.status === "pending" || (t.sentAt ?? t.createdAt) >= cutoff);
}

/** Summary line for EILA. */
export function scheduledLine(t: ScheduledText, customerName: string): string {
  const when = new Date(t.scheduledAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return `${customerName} · "${t.body.slice(0, 60)}${t.body.length > 60 ? "…" : ""}" · fires ${when} · ${t.status} [id:${t.id}]`;
}
