import test from "node:test";
import assert from "node:assert/strict";
import { makeMoney, metricLabel, metricDef, formatMetric } from "./payFormat.ts";
import type { PlanVocabulary } from "./payEngine.ts";

test("makeMoney: default is USD, whole units (matches the old $ helper)", () => {
  const m = makeMoney();
  assert.equal(m(9450), "$9,450");
  assert.equal(m(1449.6), "$1,450"); // rounds
  assert.equal(m(0), "$0");
});

test("makeMoney: honors a plan's currency + locale", () => {
  const eur = makeMoney({ currency: "EUR", locale: "de-DE" });
  const out = eur(1234.6);
  assert.match(out, /€/);
  assert.match(out, /1\.235/); // de-DE groups thousands with a dot, rounded
});

test("makeMoney: bad currency falls back to USD instead of throwing", () => {
  const m = makeMoney({ currency: "NOTREAL" as string });
  assert.equal(m(100), "$100");
});

test("metricLabel: vocab wins, then automotive default, then upper-cased key", () => {
  const vocab: PlanVocabulary = { metrics: [{ key: "billableHours", label: "Billable Hours" }] };
  assert.equal(metricLabel("pvr"), "PVR"); // built-in automotive default
  assert.equal(metricLabel("billableHours", vocab), "Billable Hours"); // custom
  assert.equal(metricLabel("marginPerPlacement"), "MARGINPERPLACEMENT"); // fallback
});

test("metricDef + formatMetric: render per declared format", () => {
  const vocab: PlanVocabulary = {
    currency: "USD",
    metrics: [
      { key: "arr", label: "ARR", format: "money" },
      { key: "attach", label: "Attach", format: "percent" },
      { key: "ppu", label: "PPU", format: "ratio" },
      { key: "units", label: "Units", format: "number" },
    ],
  };
  assert.equal(formatMetric(120000, metricDef("arr", vocab), vocab), "$120,000");
  assert.equal(formatMetric(62.5, metricDef("attach", vocab), vocab), "62.5%");
  assert.equal(formatMetric(2, metricDef("ppu", vocab), vocab), "2.00");
  assert.equal(formatMetric(15, metricDef("units", vocab), vocab), "15");
});
