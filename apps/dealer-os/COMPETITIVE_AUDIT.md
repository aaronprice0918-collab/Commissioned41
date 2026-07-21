# MissionOS — Competitive Audit & Roadmap to #1
**Date:** June 25, 2026 · **Method:** live web research (current product pages, demos, dealer reviews) + a file-by-file audit of the MissionOS codebase. Nothing in here is from memory; every competitor claim is sourced at the bottom, every MissionOS claim is grounded in the actual repo.

> **The one-line thesis.** Everyone else is either a *deal machine with a dumb UI* (eLead, VinSolutions) or a *smart chatbot that can't structure a deal* (Podium, Impel, Numa). MissionOS is the only one positioned to be **both** — an AI that talks to the customer *and* knows the money. We don't need to rebuild; we need to build **outward** from the hard core we already own.

---

## 1. The landscape (who they are, their one killer thing, their soft spot)

| Platform | What it is | Their killer thing | Their soft spot |
|---|---|---|---|
| **eLead** (CDK) | Legacy enterprise CRM, ~7,000 stores | Owns an in-house **Virtual BDC call center** + deep CDK DMS sync + equity mining | "Archaic" UI, innovation lag, a 2024 outage took 15,000 locations down ~2 weeks |
| **VinSolutions** (Cox) | Legacy CRM riding the Cox data empire | **Connect Automotive Intelligence "Buy Signals"** — data from KBB/Autotrader/Dealer.com flags who's ready to buy (9× more likely in 30 days) | Bolted-on AI, dated workflow, you're locked into the Cox tax |
| **DriveCentric** | Modern "Augmented Intelligence" CRM, 2,200 dealers | **Genius AI** responds to leads in *seconds* 24/7 + best-in-class **video selling** + slick UX | Engagement-first; desking/F&I/back-office are shallow |
| **Tekion** | AI-native cloud **DMS+CRM+everything** | **One unified platform** — one login, one real-time customer record across sales/service/accounting; agentic AI (T1) | Enterprise, heavy, expensive; you buy the whole ecosystem |
| **Podium** | Conversational AI layer | **"Jerry" AI Employee** answers every lead in ~36s across text/call/web/social, books appts | Front-of-funnel only; no desking, no deal |
| **Gubagoo** (R&R) | Conversational commerce + chat | **Guba IQ** (OpenAI-built) chat that answers vehicle/feature questions; R&R DMS tie-in | Chat-channel scope; leans on human agents |
| **Impel** | AI customer-lifecycle platform | Generative chat trained on **100M+ auto conversations** + AI vehicle merchandising (auto walkarounds) | Engagement/merchandising; not a system of record |
| **Fullpath** | Auto-native **CDP + AI** | Unifies every data source into **one clean shopper identity**, then activates it with AI marketing | Marketing/data layer; not a sales-floor tool |
| **Numa / Toma / Matador** | AI **voice phone agents** | **Voice AI answers every inbound call**, books appts, follows up (Numa 1,200+ stores; Toma fixed-ops; Matador intent scoring) | Single-job agents; no CRM/desk/F&I of their own |

**The pattern that matters:** the entire market is racing toward **autonomous AI agents** — respond to every lead in seconds, follow up 24/7, answer the phone with a voice, hand off to a human when hot. DriveCentric, Podium, and Numa are winning attention by doing this. **None of them can structure a retail deal, run an F&I menu, or calculate multi-state tax.** That's the seam.

---

## 2. Capability matrix — them vs. us (verified against the repo)

Legend: ✅ solid · 🟡 partial/internal-only · ❌ absent · 🟢 *MissionOS advantage*

| Capability | eLead | Vin | Drive | Tekion | AI pts | **MissionOS today** |
|---|:--:|:--:|:--:|:--:|:--:|---|
| Lead capture / routing / scoring | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 Showroom intake, manual; **no auto-routing/scoring** |
| **Customer-facing 2-way text/email** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ messaging is **internal team only** (`private-chat`) |
| **Instant AI lead response (sec/min)** | 🟡 | 🟡 | ✅ | ✅ | ✅ | ❌ ILA is internal; **does not yet talk to customers** |
| **AI voice / inbound call answering** | 🟡 | ❌ | ❌ | 🟡 | ✅ | ❌ ILA speaks to the *rep*, not callers |
| Video selling | 🟡 | 🟡 | ✅ | 🟡 | 🟡 | ❌ |
| Desking / deal structuring | 🟡 | 🟡 | 🟡 | ✅ | ❌ | 🟢 **real retail + lease desking** |
| F&I menu / products / RDR | 🟡 | 🟡 | ❌ | ✅ | ❌ | 🟢 **F&I desk, products, RDR center** |
| **Multi-state tax / fees engine** | 🟡 | 🟡 | ❌ | ✅ | ❌ | 🟢 **per-state engine, verify-to-quote** |
| AI that reasons about the *deal* | ❌ | ❌ | ❌ | 🟡 | ❌ | 🟢 **ILA audits deals, structures, coaches** |
| Equity / data mining | ✅ | ✅ | 🟡 | ✅ | 🟡 | ❌ |
| Inventory feed / merchandising | ✅ | ✅ | ✅ | ✅ | 🟡 | ❌ (VIN decode only) |
| DMS integration | ✅ | ✅ | 🟡 | ✅(is one) | ❌ | ❌ |
| Digital retailing (online→store) | 🟡 | ✅ | 🟡 | ✅ | 🟡 | ❌ |
| e-signature / digital docs | ✅ | 🟡 | 🟡 | ✅ | ❌ | 🟡 GA packet/print only |
| Unified customer record | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 per-deal, single-store |
| Reporting / dashboards | ✅ 300+ | ✅ | ✅ | ✅ | 🟡 | 🟢 **live pace, scorecards, GM/Team command** |
| Sales coaching / next-best-action | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟢 **ILA coaches reps + managers** |
| Mobile-first | 🟡 | 🟡 | ✅ | ✅ | ✅ | 🟢 **PWA, built phone-first** |
| Doc capture (license/insurance) | 🟡 VIN | ❌ | ❌ | 🟡 | ❌ | 🟢 **ILA vision reads DL + insurance** |
| Recognition / gamification | ❌ | ❌ | ✅ | 🟡 | ❌ | 🟢 recognition feed, player cards |

