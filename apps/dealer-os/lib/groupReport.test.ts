import { strict as assert } from "node:assert";
import test from "node:test";
import type { Deal } from "./data";
import { groupForViewer, groupRollup, parseGroupConfig } from "./groupReport";

// Minimal sold-retail deal the metrics engine counts: Delivered + New/Used,
// docFee 0 so gross is exactly front + back.
function deal(frontGross: number, backGrossReserve: number, vehicleClass: "New" | "Used" = "New"): Deal {
  return {
    stage: "Delivered",
    vehicleClass,
    // A real vehicle sale has a stock number — without one a $0-front, back-gross-only
    // deal now (correctly) reads as product-only and is excluded from units/PVR.
    stockNumber: "STK1",
    frontGross,
    backGrossReserve,
    docFee: 0,
    financeStatus: "Classified",
    products: {},
  } as unknown as Deal;
}

test("groupRollup: totals are raw sums and group PVR is units-weighted, never an average of store PVRs", () => {
  const r = groupRollup([
    { orgId: "a", name: "Store A", deals: [deal(1000, 2000), deal(1000, 2000)] }, // 2 units, 6000, PVR 3000
    { orgId: "b", name: "Store B", deals: [deal(0, 600)] }, // 1 unit, 600, PVR 600
  ]);
  assert.equal(r.totals.stores, 2);
  assert.equal(r.totals.units, 3);
  assert.equal(r.totals.gross, 6600);
  assert.equal(r.totals.front, 2000);
  assert.equal(r.totals.back, 4600);
  assert.equal(r.totals.pvr, 2200); // 6600/3 — NOT (3000+600)/2
  const a = r.stores.find((s) => s.orgId === "a")!;
  assert.equal(a.units, 2);
  assert.equal(a.pvr, 3000);
});

test("groupRollup: stores sort by gross, empty stores contribute zeros without crashing", () => {
  const r = groupRollup([
    { orgId: "small", name: "Small", deals: [deal(100, 0, "Used")] },
    { orgId: "big", name: "Big", deals: [deal(5000, 5000)] },
    { orgId: "empty", name: "Empty", deals: [] },
  ]);
  assert.deepEqual(r.stores.map((s) => s.orgId), ["big", "small", "empty"]);
  assert.equal(r.totals.units, 2);
  assert.equal(r.totals.newUnits, 1);
  assert.equal(r.totals.usedUnits, 1);
});

test("groupRollup: no stores = all-zero totals", () => {
  const r = groupRollup([]);
  assert.equal(r.totals.units, 0);
  assert.equal(r.totals.pvr, 0);
  assert.equal(r.totals.stores, 0);
});

test("parseGroupConfig: valid config parses, junk degrades to null", () => {
  const good = parseGroupConfig({ name: "Price Auto Group", memberOrgIds: ["o1", "o2"], viewers: ["Boss@Group.com"] });
  assert.equal(good?.name, "Price Auto Group");
  assert.deepEqual(good?.memberOrgIds, ["o1", "o2"]);
  assert.equal(parseGroupConfig(null), null);
  assert.equal(parseGroupConfig("nope"), null);
  assert.equal(parseGroupConfig({ memberOrgIds: [], viewers: ["a@b.c"] }), null); // no members
  assert.equal(parseGroupConfig({ memberOrgIds: ["o1"], viewers: [] }), null); // no viewers
  assert.equal(parseGroupConfig({ memberOrgIds: ["o1"], viewers: ["not-an-email"] }), null); // viewers must look like emails
  // missing name gets the default
  assert.equal(parseGroupConfig({ memberOrgIds: ["o1"], viewers: ["a@b.c"] })?.name, "Dealer Group");
});

test("groupForViewer: case-insensitive email match, first matching group wins, no match = null", () => {
  const configs = [
    { value: { name: "G1", memberOrgIds: ["o1"], viewers: ["boss@group.com"] } },
    { value: "garbage" },
    { value: { name: "G2", memberOrgIds: ["o2"], viewers: ["boss@group.com", "gm@g2.com"] } },
  ];
  assert.equal(groupForViewer(configs, "BOSS@group.COM")?.name, "G1");
  assert.equal(groupForViewer(configs, "gm@g2.com")?.name, "G2");
  assert.equal(groupForViewer(configs, "rando@nowhere.com"), null);
  assert.equal(groupForViewer(configs, ""), null);
});
