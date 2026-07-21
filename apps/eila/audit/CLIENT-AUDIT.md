# MissionOS Lite — Adversarial Client/State Audit

**Date:** 2026-07-05 · **Auditor:** Claude (adversarial pass, every line of the scoped files read)
**Baseline:** `npx tsc --noEmit` → clean (exit 0). `npx vitest run` → 8 files, 122 tests, all pass.
**Method:** full read of lib/store.tsx, lib/migrate.ts, lib/types.ts, lib/ila-hands.ts, lib/ila-tools.ts, lib/money/{types,engine}.ts, components/{IlaChat,MoneyDashboard,AddDeal,Settings,AppShell,Onboarding}.tsx, lib/biometric.ts, lib/push.ts, app/*/page.tsx gating, components/ui.tsx (Sheet, parseNumericInput), lib/fni.ts, lib/supabase.ts — plus throwaway `tsx` scripts run against the pure functions (migrate, money engine, closure simulation) and inspection of the installed `@supabase/auth-js` to verify which events actually fire. Nothing below is reported unproven; each finding says how it was verified.

Severity scale: **DATA-LOSS** > **CRASH** > **MATH** (wrong numbers, data intact) > **COSMETIC**.

---

## DATA-LOSS findings

### DL-1 (CRITICAL) — A failed cloud pull at sign-in overwrites the cloud row with local (often empty) data
**store.tsx:210–218.**
```ts
const { data: row } = await sb.from(STATE_TABLE).select("data").eq("user_id", user.id).maybeSingle();
const remote = (row as ...)?.data;
if (remote?.profile) { writeLocal(ensurePlan(remote)); }
else { await sb.from(STATE_TABLE).upsert({ user_id: user.id, data: dataRef.current, ... }); }
```
supabase-js/postgrest-js does **not throw** on query failure — it *resolves* with `{ data: null, error }`. The code destructures only `data` and never checks `error`, so **any transient failure of the SELECT (network blip, 5xx, timeout) is indistinguishable from "new user with no cloud data"** and falls into the else-branch, which upserts `dataRef.current` over the cloud row. On a fresh browser that is `{ profile: null, deals: [] }` — the user's entire cloud book of business is replaced with an empty blob by one bad request at sign-in. The surrounding try/catch is dead weight for this path because the client doesn't reject.
**Repro chain:** fresh device → sign in → SELECT fails (airplane-mode flicker is enough) → cloud row wiped. Verified by reading postgrest-js's non-throwing contract (queries resolve with `error` populated) + the absence of any `error` check at this call site.
**Fix shape:** destructure `error`; on error, abort the sync (retry later) — never take the seed-empty branch. Only seed when the SELECT *succeeded* and returned no row.

### DL-2 (HIGH) — ILA running two "hands" tools in one turn silently reverts the first change (localStorage + cloud)
**store.tsx:226–252 (api useMemo) + IlaChat.tsx:148–155 (tool loop).**
Every store mutator spreads the `data` captured when the `useMemo` was built:
`updateDeal: (id, patch) => persist({ ...data, deals: data.deals.map(...) })`.
`IlaChat.send()` destructures `updateDaysOff/updateProducts/updateDeal/updateMoney` **once** and holds those references for the entire multi-round turn. `dealsNow`/`profileNow` correctly thread state for *ILA's view*, but each store call recomputes `next` from the same stale render-time `data`. Two tool calls in one turn that touch different slices → the second `persist` is built from pre-first-call data and **overwrites the first change** in React state, localStorage, and the (debounced, last-write-wins) cloud push.
**Proven by simulation** (`scratchpad/verify2-clobber.ts`, faithful to the closure semantics):
- `update_deal` ("mark Johnson delivered") then `upsert_bill` ("add my $210 insurance") → deal reverts to *working*.
- Two `update_deal` calls in one turn → the first deal's patch is lost.
- `set_days_off` + `update_products` in one turn → daysOff lost (both write `profile` but each spreads the stale `data.profile`).
- **Safe combos:** repeated money tools (`update_money`/`upsert_bill`/`update_goal`) — ila-hands builds the *complete* MoneyConfig from the threaded `profileNow` and writes it whole, so consecutive money writes compose correctly.
This is a live user-visible bug: the guidance prompt (ila-tools.ts:170–177) explicitly encourages multi-fix turns, and multi-round loops (MAX_TOOL_ROUNDS=4) hit the same stale closures.
**Fix shape:** make every store mutator use functional updates (`setData(prev => …)` and persist the computed `prev`-based value via a ref), or have persist read `dataRef.current` as its base.

### DL-3 (HIGH) — Multi-device sync never pulls after the first sign-in; whole-blob last-writer-wins erases the other device's work
**store.tsx:199–224.** The cloud→device pull runs **only** on the `SIGNED_IN` auth event. Verified against the installed `@supabase/auth-js` (v2.108 dist): a page load with a persisted session emits `INITIAL_SESSION`, *not* `SIGNED_IN`; visibility/refresh paths emit `TOKEN_REFRESHED`. So a phone PWA that stays signed in **never pulls cloud changes again**. Every local edit pushes the *entire* blob (store.tsx:191). Sequence: desktop logs 10 deals (pushed fine) → phone, still holding last week's blob, logs one deal → phone pushes its whole stale blob → **desktop's 10 deals vanish from the cloud**, and the desktop only finds out if it ever re-signs-in. No timestamp/merge check exists (`updated_at` is written but never compared).
Corollary (same lines): even on a genuine sign-in, "cloud wins" unconditionally — a user who worked signed-out for a week and then signs in has that week replaced by the older cloud copy, no warning.
**Fix shape:** pull on `INITIAL_SESSION`/app-foreground as well, and compare `updated_at` (or merge per-deal) before either side clobbers the other.

### DL-4 (MEDIUM) — Shared device: a brand-new account gets seeded with the previous user's entire dataset
**store.tsx:217 + signOut (store.tsx:282).** `signOut` calls `relock()` but leaves localStorage (`missionos-lite-v1`) and in-memory `data` intact. If a *different* person then creates an account on that device, the sign-in handler finds no cloud profile and upserts `dataRef.current` — the previous rep's deals, money picture (balance, bills), and ILA memories — into the **new** user's cloud row. Data corruption for the new user and a privacy leak of the old user's finances. Verified by code path; no state clearing exists anywhere on sign-out.
**Fix shape:** clear (or namespace by user id) local state on sign-out, or refuse the seed-upsert when the local blob's profile predates the new account.

### DL-5 (MEDIUM) — Debounced push is never flushed or checked: edits in the last 600 ms before sign-out are silently dropped, and *all* push failures are invisible
**store.tsx:186–194, 282.**
1. `pushRemote` schedules the upsert 600 ms out; `signOut` neither flushes nor cancels the timer. An edit made just before tapping "Sign out" fires *after* the session is destroyed → the upsert fails RLS → the edit never reaches the cloud (and DL-3 means it won't be pushed later either if the user moves devices).
2. The upsert result is not checked: supabase resolves with `{ error }` instead of throwing, so `catch (e) { console.error("[sync] push failed") }` is unreachable for RLS/permission/HTTP errors. A user whose pushes fail every time (expired session, RLS change) sees the "Synced" badge in Settings (badge = `account` truthy, Settings.tsx:44–47) while nothing has synced for weeks.
**Fix shape:** check `.error` on the upsert, surface a sync-failure state, and flush the pending timer before `signOut()`.

### DL-6 (LOW, by-design but sharp-edged) — resetAll erases the cloud too, via the same unflushed debounce
**store.tsx:267 + Settings.tsx:127.** "Erase your profile and all deals?" → `persist({ profile: null, deals: [] })` → 600 ms later the empty blob is pushed to the cloud row. That matches the confirm text ("all data"), but: (a) if the user closes the tab within 600 ms the cloud still has everything (reset didn't take remotely — surprise restore on next sign-in), and (b) there is no second-level warning that *other devices* will be emptied. Documented here so it's a decision, not an accident. Also verified: `resetAll` correctly drops `ilaMemories` (key omitted → undefined).

---

## CRASH findings

### CR-1 (LOW likelihood, app-wide crash) — Migrations never guarantee `deals` is an array
**migrate.ts:13–14 + store.tsx:46–54, 176, 215.** `ensureDeals` returns the blob untouched when `deals` is missing/non-array (**verified by script**: `{ profile, deals: undefined }` passes straight through), and `ensurePlan` adds no guard. Both load paths (localStorage parse at store.tsx:176, cloud pull at store.tsx:215) will then commit `data.deals === undefined`, and the first render dies: AppShell.tsx:34 `data.deals.filter(...)`, Dashboard, `setProfile`'s `data.deals.length`, etc. Trigger requires a malformed stored blob (hand-edited row, partial write, another client version) — improbable but the blast radius is "app won't open until storage is cleared."
**Fix shape:** in `ensurePlan`/`ensureDeals`, coerce `deals: Array.isArray(deals) ? deals : []` (and `profile ?? null`).

### CR-2 (THEORETICAL) — Legacy deal shapes with only `backGross`/`type` skip migration → NaN math, undefined fields
**migrate.ts:21.** The migrate trigger is `vehicle !== undefined || frontGross !== undefined || legacy products-count`. **Verified by script:** a deal carrying only `backGross` (or only `type`) is returned unmigrated — `amount/secondary/addons/reserve` stay `undefined` and flow into the pay engine as NaN. Mitigating: the legacy AddDeal always wrote `vehicle` (even `""`, which triggers migration since `"" !== undefined`), so no real historical record should hit this. Kept on record because the guard is narrower than the field set it migrates.

*(No other crash paths found: every page under app/ that renders AppShell gates on `ready && data.profile` before mounting — verified in page.tsx, money, pipeline, stats, followup, finance (role-gated too), deal/[id]. `MoneyDashboard`'s `data.profile!` is safe behind that gate. All `money` field reads are behind `?? defaultMoneyConfig()` or optional chaining; every writer constructs a complete MoneyConfig.)*

---

## MATH findings (wrong numbers, data intact)

### M-1 — Quarterly/yearly bills with a `dayOfMonth` are charged at FULL amount every month
**money/engine.ts:118–144.** The comment promises non-monthly cadences land "on their monthly-equivalent share only when a dayOfMonth is set," but the monthly/quarterly/yearly branch pushes `u.bill.amount` — the **full** amount — and `billsRemaining` has no month-anchor, so a $1,200 yearly premium with day 20 is subtracted from safe-to-spend and plotted on the cash curve **every single month** (verified by script: July 5 → full $1,200 in `billsRemainingTotal`, again next month). Safe-to-spend can be understated by thousands for reps with 6-month insurance premiums — exactly the audience. Weekly/biweekly handling is correct.
**Fix shape:** either charge `monthlyAmount(bill)` on the date (matching the comment) or store an anchor month.

### M-2 — Statement-scan dedupe misses real bank naming → duplicate bills, double-counted
**money/engine.ts:243–246.** Dedupe is *exact* normalized-name equality (`Set.has`), while ILA's `upsert_bill` matcher (ila-hands.ts:169) deliberately uses bidirectional substring matching. **Verified by script:** hand-typed "Netflix" + scanned "NETFLIX.COM" → both kept → bills/month and safe-to-spend double-count it. Re-scanning the *same* statement is safe (identical names dedupe — verified). Real statements virtually always carry decorated payee strings, so first-scan-after-manual-setup is the common case.
**Fix shape:** reuse the substring matcher from upsert_bill.

### M-3 — `incomeExpectation`'s `bankedPay` parameter is dead and its doc is wrong
**money/engine.ts:64–93.** All three real callers (MoneyDashboard.tsx:131, ila-hands.ts:242, ila.ts:72) pass `f.current.grossPay` as "what's already banked," and the JSDoc says income is "likely month-end pay **minus what's already banked**" — but the body never references `bankedPay` (grep-verified: one hit, the parameter itself). The date-based `remainingCount` mechanism is what actually handles already-landed checks, and the 122 tests encode that behavior, so numbers are *internally* consistent — but the parameter and doc actively mislead the next maintainer into "fixing" a double-subtraction. Cosmetic-to-moderate; flagged because a money engine cannot afford ambiguous contracts.

---

## COSMETIC / UX-state findings

- **C-1 — paydaysText can diverge from what saves.** MoneyDashboard.tsx:566–570: typing `45` (or any out-of-range text) leaves the visible field showing "45" while `draft.paydays` silently becomes `undefined` and `payday: days[0]` = `undefined` → after save, the engine's `resolvePaydays(undefined)` defaults to the 1st. The user sees their typing accepted but is modeled as paid on the 1st. (Parse behavior verified by script; `"1st and 15th"` → `[1, 15]` works nicely, `""` correctly clears.)
- **C-2 — checkNets truncated to one value on any edit.** MoneyDashboard.tsx:577–580 reads/writes only `checkNets[0]`; the type documents an aligned-per-payday array. Today nothing writes multiple values (ila-hands also writes `[one]`), so no loss yet — it's a landmine for when multi-check nets ship.
- **C-3 — Entitlement/auth gate exists only on `/`.** money/pipeline/stats/followup/finance/deal pages gate on profile only; a deep-linked unsubscribed (or signed-out) user with a local profile uses the whole local app; ILA/scan APIs are server-gated (401/402 handled in IlaChat.tsx:103). Business-rule leak, not a state bug.
- **C-4 — MAX_TOOL_ROUNDS edge.** IlaChat.tsx:86–180: if round 4 still returns tool calls, they execute but the results are never fed back and ILA never confirms — the turn just ends (the empty trailing bubble is correctly skipped at render, IlaChat.tsx:240–241). Changes ARE applied; the user just gets no closing sentence.
- **C-5 — 60 s watchdog spans the entire multi-round turn** (IlaChat.tsx:63–64) including tool-side fetches; a slow multi-fix turn aborts and shows "Couldn't reach ILA" *after* some fixes already landed. Data applied; message misleading.
- **C-6 — `now` is memoized forever on MoneyDashboard** (line 125) — a tab left open across midnight computes yesterday's safe-to-spend until remount.
- **C-7 — Settings sheet's plan draft is snapshotted per open** (Settings.tsx:20–25, keyed on `open`/`data.profile`) — actually re-seeds via effect on profile change, so ILA edits while Settings is open do refresh the header, but a half-edited PlanEditor draft is replaced if the effect refires (profile object identity changes on ANY persist — e.g. ILA updates money mid-edit → plan edits in progress are reset). Narrow but real annoyance.
- **C-8 — Statement-scan + edit-sheet interleave.** If the OS file picker is opened, then the edit sheet, and the scan approval lands while the edit draft is stale, saving the edit sheet clobbers the just-approved scan bills (MoneyDashboard.tsx:348–357: both write whole MoneyConfig). Requires deliberate interleaving through modal layers; noted for completeness.

---

## CONFIRMED SOLID (verified, not assumed)

- **TypeScript + tests:** `tsc --noEmit` clean; all 122 vitest tests pass (migrate, money engine, ila-hands, engine, fni, coach, entitlement).
- **migrate.ts legacy mapping** (vehicle/type/frontGross/backGross/products-count → item/category/amount/secondary/addons): correct incl. the number-vs-string[] `products` disambiguation and zombie-key removal; already-migrated data passes through by reference (script + existing tests).
- **ensurePlan chain** (store.tsx:46–54): industry defaults to automotive; `comp` → `compToPlan`; else `defaultPlan(role)` — order correct, profile-less blobs pass through safely.
- **IlaChat threading for ILA's own view:** `dealsNow`/`profileNow` are correctly updated inside the tool loop, so consecutive tools *see* each other's changes (the defect is only the store-side persistence, DL-2). `convo` tool_use/tool_result block construction matches the Anthropic wire shape; 401/402 handling, watchdog `finally` unlocking input, action-card bubble bookkeeping, reflect fire-and-forget — all correct.
- **ila-hands guards:** ambiguous deal/bill/goal references refuse and ask (no guessing between customers); day validation on set_days_off (rejects 7-day-off); product resolution failure aborts *before* any write; `update_money` builds from `profile.money ?? defaultMoneyConfig()` and keeps `payday`/`paydays` coherent (`payday = days[0]`); `evaluate_purchase` refuses cleanly with no balance; whole-object money writes make repeated money tools compose safely even under DL-2.
- **money engine:** `resolvePaydays` clamps/sorts/dedupes/limits (script: `[]`→`[1]`, `[0,45]`→`[1]`, legacy `15`→`[15]`); `checkNets` zeros filtered, single value applies per check; taxRate applied to the forecast path only (user's net checks used as-is — correct); legacy `payday` vs `paydays` precedence (`paydays ?? payday`) consistent across all four call sites; safe-to-spend cushion/floor math matches its tests.
- **Demo/sample-data scope:** `demoDeals` deterministic (no RNG), demo-flagged; first *real* `addDeal` clears only `demo:true` deals; `clearSampleData` same filter; user-entered deals can never be swept.
- **StatementReviewSheet state reset** between scans (the `seen !== scan` render-phase reset) and **MoneySetupSheet draft re-seed** on each open (the `seenOpen` pattern) both work; approve-path uses the live `cfg`, cancel saves nothing; `applyStatementScan` never overwrites a typed balance or non-zero essentials (script-verified) and keeps goals untouched.
- **Page gating:** every AppShell page waits for `ready` and redirects on missing profile (no flash of another user's shell, no `profile!` crash); finance page additionally role-gates; entitlement checker on `/` never downgrades an active verdict mid-session and correctly distinguishes dead-session from unpaid.
- **biometric.ts / push.ts:** WebAuthn enable/verify/disable state keys coherent; `relock()` is now actually called on sign-out; unlock is sessionStorage-scoped (per-tab-session, as designed); push is opt-in only, registration idempotent, permission-denied paths return readable errors, unsubscribe best-effort then server cleanup.
- **AddDeal:** F&I `addons` derived from product picks via the user's own unit weights at save; scan flows are review-then-save (nothing writes until the Save tap); input value resets in `finally` so re-scanning the same file works.

## Worst-first fix order
1. **DL-1** — check `error` on the sign-in SELECT; never seed-upsert on a failed read.
2. **DL-2** — functional updates in every store mutator (fixes ILA multi-tool loss *and* hardens all future callers).
3. **DL-3** — pull on `INITIAL_SESSION`/foreground + `updated_at` comparison before either direction clobbers.
4. **DL-4/DL-5** — clear local state on sign-out; flush + error-check the debounced push.
5. **M-1, M-2** — money-engine corrections (safe-to-spend integrity).
