import { strict as assert } from "node:assert";
import test from "node:test";
import { nextFireTime, advanceCadence, startCadence, cadenceSteps } from "./followUpCadence";

// Renders an instant as the hour it lands on in Eastern time.
function hourET(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date(iso)),
  );
}

test("nextFireTime anchors 10am EASTERN, not 10am UTC (the pre-dawn-text bug)", () => {
  // A cadence started at any time of day, day-0 step, must fire at 10am ET —
  // the old setHours(10) ran in UTC on Vercel, firing ~5am ET.
  const fire = nextFireTime("2026-07-15T23:30:00.000Z", { day: 0, intent: "x", channel: "text" });
  assert.equal(hourET(fire), 10, "should be 10am Eastern");
});

test("nextFireTime advances by the step's day offset", () => {
  const start = "2026-07-15T14:00:00.000Z";
  const day0 = nextFireTime(start, { day: 0, intent: "x", channel: "text" });
  const day3 = nextFireTime(start, { day: 3, intent: "x", channel: "text" });
  const gapDays = (new Date(day3).getTime() - new Date(day0).getTime()) / 86_400_000;
  assert.equal(Math.round(gapDays), 3);
  assert.equal(hourET(day3), 10);
});

test("advanceCadence walks steps then completes; next fire stays 10am ET", () => {
  let c = startCadence("post_quote", "EILA"); // 3 steps
  assert.equal(c.currentStep, 0);
  assert.equal(hourET(c.nextFireAt), 10);
  const steps = cadenceSteps(c);
  for (let i = 1; i < steps.length; i++) {
    c = advanceCadence(c);
    assert.equal(c.currentStep, i);
    assert.equal(c.status, "active");
    assert.equal(hourET(c.nextFireAt), 10);
  }
  c = advanceCadence(c); // past the last step
  assert.equal(c.status, "completed");
});