---

## 3. Where MissionOS already WINS (protect and press these)

1. **An AI that understands the deal, not just the conversation.** Every competitor's AI is a *communicator*. ILA can audit a deal, structure retail/lease, read the F&I menu, and coach the manager. That is the hardest thing to build and we have it. **No one else has it.**
2. **Real desking + F&I + multi-state tax.** DriveCentric and the entire AI-agent wave have *nothing* here. Tekion is the only one with comparable depth, and it costs a fortune and takes the whole DMS.
3. **Mobile-first, one-handed on the floor.** Legacy guys are desktop tools with a phone afterthought. We were born on the phone.
4. **ILA's vision** (reads the driver's license + insurance card) — ahead of the field; even eLead only just shipped VIN scanning.
5. **Coaching the humans.** ILA already does next-best-action for reps *and* managers. The others coach almost nothing.

---

## 4. The gaps that cost us deals (ranked, with who does it best)

**Tier 1 — table stakes we don't have (these lose demos):**
- **Customer-facing two-way communication** (text/email, threaded, logged) — *everyone.* Today our messaging is internal-only. This is the #1 gap.
- **Instant lead response + 24/7 follow-up by AI** — *DriveCentric Genius, Podium Jerry.* The single most-marketed capability in the industry.
- **Lead auto-routing, scoring, and follow-up cadences** — *all four.*
- **Inventory feed** (real vehicles, photos, pricing into the deal) — *all four.*

