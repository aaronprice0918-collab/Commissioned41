import test from "node:test";
import assert from "node:assert/strict";
import { decideEntitlement, isEntitledStatus, COURTESY_DAYS } from "./billing.ts";
import { DEFAULT_ORG_ID } from "./orgs.ts";

const NOW = new Date("2026-07-11T12:00:00Z");
const ORG = "11111111-1111-1111-1111-111111111111";
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

test("billing off (no Stripe key) entitles everyone — shipping changes nothing", () => {
  const d = decideEntitlement({ stripeConfigured: false, orgId: ORG, billing: null, orgCreatedAt: daysAgo(400), now: NOW });
  assert.equal(d.entitled, true);
  assert.equal(d.reason, "billing_off");
});

test("the founding store is always entitled", () => {
  const d = decideEntitlement({ stripeConfigured: true, orgId: DEFAULT_ORG_ID, billing: null, orgCreatedAt: daysAgo(400), now: NOW });
  assert.equal(d.entitled, true);
  assert.equal(d.reason, "founding_store");
});

test("active / trialing / comped entitle; past_due and canceled do not", () => {
  assert.equal(isEntitledStatus("active"), true);
  assert.equal(isEntitledStatus("trialing"), true);
  assert.equal(isEntitledStatus("comped"), true);
  assert.equal(isEntitledStatus("past_due"), false);
  assert.equal(isEntitledStatus("canceled"), false);
  assert.equal(isEntitledStatus(undefined), false);
});

test("a new org rides the courtesy window, then needs a subscription", () => {
  const inside = decideEntitlement({ stripeConfigured: true, orgId: ORG, billing: null, orgCreatedAt: daysAgo(COURTESY_DAYS - 1), now: NOW });
  assert.equal(inside.entitled, true);
  assert.equal(inside.reason, "courtesy_window");
  const outside = decideEntitlement({ stripeConfigured: true, orgId: ORG, billing: null, orgCreatedAt: daysAgo(COURTESY_DAYS + 1), now: NOW });
  assert.equal(outside.entitled, false);
  assert.equal(outside.reason, "never_subscribed");
});

test("an org with no created_at predates billing — grandfathered, never bricked", () => {
  const d = decideEntitlement({ stripeConfigured: true, orgId: ORG, billing: null, orgCreatedAt: null, now: NOW });
  assert.equal(d.entitled, true);
  assert.equal(d.reason, "grandfathered");
});

test("a lapsed subscription is not entitled even inside the courtesy window", () => {
  const d = decideEntitlement({
    stripeConfigured: true,
    orgId: ORG,
    billing: { status: "canceled" },
    orgCreatedAt: daysAgo(2),
    now: NOW,
  });
  assert.equal(d.entitled, false);
  assert.equal(d.reason, "canceled");
});

test("an active subscription entitles regardless of org age", () => {
  const d = decideEntitlement({
    stripeConfigured: true,
    orgId: ORG,
    billing: { status: "active" },
    orgCreatedAt: daysAgo(400),
    now: NOW,
  });
  assert.equal(d.entitled, true);
});
