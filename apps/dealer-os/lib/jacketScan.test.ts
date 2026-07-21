import test from "node:test";
import assert from "node:assert/strict";
import { matchDocLabel, orderScannedPages } from "./jacketScan.ts";

const ORDER = ["Buyer's Order", "Retail Installment Contract", "GAP Waiver", "Odometer Disclosure"];

test("matchDocLabel snaps exact and fuzzy labels onto the store order", () => {
  assert.equal(matchDocLabel("Buyer's Order", ORDER), "Buyer's Order");
  assert.equal(matchDocLabel("buyers order", ORDER), "Buyer's Order");
  assert.equal(matchDocLabel("RETAIL INSTALLMENT CONTRACT", ORDER), "Retail Installment Contract");
  assert.equal(matchDocLabel("GAP", ORDER), "GAP Waiver");
  assert.equal(matchDocLabel("Odometer Disclosure Statement", ORDER), "Odometer Disclosure");
  assert.equal(matchDocLabel("Random Flyer", ORDER), "Unknown");
  assert.equal(matchDocLabel("", ORDER), "Unknown");
  assert.equal(matchDocLabel("unknown", ORDER), "Unknown");
});

test("orderScannedPages groups pages by doc in the store's order", () => {
  // Scanned stack: GAP (p0), Buyer's Order (p1-2), Contract (p3), GAP page 2 (p4)
  const plan = orderScannedPages(
    [
      { page: 0, doc: "GAP Waiver" },
      { page: 1, doc: "Buyer's Order" },
      { page: 2, doc: "Buyer's Order" },
      { page: 3, doc: "Retail Installment Contract" },
      { page: 4, doc: "GAP Waiver" },
    ],
    ORDER
  );
  assert.deepEqual(plan.sequence, [1, 2, 3, 0, 4]);
  assert.deepEqual(
    plan.groups.map((g) => [g.doc, g.pages]),
    [
      ["Buyer's Order", [1, 2]],
      ["Retail Installment Contract", [3]],
      ["GAP Waiver", [0, 4]],
    ]
  );
  assert.deepEqual(plan.found, ["Buyer's Order", "Retail Installment Contract", "GAP Waiver"]);
  assert.deepEqual(plan.unknownPages, []);
});

test("orderScannedPages keeps every unplaced page at the back — nothing vanishes", () => {
  const plan = orderScannedPages(
    [
      { page: 0, doc: "mystery" },
      { page: 1, doc: "Buyer's Order" },
      { page: 2, doc: "" },
    ],
    ORDER
  );
  assert.deepEqual(plan.sequence, [1, 0, 2]);
  assert.deepEqual(plan.groups.at(-1), { doc: "Unknown", pages: [0, 2] });
  assert.deepEqual(plan.unknownPages, [0, 2]);
  // every input page appears exactly once
  assert.deepEqual([...plan.sequence].sort(), [0, 1, 2]);
});

test("orderScannedPages handles out-of-order label arrival", () => {
  const plan = orderScannedPages(
    [
      { page: 3, doc: "Buyer's Order" },
      { page: 1, doc: "Buyer's Order" },
    ],
    ORDER
  );
  assert.deepEqual(plan.sequence, [1, 3]);
});
