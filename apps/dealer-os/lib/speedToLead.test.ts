import test from "node:test";
import assert from "node:assert/strict";
import { FIVE_MINUTES_MS, firstContactPatch, leadCreatedAt, speedClock, speedStats } from "./speedToLead.ts";
import type { CrmLead } from "../components/CrmProvider.tsx";

const NOW = new Date("2026-07-11T12:00:00Z");
const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60000).toISOString();

function lead(overrides: Partial<CrmLead>): CrmLead {
  return { id: "CRM-1", customer: "Test", salesperson: "Rep A", status: "New Lead" } as CrmLead;
}

const mk = (o: Partial<CrmLead>) => ({ ...lead({}), ...o }) as CrmLead;

test("creation time: date field wins, CRM-<ms> id is the fallback, neither → not graded", () => {
  assert.equal(leadCreatedAt(mk({ id: "CRM-x", date: "2026-07-11T11:00:00Z" }))?.slice(0, 16), "2026-07-11T11:00");
  const ms = NOW.getTime() - 120000;
  assert.equal(new Date(leadCreatedAt(mk({ id: `CRM-${ms}`, date: undefined }))!).getTime(), ms);
  assert.equal(speedClock(mk({ id: "lead-7", date: undefined }), NOW).state, "not_applicable");
});

test("a fresh New Lead is on the clock with seconds counting down", () => {
  const c = speedClock(mk({ date: minsAgo(2) }), NOW);
  assert.equal(c.state, "on_clock");
  if (c.state === "on_clock") {
    assert.ok(c.secondsLeft > 170 && c.secondsLeft <= 180, `secondsLeft=${c.secondsLeft}`);
  }
});

test("past 5:00 with no contact = breached, with minutes over", () => {
  const c = speedClock(mk({ date: minsAgo(12) }), NOW);
  assert.equal(c.state, "breached");
  if (c.state === "breached") assert.equal(c.minutesOver, 7);
});

test("firstContactAt stops the clock and grades the speed", () => {
  const c = speedClock(mk({ date: minsAgo(10), firstContactAt: minsAgo(7) }), NOW);
  assert.equal(c.state, "responded");
  if (c.state === "responded") assert.equal(c.responseMinutes, 3);
});

test("legacy fallback: first non-New status move counts as the contact moment", () => {
  const c = speedClock(
    mk({ date: minsAgo(60), statusHistory: [{ status: "Working", at: minsAgo(56) }] }),
    NOW,
  );
  assert.equal(c.state, "responded");
  if (c.state === "responded") assert.equal(c.responseMinutes, 4);
});

test("moved past New Lead with no recorded moment = responded but unmeasured", () => {
  const c = speedClock(mk({ date: minsAgo(60), status: "Working" }), NOW);
  assert.equal(c.state, "responded");
  if (c.state === "responded") assert.equal(c.responseMinutes, null);
});

test("stats: % under 5, averages, live counts, per-rep split", () => {
  const leads: CrmLead[] = [
    mk({ id: "a", date: minsAgo(100), firstContactAt: minsAgo(97) }), // 3m  Rep A
    mk({ id: "b", date: minsAgo(200), firstContactAt: minsAgo(191) }), // 9m Rep A
    mk({ id: "c", date: minsAgo(50), firstContactAt: minsAgo(46), salesperson: "Rep B" }), // 4m Rep B
    mk({ id: "d", date: minsAgo(2) }), // on clock now
    mk({ id: "e", date: minsAgo(30) }), // breached now
  ];
  const s = speedStats(leads, NOW);
  assert.equal(s.measured, 3);
  assert.equal(s.under5Pct, 67);
  assert.equal(s.onClockNow, 1);
  assert.equal(s.breachedNow, 1);
  assert.equal(s.avgMinutes, 5.3);
  assert.equal(s.medianMinutes, 4);
  const repA = s.byRep.find((r) => r.name === "Rep A")!;
  assert.equal(repA.measured, 2);
  assert.equal(repA.under5Pct, 50);
});

test("stats window: an old lead's response doesn't poison this month", () => {
  const old = mk({ id: "old", date: new Date(NOW.getTime() - 40 * 24 * 3600 * 1000).toISOString(), firstContactAt: new Date(NOW.getTime() - 40 * 24 * 3600 * 1000 + 60 * 60000).toISOString() });
  const s = speedStats([old], NOW);
  assert.equal(s.measured, 0);
});

test("firstContactPatch stamps once and never overwrites", () => {
  assert.deepEqual(firstContactPatch(mk({}), NOW), { firstContactAt: NOW.toISOString() });
  assert.equal(firstContactPatch(mk({ firstContactAt: minsAgo(5) }), NOW), null);
});

test("the five-minute constant is actually five minutes", () => {
  assert.equal(FIVE_MINUTES_MS, 300000);
});

test("marking an untouched lead Lost is NOT a response — no fake sub-5-minute grade", () => {
  const created = Date.now() - 2 * 60 * 1000;
  const lead = {
    id: `CRM-${created}`,
    status: "Lost" as const,
    statusHistory: [{ status: "Lost" as const, at: new Date(created + 2 * 60 * 1000).toISOString() }],
  };
  const clock = speedClock(lead as any, new Date(created + 10 * 60 * 1000));
  // Never contacted + dead: clock off and ungraded — NOT "responded in 2 min".
  assert.equal(clock.state, "not_applicable");
  const stats = speedStats([lead] as any[], new Date(created + 10 * 60 * 1000));
  assert.equal(stats.measured, 0);
});
