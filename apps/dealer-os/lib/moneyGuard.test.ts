import { test } from "node:test";
import assert from "node:assert/strict";
import { finiteMoney, sanitizeStoreValue } from "./moneyGuard.ts";

test("finiteMoney coerces garbage to a finite number", () => {
  assert.equal(finiteMoney(750), 750);
  assert.equal(finiteMoney("750"), 750);
  assert.equal(finiteMoney("1e9"), 10_000_000); // 1e9 parsed then clamped to the envelope
  assert.equal(finiteMoney(NaN), 0);
  assert.equal(finiteMoney(Infinity), 0);
  assert.equal(finiteMoney(-Infinity), 0);
  assert.equal(finiteMoney("not a number"), 0);
  assert.equal(finiteMoney(null), 0);
  assert.equal(finiteMoney(undefined), 0);
});

test("finiteMoney clamps absurd values to the ±$10M envelope", () => {
  assert.equal(finiteMoney(50_000_000), 10_000_000);
  assert.equal(finiteMoney(-50_000_000), -10_000_000);
  assert.equal(finiteMoney(9_999_999), 9_999_999);
});

test("sanitizeStoreValue cleans deal money fields, leaves others untouched", () => {
  const deals = [
    { id: "a", customer: "ASKEW", frontGross: "1e9", backGrossReserve: NaN, reserve: 2022, salesperson: "Bo" },
    { id: "b", customer: "DEAN", frontGross: 750, docFee: "abc" },
  ];
  const out = sanitizeStoreValue("deals", deals);
  assert.equal(out[0].frontGross, 10_000_000); // clamped
  assert.equal(out[0].backGrossReserve, 0); // NaN → 0
  assert.equal(out[0].reserve, 2022); // untouched valid
  assert.equal(out[0].customer, "ASKEW"); // non-money untouched
  assert.equal(out[0].salesperson, "Bo");
  assert.equal(out[1].frontGross, 750);
  assert.equal(out[1].docFee, 0); // "abc" → 0
});

test("sanitizeStoreValue recurses into closedMonths deals", () => {
  const months = [{ month: "2026-06", deals: [{ id: "x", frontGross: "NaN", reserve: 100 }] }];
  const out = sanitizeStoreValue("closedMonths", months);
  assert.equal(out[0].deals[0].frontGross, 0);
  assert.equal(out[0].deals[0].reserve, 100);
  assert.equal(out[0].month, "2026-06");
});

test("sanitizeStoreValue passes non-money keys through unchanged", () => {
  const team = { salespeople: ["A"], managers: [] };
  assert.deepEqual(sanitizeStoreValue("team", team), team);
  const goals = { pvr: 1200 };
  assert.deepEqual(sanitizeStoreValue("goals", goals), goals);
});

test("sanitizeStoreValue tolerates non-array/non-object values", () => {
  assert.equal(sanitizeStoreValue("deals", null), null);
  assert.equal(sanitizeStoreValue("storeSettings", null), null);
});
