import { strict as assert } from "node:assert";
import test from "node:test";
import {
  canContact,
  consentLatest,
  consentStatus,
  consentSummary,
  recordConsentPatch,
  suppressionDeadline,
  type ConsentEvent,
} from "./consent";

type Carrier = { consent?: { events: ConsentEvent[] } };

const at = (iso: string) => iso;

function lead(...evts: ConsentEvent[]): Carrier {
  return evts.length ? { consent: { events: evts } } : {};
}

test("no trail = unknown on every channel, contact allowed", () => {
  const l = lead();
  assert.equal(consentStatus(l, "call"), "unknown");
  assert.equal(consentStatus(l, "text"), "unknown");
  assert.equal(consentStatus(l, "email"), "unknown");
  assert.equal(canContact(l, "call").allowed, true);
  assert.equal(canContact(l, "call").state, "unknown");
});

test("grant then revoke on one channel — latest word wins", () => {
  const l = lead(
    { channel: "text", action: "granted", at: at("2026-07-01T10:00:00Z"), source: "Web form opt-in" },
    { channel: "text", action: "revoked", at: at("2026-07-05T10:00:00Z"), source: "STOP reply" }
  );
  assert.equal(consentStatus(l, "text"), "revoked");
  assert.equal(consentStatus(l, "call"), "unknown"); // other channels untouched
  const check = canContact(l, "text");
  assert.equal(check.allowed, false);
  assert.ok(check.reason?.includes("STOP reply"));
  assert.ok(check.reason?.includes("text"));
});

test("'all' revoke suppresses every channel; later single-channel re-grant reopens only that one", () => {
  const l = lead(
    { channel: "all", action: "revoked", at: at("2026-07-01T10:00:00Z"), source: "Do-not-call request" },
    { channel: "email", action: "granted", at: at("2026-07-08T10:00:00Z"), source: "Asked us to reach out" }
  );
  assert.equal(consentStatus(l, "call"), "revoked");
  assert.equal(consentStatus(l, "text"), "revoked");
  assert.equal(consentStatus(l, "email"), "granted");
});

test("consentLatest returns the event that set the current state", () => {
  const grant: ConsentEvent = { channel: "call", action: "granted", at: at("2026-07-01T10:00:00Z"), source: "Verbal in store", by: "Aaron Price" };
  const l = lead(grant);
  assert.deepEqual(consentLatest(l, "call"), grant);
  assert.equal(consentLatest(l, "text"), null);
});

test("consentSummary flags revokedAny", () => {
  const clean = consentSummary(lead({ channel: "email", action: "granted", at: at("2026-07-01T10:00:00Z"), source: "Web form opt-in" }));
  assert.equal(clean.revokedAny, false);
  assert.equal(clean.email, "granted");
  const dirty = consentSummary(lead({ channel: "call", action: "revoked", at: at("2026-07-01T10:00:00Z"), source: "Asked to stop" }));
  assert.equal(dirty.revokedAny, true);
  assert.equal(dirty.call, "revoked");
  assert.equal(dirty.text, "unknown");
});

test("recordConsentPatch appends without mutating the original", () => {
  const original = lead({ channel: "text", action: "granted", at: at("2026-07-01T10:00:00Z"), source: "Web form opt-in" });
  const patch = recordConsentPatch(original, { channel: "text", action: "revoked", at: at("2026-07-02T10:00:00Z"), source: "STOP reply" });
  assert.equal(patch.consent.events.length, 2);
  assert.equal(original.consent?.events.length, 1); // untouched
  assert.equal(patch.consent.events[1].action, "revoked");
});

test("recordConsentPatch starts a trail on a lead that has none", () => {
  const patch = recordConsentPatch({}, { channel: "all", action: "revoked", at: at("2026-07-02T10:00:00Z"), source: "Do-not-call request" });
  assert.equal(patch.consent.events.length, 1);
});

test("suppressionDeadline = 10 business days, weekends skipped", () => {
  // Wed Jul 1 2026 + 10 business days → Wed Jul 15 2026
  const deadline = suppressionDeadline("2026-07-01T12:00:00Z");
  assert.equal(deadline.slice(0, 10), "2026-07-15");
  // Fri + 10 business days crosses two weekends → Fri two weeks later
  const fromFriday = suppressionDeadline("2026-07-03T12:00:00Z");
  assert.equal(fromFriday.slice(0, 10), "2026-07-17");
});

test("suppressionDeadline passes garbage through unchanged", () => {
  assert.equal(suppressionDeadline("not-a-date"), "not-a-date");
});
