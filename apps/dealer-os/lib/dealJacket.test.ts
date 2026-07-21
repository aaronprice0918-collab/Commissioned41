import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_JACKET_ORDER,
  cycleJacketState,
  jacketDocState,
  jacketOrderFor,
  jacketStatus,
  jacketSummaryLine,
  normalizeJacketOrder,
  withJacketDoc,
} from "./dealJacket.ts";

test("jacketOrderFor falls back to the house default when unset or empty", () => {
  assert.equal(jacketOrderFor(undefined), DEFAULT_JACKET_ORDER);
  assert.equal(jacketOrderFor(null), DEFAULT_JACKET_ORDER);
  assert.equal(jacketOrderFor({}), DEFAULT_JACKET_ORDER);
  assert.equal(jacketOrderFor({ dealJacketOrder: [] }), DEFAULT_JACKET_ORDER);
  assert.equal(jacketOrderFor({ dealJacketOrder: ["  ", ""] }), DEFAULT_JACKET_ORDER);
});

test("jacketOrderFor uses the store override, trimmed", () => {
  const order = jacketOrderFor({ dealJacketOrder: [" Buyer's Order ", "Contract", ""] });
  assert.deepEqual(order, ["Buyer's Order", "Contract"]);
});

test("normalizeJacketOrder trims, drops empties, dedupes case-insensitively", () => {
  const order = normalizeJacketOrder("Buyer's Order\n\n  Contract  \nbuyer's order\nTitle App");
  assert.deepEqual(order, ["Buyer's Order", "Contract", "Title App"]);
});

test("cycleJacketState walks missing → have → na → missing", () => {
  assert.equal(cycleJacketState("missing"), "have");
  assert.equal(cycleJacketState("have"), "na");
  assert.equal(cycleJacketState("na"), "missing");
});

test("withJacketDoc sets and clears doc states", () => {
  const deal = { jacketDocs: undefined as Record<string, "have" | "na"> | undefined };
  const withHave = withJacketDoc(deal, "Contract", "have");
  assert.deepEqual(withHave, { Contract: "have" });
  const withNa = withJacketDoc({ jacketDocs: withHave }, "Title App", "na");
  assert.deepEqual(withNa, { Contract: "have", "Title App": "na" });
  const cleared = withJacketDoc({ jacketDocs: withNa }, "Contract", "missing");
  assert.deepEqual(cleared, { "Title App": "na" });
});

test("jacketStatus counts have/na/missing in the store order and knows complete", () => {
  const order = ["A", "B", "C", "D"];
  const deal = { jacketDocs: { A: "have", C: "na" } as Record<string, "have" | "na"> };
  const s = jacketStatus(deal, order);
  assert.equal(s.total, 4);
  assert.equal(s.have, 1);
  assert.equal(s.na, 1);
  assert.deepEqual(s.missing, ["B", "D"]);
  assert.equal(s.required, 3);
  assert.equal(s.complete, false);
  assert.deepEqual(
    s.items.map((x) => [x.position, x.doc, x.state]),
    [
      [1, "A", "have"],
      [2, "B", "missing"],
      [3, "C", "na"],
      [4, "D", "missing"],
    ]
  );

  const done = jacketStatus({ jacketDocs: { A: "have", B: "have", C: "na", D: "have" } }, order);
  assert.equal(done.complete, true);
  assert.equal(done.have, 3);
});

test("jacketDocState reads missing for unknown docs", () => {
  assert.equal(jacketDocState({ jacketDocs: { A: "have" } }, "A"), "have");
  assert.equal(jacketDocState({ jacketDocs: { A: "have" } }, "B"), "missing");
  assert.equal(jacketDocState({}, "B"), "missing");
});

test("jacketSummaryLine reads clean for complete and lists missing docs otherwise", () => {
  const order = ["A", "B", "C"];
  assert.match(jacketSummaryLine({ jacketDocs: { A: "have", B: "have", C: "have" } }, order), /complete/i);
  const line = jacketSummaryLine({ jacketDocs: { A: "have" } }, order);
  assert.match(line, /1 of 3/);
  assert.match(line, /missing: B, C/);
});
