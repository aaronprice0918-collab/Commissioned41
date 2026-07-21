import test from "node:test";
import assert from "node:assert/strict";
import { canAccessDeal, canAccessLead } from "./docAuth.ts";

// The customer-document endpoints (jacket PDF, license/insurance images) hold
// the most sensitive PII in the store. These pure ownership predicates are the
// gate; they mirror the CRM screens (deals: Sales/BDC own-only; leads: only
// Sales restricted). samePerson canonicalizes, so identical strings always
// match and clearly-different last names never do.

test("canAccessDeal: managers, F&I and admin may open any jacket", () => {
  const other = { salesperson: "Zeb Otherman" };
  assert.equal(canAccessDeal("Admin", "Someone Else", other), true);
  assert.equal(canAccessDeal("Manager", "Someone Else", other), true);
  assert.equal(canAccessDeal("F&I", "Someone Else", other), true);
});

test("canAccessDeal: Sales/BDC may open only their own deal", () => {
  assert.equal(canAccessDeal("Sales", "Quill Vanterpool", { salesperson: "Quill Vanterpool" }), true);
  assert.equal(canAccessDeal("Sales", "Quill Vanterpool", { salesperson: "Zeb Otherman" }), false);
  // BDC is scoped like Sales on DEALS (the deals screen redacts for both).
  assert.equal(canAccessDeal("BDC", "Quill Vanterpool", { salesperson: "Quill Vanterpool" }), true);
  assert.equal(canAccessDeal("BDC", "Quill Vanterpool", { salesperson: "Zeb Otherman" }), false);
});

test("canAccessDeal: fails closed on blank name, blank seller, or missing deal", () => {
  assert.equal(canAccessDeal("Sales", "", { salesperson: "Quill Vanterpool" }), false);
  assert.equal(canAccessDeal("Sales", "Quill Vanterpool", { salesperson: "" }), false);
  assert.equal(canAccessDeal("Sales", "Quill Vanterpool", null), false);
});

test("canAccessLead: only Sales is restricted; BDC/F&I/manager/admin see the store", () => {
  const other = { salesperson: "Zeb Otherman" };
  assert.equal(canAccessLead("Sales", "Quill Vanterpool", other), false);
  assert.equal(canAccessLead("Sales", "Quill Vanterpool", { salesperson: "Quill Vanterpool" }), true);
  // BDC works the whole store's leads (that's the seat's job).
  assert.equal(canAccessLead("BDC", "Quill Vanterpool", other), true);
  assert.equal(canAccessLead("Manager", "Quill Vanterpool", other), true);
  assert.equal(canAccessLead("F&I", "Quill Vanterpool", other), true);
  assert.equal(canAccessLead("Admin", "Quill Vanterpool", other), true);
});

test("canAccessLead: a Sales rep with a blank name is locked out (fails closed)", () => {
  assert.equal(canAccessLead("Sales", "", { salesperson: "Quill Vanterpool" }), false);
  assert.equal(canAccessLead("Sales", "Quill Vanterpool", null), false);
});
