import { test } from "node:test";
import assert from "node:assert/strict";
import { isBrainSafeLesson } from "./brainScrub.ts";

test("brain scrub keeps generic craft lessons", () => {
  assert.equal(isBrainSafeLesson("Isolating the payment objection before answering it keeps the deal alive."), true);
  assert.equal(isBrainSafeLesson("Ask for the appointment twice before accepting a maybe."), true);
});

test("brain scrub drops lessons carrying verbatim identifiers", () => {
  assert.equal(isBrainSafeLesson("Askew wanted to keep his payment under $450 a month."), false); // $ figure
  assert.equal(isBrainSafeLesson("Call the customer back at 770-555-1234."), false); // phone
  assert.equal(isBrainSafeLesson("Follow up on VIN JM1BL1V37D1734567 tomorrow."), false); // VIN
  assert.equal(isBrainSafeLesson("Email bob@dealer.com about the trade."), false); // email
  assert.equal(isBrainSafeLesson("The store did 1,250,000 in gross last month."), false); // grouped number
});
