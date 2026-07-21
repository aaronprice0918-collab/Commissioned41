# MissionOS Lite — Adversarial Math Audit

**Date:** July 5, 2026
**Scope:** `lib/money/engine.ts`, `lib/money/types.ts`, `lib/payplan/calc.ts`, `lib/payplan/plans.ts`, `lib/engine.ts`, `lib/fni.ts`, `lib/coach.ts`
**Method:** Every exported function's output was recomputed by hand and compared against actual execution (`npx tsx`, run from repo root, in three timezones: `America/New_York`, `UTC`, `Australia/Sydney`). Nothing below is asserted without a runnable reproduction. Baseline: the existing test suite passes 122/122 — none of these bugs are covered by it.
**Verification scripts** (throwaway, re-runnable): `audit-money.ts`, `audit-utc.ts`, `audit-calc.ts`, `audit-engine.ts`, `audit-rest.ts` in the session scratchpad; ~221 assertions executed, all findings reproduced.

**Bottom line: 3 breaks-money bugs, 1 moderate, 5 cosmetic. Everything else checked out — the verified-correct list is at the end.**

---

## BREAKS-MONEY

### BUG 1 — `iso()` mixes UTC and local time; money numbers flip a month early every evening
**Where:** `lib/money/engine.ts:19-21` (`iso()` uses `toISOString()` = UTC), consumed at `:58` (`upcomingChecks`), `:86-87` (`thisMonth` / `remainingCount`), `:90` (`nextCheckDate`).
All `Date` objects are constructed in **local** time (`new Date(y, m, d)`), then compared/labeled through **UTC** strings. Any timezone that isn't UTC gets wrong answers in a daily window.

