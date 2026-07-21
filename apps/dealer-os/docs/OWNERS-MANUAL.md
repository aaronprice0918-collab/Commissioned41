# Dealer Mission OS — The Owner's Manual

*How to run your store on it, start to finish. Written for Aaron; works for any GM you hand it to.*

**The one idea:** this is not a place to type things in. Every screen answers three questions in ten seconds — *What's happening? What needs my attention? What do I do next?* — and **EILA can do everything the screens can do**. When in doubt, ask her.

---

## 1. First-day setup (Admin, ~20 minutes)

Do these once, in order:

1. **Admin → add your people.** Every salesperson, manager, F&I manager, BDC agent gets an account with the right role. Roles decide what they can see — Sales/BDC only ever see their *own* customers' names; managers see the store.
2. **Store Settings.** Store name, doc fee, holdback %, tax rate, product weights (what counts toward PPU), and whether EILA is on for the floor. These numbers feed *every* screen — get them right first.
3. **Pay Plan Studio.** Enter each rep's real pay plan (commission %s, tiers, draws, bonuses) and the F&I plans. This powers My Scorecard and every "what am I making?" answer EILA gives.
4. **Goals.** Store unit and gross goals for the month, plus per-F&I-manager PVR/PPU targets. The rings and pace math all key off these.
5. **Import.** Paste your current deal log (the importer reads DMS "expanded row" pastes too). It shows you a reconciliation check before it commits — if the totals don't tie, it tells you and won't commit until you say so. There's always a **Safety net — last backup** card on this page: one tap restores the previous board, and a restore is always reversible.
6. **Security.** Turn on two-factor for your own account (Team → Security → scan the QR with any authenticator app). Then have everyone else do the same — dealers are FTC "financial institutions"; MFA is required, not optional.

## 2. The daily rhythm — by role

### Salesperson / BDC
- **Showroom** is home. A fresh up shows a **gold 5:00 countdown** — that's your first-contact clock. Beat it: tap the lead's phone/email (that alone stops the clock), or tap **Text** — **EILA has already written your first touch**; read it, tweak it, send. Under five minutes is the whole game.
- **Consent chips first.** Before texting anyone, tap the Call/Text/Email chips on their card and record how they opted in ("Verbal in store", "Web form"…). Red chip = revoked = do not contact, ever, and the app physically won't let you.
- **Follow-Up** tells you *who to work next* — every open lead scored 0–100, overdue first, with the recommended touch written out. Work it top-down.
- **My Scorecard** is your money: what you've made this month, what the next deal is worth, and EILA will explain any number you tap.

### Sales manager
- **Showroom board**: who's physically on the floor (only leads marked "Customer in Showroom"), who needs a TO (red), where every deal is on the Road to the Sale checklist.
- **Desking** structures the deal — payment, trade, spread — and prints the customer worksheet.
- Watch the **5-Min Response card**: red "N OVER" means fresh ups are dying right now. Tap it, see who, get them called.
- **Appointments** shows today's board — confirm them so they show.
- Ask EILA: *"who's on the clock?", "which deals are stuck?", "how's Bo's month?"*

