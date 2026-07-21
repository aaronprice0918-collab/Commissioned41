# Fixed Ops Roadmap — Service & Parts, held to our standard

*July 12, 2026. Aaron's directive: "the service department and the parts
department need to be held to our standard. They need to have the same research
done to make the service employees and the parts employees' lives just as easy
as the salespeople's lives." This document is that research, distilled into a
build plan. Sources: seven parallel research sweeps (advisor workflow, manager
KPIs, parts counter workflow, parts pain points, tool landscape, phone-first
opportunities) across consultant, vendor, NADA/industry-study, and practitioner-
forum sources. Full citations live in the session research reports; headline
numbers are noted inline.*

**Where we start from:** Service Drive v1 (Module 17, shipped July 12) already
gives us the lane board — visit lifecycle, promise-time LATE detection,
declined-work capture, service→sales flags, EILA's `service_lane` tool. This
roadmap is what v2+ builds on top of it, plus the parts department from zero.

**The thesis the research confirmed:** nobody sells "the ultimate service
manager / parts manager in your pocket." The incumbent tools (Xtime, myKaarma,
Dealer-FX, CDK/Reynolds/Tekion) are desktop/tablet lane tools; Tekion is the
only one even claiming one-platform-one-customer-record, which is OUR thesis.
The phone-first AI-assistant angle is wide open in fixed ops.

---

## PART 1 — SERVICE

### The advisor's day (ground truth)
- Sustainable load is **12–15 customer ROs/advisor/day**; burned-out advisors
  run 25 ROs + ~30 calls + ~20 text threads. Dealerships replace **45–49% of
  advisors annually** at $50k–$100k per replacement. The burnout engine is
  admin overhead, not pay.
- The day: 7–9:30am drop-off rush (write-up, walkaround, promise time,
  transport) → mid-morning estimates and the **approval scramble** → afternoon
  status updates and re-promises → 3–6pm delivery wave → 24h CSI follow-up.
- The two numbers that define the job: phone-based estimate approvals average
  **22–23 hours of phone tag while the car sits on a lift**; text/photo
  approvals come back in **~10 minutes**. And the **#1 CSI complaint** in the
  industry is "I dropped my car off and heard nothing until I called."

### The manager's scoreboard (what v2 must eventually show)
| Metric | Benchmark | Why it matters |
|---|---|---|
| Hours per RO | +0.1 hr/RO ≈ $216k/yr at 1,200 ROs/mo, $150 ELR | THE advisor selling metric |
| Effective labor rate (CP) | "door rate is marketing; ELR is truth" | discounts erode it invisibly |
| CP : warranty : internal mix | CP gross/RO ≈ $222 | CP is where profit lives |
| Tech productivity / efficiency / proficiency | 85–87.5% / 125–135% / 100%+ | low proficiency + high efficiency = dispatch problem |
| CSI | top quartile ≈ 950+/1000 | OEM money; #1 complaint = no status update |
| Appointment show rate | ~80% (each saved no-show ≈ $450) | 20% no-show is the norm |
| Declined-work recapture | 23–30% achievable with cadence; ~0% without | most stores run none |
| ROs/advisor/day | 12–15 | >15 = hours/RO and CSI sink together |

### Service build plan (ranked — each passes the four-part test)
1. **Approval Accelerator.** MPI finding → photo + plain-English estimate texted
   with one-tap Approve/Decline per line; EILA nudges the customer on a clock
   and pings the advisor when a car waits on approval >30 min. Kills the 22-hour
   phone tag; photo evidence is the single highest-ROI upsell lever (~65% of
   digital-service-tool ROI). Rides our existing consent rail + texting pipe +
   "Your Deal"-style public token page. *Needs: Twilio live (Aaron), media
   upload.*
2. **Promise-Time Guardian.** v1 already knows LATE; v2 warns BEFORE the promise
   slips, drafts the status/re-promise text on the advisor's update-by time, and
   guarantees no customer goes N hours uncontacted. Directly kills the #1 CSI
   complaint and most inbound "is my car done?" calls. Per-advisor promise-hit
   rate becomes a manager metric.
3. **Declined-Work Recapture Engine.** v1 captures declined work verbatim; v2
   makes every declined line an owned mission on a 30/60/90 cadence with EILA
   drafting outreach (with the original evidence) and booking the appointment.
   23–30% of a leak most stores capture 0% of. Pairs with the parts SOP tracker
   (below) — an arrived part with no appointment is the same failure.
4. **Advisor Morning Command.** EILA pre-writes tomorrow's lane from
   appointments + history (prior declines resurface at write-up — the
   highest-close moment); 7am shows a triaged lane with one-tap check-in +
   guided photo walkaround. Elite stores pre-write ROs the night before; we
   automate it.
5. **Service Manager Scoreboard + CSI-Save Alert.** The table above, live, every
   card drilling to its ROs (the `MetricCard onClick` law); EILA flags at-risk
   visits (blown promise, big decline, long wait) for a manager save BEFORE the
   OEM survey lands. *Full hours/ELR metrics need closed-RO data — start with
   what serviceLane already stores (promise-hit rate, lane throughput, declined
   $, flags) and grow into DMS-fed numbers.*

**The advisor's "finally" list** (what the research says they'd thank us for):
my morning pre-written; approvals in minutes with proof; status texts that send
themselves; a warning before I blow a promise; declined work that comes back on
its own.

---

## PART 2 — PARTS

