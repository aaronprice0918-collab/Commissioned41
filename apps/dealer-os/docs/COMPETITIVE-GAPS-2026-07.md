# Competitive Gap Analysis — July 11, 2026

**How this was made:** 108-agent deep-research run (5 search angles, 26 sources
fetched, 74 claims extracted, 25 adversarially verified 3-vote each: 23
confirmed / 2 refuted), then diffed against the 21-module map in VISION.md and
everything shipped since. Findings from the verified set are marked ✅;
findings from extracted-but-not-adversarially-verified sources are marked ◐
(sourced, single-pass). All outcome numbers are vendor-claimed.

---

## 1. Where the bar is now (verified)

- ✅ **The "dealer OS" category is defined by department footprint.** Tekion ARC
  sells one AI-native platform spanning Sales, Service, Parts, F&I, and
  Accounting — DMS + CRM + service lane + payments + payroll + analytics on one
  data core (3,000+ rooftops). A "dealership operating system" gets measured
  against that scope, not against a CRM.
- ✅ **Named, role-specific AI agents are the incumbents' 2026 centerpiece.**
  Tekion shipped seven in 18 months: Scheduler AI, Technician AI, T1 (Feb
  2026); T1 Pro, Salesperson AI, F&I Manager AI, Accounts Payable AI (June
  2026). CDK's NADA 2026 headline: built-in Customer Data Platform + agentic
  AIVA assistant + AI Summary. Reynolds launched "Rey" on its "Spark AI"
  unified data layer (◐).
- ✅ **"One customer record, one AI brain" is now contested ground.** Reynolds'
  NADA pitch attacks rivals for "siloed data" (◐); CDK embeds a CDP; Tekion
  sells the single data core. Our positioning sentence is being said on the
  NADA main stage by three incumbents. The differentiation has to be
  execution: mobile-first, 10-second-rule simplicity, price, and speed.
- ◐ **The 2025–26 CRM AI baseline (table stakes):** instant lead response,
  predictive buyer scoring, automated re-engagement, 24/7 communication.
- ◐ **Pricing reality:** franchise CRMs (VinSolutions, Elead) run
  **$1,500–$3,000+/mo per rooftop** before add-ons. Our $499 flat is a real
  wedge — underprice by 3–6× while bundling what they charge extra for.

## 2. Where we're already at (or ahead of) the frontier

- **F&I deal-jacket AI:** Tekion announced "F&I Manager AI" (missing docs,
  checklist gaps, compliance flags before funding) in **June 2026**. We shipped
  the jacket checklist, Scan and Sort, and the blue folder **before their
  announcement** — with the real Kennesaw checklist. This is a marketing story:
  "the feature Tekion just announced, a one-store startup already ships."
