import { strict as assert } from "node:assert";
import test from "node:test";
import {
  OPT_OUT_NOTICE,
  appendMessagePatch,
  inboundConsentEvent,
  isOptOut,
  matchLeadByPhone,
  normalizePhone,
  samePhone,
  textRevokedAnywhere,
  toE164,
  withOptOutNotice,
  type LeadMessage,
} from "./comms";

test("normalizePhone/samePhone: formatting and country code never break a match", () => {
  assert.equal(normalizePhone("(770) 555-0101"), "7705550101");
  assert.equal(normalizePhone("+1 770 555 0101"), "7705550101");
  assert.ok(samePhone("(770) 555-0101", "+17705550101"));
  assert.ok(!samePhone("(770) 555-0101", "(770) 555-0102"));
  assert.ok(!samePhone("555-0101", "555-0101")); // 7 digits — too ambiguous to ever match
});

test("toE164 is US-biased", () => {
  assert.equal(toE164("(770) 555-0101"), "+17705550101");
  assert.equal(toE164("17705550101"), "+17705550101");
  assert.equal(toE164(""), "");
});

test("withOptOutNotice: first outbound gets the notice, later ones don't", () => {
  assert.equal(withOptOutNotice("Hey, it's Bo at Kennesaw Mazda.", []), `Hey, it's Bo at Kennesaw Mazda.\n${OPT_OUT_NOTICE}`);
  const thread: LeadMessage[] = [{ dir: "out", body: "earlier", at: "2026-07-01T10:00:00Z" }];
  assert.equal(withOptOutNotice("Your CX-5 is ready.", thread), "Your CX-5 is ready.");
  // Inbound-only history still counts as a first outbound
  const inboundOnly: LeadMessage[] = [{ dir: "in", body: "hi", at: "2026-07-01T10:00:00Z" }];
  assert.ok(withOptOutNotice("Hello!", inboundOnly).endsWith(OPT_OUT_NOTICE));
});

test("appendMessagePatch appends without mutating", () => {
  const lead = { messages: [{ dir: "out" as const, body: "a", at: "2026-07-01T10:00:00Z" }] };
  const patch = appendMessagePatch(lead, { dir: "in", body: "b", at: "2026-07-01T10:05:00Z" });
  assert.equal(patch.messages.length, 2);
  assert.equal(lead.messages.length, 1);
});

test("inboundConsentEvent: STOP-family revokes, START-family re-grants, chatter is null", () => {
  const at = "2026-07-11T10:00:00Z";
  assert.equal(inboundConsentEvent("STOP", at)?.action, "revoked");
  assert.equal(inboundConsentEvent("  unsubscribe  ", at)?.action, "revoked");
  assert.equal(inboundConsentEvent("Stop", at)?.channel, "text");
  assert.equal(inboundConsentEvent("START", at)?.action, "granted");
  assert.equal(inboundConsentEvent("what time do you close?", at), null);
  // Revoke-by-ANY-reasonable-means (TCPA): informal opt-outs must now revoke,
  // not be silently ignored (the old behavior let the autonomous senders keep
  // firing at someone who clearly opted out).
  assert.equal(inboundConsentEvent("please stop calling me", at)?.action, "revoked");
});

test("textRevokedAnywhere: a revoke on ANY lead sharing the phone blocks the number", () => {
  const leads = [
    { customerPhone: "(770) 555-0101", consent: { events: [{ channel: "text" as const, action: "revoked" as const, at: "2026-07-01T10:00:00Z", source: "STOP reply" }] } },
    { customerPhone: "+17705550101", consent: { events: [{ channel: "text" as const, action: "granted" as const, at: "2026-07-02T10:00:00Z", source: "Web form opt-in" }] } },
    { customerPhone: "(404) 555-9999" },
  ];
  assert.ok(textRevokedAnywhere(leads, "770-555-0101")); // old lead's STOP still counts
  assert.ok(!textRevokedAnywhere(leads, "(404) 555-9999")); // unknown ≠ revoked
  assert.ok(!textRevokedAnywhere(leads, "555-0000")); // nobody has this number
});

test("matchLeadByPhone: newest matching lead wins, no match is null", () => {
  const leads = [
    { id: "CRM-1700000000000", customerPhone: "(770) 555-0101" },
    { id: "CRM-1750000000000", customerPhone: "+17705550101" },
    { id: "CRM-1760000000000", customerPhone: "(404) 555-9999" },
  ];
  assert.equal(matchLeadByPhone(leads, "+17705550101")?.id, "CRM-1750000000000");
  assert.equal(matchLeadByPhone(leads, "555-0000"), null);
});

test("isOptOut: informal opt-outs count, ordinary messages do not", () => {
  for (const body of [
    "please stop texting me", "Please stop", "remove me from your list",
    "take me off this", "do not text me again", "don't text me",
    "quit texting me", "leave me alone", "lose my number", "STOP",
  ]) {
    assert.equal(isOptOut(body), true, `"${body}" should opt out`);
  }
  for (const body of [
    "I'll stop by later today", "the deal fell through",
    "can you send me the price?", "yes I'm interested, when can I come in?",
  ]) {
    assert.equal(isOptOut(body), false, `"${body}" should NOT opt out`);
  }
});

test('"yes" NEVER re-grants consent — a revoked customer saying yes must not reopen', () => {
  assert.equal(inboundConsentEvent("yes", "t"), null);
  assert.equal(inboundConsentEvent("Yes please", "t"), null);
  assert.equal(inboundConsentEvent("YES", "t"), null);
  // but a deliberate opt-in keyword still works
  assert.equal(inboundConsentEvent("continue", "t")?.action, "granted");
});
