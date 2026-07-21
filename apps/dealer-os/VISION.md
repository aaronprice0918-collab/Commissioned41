# Dealer Mission OS — Vision & Module Map

> The north star. Read alongside `C41_MEMORY.md`. Every feature is judged against
> the **Four-Part Test** below. If a screen doesn't pass it, it doesn't ship.

## Positioning — NOT a CRM. A Dealer Operating System.

The moment we call this a CRM, we get compared to VinSolutions, DealerSocket,
Tekion, DriveCentric, eLead. **Dealer Mission OS creates a new category: the
operating system that runs the dealership.**

- Apple didn't build an MP3 player — they built the iPod ecosystem.
- Tesla didn't build a dashboard — they built an OS for the car.
- Legacy CRMs answer **"Where is my customer?"**
- Dealer Mission OS answers **"What should my dealership do next?"**

One platform. Every department. One customer record. One AI brain. One OS.

**Brand:** Dealer Mission OS, powered by **Commissioned 41**.
**Tagline:** *Know the Lead. Execute the Mission.*
Alternates: "Every Lead. Every Follow-Up. Every Deal." · "Dealership Command,
Simplified." · "Stop Losing Leads. Start Executing." · "Built for the Showroom.
Powered by AI."

## The Four-Part Test (the discipline that keeps us an OS, not clutter)

**Every screen must do at least ONE of these — or it does not belong in Dealer Mission OS:**
1. **Save time**
2. **Increase profit**
3. **Improve accountability**
4. **Elevate the customer experience**

## The AI Brain doctrine

Dealer Mission OS doesn't just store data — it **continuously thinks**. Every
screen answers *"What should I do next?"* not *"Where do I click?"* The brain
(ILA) is always asking, in the background:
- Who is most likely to buy today? Who needs a manager TO?
- Which salesperson needs coaching? Which inventory should we push?
- Which lender gives the strongest structure? Which service customer is in equity?
- Which deal is about to fall apart? **Where is profit leaking?**

The proof-screen of the whole thesis is the **Manager "Good Morning" brief**: a
GM walks in and instead of opening six systems, the OS tells them yesterday's
units/gross/reserve/response-time, who almost bought, who needs coaching, who's
behind on funding, and which service customers are sitting in equity. No
clicking. No reports. Just answers. (We already ship a Nightly Brief — this is
its morning, dashboard-native twin.)

## Roles (each sees only what matters to them)

Owner · GM · GSM · Sales Manager · Finance Manager · BDC Manager · Salesperson ·
Internet Manager · Service Advisor · Admin.

## Design language

Premium, Apple-inspired. Matte black, white type, soft-gray cards, **electric/
steel-blue accents**, crimson only for alerts. Rounded panels, clean spacing,
mobile-first, minimal clicks, zero clutter, no 1990s-dealer-software feel, no
spreadsheet dashboards unless intentional. Feels like Apple Calendar + the Tesla
service app + a modern sales command center. (Matches our locked "living glass"
identity + the Dealer-eyebrow MISSION·OS mark.)

## Module Map — target state vs. what exists TODAY

Status: ✅ built · 🟡 partial (exists, needs the OS-grade rebuild) · ⛔ blocked on
an external dependency · ⬜ net-new.

