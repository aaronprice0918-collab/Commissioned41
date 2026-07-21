import test from "node:test";
import assert from "node:assert/strict";
import {
  docFeeIncome,
  estimatedTax,
  mergeStoreSettings,
  money,
  samePerson,
  defaultStoreSettings,
  type Deal,
} from "./data.ts";

// These primitives sit under the whole app: samePerson is the privacy/pay-
// attribution linchpin (every redaction + ownership check runs through it);
// money()/docFeeIncome guard the sacred money math against $NaN; estimatedTax
// and mergeStoreSettings govern per-tenant tax/config. They had no direct tests.

test("money() coerces missing / NaN / string dollars to a finite number", () => {
  assert.equal(money(1500), 1500);
  assert.equal(money(undefined as unknown as number), 0);
  assert.equal(money(NaN), 0);
  assert.equal(money(null as unknown as number), 0);
});

test("docFeeIncome returns a real fee but never lets NaN through (NaN is a number)", () => {
  assert.equal(docFeeIncome({ docFee: 899 } as Deal), 899);
  assert.equal(docFeeIncome({ docFee: NaN } as Deal), 0); // the fixed passthrough bug
  assert.equal(docFeeIncome({} as Deal), 0);
  assert.equal(docFeeIncome({ docFee: "899" as unknown as number } as Deal), 0); // strings aren't income
});

test("estimatedTax: doc fee is in the base only when the rule says so; base clamps at 0", () => {
  const withDoc = mergeStoreSettings({ docFee: 899, tax: { rate: 0.07, basis: "price_plus_docfee" } as never });
  assert.equal(estimatedTax(30000, withDoc), (30000 + 899) * 0.07);
  const priceOnly = mergeStoreSettings({ docFee: 899, tax: { rate: 0.07, basis: "price" } as never });
  assert.equal(estimatedTax(30000, priceOnly), 30000 * 0.07);
  assert.equal(estimatedTax(-5000, priceOnly), 0); // negative price → no negative tax
});

test("mergeStoreSettings fills defaults and overrides field-by-field", () => {
  assert.deepEqual(mergeStoreSettings(null), defaultStoreSettings); // null short-circuits to the default
  const fromEmpty = mergeStoreSettings({});
  assert.equal(fromEmpty.docFee, defaultStoreSettings.docFee);
  assert.equal(fromEmpty.tax.rate, defaultStoreSettings.tax.rate);
  assert.equal(fromEmpty.tax.basis, defaultStoreSettings.tax.basis);
  const merged = mergeStoreSettings({ tax: { rate: 0.06 } as never });
  assert.equal(merged.tax.rate, 0.06); // override wins
  assert.equal(merged.docFee, defaultStoreSettings.docFee); // everything else defaults
  assert.equal(merged.tax.basis, "price_plus_docfee"); // basis defaults, not undefined
});

test("mergeStoreSettings falls back garbage product weights per-field", () => {
  const merged = mergeStoreSettings({ productWeights: { vsc: "bad" } as never });
  const key = Object.keys(defaultStoreSettings.productWeights)[0] as keyof typeof defaultStoreSettings.productWeights;
  assert.equal(typeof merged.productWeights[key], "number");
  assert.ok(Number.isFinite(merged.productWeights[key]));
});

test("samePerson matches the same identity and canonicalizes aliases / last names", () => {
  assert.equal(samePerson("Noel Bernard", "noel bernard"), true);
  assert.equal(samePerson("Noel Bernard", "Bernard"), true); // last-name canonicalization to the roster
  assert.equal(samePerson("Noel Bernard", "Watson Jones"), false);
  // Arbitrary non-roster identity still matches itself but not a different name.
  assert.equal(samePerson("Quill Vanterpool", "Quill Vanterpool"), true);
  assert.equal(samePerson("Quill Vanterpool", "Zeb Otherman"), false);
});
