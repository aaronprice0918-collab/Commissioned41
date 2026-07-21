import test from "node:test";
import assert from "node:assert/strict";
import { periodFor, periodsBetween, filterToPeriod, CALENDAR_MONTH_CYCLE } from "./payCycle.ts";
import type { PayCycle } from "./payEngine.ts";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const on = (s: string) => new Date(`${s}T12:00:00`);

test("calendar month: full month window + label", () => {
  const p = periodFor(CALENDAR_MONTH_CYCLE, on("2026-05-15"));
  assert.equal(iso(p.start), "2026-05-01");
  assert.equal(iso(p.end), "2026-05-31");
  assert.equal(p.label, "May 2026");
  assert.equal(iso(p.payDate), "2026-05-31"); // no offset → paid at close
});

test("fixed-length weekly: tiles from the anchor + earned-vs-paid offset", () => {
  const cycle: PayCycle = { mode: "fixedLength", anchor: "2026-01-05", lengthDays: 7, payOffsetDays: 5 };
  const p = periodFor(cycle, on("2026-01-08"));
  assert.equal(iso(p.start), "2026-01-05");
  assert.equal(iso(p.end), "2026-01-11");
  assert.equal(iso(p.payDate), "2026-01-16"); // end + 5 days
  // A date two weeks out lands in the correct later tile.
  const p2 = periodFor(cycle, on("2026-01-15"));
  assert.equal(iso(p2.start), "2026-01-12");
  assert.equal(iso(p2.end), "2026-01-18");
});

test("biweekly: 14-day windows", () => {
  const cycle: PayCycle = { mode: "fixedLength", anchor: "2026-01-05", lengthDays: 14 };
  const p = periodFor(cycle, on("2026-01-20"));
  assert.equal(iso(p.start), "2026-01-19");
  assert.equal(iso(p.end), "2026-02-01");
});

test("semi-monthly: three branches around the split days", () => {
  const cycle: PayCycle = { mode: "semiMonthly", semiMonthlyDays: [6, 21] };
  // Before the first split → trailing period of the previous month.
  const a = periodFor(cycle, on("2026-06-03"));
  assert.equal(iso(a.start), "2026-05-21");
  assert.equal(iso(a.end), "2026-06-05");
  // Between the splits.
  const b = periodFor(cycle, on("2026-06-10"));
  assert.equal(iso(b.start), "2026-06-06");
  assert.equal(iso(b.end), "2026-06-20");
  // After the second split → to end of month.
  const c = periodFor(cycle, on("2026-06-25"));
  assert.equal(iso(c.start), "2026-06-21");
  assert.equal(iso(c.end), "2026-06-30");
});

test("quarterly: quarter window + label", () => {
  const p = periodFor({ mode: "quarterly" }, on("2026-08-10"));
  assert.equal(iso(p.start), "2026-07-01");
  assert.equal(iso(p.end), "2026-09-30");
  assert.equal(p.label, "Q3 2026");
});

test("custom boundaries: window runs to the day before the next boundary", () => {
  const cycle: PayCycle = { mode: "custom", customBoundaries: ["2026-01-01", "2026-02-15", "2026-04-01"] };
  const p = periodFor(cycle, on("2026-03-01"));
  assert.equal(iso(p.start), "2026-02-15");
  assert.equal(iso(p.end), "2026-03-31");
  // Past the final boundary: window is deterministic (mirrors the prior length).
  const last = periodFor(cycle, on("2026-05-01"));
  assert.equal(iso(last.start), "2026-04-01");
  assert.ok(last.end.getTime() >= last.start.getTime());
});

test("payDayOfNextPeriod: monthly plan paid on the 5th of the next month", () => {
  const cycle: PayCycle = { mode: "calendarMonth", payDayOfNextPeriod: 5 };
  const p = periodFor(cycle, on("2026-05-15"));
  assert.equal(iso(p.end), "2026-05-31");
  assert.equal(iso(p.payDate), "2026-06-05");
});

test("filterToPeriod: keeps only rows dated within the window", () => {
  const p = periodFor(CALENDAR_MONTH_CYCLE, on("2026-05-15"));
  const rows = [{ date: "2026-04-30" }, { date: "2026-05-01" }, { date: "2026-05-31" }, { date: "2026-06-01" }];
  const kept = filterToPeriod(rows, (r) => r.date, p);
  assert.deepEqual(kept.map((r) => r.date), ["2026-05-01", "2026-05-31"]);
});

test("periodsBetween: enumerates weekly windows across a span", () => {
  const cycle: PayCycle = { mode: "fixedLength", anchor: "2026-01-01", lengthDays: 7 };
  const periods = periodsBetween(cycle, on("2026-01-01"), on("2026-01-28"));
  assert.equal(periods.length, 4); // four full weeks
  assert.equal(iso(periods[0].start), "2026-01-01");
  assert.equal(iso(periods[3].start), "2026-01-22");
});

test("semi-monthly payday lands AFTER the period closes (day N of the NEXT period)", () => {
  const cycle: PayCycle = { mode: "semiMonthly", semiMonthlyDays: [1, 16], payDayOfNextPeriod: 5 } as PayCycle;
  const p = periodFor(cycle, on("2026-06-10")); // Jun 1–15
  assert.equal(iso(p.end), "2026-06-15");
  // Day 5 counted within the next period (starts Jun 16) = Jun 20 — the old
  // month-anchored math returned Jun 5, BEFORE the period even ended.
  assert.equal(iso(p.payDate), "2026-06-20");
  assert.ok(p.payDate.getTime() > p.end.getTime());
});