**Tier 2 — the differentiators the modern players win on:**
- **AI voice agent answering inbound calls** — *Numa, Toma, Matador.* Hottest emerging category; directly in ILA's wheelhouse (she already speaks).
- **Video selling** (personalized walkarounds, tracked) — *DriveCentric.*
- **Equity / data mining** (who's in positive equity / lease-end / service-due → buy) — *eLead, VinSolutions, Tekion.*
- **Buy-signal intelligence** (behavioral data → "ready to buy") — *VinSolutions.*
- **Digital retailing** (start the deal online, finish in store, no re-keying) — *Tekion, Vin.*

**Tier 3 — enterprise/scale plumbing (matters as we sell more stores):**
- DMS integration, e-signature, unified cross-store customer record, group-level enterprise reporting & governance — *Tekion, eLead.*

---

## 5. The play — mirror the best, then leapfrog

**Strategic bet: make ILA the first AI that engages the customer *and* closes the deal.** The AI-agent wave (Podium/Numa/DriveCentric) ends at "booked an appointment." Our AI can keep going — structure the numbers, build the F&I menu, quote the tax, coach the close. That fusion is a category of one.

### Phase 1 — Close the customer-engagement gap (table stakes; do first)
1. **Customer messaging hub** — two-way SMS + email to the actual customer, threaded per lead, logged on the deal. (Twilio/SendGrid; new `/api/comms` + customer thread on the lead.)
2. **ILA goes customer-facing** — instant auto-response to a new lead in seconds, 24/7 follow-up cadence, hands off to the rep when hot. *This is the DriveCentric Genius / Podium Jerry capability — but backed by an AI that also knows the deal.*
3. **Inventory feed** — pull real inventory (photos, price, VIN) so leads attach to actual cars and ILA can talk specifics.

### Phase 2 — Match the modern differentiators
4. **ILA Voice (inbound)** — answer the dealership's calls with ILA's voice, book/route/follow-up, log to the deal. We already have the voice; point it outward. (Leapfrogs Numa by being tied to the deal + CRM, not a bolt-on.)
5. **Equity & buy-signal mining** — flag positive-equity / lease-end / service-due customers and let ILA draft the reach-out. (Needs DMS or data feed.)
6. **Video selling** — record/send tracked personalized walkarounds from the deal.

### Phase 3 — The leapfrog moves (be #1, not tied)
7. **"Deal-aware AI agent"** — ILA negotiates within manager-set guardrails: answers "what's my payment," structures options, books the appt *with numbers already on the desk.* Nobody can do this.
8. **One AI, every seat** — the same ILA is the customer's concierge, the rep's coach, the desk's analyst, and the GM's mirror. Competitors need 3–4 vendors (CRM + AI chat + voice + CDP) to cover what one ILA can.
9. **DMS integration + digital retail + e-sign** — close the enterprise loop so a deal flows online→floor→signed without re-keying.

---

## 6. Do we rebuild from scratch? — straight answer: **No.**

You said you'd start over if that's what it takes. It isn't — and starting over would be the wrong call. The expensive, defensible part (deal/F&I/lease/**multi-state tax** engine + an AI that reasons about money + a mobile-first shell) is **built and is the moat.** Every gap above is *additive* — communications, inventory, voice, mining — bolted onto a strong core, not a reason to burn it down. Rebuilding would mean throwing away the one thing competitors can't copy to go re-create the commodity CRM plumbing they already commoditized.

**What *does* deserve a hard, honest rebuild-grade look** (not the whole app — these specifically):
- The **lead/customer data model** — before we add customer comms + inventory + mining, the lead/contact record should be designed once, properly, as the unified spine (so we don't bolt comms onto a thin record). This is the one place to slow down and architect right.
- **ILA's runtime** — to go customer-facing + voice + autonomous follow-up, ILA needs an agent loop with guardrails and an action/tool layer, not just a chat endpoint. Worth designing deliberately.

Everything else: **build outward, keep the core.**

---

## Sources (live, June 2026)
- DriveCentric — drivecentric.com (`/crm`, `/collection/automotive-crm-features`, future-of-CRM launch), Apple App Store
- Tekion — tekion.com (`/products/arc`, `/products/arc/crm`, AI-native DMS blog), Microsoft customer story
- VinSolutions — vinsolutions.com (`/choose/automotive-intelligence/`, AI/predictive page), Cox Automotive "turn data into deals," crm.org
- eLead — elead-crm.com (data mining), cdkglobal.com/equity-mining, ringlead.ca eLead 2026 review, tesseract.academy review
- Podium — automotive.podium.com, podium.com AI-for-dealerships
- Gubagoo — gubagoo.com, Digital Dealer "Guba IQ" launch
- Impel — impel.ai (automotive-dealer, generative-AI news), CDK Modern Retail partnership
- Fullpath — fullpath.com, ritnerdigital.com AI-companies analysis
- Numa / Toma / Matador — numa.com (Voice AI Smart Inbox launch, PRNewswire), toma.com, thoughtly.com "best AI phone agents 2026," goswirl.ai comparison

---

## UPDATE — June 26, 2026: gap analysis re-run + features shipped

Re-ran the head-to-head vs Tekion / VinSolutions / DealerSocket / eLead /
DriveCentric. **Verdict unchanged and strengthened:** our moat is "AI that talks
about the *deal* and knows the *money*" — and the competitors' headline edges
(2-way customer text/email, instant AI lead response, AI voice answering the
phone) are **all gated on the comms layer (Twilio/A2P) we've deliberately
deferred for cost.** Those remain roadmap, not session work.

**What we SHIPPED this session to close buildable gaps (no new infra):**
- **AI Lead Scoring (0–100) + the Follow-Up Center (`/follow-up`)** — moves
  "lead capture / routing / scoring" from 🟡 (manual) toward 🟢. A
  DriveCentric/Tekion/Matador signature, but **explainable**: every score ships
  with the factors that built it (funnel depth, appointment momentum, recency,
  credit, trade equity), and a Day 1/3/7/14/30 cadence with the concrete next
  touch. Sorted overdue-first so the rep works the right lead next. `lib/leadScore.ts`.
- **The whole "what to do next" OS layer** (this session's UX rollout): the GM
  Good-Morning Mission Brief, NextActionBar on every work screen, nav attention
  badges + global "N needs you", one-tap **Manager TO**, tap-to-call/email.
  This is the thing legacy CRMs (eLead/Vin) structurally can't do — they answer
  "where is my customer," we answer "what should the store do next."
- **Hardening for scale:** fail-closed AI auth + Upstash-ready rate limiting.

**Still the real gaps to #1 (all infra/contract-gated — NOT code quality):**
1. **Customer-facing comms** (2-way SMS/email, instant AI lead response, AI voice) — needs Twilio/A2P. **The single biggest competitive lever.**
2. **Live inventory feed** → ILA's deal-goal → exact trim/stock# (the Inventory Match Engine). Needs the dealer CSV/DMS export.
3. **DMS sync** (eLead/Tekion's deep tie-in) → auto-pull deals instead of manual import.
4. **Service-drive + equity mining at scale** — partial today (we have trade/payoff); full version needs service RO data.

Bottom line: on the **sales + F&I + accountability + "what's next" core**, Dealer
Mission OS is now best-in-class and ahead of the legacy CRMs. To win the whole
seat we still need the **outward comms layer** — that's the next real build, and
it costs money, not just code.