| # | Module | Status | Notes / where it lives now |
|---|--------|--------|----------------------------|
| 1 | **Mission Dashboard** (traffic-light command view) | 🟡 | `/` + `/gm-command`; needs the green/yellow/red "what needs action right now" rebuild + Good-Morning intelligence |
| 2 | **Lead Inbox** (unified, AI-prioritized) | 🟡 | `/crm-desk` has leads on an 8-stage model w/ source; needs a prioritized multi-source inbox view |
| 3 | **Customer 360 Profile** + timeline | 🟡 | CRM lead detail has most fields; needs the lifecycle timeline view |
| 4 | **AI Follow-Up Center** (Day 1/3/7/14/30 cadence) | ⬜ | ILA can draft; no dedicated cadence center yet |
| 5 | **Five-Minute Response System** (speed-to-lead) | ⬜ | the single biggest CRM best-practice gap; needs timer + escalation |
| 6 | **Appointment Board** (kanban) | 🟡 | appointment field exists on leads; no board yet |
| 7 | **Showroom Board** (live traffic stages) | ✅🟡 | `/crm-desk` Showroom w/ physical-presence gate; extend to full stage kanban |
| 8 | **Deal Pipeline** | ✅🟡 | `/deal-center` + stages; add stuck-reason + AI recommendation |
| 9 | **Desk Manager View** | ✅🟡 | `/desking` + `/finance-desk` + GA lease/tax engine |
| 10 | **BDC Command Center** | ⬜ | net-new; depends partly on comms |
| 11 | **Salesperson Daily Plan** ("do these 12 first") | 🟡 | `/my-scorecard` "Today" one-on-one + ILA daily-action-plan directive; needs the ranked mission list |
| 12 | **AI Lead Scoring 0–100** | 🟡 | ILA reasons about intent; not surfaced as a score on cards |
| 13 | **Communication Hub** (call/text/email thread) | ⛔ | needs Twilio/A2P (deferred for cost); internal `/private-chat` exists |
| 14 | **AI Call & Text Review** (A–F grading) | ⛔ | depends on comms capture; named differentiator |
| 15 | **Inventory Match Engine** | ⛔ | GATED on the live inventory feed (pending CSV export) |
| 16 | **Equity Mining** | ⬜ | net-new; needs trade/payoff + (ideally) service data |
| 17 | **Service Drive Opportunities** | ⬜ | net-new; needs service/RO data |
| 18 | **Manager TO System** (no lost lead without a TO) | 🟡 | partial in Showroom; needs the TO request + lost-reason capture |
| 19 | **Finance Opportunity Tracker** | 🟡 | `/finance-command` F&I report; extend to lender/product/stip/CIT/chargeback |
| 20 | **Reporting & Accountability** | ✅🟡 | goals, scorecards, RDR, nightly brief |
| 21 | **Admin Workflow Builder** | ⬜ | net-new |

## User Experience Laws (non-negotiable — the moat)

Dealer Mission OS is **not designed to have the most features. It is designed to
make every employee — first-day salesperson to dealer principal — more effective
with less effort.** A busy dealership user under pressure must understand any
screen with little to no training. This is what separates us from legacy dealer
software: instead of doing everything, we make the most important tasks feel
effortless.

**THE 10-SECOND RULE (apply to every primary screen):** a first-time user must,
within 10 seconds, (1) understand what the page does, (2) spot the most important
information, and (3) know what action to take. **If a screen fails this test,
redesign it.**

**Every screen answers three questions immediately:**
1. **What is happening?**
2. **What needs my attention?**
3. **What should I do next?**

**One/two-click maximum** for every common task — call, text, email, schedule,
start a deal, log a note, request a manager TO, switch vehicles, view trade, pull
history, start desking, turn to finance. If a common action needs menu-diving or
multiple screens, the design is wrong. (Extends the standing rule: *if it looks
interactive, it must BE interactive.*)

**Information hierarchy, top to bottom:** critical actions → current customer
info → next recommended action → supporting details → history. Important info is
never buried.

**AI reduces thinking, not adds work.** The OS proactively surfaces what's needed
("You have 3 overdue follow-ups", "This deal is waiting on a lender stip", "A
manager should step in now", "This customer has equity to upgrade") — it
anticipates the next action before the user asks.

**Apple-level simplicity:** beautiful without flashy, minimal without hiding
function, powerful without feeling complicated. Breathing room on every screen,
every button has a purpose, every animation reinforces understanding rather than
distracting. Users feel confident, not overwhelmed.

**Avoid:** tiny buttons, overcrowded dashboards, hidden menus, confusing
terminology, excessive pop-ups, multi-window-for-one-task, spreadsheet screens of
endless rows (unless intentional).

## The family (Commissioned 41 = the company; the OSes = the products)

- **Commissioned 41** = the company (the "Apple").
- **Dealer Mission OS** = the flagship dealership OS (the "macOS").
- **MissionOS Core** = the personal executive OS (owner-only, already in-app).
- **MissionOS Finance** = the personal financial OS (separate repo).
- **MissionOS Home / Business** = future household / small-business OSes.

All share one design language, one AI philosophy, one mission-first approach.

## Build sequencing principle

Bias the near-term roadmap to what makes the **Kennesaw July 2026 demo
undeniable** AND runs on data we already have (no waiting on Twilio, inventory,
or lead-source integrations). The "what's next" AI surfaces — Mission Dashboard
+ Good-Morning brief and the Salesperson Daily Plan — ARE the thesis and are
buildable now. The comms-dependent and inventory-dependent modules come after
those external pieces land.