### Ground truth
A parts department is **three businesses on one inventory**: the back counter
(70–80% of volume, feeding techs on ROs), the retail/phone counter, and
wholesale (body shops via CollisionLink/RepairLink, matrix pricing, delivery
routes). The manager's constants: stock order, lost-sale review, negative
on-hands, cores/warranty-parts credits, pad-vs-GL reconciliation, and the
dreaded annual physical. Native vocabulary the UI must speak: *RO, bin, pad,
on-hand, SOP, core, lost sale, fill rate, phase-in/phase-out, months-no-sale,
obsolescence, stock order, forced stock.*

### The pain chain (ranked — and it IS a chain)
1. **Special-order parts never picked up** — the #1 named cash leak. ~95% of
   obsolete value traces to unfulfilled demand; an unclaimed SOP is worth ~40¢
   on the dollar; an SOP forced into stock has only ~35% chance of ever selling.
   The documented failure: **nobody owns the loop** (parts blames service,
   service blames parts, nobody tells the customer the part landed).
2. **Obsolescence creep** — 16–20%+ of inventory idle; holding cost ~25%/yr
   wipes the margin; managers only confront it at the annual count.
3. **OEM forced stock** (GM RIM ~85% of network) — "RIM-protected dollars are
   60% of my inventory but 35% of my sales" (practitioner forum).
4. **Phantom inventory** — DMS says 3, bin has 1; the fix (daily cycle counts)
   is exactly what a slammed counter never does.
5. **Lost sales never logged** → fill rate is fiction → the store keeps not
   stocking what customers keep asking for. Benchmark: 90%+ first-pick fill.
6. **Techs waiting at the counter** — 20–50 min/day/tech of unbilled time;
   ~$200k/yr across 10 techs.
7. Counter chaos (3 masters at once), staffing churn, the annual physical,
   wholesale margin compression.

Every consultant's prescription is the same unsexy loop — prepay SOPs, log
every lost sale, cycle-count weekly, review months-no-sale monthly — **all
things an assistant can enforce that a busy human reliably won't.** That is
Dealer Mission OS's exact shape.

### The manager's scoreboard
| Metric | Benchmark |
|---|---|
| Blended parts GP | 38–44% (CP retail 40%+, wholesale mid-teens–25%) |
| First-pick fill rate | 90–95% |
| True turn (stock sales ÷ avg inventory) | 6–8+ (gross turn lies — SOP flow inflates it) |
| Months' supply | ~45 days ideal (RIM pushes 60–70) |
| Obsolescence % (12+ mo no-sale) | healthy <5%; bucket 0–3/4–6/7–9/10–12/13+ |
| SOP aging | zero CP SOPs >30 days without action |
| Lost sales logged | near-zero = non-compliance, not honesty |

### Parts build plan (ranked; 1–3 need ZERO DMS integration)
1. **SOP Mission Control** — the "finally" feature. Order → deposit → received
   → customer texted → picked up/returned, with an aging clock, EILA drafting
   the pickup text and escalating at 7/14/30 days, weekly aging digest to the
   GM. Kills the #1 leak; myKaarma's DMS-polling version proves demand. Counter
   logs SOPs in-app for v1 (report upload later). Same store-key pattern as
   `serviceLane` (org key `partsSop` or fold into a `partsLane`).
2. **Tech Parts-Request Queue** — tech taps RO + need from the bay; back counter
   sees a live queue, stages, pings when pulled; request-to-fill time becomes a
   measured KPI. Reclaims 30–45 min/day/tech of billable time and kills the
   counter line.
3. **Lost-Sale One-Tap** — a 2-second "didn't have it" button (part#, channel);
   EILA surfaces "asked 3× in 90 days — stock it" and a weekly lost-sales $
   number. Makes fill rate real for the first time.
4. **Parts Manager Scoreboard on the phone** — the table above; v1 from what
   the app itself captures (SOP aging, request-to-fill, lost-sale $), v2 from a
   nightly DMS report upload (every DMS can schedule the standard parts
   reports — this is literally how PartsEdge operates), v3 from APIs.
5. **Perpetual Bin-Count Micro-Tasks** — EILA deals 5 bins/day weighted to fast
   movers and variance history; phone camera, count, flag; the annual physical
   becomes a non-event.

### DMS integration reality (for later, not for v1)
CDK via Fortellis (parts inventory/pick-ticket APIs, per-dealer fees),
Dealertrack Opentrack (historically cheapest/most open), Tekion (open cloud
APIs, smallest base), Reynolds RCI (expensive, gatekept — serve Reynolds stores
with the DMS-free features first). **Features 1–3 in each department
deliberately require no DMS integration.**

---

## Sequencing recommendation
1. **Parts SOP Mission Control + Service Promise-Time Guardian** — both are
   pure app_store + EILA + (for texts) the existing consent/Twilio rail; both
   attack each department's loudest, most-quantified pain.
2. **Tech Parts-Request Queue** — connects service and parts inside one OS
   (the tech's request references the RO the lane board already knows).
3. **Approval Accelerator** — needs media upload + Twilio live; biggest single
   ROI in service once texting is on.
4. **Declined-Work Recapture + Lost-Sale One-Tap** — the two "money already
   earned, just not collected" engines.
5. **Scoreboards (both) + Morning Command + Bin Counts** — as data accumulates.

**Aaron-side dependencies:** Twilio + A2P registration unlocks every
customer-texting feature above (same blocker as sales texting — one fix, three
departments). Everything else ships on rails we already own.

*Research caveats: several primary sources (NADA guides, PartsEdge, consultant
blogs, DealersEdge forums) block direct fetches; figures came via search-index
extraction, cross-checked across independent sources. Benchmarks vary by source
(fill rate 85–95%, healthy obsolescence 3–7%) — treat them as directional
targets, tuned per franchise.*
