// Scheduled texts — fire-and-forget text sends on a timer. A rep or EILA
// says "text Smith at 9am tomorrow" and the cron delivers it. The consent
// gate runs AT SEND TIME (not schedule time) so a STOP that arrives overnight
// is honored before the message ever goes out. Stored on the org's app_store
// as `scheduledTexts` (same JSONB-array pattern as everything else).

export type ScheduledText = {
  id: string; // ST-<ms>
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
  return `ST-${Date.now()}`;
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

/** Summary line for EILA. */
export function scheduledLine(t: ScheduledText, customerName: string): string {
  const when = new Date(t.scheduledAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return `${customerName} · "${t.body.slice(0, 60)}${t.body.length > 60 ? "…" : ""}" · fires ${when} · ${t.status} [id:${t.id}]`;
}
