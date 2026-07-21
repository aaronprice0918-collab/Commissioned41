import { strict as assert } from "node:assert";
import test from "node:test";
import { firstTouchDraft } from "./firstTouch";

test("web lead with vehicle: personal, specific, one question", () => {
  const d = firstTouchDraft(
    { customerFirstName: "Sarah", vehicle: "2026 CX-5 Premium", source: "Website" },
    "Bo Tshuma",
    "Kennesaw Mazda"
  );
  assert.ok(d.startsWith("Hi Sarah, this is Bo at Kennesaw Mazda"));
  assert.ok(d.includes("2026 CX-5 Premium"));
  assert.ok(d.includes("?"));
  assert.ok(d.length < 300); // it's a text, not a letter
});

test("source changes the opener", () => {
  const lead = { customerFirstName: "Jim", vehicle: "MX-5", source: "Phone Up" };
  assert.ok(firstTouchDraft(lead, "Bo", "Kennesaw Mazda").includes("your call"));
  assert.ok(firstTouchDraft({ ...lead, source: "Referral" }, "Bo", "Kennesaw Mazda").includes("heard you might be looking"));
  assert.ok(firstTouchDraft({ ...lead, source: "Walk-in" }, "Bo", "Kennesaw Mazda").includes("great meeting you"));
});

test("missing everything still reads like a human", () => {
  const d = firstTouchDraft({}, "", "");
  assert.ok(d.startsWith("Hi, this is your contact at the store"));
  assert.ok(d.includes("the car you asked about"));
  assert.ok(d.includes("?"));
});

test("falls back to full-name first word and no vehicle question", () => {
  const d = firstTouchDraft({ customer: "Maria Gonzalez Lopez", source: "Website" }, "Aaron Price", "Kennesaw Mazda");
  assert.ok(d.startsWith("Hi Maria, this is Aaron at Kennesaw Mazda"));
  assert.ok(d.includes("What are you hoping to find"));
});
