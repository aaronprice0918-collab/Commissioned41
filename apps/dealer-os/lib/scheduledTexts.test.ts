import { strict as assert } from "node:assert";
import test from "node:test";
import { makeScheduledTextId, pruneTerminal, markSent, type ScheduledText } from "./scheduledTexts";

test("makeScheduledTextId is unique even for a synchronous burst (broadcast)", () => {
  // The old ST-<ms> id collided across a synchronous .map, so a broadcast gave
  // every recipient the SAME id and the cron re-sent all but the first. IDs must
  // be unique when generated in the same millisecond.
  const ids = Array.from({ length: 500 }, () => makeScheduledTextId());
  assert.equal(new Set(ids).size, 500);
});

function st(partial: Partial<ScheduledText>): ScheduledText {
  return {
    id: makeScheduledTextId(), leadId: "CRM-1", body: "hi", scheduledAt: "2026-07-01T10:00:00.000Z",
    createdAt: "2026-07-01T09:00:00.000Z", createdBy: "EILA", status: "pending", ...partial,
  };
}

test("pruneTerminal keeps pending forever and drops old terminal texts", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const oldSent = st({ status: "sent", sentAt: "2026-06-01T10:00:00.000Z" }); // 60d old
  const recentSent = st({ status: "sent", sentAt: "2026-07-25T10:00:00.000Z" }); // 7d old
  const pendingOld = st({ status: "pending", createdAt: "2026-01-01T00:00:00.000Z" }); // ancient but pending
  const oldCancelled = st({ status: "cancelled", createdAt: "2026-06-01T00:00:00.000Z" });

  const kept = pruneTerminal([oldSent, recentSent, pendingOld, oldCancelled], 30, now);
  const keptIds = new Set(kept.map((t) => t.id));
  assert.ok(!keptIds.has(oldSent.id), "old sent pruned");
  assert.ok(keptIds.has(recentSent.id), "recent sent kept");
  assert.ok(keptIds.has(pendingOld.id), "pending always kept");
  assert.ok(!keptIds.has(oldCancelled.id), "old cancelled pruned");
});

test("markSent does not mutate the original", () => {
  const t = st({});
  const done = markSent(t, "2026-07-01T10:00:01.000Z");
  assert.equal(t.status, "pending");
  assert.equal(done.status, "sent");
  assert.equal(done.sentAt, "2026-07-01T10:00:01.000Z");
});
