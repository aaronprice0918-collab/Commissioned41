import { strict as assert } from "node:assert";
import test from "node:test";
import { isLate, laneStats, makeServiceVisit, moveVisitPatch, nextStatus, promiseRisk, promiseStats, recaptureList, recaptureText, statusUpdateText, updateDue, SERVICE_STATUSES } from "./service";

test("visit lifecycle: history is append-only, same-status move is a no-op", () => {
  const visit = makeServiceVisit({ customer: "Sarah", vehicle: "2022 CX-5" });
  assert.equal(visit.status, "Scheduled");
  assert.equal(visit.statusHistory.length, 1);
  const patch = moveVisitPatch(visit, "Checked In");
  assert.ok(patch);
  assert.equal(patch!.status, "Checked In");
  assert.equal(patch!.statusHistory!.length, 2);
  assert.equal(moveVisitPatch(visit, "Scheduled"), null); // no duplicate history
});

test("nextStatus walks the lane in order and stops at the end", () => {
  assert.equal(nextStatus("Scheduled"), "Checked In");
  assert.equal(nextStatus("Ready"), "Picked Up");
  assert.equal(nextStatus("Picked Up"), null);
  assert.equal(SERVICE_STATUSES.length, 5);
});

test("isLate: only open visits past their promise time are late", () => {
  const now = new Date("2026-07-12T15:00:00");
  assert.ok(isLate({ promisedAt: "2026-07-12T14:00", status: "In Service" }, now));
  assert.ok(!isLate({ promisedAt: "2026-07-12T16:00", status: "In Service" }, now));
  assert.ok(!isLate({ promisedAt: "2026-07-12T14:00", status: "Ready" }, now)); // done = not late
  assert.ok(!isLate({ status: "In Service" }, now)); // no promise = never late
});

test("laneStats: counts by state, declined work only on closed visits in the window", () => {
  const now = new Date("2026-07-12T15:00:00");
  const mk = (over: Parameters<typeof makeServiceVisit>[0]) => ({ ...makeServiceVisit(over), createdAt: over?.createdAt || now.toISOString() });
  const visits = [
    mk({ status: "Checked In" }),
    mk({ status: "Ready" }),
    mk({ status: "In Service", promisedAt: "2026-07-12T13:00" }), // late
    mk({ status: "Scheduled" }), // booked, NOT in the lane
    mk({ status: "Picked Up", declinedWork: "Rear brakes at 3mm — $480" }),
    mk({ status: "Picked Up", declinedWork: "Cabin filter", createdAt: new Date(now.getTime() - 40 * 86_400_000).toISOString() }), // out of window
    mk({ status: "Checked In", salesOpportunity: true }),
  ];
  const stats = laneStats(visits, now);
  assert.equal(stats.inLaneNow, 4); // arrived cars only — the Scheduled one is excluded
  assert.equal(stats.scheduledNow, 1);
  assert.equal(stats.readyNow, 1);
  assert.equal(stats.lateNow, 1);
  assert.equal(stats.arrivedToday, 5); // past-Scheduled visits created today (one is 40 days old)
  assert.equal(stats.declinedOpen, 1);
  assert.equal(stats.salesFlags, 1);
});

test("promiseRisk: soon inside the warning window, late past it, done never risks", () => {
  const now = new Date("2026-07-12T15:00:00");
  assert.equal(promiseRisk({ promisedAt: "2026-07-12T15:30", status: "In Service" }, now), "soon");
  assert.equal(promiseRisk({ promisedAt: "2026-07-12T14:00", status: "In Service" }, now), "late");
  assert.equal(promiseRisk({ promisedAt: "2026-07-12T17:00", status: "In Service" }, now), null);
  assert.equal(promiseRisk({ promisedAt: "2026-07-12T15:30", status: "Ready" }, now), null);
  assert.equal(promiseRisk({ status: "In Service" }, now), null);
});