### F&I manager
- **Deal Entry** logs the deal (VIN decodes itself; deal #, address, products, rates).
- **Finance Desk / Deal Center**: every working deal, the **Deal Jacket** checklist (your real Kennesaw order, 51 docs in 5 packs), and **Scan and Sort** — drop the scanned signed stack on EILA and she returns it in filing order, checks off the jacket, and files the PDF to the deal's **blue folder** (kept 90 days).
- **Finance Command** grades the month — PVR, PPU, per-manager against *your* personal targets.

### GM / Owner (you)
- **Mission Control** (home) is the store at a glance. Every card taps into its list; every number has "ask EILA why."
- **GM Command** for the deeper store view; **Sales by Type** for new/used/lease mix; **Archive** for closed months.
- **Close the Month** (Deal Center) at month end: it archives everything, shows the locked recap, and clears the board — the archive write is verified *before* anything clears, so a failed backup never costs you a month.
- **Group** — when store #2 signs, this is the one scoreboard across rooftops. (You already see all stores as owner.)

## 3. EILA — actually use her

She's on every screen (the E bubble) and she has a tool for everything: deal queries, pay estimates ("what am I making this month?"), the follow-up list, appointments, equity/trade-up radar, deals at risk, rate lookups, VIN decode, the 5-minute-response board, consent checks, group numbers, restoring a backup — and **sending texts** (she always shows you the message and waits for your yes).

The habit to teach the floor: **tap any number you don't understand.** Every stat card has "ask EILA why" — she walks the real math behind that exact figure. If she can't explain a number, that number is a bug; tell me.

She also *learns*: reps' strengths and drills, customers' objections, what closes at your store. She gets sharper every week you use her.

## 4. The money math (so you can trust it)

- **Gross** = front + back + doc fee. **PVR** = total gross ÷ delivered units — always computed from the raw totals, never an average of averages, and it's the *same* engine on every screen (desk, scorecards, archive, group).
- **PPU** counts product units (weighted per Store Settings) over classified retail deals.
- **Pay** comes from the Pay Plan Studio plans — every scorecard number traces to a plan rule you entered, and EILA can show the trace.
- Taxes/fees on the desk follow Georgia TAVT rules: the trade credit gate (F&I toggles it off when the customer doesn't own the trade outright), the new-vehicle rebate exclusion (a $2,000 rebate comes OUT of the taxed base), and the lease rule (base payments plus cash down). All verified against GA DOR guidance and locked in with tests.
- **Only money actually entered counts.** A deal with no doc fee recorded shows $0 doc income (and the Office Check flags it) — the app never imputes a number it doesn't have. If a stat looks low, the fix is entering the missing data, not distrusting the math.

## 5. The big switches (go-live checklist)

Everything below is already built in and safely OFF until you add keys. Nothing changes until you flip it.

| Switch | What turns on | What you do |
|---|---|---|
| **Stripe** | Real $499/mo billing + open signups | Add `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` in Vercel (run `scripts/stripe-setup.mjs` to create the price), point a Stripe webhook at `/api/stripe/webhook` + set `STRIPE_WEBHOOK_SECRET`, test a checkout, then set `NEXT_PUBLIC_SIGNUPS_OPEN=true` |
| **Texting** | Send/receive real SMS in the app; STOP auto-revokes consent | Buy a Twilio number, finish A2P 10DLC registration (carriers require it, takes days — start early), add `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` in Vercel, point the number's webhook at `/api/sms/webhook` |
| **MFA** | Two-factor sign-in | Nothing to configure — each person turns it on at Team → Security |
| **Spend card** | See your AI spend in-app | Add `ANTHROPIC_ADMIN_KEY` in Vercel |
| **Rate limiting** | Hard API rate limits | Add the Upstash keys in Vercel |

## 6. The safety nets (what saves you when something goes wrong)

- **Every board save is race-protected.** If two devices fight, the app keeps the server's copy and shows a red *"board changed on another device"* banner — nothing is silently overwritten. If you see it, just re-enter your last change.
- **Import backup**: the Import page always holds the last board snapshot; restore is one tap and reversible.
- **Close the Month** never clears until the archive is confirmed written.
- **Blue folders** auto-delete after 90 days (deal PDFs). The jacket checklist itself never expires.
- **A customer's STOP is instant and total** — it kills texting on every lead card they have, automatically, with an audit trail. That trail is your TCPA defense; don't work around it.
- Stale phone after a deploy? Close and reopen the app (installed PWAs hold the old version for one open).

## 7. If a number ever looks wrong

Don't stare at it — tap it and ask EILA to explain it. If her explanation doesn't match reality, the input is wrong somewhere (a deal's gross, a missing invoice, a split, the goal itself) and she'll name which. If she can't explain it at all, screenshot it and send it to me — that's a bug and it'll be fixed same-day.
