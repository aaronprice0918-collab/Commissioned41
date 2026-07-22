import { strict as assert } from "node:assert";
import test from "node:test";
import { scoreSentiment } from "./textIntelligence";

test("rejections score COLD, not HOT — the pounce-on-a-no bug", () => {
  // The original checked HOT first, so "not interested" matched \binterested\b
  // and scored HOT, nudging the rep to pounce on someone who just said no.
  for (const body of ["not interested", "not interested, thanks", "I'm not ready", "no longer interested", "not looking anymore"]) {
    assert.equal(scoreSentiment(body).label, "cold", `"${body}" should be cold`);
  }
});

test("genuine enthusiasm still scores HOT (no false colds)", () => {
  for (const body of ["can't wait!", "yes I'm interested", "when can I come in?", "let's do it", "sounds good, what time are you open?"]) {
    assert.equal(scoreSentiment(body).label, "hot", `"${body}" should be hot`);
  }
});

test("explicit STOP scores stop; price talk is warm; silence-ish is neutral", () => {
  assert.equal(scoreSentiment("STOP").label, "stop");
  assert.equal(scoreSentiment("how much is the payment?").label, "warm");
  assert.equal(scoreSentiment("ok").label, "neutral");
});

test("cold rejections about money score cold", () => {
  assert.equal(scoreSentiment("too expensive for me").label, "cold");
  assert.equal(scoreSentiment("can't afford that").label, "cold");
});
