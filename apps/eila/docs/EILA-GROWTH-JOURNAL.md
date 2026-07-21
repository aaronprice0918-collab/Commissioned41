# EILA's Growth Journal

> EILA's compounding memory of her own product. Newest entry on top. Every daily
> growth-loop run reads this first and appends to it. This is how she gets smarter
> every day instead of starting from zero. Read `CLAUDE.md` for the mission and the
> loop rules.

---

## Cycle 1 — the scaling thesis + where to push first (2026-07-14, seeded by Aaron's directive)

**Aaron's charge:** make the app named after me my #1 mission — the best AI
assistant for sales pros the world has ever known — and figure out how to scale
this business into more than a dream. Learn every day, even when he's not using me.

**What I studied:** my own VISION.md, BUSINESS.md, COMPETITIVE-SWEEP.md, and the
current product surface (Mission page, EILA chat with hands, follow-up engine,
pay-plan→forecast, scan tools, push nudges).

**What I learned — the honest read on the constraint:**
The *product* is already strong and differentiated (positioning: "the FIRST AI
companion for commission earners that knows both sides of your money" — sell
*and* keep). The bottleneck to becoming "more than a dream" is **not more
features. It's the growth engine:**
1. **Activation** — a brand-new rep has to feel undeniable value inside the first
   session, before the habit exists. A cold, empty app on day one is where most
   AI assistants die.
2. **Retention / daily return** — an assistant only wins by being opened *every
   day*. The push nudge is the one thread that reaches a rep who isn't in the app;
   it has to earn the tap, every time (today's win: the pace nudge now speaks
   plain English instead of "pacing 27 against a goal of 50").
3. **Word-of-mouth** — commission floors are tight networks. One rep who can't
   run their day without EILA recruits the next five. That only happens if 1 and 2
   are undeniable.

**The strategic order (the loop should work these, top-down):**
- **A. Make the first 60 seconds undeniable.** Onboarding that gets a rep to their
  first real "EILA just did that for me" moment fast — one pasted pay plan or one
  logged deal → an instant, specific, money-true insight only EILA could give.
- **B. Make the daily return worth it.** Every day the rep opens EILA, the single
  most valuable thing for *them today* is front and center (who to call, the money
  move, the follow-up that's going cold) — and the nudge that pulls them in is
  specific and true.
- **C. Make sharing natural.** A rep who wins with EILA should have a dead-simple
  way to show/refer a peer (and a reason to).
- **D. Compounding intelligence.** EILA should visibly get sharper about *this rep*
  over time (memory that shows up in the coaching), because a companion that
  remembers is one you don't leave.

**What I did this cycle:** established the mission substrate — gave the app a
`CLAUDE.md` (it had none, so every session started blind), created this journal,
and set up the daily growth loop so improvement compounds. Shipped the plain-English
pace nudge (retention thread B).

**PRIORITY UPDATE (Aaron, same day): PRODUCT AND STABILITY FIRST.** His standing
order — "no new features until the daily driver is bulletproof." So the daily loop
leads with hardening: fix what's broken/fragile, lock in reliability and
money-correctness, make the core flows undeniable — *then* growth features. A
rock-solid product a rep trusts every day IS the growth engine.

**Next cycle (highest leverage, stability-first):** run the stability sweep — `npm
test` + `npm run build`, then find the most important reliability/correctness/UX
weak point a real rep would actually hit on a normal day (data-loss/clobber risk,
a money number that could mislead, a broken or confusing core flow) and make that
one thing bulletproof, with tests. Ship it on a branch for Aaron. Only once nothing
is fragile do we return to the activation path (A). Measure against: would a
skeptical floor rep trust this with their paycheck every day?

## Cycle 2 — money-correctness sweep + multi-account + account attribution (2026-07-21, driven live with Aaron)

**The charge (stability-first, exactly as the loop ordered):** Aaron opened his
own money picture and it was wrong — the app showed **$47 checking** when his real
liquid position was ~$1,185. A rep who can't trust the number won't trust the app.
So this whole cycle was money-correctness, worked shoulder-to-shoulder with him.

**What was broken / fixed (all shipped to main, each its own PR, CI-gated):**
- **Bank sync showed $0 everyday spend.** Root cause: `everydaySpendFromBank`
  passed a full ISO timestamp into a `YYYY-MM-DD` parser → `NaN` cutoff → every
  bank-derived line silently dropped. Fixed (`nowISO.slice(0,10)`), with tests.
- **Tone: "factual with amazing bedside manner."** The money prompt now names
  what's real, coaches the next move, never shames.
- **Tap-to-reclassify (the "always learning" layer).** A synced line you tap
  ("that's my rent", "that's a transfer to myself") writes a `MerchantRule` that
  fixes every past AND future charge from that merchant — no re-sync. Then
  **same logic everywhere**: merchant rules govern bills too, not just spend.
- **Multi-account (#22).** The engine tracked ONE connected bank. `LinkedAccount[]`
  + `setLinkedAccounts()` derive checking/savings as the SUM across every bank, so
  safe-to-spend/cash-flow/daily-budget run on the real combined total. New "Your
  accounts" card (liquid vs debt rollup). Aaron's real accounts (LGE + BofA, 6
  accounts) loaded into his live config so his picture is finally true.
- **Transaction → source account (#23).** Every spending line now shows WHICH
  account it came out of (BofA checking, BofA card, LGE checking…), tap to set it
  where unknown; for synced lines EILA remembers it per-merchant. ILA parity:
  `set_transaction_account` tool reuses the same engine path.
- **Security/infra (#24).** Patched 3 dependency CVEs (sharp/libvips HIGH,
  postcss) via overrides — WITHOUT the framework downgrade npm's autofix wanted.
  `npm audit` = 0. (Earlier this arc also stood up real CI: build + test gate.)

**Deliverables to Aaron (his real money, outside the app):** reconciled 11
statements across 2 banks → found 6 hidden subscriptions, a hidden card …7738
(~$1–1.5k/mo, no statement yet — the standing blind spot), and fee bleed; shipped
a subscription list + a prioritized cancel plan (~$122/mo realistic, ~$420/mo max).

**Lesson banked:** the fastest path to "a rep trusts this with their paycheck" is
to sit in a real member's actual numbers until they're provably right. Every fix
this cycle came from Aaron's own broken picture, not a hypothetical.

**Still open / next:** get the …7738 statement to close the debt picture;
consider per-account balance math (each account's own running balance — today the
engine still runs on the combined total). Then, with the daily driver trustworthy,
return to activation (path A).

---
<!-- New cycles append ABOVE this line, newest on top. -->