- **Next-best-action assistant:** Tekion's T1 Pro ("surfaces what matters,
  recommends next steps") validates EILA + the NextActionBar as the right bet.
  They ship it to 3,000 rooftops; ours is more personal (per-rep memory,
  coaching, pay-plan math they don't touch).
- **Pay/commission engine:** no incumbent finding even mentions rep-facing
  commission transparency ("what am I making, how do I make more"). Genuinely
  ours.
- **Group-level AI Q&A:** Tekion T1 answers questions across a dealer group
  (medium confidence). Confirms group reporting is table stakes for the OS
  category — and that EILA answering group questions is the right shape for it.

## 3. THE GAPS — tiered

### Tier A — table stakes we're missing (sell-blockers for store #2+)

1. **Speed-to-lead / AI lead response (Module 5, ⬜).** Every source agrees:
   instant 24/7 lead response is THE baseline. Tekion bundles it natively
   (Salesperson AI: answers pricing/availability by text/email "in seconds,
   24/7," books appointments). A whole vendor class (Podium, Numa, Toma, Mia)
   exists just for this; Toma's wedge stat: dealership phones answered only
   ~45% of the time (◐). EILA can already draft — she needs the pipe to send
   and the timer/escalation loop.
2. **Communication hub + consent compliance (Module 13, ⛔ deferred).** The
   research says this deferral is the single costliest gap — every table-stakes
   AI feature (lead response, re-engagement, 24/7 comms) rides on it. And it
   carries a legal rail we hadn't scoped (◐, regulatory sources): TCPA
   statutory damages are **$500–$1,500 per text/call**; since April 2025
   consumers can revoke by "any reasonable means" (not just STOP) with a
   10-business-day suppression clock; **AI-generated voices legally count as
   prerecorded calls** requiring prior express written consent; purchased
   internet leads are the top litigation source and a vendor's consent claim
   doesn't protect the dealer. → When we build comms, **per-customer,
   per-channel consent capture with an audit trail is a day-one feature**, not
   an afterthought.
3. **MFA + Safeguards Rule posture (net-new, never on the map).** Dealers are
   FTC "financial institutions" (◐, FTC primary source): they must run an
   information-security program, **MFA (or equivalent) is required for systems
   accessing customer information**, they must vet vendors' security
   contractually, and breaches ≥500 consumers are FTC-reportable in 30 days.
   Practical consequences: (a) the app needs **MFA** — we have email/password
   only; (b) every franchise sale will come with a **vendor security
   questionnaire** (our security-policy docs are a head start); (c) breach
   detection/incident-response language belongs in our contracts.
4. **OEM lead-handling certification (net-new, go-to-market).** VinSolutions
   maintains named per-manufacturer certifications — GM Lead Pipe, Cadillac
   Pinnacle, VW Official CRM *and separate desking* certification, Audi, and a
   **Mazda lead-handler program** (◐). Franchise stores route OEM leads only
   through certified handlers. To sell to Mazda stores beyond Kennesaw, we
   need the Mazda program's requirements on our roadmap — and eventually
   per-OEM certs. This is paperwork + feature compliance, not just code.
5. **Group reporting (already on our list, unbuilt).** Confirmed table stakes:
   ARC markets multi-rooftop "first-class"; T1 answers cross-store questions.
6. **Compliance rails via integration, not build (◐).** 700Credit (21,000+
   dealers) is the de-facto rail: credit pulls, soft-pull prequal, OFAC
   screening with remediation, Red Flags, adverse-action letters, MLA,
   synthetic-ID, plus a compliance-monitoring dashboard. **Integrate, don't
   build** — a 700Credit partnership would give us the whole F&I compliance
   checklist in one integration and instantly answer "where's your OFAC?"

### Tier B — dealer-OS scope gaps (the category expects these; sequence deliberately)

7. **Service drive (Modules 17/16).** Xtime defines the footprint: Invite
   (marketing) / Schedule (consumer booking) / Engage (lane check-in) / Inspect
   (photo+video multipoint inspection with remote customer approval) — 10M+
   appointments/mo (✅ vendor-claimed). Tekion's Scheduler AI makes 24/7 AI
   service booking table-stakes-trajectory; CDK's AIVA sells the same. Biggest
   revenue surface we don't touch; also the data source equity mining needs.
8. **Inventory intelligence (Module 15, ⛔ on feed).** CDK ships AI appraisals,
   pricing, and automated photo/video merchandising in-platform (✅). When the
   Kennesaw inventory CSV lands, "inventory match" alone won't be the bar.
9. **F&I menu + eContracting rails.** Darwin's patented "prescriptive selling"
   menu is the F&I differentiator standard; menus themselves are table stakes
   (✅). Dealertrack: 86% of contracts eligible for digital submission, 500+
   lender eContracting, **partner-gated APIs** (✅) — being a Dealertrack/
   RouteOne integration partner is the price of playing in F&I workflow.
   Fraud/identity AI (Point Predictive BorrowerCheck vs a claimed $9B fraud
   problem) is the 2026 add-on layer (✅).
10. **Consumer-facing surface (net-new).** We are 100% staff-facing. The
    market's money is increasingly consumer-facing: soft-pull shop-by-payment
    (Darwin/700Credit standard rail), consumer self-serve F&I e-commerce 24/7
    (Darwin Direct, shipped since 2018), consumer scheduling (Xtime/Scheduler
    AI). A public "your deal" page (payment, docs to bring, delivery checklist)
    is our cheapest first step onto that surface.

### Tier C — ideas worth stealing later / watching

- **Warranty-reimbursement optimization** (CDK WRAP: vendor-claims $100K+/yr
  per store recovered from OEM warranty rates ✅). A pure-profit fixed-ops
  category we'd never considered. Data-heavy; watch it.
- **Technician voice/photo AI** (Tekion: tech speaks/photographs, AI pre-fills
  the multipoint inspection ✅). Differentiator-class; needs service module
  first.
- **Point-of-sale stipulation clearing** — Dealertrack says "later in 2026"
  (✅): stips cleared at POS. Open window; our Scan and Sort already reads
  stips off scanned paper — closest adjacent capability we own.
- **AI fraud/synthetic-ID screening** — via 700Credit/Point Predictive
  integration when F&I deepens.
- **Not worth chasing:** parts-delivery robots (Reynolds Relo ◐), payroll/
  accounting parity with DMSes, building our own eContracting.

## 4. What this changes about sequencing

VISION.md's build order holds up — the research mostly *re-prioritizes*:

1. **Module 5 (Five-Minute Response) jumps to #1.** It's the industry's agreed
   baseline, it's EILA-shaped, and most of it (drafting, scoring, escalation
   logic) doesn't need Twilio to start — timer + escalation + EILA drafts now;
   auto-send when comms land.
2. **Comms (Module 13) stops being "deferred for cost" and becomes the next
   platform bet** — with consent/TCPA architecture designed in from day one.
3. **Two net-new tracks open:** (a) Trust track — MFA, Safeguards posture,
   security questionnaire readiness; (b) Certification track — Mazda lead-
   handling program requirements.
4. **Integrations beat builds** for compliance (700Credit) and contracting
   (Dealertrack/RouteOne partner programs).
5. **Group reporting** stays on deck for the moment store #2 signs.

## 5. Research caveats

Platform/DMS, fixed-ops, F&I, and funding-rail findings are 3-0 verified
against primary sources (all vendor-primary; outcome numbers unaudited). The
CRM-specialist and AI-layer findings (◐) come from the fetch stage without the
adversarial-verification pass; pricing figures there are third-party
characterizations, not rate cards. No public per-store pricing survived
verification for any major vendor. Tekion's June 2026 agents were ~4 weeks old
at research time — announced, GA status unconfirmed.