**Repro A — Eastern Time (Aaron's timezone), last day of month, 9:00 pm:**
```
TZ=America/New_York; now = new Date(2026, 6, 31, 21, 0)   // Jul 31, 9pm EDT
incomeExpectation(8000, 0, [15, 30], now)
  → { remainingThisMonth: 8000, nextCheckDate: '2026-08-15', nextCheckAmount: 4000 }
CORRECT: remainingThisMonth = 0 (both July checks already landed)
safeToSpend(...)  → projectedMonthEnd: 12950
CORRECT:            projectedMonthEnd ≈ 4950
```
At 9pm EDT it is already Aug 1 in UTC, so `iso(now)` returns `"2026-08-01"`; the function silently treats **next month's** checks as "remaining this month." Control at 10:00 am same day returns the correct 0 / 4950. Every day from 8pm to midnight EDT (7pm–midnight EST), the "this month" attribution is one month ahead; the dollar distortion is worst at month boundaries (**+$8,000 in this repro**). On payday evenings the same shift drops today's check a day early (`9pm on Jul 15, payday [15] → remainingThisMonth 0, next check Aug 15`).

**Repro B — UTC-positive timezones (mirror image):**
```
TZ=Australia/Sydney; now = new Date(2026, 7, 1, 9, 0)      // Aug 1, 9am local
incomeExpectation(8000, 0, [15, 30], now)
  → { remainingThisMonth: 0, ... }        CORRECT: 8000 (both Aug checks remain)
```
A full month of expected income vanishes for the first ~10–14 hours of every month. Additionally, **every date label shifts one day early**: payday 15 renders as `2026-07-14`, the cash curve starts on yesterday's date, a day-1 rent bill is labeled `2026-07-31`.

**Verified control:** all values correct under `TZ=UTC`.
**Blast radius:** `incomeExpectation`, `safeToSpend` (projectedMonthEnd), `cashFlow` (event/point dates), `moneyBrief`, `evaluatePurchase` — the entire Money area.
**Fix direction:** build `iso()` from local fields (`getFullYear/getMonth/getDate`), never `toISOString()`, and compare "same month" with local getters.

### BUG 2 — `makePlan` silently drops `guaranteeFloor`; parsed/migrated plans lose their guarantee
**Where:** `lib/payplan/plans.ts:6-28`. The constructed object copies every `PayPlan` field **except** `guaranteeFloor`.
**Who feeds it a guarantee:** the AI pay-plan parser (`app/api/parse-payplan/route.ts:143`, `guaranteeFloor: p.guaranteeFloor || undefined`) and the legacy comp migration (`lib/store.tsx:37`, `guaranteeFloor: comp.guarantee || undefined`). Both pass it in; `makePlan` throws it away.

**Repro:**
```
makePlan({ role: "x", base: { perUnit: 100 }, guaranteeFloor: 2500 }).guaranteeFloor
  → undefined                                   EXPECTED: 2500
calculatePay(thatPlan, { units: 3, ... }).grossPay
  → 300                                         EXPECTED: 2500 (floor applies)
```
The calculator itself is correct — attaching the field manually yields `grossPay 2500` with the proper "Guarantee floor" step (`lib/payplan/calc.ts:194-197`, verified). The field just never survives plan construction. **Any rep whose uploaded plan contains a guarantee sees their slow months forecast below the guarantee.** Hand-edits through PlanEditor survive (it patches the plan object directly), which makes the loss intermittent and hard to notice.
**Fix direction:** add `guaranteeFloor: p.guaranteeFloor` (and keep it `undefined` when absent) to the object in `makePlan`.

### BUG 3 — Quarterly/yearly bills with a `dayOfMonth` are charged at FULL amount EVERY month
**Where:** `lib/money/engine.ts:122-128`. The branch `if (b.cadence === "monthly" || b.cadence === "quarterly" || b.cadence === "yearly")` pushes the bill each month with `u.bill.amount` = the full amount. The function's own comment (`:114-117`) says non-monthly cadences should land "on their **monthly-equivalent share**."

**Repro:**
```
bill: { name: "insurance", amount: 900, cadence: "quarterly", dayOfMonth: 20 }
billsRemainingTotal(cfg, Jul 10)  → 900        EXPECTED (per comment): 300
cashFlow(..., 45 days) events:
  2026-07-20  "insurance −$900"
  2026-08-20  "insurance −$900"                ← same $900 again next month
```
A $900/quarter bill drains $2,700 per quarter from safe-to-spend and the cash curve ($10,800/yr for a $3,600/yr bill). A yearly $240 bill costs $2,880/yr in the model. Direction is "too conservative" (understates safe-to-spend, sinks the curve), but the numbers are simply wrong, and `evaluatePurchase` will say "no" to purchases the rep can afford.
**Fix direction:** either push the monthly-equivalent share as the comment promises, or track actual due months. Note `totalMonthlyBills`/`monthlySubscriptions` (`:106-112`) already do the share math correctly — the two views currently disagree.

---

## MODERATE

### BUG 4 — `checkNets` are averaged, not aligned per payday
**Where:** `lib/money/engine.ts:80-83`, contradicting `lib/money/types.ts:55-59` ("Known NET amount per check, **aligned with paydays**").
**Repro:**
```
incomeExpectation(0, 0, [15, 30], Jul 10, undefined, [3000, 5000])
  → nextCheckAmount 4000 for BOTH checks       EXPECTED: 3000 on the 15th, 5000 on the 30th
```
Month totals are preserved (8000), but the next-check number the dashboard shows — and every up-tick on the cash curve — is the average, not the actual check. A rep with a $3,000 mid-month check is told $4,000 is landing. Single-value nets work as documented (verified).
**Severity:** moderate — wrong per-check cash timing, right month total.

---

## COSMETIC

### BUG 5 — "Next bill: … in **-1 days**"
**Where:** `lib/money/engine.ts:127` — `daysAway = Math.round((billLocalMidnight − now)/DAY)`. A bill due **today**, viewed after noon, computes −0.6 → rounds to **−1**.
**Repro:** bill `dayOfMonth: 10`, `now = Jul 10, 3:00 pm` → `daysAway: -1`; `moneyBrief` renders `"Next bill: car ($400) in -1 days."` Fix: `Math.max(0, …)` or compare calendar days.

### BUG 6 — `incomeExpectation`'s `bankedPay` parameter is dead code
**Where:** `lib/money/engine.ts:67-93`. The doc block (`:29-31`) says "likely month-end pay **minus what's already banked**," and all four call sites pass `f.current.grossPay` — but the parameter is never referenced in the body (verified: identical output for banked 3000 vs 0). The remaining-paydays count does the pro-rating instead, which is a defensible model, but the signature and docs promise math that doesn't happen. Remove the parameter or use it.

### BUG 7 — `classifyPlan` ignores `perProduct`
**Where:** `lib/payplan/calc.ts:10`. A pure per-product plan (e.g. $50/product, nothing else) classifies `"unknown"` instead of `"flat"`. Pay still computes correctly (verified: 10 products → $500). Label-only impact.

### BUG 8 — `daysToIncome` off by one (UTC parse)
**Where:** `lib/money/engine.ts:161-163`. `new Date("2026-07-15")` parses as UTC midnight; against a local `now` in ET the round loses a day: Jul 10 → Jul 15 yields `daysToIncome 4` (calendar: 5), so `perDay` is slightly overstated. Same root cause family as BUG 1.

### BUG 9 — `money(-0.4)` renders "−$0"
**Where:** `lib/payplan/calc.ts:279-283`. Sub-dollar negatives display as negative zero. Also `goalProgress` returns unclamped negatives for negative `saved` (−50%).

---

## DESIGN OBSERVATIONS (not defects, but confirm intent)

- **Below-grid performance pays the lowest cell** (`calc.ts:20-24`): PVR $800 / PPT 1.0 still earns 9.5% on the Kennesaw grid. If the store pays $0 or a house rate below grid minimums, this overstates pay.
- **`draw.period` is ignored** (`calc.ts:201-204`): the Kennesaw draw is `{amount 8000, period "semimonthly"}` but the offset uses `amount` once. If "semimonthly" means two $8,000 advances, `remainderAfterDraw` overstates the back-half check by $8,000.
- **Share rounding drift:** $1,000 across 3 paydays → 3 × $333 = $999 ($1 lost to rounding).
- **`taxRate: 100` is treated as no tax** (`engine.ts:76` requires `< 100`).
- **`upcomingChecks` scans only 2 months:** a `cashFlow` window > ~60 days would miss later checks (all current callers use 30 — safe today).
- **`nextTiers` rate-bonus entries report `from: 0`** instead of the current PVR/penetration value (`calc.ts:258`).
- **`isThisMonth`/`daysSince` on date-only strings** (`lib/engine.ts:16-19, 94-96`): `"2026-07-01"` parses as UTC midnight → counts as June in US timezones. The app always stores full ISO timestamps (verified in `AddDeal.tsx:139`, `DealDetail.tsx:286`), so this is a latent hazard for imported/hand-built data only.
- **Coach wording:** overdue follow-ups are phrased as due "today" (`coach.ts:41-44`).

---

## VERIFIED CORRECT (recomputed by hand, matched execution exactly)

**`lib/payplan/calc.ts` — `calculatePay` (68 assertions)**
- Kennesaw grid lookups at **every boundary**: PVR exactly 1050/1100/1700 land in the right column; 1099.99 stays left; PPT exactly 2.0/2.2/2.5 land in the right row; float-division thresholds (22 products / 10 units = 2.2) hit the exact row; above-grid clamps to the top cell.
- Full Kennesaw month: 40u / $60k back / 80 products → 13.5% × $60,000 = $8,100 gross; front gross correctly ignored (basis=back); draw offset 8,000, remainder $100; 4 missing metrics flagged; confidence 0.7 − 4×0.06 = 0.46.
- Full penalty month: PVR $2,000 + VSC 60% → 14.5 + 0.5 + 0.5 = 15.5% → $12,400; menu 90 → −5% (−$620); CSI below + 3 consecutive → −(5+3×2)% (−$1,364); 2 uncashed contracts → −$400; grossPay **$10,016** — penalties additive off gross-before-penalty, exactly as documented.
- Condition boundaries: menu exactly 95 → no penalty; 94.99 → penalty. PVR exactly 1900 → no bonus (`gt`); 1900.1 → +0.5. CSI false with consecutive present → no penalty; consecutive 1 → plain 5%.
- Tier logic: best-qualifying-tier-per-metric only (12u → $500, 20u → $2,500, never stacked); threshold `>=` boundary (exactly 10 qualifies); pct tiers (2% of $55k = $1,100); next-tier pointers (9→10 +$500; 10→15 +$1,250).
- Bonuses: flat, pctOfBasis, and addRatePct on both grid and non-grid plans (rate math and effective-rate reporting verified).
- Deductions: flat, pctOfGrossPay, perOccurrence (3 × $100), and missing-metric → skipped + flagged.
- Clamps: negative gross month → $0; deductions past zero → $0; guarantee floor honored **when the field exists**; draw > earnings → offset = earnings, remainder 0; taxRate 25 → netAfterTax 7,500 while `net` stays gross.
- `nextTiers` grid math: PPT 2.0→2.2 and PVR 1500→1600 both +0.5% = +$300 on $60k, sorted, capped at 4.
- `classifyPlan`: grid/tiered/flat/hybrid/unknown all correct (except the perProduct hole, BUG 7).
- `money()`: rounding and negative formatting (except −$0, BUG 9).

**`lib/money/engine.ts` (91 assertions)**
- `resolvePaydays`: legacy scalar, dedupe, sort, 1–31 filter, cap at 4, rounding, junk → [1].
- `monthlyAmount` / `totalMonthlyBills` / `monthlySubscriptions`: all five cadences exact (52/12, 26/12, /3, /12).
- `billsRemaining`: day-31 clamps to Jun 30 and Feb 28; weekly instances (1,8,15,22,29 in July); past-day exclusion; non-monthly without dayOfMonth excluded from date math.
- `incomeExpectation`: 2-payday split, post-payday remaining, taxRate 30 → keep 70%, payday-31 clamping, **Dec → Jan year rollover** (next check 2027-01-25, remaining 0), negative pay clamps to 0, single checkNet propagates to every check, invalid nets fall back to forecast.
- `safeToSpend`: hand math exact (essentials pro-rate 1550×22/31, $500 cushion, bill totals); balance 0 treated as a real balance (not blank); last-day-of-month daysLeft = 1.
- **`projectedMonthEnd` ≡ cash curve's month-end point** (11,480 = 11,480; consistent because both derive from the same `billsRemaining` + check share — verified within $1).
- `cashFlow`: point count, day-0 burn, check up-tick day and amount, next-month rent rollover into the window, empty-config guards; `cashFlowLow` picks the pre-check trough.
- `evaluatePurchase`: **every verdict boundary** — after = exactly 25% of available → clear; one dollar under → tight; after 0 → tight; after < 0 → no; curve-low < 250 (via next month's rent) → tight; curve-low < 0 → no; amount ≤ 0 → null; dealsOfWork = amount/avgPay to 0.1.
- `applyStatementScan`: normalized-name dedupe (Netflix ≡ netflix), invalid bills filtered, typed balance/essentials never overwritten, blank filled from scan, balance 0 preserved, balanceAsOf set only on fill.
- `goalProgress`: 50%, cap at 100, target 0 → 0.

**`lib/engine.ts` / `lib/fni.ts` / `lib/coach.ts` (62 assertions)**
- `monthBounds`: Feb non-leap (28) and leap (29), Dec 31, mid-month.
- `isThisMonth`: full-ISO deals correct at month boundaries including an 11pm-local Jul 31 deal (stored ISO crosses UTC midnight — still July locally).
- `dealTotals`/`perfFromDeals`: sums, per-unit ratios, empty array → zeros, NaN/undefined guarded to 0.
- `workingDays`: no-daysOff shortcut, Sundays-off (27 in July 2026), Sat+Sun (23), partial month, upToDay 0.
- `forecast`: counted/pipeline split (dead + other-month excluded); current/best exact; **likely stage-weighting exact** (2000×0.8 + 1000×0.1); pace formula exact (Jul 10 noon → workedSoFar 9.5 → 7 units → $1,750); day-1 00:30 divide-by-zero guard; Sunday-off todayFraction 0; confidence formula to 9 decimals.
- `followUpQueue`: overdue/dueToday boundary at local midnight, scheduled sort, goingCold ≥ 4 days, delivered/dead excluded, needsYou sum. `daysSince` floor + future-clamp.
- `fni`: dealUnits (menu, legacy addons fallback, unknown-id → 1, weighted bundles), spiffTotal, penetration (incl. empty-deals NaN guard), salespersonReport (50/50 splits, whitespace/case name merging, noQualify = unit kept + $0 gross, per-unit ratio, sort order), moneyBasis (grid-back / front-only / back-only / mixed / null), dealMoneyOf all three bases.
- `coach`/`todaysMission`: no crash on empty deals, insight cap 5, next-tier hint wired to real +$ numbers, pace/goal wording, follow-up counts.

---

## SEVERITY TALLY

| # | Finding | Severity |
|---|---------|----------|
| 1 | `iso()` UTC/local mix — month flips every evening (ET), all dates −1 day (UTC+) | **breaks-money** |
| 2 | `makePlan` drops `guaranteeFloor` — parsed/migrated plans lose the guarantee | **breaks-money** |
| 3 | Quarterly/yearly bills charged full amount every month | **breaks-money** |
| 4 | `checkNets` averaged instead of per-payday | moderate |
| 5 | "Next bill in −1 days" | cosmetic |
| 6 | Dead `bankedPay` parameter vs docs | cosmetic |
| 7 | `classifyPlan` ignores perProduct | cosmetic |
| 8 | `daysToIncome` UTC off-by-one | cosmetic |
| 9 | `money(−0.4)` → "−$0"; goalProgress unclamped negative | cosmetic |
