import { strict as assert } from "node:assert";
import test from "node:test";
import {
  counterStats,
  makeLostSale,
  makePartsRequest,
  makeSpecialOrder,
  moveRequestPatch,
  moveSopPatch,
  nextRequestStatus,
  nextSopStatus,
  normalizePartsData,
  requestFillMinutes,
  sopAgeDays,
  sopPickupText,
  stockSuggestions,
} from "./parts";

test("SOP lifecycle: receipt stamps the aging clock once, Returned is never suggested", () => {
  const sop = makeSpecialOrder({ customer: "Dana", partNumber: "KD45-67-330A" });
  assert.equal(sop.status, "Ordered");
  assert.equal(nextSopStatus("Ordered"), "Received");
  assert.equal(nextSopStatus("Notified"), "Picked Up");
  assert.equal(nextSopStatus("Picked Up"), null);
  assert.equal(nextSopStatus("Returned"), null);

  const received = { ...sop, ...moveSopPatch(sop, "Received")! };
  assert.ok(received.receivedAt);
  assert.equal(received.statusHistory.length, 2);
  // A later move never rewinds the receipt stamp.
  const bounced = { ...received, ...moveSopPatch(received, "Notified")! };
  const back = { ...bounced, ...moveSopPatch(bounced, "Received")! };
  assert.equal(back.receivedAt, received.receivedAt);
  assert.equal(moveSopPatch(back, "Received"), null); // same-status = no-op
});

test("sopAgeDays: only open, received orders age", () => {
  const now = new Date("2026-07-12T12:00:00");
  const receivedAt = "2026-07-02T12:00:00";
  assert.equal(sopAgeDays({ status: "Received", receivedAt }, now), 10);
  assert.equal(sopAgeDays({ status: "Notified", receivedAt }, now), 10);
  assert.equal(sopAgeDays({ status: "Ordered" }, now), null); // not landed
  assert.equal(sopAgeDays({ status: "Picked Up", receivedAt }, now), null); // closed
  assert.equal(sopAgeDays({ status: "Returned", receivedAt }, now), null);
});

test("tech request queue: fill clock stops at Pulled", () => {
  const request = makePartsRequest({ tech: "Marcus", roNumber: "45231", createdAt: "2026-07-12T09:00:00" });
  assert.equal(nextRequestStatus("Waiting"), "Pulled");
  assert.equal(nextRequestStatus("Delivered"), null);
  const pulled = { ...request, ...moveRequestPatch(request, "Pulled")! };
  assert.ok(pulled.pulledAt);
  assert.equal(requestFillMinutes({ createdAt: "2026-07-12T09:00:00", pulledAt: "2026-07-12T09:12:00" }), 12);
  assert.equal(requestFillMinutes({ createdAt: "2026-07-12T09:00:00" }), null);
});

test("stockSuggestions: three asks in ninety days rings the bell, grouped by part number", () => {
  const now = new Date("2026-07-12T12:00:00");
  const mk = (at: string, partNumber?: string, description = "cabin filter", value = 40) =>
    makeLostSale({ at, partNumber, description, value });
  const sales = [
    mk("2026-07-01T10:00:00", "KD45-67-330A"),
    mk("2026-06-15T10:00:00", "kd45 67 330a"), // normalizes to the same key
    mk("2026-05-20T10:00:00", "KD45-67-330A"),
    mk("2026-01-01T10:00:00", "KD45-67-330A"), // out of the 90-day window
    mk("2026-07-05T10:00:00", undefined, "wiper blades"), // only 1 demand
  ];
  const suggestions = stockSuggestions(sales, now);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].demands, 3);
  assert.equal(suggestions[0].value, 120);
});

test("counterStats: waiting vs aging vs queue vs lost dollars", () => {
  const now = new Date("2026-07-12T12:00:00");
  const data = normalizePartsData({
    sops: [
      makeSpecialOrder({ status: "Ordered" }),
      { ...makeSpecialOrder({ price: 480 }), status: "Received" as const, receivedAt: "2026-07-10T12:00:00" }, // fresh
      { ...makeSpecialOrder({ price: 120 }), status: "Notified" as const, receivedAt: "2026-06-30T12:00:00" }, // 12 days = aging
      { ...makeSpecialOrder({ price: 999 }), status: "Picked Up" as const, receivedAt: "2026-06-30T12:00:00" }, // closed, not counted
    ],
    requests: [
      makePartsRequest({ createdAt: "2026-07-12T09:00:00" }),
      { ...makePartsRequest({ createdAt: "2026-07-12T09:00:00" }), status: "Pulled" as const, pulledAt: "2026-07-12T09:10:00" },
    ],
    lostSales: [
      makeLostSale({ at: "2026-07-10T10:00:00", value: 85 }),
      makeLostSale({ at: "2026-03-01T10:00:00", value: 500 }), // old — out of 30d
    ],
  });
  const stats = counterStats(data, now);
  assert.equal(stats.sopsOrdered, 1);
  assert.equal(stats.sopsWaiting, 2);
  assert.equal(stats.sopsAging, 1);
  assert.equal(stats.sopsWaitingValue, 600);
  assert.equal(stats.queueWaiting, 1);
  assert.equal(stats.avgFillMinutes, 10);
  assert.equal(stats.lostSales30d, 1);
  assert.equal(stats.lostValue30d, 85);
});

test("pickup text: first name, the part in plain words, deposit mention only when real", () => {
  const sop = makeSpecialOrder({ customer: "Dana Whitfield", description: "roof rack cross bars", deposit: 50 });
  const text = sopPickupText(sop, "Kennesaw Mazda");
  assert.ok(text.includes("Hi Dana"));
  assert.ok(text.includes("roof rack cross bars"));
  assert.ok(text.includes("Kennesaw Mazda"));
  assert.ok(text.includes("deposit"));
  const noDeposit = sopPickupText(makeSpecialOrder({ customer: "Sam", partNumber: "B45A-28-156" }), "Store");
  assert.ok(noDeposit.includes("B45A-28-156"));
  assert.ok(!noDeposit.includes("deposit"));
});

test("normalizePartsData tolerates garbage", () => {
  assert.deepEqual(normalizePartsData(null), { sops: [], requests: [], lostSales: [] });
  assert.deepEqual(normalizePartsData({ sops: "nope" }), { sops: [], requests: [], lostSales: [] });
});
