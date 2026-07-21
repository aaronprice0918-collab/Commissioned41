import test from "node:test";
import assert from "node:assert/strict";
import { buildDeal, importMismatches, linearizeExpandedLog, type ParsedDeal } from "./dealImport.ts";

// ── linearizeExpandedLog ─────────────────────────────────────────────────────
// A synthetic paste in the mobile "expanded rows" shape that scattered a real
// July log across one-field-per-line (same structure, fake people).
const EXPANDED = `N
New
1501
7/1/26
7/2/26
F
1
SMITH
1887000
CAR
2026
MA
MAZDA3 5
ALEX SELLER
FINANCE ONE
1
2,022
-
3,907
750
4,657
MOBILITYON
75
Expand N
N
New
1502
7/2/26
7/6/26
F
4
JOHNSON
131000
TRUCK
2026
MA
CX-5
ALEX SELLER
FINANCE TWO
1
350
-
2,400
(2,251)
149
MOBILITYON
36
Expand U
U
Used
1503
7/3/26

E
5
GARCIA
DP0100
TRUCK
2023
MA
CX-30
BRETT SELLER
FINANCE ONE
1
-
-
-
(1,506)
(1,506)
CASH DEAL
1
Expand N
N
New
1504
7/8/26

C
1
LEE
1882000
CAR
2026
MA
MAZDA3 5
CASEY SELLER
FINANCE TWO
1
-
-
-
(1,949)
(1,949)
CASH DEAL
1`;

test("linearize groups the expanded phone-layout paste into one line per deal", () => {
  const out = linearizeExpandedLog(EXPANDED);
  assert.ok(out, "expanded format should be detected");
  const lines = out!.split("\n");
  assert.equal(lines.length, 4, "four records");
  for (const line of lines) assert.ok(line.startsWith("DEAL ROW: "), "each record is one DEAL ROW line");
  // Whole deal on one line: customer, money, and lender travel together.
  assert.match(lines[0], /SMITH/);
  assert.match(lines[0], /4,657/);
  assert.match(lines[0], /MOBILITYON/);
  // The "Expand U" glue means the Used record still starts cleanly.
  assert.match(lines[2], /^DEAL ROW: U \| Used \| 1503/);
  assert.match(lines[2], /GARCIA/);
  // Nothing leaks across records.
  assert.doesNotMatch(lines[0], /JOHNSON/);
  assert.doesNotMatch(lines[3], /GARCIA/);
  // UI chrome is gone.
  assert.doesNotMatch(out!, /Expand/);
});

test("linearize leaves a normal CSV alone", () => {
  const csv = `Deal #,Date,Customer,Front,Back,Total
1501,7/1/26,SMITH,750,3907,4657
1502,7/2/26,JOHNSON,-2251,2400,149
1503,7/3/26,GARCIA,-1506,0,-1506
1504,7/8/26,LEE,-1949,0,-1949`;
  assert.equal(linearizeExpandedLog(csv), null);
});

test("linearize leaves a rough phone dump alone (too few record starts)", () => {
  const dump = `did 3 cars today
N
New
1501 smith mazda3 750 front
loved the process`;
  assert.equal(linearizeExpandedLog(dump), null);
});

// ── importMismatches ─────────────────────────────────────────────────────────
function raw(overrides: Partial<ParsedDeal>): ParsedDeal {
  return { customer: "SMITH", ...overrides };
}

test("a row whose extraction reproduces the printed total passes", () => {
  const rows = [raw({ frontGross: 750, backGross: 3907, totalGross: 4657 })];
  const built = rows.map(buildDeal);
  assert.deepEqual(importMismatches(built, rows), []);
});

test("a number in the wrong column is caught", () => {
  // Parse swapped front/back magnitude: printed total says 4,657 but the
  // extraction only accounts for 750 + 750.
  const rows = [raw({ frontGross: 750, backGross: 750, totalGross: 4657 })];
  const built = rows.map(buildDeal);
  const out = importMismatches(built, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].customer, "SMITH");
  assert.equal(out[0].expected, 4657);
  assert.equal(out[0].got, 1500);
});

test("negative-front rows reconcile (parentheses deals)", () => {
  const rows = [raw({ customer: "JOHNSON", frontGross: -2251, backGross: 2400, totalGross: 149 })];
  const built = rows.map(buildDeal);
  assert.deepEqual(importMismatches(built, rows), []);
});

test("source rounding of ±$1 is tolerated", () => {
  const rows = [raw({ frontGross: -1336, backGross: 972, totalGross: -365 })]; // adds to -364
  const built = rows.map(buildDeal);
  assert.deepEqual(importMismatches(built, rows), []);
});

test("doc fee counts toward the printed total", () => {
  const rows = [raw({ frontGross: 1000, backGross: 2000, docFee: 799, totalGross: 3799 })];
  const built = rows.map(buildDeal);
  assert.deepEqual(importMismatches(built, rows), []);
});

test("rows without a printed total are not judged", () => {
  const rows = [raw({ frontGross: 123, backGross: 456 })];
  const built = rows.map(buildDeal);
  assert.deepEqual(importMismatches(built, rows), []);
});
