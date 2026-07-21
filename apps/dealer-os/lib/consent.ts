// The TCPA/consent rail — per-customer, per-channel contact consent with an
// append-only audit trail. This is the legal foundation every outbound-comms
// feature rides on (texting, AI follow-up, re-engagement): TCPA statutory
// damages run $500–$1,500 PER text/call, consumers can revoke by ANY
// reasonable means (not just "STOP") with a 10-business-day suppression
// deadline, and a lead vendor's consent claim does not protect the dealer.
// Policy here is stricter than the law: a revocation suppresses IMMEDIATELY —
// the 10-day clock is the legal maximum, not a grace period to keep dialing.
//
// One brain, shared by the screens and EILA (same rule as everything else).

export type ConsentChannel = "call" | "text" | "email";
export type ConsentAction = "granted" | "revoked";

// One entry in the audit trail. Append-only — nothing here is ever edited or
// deleted, because the trail IS the compliance artifact.
export type ConsentEvent = {
  channel: ConsentChannel | "all";
  action: ConsentAction;
  at: string; // ISO timestamp
  source: string; // how it happened: "Verbal in store", "Web form opt-in", "STOP reply", "Asked rep to stop"…
  by?: string; // staff member who recorded it
};

export type ConsentState = "granted" | "revoked" | "unknown";

export const CONSENT_CHANNELS: { key: ConsentChannel; label: string }[] = [
  { key: "call", label: "Call" },
  { key: "text", label: "Text" },
  { key: "email", label: "Email" },
];

// The capture menus — a consent event without a source is worthless in a
// dispute, so the UI only offers these (plus free text via EILA later).
export const CONSENT_GRANT_SOURCES = [
  "Verbal in store",
  "Signed form",
  "Web form opt-in",
  "Asked us to reach out",
] as const;
export const CONSENT_REVOKE_SOURCES = [
  "Asked to stop",
  "STOP reply",
  "Do-not-call request",
  "Bounced / wrong contact",
] as const;

// Anything that carries a consent trail (CrmLead does, via its JSONB blob).
type ConsentCarrier = { consent?: { events: ConsentEvent[] } };

function events(lead: ConsentCarrier): ConsentEvent[] {
  return lead.consent?.events ?? [];
}

// Latest word wins, per channel; an "all" event speaks for every channel.
// The trail is append-only so array order is time order.
export function consentStatus(lead: ConsentCarrier, channel: ConsentChannel): ConsentState {
  let state: ConsentState = "unknown";
  for (const event of events(lead)) {
    if (event.channel === channel || event.channel === "all") {
      state = event.action === "granted" ? "granted" : "revoked";
    }
  }
  return state;
}

// The event that produced the current state for a channel (for "revoked
// June 3 — STOP reply" style display and for the audit answer).
export function consentLatest(lead: ConsentCarrier, channel: ConsentChannel): ConsentEvent | null {
  let latest: ConsentEvent | null = null;
  for (const event of events(lead)) {
    if (event.channel === channel || event.channel === "all") latest = event;
  }
  return latest;
}

// The one question every contact surface asks before showing a live link.
// Revoked = hard no, immediately. Unknown = a human may reach out manually
// (normal business contact), but automated/AI outreach must not fire — that
// distinction is what `state` is for.
export function canContact(
  lead: ConsentCarrier,
  channel: ConsentChannel
): { allowed: boolean; state: ConsentState; reason?: string } {
  const state = consentStatus(lead, channel);
  if (state !== "revoked") return { allowed: true, state };
  const event = consentLatest(lead, channel);
  const when = event ? new Date(event.at).toLocaleDateString() : "";
  return {
    allowed: false,
    state,
    reason: `Customer revoked ${channel} consent${when ? ` on ${when}` : ""}${event?.source ? ` (${event.source})` : ""} — do not contact by ${channel}.`,
  };
}

// Per-channel snapshot for chips + EILA.
export function consentSummary(lead: ConsentCarrier): Record<ConsentChannel, ConsentState> & { revokedAny: boolean } {
  const call = consentStatus(lead, "call");
  const text = consentStatus(lead, "text");
  const email = consentStatus(lead, "email");
  return { call, text, email, revokedAny: call === "revoked" || text === "revoked" || email === "revoked" };
}

// Append an event to the trail — returns the patch for updateLead, never
// mutates. The trail only grows.
export function recordConsentPatch(lead: ConsentCarrier, event: ConsentEvent): { consent: { events: ConsentEvent[] } } {
  return { consent: { events: [...events(lead), event] } };
}

// The legal outer bound: revocation must be fully honored within 10 BUSINESS
// days (weekends skipped). We suppress immediately; this exists so screens
// and EILA can state the deadline honestly ("suppressed now — law allows
// until <date>").
export function suppressionDeadline(revokedAtIso: string): string {
  const d = new Date(revokedAtIso);
  if (Number.isNaN(d.getTime())) return revokedAtIso;
  let added = 0;
  while (added < 10) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.toISOString();
}
