import { strict as assert } from "node:assert";
import test from "node:test";
import { customerStatusLine, docsToBring, makeShareToken, nextSteps, parseShareToken } from "./yourDeal";

test("share token: orgId routes, secret is 32 hex chars, parse round-trips", () => {
  const orgId = "00000000-0000-0000-0000-000000000001";
  const token = makeShareToken(orgId);
  const parsed = parseShareToken(token);
  assert.ok(parsed);
  assert.equal(parsed!.orgId, orgId);
  assert.match(parsed!.secret, /^[0-9a-f]{32}$/);
  // Two tokens never collide
  assert.notEqual(makeShareToken(orgId), token);
});

test("parseShareToken rejects garbage and truncated secrets", () => {
  assert.equal(parseShareToken(""), null);
  assert.equal(parseShareToken("not-a-token"), null);
  assert.equal(parseShareToken("00000000-0000-0000-0000-000000000001.abc"), null);
});

test("customer status lines are customer words, never desk-speak", () => {
  assert.ok(customerStatusLine("Desking").includes("finalized"));
  assert.ok(customerStatusLine("Won").toLowerCase().includes("congratulations"));
  assert.ok(!customerStatusLine("Desking").toLowerCase().includes("desk"));
});

test("docs to bring follow the deal: trade adds title + keys, payoff adds account number", () => {
  const base = { status: "Working" as const, driversLicense: "", insuranceCompany: "", tradeDetails: "", tradeYear: "", payoff: 0 };
  assert.equal(docsToBring(base).length, 2); // license + insurance
  const withTrade = docsToBring({ ...base, tradeYear: "2021", payoff: 12000 });
  assert.ok(withTrade.some((d) => d.includes("title or payoff")));
  assert.ok(withTrade.some((d) => d.includes("keys")));
  assert.ok(withTrade.some((d) => d.includes("account number")));
  const inFinance = docsToBring({ ...base, status: "In Finance" });
  assert.ok(inFinance.some((d) => d.includes("income")));
});

test("next steps change with the stage", () => {
  assert.ok(nextSteps({ status: "Won", appointment: "" })[0].includes("Enjoy"));
  assert.ok(nextSteps({ status: "Appointment Set", appointment: "2026-07-14T10:00" })[0].includes("scheduled time"));
});