test("updateDue: quiet too long since arrival or last text; Scheduled/Ready never due", () => {
  const now = new Date("2026-07-12T15:00:00");
  const arrived = (at: string) => [{ status: "Scheduled" as const, at: "2026-07-12T08:00:00" }, { status: "Checked In" as const, at }];
  assert.ok(updateDue({ status: "In Service", statusHistory: arrived("2026-07-12T12:00:00"), createdAt: "2026-07-12T08:00:00" }, now));
  assert.ok(!updateDue({ status: "In Service", statusHistory: arrived("2026-07-12T14:00:00"), createdAt: "2026-07-12T08:00:00" }, now));
  // A status text an hour ago resets the silence clock.
  assert.ok(!updateDue({ status: "In Service", statusHistory: arrived("2026-07-12T09:00:00"), lastUpdateAt: "2026-07-12T14:00:00", createdAt: "2026-07-12T08:00:00" }, now));
  assert.ok(!updateDue({ status: "Scheduled", statusHistory: [], createdAt: "2026-07-12T08:00:00" }, now));
  assert.ok(!updateDue({ status: "Ready", statusHistory: arrived("2026-07-12T09:00:00"), createdAt: "2026-07-12T08:00:00" }, now));
});

test("statusUpdateText: on-track vs honest late re-promise vs ready", () => {
  const now = new Date("2026-07-12T15:00:00");
  const base = makeServiceVisit({ customer: "Sarah Chen", vehicle: "2022 CX-5" });
  const onTrack = { ...base, status: "In Service" as const, promisedAt: "2026-07-12T17:00" };
  assert.ok(statusUpdateText(onTrack, "Kennesaw Mazda", now).includes("on track"));
  const late = { ...base, status: "In Service" as const, promisedAt: "2026-07-12T14:00" };
  const lateText = statusUpdateText(late, "Kennesaw Mazda", now);
  assert.ok(lateText.includes("longer than we promised"));
  assert.ok(lateText.includes("Sarah"));
  assert.ok(statusUpdateText({ ...base, status: "Ready" as const }, "Kennesaw Mazda", now).includes("ready for pickup"));
});

test("promiseStats: kept = done at or before the promise, per advisor", () => {
  const now = new Date("2026-07-12T15:00:00");
  const closed = (advisor: string, promisedAt: string, readyAt: string) => ({
    ...makeServiceVisit({ advisor, promisedAt, createdAt: "2026-07-10T08:00:00" }),
    createdAt: "2026-07-10T08:00:00",
    status: "Picked Up" as const,
    statusHistory: [
      { status: "Checked In" as const, at: "2026-07-10T08:00:00" },
      { status: "Ready" as const, at: readyAt },
      { status: "Picked Up" as const, at: "2026-07-10T18:00:00" },
    ],
  });
  const stats = promiseStats(
    [
      closed("Priya", "2026-07-10T15:00", "2026-07-10T14:30"), // kept
      closed("Priya", "2026-07-10T15:00", "2026-07-10T16:00"), // blown
      closed("Dee", "2026-07-10T12:00", "2026-07-10T11:00"), // kept
      { ...makeServiceVisit({ advisor: "Priya" }), status: "In Service" as const }, // open — not graded
    ],
    now,
  );
  const priya = stats.find((s) => s.advisor === "Priya")!;
  assert.equal(priya.promised, 2);
  assert.equal(priya.kept, 1);
  assert.equal(priya.hitRate, 50);
  assert.equal(stats.find((s) => s.advisor === "Dee")!.hitRate, 100);
});

test("recaptureList: open declined-work missions with 30/60/90 buckets; recovered/dismissed drop off", () => {
  const now = new Date("2026-07-12T12:00:00");
  const closedWithDecline = (daysAgo: number, recapture?: { state: "recovered" | "dismissed"; at: string }) => {
    const at = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    return {
      ...makeServiceVisit({ declinedWork: "Rear brakes at 3mm — $480" }),
      createdAt: at,
      status: "Picked Up" as const,
      statusHistory: [{ status: "Picked Up" as const, at }],
      ...(recapture ? { recapture } : {}),
    };
  };
  const missions = recaptureList(
    [
      closedWithDecline(5),
      closedWithDecline(35),
      closedWithDecline(95),
      closedWithDecline(40, { state: "recovered", at: now.toISOString() }),
      { ...makeServiceVisit(), status: "Picked Up" as const }, // no declined work
    ],
    now,
  );
  assert.equal(missions.length, 3);
  assert.equal(missions[0].daysSince, 95); // oldest first
  assert.equal(missions[0].cadence, 90);
  assert.equal(missions[1].cadence, 30);
  assert.equal(missions[2].cadence, null);
  const text = recaptureText(missions[0].visit, "Kennesaw Mazda");
  assert.ok(text.includes("Rear brakes"));
});
