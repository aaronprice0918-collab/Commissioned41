import { strict as assert } from "node:assert";
import test from "node:test";
import { buildFixedOpsDigest } from "./fixedOpsDigest";
import { makeServiceVisit } from "./service";
import { makeLostSale, makeSpecialOrder } from "./parts";

const now = new Date("2026-07-13T11:00:00"); // Monday morning

const closedPromised = (promisedAt: string, readyAt: string, daysAgo = 2) => {
  const created = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    ...makeServiceVisit({ advisor: "Priya", promisedAt }),
    createdAt: created,
    status: "Picked Up" as const,
    statusHistory: [
      { status: "Checked In" as const, at: created },
      { status: "Ready" as const, at: readyAt },
      { status: "Picked Up" as const, at: readyAt },
    ],
  };
};

test("digest: promise math, win-back, SOP shelf money, lost-sale week, top move ranks late first", () => {
  const visits = [
    closedPromised("2026-07-11T15:00", "2026-07-11T14:00"), // kept
    closedPromised("2026-07-11T15:00", "2026-07-11T16:00"), // blown
    { // LATE right now
      ...makeServiceVisit({ customer: "Nina", promisedAt: "2026-07-13T09:00" }),
      status: "In Service" as const,
    },
    { // open win-back mission in the 30-day window
      ...makeServiceVisit({ declinedWork: "Rear brakes — $480" }),
      createdAt: new Date(now.getTime() - 35 * 86_400_000).toISOString(),
      status: "Picked Up" as const,
      statusHistory: [{ status: "Picked Up" as const, at: new Date(now.getTime() - 35 * 86_400_000).toISOString() }],
    },
  ];
  const parts = {
    sops: [{ ...makeSpecialOrder({ price: 480 }), status: "Received" as const, receivedAt: new Date(now.getTime() - 10 * 86_400_000).toISOString() }],
    requests: [],
    lostSales: [
      makeLostSale({ at: "2026-07-10T10:00:00", value: 85 }),
      makeLostSale({ at: "2026-06-01T10:00:00", value: 500 }), // outside the week
    ],
  };
  const digest = buildFixedOpsDigest(visits, parts, "Kennesaw Mazda", now);
  assert.equal(digest.service.promised7d, 2);
  assert.equal(digest.service.kept7d, 1);
  assert.equal(digest.service.hitRate7d, 50);
  assert.equal(digest.service.lateNow, 1);
  assert.equal(digest.service.winBackOpen, 1);
  assert.equal(digest.service.winBackInWindow, 1);
  assert.equal(digest.parts.sopsWaiting, 1);
  assert.equal(digest.parts.sopsWaitingValue, 480);
  assert.equal(digest.parts.sopsAging, 1);
  assert.equal(digest.parts.lostValue7d, 85);
  assert.ok(digest.topMove.includes("LATE"), "late outranks everything");
  assert.ok(digest.text.includes("Kennesaw Mazda"));
  assert.ok(digest.text.includes("1/2 promises kept (50%)"));
  assert.ok(digest.text.split("\n").length <= 4, "SMS stays compact");
});

test("digest: empty boards read clean, no promised jobs = no fake 0%", () => {
  const digest = buildFixedOpsDigest([], null, "Store", now);
  assert.equal(digest.service.hitRate7d, null);
  assert.ok(digest.text.includes("no promised jobs closed this week"));
  assert.ok(digest.topMove.includes("Clean board"));
});

test("digest: top move falls through late -> aging SOPs -> win-back window", () => {
  const agingSop = { sops: [{ ...makeSpecialOrder(), status: "Received" as const, receivedAt: new Date(now.getTime() - 10 * 86_400_000).toISOString() }], requests: [], lostSales: [] };
  assert.ok(buildFixedOpsDigest([], agingSop, "S", now).topMove.includes("aging"));
  const winback = [{
    ...makeServiceVisit({ declinedWork: "Tires" }),
    createdAt: new Date(now.getTime() - 61 * 86_400_000).toISOString(),
    status: "Picked Up" as const,
    statusHistory: [{ status: "Picked Up" as const, at: new Date(now.getTime() - 61 * 86_400_000).toISOString() }],
  }];
  assert.ok(buildFixedOpsDigest(winback, null, "S", now).topMove.includes("win-back"));
});
