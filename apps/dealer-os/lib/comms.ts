// The comms hub brain (Module 13) — real texting from the app, built ON TOP
// of the consent rail (lib/consent.ts), never beside it. Everything legally
// load-bearing lives here so the send route, the inbound webhook, the screen
// and EILA all share one set of rules:
//
// - A text thread rides the lead's JSONB blob (lead.messages) — no schema
//   change, and every device/EILA sees the same conversation.
// - Outbound requires RECORDED text consent ("granted", not merely
//   not-revoked) — app-sent texts are the exact thing TCPA statutory damages
//   attach to, so unknown consent blocks the composer and says why.
// - The FIRST outbound message to a lead carries the opt-out notice.
// - Inbound STOP-family keywords write a REVOKE event to the consent trail
//   automatically (revoke-by-any-means); START/UNSTOP writes a re-grant.

import { consentStatus, type ConsentEvent } from "@/lib/consent";

export type LeadMessage = {
  dir: "in" | "out";
  body: string;
  at: string; // ISO
  by?: string; // staff member who sent it (outbound)
  sid?: string; // Twilio message SID
};

type MessageCarrier = { messages?: LeadMessage[] };

export const OPT_OUT_NOTICE = "Reply STOP to opt out.";

// Digits-only tail comparison: "(770) 555-0101", "+17705550101" and
// "7705550101" are all the same phone. Ten digits is the US line number;
// anything shorter is too ambiguous to match.
export function normalizePhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function samePhone(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length === 10 && na === nb;
}

// Twilio wants E.164. US-biased: 10 digits get +1.
export function toE164(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

// The first outbound text must tell the customer how to make it stop.
export function withOptOutNotice(body: string, priorMessages: LeadMessage[] | undefined): string {
  const hadOutbound = (priorMessages ?? []).some((m) => m.dir === "out");
  if (hadOutbound) return body;
  return body.endsWith(OPT_OUT_NOTICE) ? body : `${body}\n${OPT_OUT_NOTICE}`;
}

// Append to the thread — returns the patch for an updateLead-style write,
// never mutates.
export function appendMessagePatch(lead: MessageCarrier, message: LeadMessage): { messages: LeadMessage[] } {
  return { messages: [...(lead.messages ?? []), message] };
}

// Carrier-standard opt-out/opt-in keywords (Twilio's default list). A STOP
// must revoke consent on the trail; a START re-grants. Anything else is just
// a message.
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);

export function inboundConsentEvent(body: string, at: string): ConsentEvent | null {
  const word = String(body || "").trim().toLowerCase();
  if (STOP_WORDS.has(word)) return { channel: "text", action: "revoked", at, source: "STOP reply" };
  if (START_WORDS.has(word)) return { channel: "text", action: "granted", at, source: "START reply" };
  return null;
}

// Pick the lead an inbound text belongs to: newest lead whose customer phone
// matches the sender. (One customer, several visits = several leads; the
// newest is the one being worked.)
export function matchLeadByPhone<T extends { id: string; customerPhone?: string }>(leads: T[], fromPhone: string): T | null {
  const matches = leads.filter((l) => samePhone(l.customerPhone || "", fromPhone));
  if (!matches.length) return null;
  // CRM-<ms> ids sort chronologically as strings of equal length, but be
  // explicit: newest numeric timestamp wins.
  const stamp = (l: T) => {
    const m = /^CRM-(\d+)/.exec(l.id);
    return m ? Number(m[1]) : 0;
  };
  return [...matches].sort((a, b) => stamp(b) - stamp(a))[0];
}

// A revocation belongs to the CUSTOMER, not to one lead card. Same customer,
// several visits = several leads sharing the phone — if ANY of them carries a
// text revoke, the number is off-limits everywhere. The send pipeline checks
// this; the webhook writes STOP revokes onto every matching lead so the chips
// agree, but this guard holds even for trails written before that rule.
export function textRevokedAnywhere(
  leads: { customerPhone?: string; consent?: { events: ConsentEvent[] } }[],
  phone: string
): boolean {
  return leads.some((l) => samePhone(l.customerPhone || "", phone) && consentStatus(l, "text") === "revoked");
}
